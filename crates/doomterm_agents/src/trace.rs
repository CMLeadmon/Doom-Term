//! Opt-in JSON-lines trace of what the status plate shows and when it is painted.
//!
//! Nothing is recorded unless [`TRACE_ENV`] names a file. Lines carry pane names as the plate
//! shows them, so the file is meant to be read by the person who asked for it.

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::{Mutex, OnceLock};

use instant::Instant;
use serde_json::{Map, Value};

/// Environment variable naming the file the trace is appended to.
pub const TRACE_ENV: &str = "DOOMTERM_PLATE_TRACE";

/// Writes one line per event: `t_ms` since the trace opened, `ev` and the event's own fields.
pub struct Trace {
    epoch: Instant,
    state: Mutex<State>,
}

struct State {
    sink: Box<dyn Write + Send>,
    last_by_event: HashMap<String, String>,
}

impl Trace {
    pub fn new(sink: impl Write + Send + 'static) -> Self {
        Self {
            epoch: Instant::now(),
            state: Mutex::new(State {
                sink: Box::new(sink),
                last_by_event: HashMap::new(),
            }),
        }
    }

    pub fn emit(&self, event: &str, fields: Value) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        self.write(&mut state.sink, event, fields);
    }

    /// Writes nothing when `fields` equal those last written for `event`.
    pub fn emit_changed(&self, event: &str, fields: Value) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        let serialized = fields.to_string();
        if state.last_by_event.get(event) == Some(&serialized) {
            return;
        }
        state.last_by_event.insert(event.to_owned(), serialized);
        self.write(&mut state.sink, event, fields);
    }

    fn write(&self, sink: &mut dyn Write, event: &str, fields: Value) {
        let micros = self.epoch.elapsed().as_micros() as f64;
        let mut line = Map::new();
        line.insert("t_ms".into(), Value::from(micros / 1000.0));
        line.insert("ev".into(), Value::from(event));
        match fields {
            Value::Object(fields) => line.extend(fields),
            other => {
                line.insert("data".into(), other);
            }
        }
        // A trace that cannot be written must never disturb the application it observes.
        let _ = writeln!(sink, "{}", Value::Object(line)).and_then(|()| sink.flush());
    }
}

static GLOBAL: OnceLock<Option<Trace>> = OnceLock::new();

fn global() -> Option<&'static Trace> {
    GLOBAL
        .get_or_init(|| {
            let path = std::env::var_os(TRACE_ENV)?;
            let file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .ok()?;
            Some(Trace::new(file))
        })
        .as_ref()
}

/// Records an event if tracing is on; `fields` is not evaluated otherwise.
pub fn emit(event: &str, fields: impl FnOnce() -> Value) {
    if let Some(trace) = global() {
        trace.emit(event, fields());
    }
}

/// Records an event if tracing is on and its fields differ from the last record of that event.
pub fn emit_changed(event: &str, fields: impl FnOnce() -> Value) {
    if let Some(trace) = global() {
        trace.emit_changed(event, fields());
    }
}

#[cfg(test)]
#[path = "trace_tests.rs"]
mod tests;
