//! Pixel operations and deterministic rasterization for the Doom Term status plate.

use serde::{Deserialize, Serialize};

use crate::glyph::{get_big_glyph, get_sm_glyph, sm_renderable};
use crate::spec::{
    truncate_left, truncate_right, PlateSpec, ADV_BIG, ADV_SM, BIG_Y, DIFF_WELL_W, LABEL_TEXT_Y,
    ROW_Y, WAITING_MIN_W, WAITING_ROWS_PER_COL, WAIT_COUNT_Y, WELL_H, WELL_Y,
};
use crate::state::{PlateState, WaitStatus};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PixelOp {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl PixelOp {
    pub fn new(x: u32, y: u32, width: u32, height: u32, color: (u8, u8, u8)) -> Self {
        Self {
            x,
            y,
            width,
            height,
            r: color.0,
            g: color.1,
            b: color.2,
            a: 255,
        }
    }

    pub fn scaled(&self, factor: u32) -> Self {
        Self {
            x: self.x * factor,
            y: self.y * factor,
            width: self.width * factor,
            height: self.height * factor,
            r: self.r,
            g: self.g,
            b: self.b,
            a: self.a,
        }
    }
}

pub fn scale_ops(ops: &[PixelOp], factor: u32) -> Vec<PixelOp> {
    ops.iter().map(|op| op.scaled(factor)).collect()
}

pub mod colors {
    pub const STONE: [(u8, u8, u8); 8] = [
        (0x50, 0x51, 0x50),
        (0x59, 0x5a, 0x58),
        (0x45, 0x46, 0x45),
        (0x61, 0x62, 0x60),
        (0x53, 0x54, 0x52),
        (0x4b, 0x4c, 0x4a),
        (0x5d, 0x5e, 0x5c),
        (0x40, 0x41, 0x40),
    ];
    pub const STONE_CRACK: (u8, u8, u8) = (0x39, 0x3a, 0x39);
    pub const BEVEL_HI: (u8, u8, u8) = (0xa2, 0xa2, 0x9f);
    pub const BEVEL_HI_SIDE: (u8, u8, u8) = (0x9a, 0x9a, 0x97);
    pub const BEVEL_LO: (u8, u8, u8) = (0x2f, 0x2f, 0x2e);
    pub const BEVEL_LO_SIDE: (u8, u8, u8) = (0x3a, 0x3a, 0x39);
    pub const WELL_DARK: (u8, u8, u8) = (0x17, 0x17, 0x16);
    pub const WELL_LIGHT: (u8, u8, u8) = (0x8e, 0x8e, 0x8b);
    pub const WELL_FLOOR: (u8, u8, u8) = (0x24, 0x24, 0x23);
    pub const PANEL_FLOOR: (u8, u8, u8) = (0x2b, 0x2b, 0x2a);
    pub const MARK_FLOOR: (u8, u8, u8) = (0x23, 0x23, 0x23);
    pub const GROOVE_DARK: (u8, u8, u8) = (0x1c, 0x1c, 0x1b);
    pub const GROOVE_LIGHT: (u8, u8, u8) = (0x8e, 0x8e, 0x8b);
    pub const NUM_HI: (u8, u8, u8) = (0xf0, 0x1a, 0x12);
    pub const NUM_MID: (u8, u8, u8) = (0xd4, 0x0b, 0x06);
    pub const NUM_LO: (u8, u8, u8) = (0xa8, 0x06, 0x03);
    pub const NUM_SHADOW: (u8, u8, u8) = (0x3a, 0x04, 0x02);
    pub const TAN: (u8, u8, u8) = (0xc8, 0xbb, 0x9c);
    pub const TAN_DIM: (u8, u8, u8) = (0x8f, 0x86, 0x72);
    pub const VALUE: (u8, u8, u8) = (0xe8, 0xdc, 0xbc);
    pub const ST_LIVE: (u8, u8, u8) = (0xe0, 0xa9, 0x2c);
    pub const AMMO_LABEL: (u8, u8, u8) = (0xec, 0xe7, 0xda);
    pub const AMMO_VALUE: (u8, u8, u8) = (0xff, 0xe5, 0x79);
    pub const ST_FAIL: (u8, u8, u8) = (0xef, 0x41, 0x36);
    pub const ST_WAIT: (u8, u8, u8) = (0x5b, 0x8a, 0xe8);
    pub const ST_IDLE: (u8, u8, u8) = (0x84, 0x7c, 0x6e);
    pub const CARD_BLUE: (u8, u8, u8) = (0x3a, 0x6f, 0xd8);
    pub const CARD_GOLD: (u8, u8, u8) = (0xe0, 0xc0, 0x20);
    pub const CARD_RED: (u8, u8, u8) = (0xc0, 0x2a, 0x22);
    pub const CARD_OFF: (u8, u8, u8) = (0x4a, 0x4a, 0x48);
    pub const CARD_LIP_ON: (u8, u8, u8) = (0xff, 0xff, 0xff);
    pub const CARD_LIP_OFF: (u8, u8, u8) = (0x5e, 0x5e, 0x5c);
    pub const CARD_SHADOW: (u8, u8, u8) = (0x1c, 0x1c, 0x1b);
    pub const RULE: (u8, u8, u8) = (0x4e, 0x4e, 0x4c);
}

pub struct Rasterizer {
    pub ops: Vec<PixelOp>,
}

impl Default for Rasterizer {
    fn default() -> Self {
        Self::new()
    }
}

impl Rasterizer {
    pub fn new() -> Self {
        Self {
            ops: Vec::with_capacity(2048),
        }
    }

    pub fn px(&mut self, x: u32, y: u32, width: u32, height: u32, color: (u8, u8, u8)) {
        self.ops.push(PixelOp::new(x, y, width, height, color));
    }

    pub fn well(&mut self, x: u32, y: u32, w: u32, h: u32, floor: (u8, u8, u8)) {
        self.px(x, y, w, h, floor);
        self.px(x, y, w, 1, colors::WELL_DARK);
        self.px(x, y, 1, h, colors::WELL_DARK);
        self.px(x, y + h.saturating_sub(1), w, 1, colors::WELL_LIGHT);
        self.px(x + w.saturating_sub(1), y, 1, h, colors::WELL_LIGHT);
    }

    pub fn groove(&mut self, x: u32, y: u32, h: u32) {
        self.px(x, y, 1, h, colors::GROOVE_DARK);
        self.px(x + 1, y, 1, h, colors::GROOVE_LIGHT);
    }

    pub fn stone(&mut self, x: u32, y: u32, w: u32, h: u32, beveled: bool) {
        self.px(x, y, w, h, colors::STONE[0]);
        for row in (1..h.saturating_sub(1)).step_by(2) {
            let mut col = 1 + row % 3;
            while col < w.saturating_sub(1) {
                let hash = (col.wrapping_mul(0x9e37_79b9) ^ row.wrapping_mul(0x85eb_ca6b))
                    .wrapping_mul(0xc2b2_ae35);
                let run = (2 + (hash >> 9) % 4).min(w - 1 - col);
                let patch_height = (1 + (hash >> 16) % 2).min(h - 1 - row);
                self.px(
                    x + col,
                    y + row,
                    run,
                    patch_height,
                    colors::STONE[(hash as usize >> 24) % colors::STONE.len()],
                );
                if hash % 17 == 0 && row + 2 < h - 1 {
                    self.px(x + col, y + row, 1, 2, colors::STONE_CRACK);
                }
                col += run + 1 + (hash >> 20) % 3;
            }
        }
        if beveled {
            self.px(x, y, w, 1, colors::BEVEL_HI);
            self.px(x, y, 1, h, colors::BEVEL_HI_SIDE);
            self.px(x, y + h.saturating_sub(1), w, 1, colors::BEVEL_LO);
            self.px(x + w.saturating_sub(1), y, 1, h, colors::BEVEL_LO_SIDE);
        }
    }

    pub fn big_text(&mut self, x: u32, y: u32, text: &str, right_align: bool) -> u32 {
        let chars: Vec<char> = text.chars().collect();
        let total = (chars.len() as u32 * ADV_BIG).saturating_sub(1);
        let sx = if right_align {
            x.saturating_sub(total)
        } else {
            x
        };
        for (i, &ch) in chars.iter().enumerate() {
            if let Some(matrix) = get_big_glyph(ch) {
                let gx = sx + (i as u32) * ADV_BIG;
                // Shadow
                for (r, row) in matrix.iter().enumerate() {
                    for (c, b) in row.chars().enumerate() {
                        if b != '.' {
                            self.px(
                                gx + c as u32 + 1,
                                y + r as u32 + 1,
                                1,
                                1,
                                colors::NUM_SHADOW,
                            );
                        }
                    }
                }
                // Digits tone
                for (r, row) in matrix.iter().enumerate() {
                    let tone = if r < 5 {
                        colors::NUM_HI
                    } else if r < 10 {
                        colors::NUM_MID
                    } else {
                        colors::NUM_LO
                    };
                    for (c, b) in row.chars().enumerate() {
                        if b != '.' {
                            self.px(gx + c as u32, y + r as u32, 1, 1, tone);
                        }
                    }
                }
            }
        }
        total
    }

    pub fn sm_text(
        &mut self,
        x: u32,
        y: u32,
        text: &str,
        color: (u8, u8, u8),
        right_align: bool,
    ) -> u32 {
        let chars: Vec<char> = text.chars().collect();
        let total = (chars.len() as u32 * ADV_SM).saturating_sub(1);
        let sx = if right_align {
            x.saturating_sub(total)
        } else {
            x
        };
        for (i, &ch) in chars.iter().enumerate() {
            if let Some(matrix) = get_sm_glyph(ch) {
                let gx = sx + (i as u32) * ADV_SM;
                for (r, row) in matrix.iter().enumerate() {
                    for (c, b) in row.chars().enumerate() {
                        if b != '.' {
                            self.px(gx + c as u32, y + r as u32, 1, 1, color);
                        }
                    }
                }
            }
        }
        total
    }
}

pub mod agent_colors {
    pub const CLAUDE: (u8, u8, u8) = (0xe0, 0x8a, 0x63);
    pub const CODEX: (u8, u8, u8) = (0xe6, 0xe6, 0xe6);
    pub const GEMINI: (u8, u8, u8) = (0x8a, 0xb6, 0xff);
    pub const ANTIGRAVITY: (u8, u8, u8) = (0xd8, 0xec, 0xff);
    pub const AGY: (u8, u8, u8) = (0xd8, 0xec, 0xff);
    pub const AIDER: (u8, u8, u8) = (0xd8, 0xb4, 0x5f);
    pub const OPENCODE: (u8, u8, u8) = (0x8f, 0xd4, 0xa0);
    pub const GROK: (u8, u8, u8) = (0xe6, 0xe6, 0xe6);
    pub const COPILOT: (u8, u8, u8) = (0xc8, 0xb4, 0xff);
    pub const SHELL: (u8, u8, u8) = (0xc8, 0xbb, 0x9c);
}

pub fn mix_color(from: (u8, u8, u8), to: (u8, u8, u8), t: f32) -> (u8, u8, u8) {
    let k = t.clamp(0.0, 1.0);
    let r = (from.0 as f32 + (to.0 as f32 - from.0 as f32) * k).round() as u8;
    let g = (from.1 as f32 + (to.1 as f32 - from.1 as f32) * k).round() as u8;
    let b = (from.2 as f32 + (to.2 as f32 - from.2 as f32) * k).round() as u8;
    (r, g, b)
}

pub fn get_agent_color(agent_key: &str) -> (u8, u8, u8) {
    match agent_key.to_ascii_lowercase().as_str() {
        "claude" => agent_colors::CLAUDE,
        "codex" => agent_colors::CODEX,
        "gemini" => agent_colors::GEMINI,
        "antigravity" | "agy" => agent_colors::ANTIGRAVITY,
        "aider" => agent_colors::AIDER,
        "opencode" => agent_colors::OPENCODE,
        "grok" => agent_colors::GROK,
        "copilot" => agent_colors::COPILOT,
        _ => agent_colors::SHELL,
    }
}

pub fn mark_tones(agent_key: &str, phase: f32, is_busy: bool) -> ((u8, u8, u8), (u8, u8, u8)) {
    let base = get_agent_color(agent_key);
    if !is_busy {
        (base, mix_color(base, (0, 0, 0), 0.45))
    } else {
        let glow = (1.0 - (phase * std::f32::consts::PI * 2.0).cos()) / 2.0;
        let core = if glow > 0.5 {
            mix_color(base, (255, 255, 255), (glow - 0.5) * 1.1)
        } else {
            mix_color(base, (0, 0, 0), (0.5 - glow) * 0.7)
        };
        let dim = mix_color(base, (0, 0, 0), 0.5 - glow * 0.25);
        (core, dim)
    }
}

fn safe_px(r: &mut Rasterizer, x: i32, y: i32, w: u32, h: u32, col: (u8, u8, u8)) {
    if x >= 0 && y >= 0 {
        r.px(x as u32, y as u32, w, h, col);
    }
}

pub fn shock_ring(
    r: &mut Rasterizer,
    cx: u32,
    cy: u32,
    phase: f32,
    base: (u8, u8, u8),
    clip: [u32; 4],
) {
    let rad = 3.0 + phase * 10.0;
    let fade = 1.0 - phase;
    if fade <= 0.02 {
        return;
    }
    let col = mix_color(colors::MARK_FLOOR, base, fade * 0.85);
    let steps = (rad * 6.0).round().max(12.0) as usize;
    for i in 0..steps {
        let a = (i as f32 / steps as f32) * std::f32::consts::PI * 2.0;
        let x = (cx as f32 + a.cos() * rad).round() as i32;
        let y = (cy as f32 + a.sin() * rad * 0.92).round() as i32;
        if x >= clip[0] as i32 && x <= clip[1] as i32 && y >= clip[2] as i32 && y <= clip[3] as i32
        {
            r.px(x as u32, y as u32, 1, 1, col);
        }
    }
}

pub fn draw_agent_mark(
    r: &mut Rasterizer,
    agent_key: &str,
    cx: u32,
    cy: u32,
    phase: f32,
    is_busy: bool,
) {
    let (col, dim) = mark_tones(agent_key, phase, is_busy);
    let key = agent_key.to_ascii_lowercase();
    match key.as_str() {
        "claude" => {
            for i in 0..12 {
                let a = (i as f32 / 12.0) * std::f32::consts::PI * 2.0;
                for rad in 2..=9 {
                    let wgt = if rad < 7 { 2 } else { 1 };
                    let col_use = if rad < 7 { col } else { dim };
                    let x = (cx as f32 + a.cos() * (rad as f32)).round() as i32;
                    let y = (cy as f32 + a.sin() * (rad as f32) * 0.92).round() as i32;
                    safe_px(r, x, y, wgt, wgt, col_use);
                }
            }
            safe_px(r, cx as i32 - 1, cy as i32 - 1, 3, 3, col);
        }
        "antigravity" | "agy" => {
            let tones = [col, mix_color(col, dim, 0.45), dim];
            for (i, &tone) in tones.iter().enumerate() {
                let top = (cy as i32) - 9 + (i as i32) * 7;
                let wdt = 4 + (i as i32) * 3;
                for row in 0..5 {
                    let span = (wdt - row).max(1);
                    safe_px(r, (cx as i32) - span, top + row, (span * 2) as u32, 1, tone);
                }
            }
        }
        "aider" => {
            for i in 0..5 {
                safe_px(r, (cx as i32) - 8 + i, (cy as i32) - 5 + i, 2, 2, col);
                safe_px(r, (cx as i32) - 8 + i, (cy as i32) + 5 - i, 2, 2, col);
                safe_px(r, (cx as i32) + 7 - i, (cy as i32) - 5 + i, 2, 2, col);
                safe_px(r, (cx as i32) + 7 - i, (cy as i32) + 5 - i, 2, 2, col);
            }
            safe_px(r, (cx as i32) - 1, (cy as i32) - 1, 3, 3, dim);
        }
        "gemini" => {
            for d in 0..=10 {
                let wgt = ((10.0 - d as f32) / 2.4).round().max(1.0) as u32;
                let half_w = (wgt / 2) as i32;
                safe_px(r, (cx as i32) - half_w, (cy as i32) - d, wgt, 1, col);
                safe_px(r, (cx as i32) - half_w, (cy as i32) + d, wgt, 1, col);
                safe_px(r, (cx as i32) - d, (cy as i32) - half_w, 1, wgt, col);
                safe_px(r, (cx as i32) + d, (cy as i32) - half_w, 1, wgt, col);
            }
        }
        "codex" => {
            safe_px(r, (cx as i32) - 7, (cy as i32) - 7, 14, 2, col);
            safe_px(r, (cx as i32) - 7, (cy as i32) + 5, 14, 2, col);
            safe_px(r, (cx as i32) - 7, (cy as i32) - 7, 2, 14, col);
            safe_px(r, (cx as i32) + 5, (cy as i32) - 7, 2, 14, col);
            safe_px(r, (cx as i32) - 2, (cy as i32) - 3, 2, 6, col);
            safe_px(r, cx as i32, (cy as i32) - 1, 2, 2, col);
        }
        "opencode" => {
            // Left curly brace
            safe_px(r, (cx as i32) - 6, (cy as i32) - 6, 4, 1, col);
            safe_px(r, (cx as i32) - 6, (cy as i32) - 5, 2, 4, col);
            safe_px(r, (cx as i32) - 8, (cy as i32) - 1, 2, 2, col);
            safe_px(r, (cx as i32) - 6, (cy as i32) + 1, 2, 4, col);
            safe_px(r, (cx as i32) - 6, (cy as i32) + 5, 4, 1, col);

            // Right curly brace
            safe_px(r, (cx as i32) + 2, (cy as i32) - 6, 4, 1, col);
            safe_px(r, (cx as i32) + 4, (cy as i32) - 5, 2, 4, col);
            safe_px(r, (cx as i32) + 6, (cy as i32) - 1, 2, 2, col);
            safe_px(r, (cx as i32) + 4, (cy as i32) + 1, 2, 4, col);
            safe_px(r, (cx as i32) + 2, (cy as i32) + 5, 4, 1, col);
        }
        "copilot" => {
            for i in 0..7 {
                safe_px(r, (cx as i32) - i - 1, (cy as i32) + i - 3, 2, 2, col);
                safe_px(r, (cx as i32) + i, (cy as i32) + i - 3, 2, 2, col);
            }
            safe_px(r, (cx as i32) - 4, (cy as i32) - 1, 8, 2, dim);
        }
        "grok" => {
            for i in -5..=5 {
                safe_px(r, (cx as i32) + i - 1, (cy as i32) + i, 2, 2, col);
                safe_px(r, (cx as i32) - i - 1, (cy as i32) + i, 2, 2, col);
            }
            safe_px(r, (cx as i32) - 2, (cy as i32) - 2, 4, 4, dim);
        }
        "remote" => {
            // Two linked screens: the local pane and the host it is driving.
            for (dx, dy) in [(-9, -7), (1, 1)] {
                let (x, y) = (cx as i32 + dx, cy as i32 + dy);
                safe_px(r, x, y, 9, 1, col);
                safe_px(r, x, y + 6, 9, 1, col);
                safe_px(r, x, y, 1, 7, col);
                safe_px(r, x + 8, y, 1, 7, col);
            }
            safe_px(r, cx as i32 - 1, cy as i32 - 1, 2, 2, dim);
            safe_px(r, cx as i32 - 3, cy as i32 - 1, 2, 1, dim);
            safe_px(r, cx as i32 + 1, cy as i32, 2, 1, dim);
        }
        _ => {
            // Prompt chevron and caret (shell / terminal / fallback)
            for i in 0..5 {
                safe_px(r, (cx as i32) - 7 + i, (cy as i32) - 5 + i, 2, 2, col);
                safe_px(r, (cx as i32) - 7 + i, (cy as i32) + 5 - i, 2, 2, col);
            }
            safe_px(r, (cx as i32) + 1, (cy as i32) + 5, 7, 2, dim);
        }
    }
}

/// Uppercases `text` and drops characters the small font cannot draw.
pub fn plate_text(text: &str) -> String {
    let upper: String = text.chars().flat_map(char::to_uppercase).collect();
    let kept: String = upper
        .chars()
        .map(|c| if c.is_whitespace() { ' ' } else { c })
        .filter(|&c| sm_renderable(c))
        .collect();
    kept.split(' ')
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Formats a signed line count for the DIFF well, capped to six characters.
fn diff_count(sign: char, n: u32) -> String {
    if n == 0 {
        "0".into()
    } else if n > 99_999 {
        format!("{sign}99999")
    } else {
        format!("{sign}{n}")
    }
}

/// Paints the entire status plate into an ordered stream of `PixelOp` rectangles.
pub fn paint(spec: &PlateSpec, state: &PlateState) -> Vec<PixelOp> {
    let mut r = Rasterizer::new();

    // 1. Base chassis
    r.stone(0, 0, spec.width, spec.height, true);

    // 2. CONTEXT / USAGE meters.
    let meter = |p: Option<f32>| {
        p.map(|v| format!("{}%", (v.clamp(0.0, 1.0) * 100.0).round() as i32))
            .unwrap_or_else(|| "--".into())
    };
    for ((left, right), value, label) in [
        (spec.context_col, meter(state.context), "CONTEXT"),
        (spec.usage_col, meter(state.usage), "USAGE"),
    ] {
        r.big_text(right - 3, BIG_Y, &value, true);
        let label_w = label.chars().count() as u32 * ADV_SM - 1;
        let label_x = left + (right - left).saturating_sub(label_w) / 2;
        r.sm_text(
            label_x + 1,
            LABEL_TEXT_Y + 1,
            label,
            colors::STONE_CRACK,
            false,
        );
        r.sm_text(label_x, LABEL_TEXT_Y, label, colors::AMMO_LABEL, false);
    }

    // 3. Middle panel: mark, then NAME / PATH / BRANCH.
    r.well(
        spec.panel_x,
        WELL_Y,
        spec.panel_w,
        WELL_H,
        colors::PANEL_FLOOR,
    );
    r.well(spec.mark_x, WELL_Y, spec.mark_w, WELL_H, colors::MARK_FLOOR);

    let mark_cx = spec.mark_x + spec.mark_w / 2;
    let mark_cy = spec.mark_cy();
    if state.working {
        shock_ring(
            &mut r,
            mark_cx,
            mark_cy,
            state.phase,
            get_agent_color(&state.agent),
            [
                spec.mark_x + 1,
                spec.mark_x + spec.mark_w - 2,
                WELL_Y + 1,
                WELL_Y + WELL_H - 2,
            ],
        );
    }
    draw_agent_mark(
        &mut r,
        &state.agent,
        mark_cx,
        mark_cy,
        state.phase,
        state.working,
    );
    r.groove(spec.groove_x, WELL_Y, WELL_H);

    let chars = spec.value_chars as usize;
    let field = |v: &Option<String>| v.as_deref().map(plate_text).filter(|t| !t.is_empty());
    let name = field(&state.name).map_or_else(|| "--".into(), |t| truncate_right(&t, chars));
    let path = field(&state.path).map_or_else(|| "--".into(), |t| truncate_left(&t, chars));
    let branch = field(&state.branch).map_or_else(|| "--".into(), |t| truncate_right(&t, chars));

    for ((label, value), y) in [
        (state.kind.label(), name),
        ("PATH", path),
        ("BRANCH", branch),
    ]
    .into_iter()
    .zip(ROW_Y)
    {
        r.sm_text(spec.label_x, y, label, colors::TAN, false);
        r.sm_text(spec.value_x, y, &value, colors::VALUE, false);
    }

    // 4. Elastic waiting well: count of sessions waiting on the user, then their rows.
    if spec.zone_width >= WAITING_MIN_W {
        r.well(
            spec.zone_x,
            WELL_Y,
            spec.zone_width,
            WELL_H,
            colors::WELL_FLOOR,
        );
        r.sm_text(spec.zone_x + 4, ROW_Y[0], "WAITING", colors::TAN, false);
        let wait_count = state
            .waiting
            .iter()
            .filter(|w| w.status != WaitStatus::Working)
            .count()
            .min(99);
        r.big_text(
            spec.zone_x + 45,
            WAIT_COUNT_Y,
            &wait_count.to_string(),
            true,
        );

        let cols = spec.waiting_columns();
        if cols > 0 {
            r.groove(spec.zone_x + 52, ROW_Y[0], WELL_H - 6);
            if let Some(div_x) = spec.waiting_divider_x() {
                r.groove(div_x, ROW_Y[0], WELL_H - 6);
            }

            let max_rows = cols * (WAITING_ROWS_PER_COL as usize);
            for (idx, item) in state.waiting.iter().take(max_rows).enumerate() {
                let Some(row) = spec.waiting_row_box(idx) else {
                    continue;
                };
                r.sm_text(row.x, row.y, &plate_text(&item.n), colors::TAN, false);
                let name = truncate_right(&plate_text(&item.name), row.name_room);
                r.sm_text(row.name_x, row.y, &name, colors::VALUE, false);
            }
        }
    }

    // 5. DIFF table: uncommitted changes in the pane's repository, laid out like the STBAR's
    // right-hand tally table.
    if let Some(diff_x) = spec.diff_x {
        let value_right = diff_x + DIFF_WELL_W - 4;
        let rows = match state.diff {
            Some(d) => [
                diff_count('+', d.added),
                diff_count('-', d.removed),
                d.files.min(99_999).to_string(),
            ],
            None => ["--".into(), "--".into(), "--".into()],
        };
        for ((label, value), y) in ["ADD", "DEL", "FILES"].into_iter().zip(rows).zip(ROW_Y) {
            r.sm_text(diff_x + 4, y, label, colors::AMMO_LABEL, false);
            r.sm_text(value_right, y, &value, colors::AMMO_VALUE, true);
        }
    }

    r.ops
}

/// WCAG relative luminance of an sRGB colour.
pub fn relative_luminance(c: (u8, u8, u8)) -> f64 {
    let channel = |v: u8| {
        let s = v as f64 / 255.0;
        if s <= 0.03928 {
            s / 12.92
        } else {
            ((s + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * channel(c.0) + 0.7152 * channel(c.1) + 0.0722 * channel(c.2)
}

/// WCAG contrast ratio between two colours, from 1.0 to 21.0.
pub fn contrast_ratio(a: (u8, u8, u8), b: (u8, u8, u8)) -> f64 {
    let (la, lb) = (relative_luminance(a), relative_luminance(b));
    let (hi, lo) = if la > lb { (la, lb) } else { (lb, la) };
    (hi + 0.05) / (lo + 0.05)
}

/// Renders a list of `PixelOp`s onto an RGBA8 buffer of size `width * height * 4`.
pub fn render_to_rgba(width: u32, height: u32, ops: &[PixelOp]) -> Vec<u8> {
    let mut buf = vec![0u8; (width * height * 4) as usize];
    for op in ops {
        for dy in 0..op.height {
            let py = op.y + dy;
            if py >= height {
                continue;
            }
            for dx in 0..op.width {
                let px = op.x + dx;
                if px >= width {
                    continue;
                }
                let idx = ((py * width + px) * 4) as usize;
                buf[idx] = op.r;
                buf[idx + 1] = op.g;
                buf[idx + 2] = op.b;
                buf[idx + 3] = op.a;
            }
        }
    }
    buf
}

/// Exports an RGBA buffer to a portable pixmap (PPM P6) format.
pub fn export_ppm(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
    let header = format!("P6\n{} {}\n255\n", width, height);
    let mut out = Vec::with_capacity(header.len() + (width * height * 3) as usize);
    out.extend_from_slice(header.as_bytes());
    for chunk in rgba.as_chunks::<4>().0 {
        out.extend_from_slice(&chunk[..3]);
    }
    out
}

#[cfg(test)]
#[path = "paint_tests.rs"]
mod tests;
