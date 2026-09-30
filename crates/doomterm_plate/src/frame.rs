//! When to paint the next frame of the working mark's animation.

use std::time::Duration;

/// How long to wait so the next frame lands on a grid of `frame`-long steps measured from the
/// animation's start. Waiting a fixed `frame` after each paint would sag by the time a paint takes.
pub fn delay_to_next_frame(elapsed: Duration, frame: Duration) -> Duration {
    let into_frame = Duration::from_nanos((elapsed.as_nanos() % frame.as_nanos()) as u64);
    let remaining = frame - into_frame;
    if remaining < frame / 10 {
        remaining + frame
    } else {
        remaining
    }
}

#[cfg(test)]
#[path = "frame_tests.rs"]
mod tests;
