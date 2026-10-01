//! Binds a running agent process to its own session records and reads what those records
//! report: context-window fill, rate-limit consumption and whether a turn is in progress.
//!
//! Everything here reads local files the agents write themselves. Nothing is estimated: a
//! value the agent does not report stays `None` and the plate shows `--`.

use std::cmp::Reverse;
use std::collections::hash_map::DefaultHasher;
use std::fs::File;
use std::hash::{Hash, Hasher};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::DateTime;
use serde_json::Value;

/// Agents whose session records Doom Term knows how to read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentKind {
    Claude,
    Codex,
    /// Antigravity keeps no session records Doom Term can read; its status arrives only through
    /// the message its own status line sends.
    Antigravity,
    /// An agent that keeps no records Doom Term can read; it reports nothing.
    Other,
}

/// What an agent's own records say about its current session.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AgentReport {
    /// Fraction of the model's context window occupied by the last request.
    pub context: Option<f32>,
    /// Fraction consumed of the provider's five-hour session rate-limit window.
    pub usage: Option<f32>,
    /// Unix time, in seconds, at which the window `usage` belongs to resets.
    pub usage_resets_at: Option<u64>,
    /// Whether the agent says a turn is in progress. `None` when it does not say.
    pub working: Option<bool>,
    /// Identifies the conversation the report describes, for agents that can name one; a change
    /// means the numbers above belong to something new.
    pub session: Option<u64>,
}

/// Facts about the agent process that the readers use to find its records.
#[derive(Clone, Debug)]
pub struct AgentProcess {
    pub kind: AgentKind,
    pub pid: u32,
    pub cwd: Option<PathBuf>,
    pub started: Option<SystemTime>,
}

/// Largest tail of a transcript scanned for the newest usage record.
const MAX_TAIL_BYTES: u64 = 64 * 1024 * 1024;

/// Model id of the zero-usage records Claude Code writes after an API error or an interruption.
/// They describe no request, so they say nothing about how full the context is.
const SYNTHETIC_MODEL: &str = "<synthetic>";

/// A number that is the same for the same conversation record and differs between records.
fn identity(record: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    record.hash(&mut hasher);
    hasher.finish()
}

pub fn read_report(process: &AgentProcess, home: &Path) -> AgentReport {
    match process.kind {
        AgentKind::Claude => claude_report(process, &claude_home(home)),
        AgentKind::Codex => codex_report(process, &codex_home(home)),
        AgentKind::Antigravity | AgentKind::Other => AgentReport::default(),
    }
}

pub fn claude_home(home: &Path) -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".claude"))
}

pub fn codex_home(home: &Path) -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".codex"))
}

/// Context window, in tokens, for a Claude model id as it appears in transcripts.
///
/// Every current model has a 1M window; Haiku 4.5 and the older generations have 200K. Sonnet 4
/// and 4.5 are omitted on purpose: they run at 200K or, with an opt-in, 1M, and the transcript
/// does not say which, so their fill cannot be stated.
pub fn claude_context_window(model: &str) -> Option<u64> {
    const ONE_MILLION: &[&str] = &[
        "claude-fable-5",
        "claude-mythos-5",
        "claude-opus-5",
        "claude-opus-4-8",
        "claude-opus-4-7",
        "claude-opus-4-6",
        "claude-sonnet-5",
        "claude-sonnet-4-6",
    ];
    const TWO_HUNDRED_K: &[&str] = &[
        "claude-haiku-4-5",
        "claude-opus-4-5",
        "claude-opus-4-1",
        "claude-opus-4-0",
        "claude-opus-4-2",
        "claude-3",
    ];
    if ONE_MILLION.iter().any(|p| model.starts_with(p)) {
        Some(1_000_000)
    } else if TWO_HUNDRED_K.iter().any(|p| model.starts_with(p)) {
        Some(200_000)
    } else {
        None
    }
}

/// The project directory name Claude Code derives from a working directory.
pub fn claude_project_slug(cwd: &Path) -> String {
    cwd.to_string_lossy()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

fn claude_report(process: &AgentProcess, claude_home: &Path) -> AgentReport {
    // Claude Code writes `sessions/<pid>.json` for every interactive process, naming its session
    // and whether a turn is running.
    let Some(session) = read_json(
        &claude_home
            .join("sessions")
            .join(format!("{}.json", process.pid)),
    ) else {
        return AgentReport::default();
    };
    let working = match session.get("status").and_then(Value::as_str) {
        Some("busy") => Some(true),
        Some("idle") => Some(false),
        _ => None,
    };
    let session_id = session.get("sessionId").and_then(Value::as_str);
    let context = session_id
        .and_then(|id| {
            let cwd = session
                .get("cwd")
                .and_then(Value::as_str)
                .map(PathBuf::from)
                .or_else(|| process.cwd.clone())?;
            find_claude_transcript(claude_home, &cwd, id)
        })
        .and_then(|transcript| claude_context_from_transcript(&transcript));
    AgentReport {
        context,
        working,
        session: session_id.map(identity),
        ..AgentReport::default()
    }
}

fn find_claude_transcript(claude_home: &Path, cwd: &Path, session_id: &str) -> Option<PathBuf> {
    let projects = claude_home.join("projects");
    let file = format!("{session_id}.jsonl");
    let direct = projects.join(claude_project_slug(cwd)).join(&file);
    if direct.is_file() {
        return Some(direct);
    }
    // The slug rule has changed between releases; the session id is unique either way.
    std::fs::read_dir(&projects)
        .ok()?
        .flatten()
        .map(|entry| entry.path().join(&file))
        .find(|candidate| candidate.is_file())
}

/// Context fill from the newest main-thread assistant turn of a Claude transcript.
pub fn claude_context_from_transcript(path: &Path) -> Option<f32> {
    let record = scan_backwards(path, |record| {
        record.get("type").and_then(Value::as_str) == Some("assistant")
            && record.get("isSidechain").and_then(Value::as_bool) != Some(true)
            && record.pointer("/message/model").and_then(Value::as_str) != Some(SYNTHETIC_MODEL)
            && record.pointer("/message/usage").is_some()
    })?;
    let usage = record.pointer("/message/usage")?;
    let tokens: u64 = [
        "input_tokens",
        "cache_read_input_tokens",
        "cache_creation_input_tokens",
    ]
    .iter()
    .filter_map(|key| usage.get(key).and_then(Value::as_u64))
    .sum();
    let window = claude_context_window(record.pointer("/message/model")?.as_str()?)?;
    Some((tokens as f64 / window as f64).clamp(0.0, 1.0) as f32)
}

fn codex_report(process: &AgentProcess, codex_home: &Path) -> AgentReport {
    let Some(rollout) = find_codex_rollout(process, codex_home) else {
        return AgentReport::default();
    };
    AgentReport {
        session: Some(identity(&rollout.to_string_lossy())),
        ..codex_report_from_rollout(&rollout)
    }
}

/// Reads a Codex rollout: `token_count` events carry the last request's token use, the model's
/// window and the account's rate-limit windows; task events bracket each turn.
///
/// Context, usage and turn state each come from the newest event that states them. Real events
/// often carry only the weekly window, or no token info at all, so one event cannot serve all three.
pub fn codex_report_from_rollout(path: &Path) -> AgentReport {
    let token_info = |record: &Value| {
        is_token_count(record)
            && record
                .pointer("/payload/info")
                .is_some_and(|info| !info.is_null())
    };
    let session_limits =
        |record: &Value| is_token_count(record) && session_window(record).is_some();
    let turn_event = |record: &Value| {
        matches!(
            record.pointer("/payload/type").and_then(Value::as_str),
            Some("task_started" | "task_complete" | "turn_aborted")
        )
    };
    let [token_event, limits_event, turn] =
        scan_backwards_collect(path, [&token_info, &session_limits, &turn_event]);

    let context = token_event.as_ref().and_then(|event| {
        let info = event.pointer("/payload/info")?;
        let used = info.pointer("/last_token_usage/total_tokens")?.as_u64()?;
        let window = info
            .get("model_context_window")?
            .as_u64()
            .filter(|w| *w > 0)?;
        Some((used as f64 / window as f64).clamp(0.0, 1.0) as f32)
    });
    let window = limits_event.as_ref().and_then(session_window);
    let usage = window
        .and_then(|window| window.get("used_percent")?.as_f64())
        .map(|percent| (percent / 100.0).clamp(0.0, 1.0) as f32);
    let usage_resets_at = window.and_then(|window| window.get("resets_at")?.as_u64());
    let working = turn.and_then(|record| {
        record
            .pointer("/payload/type")?
            .as_str()
            .map(|t| t == "task_started")
    });
    AgentReport {
        context,
        usage,
        usage_resets_at,
        working,
        session: None,
    }
}

fn is_token_count(record: &Value) -> bool {
    record.pointer("/payload/type").and_then(Value::as_str) == Some("token_count")
}

/// The five-hour (300 minute) rate-limit window of a `token_count` event, if it carries one.
fn session_window(event: &Value) -> Option<&Value> {
    let limits = event.pointer("/payload/rate_limits")?;
    ["primary", "secondary"]
        .iter()
        .filter_map(|key| limits.get(key))
        .find(|window| {
            window.get("window_minutes").and_then(Value::as_u64) == Some(300)
                && window.get("used_percent").is_some_and(Value::is_number)
        })
}

fn find_codex_rollout(process: &AgentProcess, codex_home: &Path) -> Option<PathBuf> {
    #[cfg(target_os = "linux")]
    if let Some(open) = open_rollout(process.pid) {
        return Some(open);
    }
    newest_rollout_for(process, &codex_home.join("sessions"))
}

/// The rollout file a running Codex process holds open, if it holds one.
#[cfg(target_os = "linux")]
fn open_rollout(pid: u32) -> Option<PathBuf> {
    std::fs::read_dir(format!("/proc/{pid}/fd"))
        .ok()?
        .flatten()
        .filter_map(|fd| std::fs::read_link(fd.path()).ok())
        .find(|target| {
            target
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("rollout-") && n.ends_with(".jsonl"))
        })
}

/// The newest rollout started in the process's directory no earlier than the process itself.
fn newest_rollout_for(process: &AgentProcess, sessions: &Path) -> Option<PathBuf> {
    let started = process.started?;
    let cwd = process.cwd.as_ref()?;
    let cutoff_ms = started
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis()
        .saturating_sub(3_000);
    let mut candidates: Vec<(i64, SystemTime, PathBuf)> = walk_rollouts(sessions)
        .into_iter()
        .filter_map(|path| {
            let modified = std::fs::metadata(&path).ok()?.modified().ok()?;
            if modified < started {
                return None;
            }
            let meta = first_record(&path)?;
            let recorded = meta.pointer("/payload/cwd")?.as_str()?;
            if Path::new(recorded) != cwd {
                return None;
            }
            let created = DateTime::parse_from_rfc3339(meta.get("timestamp")?.as_str()?)
                .ok()?
                .timestamp_millis();
            (u128::try_from(created).ok()? >= cutoff_ms).then_some((created, modified, path))
        })
        .collect();
    candidates.sort_by_key(|candidate| Reverse((candidate.0, candidate.1)));
    candidates.into_iter().map(|(_, _, path)| path).next()
}

/// Rollouts live under `sessions/YYYY/MM/DD/`; only the three newest days are considered.
fn walk_rollouts(sessions: &Path) -> Vec<PathBuf> {
    fn newest_dirs(dir: &Path, keep: usize) -> Vec<PathBuf> {
        let mut dirs: Vec<PathBuf> = std::fs::read_dir(dir)
            .map(|entries| {
                entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| p.is_dir())
                    .collect()
            })
            .unwrap_or_default();
        dirs.sort();
        dirs.into_iter().rev().take(keep).collect()
    }
    let mut days = Vec::new();
    for year in newest_dirs(sessions, 2) {
        for month in newest_dirs(&year, 2) {
            days.extend(newest_dirs(&month, 3));
        }
    }
    days.sort();
    days.into_iter()
        .rev()
        .take(3)
        .flat_map(|day| {
            std::fs::read_dir(day)
                .map(|entries| entries.flatten().map(|e| e.path()).collect::<Vec<_>>())
                .unwrap_or_default()
        })
        .filter(|p| p.extension().is_some_and(|e| e == "jsonl"))
        .collect()
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

fn first_record(path: &Path) -> Option<Value> {
    let mut buf = vec![0u8; 64 * 1024];
    let n = File::open(path).ok()?.read(&mut buf).ok()?;
    let line = buf[..n].split(|b| *b == b'\n').next()?;
    serde_json::from_slice(line).ok()
}

/// Returns the newest JSON line in `path` that satisfies `matches`, reading the file backwards
/// in growing chunks so a long transcript is not read whole to find its last turn.
pub fn scan_backwards(path: &Path, matches: impl Fn(&Value) -> bool) -> Option<Value> {
    let [found] = scan_backwards_collect(path, [&matches]);
    found
}

/// Like [`scan_backwards`] for several questions at once: each matcher gets the newest line that
/// satisfies it, and the file is read only as far back as the last of them needs.
pub fn scan_backwards_collect<const N: usize>(
    path: &Path,
    matchers: [&dyn Fn(&Value) -> bool; N],
) -> [Option<Value>; N] {
    let mut found: [Option<Value>; N] = std::array::from_fn(|_| None);
    let Ok(mut file) = File::open(path) else {
        return found;
    };
    let Ok(len) = file.metadata().map(|metadata| metadata.len()) else {
        return found;
    };
    let mut window = 256 * 1024u64;
    loop {
        let start = len.saturating_sub(window);
        let mut buf = Vec::with_capacity((len - start) as usize);
        if file.seek(SeekFrom::Start(start)).is_err()
            || file
                .by_ref()
                .take(len - start)
                .read_to_end(&mut buf)
                .is_err()
        {
            return found;
        }
        let mut lines: Vec<&[u8]> = buf.split(|b| *b == b'\n').collect();
        if start > 0 {
            // The first line of a mid-file window is usually a fragment.
            lines.remove(0);
        }
        for line in lines.into_iter().rev() {
            let Ok(record) = serde_json::from_slice::<Value>(line) else {
                continue;
            };
            for (slot, matches) in found.iter_mut().zip(&matchers) {
                if slot.is_none() && matches(&record) {
                    *slot = Some(record.clone());
                }
            }
            if found.iter().all(Option::is_some) {
                return found;
            }
        }
        if start == 0 || window >= MAX_TAIL_BYTES {
            return found;
        }
        window *= 4;
    }
}

#[cfg(test)]
#[path = "agent_sessions_tests.rs"]
mod tests;
