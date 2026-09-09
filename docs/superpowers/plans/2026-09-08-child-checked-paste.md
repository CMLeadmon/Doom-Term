# Child-Checked Paste Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task-by-task. The user explicitly requires inline work on main, with no subagents or worktree.

**Goal:** Clipboard paste reaches only a live child that can safely receive it, with visible refusals and no reconnect replay.

**Architecture:** A dedicated authenticated Paste/PasteResult exchange delegates admission to the PTY adapter. Direct PTYs use observed child mode; tmux conditionally delivers through its own command queue. Frontend clipboard reads are cancellable and are never ordinary queued Write messages.

**Tech Stack:** Rust/portable-pty/tmux, Tokio WebSockets, React/TypeScript, Vitest, Chromium/Playwright.

**Spec:** `docs/superpowers/specs/2026-09-08-child-checked-paste-design.md`

## Global Constraints

- Reject inputs larger than 1 MiB before buffering or spawning helper processes.
- Normalize CRLF/CR to LF; strip C0 controls except tab/LF and strip DEL.
- Unknown/dead sessions and unsupported multiline input are refused.
- Never queue or replay paste across disconnects; never log clipboard contents.
- Preserve the one-pixel visual divider and existing terminal keyboard contract.
- Use disposable PTYs/tmux servers; do not change the user's running daemon.

## Task 1: Child-side paste admission and framing

**Files:** `crates/doom-term-pty/src/paste.rs` (new), `lib.rs`, `demuxer.rs`, `session.rs`; `tests/paste.rs` (new).

**Interfaces:** `prepare_paste(text: &str) -> anyhow::Result<String>`; `PtySession::paste(&self, text: &str) -> anyhow::Result<()>`; `DemuxEvent::BracketedPasteMode { enabled: bool }`.

- [x] Add behavior tests for literals and limits:

```rust
assert_eq!(prepare_paste("one\rtwo\r\n三\t\x03")?, "one\ntwo\n三\t");
assert!(prepare_paste(&"x".repeat(1024 * 1024 + 1)).is_err());
```

- [x] Add demux tests for `\x1b[?2004h`, disabling, reset, and split CSI delivery. Observe red behavior before implementing.
- [x] Implement normalization and mode reports. Store observed mode in a shared input-state mutex. A direct paste checks that state and writes under the same admission lock. Empty sanitized text succeeds without writing.
- [x] Add real direct-PTY tests with a raw child that enables/disables mode and records exact input bytes. Verify unsupported multiline text produces no input, enabled input has exactly one marker pair, and Unicode/quotes remain literal.
- [x] Run `cargo test --locked -p doom-term-pty`; review the actual diff inline.

## Task 2: Bounded, conditional tmux delivery

**Files:** `crates/doom-term-pty/src/tmux.rs`, new `process_io.rs`, `paste.rs`, `tests/paste.rs`.

**Interfaces:** `TmuxHandle::paste(&self, text: &str) -> anyhow::Result<()>`; a private helper taking executable, argv, bounded stdin and a deadline, returning bounded stdout or an error.

- [x] Prove command-queue conditional syntax against an isolated tmux server. Use `bracket_paste_flag`, `load-buffer` stdin, `if-shell -F`, `paste-buffer -r -p -d`, and distinct literal success/refusal markers.
- [x] Name each buffer with an unpredictable private identifier. Quote only validated/escaped target identifiers inside tmux command strings; clipboard text never enters those strings.
- [x] Add real tmux tests for both child modes, two panes, payload quotes/Unicode, and empty buffer lists after success/refusal. Keep the existing real browser's unsupported-mode assertion failing until delivery is repaired.
- [x] Implement helper I/O with a finite deadline and bounded stdout. Kill/reap timed-out helpers and attempt bounded cleanup of only the named buffer. Test a hanging helper explicitly.
- [x] Run `cargo test --locked -p doom-term-pty`. Verify literal output and no residual buffers, not just helper exit status.

## Task 3: Correlated daemon protocol

**Files:** `backend/src/main.rs`, `backend/src/paste_tests.rs` (new).

**Interfaces:**

```text
Paste { request_id, id, text }
PasteResult { request_id, session_id, error: null | string }
```

- [x] Add real handler/socket tests for successful paste, unsupported multiline refusal, unknown session, and oversized text. Assert matching request/session ids and absence of child input on refusal.
- [x] Clone the exact live session before `spawn_blocking`; perform paste and send its correlated result from the blocking task. The WebSocket authentication gate applies before dispatch as for other commands.
- [x] Use generic errors that do not include clipboard contents. No automatic retries after failures.
- [x] Run `cargo test --locked -p doom-term-server` and existing authentication regressions.

## Task 4: Frontend request lifecycle and terminal UI

**Files:** `src/core/ptyClient.ts`, `ptyClient.test.ts`, `src/components/RawTerminalView.tsx`, `RawTerminalView.clipboard.test.tsx`, `src/App.tsx`, emulator revision tracking.

**Interface:** `pasteToSession(id: string, text: string): Promise<void>`.

- [x] Add protocol tests that reject disconnected use, correlate both request id and session id, reject daemon refusal, expire finite response waits, and reject on session close/disconnect. Assert reconnect sends no Paste or fallback Write.
- [x] Implement a separate pending-paste map, not pendingWrites. A timeout reports uncertain delivery and does not retry.
- [x] Route native and keyboard clipboard input through the dedicated API. Preserve local normalization/defensive mode checks where meaningful, but tmux outer mode never authorizes the final delivery.
- [x] Keep stale-read invalidation and transient error notices. Extend tests to cover actual request-boundary errors without replacing the real emulator in the lifecycle tests.
- [x] Run `npm test` and `npm run typecheck`.

## Task 5: End-to-end proof and publication

**Files:** `tools/test-frontend-ui.mjs`, `README.md`, `AGENTS.md`, `docs/BETA_READINESS.md`.

- [x] Run the maintained production-CSP Chromium suite: unsupported Bash paste must insert nothing; enabled CR paste waits for Enter; quick-select, job control, real vi save/restore, and divider-to-PTY resize still work.
- [x] Inspect editor, blocked-paste, split, and narrow screenshots. A collected probe failure must keep the overall command nonzero.
- [x] Run `npm test`, `npm run typecheck`, `npm run build`, `npm run hud:check`, `cargo check --locked`, `cargo test --locked`, and native all-target compilation in the available development environment.
- [x] Update documentation with the precise supported behavior and remaining nested-multiplexer/identity limitations. Record evidence without promoting partial tests to beta certification.
- [x] Review inline and verify origin/main is unchanged before publication. Publish directly on main; keep the broader beta-readiness goal active. Git history records the publication outcome.

## Review notes

- Exact tmux session selection needs `=name:` (the colon disambiguates a
  session from a window). Tests prove missing prefixes cannot target a neighbor.
- A pane disappearing after buffer load exercises failure cleanup; an unrelated
  named buffer and its contents survive. Helpers use 2-second deadlines and a
  4 KiB output cap; pending frontend results expire after 10 seconds.
- The final inline review added a regression for typing during an in-flight
  paste: it cancels a stale clipboard read, but must not hide an already-sent
  request's refusal. These now have separate lifecycle counters.
- Editor input/save passes, but screenshot inspection found a separate first-row
  clipping issue. It is recorded in BETA_READINESS.md for the next audit repair;
  this paste checkpoint does not certify full-screen rendering or beta readiness.
