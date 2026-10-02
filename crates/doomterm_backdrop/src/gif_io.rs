//! Lossless GIF encoding and decoding.
//!
//! Each frame carries its own exact palette, so there is no quantiser and the bytes are
//! deterministic. A frame with more than 256 distinct colours is an error, not a downgrade.

use std::collections::HashMap;
use std::fmt;
use std::io::Cursor;

use gif::{ColorOutput, DecodeOptions, Encoder, Frame, Repeat};

#[derive(Debug)]
pub enum GifError {
    TooManyColours { frame: usize },
    SizeMismatch { frame: usize },
    Encode(gif::EncodingError),
    Decode(gif::DecodingError),
}

impl fmt::Display for GifError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GifError::TooManyColours { frame } => {
                write!(f, "frame {frame} has more than 256 colours")
            }
            GifError::SizeMismatch { frame } => {
                write!(f, "frame {frame} is not width x height x 4 bytes")
            }
            GifError::Encode(err) => write!(f, "gif encode failed: {err}"),
            GifError::Decode(err) => write!(f, "gif decode failed: {err}"),
        }
    }
}

impl std::error::Error for GifError {}

impl From<gif::EncodingError> for GifError {
    fn from(err: gif::EncodingError) -> Self {
        GifError::Encode(err)
    }
}

impl From<gif::DecodingError> for GifError {
    fn from(err: gif::DecodingError) -> Self {
        GifError::Decode(err)
    }
}

/// A decoded animation: RGBA frames and each frame's delay in hundredths of a second.
pub struct DecodedGif {
    pub width: u32,
    pub height: u32,
    pub frames: Vec<Vec<u8>>,
    pub delays_cs: Vec<u16>,
}

/// Encodes opaque RGBA frames as a GIF that loops forever.
pub fn encode_gif(
    frames: &[Vec<u8>],
    width: u32,
    height: u32,
    delay_cs: u16,
) -> Result<Vec<u8>, GifError> {
    let mut out = Vec::new();
    {
        let mut encoder = Encoder::new(&mut out, width as u16, height as u16, &[])?;
        encoder.set_repeat(Repeat::Infinite)?;
        for (index, rgba) in frames.iter().enumerate() {
            if rgba.len() != (width * height * 4) as usize {
                return Err(GifError::SizeMismatch { frame: index });
            }
            let mut order: Vec<[u8; 3]> = Vec::new();
            let mut slots: HashMap<[u8; 3], u8> = HashMap::new();
            let mut indices = Vec::with_capacity(rgba.len() / 4);
            for px in rgba.as_chunks::<4>().0.iter() {
                let key = [px[0], px[1], px[2]];
                let slot = match slots.get(&key) {
                    Some(&slot) => slot,
                    None => {
                        if order.len() == 256 {
                            return Err(GifError::TooManyColours { frame: index });
                        }
                        let slot = order.len() as u8;
                        order.push(key);
                        slots.insert(key, slot);
                        slot
                    }
                };
                indices.push(slot);
            }
            let palette: Vec<u8> = order.iter().flatten().copied().collect();
            let mut frame =
                Frame::from_palette_pixels(width as u16, height as u16, indices, palette, None);
            frame.delay = delay_cs;
            encoder.write_frame(&frame)?;
        }
    }
    Ok(out)
}

/// Decodes every frame of a GIF to RGBA.
pub fn decode_gif(bytes: &[u8]) -> Result<DecodedGif, GifError> {
    let mut options = DecodeOptions::new();
    options.set_color_output(ColorOutput::RGBA);
    let mut decoder = options.read_info(Cursor::new(bytes))?;
    let (width, height) = (u32::from(decoder.width()), u32::from(decoder.height()));
    let (mut frames, mut delays_cs) = (Vec::new(), Vec::new());
    while let Some(frame) = decoder.read_next_frame()? {
        frames.push(frame.buffer.to_vec());
        delays_cs.push(frame.delay);
    }
    Ok(DecodedGif {
        width,
        height,
        frames,
        delays_cs,
    })
}

#[cfg(test)]
#[path = "gif_io_tests.rs"]
mod tests;
