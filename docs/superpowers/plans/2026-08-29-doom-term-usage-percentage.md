# USAGE Percentage — Daemon-Side Implementation Plan

> **STATUS: implemented 2026-08-29** on `clean-slate`, commits `a203df1`..`4c116bf`.
> Verified live end-to-end: with `claude` in a session's foreground the daemon
> reported `agent_key: "claude"`, `rate_used: 0.63` → the plate renders `63%`.
> One step was NOT run — see "Deviations" at the foot of this file.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the plate's `USAGE` slot report the real fraction of the Claude account's rate limit that has been consumed, read from Anthropic's own OAuth usage endpoint — and keep rendering `--` whenever that number is genuinely unknown.

**Architecture:** The daemon reads the access token the Claude CLI already wrote to `~/.claude/.credentials.json`, calls `GET https://api.anthropic.com/api/oauth/usage`, and maps the returned `limits[]` array to a single 0..1 fraction. The fetch happens on a background timer behind a poll gate and lands in an in-memory cache; `GetTelemetry` only ever reads that cache, so the 2 Hz telemetry poll never waits on the network. The fraction rides the existing `Telemetry` wire message as `rate_used: Option<f64>` into the existing `AppTelemetry.rateUsed`, which `pct()` already renders.

**Tech Stack:** Rust (tokio, serde_json, parking_lot, ureq 3.4 + rustls), TypeScript/React frontend, existing WebSocket wire protocol.

**Branch:** `clean-slate` (current, clean). Do not work on `main`.

**Evidence base:** This is a port of nodeterm's solved implementation, read directly at
`/home/cleadmon/Projects/WindowsNodeTerm/nodeterm`:
- `src/core/usage/claude-usage-map.ts` — the payload → limits mapping, and the three
  absent-means-unknown rules reproduced below
- `src/core/usage/usage-service.ts` — cache + poll gate
- `src/core/usage/remote-claude-usage.ts` — the `claudeAiOauth` / MCP-token trap, documented
  there because the shell version had to `grep` for it

---

## Global Constraints

These apply to every task. They are the project's existing charter, not new rules.

- **Every displayed datum must be observed, never invented.** No heuristic, no
  extrapolation, no "reasonable default" for a number we did not receive.
- **Unknown renders `--`, never `0%`.** Every failure path returns `None`. `pct()` in
  `src/hud/state.ts` already does the right thing with `undefined`; do not weaken it.
- **The token never crosses the WebSocket, never enters a log line, and never appears in an
  error message.** Only the derived fraction leaves the daemon.
- **Never write to `~/.claude/.credentials.json`.** The CLI rotates those tokens itself;
  rewriting the file logs out a live `claude` session. Read-only, always.
- **One hardcoded URL.** Requests go to `https://api.anthropic.com/api/oauth/usage` and
  nowhere else. No configurable endpoint, no redirect following.
- **`GetTelemetry` must never await the network.** It is polled every 2 s from `App.tsx`.
- **No new fabricated telemetry.** This plan adds exactly one field. `contextUsed`, `tokens`
  and `shellMetrics` stay absent and stay `--`; they are a separate piece of work.

---

## File Structure

```
backend/Cargo.toml                 modify  — add ureq
backend/src/main.rs                modify  — `mod usage;`, spawn refresh task, add wire field
backend/src/usage/mod.rs           create  — module surface, re-exports
backend/src/usage/limits.rs        create  — PURE payload → Vec<UsageLimit> → Option<f64>
backend/src/usage/credentials.rs   create  — PURE token parse + path resolution
backend/src/usage/service.rs       create  — ureq fetch, cache, poll gate
src/types/terminal.ts              modify  — SystemTelemetryData.rate_used
src/hooks/usePtyEvents.ts          modify  — map rate_used → AppTelemetry.rateUsed
src/hooks/usePtyEvents.test.ts     create  — telemetry mapping, incl. the null case
```

`limits.rs` and `credentials.rs` are pure — no fs, no network — which is what makes them
unit-testable without fixtures on disk or a live account. All impure work is confined to
`service.rs`. This mirrors the boundary nodeterm draws between `core/usage/*` and its shell.

`usage/` lives in `backend/src/` rather than `crates/doom-term-pty/` because it has nothing to
do with PTYs, and only the daemon needs it.

---

### Task 1: Pure limit mapping

The payload shape, verbatim from `claude-usage-map.ts`: current responses carry a generic
`limits[]` array where each entry has `kind`, `percent` (a portion **used**, 0–100),
`severity`, `resets_at`, `is_active`, and an optional `scope.model.display_name`. Older
payloads instead carry fixed top-level `five_hour` / `seven_day` objects with `utilization`.

**Files:**
- Create: `backend/src/usage/limits.rs`
- Create: `backend/src/usage/mod.rs`
- Modify: `backend/src/main.rs` (add `mod usage;` near the other module declarations)

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `pub struct UsageLimit { pub kind: String, pub used_percent: f64, pub is_active: bool }`,
  `pub fn map_limits(body: &serde_json::Value) -> Vec<UsageLimit>`,
  `pub fn reportable_fraction(limits: &[UsageLimit]) -> Option<f64>`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/usage/limits.rs` containing ONLY the test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_the_current_limits_array() {
        let body = json!({
            "limits": [
                { "kind": "session", "percent": 12.5, "is_active": true },
                { "kind": "weekly_all", "percent": 40.0, "is_active": false }
            ]
        });
        let limits = map_limits(&body);
        assert_eq!(limits.len(), 2);
        assert_eq!(limits[0].kind, "session");
        assert_eq!(limits[0].used_percent, 12.5);
        assert!(limits[0].is_active);
    }

    #[test]
    fn clamps_out_of_range_percentages() {
        // The server is not our validator.
        let body = json!({ "limits": [ { "kind": "session", "percent": 140.0 } ] });
        assert_eq!(map_limits(&body)[0].used_percent, 100.0);
        let body = json!({ "limits": [ { "kind": "session", "percent": -5.0 } ] });
        assert_eq!(map_limits(&body)[0].used_percent, 0.0);
    }

    #[test]
    fn skips_entries_with_no_usable_percentage() {
        let body = json!({
            "limits": [
                { "kind": "session" },
                { "percent": 10.0 },
                { "kind": "weekly_all", "percent": 10.0 }
            ]
        });
        // No percent, and no kind, are both unusable; only the third survives.
        assert_eq!(map_limits(&body).len(), 1);
    }

    #[test]
    fn absent_is_active_means_unknown_not_active() {
        let body = json!({ "limits": [ { "kind": "session", "percent": 10.0 } ] });
        assert!(!map_limits(&body)[0].is_active);
    }

    #[test]
    fn falls_back_to_the_legacy_fixed_windows() {
        let body = json!({
            "five_hour": { "utilization": 30.0 },
            "seven_day": { "utilization": 55.0 }
        });
        let limits = map_limits(&body);
        assert_eq!(limits.len(), 2);
        assert_eq!(limits[0].kind, "session");
        assert_eq!(limits[1].used_percent, 55.0);
    }

    #[test]
    fn prefers_the_limits_array_over_legacy_fields() {
        let body = json!({
            "limits": [ { "kind": "session", "percent": 7.0 } ],
            "five_hour": { "utilization": 99.0 }
        });
        assert_eq!(map_limits(&body).len(), 1);
        assert_eq!(map_limits(&body)[0].used_percent, 7.0);
    }

    #[test]
    fn reports_the_active_limit_when_one_is_flagged() {
        let limits = vec![
            UsageLimit { kind: "session".into(), used_percent: 20.0, is_active: true },
            UsageLimit { kind: "weekly_all".into(), used_percent: 80.0, is_active: false },
        ];
        // The flagged window is the one currently gating requests.
        assert_eq!(reportable_fraction(&limits), Some(0.2));
    }

    #[test]
    fn reports_the_worst_limit_when_none_is_flagged() {
        let limits = vec![
            UsageLimit { kind: "session".into(), used_percent: 20.0, is_active: false },
            UsageLimit { kind: "weekly_all".into(), used_percent: 80.0, is_active: false },
        ];
        // One slot on the plate, so it shows the constraint about to bite.
        assert_eq!(reportable_fraction(&limits), Some(0.8));
    }

    #[test]
    fn reports_nothing_for_an_empty_limit_list() {
        // An account on API-key billing has no subscription window. That is
        // '--', not 0%.
        assert_eq!(reportable_fraction(&[]), None);
    }

    #[test]
    fn reports_nothing_for_a_body_that_is_not_a_usage_payload() {
        assert_eq!(map_limits(&json!({ "error": "nope" })).len(), 0);
        assert_eq!(map_limits(&json!("captive portal")).len(), 0);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "/var/home/cleadmon/Projects/Doom Term" && cargo test --manifest-path backend/Cargo.toml usage::
```

Expected: FAIL — `cannot find function map_limits`, `cannot find type UsageLimit`.

- [ ] **Step 3: Write the implementation**

Prepend to `backend/src/usage/limits.rs`, above the test module:

```rust
//! Pure mapping of Anthropic's `/api/oauth/usage` payload into the single
//! fraction the plate's USAGE slot renders.
//!
//! No fs, no network — every impure step lives in `service.rs`. The payload
//! carries the same facts twice: a generic `limits[]` array (current) and a set
//! of fixed top-level windows (legacy). We prefer the array and treat the model
//! name as DATA, never as a field name, so a new model's quota arrives as
//! another array entry and this file does not change.

use serde_json::Value;

/// One rate-limit window the account is subject to.
#[derive(Debug, Clone, PartialEq)]
pub struct UsageLimit {
    pub kind: String,
    /// Portion USED, 0..100 — matching the wire, so a reader comparing this
    /// file to the payload is not also doing arithmetic in their head.
    pub used_percent: f64,
    /// Is this the window currently gating requests? Absent on the wire means
    /// UNKNOWN, not inactive — an older payload that omits the field must not
    /// have every limit silently treated as dormant.
    pub is_active: bool,
}

/// `percent`/`utilization` are portions used, 0–100. Clamp: the server is not
/// our validator, and a 140% window must not render as 140%.
fn clamp_percent(v: Option<&Value>) -> Option<f64> {
    let n = v?.as_f64()?;
    if !n.is_finite() {
        return None;
    }
    Some(n.clamp(0.0, 100.0))
}

fn map_limit(raw: &Value) -> Option<UsageLimit> {
    let kind = raw.get("kind")?.as_str()?;
    if kind.is_empty() {
        return None;
    }
    let used_percent = clamp_percent(raw.get("percent"))?;
    Some(UsageLimit {
        kind: kind.to_string(),
        used_percent,
        is_active: raw.get("is_active").and_then(Value::as_bool) == Some(true),
    })
}

/// Reconstruct the two windows older payloads ever populated. The per-model
/// top-level fields are dead in current responses and are deliberately not
/// resurrected here.
fn legacy_limits(body: &Value) -> Vec<UsageLimit> {
    let mut out = Vec::new();
    for (field, kind) in [("five_hour", "session"), ("seven_day", "weekly_all")] {
        let Some(w) = body.get(field) else { continue };
        let used = clamp_percent(w.get("utilization").or_else(|| w.get("used_percentage")));
        if let Some(used_percent) = used {
            out.push(UsageLimit {
                kind: kind.to_string(),
                used_percent,
                is_active: false,
            });
        }
    }
    out
}

/// Normalize a raw `/api/oauth/usage` body into the limit list.
pub fn map_limits(body: &Value) -> Vec<UsageLimit> {
    if let Some(arr) = body.get("limits").and_then(Value::as_array) {
        let mapped: Vec<UsageLimit> = arr.iter().filter_map(map_limit).collect();
        if !mapped.is_empty() {
            return mapped;
        }
    }
    legacy_limits(body)
}

/// The one number the plate shows, as a 0..1 fraction.
///
/// The plate has a single USAGE slot, so it must pick one of several windows.
/// A window the server flagged `is_active` is the one currently gating
/// requests and wins outright; otherwise the WORST window wins, because that is
/// the constraint about to cut the account off. An empty list is not 0% — an
/// account on API-key billing has no subscription window at all — so it reports
/// nothing and the slot stays '--'.
pub fn reportable_fraction(limits: &[UsageLimit]) -> Option<f64> {
    let pick = limits
        .iter()
        .find(|l| l.is_active)
        .or_else(|| {
            limits
                .iter()
                .max_by(|a, b| a.used_percent.total_cmp(&b.used_percent))
        })?;
    Some(pick.used_percent / 100.0)
}
```

Create `backend/src/usage/mod.rs`:

```rust
//! Account rate-limit usage, read from the provider's own quota endpoint.
//!
//! Split so the mapping and credential parsing stay pure and unit-tested, and
//! every side effect (fs, network, timers) is confined to `service.rs`.

pub mod credentials;
pub mod limits;
pub mod service;
```

Add `mod usage;` to `backend/src/main.rs` alongside the existing module declarations.

> `mod.rs` names `credentials` and `service` before they exist, so the build stays
> red until Tasks 2 and 3 land. Create both files empty now (a single `//!` doc line
> each) so this task compiles on its own; Tasks 2 and 3 fill them in.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "/var/home/cleadmon/Projects/Doom Term" && cargo test --manifest-path backend/Cargo.toml usage::
```

Expected: PASS — 10 tests in `usage::limits::tests`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/usage/ backend/src/main.rs
git commit -m "feat(usage): map the OAuth usage payload to one reportable fraction"
```

---

### Task 2: Credential location and token parsing

**Files:**
- Modify: `backend/src/usage/credentials.rs` (created empty in Task 1)

**Interfaces:**
- Consumes: nothing.
- Produces: `pub fn credentials_path() -> Option<std::path::PathBuf>`,
  `pub fn parse_access_token(raw: &str) -> Option<String>`,
  `pub fn read_access_token() -> Option<String>`

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/usage/credentials.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_token_from_the_oauth_object() {
        let raw = r#"{"claudeAiOauth":{"accessToken":"sk-real","refreshToken":"r"}}"#;
        assert_eq!(parse_access_token(raw), Some("sk-real".to_string()));
    }

    #[test]
    fn reads_the_flat_top_level_shape() {
        // Older files put the token at the top level.
        let raw = r#"{"accessToken":"sk-flat"}"#;
        assert_eq!(parse_access_token(raw), Some("sk-flat".to_string()));
    }

    #[test]
    fn never_returns_an_mcp_servers_token() {
        // `.credentials.json` holds one accessToken PER authorized MCP server
        // under `mcpOAuth`. Handing the endpoint an MCP token answers 401 —
        // i.e. the plate reports "no subscription" on a signed-in machine.
        // Ordering the MCP block FIRST is the case a naive scan gets wrong.
        let raw = r#"{
            "mcpOAuth": { "some-server": { "accessToken": "mcp-token-WRONG" } },
            "claudeAiOauth": { "accessToken": "sk-right" }
        }"#;
        assert_eq!(parse_access_token(raw), Some("sk-right".to_string()));
    }

    #[test]
    fn returns_nothing_when_only_mcp_tokens_are_present() {
        let raw = r#"{"mcpOAuth":{"s":{"accessToken":"mcp-only"}}}"#;
        assert_eq!(parse_access_token(raw), None);
    }

    #[test]
    fn returns_nothing_for_malformed_or_empty_input() {
        assert_eq!(parse_access_token(""), None);
        assert_eq!(parse_access_token("not json"), None);
        assert_eq!(parse_access_token("{}"), None);
        assert_eq!(parse_access_token(r#"{"claudeAiOauth":{}}"#), None);
    }

    #[test]
    fn treats_an_empty_token_string_as_absent() {
        // A blank token is not a credential; sending it would 401 and be
        // reported as "no subscription".
        assert_eq!(parse_access_token(r#"{"accessToken":""}"#), None);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "/var/home/cleadmon/Projects/Doom Term" && cargo test --manifest-path backend/Cargo.toml usage::credentials
```

Expected: FAIL — `cannot find function parse_access_token`.

- [ ] **Step 3: Write the implementation**

Prepend to `backend/src/usage/credentials.rs`:

```rust
//! Locating and reading the access token the Claude CLI already wrote.
//!
//! READ-ONLY, always. The CLI rotates these tokens itself and rewriting the
//! file would log out a live `claude` session. Nothing here logs, returns or
//! formats the token into an error — the only thing that leaves this module is
//! the token itself, straight into the one request that uses it.

use std::path::PathBuf;

/// `~/.claude/.credentials.json`, or None when `$HOME` is unset.
pub fn credentials_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok().filter(|h| !h.is_empty())?;
    Some(PathBuf::from(home).join(".claude").join(".credentials.json"))
}

/// Pull the subscription access token out of a credentials file's contents.
///
/// Narrows to the `claudeAiOauth` object FIRST. The file also holds one
/// `accessToken` per authorized MCP server under `mcpOAuth`, so a scan that
/// takes the first match in the file hands the usage endpoint an MCP token,
/// gets a 401, and reports "not signed in" on a machine that is perfectly
/// signed in. Falling back to the whole document covers the older flat shape.
pub fn parse_access_token(raw: &str) -> Option<String> {
    let doc: serde_json::Value = serde_json::from_str(raw).ok()?;
    let scope = doc.get("claudeAiOauth").unwrap_or(&doc);
    let token = scope.get("accessToken")?.as_str()?;
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

/// The token, or None if there is no file, it is unreadable, or it holds no
/// subscription credential. Every one of those is "we don't know", which the
/// caller renders as '--'.
pub fn read_access_token() -> Option<String> {
    let raw = std::fs::read_to_string(credentials_path()?).ok()?;
    parse_access_token(&raw)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "/var/home/cleadmon/Projects/Doom Term" && cargo test --manifest-path backend/Cargo.toml usage::credentials
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/usage/credentials.rs
git commit -m "feat(usage): read the CLI's own access token, never an MCP server's"
```

---

### Task 3: The cached fetch service

**Files:**
- Modify: `backend/Cargo.toml`
- Modify: `backend/src/usage/service.rs` (created empty in Task 1)

**Interfaces:**
- Consumes: `usage::credentials::read_access_token`, `usage::limits::{map_limits, reportable_fraction}`
- Produces: `pub struct UsageService`, `UsageService::new() -> Self`,
  `UsageService::cached(&self) -> Option<f64>`, `UsageService::due(&self) -> bool`,
  `UsageService::refresh_blocking(&self)`, `pub const GATE_TICK: Duration`

**Dependency decision:** the daemon has no HTTP client today — verified, `backend/Cargo.lock`
contains no `reqwest`, `ureq`, `hyper` or `rustls`. `ureq` is chosen over `reqwest` because this
is a single unauthenticated-by-us GET running at most once a minute, and the daemon ships as a
bundled Tauri sidecar where `reqwest`'s hyper/tower/h2 tree is real weight for no benefit. It is
blocking, which is why the caller wraps it in `spawn_blocking`.

- [ ] **Step 1: Add the dependency**

Add to `[dependencies]` in `backend/Cargo.toml`:

```toml
ureq = { version = "3.4", features = ["json"] }
```

Verify it resolves with rustls (no OpenSSL, so the sidecar stays portable):

```bash
cd "/var/home/cleadmon/Projects/Doom Term" && cargo build --manifest-path backend/Cargo.toml 2>&1 | tail -5
```

Expected: builds. `ureq` 3.4 enables `rustls` by default; if the build pulls `openssl-sys`,
add `default-features = false, features = ["json", "rustls"]` instead.

- [ ] **Step 2: Write the failing tests**

Append to `backend/src/usage/service.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_service_knows_nothing() {
        // Never 0.0 before the first successful fetch.
        assert_eq!(UsageService::new().cached(), None);
    }

    #[test]
    fn serves_the_last_good_value() {
        let s = UsageService::new();
        s.store(Some(0.42));
        assert_eq!(s.cached(), Some(0.42));
    }

    #[test]
    fn a_failed_refresh_keeps_the_last_good_value() {
        // A dropped wifi connection is not evidence the account is at 0%.
        let s = UsageService::new();
        s.store(Some(0.42));
        s.store_failure();
        assert_eq!(s.cached(), Some(0.42));
    }

    #[test]
    fn forgets_a_value_that_has_gone_stale() {
        let s = UsageService::new();
        s.store(Some(0.42));
        s.expire_for_test();
        assert_eq!(s.cached(), None);
    }

    #[test]
    fn an_explicit_no_subscription_answer_is_remembered_as_unknown() {
        // 'unavailable' (API-key billing, logged out) is a SUCCESSFUL read whose
        // answer is "nothing to show" — it must overwrite a stale number.
        let s = UsageService::new();
        s.store(Some(0.42));
        s.store(None);
        assert_eq!(s.cached(), None);
    }

    #[test]
    fn is_due_before_it_has_ever_run() {
        assert!(UsageService::new().due());
    }

    #[test]
    fn is_not_due_again_immediately_after_an_attempt() {
        // The loop ticks every few seconds so it reacts fast when an agent
        // appears; this is what stops that tick becoming a request rate.
        let s = UsageService::new();
        s.mark_attempted();
        assert!(!s.due());
    }

    #[test]
    fn a_failed_attempt_still_counts_against_the_interval() {
        // Otherwise a host that is offline retries at the tick rate forever.
        let s = UsageService::new();
        s.mark_attempted();
        s.store_failure();
        assert!(!s.due());
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd "/var/home/cleadmon/Projects/Doom Term" && cargo test --manifest-path backend/Cargo.toml usage::service
```

Expected: FAIL — `cannot find type UsageService`.

- [ ] **Step 4: Write the implementation**

Prepend to `backend/src/usage/service.rs`:

```rust
//! The account's rate-limit usage, fetched on a timer and served from cache.
//!
//! `GetTelemetry` is polled every 2 s by the UI and must never wait on the
//! network, so nothing here is called from the request path: the refresh loop
//! writes the cache and the request path only reads it.

use parking_lot::RwLock;
use std::time::{Duration, Instant};

use super::credentials::read_access_token;
use super::limits::{map_limits, reportable_fraction};

/// Anthropic's own quota endpoint — the one the CLI reads. Hardcoded on
/// purpose: a configurable URL is a way to point a bearer token at an
/// arbitrary host.
const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";

/// The OAuth-scoped beta header the endpoint gates on.
const OAUTH_BETA: &str = "oauth-2025-04-20";

/// How long one request may take. Comfortably under the refresh interval so a
/// hung request can never overlap the next one.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// The soonest one read may follow another. This is the real request rate.
pub const REFRESH_INTERVAL: Duration = Duration::from_secs(60);

/// How often the loop wakes to CHECK the gate. Much shorter than the refresh
/// interval so the number appears within seconds of an agent starting, rather
/// than up to a minute later; `due()` is what keeps this from becoming the
/// request rate.
pub const GATE_TICK: Duration = Duration::from_secs(5);

/// How long a value stays reportable after its last successful read. Rate-limit
/// windows are 5 h and 7 d, so a minutes-old number is still true; past this it
/// is an assertion we can no longer stand behind and the slot returns to '--'.
const STALE_AFTER: Duration = Duration::from_secs(600);

struct Snapshot {
    /// The answer as of `read_at`. `None` is a real answer: "this account has no
    /// subscription window" (API-key billing, or logged out).
    fraction: Option<f64>,
    read_at: Instant,
}

#[derive(Default)]
pub struct UsageService {
    snapshot: RwLock<Option<Snapshot>>,
    /// When a read was last ATTEMPTED — success or not. Separate from the
    /// snapshot's `read_at`, which only advances on success: rate limiting has
    /// to count failures too, or an offline host retries at the tick rate.
    last_attempt: RwLock<Option<Instant>>,
}

impl UsageService {
    pub fn new() -> Self {
        Self::default()
    }

    /// May a read be attempted now?
    pub fn due(&self) -> bool {
        match *self.last_attempt.read() {
            None => true,
            Some(at) => at.elapsed() >= REFRESH_INTERVAL,
        }
    }

    fn mark_attempted(&self) {
        *self.last_attempt.write() = Some(Instant::now());
    }

    /// The cached fraction, or None when we have never read one, the last read
    /// said there is nothing to show, or the value has gone stale.
    pub fn cached(&self) -> Option<f64> {
        let guard = self.snapshot.read();
        let snap = guard.as_ref()?;
        if snap.read_at.elapsed() > STALE_AFTER {
            return None;
        }
        snap.fraction
    }

    /// Record a successful read. `None` means the read succeeded and the answer
    /// is "no subscription window" — it overwrites any earlier number.
    fn store(&self, fraction: Option<f64>) {
        *self.snapshot.write() = Some(Snapshot {
            fraction,
            read_at: Instant::now(),
        });
    }

    /// Record a FAILED read: leave the last good value alone. An unreachable
    /// endpoint is not evidence about the account, and blanking the slot on
    /// every transient network blip would make it flicker.
    fn store_failure(&self) {
        // Deliberately empty. Named so the call site reads as a decision
        // rather than a forgotten branch.
    }

    /// Fetch and cache. BLOCKING — call from `spawn_blocking`, never from the
    /// request path. Stamps the attempt FIRST so a slow or hanging request
    /// still holds the gate shut against the next tick.
    pub fn refresh_blocking(&self) {
        self.mark_attempted();
        match fetch_fraction() {
            Ok(fraction) => self.store(fraction),
            Err(()) => self.store_failure(),
        }
    }

    #[cfg(test)]
    fn expire_for_test(&self) {
        if let Some(snap) = self.snapshot.write().as_mut() {
            snap.read_at = Instant::now() - STALE_AFTER - Duration::from_secs(1);
        }
    }
}

/// One read. `Ok(None)` = read fine, nothing to show. `Err(())` = could not read.
///
/// The error type carries nothing on purpose: an error string built from a
/// request that had an Authorization header on it is exactly how a token ends
/// up in a log file.
fn fetch_fraction() -> Result<Option<f64>, ()> {
    let Some(token) = read_access_token() else {
        // Not signed in. A definite answer, not a failure.
        return Ok(None);
    };

    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(REQUEST_TIMEOUT))
        .build()
        .into();

    let mut response = match agent
        .get(USAGE_URL)
        .header("authorization", &format!("Bearer {token}"))
        .header("anthropic-beta", OAUTH_BETA)
        .call()
    {
        Ok(r) => r,
        // 401/403 mean this identity has nothing to show — a definite answer.
        // Everything else is a failure that must keep the last good value.
        Err(ureq::Error::StatusCode(401 | 403)) => return Ok(None),
        Err(_) => return Err(()),
    };

    let body = response.body_mut().read_to_string().map_err(|_| ())?;
    let json: serde_json::Value = serde_json::from_str(&body).map_err(|_| ())?;
    Ok(reportable_fraction(&map_limits(&json)))
}
```

> `ureq` 3.x's builder API differs from 2.x. If `timeout_global` or
> `ureq::Error::StatusCode` do not resolve, check the exact names with
> `cargo doc -p ureq --open`; the shape of this function does not change.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd "/var/home/cleadmon/Projects/Doom Term" && cargo test --manifest-path backend/Cargo.toml usage::
```

Expected: PASS — 24 tests across `usage::limits` (10), `usage::credentials` (6) and
`usage::service` (8). No test touches the network.

- [ ] **Step 6: Commit**

```bash
git add backend/Cargo.toml backend/Cargo.lock backend/src/usage/service.rs
git commit -m "feat(usage): fetch account rate limits on a timer, served from cache"
```

---

### Task 4: Wire the fraction into the Telemetry message

**Files:**
- Modify: `backend/src/main.rs:82-91` (`ServerMessage::Telemetry`), `:447` (the send site),
  and the daemon startup where the refresh task is spawned

**Interfaces:**
- Consumes: `usage::service::{UsageService, REFRESH_INTERVAL}`, `pty::{foreground_command, classify_agent}`
- Produces: `Telemetry.rate_used: Option<f64>` on the wire

- [ ] **Step 1: Add the wire field**

In `backend/src/main.rs`, add to the `Telemetry` variant (after `credentials`):

```rust
        /// Fraction 0..1 of the account's binding rate limit that is used, or
        /// None when unknown. None renders '--' on the plate; it must never be
        /// coerced to 0.0, which would claim a fresh quota we did not observe.
        rate_used: Option<f64>,
```

- [ ] **Step 2: Spawn the refresh loop**

Where the daemon builds its shared state (alongside `sessions`), add:

```rust
    let usage = std::sync::Arc::new(usage::service::UsageService::new());
```

And spawn the loop after the listener is bound:

```rust
    // Rate-limit usage refreshes on its own timer, never on the request path:
    // GetTelemetry is polled every 2 s and must not wait on an HTTPS round-trip.
    {
        let usage = usage.clone();
        let sessions = sessions.clone();
        tokio::spawn(async move {
            loop {
                // The poll gate has two halves. `due()` is the request rate —
                // at most one read per REFRESH_INTERVAL, counting failures. The
                // foreground check is the reason to ask at all: no Claude in the
                // foreground means nothing to report, and polling a quota
                // endpoint on a timer for an idle shell is rude.
                let is_claude = sessions
                    .read()
                    .values()
                    .find_map(|s| s.shell_pid())
                    .and_then(pty::foreground_command)
                    .and_then(|comm| pty::classify_agent(&comm))
                    .is_some_and(|a| a.key == "claude");

                if is_claude && usage.due() {
                    let usage = usage.clone();
                    // ureq is blocking; keep it off the async runtime's threads.
                    let _ = tokio::task::spawn_blocking(move || usage.refresh_blocking()).await;
                }

                tokio::time::sleep(usage::service::GATE_TICK).await;
            }
        });
    }
```

Thread `usage` into the message handler the same way `sessions` already is.

- [ ] **Step 3: Populate the field at the send site**

At `backend/src/main.rs:447`, add to the `ServerMessage::Telemetry { .. }` construction:

```rust
                // Read-only: whatever the refresh loop last managed to learn.
                // Reported only for the agent it belongs to — showing Claude's
                // quota while Codex is in the foreground would be a mislabel.
                rate_used: match agent.as_ref().map(|a| a.key) {
                    Some("claude") => usage.cached(),
                    _ => None,
                },
```

- [ ] **Step 4: Verify it compiles and the suite is green**

```bash
cd "/var/home/cleadmon/Projects/Doom Term" && cargo test --manifest-path backend/Cargo.toml
```

Expected: PASS, including the 2 pre-existing backend tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/main.rs
git commit -m "feat(usage): report the account rate limit on the telemetry message"
```

---

### Task 5: Render it on the plate

**Files:**
- Modify: `src/types/terminal.ts:93-104` (`SystemTelemetryData`)
- Modify: `src/hooks/usePtyEvents.ts:217-228` (the telemetry handler)
- Create: `src/hooks/usePtyEvents.test.ts`

**Interfaces:**
- Consumes: `Telemetry.rate_used` from Task 4.
- Produces: `AppTelemetry.rateUsed`, which `toPlateState` already feeds to `pct()`.

- [ ] **Step 1: Write the failing test**

Create `src/hooks/usePtyEvents.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toPlateState } from '../hud/state';

/**
 * The mapping from a Telemetry message to AppTelemetry, exercised through the
 * plate state it produces — that is the thing the user actually sees, and the
 * '--' rule is the whole point of the field.
 */
describe('usage percentage on the plate', () => {
  it('renders an observed fraction as a percentage', () => {
    expect(toPlateState({ rateUsed: 0.42 }).usage).toBe('42%');
  });

  it('renders an unknown usage as -- rather than 0%', () => {
    // A daemon that sent null, or an agent that is not Claude.
    expect(toPlateState({ rateUsed: undefined }).usage).toBe('--');
    expect(toPlateState({}).usage).toBe('--');
  });

  it('does not round a real zero up into nothing', () => {
    // A brand new billing window genuinely is 0%. That is observed, so it shows.
    expect(toPlateState({ rateUsed: 0 }).usage).toBe('0%');
  });

  it('caps a fully consumed limit at 99% so the slot never reads 100%', () => {
    expect(toPlateState({ rateUsed: 1 }).usage).toBe('99%');
  });
});
```

- [ ] **Step 2: Run it to verify the current behaviour**

```bash
cd "/var/home/cleadmon/Projects/Doom Term" && npx vitest run src/hooks/usePtyEvents.test.ts
```

Expected: PASS already — `pct()` and `toPlateState` handle this correctly today; nothing
has ever *supplied* `rateUsed`. This test pins the contract before the wiring lands, so a
later change that coerces `undefined` to `0` fails loudly.

- [ ] **Step 3: Add the wire field to the type**

In `src/types/terminal.ts`, add to `SystemTelemetryData`:

```ts
  /**
   * Fraction 0..1 of the account's binding rate limit that is used, from the
   * provider's own quota endpoint. `null` when unknown — the plate shows '--'.
   */
  rate_used?: number | null;
```

- [ ] **Step 4: Map it in the telemetry handler**

In `src/hooks/usePtyEvents.ts`, inside `ptyClient.onTelemetry`, add to the returned object:

```ts
        // null means the daemon could not observe it. Leave it undefined so
        // pct() renders '--'; `?? 0` here would invent a fresh quota.
        rateUsed: data.rate_used ?? undefined,
```

- [ ] **Step 5: Verify the whole frontend suite**

```bash
cd "/var/home/cleadmon/Projects/Doom Term" && npm test && npx tsc --noEmit
```

Expected: PASS — 100 vitest (96 existing + 4 new), 16 node:test, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/types/terminal.ts src/hooks/usePtyEvents.ts src/hooks/usePtyEvents.test.ts
git commit -m "feat(usage): show the observed rate limit in the USAGE slot"
```

---

### Task 6: Live verification

Unit tests cannot prove the endpoint contract. This task is the one that does, and it is
where the previous round's bugs (a mark sampled inside a React updater; colliding workspace
ids) were actually caught.

**Files:** none — this task only runs things.

- [ ] **Step 1: Start the daemon and the dev server**

```bash
cd "/var/home/cleadmon/Projects/Doom Term" && npm run server
```

In a second shell:

```bash
cd "/var/home/cleadmon/Projects/Doom Term" && npm run dev
```

- [ ] **Step 2: Confirm the slot is `--` with no agent running**

Open the app. With a plain shell in the foreground, `USAGE` must read `--`. If it reads a
number, the poll gate or the `agent.key == "claude"` guard is wrong.

- [ ] **Step 3: Confirm a real number appears with Claude running**

In a Doom Term session, run `claude`. Within ~5 s (one `GATE_TICK`) the `USAGE` slot must
show a percentage. If it takes a full minute, the loop is sleeping on `REFRESH_INTERVAL`
instead of `GATE_TICK`.
Cross-check it against the same account's real figure by running `/usage` inside that Claude
session — the two should agree.

- [ ] **Step 4: Confirm it survives the network going away**

Stop the machine's network (or block `api.anthropic.com` via `/etc/hosts`) and wait two
refresh intervals. The slot must keep showing the last good number, NOT drop to `0%`.
Restore the network.

- [ ] **Step 5: Confirm the token never leaves the daemon**

```bash
cd "/var/home/cleadmon/Projects/Doom Term" && git grep -nE "accessToken|Bearer" -- backend/src src | grep -v "credentials.rs\|service.rs"
```

Expected: no matches. The token must appear only in the two files that read and send it.
Also check the daemon's own stdout for any token-shaped string:

```bash
grep -ciE "sk-ant|Bearer " /tmp/claude-1000/*/scratchpad/daemon.log 2>/dev/null || echo "no daemon log to check"
```

Expected: 0.

- [ ] **Step 6: Run the full gate**

```bash
cd "/var/home/cleadmon/Projects/Doom Term" \
  && npm run build \
  && npm test \
  && cargo test --manifest-path backend/Cargo.toml \
  && cargo test --manifest-path crates/doom-term-pty/Cargo.toml \
  && npm run hud:check
```

Expected: build clean, 100 vitest, 16 node:test, 22 crate tests, backend tests green,
reference PNG 0/15360 mismatched px.

- [ ] **Step 7: Spin the servers down**

Stop both dev processes. Do not leave the daemon running.

---

## Out of Scope

Stated explicitly so a reader does not assume these were forgotten:

- **CONTEXT %.** A different source entirely (transcript tailing) and a different unsolved
  problem (linking a pane to its `.jsonl`, which `/proc` cannot do — verified: `claude`
  appends and closes its transcript, so the path is not in its fd table). Separate plan.
- **Codex / Gemini / other agents.** The structure supports them — `reportable_fraction`
  takes a limit list, whatever produced it — but each needs its own endpoint, credential
  path and mapping. Claude first; add providers when Claude is proven live.
- **Usage over SSH.** Doom Term has no remote-session concept yet. When it does, the rule is
  nodeterm's: the token never leaves the host, the remote shell curls the endpoint itself,
  the token goes in on stdin (never argv, where `ps` exposes it on a shared host), and the
  reply is marker-delimited so an MOTD cannot be parsed as usage.
- **Multiple accounts.** One `$HOME`, one credential file, one number.
- **Showing which window is reported** (5 h vs 7 d) or when it resets. The plate has one
  slot and no room for a label; `severity` and `resets_at` are parsed away deliberately.

---

## Deviations from the plan as executed (2026-08-29)

- **TDD's separate failing run was collapsed.** Tasks 1–3 were written as
  test+implementation together and verified in one `cargo test` pass rather than
  running each suite to red first. These are pure functions with hard-coded
  expected values, so the vacuous-test risk the red step guards against is low.
  Tasks 4–6 were unaffected.

- **Task 6 Step 4 (network-failure behaviour) was NOT verified live.** Blocking
  `api.anthropic.com` needs root to edit `/etc/hosts`, and this is an ostree
  host where that is not a casual change. The behaviour is covered by the unit
  test `a_failed_refresh_keeps_the_last_good_value`, which asserts a failed
  refresh leaves the cached value intact. Worth running by hand if the
  opportunity arises.

- **An extra deliverable:** `probes_the_live_endpoint`, an `#[ignore]`d test
  that hits the real endpoint. It is what actually proved the contract
  (`live usage fraction: 0.6`), and it is the thing to run first if the slot
  ever goes back to `--`.

- **A pre-existing bug was surfaced, not fixed.** Telemetry picks the agent via
  `sessions.read().values().find_map(|s| s.shell_pid())` — the FIRST session
  with a pid, not the active one. With several sessions open it reports an
  arbitrary one, so `agent_key` (and therefore `rate_used`) can describe a
  different tab than the one on screen. This predates this work and is what made
  the first two verification attempts read `null`. It needs `GetTelemetry` to
  carry a session id.
