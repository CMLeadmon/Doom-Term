use serde_json::json;

use super::{session_window, token_from_credentials};

#[test]
fn the_five_hour_window_is_reported() {
    // Shape observed from the live endpoint on 2026-09-27, trimmed.
    let body = json!({
        "five_hour": { "utilization": 37.0, "resets_at": "2026-09-28T07:59:59Z" },
        "seven_day": { "utilization": 90.0, "resets_at": "2026-09-30T01:59:59Z" },
        "seven_day_opus": null,
        "extra_usage": { "utilization": null },
    });
    assert_eq!(session_window(&body), Some(0.37));
}

#[test]
fn a_missing_window_is_skipped_and_none_means_unknown() {
    assert_eq!(
        session_window(&json!({ "five_hour": { "utilization": 12.0 }, "seven_day": null })),
        Some(0.12)
    );
    assert_eq!(
        session_window(&json!({ "five_hour": null, "seven_day": null })),
        None
    );
    assert_eq!(session_window(&json!({})), None);
    assert_eq!(
        session_window(&json!({ "five_hour": { "utilization": 180.0 } })),
        Some(1.0)
    );
}

#[test]
fn only_the_claude_login_token_is_used() {
    let file = json!({
        "mcpOAuth": { "some-server": { "accessToken": "mcp-token" } },
        "claudeAiOauth": { "accessToken": "claude-token", "refreshToken": "r" },
    });
    assert_eq!(
        token_from_credentials(file.to_string().as_bytes()).as_deref(),
        Some("claude-token")
    );
    let mcp_only = json!({ "mcpOAuth": { "s": { "accessToken": "mcp-token" } } });
    assert_eq!(
        token_from_credentials(mcp_only.to_string().as_bytes()),
        None
    );
    assert_eq!(token_from_credentials(b"not json"), None);
}
