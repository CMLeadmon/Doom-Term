//! Exact geometry specification for the Doom Term status plate.
//!
//! All coordinates are logical plate pixels. The host scales them by an integer factor, so
//! every edge stays on a whole device pixel.

pub const HEIGHT: u32 = 29;
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

/// Top of every well; wells span `WELL_Y..WELL_Y + WELL_H`.
pub const WELL_Y: u32 = 1;
pub const WELL_H: u32 = 27;
/// Baselines (top rows) of the three small-text rows inside a well.
pub const ROW_Y: [u32; 3] = [4, 12, 20];
/// Top of the big red numerals in the meter columns.
pub const BIG_Y: u32 = 2;
/// Recessed label strip under each meter numeral.
pub const LABEL_WELL_Y: u32 = 18;
pub const LABEL_WELL_H: u32 = 9;
pub const LABEL_TEXT_Y: u32 = 20;
/// Top of the big waiting count.
pub const WAIT_COUNT_Y: u32 = 11;
/// Width reserved at the right edge for the DIFF well, including its outer margin.
pub const DIFF_RESERVE: u32 = 84;
pub const DIFF_WELL_W: u32 = 77;
/// Narrowest plate that still has room for the DIFF well beside the middle panel.
pub const DIFF_MIN_PLATE_W: u32 = 334 + DIFF_RESERVE;

// The vertical layout is fixed, so its invariants are checked when the crate compiles. Row 0 and
// row `HEIGHT - 1` are the chassis bevels; small text is 6 rows, big numerals 14 plus a shadow.
const _: () = {
    assert!(WELL_Y >= 1 && WELL_Y + WELL_H <= HEIGHT - 1);
    let mut i = 0;
    while i < ROW_Y.len() {
        assert!(ROW_Y[i] > WELL_Y && ROW_Y[i] + 6 < WELL_Y + WELL_H - 1);
        i += 1;
    }
    assert!(LABEL_WELL_Y + LABEL_WELL_H <= HEIGHT - 1);
    assert!(LABEL_TEXT_Y > LABEL_WELL_Y && LABEL_TEXT_Y + 6 < LABEL_WELL_Y + LABEL_WELL_H);
    assert!(BIG_Y + 15 <= LABEL_WELL_Y);
    assert!(WAIT_COUNT_Y + 15 <= WELL_Y + WELL_H - 1);
};

/// Geometric layout offsets and bounds for a plate of width `W`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PlateSpec {
    pub width: u32,
    pub height: u32,
    /// Left and right edges (inclusive left, exclusive right) of the CONTEXT column.
    pub context_col: (u32, u32),
    /// Left and right edges (inclusive left, exclusive right) of the USAGE column.
    pub usage_col: (u32, u32),
    pub panel_x: u32,
    pub panel_w: u32,
    pub mark_x: u32,
    pub mark_w: u32,
    pub groove_x: u32,
    pub label_x: u32,
    pub value_x: u32,
    pub value_chars: u32,
    /// Left edge of the DIFF well, when the plate is wide enough to hold it.
    pub diff_x: Option<u32>,
    pub zone_x: u32,
    pub zone_width: u32,
}

impl PlateSpec {
    pub fn for_width(width: u32) -> Self {
        let diff_x = (width >= DIFF_MIN_PLATE_W).then(|| width - DIFF_RESERVE + 4);
        let zone_w = width.saturating_sub(DIFF_RESERVE + 334);
        Self {
            width,
            height: HEIGHT,
            context_col: (1, 48),
            usage_col: (50, 98),
            panel_x: 104,
            panel_w: 226,
            mark_x: 107,
            mark_w: 24,
            groove_x: 136,
            label_x: 141,
            value_x: 182,
            value_chars: 24,
            diff_x,
            zone_x: 334,
            zone_width: zone_w,
        }
    }

    /// Vertical centre of the agent mark.
    pub fn mark_cy(&self) -> u32 {
        WELL_Y + WELL_H / 2
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
        let halved = (area.saturating_sub(WAITING_COL_GUTTER)) / 2;
        if halved >= WAITING_COL_MIN_W {
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
        let y = ROW_Y[index % (WAITING_ROWS_PER_COL as usize)];

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

/// Marks text that was cut short. The small font draws it as three dots in one cell.
pub const ELLIPSIS: char = '…';

/// Keeps the end of `s`, which is the informative part of a path.
pub fn truncate_left(s: &str, max: usize) -> String {
    let count = s.chars().count();
    if count <= max {
        return s.to_string();
    }
    if max == 0 {
        return String::new();
    }
    let tail: String = s.chars().skip(count - (max - 1)).collect();
    format!("{ELLIPSIS}{tail}")
}

/// Keeps the start of `s`, which is the informative part of a name or branch.
pub fn truncate_right(s: &str, max: usize) -> String {
    let count = s.chars().count();
    if count <= max {
        return s.to_string();
    }
    if max == 0 {
        return String::new();
    }
    let head: String = s.chars().take(max - 1).collect();
    format!("{}{ELLIPSIS}", head.trim_end())
}

#[cfg(test)]
#[path = "spec_tests.rs"]
mod tests;
