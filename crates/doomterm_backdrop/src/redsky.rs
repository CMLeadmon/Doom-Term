//! The Redsky frame generator: a black sun behind drifting storm clouds, three skyline layers
//! panning at 1x, 2x and 3x, and two lightning strikes. Every time-dependent term is periodic
//! in the loop phase, so phase 1.0 reproduces phase 0.0.

use std::f64::consts::TAU;
use std::sync::OnceLock;

use crate::noise::{fbm, hash, smooth};
use crate::ramp::{pick, ramp, rgb, Rgb};
use crate::FRAMES;

const SKY_STEPS: usize = 34;
const HORIZON: f64 = 0.62;
const TOWER_CELLS: i32 = 22;
const BOLTS: [Bolt; 2] = [Bolt { frame: 28, seed: 5 }, Bolt { frame: 70, seed: 9 }];

#[derive(Clone, Copy)]
struct Bolt {
    frame: u32,
    seed: i32,
}

impl Bolt {
    fn phase(self) -> f64 {
        f64::from(self.frame) / f64::from(FRAMES)
    }
}

fn sky_ramp() -> &'static [Rgb] {
    static RAMP: OnceLock<Vec<Rgb>> = OnceLock::new();
    RAMP.get_or_init(|| {
        ramp(
            &[
                (0.0, rgb(0x08020a)),
                (0.3, rgb(0x26040c)),
                (0.55, rgb(0x70100c)),
                (0.78, rgb(0xc4300e)),
                (0.92, rgb(0xf48a22)),
                (1.0, rgb(0xffd47e)),
            ],
            SKY_STEPS,
        )
    })
}

struct Canvas {
    rgba: Vec<u8>,
    width: i32,
    height: i32,
}

impl Canvas {
    fn new(width: i32, height: i32) -> Self {
        Self {
            rgba: vec![0; (width * height * 4) as usize],
            width,
            height,
        }
    }

    fn offset(&self, x: i32, y: i32) -> Option<usize> {
        if x < 0 || y < 0 || x >= self.width || y >= self.height {
            return None;
        }
        Some(((y * self.width + x) * 4) as usize)
    }

    fn put(&mut self, x: i32, y: i32, color: [f64; 3]) {
        if let Some(o) = self.offset(x, y) {
            for (i, channel) in color.iter().enumerate() {
                self.rgba[o + i] = channel.clamp(0.0, 255.0).round() as u8;
            }
            self.rgba[o + 3] = 255;
        }
    }

    fn blend(&mut self, x: i32, y: i32, color: [f64; 3], alpha: f64) {
        if let Some(o) = self.offset(x, y) {
            for (i, channel) in color.iter().enumerate() {
                let current = f64::from(self.rgba[o + i]);
                self.rgba[o + i] = (current + (channel - current) * alpha).round() as u8;
            }
        }
    }
}

fn flash_at(phase: f64) -> f64 {
    BOLTS
        .iter()
        .map(|bolt| {
            let distance = (phase - bolt.phase()).abs();
            let distance = distance.min(1.0 - distance);
            (-(distance / 0.014).powi(2)).exp()
                + 0.5 * (-((phase - bolt.phase() - 0.032) / 0.011).powi(2)).exp()
        })
        .fold(0.0, f64::max)
}

fn draw_bolt(canvas: &mut Canvas, seed: i32, y_end: f64, k: f64) {
    let width = f64::from(canvas.width);
    let mut x = hash(seed, 1, 3) * width * 0.5 + width * 0.15;
    let mut branches: Vec<(f64, i32, f64)> = Vec::new();
    let mut y = 0;
    while f64::from(y) < y_end {
        x += (hash(seed, y, 31) - 0.5) * 3.2;
        let column = x.round() as i32;
        canvas.blend(column - 1, y, [255.0, 214.0, 200.0], 0.35);
        canvas.blend(column + 1, y, [255.0, 214.0, 200.0], 0.35);
        canvas.put(column, y, [255.0, 246.0, 238.0]);
        if hash(seed, y, 47) > 0.975 && f64::from(y) < y_end * 0.8 {
            let direction = if hash(seed, y, 53) > 0.5 { 1.0 } else { -1.0 };
            branches.push((x, y, direction));
        }
        y += 1;
    }
    for (start_x, start_y, direction) in branches {
        let mut bx = start_x;
        let mut step = 0;
        while f64::from(step) < 14.0 * k {
            bx += direction * (0.7 + hash(seed, start_y + step, 59) * 0.8);
            let by = f64::from(start_y) + f64::from(step) * 0.8;
            canvas.put(bx.round() as i32, by.round() as i32, [255.0, 226.0, 214.0]);
            step += 1;
        }
    }
}

/// Renders loop frame `frame` (taken modulo the loop length) as opaque RGBA.
pub fn render_frame(frame: u32, width: u32, height: u32) -> Vec<u8> {
    render_phase(f64::from(frame % FRAMES) / f64::from(FRAMES), width, height)
}

/// Renders the frame at loop `phase`, where 0.0 and 1.0 are the same instant.
pub fn render_phase(phase: f64, width: u32, height: u32) -> Vec<u8> {
    let (w, h) = (width as i32, height as i32);
    let (wf, hf) = (f64::from(w), f64::from(h));
    let k = hf / 150.0;
    let mut canvas = Canvas::new(w, h);
    let flash = flash_at(phase);
    let sky = sky_ramp();
    let (sun_x, sun_y, sun_r) = (wf * 0.7, hf * (HORIZON - 0.16), hf * 0.12);
    let mid_ground = hf * (HORIZON + 0.1);
    let cells = f64::from(TOWER_CELLS);

    for y in 0..h {
        let yf = f64::from(y);
        let fy = yf / hf;
        for x in 0..w {
            let xf = f64::from(x);
            let nx = xf / wf;

            let mut v = (fy / HORIZON).clamp(0.0, 1.0).powf(1.8) * 0.9;
            let d = (xf - sun_x).hypot(yf - sun_y);
            if d < sun_r {
                v = 0.02;
            } else {
                v += (-((d - sun_r) / (hf * 0.04)).powi(2)).exp()
                    * 0.95
                    * (1.0 + 0.1 * (TAU * 2.0 * phase).sin())
                    + 0.28 * (-(d - sun_r) / (hf * 0.2)).exp();
            }
            let cloud_noise = fbm(nx * 1.6 + phase * 2.0, fy * 3.0, 2, 3, 5, 4);
            let cloud = smooth((cloud_noise - 0.47) * 3.4);
            v = v * (1.0 - 0.88 * cloud)
                + (1.0 - (cloud_noise - 0.47).abs() * 10.0).max(0.0)
                    * 0.32
                    * (1.0 - fy / HORIZON * 0.3);
            v += flash * 0.5 * (1.0 - fy * 0.5);
            v *= 0.3 + 0.7 * smooth((nx - 0.05) / 0.85).powf(1.5);
            let shade = sky[pick(v.clamp(0.0, 1.0), SKY_STEPS, x, y)];
            let mut color = [
                f64::from(shade[0]),
                f64::from(shade[1]),
                f64::from(shade[2]),
            ];

            let ridge = 1.0 - (2.0 * fbm(nx * 6.0 + phase * 6.0, 0.5, 6, 1, 11, 4) - 1.0).abs();
            let top_far = hf * (HORIZON - 0.03 - 0.17 * ridge);
            if yf >= top_far {
                color = if yf - top_far < 1.4 * k {
                    [176.0, 68.0, 26.0]
                } else {
                    let depth = ((yf - top_far) / (hf * 0.4)).clamp(0.0, 1.0);
                    [
                        42.0 + (24.0 - 42.0) * depth,
                        7.0 + (5.0 - 7.0) * depth,
                        9.0 + (8.0 - 9.0) * depth,
                    ]
                };
            }

            let tower_x = nx * cells + phase * cells * 2.0;
            let cell = (tower_x.floor() as i32).rem_euclid(TOWER_CELLS);
            let local = tower_x - tower_x.floor();
            let (mut top_mid, mut height_mid) = (mid_ground, 0.0);
            if hash(cell, 3, 13) < 0.6 && local > 0.18 && local < 0.82 {
                height_mid = (0.07 + 0.2 * hash(cell, 4, 13)) * hf;
                let spire = if hash(cell, 5, 13) < 0.5 {
                    height_mid * 0.55 * (1.0 - (local - 0.5).abs() / 0.12).max(0.0)
                } else {
                    0.0
                };
                top_mid = mid_ground - height_mid - spire;
            }
            if yf >= top_mid {
                color = [18.0, 4.0, 10.0];
                if yf - top_mid < 1.2 * k {
                    color = [122.0, 36.0, 16.0];
                } else if height_mid > 0.0
                    && yf >= mid_ground - height_mid + 2.0 * k
                    && yf < mid_ground - 2.0 * k
                {
                    let column = ((local - 0.18) * (wf / cells)).floor() as i32;
                    if column & 1 == 0
                        && y & 3 == 1
                        && hash(cell * 13 + (column >> 1), y >> 2, 19) < 0.2
                    {
                        let beats = if hash(cell, column, 23) > 0.5 {
                            3.0
                        } else {
                            2.0
                        };
                        let glow = 0.65
                            + 0.35 * (TAU * beats * phase + hash(cell, column, 29) * 6.0).sin();
                        color = [255.0 * glow, 168.0 * glow, 58.0 * glow];
                    }
                }
            }

            let top_near =
                hf * (HORIZON + 0.2 - 0.12 * fbm(nx * 5.0 + phase * 15.0, 0.5, 5, 1, 29, 3));
            if yf >= top_near {
                color = if yf - top_near < 1.2 * k {
                    [90.0, 26.0, 12.0]
                } else {
                    [5.0, 2.0, 3.0]
                };
            }
            canvas.put(x, y, color);
        }
    }

    if flash > 0.3 {
        let nearest = BOLTS
            .iter()
            .copied()
            .min_by(|a, b| {
                (phase - a.phase())
                    .abs()
                    .total_cmp(&(phase - b.phase()).abs())
            })
            .expect("BOLTS is not empty");
        draw_bolt(&mut canvas, nearest.seed, hf * HORIZON * 0.98, k);
    }
    canvas.rgba
}

#[cfg(test)]
#[path = "redsky_tests.rs"]
mod tests;
