//! Doom Term Redsky backdrop: a deterministic, looping pixel background.
//!
//! Pure functions only: no GPU, no clock, and no randomness beyond a fixed integer hash.

pub mod gif_io;
pub mod noise;
pub mod ramp;
pub mod redsky;

pub use gif_io::{decode_gif, encode_gif, DecodedGif, GifError};
pub use redsky::{render_frame, render_phase};

/// Baked frame width in pixels.
pub const WIDTH: u32 = 480;
/// Baked frame height in pixels.
pub const HEIGHT: u32 = 300;
/// Frames in one loop.
pub const FRAMES: u32 = 100;
/// Delay between frames in hundredths of a second, which is 12.5 frames per second.
pub const DELAY_CS: u16 = 8;
