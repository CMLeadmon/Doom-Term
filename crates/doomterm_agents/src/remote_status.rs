//! Parses the bounded status response from Doom Term's opt-in remote helper.

use doomterm_plate::DiffStats;
use serde_json::Value;

use crate::agent_sessions::{AgentKind, AgentReport};

pub const IN_BAND_TITLE: &str = "DoomTerm Agent Status";

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
        working,
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
