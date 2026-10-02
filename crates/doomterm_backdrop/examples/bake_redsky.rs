//! Bakes the Redsky loop to a GIF.
//!
//! `cargo run --release -p doomterm_backdrop --example bake_redsky -- themes/redsky/redsky.gif`

use std::path::PathBuf;

use doomterm_backdrop::{encode_gif, render_frame, DELAY_CS, FRAMES, HEIGHT, WIDTH};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let out = PathBuf::from(
        std::env::args()
            .nth(1)
            .unwrap_or_else(|| "redsky.gif".into()),
    );
    let frames: Vec<Vec<u8>> = (0..FRAMES)
        .map(|f| render_frame(f, WIDTH, HEIGHT))
        .collect();
    let bytes = encode_gif(&frames, WIDTH, HEIGHT, DELAY_CS)?;
    std::fs::write(&out, &bytes)?;
    println!(
        "{}: {FRAMES} frames, {WIDTH}x{HEIGHT}, {} bytes",
        out.display(),
        bytes.len()
    );
    Ok(())
}
