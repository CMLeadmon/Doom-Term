use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use super::*;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "doomterm-agent-sessions-{name}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn write_lines(path: &Path, lines: &[String]) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, lines.join("\n") + "\n").unwrap();
}

fn assistant(
    model: &str,
    input: u64,
    cache_read: u64,
    cache_create: u64,
    sidechain: bool,
) -> String {
    serde_json::json!({
        "type": "assistant",
        "isSidechain": sidechain,
        "message": {
            "model": model,
            "usage": {
                "input_tokens": input,
                "cache_read_input_tokens": cache_read,
                "cache_creation_input_tokens": cache_create,
                "output_tokens": 999_999,
            }
        }
    })
    .to_string()
}

#[test]
fn context_windows_follow_the_published_model_table() {
    assert_eq!(claude_context_window("claude-opus-5-5"), Some(1_000_000));
    assert_eq!(claude_context_window("claude-fable-5-1"), Some(1_000_000));
    assert_eq!(claude_context_window("claude-sonnet-5"), Some(1_000_000));
    assert_eq!(
        claude_context_window("claude-haiku-4-5-20251001"),
        Some(200_000)
    );
    // Sonnet 4.5 runs at 200K or 1M depending on an opt-in the transcript does not record.
    assert_eq!(claude_context_window("claude-sonnet-4-5"), None);
    assert_eq!(claude_context_window("some-future-model"), None);
}

#[test]
fn project_slug_matches_claude_code() {
    assert_eq!(
        claude_project_slug(Path::new("/var/home/cleadmon/Projects/Doom Term")),
        "-var-home-cleadmon-Projects-Doom-Term"
    );
    assert_eq!(
        claude_project_slug(Path::new("/home/u/.dotfiles")),
        "-home-u--dotfiles"
    );
}

#[test]
fn claude_context_uses_the_newest_main_thread_turn() {
    let dir = scratch("claude-context");
    let transcript = dir.join("t.jsonl");
    write_lines(
        &transcript,
        &[
            assistant("claude-opus-5-5", 2, 100_000, 0, false),
            "{\"type\":\"user\",\"message\":{}}".into(),
            assistant("claude-opus-5-5", 2, 414_605, 4_078, false),
            // A subagent's turn must not be read as the main conversation's context.
            assistant("claude-haiku-4-5", 5, 190_000, 0, true),
            "{not json".into(),
        ],
    );
    let context = claude_context_from_transcript(&transcript).unwrap();
    assert!((context - 0.418_685).abs() < 1e-4, "{context}");
}

#[test]
fn claude_report_binds_by_pid_and_reads_status() {
    let dir = scratch("claude-report");
    let claude = dir.join(".claude");
    let cwd = PathBuf::from("/work/Doom Term");
    write_lines(
        &claude.join("sessions/4242.json"),
        &[serde_json::json!({
            "pid": 4242,
            "sessionId": "abc-123",
            "cwd": cwd,
            "status": "busy",
        })
        .to_string()],
    );
    write_lines(
        &claude
            .join("projects")
            .join(claude_project_slug(&cwd))
            .join("abc-123.jsonl"),
        &[assistant("claude-sonnet-5", 0, 250_000, 0, false)],
    );
    // A newer, bigger transcript from another session must not leak into this one.
    write_lines(
        &claude.join("projects/-elsewhere/zzz-999.jsonl"),
        &[assistant("claude-opus-5", 0, 990_000, 0, false)],
    );
    let process = AgentProcess {
        kind: AgentKind::Claude,
        pid: 4242,
        cwd: None,
        started: None,
    };
    let report = claude_report(&process, &claude);
    assert_eq!(report.working, Some(true));
    assert_eq!(report.context, Some(0.25));
    assert_eq!(
        report.usage, None,
        "Claude records no rate-limit data locally"
    );

    let unknown = AgentProcess { pid: 1, ..process };
    assert_eq!(claude_report(&unknown, &claude), AgentReport::default());
}

fn codex_event(kind: &str, extra: serde_json::Value) -> String {
    let mut payload = serde_json::json!({ "type": kind });
    payload
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    serde_json::json!({ "type": "event_msg", "payload": payload }).to_string()
}

#[test]
fn codex_rollout_reports_context_usage_and_turn_state() {
    let dir = scratch("codex-rollout");
    let rollout = dir.join("rollout-x.jsonl");
    let token_count = |total: u64, primary: f64, secondary: f64| {
        codex_event(
            "token_count",
            serde_json::json!({
                "info": {
                    "last_token_usage": { "total_tokens": total },
                    "model_context_window": 258_400,
                },
                "rate_limits": {
                    "primary": { "used_percent": primary, "window_minutes": 300 },
                    "secondary": { "used_percent": secondary, "window_minutes": 10080 },
                }
            }),
        )
    };
    write_lines(
        &rollout,
        &[
            serde_json::json!({"type":"session_meta","payload":{"cwd":"/w"}}).to_string(),
            codex_event("task_started", serde_json::json!({})),
            token_count(10_000, 1.0, 1.0),
            codex_event("token_count", serde_json::json!({ "info": null })),
            token_count(30_311, 2.0, 41.0),
        ],
    );
    let report = codex_report_from_rollout(&rollout);
    assert!((report.context.unwrap() - 30_311.0 / 258_400.0).abs() < 1e-6);
    assert_eq!(
        report.usage,
        Some(0.02),
        "the five-hour session window is shown"
    );
    assert_eq!(report.working, Some(true));

    let mut lines: Vec<String> = std::fs::read_to_string(&rollout)
        .unwrap()
        .lines()
        .map(str::to_owned)
        .collect();
    lines.push(codex_event("task_complete", serde_json::json!({})));
    write_lines(&rollout, &lines);
    assert_eq!(codex_report_from_rollout(&rollout).working, Some(false));
}

#[test]
fn codex_usage_follows_the_five_hour_window_when_order_changes() {
    let dir = scratch("codex-session-window");
    let rollout = dir.join("rollout-x.jsonl");
    write_lines(
        &rollout,
        &[codex_event(
            "token_count",
            serde_json::json!({
                "info": { "last_token_usage": { "total_tokens": 10 }, "model_context_window": 100 },
                "rate_limits": {
                    "primary": { "used_percent": 87.0, "window_minutes": 10080 },
                    "secondary": { "used_percent": 14.0, "window_minutes": 300 }
                }
            }),
        )],
    );
    assert_eq!(codex_report_from_rollout(&rollout).usage, Some(0.14));
}

#[test]
fn codex_rollout_is_matched_by_directory_and_start_time() {
    let dir = scratch("codex-match");
    let sessions = dir.join("sessions");
    let day = sessions.join("2026/09/27");
    let meta =
        |cwd: &str| serde_json::json!({"type":"session_meta","payload":{"cwd":cwd}}).to_string();
    write_lines(&day.join("rollout-a.jsonl"), &[meta("/other")]);
    write_lines(&day.join("rollout-b.jsonl"), &[meta("/work")]);
    let process = AgentProcess {
        kind: AgentKind::Codex,
        pid: u32::MAX,
        cwd: Some(PathBuf::from("/work")),
        started: Some(SystemTime::now() - Duration::from_secs(60)),
    };
    assert_eq!(
        newest_rollout_for(&process, &sessions),
        Some(day.join("rollout-b.jsonl"))
    );

    let late = AgentProcess {
        started: Some(SystemTime::now() + Duration::from_secs(3_600)),
        ..process
    };
    assert_eq!(
        newest_rollout_for(&late, &sessions),
        None,
        "older sessions are never reused"
    );
}

#[test]
fn scanning_backwards_crosses_chunk_boundaries() {
    let dir = scratch("scan");
    let path = dir.join("big.jsonl");
    let mut lines = vec![assistant("claude-opus-5", 0, 123, 0, false)];
    let filler = serde_json::json!({"type": "progress", "pad": "x".repeat(900)}).to_string();
    lines.extend(std::iter::repeat_n(filler, 2_000));
    write_lines(&path, &lines);
    let found = scan_backwards(&path, |r| {
        r.get("type").and_then(Value::as_str) == Some("assistant")
    });
    assert_eq!(
        found.and_then(|r| r
            .pointer("/message/usage/cache_read_input_tokens")?
            .as_u64()),
        Some(123)
    );
}
