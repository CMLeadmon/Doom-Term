use std::io::Write;
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use super::Trace;

#[derive(Clone, Default)]
struct Capture(Arc<Mutex<Vec<u8>>>);

impl Write for Capture {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn written(capture: &Capture) -> Vec<Value> {
    String::from_utf8(capture.0.lock().unwrap().clone())
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[test]
fn an_event_is_one_json_line_with_its_name_and_time() {
    let capture = Capture::default();
    let trace = Trace::new(capture.clone());

    trace.emit("paint", json!({ "working": true }));

    let lines = written(&capture);
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0]["ev"], "paint");
    assert_eq!(lines[0]["working"], true);
    assert!(lines[0]["t_ms"].as_f64().unwrap() >= 0.0);
}

#[test]
fn later_events_are_not_timestamped_before_earlier_ones() {
    let capture = Capture::default();
    let trace = Trace::new(capture.clone());

    trace.emit("paint", json!({}));
    trace.emit("paint", json!({}));

    let lines = written(&capture);
    assert!(lines[1]["t_ms"].as_f64().unwrap() >= lines[0]["t_ms"].as_f64().unwrap());
}

#[test]
fn a_repeated_state_is_written_once_and_a_change_is_written_again() {
    let capture = Capture::default();
    let trace = Trace::new(capture.clone());

    trace.emit_changed("plate", json!({ "context": 0.5 }));
    trace.emit_changed("plate", json!({ "context": 0.5 }));
    trace.emit_changed("plate", json!({ "context": null }));

    let lines = written(&capture);
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0]["context"], 0.5);
    assert_eq!(lines[1]["context"], Value::Null);
}

#[test]
fn different_events_do_not_suppress_each_other() {
    let capture = Capture::default();
    let trace = Trace::new(capture.clone());

    trace.emit_changed("plate", json!({ "x": 1 }));
    trace.emit_changed("state", json!({ "x": 1 }));

    assert_eq!(written(&capture).len(), 2);
}

#[test]
fn a_failing_sink_does_not_panic() {
    struct Broken;
    impl Write for Broken {
        fn write(&mut self, _buf: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("disk full"))
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Err(std::io::Error::other("disk full"))
        }
    }
    let trace = Trace::new(Broken);

    trace.emit("paint", json!({}));
}
