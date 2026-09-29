use super::*;
use crate::spec::{DIFF_MIN_PLATE_W, ELLIPSIS, HEIGHT, ROW_AREA_X};
use crate::state::{DiffStats, PlateKind, WaitingSession};

const AGENTS: [&str; 11] = [
    "claude",
    "codex",
    "gemini",
    "antigravity",
    "aider",
    "opencode",
    "grok",
    "copilot",
    "remote",
    "shell",
    "unknown",
];

fn pixels_in(ops: &[PixelOp], x0: u32, x1: u32, color: (u8, u8, u8)) -> usize {
    ops.iter()
        .filter(|op| op.x >= x0 && op.x < x1 && (op.r, op.g, op.b) == color)
        .count()
}

fn hostile_state() -> PlateState {
    let mut state = PlateState {
        context: Some(1.7),
        usage: Some(-0.2),
        agent: "claude".into(),
        kind: PlateKind::Agent,
        name: Some("✳ SuperLongAgentNameThatExceedsAllReasonableLimits ◐".into()),
        path: Some("/Users/someone/Projects/Doom Term/crates/doomterm_plate/src/x.rs".into()),
        branch: Some("feature/an-extremely-long-branch-name-that-cannot-fit".into()),
        diff: Some(DiffStats {
            added: 4_000_000_000,
            removed: 123_456,
            files: 999_999,
        }),
        working: true,
        phase: 0.4,
        ..Default::default()
    };
    for i in 0..20 {
        state.waiting.push(WaitingSession {
            n: format!("{i}"),
            name: format!("Hostile_{i}_{}", "X".repeat(80)),
            status: match i % 3 {
                0 => WaitStatus::Working,
                1 => WaitStatus::NeedsInput,
                _ => WaitStatus::Failed,
            },
        });
    }
    state
}

#[test]
fn every_op_stays_inside_the_plate() {
    let state = hostile_state();
    for width in [390, 417, 418, 480, 512, 640, 720, 853, 1024, 1280, 1920] {
        let spec = PlateSpec::for_width(width);
        for op in paint(&spec, &state) {
            assert!(
                op.x + op.width <= spec.width,
                "x overflow at width {width}: {op:?}"
            );
            assert!(
                op.y + op.height <= HEIGHT,
                "y overflow at width {width}: {op:?}"
            );
        }
    }
}

#[test]
fn labels_are_legible_on_their_surfaces() {
    for (fg, bg, what) in [
        (
            colors::AMMO_LABEL,
            colors::STONE[3],
            "meter and DIFF labels",
        ),
        (colors::TAN, colors::WELL_FLOOR, "WAITING label"),
        (colors::TAN, colors::PANEL_FLOOR, "SHELL/AGENT/PATH/BRANCH"),
        (colors::VALUE, colors::PANEL_FLOOR, "panel values"),
        (colors::VALUE, colors::WELL_FLOOR, "waiting names"),
        (colors::AMMO_VALUE, colors::STONE[3], "DIFF values"),
    ] {
        let ratio = contrast_ratio(fg, bg);
        assert!(ratio >= 4.5, "{what}: contrast {ratio:.2} < 4.5");
    }
}

#[test]
fn meter_labels_sit_on_the_chassis() {
    let spec = PlateSpec::for_width(512);
    let ops = paint(&spec, &PlateState::default());
    for (left, right) in [spec.context_col, spec.usage_col] {
        assert!(
            pixels_in(&ops, left, right, colors::AMMO_LABEL) > 40,
            "label glyphs are drawn on the chassis"
        );
        assert!(!ops.iter().any(|op| op.x == left
            && op.y == LABEL_TEXT_Y - 2
            && (op.r, op.g, op.b) == colors::WELL_FLOOR));
    }
}

#[test]
fn plate_text_drops_what_the_font_cannot_draw() {
    assert_eq!(plate_text("✳ Claude Code"), "CLAUDE CODE");
    assert_eq!(plate_text("◐  deploy   notes"), "DEPLOY NOTES");
    assert_eq!(
        plate_text("user@host:~/src_dir (2)"),
        "USER@HOST:~/SRC_DIR (2)"
    );
    assert_eq!(plate_text("日本語"), "");
}

#[test]
fn every_drawable_character_has_a_glyph() {
    for c in plate_text("abc…+_=@#()[],'\"!?<>|\\*&$%/.-:~ 0123456789").chars() {
        assert!(crate::glyph::sm_renderable(c), "{c:?} has no glyph");
    }
}

#[test]
fn truncated_fields_show_an_ellipsis() {
    let spec = PlateSpec::for_width(512);
    let long_path = "/var/home/cleadmon/Projects/Doom Term/very/deep/path";
    let cut = truncate_left(&plate_text(long_path), spec.value_chars as usize);
    assert!(cut.starts_with(ELLIPSIS));
    assert!(cut.ends_with("DEEP/PATH"));

    let with = paint(
        &spec,
        &PlateState {
            path: Some(long_path.into()),
            ..Default::default()
        },
    );
    let without = paint(
        &spec,
        &PlateState {
            path: Some(cut.trim_start_matches(ELLIPSIS).into()),
            ..Default::default()
        },
    );
    assert_ne!(with, without, "the ellipsis glyph is actually drawn");
}

#[test]
fn diff_well_draws_counts_or_dashes() {
    let spec = PlateSpec::for_width(512);
    let diff_x = spec.diff_x.unwrap();
    let dashes = paint(&spec, &PlateState::default());
    let counts = paint(
        &spec,
        &PlateState {
            diff: Some(DiffStats {
                added: 142,
                removed: 37,
                files: 6,
            }),
            ..Default::default()
        },
    );
    let live = |ops: &[PixelOp]| pixels_in(ops, diff_x, spec.width, colors::AMMO_VALUE);
    assert!(live(&dashes) > 0);
    assert!(live(&counts) > live(&dashes));
    assert_eq!(PlateSpec::for_width(DIFF_MIN_PLATE_W - 1).diff_x, None);
    assert!(!counts
        .iter()
        .any(|op| op.x == diff_x && op.y == WELL_Y && (op.r, op.g, op.b) == colors::WELL_FLOOR));
}

#[test]
fn idle_marks_are_static_and_working_marks_move() {
    let spec = PlateSpec::for_width(512);
    for agent in AGENTS {
        let at = |phase: f32, working: bool| {
            paint(
                &spec,
                &PlateState {
                    agent: agent.into(),
                    phase,
                    working,
                    ..Default::default()
                },
            )
        };
        assert_eq!(
            at(0.1, false),
            at(0.6, false),
            "{agent} idle mark must not animate"
        );
        assert_ne!(
            at(0.1, true),
            at(0.6, true),
            "{agent} working mark must animate"
        );
    }
}

#[test]
fn every_agent_mark_is_distinct() {
    let spec = PlateSpec::for_width(512);
    let mark = |agent: &str| {
        let mut r = Rasterizer::new();
        draw_agent_mark(&mut r, agent, 12, spec.mark_cy(), 0.0, false);
        r.ops
    };
    for (i, a) in AGENTS.iter().enumerate() {
        for b in &AGENTS[i + 1..] {
            if matches!((*a, *b), ("shell", "unknown")) {
                continue;
            }
            assert_ne!(mark(a), mark(b), "{a} and {b} share a mark");
        }
    }
}

#[test]
fn waiting_count_excludes_working_sessions() {
    let spec = PlateSpec::for_width(512);
    let waiting = |statuses: &[WaitStatus]| PlateState {
        waiting: statuses
            .iter()
            .enumerate()
            .map(|(i, s)| WaitingSession {
                n: (i + 1).to_string(),
                name: "tab".into(),
                status: *s,
            })
            .collect(),
        ..Default::default()
    };
    let one = paint(&spec, &waiting(&[WaitStatus::NeedsInput]));
    let one_plus_working = paint(
        &spec,
        &waiting(&[
            WaitStatus::NeedsInput,
            WaitStatus::Working,
            WaitStatus::Working,
        ]),
    );
    let count = |ops: Vec<PixelOp>| {
        ops.into_iter()
            .filter(|op| op.x >= spec.zone_x && op.x < spec.zone_x + ROW_AREA_X)
            .collect::<Vec<_>>()
    };
    assert_eq!(count(one), count(one_plus_working));
}

#[test]
fn meters_clamp_out_of_range_fractions() {
    let spec = PlateSpec::for_width(512);
    let a = paint(
        &spec,
        &PlateState {
            context: Some(1.7),
            usage: Some(-0.2),
            ..Default::default()
        },
    );
    let b = paint(
        &spec,
        &PlateState {
            context: Some(1.0),
            usage: Some(0.0),
            ..Default::default()
        },
    );
    assert_eq!(a, b);
}
