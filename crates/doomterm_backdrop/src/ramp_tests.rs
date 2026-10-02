use super::*;

#[test]
fn ramp_hits_its_end_stops() {
    let colors = ramp(&[(0.0, rgb(0x000000)), (1.0, rgb(0xff8040))], 5);
    assert_eq!(colors.len(), 5);
    assert_eq!(colors[0], [0, 0, 0]);
    assert_eq!(colors[4], [0xff, 0x80, 0x40]);
}

#[test]
fn ramp_passes_through_an_interior_stop() {
    let colors = ramp(
        &[
            (0.0, rgb(0x000000)),
            (0.5, rgb(0x640000)),
            (1.0, rgb(0xc80000)),
        ],
        3,
    );
    assert_eq!(colors[1], [0x64, 0, 0]);
}

#[test]
fn pick_clamps_to_the_ramp() {
    assert_eq!(pick(-5.0, 10, 0, 0), 0);
    assert_eq!(pick(5.0, 10, 3, 3), 9);
}

#[test]
fn pick_dithers_a_midtone_across_neighbouring_pixels() {
    let mut seen = std::collections::BTreeSet::new();
    for y in 0..4 {
        for x in 0..4 {
            seen.insert(pick(0.5, 10, x, y));
        }
    }
    assert!(seen.len() >= 2, "no dithering: {seen:?}");
}
