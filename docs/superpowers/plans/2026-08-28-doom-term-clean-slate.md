# Doom Term Clean-Slate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every fabricated feature and inert subsystem from Doom Term, replace invented telemetry with observed facts, and bring the window chrome to the published design system — closing GitHub issues #1–#6 along the way.

**Architecture:** Deletion first, so later tasks touch a smaller surface. Then the data layer becomes honest (the daemon already knows the truth; the frontend was overriding it). Then the chrome conforms to the design system. Then the workspace model becomes plural. The canvas plate renderer and the terminal emulator are load-bearing and correct — they are preserved throughout.

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind 3; Rust (portable-pty, vte, tokio, tungstenite) for the daemon and Tauri shell; vitest + `node --test` + `cargo test`.

**Spec:** `docs/superpowers/specs/2026-08-28-doom-term-review.md` — read it first. Findings are referenced below as F1…F13.

## Global Constraints

- **Every displayed datum must be observed, never invented.** A slot with no honest source renders `--`. Never a plausible placeholder.
- **No game vocabulary in any user-visible string.** Banned: AMMO, HEALTH, ARMOR, ARMS, KEYS, E1M1, marine, Doomguy, PHOBOS. Use CONTEXT, USAGE, SANDBOX, AGENT, PATH, BRANCH, credentials.
- **Four materials, no fifth:** plate, recess, 1px bevel pair, ink. `border-radius: 0` everywhere; no blurred shadows — depth is the bevel pair only.
- **Plate scales by integers only.** Fractional scaling destroys the striation and the 1px bevels.
- **Text sitting on plate is `#22201b`** (near-black), never bone. Text in a recess is `--ink #d8cbb0` / `--ink-tan #c8bb9c` / `--ink-dim #8f8672` on ground `#14120f`.
- **Five states, one colour each:** live `#e0a92c`, pass `#5c9c3a`, fail `#ef4136`, idle `#847c6e`, info `#3a6fd8`. Red on the plate is reserved for the display numerals.
- **Every ink token must clear WCAG AA against `--ground`.** `src/styles/material.test.js` enforces this; do not weaken it.
- **After Task 4 there is exactly one Rust PTY implementation.** Never re-fork `backend/` and `src-tauri/`.
- **Gates for every task:** `npm run build` clean, `npm test` green (87 tests baseline), `cargo test --manifest-path backend/Cargo.toml` green (19 baseline). Test counts only go up.

## A note on task shape

Tasks that change behaviour use a strict red-green TDD cycle. **Pure-deletion tasks (1, 2, 7a) cannot have a failing test first** — there is no new behaviour to specify. They instead use *verification steps*: a grep proving zero remaining references, plus the full gate. Where a deletion has an invariant worth locking against regression, a real test is added. Do not fabricate a red-green cycle for a deletion.

---

### Task 1: Delete the three inert subsystems and the unreferenced modules

Closes F3. `links`, `tasks` and `messages` are initialised to `[]` and written by nothing, so the graph, pipeline and bus can never do work. `wadParser`, `blockStore`, `types/wad`, `estimateTokensFromBlocks` and both Rust `wad` modules have zero callers.

**Files:**
- Delete: `src/core/contextGraph.ts`, `src/core/taskPipeline.ts`, `src/core/messageBus.ts`, `src/core/wadParser.ts`, `src/core/blockStore.ts`, `src/types/wad.ts`
- Delete: `backend/src/wad/mod.rs`, `src-tauri/src/wad/mod.rs`
- Modify: `src/App.tsx` (imports 21-23, memos 43-45, effect body 239-250, dep array 311, palette action ~694)
- Modify: `src/types/sessionTree.ts:9-31,67-69`, `src/core/sessionStore.ts:65-67,114-116`, `src/hud/state.ts:72-118`
- Modify: `backend/src/main.rs:2`, `src-tauri/src/lib.rs:3,31`, `src-tauri/src/commands.rs:8,218`

**Interfaces:**
- Produces: `ProjectWorkspace` without `links` / `tasks` / `messages`. Every later task consumes this narrowed type.

- [ ] **Step 1: Prove the subsystems are inert before deleting them**

Run each; every one must print nothing. If any prints a hit, stop — the premise is wrong and this task needs re-scoping.

```bash
cd "/var/home/cleadmon/Projects/Doom Term"
grep -rn "\.links\s*=\|\.tasks\s*=\|\.messages\s*=\|addLink\|createLink\|addTask\|sendMessage" src/ --include="*.ts" --include="*.tsx" | grep -v "sessionStore.ts\|sessionTree.ts\|core/messageBus.ts\|core/taskPipeline.ts\|core/contextGraph.ts"
grep -rn "wadParser\|blockStore\|estimateTokensFromBlocks" src/ --include="*.ts" --include="*.tsx" | grep -v "core/wadParser.ts\|core/blockStore.ts\|hud/state.ts"
grep -rn "parse_wad_file" src/
```

- [ ] **Step 2: Delete the module files**

```bash
git rm src/core/contextGraph.ts src/core/taskPipeline.ts src/core/messageBus.ts \
       src/core/wadParser.ts src/core/blockStore.ts src/types/wad.ts \
       backend/src/wad/mod.rs src-tauri/src/wad/mod.rs
```

- [ ] **Step 3: Narrow the workspace type**

In `src/types/sessionTree.ts`, delete the `ContextLink`, `InterAgentMessage` and `ChainedTask` interfaces (lines 9-31) and remove these three fields from `ProjectWorkspace`:

```ts
  links: ContextLink[];
  tasks: ChainedTask[];
  messages: InterAgentMessage[];
```

Also narrow `SessionKind` — `'verify'` is removed in Task 2, so leave it for now:

```ts
export type SessionKind = 'terminal' | 'agent' | 'tui' | 'verify' | 'scratchpad';
```

- [ ] **Step 4: Remove the three empty-array initialisers from both workspace factories**

In `src/core/sessionStore.ts`, delete `links: [],` `tasks: [],` `messages: [],` from the object returned by `createDefaultWorkspace()` (lines 65-67) and from `createWorkspaceForFolder()` (lines 114-116).

- [ ] **Step 5: Unwire them from App.tsx**

Delete imports on lines 21-23:

```ts
import { ContextGraph } from './core/contextGraph';
import { TaskPipeline } from './core/taskPipeline';
import { InterAgentMessageBus } from './core/messageBus';
```

Delete the three memos on lines 43-45. In the `onExecutionEnd` handler, delete the task-pipeline and message-bus block (lines 239-251), leaving:

```ts
          const newWorkspace = {
            ...prev,
            nodes: {
              ...prev.nodes,
              [updatedNode.id]: updatedNode,
            },
          };

          return newWorkspace;
```

Change the effect dependency array on line 311 from `[taskPipeline, messageBus]` to `[]`.

Delete the palette action that calls `contextGraph.getTranscript` (the `CONTEXT · Copy Node Transcript (Linked Context)` entry, around line 690-700).

- [ ] **Step 6: Delete the second copy of the fake token maths**

In `src/hud/state.ts`, delete `BlockTokenData` (lines 72-77) and `estimateTokensFromBlocks` (lines 82-118) in full. The file should end after `plateScale`.

- [ ] **Step 7: Remove the Rust wad modules from their crates**

`backend/src/main.rs` line 2 — delete `mod wad;`.
`src-tauri/src/lib.rs` — delete `pub mod wad;` (line 3) and `commands::parse_wad_file,` from the handler list (line 31).
`src-tauri/src/commands.rs` — delete the `use crate::wad::{...}` import (line 8), the `parse_wad_file` command (line 218 onward) and the `WadParsedSummary` struct it returns.

- [ ] **Step 8: Verify nothing references the deleted code**

Every command must print nothing:

```bash
grep -rn "contextGraph\|ContextGraph\|taskPipeline\|TaskPipeline\|messageBus\|InterAgentMessageBus" src/
grep -rn "wadParser\|blockStore\|estimateTokensFromBlocks\|BlockTokenData" src/
grep -rn "ContextLink\|ChainedTask\|InterAgentMessage" src/
grep -rn "mod wad\|parse_wad_file\|WadParsedSummary" backend/src src-tauri/src
```

- [ ] **Step 9: Run the gate**

```bash
npm run build && npm test && cargo test --manifest-path backend/Cargo.toml
```
Expected: build clean, 87 tests pass, 19 Rust tests pass.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: delete inert context graph, task pipeline, message bus and WAD parsing

links/tasks/messages were initialised empty and written by no code path, so
the three subsystems built on them could never do work. wadParser, blockStore,
types/wad, estimateTokensFromBlocks and both Rust wad modules had no callers.

~965 lines removed. Refs F3."
```

---

### Task 2: Delete the fabricated Verification panel

Closes F1. The panel hardcodes `verdict: 'APPROVED'` with four always-PASS lenses carrying invented evidence, and wires "APPLY VERIFIED PATCH" to `git apply patch.diff` — a file no code path produces.

**Files:**
- Delete: `src/components/VerificationPanel.tsx`
- Modify: `src/App.tsx` (import 17, state 69-73, `handleOpenVerification` 579-590, header button 863-869, palette action ~704, modal 926-953)
- Modify: `src/components/ArchitecturalComponents.test.tsx` (delete the `VerificationPanel` describe block, lines 104-133, and its import on line 5)
- Modify: `src/types/sessionTree.ts` (drop `'verify'` from `SessionKind`)

**Interfaces:**
- Produces: `SessionKind = 'terminal' | 'agent' | 'tui' | 'scratchpad'`. Task 9's `kindLabel` map consumes this.

- [ ] **Step 1: Delete the component and its test**

```bash
git rm src/components/VerificationPanel.tsx
```

In `src/components/ArchitecturalComponents.test.tsx`, delete line 5 (`import { VerificationPanel } ...`) and the entire `describe('VerificationPanel', ...)` block (lines 104-133).

- [ ] **Step 2: Unwire it from App.tsx**

Delete the import on line 17, the `activeVerification` state declaration (lines 69-73), the whole `handleOpenVerification` function (lines 579-590), the `⚖ VERIFY` header button (lines 863-869), the `VERIFY · Open Multi-Lens Verification Panel` palette action, and the entire `{activeVerification && (...)}` modal block (lines 926-953).

- [ ] **Step 3: Narrow SessionKind**

```ts
export type SessionKind = 'terminal' | 'agent' | 'tui' | 'scratchpad';
```

Fix the now-unreachable branch in `handleCreateNode`'s label map (it currently ends `: 'Verify'`) — Task 9 rewrites this function, so for now just make it compile:

```ts
    const kindLabel =
      kind === 'terminal' ? 'Terminal' : kind === 'agent' ? 'Agent' : kind === 'scratchpad' ? 'Notes' : 'Session';
```

- [ ] **Step 4: Verify the dangerous command is gone**

Both must print nothing:

```bash
grep -rn "patch.diff\|VerificationPanel\|activeVerification\|VerificationLens" src/
grep -rn "'verify'" src/types/sessionTree.ts
```

- [ ] **Step 5: Run the gate**

```bash
npm run build && npm test
```
Expected: build clean. Test count drops from 79 to 78 vitest (the deleted VerificationPanel test); `node --test` stays at 8.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: delete the fabricated multi-lens verification panel

The panel hardcoded an APPROVED verdict and four always-PASS lenses with
invented evidence ('29/29 tests passing', '60 FPS verified') that measured
nothing, then wired its primary action to 'git apply patch.diff' — a file no
code path ever produces. Refs F1."
```

---

### Task 3: Make a new session honest

Closes F4. Every fresh workspace is seeded with a block advertising "20 Architectural Improvements", a Worktree Tree that no longer exists, and the subsystems deleted in Task 1 — in five-colour rainbow ANSI.

**Files:**
- Modify: `src/core/sessionStore.ts:17-45` (the seeded block), `:160-175` (`loadRecentWorkspaces`)
- Create: `src/core/sessionStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/sessionStore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createDefaultWorkspace, createWorkspaceForFolder, SessionStore } from './sessionStore';

describe('workspace seeding', () => {
  it('seeds no fabricated product copy', () => {
    const serialised = JSON.stringify(createDefaultWorkspace());
    expect(serialised).not.toMatch(/Architectural|VelaTerm|nodeterm|Worktree|Messaging Bus|Multi-Lens/i);
  });

  it('opens a new session with no output at all', () => {
    const ws = createDefaultWorkspace();
    const node = Object.values(ws.nodes)[0];
    expect(node.blocks).toEqual([]);
    expect(node.commandHistory).toEqual([]);
  });

  it('does not invent a recent workspace on a clean machine', () => {
    window.localStorage.removeItem('DOOM_TERM_RECENT_WORKSPACES_V1');
    expect(SessionStore.loadRecentWorkspaces()).toEqual([]);
  });

  it('names a folder workspace after the folder', () => {
    const ws = createWorkspaceForFolder('/home/u/Projects/thing');
    expect(ws.name).toBe('THING');
    expect(ws.rootPath).toBe('/home/u/Projects/thing');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/core/sessionStore.test.ts`
Expected: FAIL — the first three assertions fail against the seeded banner and the hardcoded recent entry.

- [ ] **Step 3: Empty the seeded session**

In `createDefaultWorkspace()`, replace the `blocks: [ ... ]` array (lines 17-41) with `blocks: [],` and replace `commandHistory: ['doom-term --version', 'cargo check', 'git status'],` with `commandHistory: [],`. Delete the now-unused `parseAnsiText` import on line 2.

- [ ] **Step 4: Stop inventing a recent workspace**

In `loadRecentWorkspaces()`, both the no-`localStorage` early return and the fallback at the end currently return `[{ name: 'DOOM TERM', path: '~/Projects/Doom Term' }]`. Return `[]` from both.

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx vitest run src/core/sessionStore.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Run the gate and commit**

```bash
npm run build && npm test
git add -A
git commit -m "feat: open new sessions empty instead of seeding fabricated copy

Every fresh workspace shipped a block claiming '20 Architectural Improvements
from nodeterm & VelaTerm', a Worktree Tree deleted from this tree, and the
subsystems removed in the previous commit — in five-colour ANSI that breaks
the one-colour-per-state rule. loadRecentWorkspaces() also invented a personal
path on a clean machine. Refs F4."
```

---

### Task 4: Extract one shared Rust PTY crate

Closes F9. `backend/src/pty/` and `src-tauri/src/pty/` are hand-mirrored and have already drifted — the `scrollback_ring` and `Reattach` support exist only in `backend/`, so `reattachSession()` silently no-ops in the shipped desktop app.

The two `session.rs` files differ only in transport (callbacks vs `AppHandle::emit`) and in `master` being `Arc<Mutex<Box<dyn MasterPty + Send>>>` vs a plain `Box`. The callback form is strictly more general, so the shared crate takes the `backend/` version and the Tauri shell adapts by passing a closure that emits.

**Files:**
- Create: `crates/doom-term-pty/Cargo.toml`, `crates/doom-term-pty/src/lib.rs`
- Move: `backend/src/pty/{demuxer,session,shell_integration}.rs` → `crates/doom-term-pty/src/`
- Delete: `backend/src/pty/mod.rs`, `src-tauri/src/pty/` (whole directory)
- Modify: `backend/Cargo.toml`, `src-tauri/Cargo.toml`, `backend/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/commands.rs`

**Interfaces:**
- Produces: crate `doom_term_pty` exporting `DemuxEvent`, `StreamDemuxer`, `PtySession`, `expand_path`, and (from Task 5) `foreground_agent` / `detect_isolation`. Tasks 5 and 12 add to this crate.
- `PtySession::spawn<F, C>(id, cols, rows, cwd, shell, event_callback: F, close_callback: C) -> Result<Self> where F: FnMut(DemuxEvent) + Send + 'static, C: FnMut() + Send + 'static`

- [ ] **Step 1: Confirm the trees are still identical where they claim to be**

```bash
cd "/var/home/cleadmon/Projects/Doom Term"
diff backend/src/pty/demuxer.rs src-tauri/src/pty/demuxer.rs && echo "demuxer identical — safe to collapse"
diff backend/src/pty/shell_integration.rs src-tauri/src/pty/shell_integration.rs && echo "shell_integration identical — safe to collapse"
```
Both must print their confirmation. If `demuxer.rs` differs, reconcile by hand before continuing — `backend/` is the newer tree.

- [ ] **Step 2: Create the crate manifest**

Create `crates/doom-term-pty/Cargo.toml`:

```toml
[package]
name = "doom-term-pty"
version = "0.1.0"
edition = "2021"

[dependencies]
portable-pty = "0.8"
vte = "0.14"
serde = { version = "1.0", features = ["derive"] }
parking_lot = "0.12"
anyhow = "1.0"
log = "0.4"

[target.'cfg(unix)'.dependencies]
nix = { version = "0.29", features = ["signal", "process", "term"] }
```

- [ ] **Step 3: Move the implementation in, unchanged**

```bash
mkdir -p crates/doom-term-pty/src
git mv backend/src/pty/demuxer.rs           crates/doom-term-pty/src/demuxer.rs
git mv backend/src/pty/session.rs           crates/doom-term-pty/src/session.rs
git mv backend/src/pty/shell_integration.rs crates/doom-term-pty/src/shell_integration.rs
git rm backend/src/pty/mod.rs
git rm -r src-tauri/src/pty
```

Create `crates/doom-term-pty/src/lib.rs`:

```rust
//! The Doom Term PTY layer: one implementation, two shells.
//!
//! The standalone WebSocket daemon (`backend/`) and the Tauri desktop app
//! (`src-tauri/`) both consume this crate. They differ only in transport, so
//! `PtySession::spawn` takes callbacks rather than knowing about either one.
//! Nothing here may be forked back into a consumer.

pub mod demuxer;
pub mod session;
pub mod shell_integration;

pub use demuxer::{DemuxEvent, StreamDemuxer};
pub use session::{expand_path, PtySession};
```

In the three moved files, change any `use super::` / `use crate::pty::` path to `use crate::`. In `session.rs` that is `use super::shell_integration::apply_shell_integration;` → `use crate::shell_integration::apply_shell_integration;`.

- [ ] **Step 4: Point the daemon at the crate**

In `backend/Cargo.toml`, add to `[dependencies]`:

```toml
doom-term-pty = { path = "../crates/doom-term-pty" }
```

In `backend/src/main.rs`, delete `mod pty;` and add:

```rust
use doom_term_pty as pty;
```

This keeps every existing `pty::session::…` and `pty::DemuxEvent` path in `main.rs` working untouched.

- [ ] **Step 5: Point the Tauri shell at the crate and adapt its transport**

In `src-tauri/Cargo.toml`, add the same `doom-term-pty = { path = "../crates/doom-term-pty" }`.

In `src-tauri/src/lib.rs`, delete `pub mod pty;` and add `use doom_term_pty as pty;`.

In `src-tauri/src/commands.rs`, replace the `PtySession::spawn(..., app_handle)` call with the callback form. The closure is what used to be inlined in the Tauri reader thread:

```rust
let session_id = id.clone();
let emit_handle = app.clone();
let close_handle = app.clone();
let close_id = id.clone();

let session = pty::PtySession::spawn(
    id.clone(),
    cols,
    rows,
    cwd,
    shell,
    move |event| {
        let _ = emit_handle.emit(&format!("pty-event-{}", session_id), &event);
        let _ = emit_handle.emit("pty-event-all", (&session_id, &event));
    },
    move || {
        let _ = close_handle.emit("pty-closed", &close_id);
    },
)?;
```

`Emitter` must stay imported in `commands.rs` (`use tauri::{AppHandle, Emitter};`).

- [ ] **Step 6: Add a reattach command to the Tauri shell so the trees have parity**

The desktop app had no equivalent of the daemon's `Reattach`. Add one in `src-tauri/src/commands.rs` so `ptyClient.reattachSession()` stops silently no-opping:

```rust
#[tauri::command]
pub async fn reattach_session(
    state: tauri::State<'_, PtyState>,
    id: String,
) -> Result<Vec<pty::DemuxEvent>, String> {
    let sessions = state.sessions.read();
    let session = sessions.get(&id).ok_or_else(|| format!("no session {}", id))?;
    Ok(session.scrollback())
}
```

Register it in `src-tauri/src/lib.rs` alongside the other handlers.

- [ ] **Step 7: Prove the fork is gone and both crates build**

```bash
test ! -d src-tauri/src/pty && test ! -d backend/src/pty && echo "no forked pty trees remain"
cargo test --manifest-path crates/doom-term-pty/Cargo.toml
cargo test --manifest-path backend/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: the 19 PTY tests now run from the shared crate; `backend` builds and tests green.

**If `cargo check` on `src-tauri` fails with a `dbus-1` / `libdbus-sys` pkg-config error, that is the known pre-existing environment gap, not a regression from this task.** Record the exact error in the commit body and proceed; the fix is `sudo dnf install dbus-devel pkgconf-pkg-config`, which is outside this plan.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: extract crates/doom-term-pty as the single PTY implementation

backend/src/pty and src-tauri/src/pty were hand-mirrored and had already
drifted: the 500-event scrollback ring and Reattach existed only in backend,
so reattachSession() silently no-opped in the shipped desktop app. Both
consumers now depend on one crate and the Tauri shell gains reattach parity.
Refs F9."
```

---

### Task 5: Detect the agent for real; stop inventing isolation

Closes half of F2 and all of GitHub #2. The frontend currently decides an agent is running from the *tab title*. The honest signal is the PTY's foreground process group: `/proc/<shell_pid>/stat` field 8 (`tpgid`) is the foreground pgid of the controlling terminal, and `/proc/<tpgid>/comm` is what is actually running.

**Files:**
- Create: `crates/doom-term-pty/src/foreground.rs`
- Modify: `crates/doom-term-pty/src/lib.rs`, `crates/doom-term-pty/src/session.rs` (expose `shell_pid`)
- Modify: `backend/src/main.rs` (`GetTelemetry` handler, `ServerMessage::Telemetry`)
- Modify: `src/types/terminal.ts` (`SystemTelemetryData`)

**Interfaces:**
- Consumes: `PtySession` from Task 4.
- Produces:
  - `pub fn foreground_command(shell_pid: u32) -> Option<String>`
  - `pub fn classify_agent(comm: &str) -> Option<AgentIdentity>` where `pub struct AgentIdentity { pub key: &'static str, pub name: &'static str }`
  - `pub fn detect_isolation() -> &'static str` returning `"sandbox"` or `"host"`
  - `PtySession::shell_pid(&self) -> Option<u32>`
  - Wire format: `Telemetry` gains `agent_key: Option<String>`, `agent_name: Option<String>` and replaces `sandbox_level: u8` with `isolation: String`. Task 6 consumes these.

- [ ] **Step 1: Write the failing tests**

Create `crates/doom-term-pty/src/foreground.rs` containing only the test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tpgid_from_a_stat_line_whose_comm_contains_spaces_and_parens() {
        // /proc/<pid>/stat field 2 is parenthesised and may itself contain
        // ')' and spaces, so the parse must split after the LAST ')'.
        let stat = "4242 (my )weird( proc) S 4240 4242 4242 34816 9001 4194304 …";
        assert_eq!(parse_tpgid(stat), Some(9001));
    }

    #[test]
    fn a_shell_in_the_foreground_of_its_own_terminal_is_not_an_agent() {
        assert!(classify_agent("bash").is_none());
        assert!(classify_agent("zsh").is_none());
        assert!(classify_agent("ls").is_none());
    }

    #[test]
    fn known_agent_binaries_are_identified_without_inventing_a_model() {
        let claude = classify_agent("claude").expect("claude is an agent");
        assert_eq!(claude.key, "claude");
        assert_eq!(claude.name, "CLAUDE CODE");
        assert_eq!(classify_agent("codex").unwrap().name, "CODEX");
        assert_eq!(classify_agent("gemini").unwrap().name, "GEMINI CLI");
    }

    #[test]
    fn a_negative_tpgid_means_no_controlling_terminal() {
        assert_eq!(parse_tpgid("1 (init) S 0 1 1 0 -1 4194560"), None);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path crates/doom-term-pty/Cargo.toml foreground`
Expected: FAIL to compile — `parse_tpgid` and `classify_agent` are not defined.

- [ ] **Step 3: Implement the detector**

Prepend to `crates/doom-term-pty/src/foreground.rs`:

```rust
//! Who is actually running in the terminal.
//!
//! The only honest answer comes from the kernel: /proc/<pid>/stat field 8
//! (`tpgid`) is the foreground process group of the controlling terminal, and
//! /proc/<tpgid>/comm is the command in it. Never guess from a tab title.

/// What the plate needs to render an agent. There is deliberately no `model`
/// field: no agent CLI reports its model to the terminal, so any model string
/// here would be invented.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentIdentity {
    pub key: &'static str,
    pub name: &'static str,
}

/// Field 8 of /proc/<pid>/stat. `comm` (field 2) is parenthesised and may
/// contain ')' and spaces, so split after the LAST ')': the remaining fields
/// are state, ppid, pgrp, session, tty_nr, tpgid — tpgid is index 5.
fn parse_tpgid(stat: &str) -> Option<i32> {
    let after_comm = stat.rsplit_once(')')?.1;
    let tpgid: i32 = after_comm.split_whitespace().nth(5)?.parse().ok()?;
    if tpgid <= 0 { None } else { Some(tpgid) }
}

/// The command currently in the foreground of `shell_pid`'s terminal.
/// Returns None off Linux, or when the shell itself is in the foreground.
pub fn foreground_command(shell_pid: u32) -> Option<String> {
    let stat = std::fs::read_to_string(format!("/proc/{}/stat", shell_pid)).ok()?;
    let tpgid = parse_tpgid(&stat)?;
    let comm = std::fs::read_to_string(format!("/proc/{}/comm", tpgid)).ok()?;
    Some(comm.trim().to_string())
}

/// Map a real process name to a plate identity. Unknown binaries are not
/// agents — a plain command must never light up the agent well.
pub fn classify_agent(comm: &str) -> Option<AgentIdentity> {
    let (key, name) = match comm {
        "claude"                => ("claude",   "CLAUDE CODE"),
        "codex"                 => ("codex",    "CODEX"),
        "gemini"                => ("gemini",   "GEMINI CLI"),
        "agy" | "antigravity"   => ("gemini",   "ANTIGRAVITY"),
        "aider"                 => ("claude",   "AIDER"),
        "opencode"              => ("opencode", "OPENCODE"),
        "grok"                  => ("grok",     "GROK CLI"),
        "copilot"               => ("copilot",  "GITHUB COPILOT"),
        _ => return None,
    };
    Some(AgentIdentity { key, name })
}

/// Isolation is reported, never assumed. The daemon spawns onto the host, so
/// the only true "sandbox" is the whole process being containerised.
pub fn detect_isolation() -> &'static str {
    let contained = std::path::Path::new("/run/.containerenv").exists()
        || std::path::Path::new("/.dockerenv").exists();
    if contained { "sandbox" } else { "host" }
}
```

Add `pub mod foreground;` and `pub use foreground::{classify_agent, detect_isolation, foreground_command, AgentIdentity};` to `crates/doom-term-pty/src/lib.rs`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path crates/doom-term-pty/Cargo.toml foreground`
Expected: PASS, 4 tests.

- [ ] **Step 5: Expose the shell pid from the session**

In `crates/doom-term-pty/src/session.rs`, the spawned child is already available where `spawn_command` is called. Store its pid on the struct and add an accessor:

```rust
    /// The pid of the shell this session owns, for foreground-process lookup.
    shell_pid: Option<u32>,
```

Set it from the child immediately after spawning (`let shell_pid = child.process_id();`), include `shell_pid` in the struct literal returned by `spawn`, and add:

```rust
    pub fn shell_pid(&self) -> Option<u32> {
        self.shell_pid
    }
```

- [ ] **Step 6: Report the truth from the daemon**

In `backend/src/main.rs`, `ClientMessage::GetTelemetry` currently sends `sandbox_level: 100` unconditionally. Replace that send with:

```rust
            let agent = sessions
                .read()
                .values()
                .find_map(|s| s.shell_pid())
                .and_then(pty::foreground_command)
                .and_then(|comm| pty::classify_agent(&comm));

            let _ = tx.send(ServerMessage::Telemetry {
                username,
                hostname,
                current_dir,
                git_branch,
                isolation: pty::detect_isolation().to_string(),
                agent_key: agent.as_ref().map(|a| a.key.to_string()),
                agent_name: agent.as_ref().map(|a| a.name.to_string()),
                credentials: Some([has_ssh, has_cloud, has_signing]),
            });
```

Update the `ServerMessage::Telemetry` variant to match: drop `sandbox_level: u8`, add `isolation: String`, `agent_key: Option<String>`, `agent_name: Option<String>`. Leave the existing credential and branch probes exactly as they are — they were already honest.

- [ ] **Step 7: Update the wire type on the frontend**

In `src/types/terminal.ts`:

```ts
export interface SystemTelemetryData {
  username: string;
  hostname: string;
  current_dir: string;
  git_branch: string | null;
  isolation: 'sandbox' | 'host';
  agent_key: string | null;
  agent_name: string | null;
  credentials?: [boolean, boolean, boolean];
}
```

- [ ] **Step 8: Run the gate and commit**

```bash
cargo test --manifest-path crates/doom-term-pty/Cargo.toml
cargo test --manifest-path backend/Cargo.toml
npm run build
git add -A
git commit -m "feat: identify the running agent from the PTY foreground process

Reads /proc/<shell>/stat tpgid and /proc/<tpgid>/comm rather than guessing
from tab titles, and reports isolation from the actual container state instead
of hardcoding sandbox_level: 100. No model string is reported, because no agent
CLI tells the terminal its model. Refs F2, closes #2 (backend half)."
```

---

### Task 6: Delete the invented frontend telemetry and show `--` for the unknowable

Closes the rest of F2 and F11. `agentDetector.ts` invents model names and a token count from a fabricated 14 000-character constant; `App.tsx:330` then prevents the daemon's real values from ever replacing them.

**Files:**
- Delete: `src/core/agentDetector.ts`, `src/core/tokenMeter.ts`, `src/core/agentDetector.test.ts`
- Modify: `src/hud/state.ts` (`AppTelemetry`, `toPlateState`), `src/App.tsx` (initial telemetry 48-59, telemetry effect 297-334)
- Modify: `src/hud/state.test.js`

**Interfaces:**
- Consumes: `SystemTelemetryData` from Task 5.
- Produces: `AppTelemetry` with `contextUsed`/`rateUsed`/`tokens` all optional-and-usually-absent; `toPlateState` renders `'--'` for absent percentages and `table: []` for absent counters.

- [ ] **Step 1: Write the failing tests**

Append to `src/hud/state.test.js`:

```js
test('an unknown percentage renders as dashes, never as a number', () => {
  const s = toPlateState({ agent: 'claude', agentName: 'CLAUDE CODE' });
  assert.equal(s.context, '--');
  assert.equal(s.usage, '--');
});

test('no counter table is drawn when nothing has been counted', () => {
  const s = toPlateState({ agent: 'claude' });
  assert.deepEqual(s.table, []);
});

test('a plain shell reports no agent name at all', () => {
  const s = toPlateState({ agent: 'shell', agentName: undefined });
  assert.equal(s.agentName, '');
});

test('isolation renders as a tier name, never invented as FULL', () => {
  assert.equal(toPlateState({ isolation: 'host' }).sandbox, 'OFF');
  assert.equal(toPlateState({ isolation: 'sandbox' }).sandbox, 'FULL');
  assert.equal(toPlateState({}).sandbox, 'OFF');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test src/hud/state.test.js`
Expected: FAIL — `context` is currently `'0%'`, `table` is absent (so the renderer's fake demo table shows), and `agentName` defaults to `'CLAUDE CODE'`.

- [ ] **Step 3: Delete the inventing modules**

```bash
git rm src/core/agentDetector.ts src/core/tokenMeter.ts src/core/agentDetector.test.ts
```

- [ ] **Step 4: Make `toPlateState` honest**

In `src/hud/state.ts`, replace `pct` and the body of `toPlateState`:

```ts
/** An unknown percentage is '--'. Never round `undefined` down to 0%. */
function pct(v: number | undefined): string {
  if (v === undefined || Number.isNaN(v)) return '--';
  const n = Math.round(Math.min(1, Math.max(0, v)) * 100);
  return `${Math.min(99, n)}%`;
}

export function toPlateState(app: AppTelemetry) {
  const t = app.tokens;

  const state: Record<string, unknown> = {
    context: pct(app.contextUsed),
    usage: pct(app.rateUsed),
    sandbox: app.pendingApproval ? 'WAIT' : TIER[app.isolation ?? 'host'],
    agent: app.agent ?? 'shell',
    agentName: [app.agentName, app.model].filter(Boolean).join(' · ').toUpperCase(),
    path: (app.cwd ?? '~').toUpperCase(),
    branch: truncateLeft((app.branch ?? '').toUpperCase(), PLATE_480.valueChars),
    credentials: app.credentials ?? [false, false, false],
    // An absent table must be explicit: drawPlate merges DEFAULT_STATE under
    // this object, so omitting the key would render the demo table instead.
    table: [] as string[][],
  };

  if (t) {
    state.table = [
      ['IN', k(t.in), k(t.limit[0])],
      ['OUT', k(t.out), k(t.limit[1])],
      ['CAC', k(t.cache), k(t.limit[2])],
      ['TOT', k(t.in + t.out + t.cache), k(t.limit[3])],
    ];
  } else if (app.shellMetrics) {
    const sm = app.shellMetrics;
    const linesStr = sm.lines > 999 ? `${(sm.lines / 1000).toFixed(1)}k` : String(sm.lines);
    state.table = [
      ['LIN', linesStr, '10K'],
      ['CMD', String(sm.commands), '100'],
      ['ERR', String(sm.errors), '10'],
    ];
  }

  return state;
}
```

Note the `SES` row is gone — it was hardcoded `active: 1`. Also delete the `isAgent` / `agentKey` / `defaultAgentName` lines entirely: they existed only to invent `'CLAUDE CODE'` for any non-shell key.

- [ ] **Step 5: Consume the daemon's truth in App.tsx**

Replace the initial telemetry state (lines 48-59) with values that claim nothing:

```ts
  const [telemetry, setTelemetry] = useState<AppTelemetry>({
    isolation: 'host',
    agent: 'shell',
    cwd: activeNode?.cwd,
    branch: activeNode?.gitBranch,
    credentials: [false, false, false],
    pendingApproval: false,
  });
```

Replace the `onTelemetry` handler (lines 297-305) so the daemon is authoritative:

```ts
    const unbindTele = ptyClient.onTelemetry((data) => {
      setTelemetry((prev) => ({
        ...prev,
        cwd: data.current_dir,
        branch: data.git_branch ?? '',
        isolation: data.isolation,
        agent: data.agent_key ?? 'shell',
        agentName: data.agent_name ?? undefined,
        credentials: data.credentials ?? [false, false, false],
      }));
    });
```

Delete the entire "Recalculate dynamic tokens & agent telemetry" effect (lines 313-334) — it exists only to call `calculateSessionTelemetry`, and it contains the two dead `||` merges that were discarding the real values. Delete the `calculateSessionTelemetry` import on line 24.

Add a poll so the plate follows the foreground process, replacing that effect:

```ts
  // The foreground process changes without any PTY event, so ask the daemon.
  useEffect(() => {
    const tick = () => ptyClient.requestTelemetry(activeNode?.cwd);
    tick();
    const id = window.setInterval(tick, 2000);
    return () => window.clearInterval(id);
  }, [activeNode?.cwd, activeNode?.id]);
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
node --test src/hud/state.test.js
```
Expected: PASS — 12 tests (8 baseline + 4 new).

- [ ] **Step 7: Verify no invention remains**

Must print nothing:

```bash
grep -rn "OPUS-4-6\|O3-MINI\|DEEPSEEK-R1\|GROK-3\|baseSystemChars\|calculateSessionTelemetry\|tokenMeter\|TokenMeter" src/
grep -rn "true, true, false" src/
```

- [ ] **Step 8: Confirm live, then commit**

Start `npm run server` and `npm run dev`, open the app, and check the plate reads `CONTEXT --`, `USAGE --`, `SANDBOX OFF`, no token table, and an agent well that stays neutral. Then run `claude` (or any agent binary) in a session and confirm the well and `AGENT` row light up within ~2s, and go back to neutral on exit.

```bash
npm run build && npm test
git add -A
git commit -m "feat: show only observed telemetry; render the unknowable as --

Deletes agentDetector and tokenMeter, which invented model strings and derived
a token count from a fabricated 14,000-char constant, and removes the dead
'prev.isolation || next.isolation' merges that were discarding the daemon's
real credential and isolation probes. Unknown percentages now render '--' and
an absent counter table is explicit, so the renderer's demo data can no longer
leak through. Refs F2, F11. Closes #2."
```

---

### Task 7: Take the Doom marine out of the agent well, and stop demo data leaking

Closes F10 and the rest of F11. `MARKS.marine` is a pixel Doomguy aliased to `doom`/`terminal`/`shell`/`bash`/`none`, so it is what a plain shell renders. Separately, `DEFAULT_STATE` holds demo values that `drawPlate` merges under every real state — but it is also what `tools/hud/cli.js` renders the committed reference PNG from, so it cannot simply be blanked.

**Files:**
- Modify: `src/hud/plate.js` (`MARKS` 248-297, `DEFAULT_STATE` 302-312, `drawPlate` 343)
- Modify: `tools/hud/cli.js` (`loadState`)
- Modify: `src/hud/state.test.js`

**Interfaces:**
- Produces: `DEMO_STATE` (exported, for the reference renderer) and a neutral `DEFAULT_STATE` (merged under live state). `MARKS.shell` replaces `MARKS.marine`.

- [ ] **Step 1: Write the failing tests**

Append to `src/hud/state.test.js`:

```js
import { MARKS, DEFAULT_STATE, DEMO_STATE } from './plate.js';

test('no game character survives in the agent well', () => {
  assert.equal(MARKS.marine, undefined);
  assert.equal(MARKS.doom, undefined);
  assert.ok(typeof MARKS.shell === 'function', 'a plain shell still needs a mark');
});

test('the renderer default invents nothing', () => {
  assert.equal(DEFAULT_STATE.context, '--');
  assert.equal(DEFAULT_STATE.usage, '--');
  assert.equal(DEFAULT_STATE.agentName, '');
  assert.deepEqual(DEFAULT_STATE.table, []);
});

test('demo values still exist for the reference renderer', () => {
  assert.ok(DEMO_STATE.agentName.length > 0);
  assert.equal(DEMO_STATE.table.length, 4);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test src/hud/state.test.js`
Expected: FAIL — `MARKS.marine` is a function and `DEMO_STATE` is not exported.

- [ ] **Step 3: Replace the marine with a neutral shell mark**

In `src/hud/plate.js`, delete the whole `marine(s, cx, cy) { ... }` member (lines 248-288) and its aliases (lines 290-294). Add a mark that says "a shell, no agent" without borrowing a character — a recessed prompt caret:

```js
  shell(s, cx, cy, col) {
    // A prompt caret. Deliberately not a face: the well holds the active
    // agent, and a plain shell has none.
    px(s, cx - 6, cy - 4, 2, 2, col);
    px(s, cx - 4, cy - 2, 2, 2, col);
    px(s, cx - 2, cy,     2, 2, col);
    px(s, cx - 4, cy + 2, 2, 2, col);
    px(s, cx - 6, cy + 4, 2, 2, col);
    px(s, cx + 1, cy + 4, 6, 2, col);
  },
```

Keep the remaining agent aliases:

```js
MARKS.aider = MARKS.claude;
MARKS.agy = MARKS.gemini;
MARKS.antigravity = MARKS.gemini;
```

In `drawPlate`, the `agentLabel` line currently tests for six legacy keys. Replace it:

```js
  const agentLabel = st.agent === 'shell' ? 'SHELL' : 'AGENT';
```

and make the mark lookup fall back to the shell rather than to Claude:

```js
  (MARKS[st.agent] || MARKS.shell)(s, spec.markX + 12, 16, C.mark);
```

- [ ] **Step 4: Split demo data from the merge default**

In `src/hud/plate.js`, rename the existing constant to `DEMO_STATE` and add a neutral `DEFAULT_STATE` beside it:

```js
/** Presentation values for the reference renderer and the design docs only. */
const DEMO_STATE = {
  context: '61%',
  usage: '34%',
  sandbox: 'FULL',
  agent: 'claude',
  agentName: 'CLAUDE CODE',
  path: '~/PROJECTS/DOOM TERM',
  branch: 'FEATURE/WEBGL-COMPOSITOR',
  credentials: [true, true, false],
  table: [['IN', '14', '128'], ['OUT', '3', '32'], ['CAC', '88', '200'], ['TOT', '105', '360']],
};

/** What drawPlate merges under live state. It must claim nothing. */
const DEFAULT_STATE = {
  context: '--',
  usage: '--',
  sandbox: 'OFF',
  agent: 'shell',
  agentName: '',
  path: '~',
  branch: '',
  credentials: [false, false, false],
  table: [],
};
```

Export both from the bottom of the file: `DEFAULT_STATE, DEMO_STATE,`.

Note `DEMO_STATE.agentName` drops the `· OPUS 5` suffix — no agent reports a model, so even the demo should not imply one.

- [ ] **Step 5: Point the reference renderer at the demo state**

In `tools/hud/cli.js`, import `DEMO_STATE` and default to it:

```js
import { renderPlate, PLATE_480, DEMO_STATE } from '../../src/hud/plate.js';

function loadState() {
  const f = arg('--state', null);
  if (!f) return DEMO_STATE;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
```

- [ ] **Step 6: Run the tests and confirm the reference image is unchanged**

```bash
node --test src/hud/state.test.js
npm run hud:ref
git diff --stat docs/design/reference/
```
Expected: tests PASS. The reference PNGs should differ only where the demo agent name lost its `· OPUS 5` suffix — if any *geometry* changed, the split was done wrong.

- [ ] **Step 7: Commit**

```bash
npm run build && npm test
git add -A
git commit -m "feat: neutral agent mark for a plain shell; split demo data from defaults

MARKS.marine drew a Doomguy face for every non-agent session — the one thing
the design system explicitly removed, since that well holds the active agent.
DEFAULT_STATE also merged demo values (61% context, a populated token table)
under every live render, so any missing field rendered as convincing fiction;
the demo values now live in DEMO_STATE for the reference renderer only.
Refs F10, F11."
```

---

### Task 8: Bring the top edge to the design system

Closes F5. The spec defines the entire top edge as one tab strip: tabs are plate segments, **the active one is pressed in (bevel inverted)**, there are **no close buttons**, and path + branch are right-aligned in plate ink. There is no header row in the design.

**Files:**
- Modify: `src/components/TabBar.tsx` (whole component)
- Modify: `src/App.tsx` (delete header row 827-878, keep `<TabBar>`)
- Modify: `src/components/TabBar.test.tsx`

**Interfaces:**
- Produces: `TabBarProps` gains `cwd: string` and `branch: string` for the right-aligned meta, and loses `onCloseSession` from the tab row (close moves to middle-click, still calling the same handler).

- [ ] **Step 1: Write the failing tests**

Replace the body of `src/components/TabBar.test.tsx`'s describe block with tests that encode the spec:

```tsx
it('presses the active tab in rather than raising it', () => {
  render(<TabBar {...baseProps} activeSessionId="s1" />);
  const active = screen.getByRole('tab', { name: /Terminal 1/ });
  expect(active.getAttribute('aria-selected')).toBe('true');
  expect(active.className).toContain('bev-dn');
  expect(active.className).not.toContain('bev-up');
});

it('puts no close button on any tab', () => {
  render(<TabBar {...baseProps} />);
  expect(screen.queryByRole('button', { name: /close/i })).toBeNull();
  expect(screen.queryByText('×')).toBeNull();
});

it('closes on middle-click instead', () => {
  const onClose = vi.fn();
  render(<TabBar {...baseProps} onCloseSession={onClose} />);
  fireEvent.auxClick(screen.getByRole('tab', { name: /Terminal 1/ }), { button: 1 });
  expect(onClose).toHaveBeenCalledWith('s1');
});

it('keeps every tab reachable from the keyboard', () => {
  render(<TabBar {...baseProps} />);
  for (const tab of screen.getAllByRole('tab')) {
    expect(tab.tagName).toBe('BUTTON');
  }
});

it('right-aligns the path and branch on the strip', () => {
  render(<TabBar {...baseProps} cwd="~/Projects/Doom Term" branch="main" />);
  expect(screen.getByText('~/PROJECTS/DOOM TERM')).toBeDefined();
  expect(screen.getByText('MAIN')).toBeDefined();
});
```

Define `baseProps` at the top of the file with two sessions (`s1` "Terminal 1", `s2` "Terminal 2"), `activeSessionId: 's1'`, and `vi.fn()` for each handler.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/components/TabBar.test.tsx`
Expected: FAIL — tabs are `<div>`s with no `role`, the active one carries `bev-up`, and every tab has a `×`.

- [ ] **Step 3: Rewrite TabBar to spec**

Replace `src/components/TabBar.tsx` in full:

```tsx
import React from 'react';
import { SessionTab } from '../types/terminal';
import { audioEngine } from '../core/audioEngine';

interface TabBarProps {
  sessions: SessionTab[];
  activeSessionId: string;
  cwd: string;
  branch: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onCloseSession: (id: string) => void;
  onRenameSession?: (id: string, newTitle: string) => void;
}

/** Session state, one colour each. Never identity — only state. */
function dotColour(session: SessionTab, isActive: boolean): string {
  if (session.agentState === 'running') return 'var(--st-live)';
  if (session.lastExitCode === 0) return 'var(--st-pass)';
  if (typeof session.lastExitCode === 'number') return 'var(--st-fail)';
  return isActive ? 'var(--st-live)' : 'var(--st-idle)';
}

export const TabBar: React.FC<TabBarProps> = ({
  sessions,
  activeSessionId,
  cwd,
  branch,
  onSelectSession,
  onNewSession,
  onCloseSession,
  onRenameSession,
}) => {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');

  const finishRename = (id: string) => {
    const trimmed = draft.trim();
    if (trimmed && onRenameSession) onRenameSession(id, trimmed);
    setEditingId(null);
  };

  return (
    <div className="plate bev-up flex items-center gap-0 px-1 select-none" role="tablist">
      {sessions.map((session) => {
        const isActive = session.id === activeSessionId;
        const isEditing = editingId === session.id;

        return (
          <button
            key={session.id}
            role="tab"
            aria-selected={isActive}
            // The bevel inverts on the active tab: a physical control tells you
            // which one is down. No highlight, no underline.
            className={`${isActive ? 'bev-dn' : 'plate bev-up'} flex items-center gap-2 h-6 px-3 mr-1
              text-[11px] font-bold tracking-wide font-mono`}
            style={{
              background: isActive ? '#33302b' : undefined,
              color: isActive ? 'var(--st-live)' : '#2a2620',
            }}
            onClick={() => {
              if (session.id !== activeSessionId) {
                audioEngine.playSound('click', 3);
                onSelectSession(session.id);
              }
            }}
            onAuxClick={(e) => {
              // Close is middle-click and Ctrl+W, like every terminal already
              // does. A tiny x on every tab is 2024 chrome.
              if (e.button === 1) {
                e.preventDefault();
                audioEngine.playSound('oof', 2);
                onCloseSession(session.id);
              }
            }}
            onDoubleClick={() => {
              setEditingId(session.id);
              setDraft(session.title);
            }}
          >
            <span
              className="w-1.5 h-1.5 shrink-0"
              style={{ background: dotColour(session, isActive), boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.5)' }}
            />
            {isEditing ? (
              <input
                type="text"
                aria-label="Rename session"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => finishRename(session.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') finishRename(session.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-24 px-1 bg-black text-[11px] font-mono"
                style={{ color: 'var(--st-live)', boxShadow: 'var(--bevel-dn)' }}
              />
            ) : (
              <span className="truncate max-w-[14ch]">{session.title}</span>
            )}
          </button>
        );
      })}

      <button
        onClick={() => {
          audioEngine.playSound('door', 2);
          onNewSession();
        }}
        title="New session (Ctrl+Shift+T)"
        className="plate bev-up h-6 px-2 text-[13px] font-bold leading-none"
        style={{ color: '#3a352d' }}
      >
        +
      </button>

      <span className="ml-auto flex gap-4 pr-2 text-[10px] tracking-widest" style={{ color: '#2e2a24' }}>
        <span>{cwd.toUpperCase()}</span>
        <b style={{ color: '#14120f' }}>{branch.toUpperCase()}</b>
      </span>
    </div>
  );
};
```

Add the two fields this reads to `SessionTab` in `src/types/terminal.ts` if absent:

```ts
  agentState?: 'idle' | 'running' | 'waiting_input' | 'verifying' | 'errored';
  lastExitCode?: number | null;
```

- [ ] **Step 4: Delete the header row from App.tsx**

Replace the whole top-header block (lines 827-878) with just the strip:

```tsx
      <TabBar
        sessions={groupNodes.map((n) => ({
          id: n.id,
          title: n.title,
          cwd: n.cwd,
          gitBranch: n.gitBranch,
          activeBlockId: n.activeBlockId,
          isTuiActive: n.isTuiActive,
          agentState: n.agentState,
          lastExitCode: n.blocks[n.blocks.length - 1]?.exitCode ?? null,
          blocks: n.blocks,
          tuiLines: n.tuiLines,
          commandHistory: n.commandHistory,
          createdAt: n.createdAt,
        }))}
        activeSessionId={activeGroup.activeNodeId}
        cwd={telemetry.cwd ?? '~'}
        branch={telemetry.branch ?? ''}
        onSelectSession={handleSelectNode}
        onCloseSession={handleCloseNode}
        onNewSession={() => handleCreateNode(activeGroup.id, 'terminal')}
        onRenameSession={handleRenameNode}
      />
```

The hamburger, wordmark, `⚖ VERIFY` and `CTRL+P` buttons are all deleted. Their functions remain on `Ctrl+B`, `Ctrl+P`/`Ctrl+K` — already bound in the keyboard effect. Add `Ctrl+W` to that effect so close has a keybinding:

```ts
      // Ctrl+W: close the active session
      if (e.ctrlKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        handleCloseNode(activeGroup.activeNodeId);
        return;
      }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/TabBar.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Confirm no radius or blur crept in**

```bash
npm test  # src/styles/material.test.js enforces both
grep -rn "rounded" src/components/TabBar.tsx
```
The grep must print nothing.

- [ ] **Step 7: Commit**

```bash
npm run build && npm test
git add -A
git commit -m "feat: one tab strip, to spec — active tab pressed in, no close buttons

The design system defines the whole top edge as a single strip with the active
tab bevel-inverted, no per-tab x, and path/branch right-aligned in plate ink.
Deletes the bespoke header row (hamburger, wordmark, VERIFY, CTRL+P); those
actions keep their Ctrl+B / Ctrl+P bindings and close gains Ctrl+W and
middle-click. Tabs are buttons again, so they are keyboard reachable and keep
the focus-visible ring. Refs F5."
```

---

### Task 9: Scope terminal auto-numbering to auto-generated names

Closes F8 and GitHub #3. Renaming a tab `deploy-2026` makes the next new tab `Terminal 2027`, because the next index is regexed off every title.

**Files:**
- Modify: `src/App.tsx:363-373` (`handleCreateNode`)
- Create: `src/core/sessionNaming.ts`, `src/core/sessionNaming.test.ts`

**Interfaces:**
- Produces: `nextSessionTitle(kind: SessionKind, existingTitles: string[]): string`

- [ ] **Step 1: Write the failing test**

Create `src/core/sessionNaming.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextSessionTitle } from './sessionNaming';

describe('nextSessionTitle', () => {
  it('numbers sequentially from the auto-generated names', () => {
    expect(nextSessionTitle('terminal', [])).toBe('Terminal 1');
    expect(nextSessionTitle('terminal', ['Terminal 1'])).toBe('Terminal 2');
    expect(nextSessionTitle('terminal', ['Terminal 1', 'Terminal 2'])).toBe('Terminal 3');
  });

  it('ignores digits in renamed tabs', () => {
    // The bug: a tab renamed 'deploy-2026' produced 'Terminal 2027'.
    expect(nextSessionTitle('terminal', ['deploy-2026'])).toBe('Terminal 1');
    expect(nextSessionTitle('terminal', ['Terminal 1', 'deploy-2026'])).toBe('Terminal 2');
    expect(nextSessionTitle('terminal', ['v2 rollout', 'Terminal 3'])).toBe('Terminal 4');
  });

  it('numbers each kind independently', () => {
    expect(nextSessionTitle('agent', ['Terminal 1', 'Terminal 2'])).toBe('Agent 1');
    expect(nextSessionTitle('scratchpad', ['Agent 1'])).toBe('Notes 1');
  });

  it('fills nothing in — a gap stays a gap', () => {
    expect(nextSessionTitle('terminal', ['Terminal 1', 'Terminal 5'])).toBe('Terminal 6');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/core/sessionNaming.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

Create `src/core/sessionNaming.ts`:

```ts
import { SessionKind } from '../types/sessionTree';

const LABEL: Record<SessionKind, string> = {
  terminal: 'Terminal',
  agent: 'Agent',
  tui: 'Terminal',
  scratchpad: 'Notes',
};

/**
 * The next auto-generated title for `kind`.
 *
 * Only titles this function could itself have produced are counted. Scanning
 * every title for a trailing number meant renaming a tab `deploy-2026` made
 * the next one `Terminal 2027`.
 */
export function nextSessionTitle(kind: SessionKind, existingTitles: string[]): string {
  const label = LABEL[kind];
  const auto = new RegExp(`^${label} (\\d+)$`);

  const highest = existingTitles.reduce((max, title) => {
    const match = title.match(auto);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);

  return `${label} ${highest + 1}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/core/sessionNaming.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Use it in App.tsx**

In `handleCreateNode`, delete the `existingNumbers` / `maxIdx` / `nextIdx` / `kindLabel` block (lines 365-373) and use:

```ts
    const title = nextSessionTitle(
      kind,
      Object.values(workspace.nodes).map((n) => n.title),
    );
```

then set `title,` in the new node literal. Import `nextSessionTitle` from `./core/sessionNaming`.

- [ ] **Step 6: Confirm live, then commit**

Rename a tab to `deploy-2026`, press **+ NEW**, and confirm the new tab is `Terminal 2`, not `Terminal 2027`.

```bash
npm run build && npm test
git add -A
git commit -m "fix: scope session auto-numbering to auto-generated titles

The next index was regexed off every existing title, so renaming a tab
'deploy-2026' made the next one 'Terminal 2027'. Only titles matching
'^<Label> <n>\$' are counted now. Closes #3."
```

---

### Task 10: Make the workspace picker's typed path real, and match replies to requests

Closes F6 and GitHub #4. The input promises "type full path" but only substring-filters the current listing, so Enter opens wherever you last browsed. Separately, `browseDirectory` matches replies by FIFO order with no request id, and a `send()` on a non-open socket is dropped while its resolver stays queued, permanently offsetting every later browse.

**Files:**
- Modify: `src/core/ptyClient.ts` (`directoryListingResolvers`, `browseDirectory`, `handleServerMessage`)
- Modify: `backend/src/main.rs` (`BrowseDirectory`, `DirectoryListing`)
- Modify: `src-tauri/src/commands.rs` (`browse_directory`)
- Modify: `src/components/WorkspaceModal.tsx`
- Create: `src/core/ptyClient.test.ts`

**Interfaces:**
- Produces: wire messages `BrowseDirectory { request_id: String, path: Option<String> }` and `DirectoryListing { request_id: String, ... }`; `browseDirectory(path?): Promise<DirectoryListing>` that rejects on timeout rather than hanging.

- [ ] **Step 1: Write the failing tests**

Create `src/core/ptyClient.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { looksLikeAbsolutePath } from './ptyClient';

describe('looksLikeAbsolutePath', () => {
  it('recognises the paths a user actually types', () => {
    expect(looksLikeAbsolutePath('/var/home/cleadmon/Projects/Doom Term')).toBe(true);
    expect(looksLikeAbsolutePath('~/Projects')).toBe(true);
    expect(looksLikeAbsolutePath('~')).toBe(true);
  });

  it('treats a bare word as a filter, not a path', () => {
    expect(looksLikeAbsolutePath('doom')).toBe(false);
    expect(looksLikeAbsolutePath('')).toBe(false);
    expect(looksLikeAbsolutePath('Doom Term')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/core/ptyClient.test.ts`
Expected: FAIL — `looksLikeAbsolutePath` is not exported.

- [ ] **Step 3: Match directory replies by request id**

In `src/core/ptyClient.ts`, replace the resolver array:

```ts
  private directoryListingResolvers = new Map<
    string,
    { resolve: (l: DirectoryListing) => void; reject: (e: Error) => void; timer: number }
  >();
  private nextRequestId = 0;
```

Replace `browseDirectory`'s WebSocket branch:

```ts
    return new Promise<DirectoryListing>((resolve, reject) => {
      const requestId = `dir-${this.nextRequestId++}`;

      // A send() on a closed socket is dropped. Without a timeout its resolver
      // would sit in the map forever; with FIFO matching it also used to
      // offset every later reply by one.
      const timer = window.setTimeout(() => {
        this.directoryListingResolvers.delete(requestId);
        reject(new Error(`browseDirectory timed out for ${path ?? '~'}`));
      }, 5000);

      this.directoryListingResolvers.set(requestId, { resolve, reject, timer });
      this.send({ action: 'BrowseDirectory', payload: { request_id: requestId, path: path || null } });
    });
```

In `handleServerMessage`, resolve by id:

```ts
    } else if (msg.event === 'DirectoryListing') {
      const listing = msg.data as DirectoryListing & { request_id?: string };
      const pending = listing.request_id
        ? this.directoryListingResolvers.get(listing.request_id)
        : undefined;
      if (pending && listing.request_id) {
        window.clearTimeout(pending.timer);
        this.directoryListingResolvers.delete(listing.request_id);
        pending.resolve(listing);
      }
    }
```

Add the exported helper at the end of the module:

```ts
/** A typed workspace path, as opposed to a substring filter. */
export function looksLikeAbsolutePath(value: string): boolean {
  const v = value.trim();
  return v.startsWith('/') || v === '~' || v.startsWith('~/');
}
```

Add `request_id: string;` to the `DirectoryListing` interface.

- [ ] **Step 4: Echo the request id from both backends**

In `backend/src/main.rs`, add `request_id: String` to the `BrowseDirectory` client variant and to the `DirectoryListing` server variant, and pass it straight through in the handler's `tx.send`.

In `src-tauri/src/commands.rs`, `browse_directory` is a direct `invoke` and needs no id, but its return type must gain the field so the shapes match. Set it to `String::new()` there and have `ptyClient.browseDirectory`'s Tauri branch fill it in locally.

- [ ] **Step 5: Make the typed path actually open**

In `src/components/WorkspaceModal.tsx`:

Fix the effect so it does not re-fire on the state it sets (this is what issued overlapping requests):

```ts
  useEffect(() => {
    if (!isOpen) return;
    setRecentWorkspaces(SessionStore.loadRecentWorkspaces());
    loadDirectory('~');
    setTimeout(() => inputRef.current?.focus(), 50);
    // Deliberately keyed on isOpen only: loadDirectory sets currentPath, so
    // depending on currentPath here re-fires this on every navigation.
  }, [isOpen, loadDirectory]);
```

Make the first action honour what was typed:

```ts
  const typedPath = looksLikeAbsolutePath(inputQuery) ? inputQuery.trim() : null;

  items.push({
    id: 'open-target',
    kind: 'ACTION',
    label: typedPath ? `OPEN: ${typedPath}` : `OPEN: ${currentPath}`,
    detail: typedPath ? 'TYPED PATH' : 'SELECT CURRENT',
    action: () => {
      audioEngine.playSound('pickup', 2);
      onSelectWorkspace(typedPath ?? currentPath);
      onClose();
    },
  });

  // A typed path can also be browsed into before committing to it.
  if (typedPath) {
    items.push({
      id: 'browse-target',
      kind: 'ACTION',
      label: `BROWSE: ${typedPath}`,
      detail: 'LIST FOLDER',
      action: () => {
        audioEngine.playSound('click', 3);
        loadDirectory(typedPath);
      },
    });
  }
```

Suppress the folder filter while a path is being typed, so the list does not read as "no matches":

```ts
    const filtered = listing.entries.filter(
      (e) => e.is_dir && (typedPath || !inputQuery || e.name.toLowerCase().includes(inputQuery.toLowerCase())),
    );
```

Surface a failed browse instead of swallowing it — replace the `catch` in `loadDirectory`:

```ts
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
```

with a `const [loadError, setLoadError] = useState<string | null>(null);` and render it above the list when set, in `var(--st-fail)`.

Finally delete the dead `Open Native File Dialog…` action (lines 72-99): it calls `window.__TAURI__.dialog`, and `@tauri-apps/plugin-dialog` is not a dependency, so it silently no-ops.

- [ ] **Step 6: Run the tests, then confirm live**

```bash
npx vitest run src/core/ptyClient.test.ts   # expected PASS, 2 tests
npm run build && npm test
```

With both servers running, open the picker, type `/var/home/cleadmon/Projects/Doom Term`, press Enter, and confirm *that* folder opens. Then type → clear → navigate several times and confirm the listing never goes blank.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix: typed workspace paths open, and directory replies match requests

The picker advertised 'type full path' but only substring-filtered the current
listing, so Enter opened wherever you had last browsed. Replies were also
matched to requests by FIFO order, and a send() on a closed socket left its
resolver queued forever, permanently offsetting every later browse. Requests
now carry an id and time out. Also deletes the native-dialog action, which
called a Tauri plugin that is not a dependency. Closes #4."
```

---

### Task 11: Let workspaces coexist

Closes F7 and GitHub #6. `handleOpenWorkspaceFolder` calls `setWorkspace(newWs)` — whole-state replacement — so opening a second folder destroys the first, scrollback included.

The sidebar currently duplicates the tab strip by listing sessions. It becomes the workspace switcher instead: the strip owns sessions, the sidebar owns folders. Layout controls move to the palette, which already has all three entries.

**Files:**
- Modify: `src/types/sessionTree.ts` (add `WorkspaceSet`)
- Modify: `src/core/sessionStore.ts` (V2 storage + migration)
- Modify: `src/components/SessionTree.tsx` (rewrite as workspace switcher)
- Modify: `src/App.tsx` (workspace-set state, open/close/switch handlers)
- Create: `src/core/workspaceSet.ts`, `src/core/workspaceSet.test.ts`

**Interfaces:**
- Produces:
  - `interface WorkspaceSet { workspaces: ProjectWorkspace[]; activeWorkspaceId: string }`
  - `openWorkspace(set, ws): WorkspaceSet` — adds, or focuses an existing folder
  - `closeWorkspace(set, id): WorkspaceSet` — never returns an empty set
  - `activeWorkspace(set): ProjectWorkspace`

- [ ] **Step 1: Write the failing tests**

Create `src/core/workspaceSet.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openWorkspace, closeWorkspace, activeWorkspace } from './workspaceSet';
import { createWorkspaceForFolder } from './sessionStore';
import { WorkspaceSet } from '../types/sessionTree';

const setOf = (...paths: string[]): WorkspaceSet => {
  const workspaces = paths.map((p) => createWorkspaceForFolder(p));
  return { workspaces, activeWorkspaceId: workspaces[0].id };
};

describe('workspace set', () => {
  it('keeps the previous workspace when another is opened', () => {
    const before = setOf('/a');
    const after = openWorkspace(before, createWorkspaceForFolder('/b'));
    expect(after.workspaces).toHaveLength(2);
    expect(after.workspaces.map((w) => w.rootPath)).toEqual(['/a', '/b']);
  });

  it('focuses the newly opened workspace', () => {
    const after = openWorkspace(setOf('/a'), createWorkspaceForFolder('/b'));
    expect(activeWorkspace(after).rootPath).toBe('/b');
  });

  it('re-opening an already-open folder focuses it instead of duplicating', () => {
    const before = openWorkspace(setOf('/a'), createWorkspaceForFolder('/b'));
    const after = openWorkspace(before, createWorkspaceForFolder('/a'));
    expect(after.workspaces).toHaveLength(2);
    expect(activeWorkspace(after).rootPath).toBe('/a');
  });

  it('preserves the sessions of a workspace you switch away from', () => {
    const before = setOf('/a');
    const nodeId = Object.keys(before.workspaces[0].nodes)[0];
    const after = openWorkspace(before, createWorkspaceForFolder('/b'));
    expect(after.workspaces[0].nodes[nodeId]).toBeDefined();
  });

  it('never leaves the set empty', () => {
    const one = setOf('/a');
    expect(closeWorkspace(one, one.workspaces[0].id).workspaces).toHaveLength(1);
  });

  it('moves focus off a workspace that is closed', () => {
    const two = openWorkspace(setOf('/a'), createWorkspaceForFolder('/b'));
    const after = closeWorkspace(two, two.activeWorkspaceId);
    expect(after.workspaces).toHaveLength(1);
    expect(activeWorkspace(after).rootPath).toBe('/a');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/core/workspaceSet.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the type**

In `src/types/sessionTree.ts`:

```ts
/** Every project folder currently open, and which one has focus. */
export interface WorkspaceSet {
  workspaces: ProjectWorkspace[];
  activeWorkspaceId: string;
}
```

- [ ] **Step 4: Implement the operations**

Create `src/core/workspaceSet.ts`:

```ts
import { ProjectWorkspace, WorkspaceSet } from '../types/sessionTree';

export function activeWorkspace(set: WorkspaceSet): ProjectWorkspace {
  return set.workspaces.find((w) => w.id === set.activeWorkspaceId) ?? set.workspaces[0];
}

/**
 * Add a workspace, or focus the one already holding that folder.
 *
 * Opening used to replace the whole state, which discarded the previous
 * folder's sessions and scrollback outright.
 */
export function openWorkspace(set: WorkspaceSet, ws: ProjectWorkspace): WorkspaceSet {
  const existing = set.workspaces.find((w) => w.rootPath === ws.rootPath);
  if (existing) {
    return { ...set, activeWorkspaceId: existing.id };
  }
  return {
    workspaces: [...set.workspaces, ws],
    activeWorkspaceId: ws.id,
  };
}

/** Close a workspace. The last one is never closed — there must be somewhere to type. */
export function closeWorkspace(set: WorkspaceSet, id: string): WorkspaceSet {
  if (set.workspaces.length <= 1) return set;
  const remaining = set.workspaces.filter((w) => w.id !== id);
  return {
    workspaces: remaining,
    activeWorkspaceId: set.activeWorkspaceId === id ? remaining[remaining.length - 1].id : set.activeWorkspaceId,
  };
}

export function replaceWorkspace(set: WorkspaceSet, ws: ProjectWorkspace): WorkspaceSet {
  return { ...set, workspaces: set.workspaces.map((w) => (w.id === ws.id ? ws : w)) };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/core/workspaceSet.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Persist the set, migrating the old single workspace**

In `src/core/sessionStore.ts`, add alongside the existing key:

```ts
const SET_STORAGE_KEY = 'DOOM_TERM_WORKSPACES_V2';

  public static loadWorkspaceSet(): WorkspaceSet {
    if (typeof window === 'undefined' || !window.localStorage) {
      const ws = createDefaultWorkspace();
      return { workspaces: [ws], activeWorkspaceId: ws.id };
    }
    try {
      const saved = window.localStorage.getItem(SET_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as WorkspaceSet;
        if (parsed.workspaces?.length) return parsed;
      }
      // Migrate a V1 single workspace rather than dropping the user's sessions.
      const legacy = window.localStorage.getItem(STORAGE_KEY);
      if (legacy) {
        const ws = JSON.parse(legacy) as ProjectWorkspace;
        if (ws.groups && ws.nodes) return { workspaces: [ws], activeWorkspaceId: ws.id };
      }
    } catch (e) {
      console.warn('Failed to restore workspaces from storage, starting fresh:', e);
    }
    const ws = createDefaultWorkspace();
    return { workspaces: [ws], activeWorkspaceId: ws.id };
  }

  public static saveWorkspaceSet(set: WorkspaceSet) {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (this.saveTimeout) window.clearTimeout(this.saveTimeout);
    this.saveTimeout = window.setTimeout(() => {
      try {
        window.localStorage.setItem(SET_STORAGE_KEY, JSON.stringify(set));
        const active = set.workspaces.find((w) => w.id === set.activeWorkspaceId);
        if (active) this.addRecentWorkspace(active.rootPath, active.name);
      } catch (e) {
        console.warn('Error saving workspaces to storage:', e);
      }
    }, 400);
  }
```

- [ ] **Step 7: Rewrite the sidebar as a workspace switcher**

Replace `src/components/SessionTree.tsx` in full. It lists open folders only — the tab strip owns sessions, so the old per-node rows go, and the layout buttons go with them (the palette already carries all three):

```tsx
import React from 'react';
import { WorkspaceSet } from '../types/sessionTree';
import { audioEngine } from '../core/audioEngine';

interface SessionTreeProps {
  set: WorkspaceSet;
  onSelectWorkspace: (id: string) => void;
  onCloseWorkspace: (id: string) => void;
  onOpenWorkspace: () => void;
}

/**
 * The open project folders. Sessions belong to the tab strip; listing them
 * here as well was the sidebar's only other job and duplicated it exactly.
 */
export const SessionTree: React.FC<SessionTreeProps> = ({
  set,
  onSelectWorkspace,
  onCloseWorkspace,
  onOpenWorkspace,
}) => (
  <div className="w-60 shrink-0 flex flex-col" style={{ background: 'var(--ground-2)' }}>
    <div
      className="plate bev-up flex items-center justify-between px-2 py-1 text-[11px] font-bold tracking-widest"
      style={{ color: 'var(--ink-plate)' }}
    >
      <span>WORKSPACES</span>
      <button
        onClick={() => {
          audioEngine.playSound('click', 3);
          onOpenWorkspace();
        }}
        title="Open a project folder (Ctrl+O)"
        className="plate bev-up px-1.5"
        style={{ color: 'var(--ink-plate)' }}
      >
        +
      </button>
    </div>

    <div className="flex flex-col gap-px p-1 overflow-y-auto">
      {set.workspaces.map((ws) => {
        const isActive = ws.id === set.activeWorkspaceId;
        return (
          <div
            key={ws.id}
            className={`flex items-center gap-2 px-2 py-1 text-[11px] font-mono ${isActive ? 'plate bev-up' : ''}`}
            style={{ color: isActive ? 'var(--ink-plate)' : 'var(--ink-dim)' }}
          >
            <button
              onClick={() => onSelectWorkspace(ws.id)}
              className="flex-1 text-left truncate"
              style={{ color: 'inherit' }}
              title={ws.rootPath}
            >
              {ws.name}
            </button>
            {set.workspaces.length > 1 && (
              <button
                onClick={() => onCloseWorkspace(ws.id)}
                aria-label={`Close workspace ${ws.name}`}
                style={{ color: 'inherit' }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  </div>
);
```

- [ ] **Step 8: Rewire App.tsx onto the set**

Replace the workspace state:

```ts
  const [workspaceSet, setWorkspaceSet] = useState<WorkspaceSet>(() => SessionStore.loadWorkspaceSet());
  const workspace = useMemo(() => activeWorkspace(workspaceSet), [workspaceSet]);

  // Every existing setWorkspace(fn) call site keeps working through this.
  const setWorkspace = useCallback(
    (updater: (prev: ProjectWorkspace) => ProjectWorkspace) => {
      setWorkspaceSet((prevSet) => replaceWorkspace(prevSet, updater(activeWorkspace(prevSet))));
    },
    [],
  );
```

Change the save effect to `SessionStore.saveWorkspaceSet(workspaceSet)` on `[workspaceSet]`.

Replace `handleOpenWorkspaceFolder`:

```ts
  const handleOpenWorkspaceFolder = (folderPath: string, name?: string) => {
    setWorkspaceSet((prev) => {
      const next = openWorkspace(prev, createWorkspaceForFolder(folderPath, name));
      const opened = activeWorkspace(next);
      const nodeId = opened.groups[0]?.activeNodeId;
      if (nodeId) {
        ptyClient.setActiveSession(nodeId);
        ptyClient.spawnSession(nodeId, 120, 30, opened.rootPath);
        ptyClient.requestTelemetry(opened.rootPath);
      }
      return next;
    });
    audioEngine.playSound('door', 2);
  };

  const handleSelectWorkspace = (id: string) => {
    setWorkspaceSet((prev) => {
      const next = { ...prev, activeWorkspaceId: id };
      const ws = activeWorkspace(next);
      const nodeId = ws.groups.find((g) => g.id === ws.activeGroupId)?.activeNodeId;
      if (nodeId) {
        ptyClient.setActiveSession(nodeId);
        // The daemon still owns this session; replay its scrollback rather
        // than spawning a second shell in the same folder.
        ptyClient.reattachSession(nodeId);
        ptyClient.requestTelemetry(ws.rootPath);
      }
      return next;
    });
  };

  const handleCloseWorkspace = (id: string) => {
    const closing = workspaceSet.workspaces.find((w) => w.id === id);
    closing?.groups.flatMap((g) => g.nodeIds).forEach((nodeId) => ptyClient.killSession(nodeId));
    setWorkspaceSet((prev) => closeWorkspace(prev, id));
  };
```

Pass the new props to `<SessionTree set={workspaceSet} onSelectWorkspace={handleSelectWorkspace} onCloseWorkspace={handleCloseWorkspace} onOpenWorkspace={() => setIsWorkspaceModalOpen(true)} />`.

- [ ] **Step 9: Confirm live**

Open folder A, run a command in it, open folder B, then switch back to A. A's session and its scrollback must still be there. Close B and confirm A survives; confirm the last workspace cannot be closed.

- [ ] **Step 10: Commit**

```bash
npm run build && npm test
git add -A
git commit -m "feat: let project folders coexist instead of replacing each other

Opening a workspace called setWorkspace(newWs) — whole-state replacement — so
a second folder destroyed the first along with its sessions and scrollback.
State is now a WorkspaceSet, persisted under V2 with a migration from the V1
single workspace. The sidebar becomes the folder switcher; it used to duplicate
the tab strip by listing sessions, and layout controls already live in the
palette. Closes #6."
```

---

### Task 12: Settle the duplicated shell prompt

Addresses F13 and GitHub #1. `shell_integration.rs` wraps the user's `$PS1` in OSC 133 markers without shortening it, so the shell still prints `user@host:/full/path$`. But `onExecutionStart` already re-marks the block at `emu.mark()` on OSC 133;C, which *should* exclude the echoed prompt. This was never reproduced after the emulator rewrite — the issue screenshot predates it.

**Test before fixing. If the test passes on the first run, the issue is already fixed and the task is to close it with evidence, not to change code.**

**Files:**
- Create: `src/core/promptSuppression.test.ts`
- Modify (only if the test fails): `src/App.tsx` `onExecutionStart`

- [ ] **Step 1: Write the reproduction test**

Create `src/core/promptSuppression.test.ts`. It replays the exact byte stream a real bash session produces around one command:

```ts
import { describe, it, expect } from 'vitest';
import { TerminalEmulator } from './terminalEmulator';

describe('prompt suppression', () => {
  it('excludes the prompt and the echoed command from block output', () => {
    const emu = new TerminalEmulator(120, 30);

    // A real prompt cycle: OSC 133;A, the prompt itself, OSC 133;B, the
    // echoed command, OSC 133;C, then the command's actual output.
    emu.write('\x1b]133;A\x07cleadmon@SER6-MAX:/var/home/cleadmon$ \x1b]133;B\x07');
    emu.write('ls\r\n');

    // The block re-marks here, on OSC 133;C (ExecutionStart).
    emu.write('\x1b]133;C\x07');
    const mark = emu.mark();

    emu.write('Applications  Desktop  Documents\r\n');
    emu.write('\x1b]133;D;0\x07');

    const rendered = emu
      .linesSince(mark)
      .map((l) => l.spans.map((s) => s.text).join(''))
      .join('\n');

    expect(rendered).toContain('Applications');
    expect(rendered).not.toContain('cleadmon@SER6-MAX');
    expect(rendered).not.toContain('$ ');
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/core/promptSuppression.test.ts`

- [ ] **Step 3: Branch on the result**

**If it PASSES:** the emulator rewrite already fixed GitHub #1. Keep the test as a regression guard, skip to Step 5, and say so in the commit message. Do not change `App.tsx`.

**If it FAILS:** the mark is being taken at the wrong moment. In `App.tsx`'s `onExecutionStart`, the mark is read *inside* the `setWorkspace` updater, which React may run more than once and at an arbitrary later time — by then the emulator has advanced past the command output. Hoist it out so it is sampled exactly when OSC 133;C arrives:

```ts
      onExecutionStart: (sessionId) => {
        // Sample the mark here, not inside the updater: React may invoke the
        // updater late or twice, by which point output has already arrived.
        const targetId = sessionId ?? ptyClient.getSessionId();
        const currentMark = getEmulator(targetId).mark();

        setWorkspace((prev) => {
          const currentNode = prev.nodes[targetId];
          if (!currentNode?.activeBlockId) return prev;

          const updatedBlocks = currentNode.blocks.map((b) =>
            b.id === currentNode.activeBlockId
              ? { ...b, outputMark: currentMark, liveLines: getEmulator(targetId).linesSince(currentMark) }
              : b,
          );

          return {
            ...prev,
            nodes: { ...prev.nodes, [currentNode.id]: { ...currentNode, blocks: updatedBlocks } },
          };
        });
      },
```

- [ ] **Step 4: Re-run the test**

Run: `npx vitest run src/core/promptSuppression.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm live**

With both servers running, type `ls` and press Enter. The block must show only `ls` as its command and the file listing as its output — no `cleadmon@SER6-MAX:/var/...$` line anywhere in the block body.

- [ ] **Step 6: Commit**

```bash
npm run build && npm test
git add -A
git commit -m "test: lock in that the shell prompt never appears in block output

Adds a regression test replaying a real OSC 133 prompt cycle and asserting the
prompt and echoed command fall outside the block's output mark. Closes #1."
```

---

### Task 13: Break up App.tsx

After Tasks 1-12, `App.tsx` has lost the verification panel, three subsystems, the telemetry inventor and the header row, but it still owns PTY event handling, workspace state, keyboard shortcuts, palette actions and rendering. Split it so each file holds one responsibility and fits in a reviewer's head.

**Files:**
- Create: `src/hooks/usePtyEvents.ts`, `src/hooks/useWorkspaceSet.ts`, `src/hooks/useGlobalKeys.ts`, `src/core/paletteActions.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- `usePtyEvents({ setWorkspace, onExit }): void` — registers every `ptyClient` handler and unregisters on unmount.
- `useWorkspaceSet(): { workspaceSet, setWorkspaceSet, workspace, setWorkspace, activeGroup, activeNode, handlers }`
- `useGlobalKeys(bindings: Record<string, () => void>): void`
- `buildPaletteActions(ctx): CommandPaletteAction[]`

- [ ] **Step 1: Record the starting size**

```bash
wc -l src/App.tsx
```
Note the number in the commit message. It was 981 before this plan began.

- [ ] **Step 2: Extract the PTY event subscription**

Move the whole `useEffect` that calls `ptyClient.registerHandler` (`onOutput`, `onCwd`, `onExecutionStart`, `onExecutionEnd`, `onTuiMode`, `onAgentState`) into `src/hooks/usePtyEvents.ts`, taking `setWorkspace` as a parameter. Move nothing else with it.

- [ ] **Step 3: Run the gate**

```bash
npm run build && npm test
```
Expected: unchanged results — this is a pure move.

- [ ] **Step 4: Extract the workspace-set state and its handlers**

Move `workspaceSet`, `workspace`, `setWorkspace`, `activeGroup`, `activeNode`, the save effect, and the node/group/workspace handlers (`handleCreateNode`, `handleSelectNode`, `handleCloseNode`, `handleRenameNode`, `handleRenameGroup`, `handleSetGroupLayout`, `handleOpenWorkspaceFolder`, `handleSelectWorkspace`, `handleCloseWorkspace`) into `src/hooks/useWorkspaceSet.ts`.

- [ ] **Step 5: Extract the keyboard bindings and the palette actions**

Move the global-keys effect into `src/hooks/useGlobalKeys.ts`, and the `paletteActions` array into `src/core/paletteActions.ts` as `buildPaletteActions(ctx)`.

- [ ] **Step 6: Verify the split held**

```bash
npm run build && npm test
wc -l src/App.tsx src/hooks/*.ts src/core/paletteActions.ts
```
Expected: tests unchanged; `App.tsx` under 300 lines.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: split App.tsx into hooks by responsibility

App.tsx owned PTY event handling, workspace state, keyboard shortcuts, palette
actions and rendering in one 981-line file. Each now lives in its own module;
App.tsx is composition only. No behaviour change — the suite is untouched."
```

---

## Deferred, deliberately

**A settings surface (F12).** The design system specifies one (§07: segmented plate-key toggles, filled-cell meters, plain-language labels, no save button), but after this plan the honest inventory of settings is small — audio on/off, plate visibility — and two of the spec's example rows (scanlines, isolation tier) control things that no longer exist or are not ours to set. Build it when there are at least three real settings to put in it, using the palette's existing panel component rather than a new dialect.

**Deleting split panes.** `SplitPaneGrid` is not in the design system, but it is real, working code and nothing else provides simultaneous views. It is not redundant, so it stays. Its controls now live only in the palette.

## Self-review

- **Spec coverage:** F1→Task 2. F2→Tasks 5, 6. F3→Task 1. F4→Task 3. F5→Task 8. F6→Task 10. F7→Task 11. F8→Task 9. F9→Task 4. F10→Task 7. F11→Tasks 6, 7. F12→deferred, with the reason stated. F13→Task 12. GitHub #1→12, #2→5+6, #3→9, #4→10, #5 already fixed upstream by the emulator rewrite (no task; re-verify during Task 12's live check), #6→11.
- **Naming consistency:** `WorkspaceSet` / `activeWorkspace` / `openWorkspace` / `closeWorkspace` / `replaceWorkspace` are used identically in Tasks 11 and 13. `nextSessionTitle` matches between Task 9's test and its App.tsx call site. `foreground_command` / `classify_agent` / `detect_isolation` match between Task 5's implementation, its tests, and the `backend/src/main.rs` call site. The `Telemetry` wire fields (`isolation`, `agent_key`, `agent_name`) match between Task 5's Rust and Task 6's TypeScript.
- **Ordering:** deletions (1-3) precede the Rust extraction (4) so the shared crate is created once; the crate precedes the backend detector (5) so `foreground.rs` is written in its final home; the backend precedes the frontend (6) so the wire type exists before it is consumed; chrome (8) precedes multi-workspace (11) so the sidebar is rewritten once.
