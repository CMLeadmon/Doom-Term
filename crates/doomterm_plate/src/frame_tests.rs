use std::time::Duration;

use super::delay_to_next_frame;

const FRAME: Duration = Duration::from_millis(50);

fn ms(n: u64) -> Duration {
    Duration::from_millis(n)
}

#[test]
fn a_frame_that_starts_on_the_grid_waits_a_whole_frame() {
    assert_eq!(delay_to_next_frame(ms(0), FRAME), ms(50));
    assert_eq!(delay_to_next_frame(ms(200), FRAME), ms(50));
}

#[test]
fn a_late_frame_waits_only_until_the_next_grid_line() {
    assert_eq!(delay_to_next_frame(ms(12), FRAME), ms(38));
    assert_eq!(delay_to_next_frame(ms(137), FRAME), ms(13));
}

#[test]
fn a_frame_that_ends_just_before_a_grid_line_skips_to_the_one_after() {
    // Painting again at once would show the same picture twice.
    assert_eq!(delay_to_next_frame(ms(48), FRAME), ms(52));
}

#[test]
fn a_frame_that_took_longer_than_a_frame_still_lands_on_the_grid() {
    assert_eq!(delay_to_next_frame(ms(430), FRAME), ms(20));
}
