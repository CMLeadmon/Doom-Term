//! CONTEXT % and USAGE % for Antigravity (agy), read from its conversation logs and settings.

use super::context::Reading;

/// Computes the context fraction and rate limit for Antigravity in `cwd`.
pub fn reading(cwd: &str) -> Option<(Reading, Option<f64>)> {
    let home = std::env::var("HOME").ok()?;
    let cli_dir = std::path::PathBuf::from(home).join(".gemini/antigravity-cli");

    // 1. Read configured model from settings.json or default to Gemini Flash
    let settings_path = cli_dir.join("settings.json");
    let model = std::fs::read_to_string(&settings_path)
        .ok()
        .and_then(|data| serde_json::from_str::<serde_json::Value>(&data).ok())
        .and_then(|v| v.get("model").and_then(|m| m.as_str()).map(|s| s.to_string()))
        .unwrap_or_else(|| "Gemini Flash".to_string());

    // 2. Find conversation matching cwd in history.jsonl
    let history_path = cli_dir.join("history.jsonl");
    let history_content = std::fs::read_to_string(&history_path).ok()?;

    let mut conv_id: Option<String> = None;
    let mut recent_requests = 0u64;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    for line in history_content.lines().rev() {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
            let ts = val.get("timestamp").and_then(|t| t.as_u64()).unwrap_or(0);
            if now_ms.saturating_sub(ts) < 5 * 3600 * 1000 {
                recent_requests += 1;
            }
            if conv_id.is_none() {
                if let Some(workspace) = val.get("workspace").and_then(|w| w.as_str()) {
                    if workspace == cwd || cwd.starts_with(workspace) || workspace.starts_with(cwd) {
                        if let Some(id) = val.get("conversationId").and_then(|i| i.as_str()) {
                            conv_id = Some(id.to_string());
                        }
                    }
                }
            }
        }
    }

    let conv_id = conv_id?;
    let transcript_path = cli_dir
        .join("brain")
        .join(&conv_id)
        .join(".system_generated/logs/transcript.jsonl");

    let meta = std::fs::metadata(&transcript_path).ok()?;
    let bytes = meta.len();
    if bytes == 0 {
        return None;
    }

    // Window: Gemini 1M tokens by default
    let window: u64 = if model.to_lowercase().contains("pro") {
        2_000_000
    } else {
        1_048_576
    };

    // Token estimation (~3.8 bytes per token in JSONL with thinking and tool calls)
    let tokens = (bytes as f64 / 3.8).round() as u64;
    let fraction = (tokens as f64 / window as f64).min(1.0);

    // Rate limit window: typical tier allows ~100 interactions per 5h window
    let rate = if recent_requests > 0 {
        Some(((recent_requests as f64) / 100.0).min(1.0))
    } else {
        None
    };

    Some((Reading { fraction, model }, rate))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reading_returns_none_for_nonexistent_workspace() {
        let result = reading("/nonexistent/directory/that/does/not/exist");
        assert!(result.is_none());
    }

    #[test]
    fn reading_finds_real_antigravity_if_configured() {
        if let Ok(cwd) = std::env::current_dir() {
            let cwd_str = cwd.to_string_lossy();
            if let Some((reading, _)) = reading(&cwd_str) {
                assert!(reading.fraction >= 0.0 && reading.fraction <= 1.0);
                assert!(!reading.model.is_empty());
            }
        }
    }
}
