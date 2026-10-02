//! The committed GIF: its shape, its memory budget, and that it still matches the generator.

use std::fs;
use std::path::PathBuf;

use doomterm_backdrop::{decode_gif, render_frame, DELAY_CS, FRAMES, HEIGHT, WIDTH};

const BAKE_HINT: &str = "bake it with: cargo run --release -p doomterm_backdrop --example \
                         bake_redsky -- themes/redsky/redsky.gif";

fn asset() -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../themes/redsky/redsky.gif");
    fs::read(&path).unwrap_or_else(|err| panic!("{}: {err}; {BAKE_HINT}", path.display()))
}

#[test]
fn the_baked_gif_has_the_agreed_shape() {
    let gif = decode_gif(&asset()).unwrap();
    assert_eq!((gif.width, gif.height), (WIDTH, HEIGHT));
    assert_eq!(gif.frames.len(), FRAMES as usize);
    assert!(gif.delays_cs.iter().all(|&delay| delay == DELAY_CS));
}

#[test]
fn the_baked_gif_stays_inside_the_budget() {
    let bytes = asset();
    assert!(
        bytes.len() <= 3 * 1024 * 1024,
        "{} bytes on disk",
        bytes.len()
    );
    let decoded = u64::from(WIDTH) * u64::from(HEIGHT) * 4 * u64::from(FRAMES);
    assert!(decoded <= 60 * 1024 * 1024, "{decoded} bytes decoded");
}

#[test]
fn sampled_baked_frames_match_a_fresh_render() {
    let gif = decode_gif(&asset()).unwrap();
    for frame in [0, 14, 28, 45, 70, 99] {
        let fresh = render_frame(frame, WIDTH, HEIGHT);
        let baked = &gif.frames[frame as usize];
        let differing = fresh
            .as_chunks::<4>()
            .0
            .iter()
            .zip(baked.as_chunks::<4>().0)
            .filter(|(a, b)| a != b)
            .count();
        let total = (WIDTH * HEIGHT) as usize;
        assert!(
            differing * 1000 <= total,
            "frame {frame}: {differing} of {total} pixels differ"
        );
    }
}
