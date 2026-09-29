//! Renders reference plates to PPM files for visual review.
//!
//! `cargo run -p doomterm_plate --example render_plate -- <out-dir>`

use std::path::PathBuf;

use doomterm_plate::{
    export_ppm, paint, render_to_rgba, scale_ops, DiffStats, PlateKind, PlateSpec, PlateState,
    WaitStatus, WaitingSession, SCALE_DEFAULT,
};

fn main() -> std::io::Result<()> {
    let out = PathBuf::from(
        std::env::args()
            .nth(1)
            .unwrap_or_else(|| "plate-renders".into()),
    );
    std::fs::create_dir_all(&out)?;

    let waiting = vec![
        WaitingSession {
            n: "2".into(),
            name: "docs-migration".into(),
            status: WaitStatus::NeedsInput,
            tag: "CODX".into(),
        },
        WaitingSession {
            n: "3".into(),
            name: "pty-teardown".into(),
            status: WaitStatus::Working,
            tag: "AGY".into(),
        },
    ];
    let states = [
        (
            "shell-idle",
            PlateState {
                name: Some("deploy-notes".into()),
                path: Some("~/Projects/Doom Term".into()),
                branch: Some("main".into()),
                diff: Some(DiffStats {
                    added: 0,
                    removed: 0,
                    files: 0,
                }),
                ..Default::default()
            },
        ),
        (
            "claude-working",
            PlateState {
                context: Some(0.42),
                usage: Some(0.18),
                agent: "claude".into(),
                kind: PlateKind::Agent,
                name: Some("Implementation".into()),
                path: Some("~/Projects/Doom Term".into()),
                branch: Some("main".into()),
                diff: Some(DiffStats {
                    added: 142,
                    removed: 37,
                    files: 6,
                }),
                waiting: waiting.clone(),
                phase: 0.35,
                working: true,
            },
        ),
        (
            "codex-idle",
            PlateState {
                context: Some(0.12),
                usage: Some(0.02),
                agent: "codex".into(),
                kind: PlateKind::Agent,
                name: Some("Codex".into()),
                path: Some("~/Projects/Doom Term".into()),
                branch: Some("main".into()),
                waiting: waiting.clone(),
                ..Default::default()
            },
        ),
        (
            "remote",
            PlateState {
                agent: "remote".into(),
                kind: PlateKind::Remote,
                name: Some("build-box".into()),
                path: Some("~/project".into()),
                branch: Some("remote-feature-branch".into()),
                ..Default::default()
            },
        ),
    ];

    for width in [512u32, 640] {
        let spec = PlateSpec::for_width(width);
        for (name, state) in &states {
            let ops = scale_ops(&paint(&spec, state), SCALE_DEFAULT);
            let (w, h) = (spec.width * SCALE_DEFAULT, spec.height * SCALE_DEFAULT);
            let ppm = export_ppm(w, h, &render_to_rgba(w, h, &ops));
            std::fs::write(out.join(format!("{name}-{width}.ppm")), ppm)?;
        }
    }
    Ok(())
}
