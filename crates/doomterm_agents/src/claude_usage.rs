//! Claude's rate-limit consumption, read from Anthropic's usage endpoint.
//!
//! Claude Code keeps no local record of its rate limits, so this is the one status-plate value
//! that needs a network request. It is only made when the user turns on
//! `ClaudeUsageLookupEnabled`, uses the login Claude Code already stored, and sends nothing but
//! that token to `api.anthropic.com`.

use std::path::Path;
use std::time::Duration;

use serde_json::Value;

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA: &str = "oauth-2025-04-20";
const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, thiserror::Error)]
pub enum ClaudeUsageError {
    #[error("no Claude Code login was found")]
    NotLoggedIn,
    #[error("the usage request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("the usage endpoint answered {0}")]
    Status(u16),
    #[error("the usage response had no rate-limit windows")]
    Unrecognised,
}

/// Fraction of the tightest Claude rate-limit window already consumed.
pub async fn fetch(claude_home: &Path) -> Result<f32, ClaudeUsageError> {
    let token = access_token(claude_home).ok_or(ClaudeUsageError::NotLoggedIn)?;
    let response = reqwest::Client::new()
        .get(USAGE_URL)
        .bearer_auth(token)
        .header("anthropic-beta", OAUTH_BETA)
        .timeout(TIMEOUT)
        .send()
        .await?;
    let status = response.status();
    if !status.is_success() {
        return Err(ClaudeUsageError::Status(status.as_u16()));
    }
    let body: Value = response.json().await?;
    tightest_window(&body).ok_or(ClaudeUsageError::Unrecognised)
}

/// The largest utilisation among the five-hour and weekly windows, as a fraction.
///
/// The plate has room for one number, and the window nearest its limit is the one that will stop
/// work first.
pub fn tightest_window(body: &Value) -> Option<f32> {
    ["five_hour", "seven_day"]
        .iter()
        .filter_map(|window| body.get(window)?.get("utilization")?.as_f64())
        .reduce(f64::max)
        .map(|percent| (percent / 100.0).clamp(0.0, 1.0) as f32)
}

/// The OAuth access token Claude Code stored at login.
fn access_token(claude_home: &Path) -> Option<String> {
    let from_file = std::fs::read(claude_home.join(".credentials.json"))
        .ok()
        .and_then(|bytes| token_from_credentials(&bytes));
    #[cfg(target_os = "macos")]
    let from_file = from_file.or_else(keychain_credentials);
    from_file
}

/// Claude Code on macOS keeps its credentials in the login keychain rather than a file.
#[cfg(target_os = "macos")]
fn keychain_credentials() -> Option<String> {
    let output = command::blocking::Command::new("/usr/bin/security")
        .args([
            "find-generic-password",
            "-s",
            "Claude Code-credentials",
            "-w",
        ])
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| token_from_credentials(&output.stdout))
        .flatten()
}

/// Reads `claudeAiOauth.accessToken`. Other token entries in the file (for example MCP servers'
/// OAuth tokens) are not Claude logins and must not be used.
pub fn token_from_credentials(bytes: &[u8]) -> Option<String> {
    let credentials: Value = serde_json::from_slice(bytes).ok()?;
    credentials
        .pointer("/claudeAiOauth/accessToken")?
        .as_str()
        .filter(|token| !token.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
#[path = "claude_usage_tests.rs"]
mod tests;
