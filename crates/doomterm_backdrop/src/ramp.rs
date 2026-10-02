//! Colour ramps and ordered dithering, which give the background its indexed-palette look.

pub type Rgb = [u8; 3];

/// Builds an `Rgb` from `0xRRGGBB`.
pub const fn rgb(hex: u32) -> Rgb {
    [(hex >> 16) as u8, (hex >> 8) as u8, hex as u8]
}

const BAYER_4X4: [u8; 16] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/// Samples `steps` evenly spaced colours along piecewise-linear `stops` (position, colour).
pub fn ramp(stops: &[(f64, Rgb)], steps: usize) -> Vec<Rgb> {
    (0..steps)
        .map(|i| {
            let t = i as f64 / (steps - 1) as f64;
            let mut j = 0;
            while j < stops.len() - 2 && t > stops[j + 1].0 {
                j += 1;
            }
            let ((p0, c0), (p1, c1)) = (stops[j], stops[j + 1]);
            let k = ((t - p0) / (p1 - p0)).clamp(0.0, 1.0);
            let mix =
                |a: u8, b: u8| (f64::from(a) + (f64::from(b) - f64::from(a)) * k).round() as u8;
            [mix(c0[0], c1[0]), mix(c0[1], c1[1]), mix(c0[2], c1[2])]
        })
        .collect()
}

/// Quantises `value` in `[0, 1]` to a ramp index, dithered by pixel position.
pub fn pick(value: f64, steps: usize, x: i32, y: i32) -> usize {
    let cell = BAYER_4X4[(((y & 3) << 2) | (x & 3)) as usize];
    let dither = (f64::from(cell) + 0.5) / 16.0 - 0.5;
    let top = (steps - 1) as f64;
    (value * top + dither + 0.5).floor().clamp(0.0, top) as usize
}

#[cfg(test)]
#[path = "ramp_tests.rs"]
mod tests;
