//! Integer hashing and periodic value noise.
//!
//! Every lattice period is a whole number of cells, so a pattern shifted by exactly one period
//! lands back on itself. That is what lets the background loop with no seam.

/// Hashes a lattice point and seed to a value in `[0, 1)`.
pub fn hash(x: i32, y: i32, seed: i32) -> f64 {
    let mut h = (x as u32).wrapping_mul(374_761_393)
        ^ (y as u32).wrapping_mul(668_265_263)
        ^ (seed as u32).wrapping_mul(2_246_822_519);
    h = (h ^ (h >> 13)).wrapping_mul(1_274_126_177);
    h ^= h >> 16;
    f64::from(h) / 4_294_967_296.0
}

/// Smoothstep clamped to `[0, 1]`.
pub fn smooth(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn value_noise(x: f64, y: f64, period_x: i32, period_y: i32, seed: i32) -> f64 {
    let (floor_x, floor_y) = (x.floor(), y.floor());
    let (fx, fy) = (x - floor_x, y - floor_y);
    let u = fx * fx * (3.0 - 2.0 * fx);
    let v = fy * fy * (3.0 - 2.0 * fy);
    let (cell_x, cell_y) = (floor_x as i32, floor_y as i32);
    let (x0, x1) = (
        cell_x.rem_euclid(period_x),
        (cell_x + 1).rem_euclid(period_x),
    );
    let (y0, y1) = (
        cell_y.rem_euclid(period_y),
        (cell_y + 1).rem_euclid(period_y),
    );
    let (a, b) = (hash(x0, y0, seed), hash(x1, y0, seed));
    let (c, d) = (hash(x0, y1, seed), hash(x1, y1, seed));
    a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/// Fractal value noise in `[0, 1]` that repeats every `period_x` by `period_y` base cells.
pub fn fbm(x: f64, y: f64, period_x: i32, period_y: i32, seed: i32, octaves: u32) -> f64 {
    let (mut sum, mut amplitude, mut norm) = (0.0, 0.5, 0.0);
    for octave in 0..octaves {
        let scale = 1_i32 << octave;
        let f = f64::from(scale);
        sum += amplitude
            * value_noise(
                x * f,
                y * f,
                period_x * scale,
                period_y * scale,
                seed + octave as i32 * 17,
            );
        norm += amplitude;
        amplitude *= 0.5;
    }
    sum / norm
}

#[cfg(test)]
#[path = "noise_tests.rs"]
mod tests;
