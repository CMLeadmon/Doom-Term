use std::collections::HashSet;

use super::*;
use crate::{HEIGHT, WIDTH};

const SMALL: (u32, u32) = (120, 75);

fn differing_pixels(a: &[u8], b: &[u8]) -> usize {
    a.as_chunks::<4>()
        .0
        .iter()
        .zip(b.as_chunks::<4>().0.iter())
        .filter(|(p, q)| p != q)
        .count()
}

fn luma(pixel: &[u8]) -> f64 {
    0.2126 * f64::from(pixel[0]) + 0.7152 * f64::from(pixel[1]) + 0.0722 * f64::from(pixel[2])
}

fn mean_luma(frame: &[u8], width: u32, columns: std::ops::Range<u32>) -> f64 {
    let rows = frame.len() as u32 / 4 / width;
    let mut sum = 0.0;
    for y in 0..rows {
        for x in columns.clone() {
            let o = ((y * width + x) * 4) as usize;
            sum += luma(&frame[o..o + 4]);
        }
    }
    sum / f64::from(rows * columns.len() as u32)
}

#[test]
fn a_frame_is_opaque_and_the_requested_size() {
    let frame = render_frame(0, SMALL.0, SMALL.1);
    assert_eq!(frame.len(), (SMALL.0 * SMALL.1 * 4) as usize);
    assert!(frame.as_chunks::<4>().0.iter().all(|p| p[3] == 255));
}

#[test]
fn rendering_is_deterministic() {
    assert_eq!(
        render_frame(17, SMALL.0, SMALL.1),
        render_frame(17, SMALL.0, SMALL.1)
    );
}

#[test]
fn the_loop_closes() {
    let start = render_phase(0.0, SMALL.0, SMALL.1);
    let end = render_phase(1.0, SMALL.0, SMALL.1);
    let total = (SMALL.0 * SMALL.1) as usize;
    assert!(
        differing_pixels(&start, &end) * 2000 <= total,
        "{} of {total} pixels differ between phase 0 and phase 1",
        differing_pixels(&start, &end)
    );
}

#[test]
fn consecutive_frames_move() {
    let a = render_frame(0, SMALL.0, SMALL.1);
    let b = render_frame(1, SMALL.0, SMALL.1);
    assert!(differing_pixels(&a, &b) > 0);
}

#[test]
fn lightning_frames_carry_a_bolt_and_calm_frames_do_not() {
    let bright = |frame: &[u8]| {
        frame
            .as_chunks::<4>()
            .0
            .iter()
            .filter(|p| p[0] >= 250 && p[1] >= 240 && p[2] >= 230)
            .count()
    };
    let strike = render_frame(28, 240, 150);
    let calm = render_frame(10, 240, 150);
    assert!(bright(&strike) > 40, "bolt pixels: {}", bright(&strike));
    assert_eq!(bright(&calm), 0);
}

#[test]
fn the_left_side_is_darker_than_the_right_so_text_stays_readable() {
    let frame = render_frame(0, 240, 150);
    let left = mean_luma(&frame, 240, 0..80);
    let right = mean_luma(&frame, 240, 160..240);
    assert!(left < right * 0.6, "left {left:.1}, right {right:.1}");
}

#[test]
fn every_sampled_baked_frame_fits_a_gif_palette() {
    let mut sampled: Vec<u32> = (0..100).step_by(5).collect();
    sampled.extend([27, 28, 29, 30, 69, 70, 71, 72]);
    for frame in sampled {
        let pixels = render_frame(frame, WIDTH, HEIGHT);
        let colours: HashSet<[u8; 3]> = pixels
            .as_chunks::<4>()
            .0
            .iter()
            .map(|p| [p[0], p[1], p[2]])
            .collect();
        assert!(
            colours.len() <= 256,
            "frame {frame} has {} colours",
            colours.len()
        );
    }
}
