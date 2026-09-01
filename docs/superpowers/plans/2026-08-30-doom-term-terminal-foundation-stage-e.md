# Stage E — a real CONTEXT %: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the plate's `CONTEXT` slot report how full the running agent's context window actually is, read from the agent's own transcript — and keep rendering `--` whenever that number is genuinely unknown.

**Architecture:** The daemon finds the transcript belonging to a pane by matching the pane's working directory against the `cwd` recorded *inside* each recent `~/.claude/projects/*/*.jsonl`, scans that file **backwards** for the newest assistant `usage` block, and divides the input-side token total by the context window of that message's model family. It rides the existing `Telemetry` message as `context_used: Option<f64>` into `AppTelemetry.contextUsed`, which `toPlateState` already renders through `pct()`. Nothing is cached on the request path beyond a short memo, because the whole read measured 1.0 ms.

**Tech Stack:** Rust (serde_json, std::fs), the existing WebSocket wire protocol, TypeScript/React frontend.

**Spec:** `docs/superpowers/specs/2026-08-29-doom-term-terminal-foundation-design.md` (Stage E), which folds in `docs/superpowers/plans/2026-08-29-doom-term-usage-percentage.md` (USAGE %, already implemented — this plan is the other half)

---

## Measured before planning

Prototyped against this machine's real transcripts. Every number below is observed, not estimated.

| Question | Measured |
|---|---|
| Does the project directory name reconstruct from a cwd? | **No.** `/var/home/cleadmon/Projects/Doom Term` → `-var-home-cleadmon-Projects-Doom-Term`: slashes *and spaces* both become `-`, so the mapping is lossy and not invertible. Match the `cwd` recorded inside the transcript instead. |
| Does a transcript record its own cwd? | **Yes**, as a top-level `cwd` field on early lines. |
| Where is the token count? | `message.usage` on `type: "assistant"` lines: `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`. |
| How fast is discovery across all project dirs? | **0.8 ms** for 9 project directories. |
| How fast is a backwards scan of a 6.1 MB transcript? | **0.2 ms** — the newest usage is in the last 64 KB chunk. |
| Does it produce a plausible number? | Yes: 579,664 tokens against `claude-opus-5` → **58.0%**, on a session that had been running for hours. |
| How many transcripts matched one cwd? | **1.** The ambiguous case is real but was not hit here. |

The two timings together are ~1 ms, which is why this can run on the existing 2 Hz `GetTelemetry` path without a background poller. USAGE % needed one because it makes an HTTPS call; this reads local files.

---

## Deviation from the spec, and why

The spec's Stage E says to "install the vendors' own hooks to get `session_id` and `transcript_path` in every payload". **This plan does not install hooks and does not modify `~/.claude/settings.json`.**

Three reasons, in order of weight:

1. **That file is not ours.** nodeterm already registers hooks for nine events in this user's `~/.claude/settings.json`, pointing at `~/.nodeterm/agent-hooks/claude.sh`. Writing into a config another product actively manages risks clobbering its entries, and an install that must merge-not-replace across nine event arrays is a lot of failure surface for a percentage.
2. **It is not needed for the number.** Discovery by recorded `cwd` is exact, rule-independent and costs 0.8 ms. Hooks would buy disambiguation, not accuracy.
3. **The one thing hooks would fix is detectable without them.** Two Claude sessions in the same directory is the only case discovery cannot resolve — and we can *see* that case (more than one recent transcript matching the cwd) and render `--` rather than guess. Reporting a possibly-wrong percentage is the failure this project has repeatedly chosen against.

What we give up: with two agents in one directory, both panes show `--` instead of a number. That is stated in the UI reasoning and in the limitations below, and hooks remain the upgrade path if it ever bites.

## Global Constraints

- **`--`, never a guess.** `context_used` is `Option<f64>` end to end. Unknown must not be coerced to `0.0`, which would claim an empty context we did not observe. This mirrors `rate_used`, whose comment at `main.rs` already states the rule.
- **USAGE % and CONTEXT % are unrelated sources and must not be conflated.** USAGE % is the account's rate limit from an HTTPS endpoint; CONTEXT % is one session's window fill from a local file. Neither is a fallback for the other.
- **Never touch these files.** They hold uncommitted work: `.nodeterm/project.json`, `backend/src/main.rs` *(exception below)*, `crates/doom-term-pty/src/foreground.rs`, `src/components/StatusPlate.tsx`, `src/components/TabBar.tsx`, `src/components/TabBar.test.tsx`, `src/hud/plate.d.ts`, `src/hud/plate.js`, `src/hud/state.ts`, `src/types/sessionTree.ts`, `src/types/terminal.ts` *(exception below)*.
  - `backend/src/main.rs` and `src/types/terminal.ts` **must** be modified — both hold the `Telemetry` shape. Stage those two files with the technique in Task 5, which applies your changes to the committed baseline and restores the user's working copy afterwards. Verify with the gate in that task.
  - `src/hud/state.ts` and `src/hud/plate.js` need **no change at all**: `AppTelemetry.contextUsed` already exists (`state.ts:6`) and `toPlateState` already maps it (`state.ts:57`). The slot has been wired since the HUD was built; nothing has ever filled it.
- **No game vocabulary** in anything the UI renders.
- **Context windows are 1M for the current families and 200K for Haiku 4.5** — see the table in Task 1, which carries the authoritative values and the date they were taken. Do not extend it from memory; the Models API (`max_input_tokens`) is the live source if it ever needs re-checking.
- Rust tests: `cargo test --manifest-path backend/Cargo.toml` (26 passing, 1 ignored today).
- TS gate: `npx tsc --noEmit && npx vitest run && npm run build`. Currently 193 tests over 28 files, all green.

---

## File Structure

**Create**
- `backend/src/usage/context.rs` — everything CONTEXT. Window table, the usage-line parse, the backwards scan, and discovery. Sits beside `usage/service.rs` because it is the other half of the same plate slot, but shares no state with it: the two percentages come from unrelated sources and must not grow a common cache.

**Modify**
- `backend/src/usage/mod.rs` — declare the module.
- `backend/src/main.rs` — one field on `Telemetry`, one call in `GetTelemetry`. Selective staging (Task 5).
- `src/types/terminal.ts` — one field on `SystemTelemetryData`. Selective staging (Task 5).
- `src/hooks/usePtyEvents.ts:294` — one line mapping it into `AppTelemetry`.

---

### Task 1: The context window of a model

**Files:**
- Create: `backend/src/usage/context.rs`
- Modify: `backend/src/usage/mod.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `pub fn context_window(model: &str) -> Option<u64>`

- [ ] **Step 1: Write the failing tests**

Create `backend/src/usage/context.rs` containing only this test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_current_families_all_carry_a_million_token_window() {
        assert_eq!(context_window("claude-opus-5"), Some(1_000_000));
        assert_eq!(context_window("claude-opus-4-8"), Some(1_000_000));
        assert_eq!(context_window("claude-sonnet-5"), Some(1_000_000));
        assert_eq!(context_window("claude-fable-5"), Some(1_000_000));
    }

    #[test]
    fn haiku_is_the_one_that_is_not() {
        // The whole reason this is a table and not a constant.
        assert_eq!(context_window("claude-haiku-4-5"), Some(200_000));
        assert_eq!(context_window("claude-haiku-4-5-20251001"), Some(200_000));
    }

    #[test]
    fn a_model_we_do_not_know_has_no_window_rather_than_a_guessed_one() {
        // A wrong denominator produces a confident, wrong percentage — worse
        // than the '--' the plate draws for None. Never default the divisor.
        assert_eq!(context_window("claude-opus-9"), None);
        assert_eq!(context_window("gpt-5"), None);
        assert_eq!(context_window(""), None);
    }

    #[test]
    fn a_dated_snapshot_matches_its_family() {
        // Ids arrive from the transcript verbatim and sometimes carry a date.
        assert_eq!(context_window("claude-sonnet-4-6-20260115"), Some(1_000_000));
    }
}
```

Add to `backend/src/usage/mod.rs`:

```rust
pub mod context;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path backend/Cargo.toml context::`
Expected: FAIL — `cannot find function context_window in this scope`.

- [ ] **Step 3: Write the implementation**

Put this **above** the test module in `backend/src/usage/context.rs`:

```rust
//! CONTEXT % — how full the running agent's context window is.
//!
//! Read from the agent's own transcript, which is the only place the number
//! exists: no agent CLI reports its token usage to the terminal, and /proc
//! cannot find the file either, because `claude` appends and closes the
//! transcript rather than holding the fd open.
//!
//! This is NOT the same number as USAGE %, and the two must never be blended.
//! USAGE % is the account's rate limit, fetched over HTTPS by `service.rs`;
//! CONTEXT % is one session's window fill, read from a local file. They come
//! from unrelated sources and can move in opposite directions.

/// Context window by model family, in tokens.
///
/// Taken 2026-08-30 from the authoritative model reference. Matched by prefix
/// because the transcript records the id verbatim and it sometimes carries a
/// date suffix (`claude-sonnet-4-6-20260115`).
///
/// Longest prefix first: `claude-haiku-4-5` must be tested before any shorter
/// string that could also match it.
const WINDOWS: &[(&str, u64)] = &[
    ("claude-haiku-4-5", 200_000),
    ("claude-opus-5", 1_000_000),
    ("claude-opus-4-8", 1_000_000),
    ("claude-opus-4-7", 1_000_000),
    ("claude-opus-4-6", 1_000_000),
    ("claude-sonnet-5", 1_000_000),
    ("claude-sonnet-4-6", 1_000_000),
    ("claude-fable-5", 1_000_000),
    ("claude-mythos-5", 1_000_000),
];

/// The context window for a model id, or None when we do not know it.
///
/// None is a real answer and the plate renders it as `--`. Defaulting to some
/// plausible window would turn an unknown into a confident wrong percentage,
/// which is the failure this whole slot exists to avoid — a model with a
/// larger window than we assumed would read as dangerously full.
pub fn context_window(model: &str) -> Option<u64> {
    WINDOWS
        .iter()
        .find(|(family, _)| model.starts_with(family))
        .map(|(_, window)| *window)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path backend/Cargo.toml`
Expected: PASS — 30 passing, 1 ignored.

- [ ] **Step 5: Commit**

```bash
git add backend/src/usage/context.rs backend/src/usage/mod.rs
git commit -m "feat(context): the context window of a model family"
```

---

### Task 2: Read the token total out of a transcript line

**Files:**
- Modify: `backend/src/usage/context.rs`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `pub struct Snapshot { pub used: u64, pub model: String }` and `pub fn snapshot_from_line(line: &str) -> Option<Snapshot>`

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `backend/src/usage/context.rs`:

```rust
    #[test]
    fn reads_the_input_side_token_total_from_an_assistant_line() {
        // Shape confirmed against a real transcript on 2026-08-30.
        let line = r#"{"type":"assistant","message":{"model":"claude-opus-5",
            "usage":{"input_tokens":2,"cache_creation_input_tokens":1905,
            "cache_read_input_tokens":335468,"output_tokens":2217}}}"#;
        let snap = snapshot_from_line(line).expect("an assistant usage line");
        // 2 + 1905 + 335468. The output tokens are deliberately NOT counted:
        // this measures what was SENT, which is what fills the window on the
        // next request. Including the reply would double-count it a turn later.
        assert_eq!(snap.used, 337_375);
        assert_eq!(snap.model, "claude-opus-5");
    }

    #[test]
    fn tolerates_a_usage_block_missing_the_cache_fields() {
        // An uncached first turn has no cache_read/cache_creation at all.
        let line = r#"{"type":"assistant","message":{"model":"claude-opus-5",
            "usage":{"input_tokens":1200,"output_tokens":30}}}"#;
        assert_eq!(snapshot_from_line(line).unwrap().used, 1200);
    }

    #[test]
    fn ignores_lines_that_are_not_an_assistant_turn_with_usage() {
        // A transcript is mostly user turns, tool results and metadata. Only
        // an assistant message carries the token accounting.
        assert!(snapshot_from_line(r#"{"type":"user","message":{"content":"hi"}}"#).is_none());
        assert!(snapshot_from_line(r#"{"type":"assistant","message":{"model":"m"}}"#).is_none());
        assert!(snapshot_from_line("not json at all").is_none());
        assert!(snapshot_from_line("").is_none());
    }

    #[test]
    fn a_usage_block_without_a_model_is_unusable() {
        // Without the model there is no denominator, so there is no percentage.
        let line = r#"{"type":"assistant","message":{"usage":{"input_tokens":10}}}"#;
        assert!(snapshot_from_line(line).is_none());
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path backend/Cargo.toml context::`
Expected: FAIL — `cannot find function snapshot_from_line in this scope`.

- [ ] **Step 3: Write the implementation**

Add to `backend/src/usage/context.rs`, above the test module:

```rust
/// The newest token accounting found in a transcript.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    pub used: u64,
    pub model: String,
}

/// Parse one transcript line, returning its token total when it is an
/// assistant turn that carries usage.
///
/// `used` is the INPUT side only — `input_tokens` plus both cache counters.
/// Those three are what was sent to the model, and therefore what occupies the
/// window. `output_tokens` is excluded on purpose: the reply is not in the
/// window until it is sent back as part of the next request's input, where it
/// arrives already counted. Adding it here would count it twice.
pub fn snapshot_from_line(line: &str) -> Option<Snapshot> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    if value.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let message = value.get("message")?;
    let usage = message.get("usage")?;
    let model = message.get("model")?.as_str()?.to_string();

    let field = |name: &str| usage.get(name).and_then(|v| v.as_u64()).unwrap_or(0);
    let used = field("input_tokens")
        + field("cache_read_input_tokens")
        + field("cache_creation_input_tokens");

    Some(Snapshot { used, model })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path backend/Cargo.toml`
Expected: PASS — 34 passing, 1 ignored.

- [ ] **Step 5: Commit**

```bash
git add backend/src/usage/context.rs
git commit -m "feat(context): read the input-side token total from a transcript line"
```

---

### Task 3: Scan a transcript backwards

A transcript is append-only and grows to megabytes — the file measured during planning was 6.1 MB after a few hours. Reading it forwards to find the *last* usage would cost the whole file on every 2 Hz poll. Reading backwards in chunks finds it in the final 64 KB.

**Files:**
- Modify: `backend/src/usage/context.rs`

**Interfaces:**
- Consumes: `Snapshot`, `snapshot_from_line` (Task 2).
- Produces: `pub fn newest_snapshot(path: &std::path::Path) -> Option<Snapshot>`, `pub const SCAN_CHUNK: u64 = 65_536;`, `pub const MAX_SCAN: u64 = 4 * 1024 * 1024;`

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `backend/src/usage/context.rs`:

```rust
    /// Write a transcript to a unique temp path and hand back the path.
    fn write_transcript(name: &str, body: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("doom-term-ctx-{}.jsonl", name));
        std::fs::write(&path, body).expect("temp transcript");
        path
    }

    /// One assistant turn carrying usage. Used by this task and by Task 4.
    fn assistant_line(model: &str, input: u64) -> String {
        format!(
            r#"{{"type":"assistant","message":{{"model":"{}","usage":{{"input_tokens":{}}}}}}}"#,
            model, input
        )
    }

    #[test]
    fn finds_the_last_usage_not_the_first() {
        // The newest turn is the current state of the window; an earlier one
        // describes a context that has since grown.
        let path = write_transcript(
            "ordering",
            concat!(
                r#"{"type":"assistant","message":{"model":"claude-opus-5","usage":{"input_tokens":100}}}"#, "\n",
                r#"{"type":"user","message":{"content":"next"}}"#, "\n",
                r#"{"type":"assistant","message":{"model":"claude-opus-5","usage":{"input_tokens":900}}}"#, "\n",
            ),
        );
        assert_eq!(newest_snapshot(&path).unwrap().used, 900);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn finds_a_usage_line_that_straddles_a_chunk_boundary() {
        // The scan reads fixed-size blocks backwards from the end, so a record
        // split across a boundary arrives as two halves and must be rejoined.
        // Placed deliberately: the trailing padding is sized so the final
        // chunk BEGINS in the middle of the usage line. A test that merely
        // exceeds one chunk does not exercise this — the answer would sit in
        // the last block and the carry path would never run.
        let usage = format!("{}\n", assistant_line("claude-opus-5", 4242));
        let filler = format!("{}\n", r#"{"type":"user","message":{"content":"x"}}"#);

        let suffix_bytes = SCAN_CHUNK as usize - usage.len() / 2;
        let mut suffix = filler.repeat(suffix_bytes / filler.len() + 1);
        suffix.truncate(suffix_bytes); // exact, so the boundary lands where we want
        let prefix = filler.repeat(10);
        let body = format!("{}{}{}", prefix, usage, suffix);

        let path = write_transcript("straddle", &body);
        let size = std::fs::metadata(&path).unwrap().len();
        let last_chunk_starts = size - SCAN_CHUNK;
        let usage_starts = prefix.len() as u64;
        assert!(
            last_chunk_starts > usage_starts && last_chunk_starts < usage_starts + usage.len() as u64,
            "the boundary must fall inside the usage line for this test to mean anything"
        );

        assert_eq!(newest_snapshot(&path).unwrap().used, 4242);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn a_transcript_with_no_usage_yields_nothing() {
        let path = write_transcript(
            "empty",
            concat!(r#"{"type":"user","message":{"content":"hi"}}"#, "\n"),
        );
        assert!(newest_snapshot(&path).is_none());
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn a_missing_file_yields_nothing_rather_than_panicking() {
        // The agent can exit and its transcript be moved between the poll that
        // found it and the poll that reads it.
        assert!(newest_snapshot(std::path::Path::new("/nonexistent/x.jsonl")).is_none());
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path backend/Cargo.toml context::`
Expected: FAIL — `cannot find function newest_snapshot in this scope`.

- [ ] **Step 3: Write the implementation**

Add to `backend/src/usage/context.rs`, above the test module:

```rust
/// How much of the transcript to read per step, scanning backwards.
/// The newest usage was in the final 64 KB of a 6.1 MB file when measured.
pub const SCAN_CHUNK: u64 = 65_536;

/// Give up after this much. A transcript whose last several megabytes contain
/// no assistant usage is not one we can describe, and reading a 100 MB file on
/// a 2 Hz poll to discover that would be worse than reporting nothing.
pub const MAX_SCAN: u64 = 4 * 1024 * 1024;

/// The newest token accounting in a transcript, scanning from the end.
///
/// Backwards because the file is append-only and can reach megabytes: the
/// answer is almost always in the last chunk, and a forward read would cost
/// the whole file on every poll. Partial lines at a chunk's leading edge are
/// carried into the next step rather than parsed, so a record split across the
/// boundary is not silently dropped.
pub fn newest_snapshot(path: &std::path::Path) -> Option<Snapshot> {
    use std::io::{Read, Seek, SeekFrom};

    let mut file = std::fs::File::open(path).ok()?;
    let size = file.metadata().ok()?.len();

    let mut pos = size;
    let mut scanned = 0u64;
    // Bytes from the previous (later) step that began before `pos`.
    let mut carry: Vec<u8> = Vec::new();

    while pos > 0 && scanned < MAX_SCAN {
        let step = SCAN_CHUNK.min(pos);
        pos -= step;
        scanned += step;

        let mut block = vec![0u8; step as usize];
        file.seek(SeekFrom::Start(pos)).ok()?;
        file.read_exact(&mut block).ok()?;
        block.extend_from_slice(&carry);

        let mut lines: Vec<&[u8]> = block.split(|b| *b == b'\n').collect();
        // The first element starts before `pos` unless we reached the top of
        // the file, so it is incomplete and belongs to the next step.
        carry = if pos > 0 {
            let head = lines.remove(0);
            head.to_vec()
        } else {
            Vec::new()
        };

        for raw in lines.iter().rev() {
            let Ok(text) = std::str::from_utf8(raw) else {
                continue;
            };
            if let Some(snapshot) = snapshot_from_line(text) {
                return Some(snapshot);
            }
        }
    }
    None
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path backend/Cargo.toml`
Expected: PASS — 38 passing, 1 ignored.

- [ ] **Step 5: Commit**

```bash
git add backend/src/usage/context.rs
git commit -m "feat(context): scan a transcript backwards for the newest usage"
```

---

### Task 4: Find the transcript that belongs to a pane

The project directory name is **not** reconstructible from a working directory — `/var/home/cleadmon/Projects/Doom Term` becomes `-var-home-cleadmon-Projects-Doom-Term`, so slashes and spaces both collapse to `-` and the mapping cannot be inverted. Match the `cwd` each transcript records about itself instead.

**Files:**
- Modify: `backend/src/usage/context.rs`

**Interfaces:**
- Consumes: `newest_snapshot` (Task 3), `context_window` (Task 1), `Snapshot` and `assistant_line` test helper (Tasks 2–3).
- Produces: `pub struct Reading { pub fraction: f64, pub model: String }`, `pub fn transcripts_for(root: &std::path::Path, cwd: &str, now: std::time::SystemTime) -> Vec<std::path::PathBuf>`, `pub fn context_fraction(cwd: &str) -> Option<Reading>`, `pub const RECENT_WINDOW: std::time::Duration`

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `backend/src/usage/context.rs`:

```rust
    /// Build a fake ~/.claude/projects tree: (dir, file, body) triples.
    fn fake_projects(name: &str, entries: &[(&str, &str, &str)]) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("doom-term-projects-{}", name));
        std::fs::remove_dir_all(&root).ok();
        for (dir, file, body) in entries {
            let d = root.join(dir);
            std::fs::create_dir_all(&d).expect("project dir");
            std::fs::write(d.join(file), body).expect("transcript");
        }
        root
    }

    #[test]
    fn matches_the_directory_the_transcript_recorded_not_a_reconstructed_name() {
        // The project directory name is lossy: slashes AND spaces both become
        // '-', so `/a/Doom Term` and `/a/Doom/Term` produce the same folder.
        // Reading the cwd back out of the file is exact instead of guessing.
        let root = fake_projects(
            "match",
            &[(
                "-var-home-me-Projects-Doom-Term",
                "s1.jsonl",
                &format!(
                    "{}\n{}\n",
                    r#"{"type":"user","cwd":"/var/home/me/Projects/Doom Term"}"#,
                    assistant_line("claude-opus-5", 500_000)
                ),
            )],
        );
        let now = std::time::SystemTime::now();
        let found = transcripts_for(&root, "/var/home/me/Projects/Doom Term", now);
        assert_eq!(found.len(), 1, "the recorded cwd must match exactly");
        assert!(transcripts_for(&root, "/var/home/me/Projects/Doom", now).is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn ignores_transcripts_for_other_directories() {
        let root = fake_projects(
            "others",
            &[
                ("-a", "s1.jsonl", r#"{"type":"user","cwd":"/a"}"#),
                ("-b", "s2.jsonl", r#"{"type":"user","cwd":"/b"}"#),
            ],
        );
        let now = std::time::SystemTime::now();
        assert_eq!(transcripts_for(&root, "/a", now).len(), 1);
        assert!(transcripts_for(&root, "/zzz", now).is_empty());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_stale_transcript_does_not_describe_a_live_pane() {
        // A finished session's file sits there forever. Reporting its final
        // context as the current one would show a number for a pane that has
        // no agent in it at all.
        let root = fake_projects(
            "stale",
            &[("-a", "old.jsonl", r#"{"type":"user","cwd":"/a"}"#)],
        );
        let ancient = std::time::SystemTime::now() + RECENT_WINDOW + std::time::Duration::from_secs(60);
        assert!(
            transcripts_for(&root, "/a", ancient).is_empty(),
            "anything older than RECENT_WINDOW is not current"
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn two_agents_in_one_directory_are_reported_as_ambiguous() {
        // The single case discovery cannot resolve. Returning both lets the
        // caller render '--' rather than pick one and attribute another pane's
        // context to this one.
        let root = fake_projects(
            "ambiguous",
            &[
                ("-a", "s1.jsonl", r#"{"type":"user","cwd":"/a"}"#),
                ("-a", "s2.jsonl", r#"{"type":"user","cwd":"/a"}"#),
            ],
        );
        let now = std::time::SystemTime::now();
        assert_eq!(transcripts_for(&root, "/a", now).len(), 2);
        std::fs::remove_dir_all(&root).ok();
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path backend/Cargo.toml context::`
Expected: FAIL — `cannot find function transcripts_for in this scope`.

- [ ] **Step 3: Write the implementation**

Add to `backend/src/usage/context.rs`, above the test module:

```rust
/// How recently a transcript must have been written to describe a live pane.
///
/// A finished session's file remains on disk indefinitely; reporting its final
/// context would put a number on a pane with no agent in it. Generous enough
/// to cover a user reading output for a while without typing.
pub const RECENT_WINDOW: std::time::Duration = std::time::Duration::from_secs(30 * 60);

/// How many lines to read looking for a transcript's `cwd`.
/// It appears within the first few records; reading further is wasted IO on a
/// file we are about to reject anyway.
const CWD_PROBE_LINES: usize = 40;

/// The directory a transcript says it was recorded in.
fn recorded_cwd(path: &std::path::Path) -> Option<String> {
    use std::io::BufRead;
    let file = std::fs::File::open(path).ok()?;
    let reader = std::io::BufReader::new(file);
    for line in reader.lines().take(CWD_PROBE_LINES) {
        // A single unreadable line must not abandon the file: transcripts are
        // appended to live, so a partial write at the moment we read is normal.
        let Ok(line) = line else { continue };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if let Some(cwd) = value.get("cwd").and_then(|c| c.as_str()) {
            return Some(cwd.to_string());
        }
    }
    None
}

/// Every recently-written transcript recorded in `cwd`, newest first.
///
/// Matched on the cwd INSIDE the file rather than on the project directory's
/// name, because that name is lossy — slashes and spaces both become '-', so
/// it cannot be reconstructed from a path and two different paths can produce
/// the same folder. Reading it back is exact and cost 0.8 ms over nine project
/// directories when measured.
pub fn transcripts_for(
    root: &std::path::Path,
    cwd: &str,
    now: std::time::SystemTime,
) -> Vec<std::path::PathBuf> {
    let mut found: Vec<(std::time::SystemTime, std::path::PathBuf)> = Vec::new();

    let Ok(projects) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    for project in projects.flatten() {
        let Ok(files) = std::fs::read_dir(project.path()) else {
            continue;
        };
        for entry in files.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(modified) = entry.metadata().and_then(|m| m.modified()) else {
                continue;
            };
            match now.duration_since(modified) {
                Ok(age) if age > RECENT_WINDOW => continue,
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

/// Where Claude Code keeps its transcripts.
fn transcript_root() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(std::path::PathBuf::from(home).join(".claude/projects"))
}

/// Fraction 0..1 of the context window filled for the agent running in `cwd`.
///
/// None whenever the answer is not knowable, and that includes the ambiguous
/// case: two agents in one directory cannot be told apart from the outside, so
/// we report nothing rather than attribute one pane's context to another. The
/// plate draws '--' and is honest; a number here would look authoritative and
/// be wrong half the time.
pub fn context_fraction(cwd: &str) -> Option<Reading> {
    let root = transcript_root()?;
    let candidates = transcripts_for(&root, cwd, std::time::SystemTime::now());
    let [only] = candidates.as_slice() else {
        return None;
    };
    let snapshot = newest_snapshot(only)?;
    let window = context_window(&snapshot.model)?;
    Some(Reading {
        fraction: snapshot.used as f64 / window as f64,
        model: snapshot.model,
    })
}

/// What the plate can say about a session's context.
///
/// The model rides along because the transcript is the first place Doom Term
/// has ever been able to learn it. `/proc` yields only a binary name, which is
/// why the plate has had no model field and why inventing one was ruled out —
/// this one is read, not guessed.
#[derive(Debug, Clone, PartialEq)]
pub struct Reading {
    pub fraction: f64,
    pub model: String,
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path backend/Cargo.toml`
Expected: PASS — 42 passing, 1 ignored.

- [ ] **Step 5: Prove it against the real transcripts on this machine**

Add this `#[ignore]`d test — the same shape as `probes_the_live_endpoint` in the usage service, and for the same reason: it is what actually proves the contract, and it is the first thing to run if the slot ever goes back to `--`.

```rust
    #[test]
    #[ignore = "reads the real ~/.claude/projects; run by hand"]
    fn probes_the_live_transcripts() {
        let root = transcript_root().expect("HOME");
        let cwd = std::env::current_dir().unwrap().to_string_lossy().to_string();
        let found = transcripts_for(&root, &cwd, std::time::SystemTime::now());
        println!("transcripts for {cwd}: {}", found.len());
        for path in &found {
            if let Some(s) = newest_snapshot(path) {
                let window = context_window(&s.model);
                println!("  {:?} used={} model={} window={:?}", path.file_name().unwrap(), s.used, s.model, window);
            }
        }
        println!("context fraction: {:?}", context_fraction(&cwd));
    }
```

Run: `cargo test --manifest-path backend/Cargo.toml context::probes -- --ignored --nocapture`
Expected: with a Claude session running in this repository, one transcript, a `used` in the hundreds of thousands, `model=claude-opus-5`, `window=Some(1000000)` and a fraction between 0 and 1. If it prints two transcripts, the ambiguity path is live and `context_fraction` correctly returns `None`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/usage/context.rs
git commit -m "feat(context): find a pane's transcript by the directory it recorded"
```

---

### Task 5: Report it

`AppTelemetry.contextUsed` and its `pct()` rendering have existed since the HUD was built and have never been filled. This task fills them.

**Files:**
- Modify: `backend/src/main.rs` (the `Telemetry` variant and the `GetTelemetry` arm) — **selective staging**
- Modify: `src/types/terminal.ts` (`SystemTelemetryData`) — **selective staging**
- Modify: `src/hooks/usePtyEvents.ts:294`

**Interfaces:**
- Consumes: `context_fraction(cwd: &str) -> Option<Reading>` and `Reading { fraction, model }` (Task 4).
- Produces: `context_used` and `agent_model` on the wire; `AppTelemetry.contextUsed` and `AppTelemetry.model` populated.

`AppTelemetry.model` already exists and `toPlateState` already joins it into the agent name (`state.ts`: `[app.agentName, app.model].filter(Boolean).join(' · ')`). The spec called a model field impossible because `/proc` yields only a binary name — the transcript is the first source that actually carries it, so this fills the slot with a read value rather than an invented one.

- [ ] **Step 1: Note the starting checksums**

```bash
md5sum backend/src/main.rs src/types/terminal.ts
```

Keep them. Step 6 checks the working copies still contain the user's work.

> **Back up AFTER the edits, not before.** The backup's job is to restore
> `WIP + your changes` at the end of Step 4. A copy taken here holds the WIP
> *without* your changes, and restoring it silently reverts them in the working
> tree while leaving them staged — the commit looks right and the tree does not.
> Observed during execution; the backup now lives in Step 3.

- [ ] **Step 2: Make the change in the working tree**

In `backend/src/main.rs`, add to the `ServerMessage::Telemetry` variant, immediately after the `rate_used` field:

```rust
        /// Fraction 0..1 of the running agent's context window that is filled,
        /// or None when unknown. A different source entirely from `rate_used`:
        /// that is the account's rate limit over HTTPS, this is one session's
        /// window read from its transcript. They must never be conflated, and
        /// like `rate_used` this must never be coerced to 0.0.
        context_used: Option<f64>,
        /// The model the running agent is actually using, or None.
        ///
        /// Read from the transcript, never inferred. /proc yields only a
        /// binary name, which is why this field did not exist before and why
        /// inventing one was ruled out.
        agent_model: Option<String>,
```

In the `ClientMessage::GetTelemetry` arm, add immediately before the `let _ = tx.send(ServerMessage::Telemetry {` line:

```rust
            // Only for an agent whose transcripts we can read. A shell has no
            // context window, and reporting another vendor's agent against
            // Claude's transcripts would be a straightforward mislabel.
            let context = match agent.as_ref().map(|a| a.key) {
                Some("claude") => usage::context::context_fraction(&current_dir),
                _ => None,
            };
```

And add both fields to the struct literal, immediately after `rate_used: ...`:

```rust
                context_used: context.as_ref().map(|c| c.fraction),
                agent_model: context.map(|c| c.model),
```

In `src/types/terminal.ts`, add to `SystemTelemetryData`, immediately after `rate_used`:

```ts
  /**
   * Fraction 0..1 of the agent's context window that is filled, or null when
   * unknown. Unrelated to rate_used — that is the account's rate limit, this
   * is one session's window. Null renders '--'; it must not become 0.
   */
  context_used?: number | null;
  /** The model the agent is running, read from its transcript. Never inferred. */
  agent_model?: string | null;
```

In `src/hooks/usePtyEvents.ts`, add immediately after the `rateUsed:` line (currently line 294):

```ts
        contextUsed: data.context_used ?? undefined,
        model: data.agent_model ?? undefined,
```

- [ ] **Step 3: Verify it compiles, then back up `WIP + your changes`**

Run: `cargo test --manifest-path backend/Cargo.toml && npx tsc --noEmit && npx vitest run`
Expected: 42 Rust passing / 2 ignored; tsc clean; 193 TS tests passing.

Only now take the backup — this is the state Step 4 must restore:

```bash
SP=/tmp/claude-1000/-var-home-cleadmon-Projects-Doom-Term/f48e5876-9176-4029-91ff-0a0bba66c370/scratchpad
cp backend/src/main.rs "$SP/main.stageE.rs"
cp src/types/terminal.ts "$SP/terminal.stageE.ts"
```

- [ ] **Step 4: Stage only your own changes to the two WIP files**

`git add` would sweep the user's uncommitted work into your commit. Apply your edits to the committed baseline instead, stage that, then restore the full working copy.

Do it with a script rather than by hand, so the baseline gets exactly the Step 2 edits and nothing else. The `assert`s are the point: if an anchor has moved, this stops instead of silently producing a different file.

```bash
SP=/tmp/claude-1000/-var-home-cleadmon-Projects-Doom-Term/f48e5876-9176-4029-91ff-0a0bba66c370/scratchpad
git checkout HEAD -- backend/src/main.rs src/types/terminal.ts

python3 - <<'PY'
r = 'backend/src/main.rs'
s = open(r).read()

field = '''        rate_used: Option<f64>,
        /// Fraction 0..1 of the running agent's context window that is filled,
        /// or None when unknown. A different source entirely from `rate_used`:
        /// that is the account's rate limit over HTTPS, this is one session's
        /// window read from its transcript. They must never be conflated, and
        /// like `rate_used` this must never be coerced to 0.0.
        context_used: Option<f64>,
        /// The model the running agent is actually using, or None.
        ///
        /// Read from the transcript, never inferred. /proc yields only a
        /// binary name, which is why this field did not exist before and why
        /// inventing one was ruled out.
        agent_model: Option<String>,'''
assert s.count('        rate_used: Option<f64>,') == 1
s = s.replace('        rate_used: Option<f64>,', field)

anchor = '            let _ = tx.send(ServerMessage::Telemetry {'
compute = '''            // Only for an agent whose transcripts we can read. A shell has no
            // context window, and reporting another vendor's agent against
            // Claude's transcripts would be a straightforward mislabel.
            let context = match agent.as_ref().map(|a| a.key) {
                Some("claude") => usage::context::context_fraction(&current_dir),
                _ => None,
            };

'''
assert s.count(anchor) == 1
s = s.replace(anchor, compute + anchor)

lit = '''                rate_used: match agent.as_ref().map(|a| a.key) {
                    Some("claude") => usage.cached(),
                    _ => None,
                },'''
assert s.count(lit) == 1, 'the rate_used literal moved; re-anchor by hand'
s = s.replace(lit, lit + '''
                context_used: context.as_ref().map(|c| c.fraction),
                agent_model: context.map(|c| c.model),''')
open(r, 'w').write(s)

t = 'src/types/terminal.ts'
s = open(t).read()
anchor = '  rate_used?: number | null;'
assert s.count(anchor) == 1, 'the rate_used field moved; re-anchor by hand'
s = s.replace(anchor, anchor + '''
  /**
   * Fraction 0..1 of the agent's context window that is filled, or null when
   * unknown. Unrelated to rate_used — that is the account's rate limit, this
   * is one session's window. Null renders '--'; it must not become 0.
   */
  context_used?: number | null;
  /** The model the agent is running, read from its transcript. Never inferred. */
  agent_model?: string | null;''')
open(t, 'w').write(s)
print('baseline + Stage E edits only')
PY

cargo test --manifest-path backend/Cargo.toml >/dev/null && echo "baseline compiles"
git add backend/src/main.rs src/types/terminal.ts
cp "$SP/main.stageE.rs" backend/src/main.rs
cp "$SP/terminal.stageE.ts" src/types/terminal.ts
```

If either `assert` trips, the committed baseline has moved since this plan was written — apply that file's Step 2 edit by hand to the checked-out copy instead, then continue from `git add`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePtyEvents.ts
git commit -m "feat(context): report the agent's context window fill on the plate"
```

- [ ] **Step 6: Verify the user's uncommitted work survived**

```bash
git status --short | grep "^ M"                     # must list all 11 WIP files
git diff backend/src/main.rs | grep -c "session_id: Option<String>"   # the WIP hunk: 1
grep -c "context_used" backend/src/main.rs src/types/terminal.ts      # your edits are still in the tree
git diff --cached --stat                            # must be empty after the commit
```

Expected: eleven `M` entries; `1`; a non-zero count in both files; nothing staged.

The checksums from Step 1 will **not** match, and must not — the working copies
now hold the user's work *plus* your changes. What matters is that both are
present: the WIP hunk in `git diff`, and `context_used` in the file.

---

## Final verification

- [ ] `cargo test --manifest-path backend/Cargo.toml` — 42 passing, 1 ignored
- [ ] `cargo test --manifest-path crates/doom-term-pty/Cargo.toml` — 48 passing (untouched by this stage)
- [ ] `npx tsc --noEmit` — clean
- [ ] `npx vitest run` — 193 passing
- [ ] `npm run build` — succeeds
- [ ] The eleven uncommitted WIP files are still `M` and unstaged, and `git diff backend/src/main.rs` still contains the `Telemetry`/`session_id` hunk

## Live verification

Per `doom-term-two-tabs-fight-over-sessions`, **close duplicate browser tabs first**.

- [ ] `cargo test --manifest-path backend/Cargo.toml context::probes -- --ignored --nocapture` prints one transcript, a six-figure `used`, and a fraction between 0 and 1
- [ ] With `claude` running in a pane, CONTEXT shows a percentage rather than `--`, and it climbs as the conversation grows
- [ ] In a pane with a plain shell, CONTEXT stays `--` — a shell has no context window
- [ ] With `codex` or another non-Claude agent in the foreground, CONTEXT stays `--` rather than borrowing Claude's number
- [ ] The plate's agent well reads `CLAUDE CODE · CLAUDE-OPUS-5` — the model comes from the transcript, so it must match what the session is actually running
- [ ] Two Claude sessions in the same directory: both panes show `--`. This is the designed answer, not a bug — see the deviation section
- [ ] `cd` a pane out of the project and back; CONTEXT follows the directory
- [ ] USAGE and CONTEXT move independently — they are unrelated sources and a session can be 60% through its window on a fresh rate limit

## Verified during execution

Driven through the real daemon over its real protocol, with a stand-in binary
named `claude` in the pane's foreground so no quota was spent:

```
agent_key    "claude"          foreground detection through tmux pane_pid
context_used 0.658345          65.8%
agent_model  "claude-opus-5"   read from the transcript, not inferred
```

For a pane running a plain shell both fields serialize as `null`, which is the
honest answer — a shell has no context window.

The unit probe against the real transcripts reported `used=640388`,
`model=claude-opus-5`, `window=1000000`. The figure rose across the session
(58.0% → 64.0% → 65.8%) as the conversation grew, which is the behaviour the
slot is supposed to show.

One defect in this plan was found by executing it: Step 1 originally took the
backup *before* Step 2's edits, so restoring it at the end of Step 4 reverted
those edits in the working tree while leaving them correctly staged — a commit
that looks right over a tree that is not. The backup now happens in Step 3, and
Step 6 checks for both the WIP hunk and the new field rather than comparing
checksums that are no longer expected to match.

## Known limitations, stated rather than discovered

- **Two agents in one directory report `--`.** Discovery cannot tell them apart from outside the process. Installing the vendor hooks would fix it by carrying a `transcript_path` per session; that is the upgrade path, and the reason it is not in this stage is at the top of this plan.
- **Claude only.** Codex, Gemini and the rest keep their transcripts elsewhere in other formats. The structure extends — `context_fraction` takes a directory and returns a fraction whatever produced it — but each vendor needs its own discovery and parse. Claude first, as USAGE % did.
- **A model we do not know reports `--`.** `context_window` returns None rather than guessing, so a model released after the table was written shows nothing until the table is updated. The Models API (`max_input_tokens`) is the live source if that becomes tedious.
- **`used` excludes output tokens.** It measures what was sent, which is what fills the window on the next request. The current turn's reply is therefore not counted until it is — an understatement of at most one reply, well under a percent at these magnitudes.
- **No remote sessions.** Doom Term has no remote-session concept; when it does, the transcript lives on the far host and this reads the wrong machine's files.
