//! Parses the bounded status response from Doom Term's opt-in remote helper.

use std::time::Duration;

use doomterm_plate::DiffStats;
use serde_json::Value;

use crate::agent_sessions::{AgentKind, AgentReport};

pub const IN_BAND_TITLE: &str = "DoomTerm Agent Status";

/// Claude Code runs its status line on events and Codex notifies when a turn ends, so an idle
/// agent sends nothing for long stretches while everything it last reported stays true. A report
/// is kept until its pane's command ends or another report replaces it; this bound only stops a
/// forgotten pane from showing an agent that left long ago.
const IN_BAND_MAX_AGE: Duration = Duration::from_secs(6 * 60 * 60);
/// How long a turn state can be believed without a newer event. An agent that died mid-turn never
/// sends the event that ends it, so its turn state expires on its own.
const TURN_STATE_MAX_AGE: Duration = Duration::from_secs(60);

/// How long an in-band report stays valid without an update.
pub fn in_band_max_age() -> Duration {
    IN_BAND_MAX_AGE
}

/// The turn state a report of the given age still supports.
pub fn in_band_working(working: Option<bool>, age: Duration) -> Option<bool> {
    if age > TURN_STATE_MAX_AGE {
        None
    } else {
        working
    }
}

/// Whether a pane may take an in-band report for `reported`. Over SSH the stream is the only
/// window into the remote agent. Locally, Claude Code and Codex are read from their own records,
/// so only an agent with no records is taken from the stream, and only while it is the pane's
/// foreground agent.
pub fn accepts_in_band(reported: AgentKind, on_ssh: bool, local_agent: Option<AgentKind>) -> bool {
    match reported {
        AgentKind::Other => false,
        AgentKind::Claude | AgentKind::Codex => on_ssh,
        AgentKind::Antigravity => on_ssh || local_agent == Some(AgentKind::Antigravity),
    }
}

pub fn encode_cwd(cwd: &str) -> String {
    cwd.as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn parse_report(bytes: &[u8]) -> Option<AgentReport> {
    if bytes.len() > 4096 {
        return None;
    }
    let value: Value = serde_json::from_slice(bytes).ok()?;
    let fraction = |name| match value.get(name)? {
        Value::Null => Some(None),
        Value::Number(number) => {
            let value = number.as_f64()?;
            (value.is_finite() && (0.0..=1.0).contains(&value)).then_some(Some(value as f32))
        }
        _ => None,
    };
    let working = match value.get("working")? {
        Value::Null => None,
        Value::Bool(value) => Some(*value),
        _ => return None,
    };
    Some(AgentReport {
        context: fraction("context")?,
        usage: fraction("usage")?,
        usage_resets_at: value.get("usage_resets_at").and_then(Value::as_u64),
        working,
        session: value.get("session").and_then(Value::as_u64),
    })
}

pub fn parse_in_band(bytes: &[u8]) -> Option<(AgentKind, AgentReport, Option<DiffStats>)> {
    if bytes.len() > 4096 {
        return None;
    }
    let value: Value = serde_json::from_slice(bytes).ok()?;
    let agent = match value.get("agent")?.as_str()? {
        "claude" => AgentKind::Claude,
        "codex" => AgentKind::Codex,
        "agy" => AgentKind::Antigravity,
        _ => return None,
    };
    let (report, diff) = parse_report_with_diff(bytes)?;
    Some((agent, report, diff))
}

pub fn parse_report_with_diff(bytes: &[u8]) -> Option<(AgentReport, Option<DiffStats>)> {
    if bytes.len() > 4096 {
        return None;
    }
    let value: Value = serde_json::from_slice(bytes).ok()?;
    let diff = match value.get("diff") {
        Some(Value::Object(diff)) => Some(DiffStats {
            added: u32::try_from(diff.get("added")?.as_u64()?).ok()?,
            removed: u32::try_from(diff.get("removed")?.as_u64()?).ok()?,
            files: u32::try_from(diff.get("files")?.as_u64()?).ok()?,
        }),
        None | Some(Value::Null) => None,
        Some(_) => return None,
    };
    Some((parse_report(bytes)?, diff))
}

#[cfg(test)]
#[path = "remote_status_tests.rs"]
mod tests;
