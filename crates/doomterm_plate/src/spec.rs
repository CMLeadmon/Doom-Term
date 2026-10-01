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
pub const ROW_NAME_DX: u32 = 12;
pub const ROW_EDGE_PAD: u32 = 4;
pub const WAITING_NAME_MIN: u32 = 3;
pub const WAITING_NAME_GOOD: u32 = 9;
pub const WAITING_COL_MIN_W: u32 = ROW_NAME_DX + WAITING_NAME_MIN * ADV_SM + ROW_EDGE_PAD + 1;
pub const WAITING_ROWS_MIN_W: u32 = ROW_AREA_X + WAITING_COL_MIN_W;
pub const WAITING_MIN_W: u32 = 60;

/// Top of every well; wells span `WELL_Y..WELL_Y + WELL_H`.
pub const WELL_Y: u32 = 1;
pub const WELL_H: u32 = 27;
/// Baselines (top rows) of the three small-text rows inside a well.
pub const ROW_Y: [u32; 3] = [4, 12, 20];
/// Top of the big red numerals in the meter columns.
pub const BIG_Y: u32 = 2;
/// Top of the meter labels under the large numerals.
pub const LABEL_TEXT_Y: u32 = 20;
/// Top of the big waiting count.
pub const WAIT_COUNT_Y: u32 = 11;
/// Width reserved at the right edge for the DIFF well, including its outer margin.
pub const DIFF_RESERVE: u32 = 84;
pub const DIFF_WELL_W: u32 = 77;
/// Narrowest plate that still has room for the DIFF well beside the middle panel.
pub const DIFF_MIN_PLATE_W: u32 = 334 + DIFF_RESERVE;
/// Width of the middle panel when the plate has room for all of it.
const PANEL_W: u32 = 226;
/// Space kept between the last panel character and the panel's right edge.
const VALUE_END_PAD: u32 = 3;
/// Narrowest logical width the plate is laid out for. It holds both meters and the mark with
/// a few characters of details.
pub const COMPACT_MIN_W: u32 = 240;
/// Chassis kept clear between the middle panel and the plate's right border.
pub const RIGHT_MARGIN: u32 = 4;
pub const COMPACT_MIN_VALUE_CHARS: u32 = 8;

// The vertical layout is fixed, so its invariants are checked when the crate compiles. Row 0 and
// row `HEIGHT - 1` are the chassis bevels; small text is 6 rows, big numerals 14 plus a shadow.
const _: () = {
    assert!(WELL_Y >= 1 && WELL_Y + WELL_H < HEIGHT);
    let mut i = 0;
    while i < ROW_Y.len() {
        assert!(ROW_Y[i] > WELL_Y && ROW_Y[i] + 6 < WELL_Y + WELL_H - 1);
        i += 1;
    }
    assert!(LABEL_TEXT_Y + 7 < HEIGHT);
    assert!(BIG_Y + 15 < LABEL_TEXT_Y);
    assert!(WAIT_COUNT_Y + 15 < WELL_Y + WELL_H);
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
        let panel_x = 104;
        let value_x = 182;
        let panel_w = PANEL_W.min(width.saturating_sub(panel_x + RIGHT_MARGIN));
        let value_chars = panel_w.saturating_sub(value_x - panel_x + VALUE_END_PAD) / ADV_SM;
        Self {
            width,
            height: HEIGHT,
            context_col: (1, 48),
            usage_col: (50, 98),
            panel_x,
            panel_w,
            mark_x: 107,
            mark_w: 24,
            groove_x: 136,
            label_x: 141,
            value_x,
            value_chars,
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
        let two_column_min = ROW_NAME_DX + WAITING_NAME_GOOD * ADV_SM + ROW_EDGE_PAD + 1;
        if halved >= two_column_min {
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
    pub fn waiting_row_box(&self, index: usize) -> Option<WaitingRowBox> {
        let cols = self.waiting_columns();
        if cols == 0 || index >= cols * (WAITING_ROWS_PER_COL as usize) {
            return None;
        }
        let w = self.waiting_column_width(cols);
        let col = (index / (WAITING_ROWS_PER_COL as usize)) as u32;
        let x = self.zone_x + ROW_AREA_X + col * (w + WAITING_COL_GUTTER);
        let y = ROW_Y[index % (WAITING_ROWS_PER_COL as usize)];

        let name_x = x + ROW_NAME_DX;
        let name_end = x + w.saturating_sub(1 + ROW_EDGE_PAD);
        if name_end < name_x {
            return None;
        }
        let name_room = ((name_end - name_x) / ADV_SM) as usize;
        if name_room < (WAITING_NAME_MIN as usize) {
            return None;
        }
        Some(WaitingRowBox {
            x,
            y,
            w,
            name_x,
            name_room,
        })
    }

    pub fn waiting_row_at(&self, x: u32, y: u32, visible_count: usize) -> Option<usize> {
        let rows = visible_count.min(self.waiting_columns() * WAITING_ROWS_PER_COL as usize);
        (0..rows).find(|&index| {
            self.waiting_row_box(index)
                .is_some_and(|row| x >= row.x && x < row.x + row.w && y >= row.y && y < row.y + 7)
        })
    }

    /// The target of the queue row under `(x, y)`; `targets` holds one entry per queued row.
    pub fn waiting_target_at<T: Copy>(&self, x: u32, y: u32, targets: &[T]) -> Option<T> {
        self.waiting_row_at(x, y, targets.len())
            .and_then(|row| targets.get(row).copied())
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
}

/// How a plate of a given device width is laid out and scaled.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlateLayout {
    /// Device pixels per logical plate pixel; always a whole number.
    pub scale: u32,
    pub spec: PlateSpec,
    /// Device pixels left over when the width is not a multiple of `scale`. The host fills them
    /// with the border colour so the right border sits on the edge.
    pub edge_px: f32,
}

/// The largest whole scale (3, 2 or 1) at which the plate is still `COMPACT_MIN_W` logical
/// pixels wide.
pub fn scale_for_device_width(device_width: f32) -> u32 {
    (1..=SCALE_DEFAULT)
        .rev()
        .find(|scale| device_width / *scale as f32 >= COMPACT_MIN_W as f32)
        .unwrap_or(1)
}

pub fn plate_layout(device_width: f32) -> PlateLayout {
    let scale = scale_for_device_width(device_width);
    let width = ((device_width / scale as f32).floor() as u32).max(COMPACT_MIN_W);
    let edge_px = (device_width - (width * scale) as f32).max(0.0);
    PlateLayout {
        scale,
        spec: PlateSpec::for_width(width),
        edge_px,
    }
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
