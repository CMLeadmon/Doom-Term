//! Parses the bounded status response from Doom Term's opt-in remote helper.

use serde_json::Value;

use crate::agent_sessions::AgentReport;

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

#[cfg(test)]
#[path = "remote_status_tests.rs"]
mod tests;
