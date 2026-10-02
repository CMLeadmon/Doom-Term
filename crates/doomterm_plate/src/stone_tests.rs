use super::*;
use crate::paint::colors;

const WINE: (u8, u8, u8) = (0x49, 0x12, 0x1f);

fn lightness((r, g, b): (u8, u8, u8)) -> f64 {
    let (max, min) = (r.max(g).max(b), r.min(g).min(b));
    (f64::from(max) + f64::from(min)) / 510.0
}

#[test]
fn the_default_palette_is_the_grey_stone_the_plate_has_always_used() {
    let stone = StoneTones::default();

    assert_eq!(stone.tones, colors::STONE);
    assert_eq!(stone.crack, colors::STONE_CRACK);
}

#[test]
fn the_key_becomes_the_first_stone_tone() {
    assert_eq!(StoneTones::tinted(WINE).tones[0], WINE);
}

#[test]
fn a_wine_key_recolours_every_tone_and_the_crack() {
    let stone = StoneTones::tinted(WINE);

    assert_eq!(
        stone.tones,
        [
            (0x49, 0x12, 0x1f),
            (0x52, 0x14, 0x23),
            (0x3e, 0x0f, 0x1a),
            (0x5a, 0x16, 0x26),
            (0x4c, 0x13, 0x20),
            (0x43, 0x11, 0x1d),
            (0x56, 0x15, 0x24),
            (0x39, 0x0e, 0x18),
        ]
    );
    assert_eq!(stone.crack, (0x32, 0x0c, 0x15));
}

#[test]
fn tinting_keeps_the_lightest_and_darkest_tones_in_place() {
    let stone = StoneTones::tinted(WINE);

    // Grey STONE[3] is the lightest tone and STONE[7] the darkest; the crack is darker still.
    assert!(lightness(stone.tones[3]) > lightness(stone.tones[0]));
    assert!(lightness(stone.tones[0]) > lightness(stone.tones[7]));
    assert!(lightness(stone.tones[7]) > lightness(stone.crack));
}

#[test]
fn a_black_or_white_key_clamps_instead_of_overflowing() {
    let white = StoneTones::tinted((255, 255, 255));
    let black = StoneTones::tinted((0, 0, 0));

    assert_eq!(white.tones[0], (255, 255, 255));
    assert_eq!(
        white.tones[3],
        (255, 255, 255),
        "lighter than the key, so clamped to white"
    );
    assert_eq!(black.tones[0], (0, 0, 0));
    assert_eq!(
        black.tones[7],
        (0, 0, 0),
        "darker than the key, so clamped to black"
    );
}
