use std::time::Duration;

use instant::Instant;

use super::OutputActivity;

fn ms(n: u64) -> Duration {
    Duration::from_millis(n)
}

#[test]
fn silence_is_not_continuous() {
    let t0 = Instant::now();
    let activity = OutputActivity::new(t0);
    assert!(!activity.is_continuous_at(t0 + ms(5_000)));
}

#[test]
fn streaming_output_is_continuous() {
    let t0 = Instant::now();
    let activity = OutputActivity::new(t0);
    for step in 0..20 {
        activity.record_at(t0 + ms(step * 100));
    }
    assert!(activity.is_continuous_at(t0 + ms(1_950)));
}

#[test]
fn a_periodic_footer_repaint_never_counts_as_work() {
    // agy repaints its idle footer every ~1.3-2 s; Claude and Codex have similar heartbeats.
    let t0 = Instant::now();
    let activity = OutputActivity::new(t0);
    let mut t = 0;
    while t < 20_000 {
        activity.record_at(t0 + ms(t));
        for probe in [t, t + 100, t + 400, t + 900] {
            assert!(
                !activity.is_continuous_at(t0 + ms(probe)),
                "heartbeat at {t} ms read as work at {probe} ms"
            );
        }
        t += 1_300;
    }
}

#[test]
fn work_stops_being_continuous_within_a_second() {
    let t0 = Instant::now();
    let activity = OutputActivity::new(t0);
    for step in 0..30 {
        activity.record_at(t0 + ms(step * 100));
    }
    assert!(activity.is_continuous_at(t0 + ms(2_950)));
    assert!(!activity.is_continuous_at(t0 + ms(3_900)));
}

#[test]
fn stale_slots_from_an_earlier_lap_do_not_count() {
    let t0 = Instant::now();
    let activity = OutputActivity::new(t0);
    for step in 0..10 {
        activity.record_at(t0 + ms(step * 100));
    }
    // Eight slots of 200 ms later, the same slot indices come around again.
    assert!(!activity.is_continuous_at(t0 + ms(1_000 + 8 * 200)));
}
