use super::*;

const WIDTHS: [u32; 12] = [390, 417, 418, 426, 480, 512, 640, 720, 853, 960, 1280, 1920];

#[test]
fn plate_is_29_rows() {
    assert_eq!(HEIGHT, 29);
    for width in WIDTHS {
        assert_eq!(PlateSpec::for_width(width).height, 29);
    }
}

#[test]
fn diff_well_appears_only_when_it_fits() {
    assert_eq!(PlateSpec::for_width(417).diff_x, None);
    for width in WIDTHS.into_iter().filter(|w| *w >= DIFF_MIN_PLATE_W) {
        let spec = PlateSpec::for_width(width);
        let diff_x = spec.diff_x.expect("wide plates carry a DIFF well");
        assert!(
            diff_x >= spec.panel_x + spec.panel_w,
            "DIFF overlaps the panel at {width}"
        );
        assert!(
            diff_x + DIFF_WELL_W <= width - 1,
            "DIFF crosses the right bevel at {width}"
        );
        assert!(
            spec.zone_x + spec.zone_width < diff_x,
            "waiting zone runs into DIFF at {width}"
        );
    }
}

#[test]
fn meter_columns_do_not_touch_the_panel() {
    let spec = PlateSpec::for_width(512);
    assert!(spec.context_col.1 < spec.usage_col.0);
    assert!(spec.usage_col.1 < spec.panel_x);
    // "100%" is the widest meter reading.
    let widest = 4 * ADV_BIG - 1;
    assert!(spec.context_col.1 - spec.context_col.0 > widest + 2);
    assert!(spec.usage_col.1 - spec.usage_col.0 > widest + 2);
}

#[test]
fn waiting_columns_scale_with_width() {
    assert_eq!(PlateSpec::for_width(512).waiting_columns(), 0);
    assert_eq!(PlateSpec::for_width(560).waiting_columns(), 1);
    assert_eq!(PlateSpec::for_width(640).waiting_columns(), 2);
}

#[test]
fn middle_panel_text_never_spills() {
    for width in WIDTHS {
        let spec = PlateSpec::for_width(width);
        let max_val_px = spec.value_x + spec.value_chars * ADV_SM;
        assert!(max_val_px <= spec.panel_x + spec.panel_w);
        assert!(max_val_px < spec.zone_x);
    }
}

#[test]
fn waiting_rows_never_overlap() {
    for width in WIDTHS {
        let spec = PlateSpec::for_width(width);
        let cols = spec.waiting_columns();
        for index in 0..(cols * WAITING_ROWS_PER_COL as usize) {
            for tag in ["", "C", "CLAU", "CODX", "LONGTAG"] {
                let Some(b) = spec.waiting_row_box(index, tag) else {
                    continue;
                };
                let tag_w = tag.chars().count() as u32 * ADV_SM;
                let name_end_px = b.name_x + b.name_room as u32 * ADV_SM;
                assert!(name_end_px + ROW_TAG_GAP <= b.tag_x.saturating_sub(tag_w));
                assert!(b.tag_x <= b.x + b.w.saturating_sub(1 + ROW_EDGE_PAD));
                assert!(b.x + b.w <= spec.zone_x + spec.zone_width);
            }
        }
    }
}

#[test]
fn truncation_marks_the_cut_and_respects_the_budget() {
    assert_eq!(truncate_left("abc", 5), "abc");
    assert_eq!(truncate_left("abcdefghij", 6), "…fghij");
    assert_eq!(truncate_right("feature/long-branch", 8), "feature…");
    assert_eq!(truncate_right("ab cdef", 4), "ab…");
    for len in 0..60 {
        let s = "x".repeat(len);
        for max in 0..30 {
            for t in [truncate_left(&s, max), truncate_right(&s, max)] {
                assert!(t.chars().count() <= max.max(len.min(max)));
                if len > max && max > 0 {
                    assert!(t.contains(ELLIPSIS), "cut text must say so: {t:?}");
                }
            }
        }
    }
}
