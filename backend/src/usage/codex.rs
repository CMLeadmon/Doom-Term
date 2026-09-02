//! CONTEXT % and USAGE % for Codex, read from its own rollout transcript.
//!
//! Codex is the easy one and it is worth saying why, because the shape of the
//! problem is completely different from Claude's:
//!
//!   - Claude records the model id and nothing else, so the DENOMINATOR has to
//!     come from a hand-maintained table in `context.rs` that goes wrong every
//!     time a family ships. Codex writes `model_context_window` into the file.
//!     There is nothing to guess and nothing to keep up to date.
//!   - Claude's rate limit is an HTTPS call with an OAuth token (`service.rs`).
//!     Codex writes `rate_limits` into the same `token_count` event, so USAGE %
//!     costs one file read and no credentials at all.
//!
//! Antigravity (`agy`) has neither. Its transcripts live under
//! `~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/` and carry only
//! `USER_INPUT` / `PLANNER_RESPONSE` records — no token counts, no window, no
//! working directory. Verified 2026-09-01. There is therefore no honest number
//! to report for it and the plate draws '--', which is the correct answer
//! rather than a missing feature. Do not "fix" this by scraping the PTY.

use super::context::{scan_back, Reading};

/// Both percentages, as they appear in one `token_count` event.
#[derive(Debug, Clone, PartialEq)]
pub struct CodexSnapshot {
    /// Tokens occupying the window on the most recent turn.
    pub used: u64,
    /// The window, as the file itself reports it.
    pub window: u64,
    /// Portion of the gating rate-limit window used, 0..1, when present.
    pub rate: Option<f64>,
}

/// Parse one rollout line, returning its accounting when it is a token count.
///
/// `last_token_usage`, NOT `total_token_usage`: the total ACCUMULATES over the
/// session — 19 486 then 45 012 in a two-turn session measured on 2026-09-01 —
/// so it passes the window and reads as over 100% on any long conversation.
/// The last turn's total is what actually occupies the context.
///
/// `total_tokens` rather than `input_tokens` alone, and note this differs from
/// Claude deliberately: Codex reports `cached_input_tokens` as a SUBSET of
/// `input_tokens`, where Anthropic reports its cache counters as disjoint from
/// `input_tokens`. Adding them here the way `context.rs` does would double-count
/// every cached token.
pub fn snapshot_from_line(line: &str) -> Option<CodexSnapshot> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    let payload = value.get("payload")?;
    if payload.get("type")?.as_str()? != "token_count" {
        return None;
    }
    let info = payload.get("info")?;
    let window = info.get("model_context_window")?.as_u64()?;
    if window == 0 {
        return None;
    }
    let used = info
        .get("last_token_usage")?
        .get("total_tokens")?
        .as_u64()?;

    // The rate limit rides along, and is absent on older payloads. `primary` is
    // the short rolling window, which is the one that actually gates a request.
    let rate = payload
        .get("rate_limits")
        .and_then(|r| r.get("primary"))
        .and_then(|p| p.get("used_percent"))
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite())
        .map(|v| v.clamp(0.0, 100.0) / 100.0);

    Some(CodexSnapshot { used, window, rate })
}

/// The directory a rollout file was recorded in.
///
/// It is the first record and it is `session_meta`, so unlike Claude's
/// transcripts this needs one line rather than a scan.
fn recorded_cwd(path: &std::path::Path) -> Option<String> {
    use std::io::BufRead;
    let file = std::fs::File::open(path).ok()?;
    let mut first = String::new();
    std::io::BufReader::new(file).read_line(&mut first).ok()?;
    let value: serde_json::Value = serde_json::from_str(&first).ok()?;
    value
        .get("payload")?
        .get("cwd")?
        .as_str()
        .map(|s| s.to_string())
}

/// Where Codex keeps its rollouts. Nested `YYYY/MM/DD`, unlike Claude's flat
/// per-project directories, so the walk is by depth rather than by name.
fn sessions_root() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(std::path::PathBuf::from(home).join(".codex/sessions"))
}

/// Every recently-written rollout recorded in `cwd`, newest first.
///
/// Only the day directories are descended into, and only those whose own mtime
/// is recent: a year of sessions is thousands of files and opening each to read
/// its first line on a 2 Hz poll would be the most expensive thing the daemon
/// does.
pub fn rollouts_for(
    root: &std::path::Path,
    cwd: &str,
    now: std::time::SystemTime,
) -> Vec<std::path::PathBuf> {
    let mut found: Vec<(std::time::SystemTime, std::path::PathBuf)> = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0u8)];

    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                // YYYY / MM / DD, and no deeper.
                if depth < 3 {
                    stack.push((path, depth + 1));
                }
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(modified) = meta.modified() else { continue };
            match now.duration_since(modified) {
                Ok(age) if age > super::context::RECENT_WINDOW => continue,
                _ => {}
            }
            if recorded_cwd(&path).as_deref() == Some(cwd) {
                found.push((modified, path));
            }
        }
    }

    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, path)| path).collect()
}

/// Context fill and rate limit for the Codex session running in `cwd`.
///
/// Ambiguity is reported as nothing, exactly as the Claude path does: two Codex
/// sessions in one directory cannot be told apart from outside, and attributing
/// one pane's context to another is worse than '--'.
pub fn reading(cwd: &str) -> Option<(Reading, Option<f64>)> {
    // As in context.rs: a hook that named its own rollout beats the scan and is
    // the only way past the ambiguous case.
    let path = match super::hint::transcript_for("codex", cwd) {
        Some(hinted) => hinted,
        None => {
            let root = sessions_root()?;
            let candidates = rollouts_for(&root, cwd, std::time::SystemTime::now());
            let [only] = candidates.as_slice() else {
                return None;
            };
            only.clone()
        }
    };
    let snapshot = scan_back(&path, snapshot_from_line)?;
    Some((
        Reading {
            fraction: snapshot.used as f64 / snapshot.window as f64,
            // Codex does not name the model in the token event, and the plate's
            // model field is for what was READ, never for what was assumed.
            model: String::new(),
        },
        snapshot.rate,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real `token_count` event, trimmed. Captured from
    /// ~/.codex/sessions/2026/09/01/rollout-…jsonl on 2026-09-01.
    const TOKEN_COUNT: &str = r#"{"timestamp":"2026-09-01T23:19:43.995Z","ordinal":17,
        "type":"event_msg","payload":{"type":"token_count","info":{
        "total_token_usage":{"input_tokens":18885,"cached_input_tokens":11008,
        "output_tokens":601,"total_tokens":19486},
        "last_token_usage":{"input_tokens":18885,"cached_input_tokens":11008,
        "output_tokens":601,"total_tokens":19486},
        "model_context_window":258400},
        "rate_limits":{"primary":{"used_percent":1.0,"window_minutes":300},
        "secondary":{"used_percent":0.0,"window_minutes":10080}}}}"#;

    #[test]
    fn reads_the_window_out_of_the_file_rather_than_a_table() {
        // The entire reason Codex needs no model registry: the denominator is
        // in the payload, so a new model cannot silently produce a wrong
        // percentage the way an out-of-date table does.
        let s = snapshot_from_line(TOKEN_COUNT).expect("a token_count event");
        assert_eq!(s.window, 258_400);
        assert_eq!(s.used, 19_486);
    }

    #[test]
    fn uses_the_last_turn_not_the_running_total() {
        // total_token_usage accumulates across the session and passes the
        // window on any long conversation; last_token_usage is the one that
        // describes what is in the context right now.
        let line = TOKEN_COUNT.replace(
            r#""total_token_usage":{"input_tokens":18885,"cached_input_tokens":11008,
        "output_tokens":601,"total_tokens":19486}"#,
            r#""total_token_usage":{"total_tokens":999999}"#,
        );
        assert_eq!(snapshot_from_line(&line).unwrap().used, 19_486);
    }

    #[test]
    fn carries_the_rate_limit_as_a_fraction() {
        // used_percent is 0..100 on the wire; the plate takes 0..1.
        assert_eq!(snapshot_from_line(TOKEN_COUNT).unwrap().rate, Some(0.01));
    }

    #[test]
    fn an_absent_rate_limit_is_unknown_rather_than_zero() {
        // Older payloads omit it. Zero would draw a confident, empty quota bar.
        let line = TOKEN_COUNT.replace(r#""rate_limits""#, r#""other_key""#);
        assert_eq!(snapshot_from_line(&line).unwrap().rate, None);
    }

    #[test]
    fn ignores_every_record_that_is_not_a_token_count() {
        // A rollout is mostly turns, tool calls and reasoning.
        assert!(snapshot_from_line(r#"{"payload":{"type":"session_meta"}}"#).is_none());
        assert!(snapshot_from_line(r#"{"payload":{"type":"agent_message"}}"#).is_none());
        assert!(snapshot_from_line("not json").is_none());
        assert!(snapshot_from_line("").is_none());
    }

    #[test]
    fn a_zero_window_is_refused_rather_than_dividing_by_it() {
        let line = TOKEN_COUNT.replace(r#""model_context_window":258400"#, r#""model_context_window":0"#);
        assert!(snapshot_from_line(&line).is_none());
    }

    /// `TOKEN_COUNT` as it appears on disk: one record, one line.
    ///
    /// The constant above is wrapped for reading. serde does not care, but a
    /// JSONL fixture does — the backwards scan splits on '\n', so a
    /// pretty-printed record becomes several unparseable fragments.
    fn one_line(s: &str) -> String {
        s.lines().map(str::trim).collect::<String>()
    }

    /// Build a fake ~/.codex/sessions tree: (relative dir, file, body) triples.
    fn fake_sessions(name: &str, entries: &[(&str, &str, &str)]) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("doom-term-codex-{}", name));
        std::fs::remove_dir_all(&root).ok();
        for (dir, file, body) in entries {
            let d = root.join(dir);
            std::fs::create_dir_all(&d).expect("session dir");
            std::fs::write(d.join(file), body).expect("rollout");
        }
        root
    }

    fn meta(cwd: &str) -> String {
        format!(
            r#"{{"type":"session_meta","payload":{{"cwd":"{}","id":"x"}}}}"#,
            cwd
        )
    }

    #[test]
    fn finds_a_rollout_by_the_directory_it_recorded() {
        // The nested YYYY/MM/DD layout is the difference from Claude's tree,
        // and the reason the walk is by depth rather than by directory name.
        let root = fake_sessions(
            "match",
            &[(
                "2026/09/01",
                "rollout-a.jsonl",
                &format!("{}\n{}\n", meta("/work/thing"), one_line(TOKEN_COUNT)),
            )],
        );
        let now = std::time::SystemTime::now();
        assert_eq!(rollouts_for(&root, "/work/thing", now).len(), 1);
        assert!(rollouts_for(&root, "/work/other", now).is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn two_codex_sessions_in_one_directory_are_ambiguous() {
        // Same rule as the Claude path: report nothing rather than attribute
        // one pane's context to another.
        let root = fake_sessions(
            "ambiguous",
            &[
                ("2026/09/01", "a.jsonl", &format!("{}\n", meta("/w"))),
                ("2026/09/01", "b.jsonl", &format!("{}\n", meta("/w"))),
            ],
        );
        assert_eq!(
            rollouts_for(&root, "/w", std::time::SystemTime::now()).len(),
            2
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_stale_rollout_does_not_describe_a_live_pane() {
        let root = fake_sessions(
            "stale",
            &[("2026/09/01", "old.jsonl", &format!("{}\n", meta("/w")))],
        );
        let later = std::time::SystemTime::now()
            + super::super::context::RECENT_WINDOW
            + std::time::Duration::from_secs(60);
        assert!(rollouts_for(&root, "/w", later).is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn scans_back_to_the_newest_token_count_past_later_records() {
        // Codex writes reasoning and tool records AFTER the token count, so the
        // answer is rarely the last line — the backwards scan has to skip them.
        let root = fake_sessions(
            "scan",
            &[(
                "2026/09/01",
                "r.jsonl",
                &format!(
                    "{}\n{}\n{}\n{}\n",
                    meta("/w"),
                    one_line(TOKEN_COUNT).replace("19486", "111"),
                    one_line(TOKEN_COUNT),
                    r#"{"payload":{"type":"agent_message","message":"done"}}"#
                ),
            )],
        );
        let path = root.join("2026/09/01/r.jsonl");
        assert_eq!(scan_back(&path, snapshot_from_line).unwrap().used, 19_486);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    #[ignore = "reads the real ~/.codex/sessions; run by hand"]
    fn probes_the_live_rollouts() {
        let cwd = std::env::var("DOOM_TERM_PROBE_CWD").unwrap_or_else(|_| {
            std::env::current_dir().unwrap().to_string_lossy().to_string()
        });
        println!("codex reading for {cwd}: {:?}", reading(&cwd));
    }
}
