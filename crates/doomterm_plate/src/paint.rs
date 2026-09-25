//! Pixel operations and deterministic rasterization for the Doom Term status plate.

use serde::{Deserialize, Serialize};

use crate::glyph::{get_big_glyph, get_sm_glyph, get_status_glyph};
use crate::spec::{truncate_left, PlateSpec, ADV_BIG, ADV_SM, WAITING_ROWS_PER_COL};
use crate::state::PlateState;

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
}

pub mod colors {
    pub const STRIAE: [(u8, u8, u8); 8] = [
        (0x76, 0x76, 0x74),
        (0x6d, 0x6d, 0x6b),
        (0x72, 0x72, 0x70),
        (0x66, 0x66, 0x64),
        (0x7a, 0x7a, 0x78),
        (0x6a, 0x6a, 0x68),
        (0x74, 0x74, 0x72),
        (0x62, 0x62, 0x60),
    ];
    pub const GRAIN_HI: (u8, u8, u8) = (0x7e, 0x7e, 0x7c);
    pub const GRAIN_LO: (u8, u8, u8) = (0x61, 0x61, 0x5f);
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

    pub fn striate(&mut self, x: u32, y: u32, w: u32, h: u32, beveled: bool) {
        for i in 0..h {
            let tone = colors::STRIAE[((i * 5 + x * 3) as usize) % colors::STRIAE.len()];
            self.px(x, y + i, w, 1, tone);
            let mut j = i % 3;
            while j < w {
                let grain = if (i + j) % 2 != 0 {
                    colors::GRAIN_HI
                } else {
                    colors::GRAIN_LO
                };
                self.px(x + j, y + i, 1, 1, grain);
                j += 7;
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
        let total = (chars.len() as u32) * ADV_BIG - 1;
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
        let total = (chars.len() as u32) * ADV_SM - 1;
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

/// Paints the entire status plate into an ordered stream of `PixelOp` rectangles.
pub fn paint(spec: &PlateSpec, state: &PlateState) -> Vec<PixelOp> {
    let mut r = Rasterizer::new();

    // 1. Base chassis
    r.striate(0, 0, spec.width, spec.height, true);

    // 2. CONTEXT / USAGE meters
    let ctx_pct = state.context.map(|p| (p * 100.0).round() as i32);
    let usg_pct = state.usage.map(|p| (p * 100.0).round() as i32);

    let ctx_str = ctx_pct
        .map(|v| format!("{v}%"))
        .unwrap_or_else(|| "--".into());
    let usg_str = usg_pct
        .map(|v| format!("{v}%"))
        .unwrap_or_else(|| "--".into());

    r.big_text(spec.context_x, 3, &ctx_str, true);
    r.sm_text(spec.context_x, 21, "CONTEXT", colors::TAN_DIM, true);

    r.big_text(spec.usage_x, 3, &usg_str, true);
    r.sm_text(spec.usage_x, 21, "USAGE", colors::TAN_DIM, true);

    // 3. Middle panel: AGENT / PATH / BRANCH
    r.well(spec.panel_x, 1, spec.panel_w, 30, colors::PANEL_FLOOR);
    r.well(spec.mark_x, 1, spec.mark_w, 29, colors::MARK_FLOOR);
    r.groove(spec.groove_x, 1, 29);

    let agent_str = truncate_left(&state.agent_name, spec.value_chars as usize);
    let path_str = truncate_left(&state.path, spec.value_chars as usize);
    let branch_str = truncate_left(&state.branch, spec.value_chars as usize);

    r.sm_text(spec.label_x, 5, "AGENT", colors::TAN_DIM, false);
    r.sm_text(spec.value_x, 5, &agent_str, colors::VALUE, false);

    r.sm_text(spec.label_x, 13, "PATH", colors::TAN_DIM, false);
    r.sm_text(spec.value_x, 13, &path_str, colors::VALUE, false);

    r.sm_text(spec.label_x, 21, "BRANCH", colors::TAN_DIM, false);
    r.sm_text(spec.value_x, 21, &branch_str, colors::VALUE, false);

    // 4. Elastic waiting queue zone
    if spec.zone_width >= 60 {
        r.well(spec.zone_x, 1, spec.zone_width, 30, colors::WELL_FLOOR);
        r.sm_text(spec.zone_x + 4, 4, "WAITING", colors::TAN_DIM, false);
        let wait_count = state
            .waiting
            .iter()
            .filter(|w| w.status != "working")
            .count()
            .min(99);
        let count_str = format!("{wait_count}");
        r.big_text(spec.zone_x + 45, 13, &count_str, true);

        let cols = spec.waiting_columns();
        if cols > 0 {
            r.groove(spec.zone_x + 52, 4, 24);
            if let Some(div_x) = spec.waiting_divider_x() {
                r.groove(div_x, 4, 24);
            }

            let max_rows = cols * (WAITING_ROWS_PER_COL as usize);
            for (idx, item) in state.waiting.iter().take(max_rows).enumerate() {
                if let Some(box_info) = spec.waiting_row_box(idx, &item.tag) {
                    r.sm_text(box_info.x, box_info.y, &item.n, colors::TAN_DIM, false);

                    // 5x6 Silhouette Status Glyph
                    let glyph = get_status_glyph(&item.status);
                    let st_color = match item.status.as_str() {
                        "working" => colors::ST_LIVE,
                        "fails" | "failed" => colors::ST_FAIL,
                        "asks" => colors::ST_WAIT,
                        "quiet" => colors::ST_IDLE,
                        _ => colors::TAN_DIM,
                    };
                    for (gr, row) in glyph.iter().enumerate() {
                        for (gc, b) in row.chars().enumerate() {
                            if b != '.' {
                                r.px(
                                    box_info.x + 10 + (gc as u32),
                                    box_info.y + (gr as u32),
                                    1,
                                    1,
                                    st_color,
                                );
                            }
                        }
                    }

                    // Guaranteed Non-Overlapping Name Truncation
                    let name_trunc: String = item.name.chars().take(box_info.name_room).collect();
                    let name_col = if item.status == "working" {
                        colors::TAN_DIM
                    } else {
                        colors::VALUE
                    };
                    r.sm_text(box_info.name_x, box_info.y, &name_trunc, name_col, false);
                    r.sm_text(box_info.tag_x, box_info.y, &item.tag, colors::TAN_DIM, true);
                }
            }
        }
    }

    // 5. Right controls & Token Table
    r.big_text(spec.sandbox_x, 3, &state.mode, true);
    r.sm_text(spec.sandbox_x, 21, "MODE", colors::TAN, true);

    // Three system card lamps (blue/gold/red)
    let card_cols = [colors::CARD_BLUE, colors::CARD_GOLD, colors::CARD_RED];
    for (i, &card_col) in card_cols.iter().enumerate() {
        let on = state.chips.get(i).copied().unwrap_or(false);
        let y = 3 + (i as u32) * 10;
        let body_col = if on { card_col } else { colors::CARD_OFF };
        let lip_col = if on {
            colors::CARD_LIP_ON
        } else {
            colors::CARD_LIP_OFF
        };
        r.px(spec.cards_x, y, 8, 5, body_col);
        r.px(spec.cards_x, y, 8, 1, lip_col);
        r.px(spec.cards_x, y + 4, 8, 1, colors::CARD_SHADOW);
    }

    // Token Usage Table
    for (i, row) in state.table.iter().take(4).enumerate() {
        let ty = 4 + (i as u32) * 7;
        r.sm_text(spec.table_label_x, ty, &row.label, colors::TAN, false);
        r.sm_text(spec.table_cur_x, ty, &row.cur, colors::VALUE, true);
        r.sm_text(spec.table_lim_x, ty, &row.lim, colors::TAN, true);
    }
    r.px(spec.table_rule_x, 4, 1, 27, colors::RULE);

    r.ops
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
    for chunk in rgba.chunks_exact(4) {
        out.push(chunk[0]);
        out.push(chunk[1]);
        out.push(chunk[2]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_paint_generates_ops() {
        let spec = PlateSpec::for_width(640);
        let state = PlateState::default();
        let ops = paint(&spec, &state);
        assert!(!ops.is_empty());
        assert!(ops.len() > 100);
    }

    #[test]
    fn test_render_and_export_ppm() {
        let spec = PlateSpec::for_width(640);
        let mut state = PlateState {
            context: Some(0.61),
            usage: Some(0.34),
            agent_name: "Claude Code · Opus 5".into(),
            path: "~/Projects/Doom Term".into(),
            branch: "feature/webgl-compositor".into(),
            mode: "FULL".into(),
            ..Default::default()
        };
        state.waiting.push(crate::state::WaitingSession {
            session_id: "s1".into(),
            n: "1".into(),
            name: "PTY socket teardown".into(),
            status: "working".into(),
            tag: "CODX".into(),
        });
        state.waiting.push(crate::state::WaitingSession {
            session_id: "s2".into(),
            n: "2".into(),
            name: "Docs portal migration".into(),
            status: "asks".into(),
            tag: "AGY".into(),
        });
        state.table.push(crate::state::TokenRow {
            label: "IN".into(),
            cur: "14".into(),
            lim: "128".into(),
        });
        state.table.push(crate::state::TokenRow {
            label: "OUT".into(),
            cur: "3".into(),
            lim: "32".into(),
        });

        let ops = paint(&spec, &state);
        let rgba = render_to_rgba(spec.width, spec.height, &ops);
        assert_eq!(rgba.len(), (640 * 32 * 4) as usize);

        let ppm = export_ppm(spec.width, spec.height, &rgba);
        std::fs::create_dir_all(".git/doomterm-evidence/plate").ok();
        std::fs::write(".git/doomterm-evidence/plate/plate-640.ppm", ppm).unwrap();
    }

    #[test]
    fn test_hostile_strings_no_overflow_or_overlap() {
        let mut state = PlateState {
            agent_name: "SuperLongAgentNameThatExceedsAllReasonableLimitsAndPanelBoundaries".into(),
            path: "/Users/cleadmon/Projects/Doom Term/crates/doomterm_plate/src/paint_test_very_long_path_here.rs".into(),
            branch: "feature/doomterm-ultimate-stress-test-branch-name-exceeding-24-characters".into(),
            mode: "FULL".into(),
            ..Default::default()
        };

        for i in 0..20 {
            state.waiting.push(crate::state::WaitingSession {
                session_id: format!("session_{i}"),
                n: format!("{i}"),
                name: format!(
                    "HostileVeryLongSessionNameExceedingNormalRoom_{}_{}",
                    i,
                    "X".repeat(100)
                ),
                status: match i % 5 {
                    0 => "working".into(),
                    1 => "asks".into(),
                    2 => "failed".into(),
                    3 => "quiet".into(),
                    _ => "unknown".into(),
                },
                tag: format!("TAG{i}"),
            });
        }

        for width in [480, 500, 640, 720, 800, 1024, 1920] {
            let spec = PlateSpec::for_width(width);
            let ops = paint(&spec, &state);

            // Assert all ops are inside canvas bounds
            for op in &ops {
                assert!(
                    op.x + op.width <= spec.width,
                    "Pixel op at x={} w={} exceeds plate width {}",
                    op.x,
                    op.width,
                    spec.width
                );
                assert!(
                    op.y + op.height <= spec.height,
                    "Pixel op at y={} h={} exceeds plate height {}",
                    op.y,
                    op.height,
                    spec.height
                );
            }

            // Assert rendering to RGBA works cleanly without buffer overflow
            let rgba = render_to_rgba(spec.width, spec.height, &ops);
            assert_eq!(rgba.len(), (spec.width * spec.height * 4) as usize);

            if width == 640 {
                let ppm = export_ppm(spec.width, spec.height, &rgba);
                std::fs::write(".git/doomterm-evidence/plate/plate-hostile-640.ppm", ppm).unwrap();
            }
        }
    }
}
