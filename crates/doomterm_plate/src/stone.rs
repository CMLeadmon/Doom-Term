//! The palette the plate's stone material is painted from.

use crate::paint::colors;

/// How much of each grey tone's lightness offset from the first tone survives the tint, so a
/// tinted stone keeps the grey stone's patchiness without leaving the key's neighbourhood.
const LIGHTNESS_SPREAD: f64 = 0.63;

/// The nine colours of the plate's stone: eight patch tones and the crack colour.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StoneTones {
    pub tones: [(u8, u8, u8); 8],
    pub crack: (u8, u8, u8),
}

impl Default for StoneTones {
    fn default() -> Self {
        Self {
            tones: colors::STONE,
            crack: colors::STONE_CRACK,
        }
    }
}

impl StoneTones {
    /// The grey stone recoloured to `key`'s hue and saturation. The first tone becomes `key`
    /// itself, and every other tone sits above or below it in lightness as its grey does.
    pub fn tinted(key: (u8, u8, u8)) -> Self {
        let (hue, saturation, key_lightness) = to_hsl(key);
        let base = lightness(colors::STONE[0]);
        let tint = |grey: (u8, u8, u8)| {
            let tone =
                (key_lightness + (lightness(grey) - base) * LIGHTNESS_SPREAD).clamp(0.0, 1.0);
            from_hsl(hue, saturation, tone)
        };
        Self {
            tones: colors::STONE.map(tint),
            crack: tint(colors::STONE_CRACK),
        }
    }
}

fn lightness((r, g, b): (u8, u8, u8)) -> f64 {
    (f64::from(r.max(g).max(b)) + f64::from(r.min(g).min(b))) / 510.0
}

/// Hue in degrees, saturation and lightness in `0.0..=1.0`.
fn to_hsl((r, g, b): (u8, u8, u8)) -> (f64, f64, f64) {
    let (r, g, b) = (
        f64::from(r) / 255.0,
        f64::from(g) / 255.0,
        f64::from(b) / 255.0,
    );
    let (max, min) = (r.max(g).max(b), r.min(g).min(b));
    let lightness = (max + min) / 2.0;
    let delta = max - min;
    if delta == 0.0 {
        return (0.0, 0.0, lightness);
    }
    let saturation = delta / (1.0 - (2.0 * lightness - 1.0).abs());
    let sextant = if max == r {
        ((g - b) / delta).rem_euclid(6.0)
    } else if max == g {
        (b - r) / delta + 2.0
    } else {
        (r - g) / delta + 4.0
    };
    (sextant * 60.0, saturation, lightness)
}

fn from_hsl(hue: f64, saturation: f64, lightness: f64) -> (u8, u8, u8) {
    let chroma = (1.0 - (2.0 * lightness - 1.0).abs()) * saturation;
    let sextant = hue / 60.0;
    let second = chroma * (1.0 - (sextant % 2.0 - 1.0).abs());
    let (r, g, b) = match sextant as u32 {
        0 => (chroma, second, 0.0),
        1 => (second, chroma, 0.0),
        2 => (0.0, chroma, second),
        3 => (0.0, second, chroma),
        4 => (second, 0.0, chroma),
        _ => (chroma, 0.0, second),
    };
    let floor = lightness - chroma / 2.0;
    let channel = |value: f64| ((value + floor) * 255.0).round().clamp(0.0, 255.0) as u8;
    (channel(r), channel(g), channel(b))
}

#[cfg(test)]
#[path = "stone_tests.rs"]
mod tests;
