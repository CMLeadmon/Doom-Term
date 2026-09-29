//! Binds a running agent process to its own session records and reads what those records
//! report: context-window fill, rate-limit consumption and whether a turn is in progress.
//!
//! Everything here reads local files the agents write themselves. Nothing is estimated: a
//! value the agent does not report stays `None` and the plate shows `--`.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde_json::Value;

/// Agents whose session records Doom Term knows how to read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentKind {
    Claude,
    Codex,
    /// An agent that keeps no records Doom Term can read; it reports nothing.
    Other,
}

/// What an agent's own records say about its current session.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AgentReport {
    /// Fraction of the model's context window occupied by the last request.
    pub context: Option<f32>,
    /// Fraction consumed of the provider rate-limit window closest to its limit.
    pub usage: Option<f32>,
    /// Whether the agent says a turn is in progress. `None` when it does not say.
    pub working: Option<bool>,
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

pub fn read_report(process: &AgentProcess, home: &Path) -> AgentReport {
    match process.kind {
        AgentKind::Claude => claude_report(process, &claude_home(home)),
        AgentKind::Codex => codex_report(process, &codex_home(home)),
        AgentKind::Other => AgentReport::default(),
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
    let context = session
        .get("sessionId")
        .and_then(Value::as_str)
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
        usage: None,
        working,
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
    codex_report_from_rollout(&rollout)
}

/// Reads a Codex rollout: `token_count` events carry the last request's token use, the model's
/// window and the account's rate-limit windows; task events bracket each turn.
pub fn codex_report_from_rollout(path: &Path) -> AgentReport {
    let token_event = scan_backwards(path, |record| {
        record.pointer("/payload/type").and_then(Value::as_str) == Some("token_count")
            && record
                .pointer("/payload/info")
                .is_some_and(|info| !info.is_null())
    });
    let context = token_event.as_ref().and_then(|event| {
        let info = event.pointer("/payload/info")?;
        let used = info.pointer("/last_token_usage/total_tokens")?.as_u64()?;
        let window = info
            .get("model_context_window")?
            .as_u64()
            .filter(|w| *w > 0)?;
        Some((used as f64 / window as f64).clamp(0.0, 1.0) as f32)
    });
    let usage = token_event.as_ref().and_then(|event| {
        let limits = event.pointer("/payload/rate_limits")?;
        ["primary", "secondary"]
            .iter()
            .filter_map(|window| limits.get(window)?.get("used_percent")?.as_f64())
            .reduce(f64::max)
            .map(|percent| (percent / 100.0).clamp(0.0, 1.0) as f32)
    });
    let working = scan_backwards(path, |record| {
        matches!(
            record.pointer("/payload/type").and_then(Value::as_str),
            Some("task_started" | "task_complete" | "turn_aborted")
        )
    })
    .and_then(|record| {
        record
            .pointer("/payload/type")?
            .as_str()
            .map(|t| t == "task_started")
    });
    AgentReport {
        context,
        usage,
        working,
    }
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
    let mut candidates: Vec<(SystemTime, PathBuf)> = walk_rollouts(sessions)
        .into_iter()
        .filter_map(|path| {
            let modified = std::fs::metadata(&path).ok()?.modified().ok()?;
            (modified >= started).then_some((modified, path))
        })
        .collect();
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates.into_iter().map(|(_, path)| path).find(|path| {
        first_record(path)
            .and_then(|meta| meta.pointer("/payload/cwd")?.as_str().map(PathBuf::from))
            .is_some_and(|recorded| &recorded == cwd)
    })
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
    let mut file = File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let mut window = 256 * 1024u64;
    loop {
        let start = len.saturating_sub(window);
        file.seek(SeekFrom::Start(start)).ok()?;
        let mut buf = Vec::with_capacity((len - start) as usize);
        file.by_ref().take(len - start).read_to_end(&mut buf).ok()?;
        let mut lines: Vec<&[u8]> = buf.split(|b| *b == b'\n').collect();
        if start > 0 {
            // The first line of a mid-file window is usually a fragment.
            lines.remove(0);
        }
        for line in lines.into_iter().rev() {
            if line.is_empty() {
                continue;
            }
            if let Ok(record) = serde_json::from_slice::<Value>(line)
                && matches(&record)
            {
                return Some(record);
            }
        }
        if start == 0 || window >= MAX_TAIL_BYTES {
            return None;
        }
        window *= 4;
    }
}

#[cfg(test)]
#[path = "agent_sessions_tests.rs"]
mod tests;
