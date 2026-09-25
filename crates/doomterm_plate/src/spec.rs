//! Exact geometry specification for the Doom Term status plate.
//!
//! Derived mathematically from `mockups/plate.js` to guarantee byte-for-byte and
//! pixel-for-pixel visual and hit-test parity.

pub const HEIGHT: u32 = 32;
pub const SCALE_DEFAULT: u32 = 3;
pub const ADV_SM: u32 = 6;
pub const ADV_BIG: u32 = 9;
pub const WAITING_ROWS_PER_COL: u32 = 3;
pub const WAITING_COLS_MAX: u32 = 2;
pub const WAITING_ROWS: usize = 6;
pub const ROW_AREA_X: u32 = 58;
pub const WAITING_COL_GUTTER: u32 = 14;
pub const ROW_NAME_DX: u32 = 19;
pub const ROW_TAG_GAP: u32 = 4;
pub const ROW_EDGE_PAD: u32 = 4;
pub const WAITING_NAME_MIN: u32 = 3;
pub const WAITING_NAME_GOOD: u32 = 10;
pub const ROW_TAG_CHARS: u32 = 4;
pub const WAITING_COL_MIN_W: u32 = ROW_NAME_DX
    + WAITING_NAME_MIN * ADV_SM
    + ROW_TAG_GAP
    + ROW_TAG_CHARS * ADV_SM
    + ROW_EDGE_PAD
    + 1;
pub const WAITING_ROWS_MIN_W: u32 = ROW_AREA_X + WAITING_COL_MIN_W;
pub const WAITING_MIN_W: u32 = 60;

/// Geometric layout offsets and bounds for a plate of width `W`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PlateSpec {
    pub width: u32,
    pub height: u32,
    pub context_x: u32,
    pub usage_x: u32,
    pub panel_x: u32,
    pub panel_w: u32,
    pub mark_x: u32,
    pub mark_w: u32,
    pub groove_x: u32,
    pub label_x: u32,
    pub value_x: u32,
    pub value_chars: u32,
    pub sandbox_x: u32,
    pub cards_x: Option<u32>,
    pub table_label_x: Option<u32>,
    pub table_cur_x: Option<u32>,
    pub table_lim_x: Option<u32>,
    pub table_rule_x: Option<u32>,
    pub zone_x: u32,
    pub zone_width: u32,
}

impl PlateSpec {
    pub fn for_width(width: u32) -> Self {
        // FORK: the chips and token table are dropped, so MODE moves to the plate edge (width - 8).
        // The space they occupied (W-81 .. W-3) plus the gap MODE vacated goes to the elastic centre.
        // was (width - 146) - 334, now (width - 56) - 334 (reclaiming 90 logical px).
        let zone_w = if width >= 56 + 334 {
            (width - 56) - 334
        } else {
            0
        };
        Self {
            width,
            height: 32,
            context_x: 44,
            usage_x: 90,
            panel_x: 104,
            panel_w: 226,
            mark_x: 107,
            mark_w: 24,
            groove_x: 136,
            label_x: 141,
            value_x: 182,
            value_chars: 24,
            sandbox_x: width.saturating_sub(8),
            cards_x: None,
            table_label_x: None,
            table_cur_x: None,
            table_lim_x: None,
            table_rule_x: None,
            zone_x: 334,
            zone_width: zone_w,
        }
    }

    /// Computes how many waiting queue columns fit inside this plate (0, 1, or 2).
    pub fn waiting_columns(&self) -> usize {
        if self.zone_width < WAITING_MIN_W {
            return 0;
        }
        let area = self.zone_width.saturating_sub(ROW_AREA_X);
        if area < WAITING_COL_MIN_W {
            return 0;
        }
        // FORK: the queue is always two columns where two can honestly be drawn (at WAITING_NAME_MIN).
        let halved = (area.saturating_sub(WAITING_COL_GUTTER)) / 2;
        let min_w = ROW_NAME_DX
            + WAITING_NAME_MIN * ADV_SM
            + ROW_TAG_GAP
            + ROW_TAG_CHARS * ADV_SM
            + ROW_EDGE_PAD
            + 1;
        if halved >= min_w {
            2
        } else {
            1
        }
    }

    /// Width of a single waiting queue column.
    pub fn waiting_column_width(&self, cols: usize) -> u32 {
        let area = self.zone_width.saturating_sub(ROW_AREA_X);
        if cols == 2 {
            area.saturating_sub(WAITING_COL_GUTTER) / 2
        } else {
            area
        }
    }

    /// X coordinate of the groove divider between two waiting columns, if present.
    pub fn waiting_divider_x(&self) -> Option<u32> {
        let cols = self.waiting_columns();
        if cols < 2 {
            return None;
        }
        let w = self.waiting_column_width(cols);
        Some(self.zone_x + ROW_AREA_X + w + (WAITING_COL_GUTTER.saturating_sub(2)) / 2)
    }

    /// Computes bounding coordinates and maximum safe name characters for a waiting row item.
    ///
    /// Returns `None` if the row does not fit or if `name_room < WAITING_NAME_MIN`.
    pub fn waiting_row_box(&self, index: usize, tag: &str) -> Option<WaitingRowBox> {
        let cols = self.waiting_columns();
        if cols == 0 || index >= cols * (WAITING_ROWS_PER_COL as usize) {
            return None;
        }
        let w = self.waiting_column_width(cols);
        let col = (index / (WAITING_ROWS_PER_COL as usize)) as u32;
        let x = self.zone_x + ROW_AREA_X + col * (w + WAITING_COL_GUTTER);
        let y = 5 + ((index % (WAITING_ROWS_PER_COL as usize)) as u32) * 8;

        let name_x = x + ROW_NAME_DX;
        let tag_x = x + w.saturating_sub(1 + ROW_EDGE_PAD);
        let tag_chars = tag.chars().count() as u32;
        let tag_w = tag_chars * ADV_SM;
        let tag_space = name_x + ROW_TAG_GAP + tag_w;
        if tag_x < tag_space {
            return None;
        }
        let name_room = ((tag_x - tag_space) / ADV_SM) as usize;
        if name_room < (WAITING_NAME_MIN as usize) {
            return None;
        }
        Some(WaitingRowBox {
            x,
            y,
            w,
            name_x,
            name_room,
            tag_x,
        })
    }
}

/// Geometric box and text clipping room for a waiting queue row.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WaitingRowBox {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub name_x: u32,
    pub name_room: usize,
    pub tag_x: u32,
}

/// Truncate a string from the left with `··` prefix if longer than `max` characters.
pub fn truncate_left(s: &str, max: usize) -> String {
    let count = s.chars().count();
    if count <= max {
        return s.to_string();
    }
    if max <= 2 {
        return s.chars().skip(count.saturating_sub(max)).collect();
    }
    let suffix: String = s.chars().skip(count - (max - 2)).collect();
    format!("··{suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_base_invariants() {
        let base = PlateSpec::for_width(480);
        assert_eq!((base.height, base.context_x, base.usage_x), (32, 44, 90));
        assert_eq!(
            (base.sandbox_x, base.zone_x, base.zone_width),
            (472, 334, 90)
        );
        assert_eq!(PlateSpec::for_width(700).sandbox_x, 692);
        assert_eq!(base.cards_x, None);
        assert_eq!(base.table_label_x, None);
    }

    #[test]
    fn test_waiting_columns_scaling() {
        assert_eq!(PlateSpec::for_width(480).waiting_columns(), 0);
        assert_eq!(PlateSpec::for_width(550).waiting_columns(), 1);
        assert_eq!(PlateSpec::for_width(640).waiting_columns(), 2);
        assert_eq!(PlateSpec::for_width(960).waiting_columns(), 2);
    }

    #[test]
    fn test_truncate_left_invariants() {
        assert_eq!(truncate_left("", 10), "");
        assert_eq!(truncate_left("abc", 5), "abc");
        assert_eq!(truncate_left("abcdefghij", 10), "abcdefghij");
        assert_eq!(truncate_left("abcdefghij", 6), "··ghij");
        assert_eq!(truncate_left("abcdefghij", 5), "··hij");
        assert_eq!(truncate_left("abcdefghij", 4), "··ij");

        // Assert character count never exceeds max for any length
        for len in 1..200 {
            let s = "x".repeat(len);
            for max in 3..50 {
                let truncated = truncate_left(&s, max);
                assert!(
                    truncated.chars().count() <= max,
                    "truncate_left len={len} max={max} yielded count={}",
                    truncated.chars().count()
                );
            }
        }
    }

    #[test]
    fn test_middle_panel_never_spills_into_zone() {
        for width in [480, 640, 800, 1024, 1920, 3840] {
            let spec = PlateSpec::for_width(width);
            let max_val_px = spec.value_x + spec.value_chars * ADV_SM;
            assert!(
                max_val_px <= spec.panel_x + spec.panel_w,
                "Middle panel text exceeds panel well width at width={width}"
            );
            assert!(
                max_val_px < spec.zone_x,
                "Middle panel text spills into elastic zone at width={width}"
            );
        }
    }

    #[test]
    fn test_waiting_row_box_never_overlaps() {
        for width in [480, 560, 640, 720, 800, 960, 1200, 1920] {
            let spec = PlateSpec::for_width(width);
            let cols = spec.waiting_columns();
            for index in 0..(cols * WAITING_ROWS_PER_COL as usize) {
                for tag in ["", "C", "CLAU", "CODX", "LONGTAG"] {
                    if let Some(b) = spec.waiting_row_box(index, tag) {
                        let tag_chars = tag.chars().count() as u32;
                        let tag_w = tag_chars * ADV_SM;
                        let name_end_px = b.name_x + (b.name_room as u32) * ADV_SM;
                        let tag_start_px = b.tag_x.saturating_sub(tag_w);

                        // 1. Assert strictly that name and tag NEVER overlap
                        assert!(
                            name_end_px + ROW_TAG_GAP <= tag_start_px,
                            "Text overlap detected: name ends at {name_end_px}, tag starts at {tag_start_px} for width={width} tag='{tag}'"
                        );

                        // 2. Assert tag stays within column boundary with padding
                        assert!(
                            b.tag_x <= b.x + b.w.saturating_sub(1 + ROW_EDGE_PAD),
                            "Tag exceeds column right boundary with padding for width={width}"
                        );

                        // 3. Assert column stays within elastic waiting well
                        assert!(
                            b.x + b.w <= spec.zone_x + spec.zone_width,
                            "Column exceeds zone width for width={width}"
                        );

                        // 4. Assert row stays completely to the left of the right panel
                        assert!(
                            b.x + b.w < spec.sandbox_x,
                            "Waiting column touches right panel controls for width={width}"
                        );
                    }
                }
            }
        }
    }
}
