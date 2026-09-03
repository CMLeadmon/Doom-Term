# Reformation Code Review Handoff

**Audience:** Claude Code or the next implementation agent

**Reviewed range:** `f194b52..a0b34fa`

**Review target:** committed `main` at `a0b34fa`
**Review status:** complete; no subagents used

## Purpose

This document records an independent correctness and functionality-honesty
review of the ten Reformation features. The pure policy helpers are generally
reasonable, but several headline features fail where React event ownership,
PTY lifecycle, daemon recovery, and live state routing meet.

Do not assume a green unit suite validates the user-visible behavior. Several
tests call leaf components or pure functions directly and bypass the actual
focus, event propagation, lifecycle, and persistence paths that are broken.

## Worktree warning

The working tree was already dirty when this review began. Preserve all
uncommitted work. In particular, the current uncommitted changes in
`src/hooks/useWorkspaceSet.ts` and `src/components/SplitPaneGrid.tsx` appear to
address finding 5 below; that correction was not present in reviewed commit
`a0b34fa` and should be verified rather than overwritten.

## Executive verdict

The Reformation series is not release-ready as committed. The most urgent
problems are:

1. ordinary session switching replays already-consumed terminal events;
2. natural process termination is fabricated as success and dead sessions are
   advertised as recoverable;
3. two keyboard-driven overlays cannot receive the keyboard while the terminal
   is focused;
4. agent questions are routed by the first matching cwd and hook state is lost
   while disconnected;
5. committed single-pane switching can select a session that remains hidden.

## Findings

### 1. P1 — Session switching duplicates terminal and semantic events

Relevant code:

- `src/core/ptyClient.ts:129-143`
- `src/App.tsx:66-72` in committed HEAD
- `backend/src/main.rs:610-619`
- `src/core/ptyClient.ts:276-281`

`PtyClient.ensureSession()` sends `Reattach` whenever the id is already in
`spawnedSessions`. `App` invokes `ensureSession()` whenever the active session
changes. The backend responds to `Reattach` by replaying the entire 500-event
ring.

That behavior no longer matches the frontend routing model: global handlers now
process every background session continuously. There is normally no missing
interval to replay when the operator merely switches panes. The replay feeds
old `Output`, `ExecutionStart`, `ExecutionEnd`, cwd, and state events through
the frontend a second time.

Observed against the real daemon after running one shell command:

| Event | Before one `Reattach` | After one `Reattach` |
|---|---:|---:|
| `Output` | 7 | 14 |
| `ExecutionStart` | 1 | 2 |
| `ExecutionEnd` | 2 | 4 |

Consequences include duplicated scrollback, repeated execution serials,
incorrect command-duration state, and duplicate notifications.

Expected cleanup:

- Do not replay merely because an already-owned session becomes active.
- Reserve replay/rebind for a new WebSocket generation or introduce a replay
  cursor/sequence so already-consumed events cannot be applied twice.
- Add an integration test that emits output in A, switches A -> B -> A, and
  proves the emulator and execution serial are unchanged by the return switch.

### 2. P1 — Natural termination becomes false success and false liveness

Relevant code:

- `crates/doom-term-pty/src/session.rs:282-327`
- `crates/doom-term-pty/src/session.rs:484-487`
- `src/core/ptyClient.ts:296-299`
- `backend/src/main.rs:546-568`
- `backend/src/main.rs:693-729`

When the PTY reader reaches EOF, it unconditionally appends and emits:

```rust
DemuxEvent::ExecutionEnd { exit_code: Some(0) }
```

No child status is consulted. Separately, the frontend turns a protocol-level
unknown/null exit status into zero with `payload?.exit_code ?? 0`.

The close callback sends `SessionClosed`, but the session remains in the
backend map. `ListSessions` enumerates every map entry without checking
`PtySession::is_alive()`, even though that method already exists. A later
`Spawn` sees the dead entry, rebinds it, replays it, and returns without
creating or attaching a live process.

Observed using `/bin/false` as the spawned shell:

```json
{
  "executionEnds": [{ "exit_code": 0 }],
  "sessionClosed": [{ "session_id": "review-dead" }],
  "listed": [{
    "id": "review-dead",
    "cwd": "",
    "command": "",
    "durable": false
  }]
}
```

This violates the repository's unknown-telemetry rule and invalidates both
completion notifications and recovery liveness.

Expected cleanup:

- Preserve `null` as unknown through the TypeScript path.
- Do not synthesize exit code zero on reader termination.
- Remove closed sessions from the backend map, or at minimum filter them from
  discovery and replace dead entries on `Spawn`.
- Route `SessionClosed` with its session id into workspace lifecycle handling.
- Add a daemon integration test using a non-zero process and a subsequent
  `ListSessions` request.

### 3. P1 — PARK/KILL and direct-pane keyboard controls are unreachable

Relevant code:

- `src/components/RawTerminalView.tsx:203-333`
- `src/components/CloseSessionPrompt.tsx:17-36`
- `src/components/PaneSelectOverlay.tsx:16-31`

The active terminal retains focus after `Ctrl+Shift+W` and
`Ctrl+Shift+Space`. `RawTerminalView` stops propagation for every subsequent
non-app key and encodes it into the PTY. Both overlays listen at `window`, so
their listeners never receive those events.

Observed in a mounted integration probe:

- Enter under `CloseSessionPrompt` was written to the PTY as `\r`; PARK was not
  invoked.
- `a` under `PaneSelectOverlay` was written to the PTY; the pane was not
  selected.
- Escape follows the same ownership problem.

This is especially unsafe for the close gate: the user sees a destructive
action prompt, presses Enter expecting the safe PARK default, and instead sends
Enter to the live process underneath it.

The current component tests hide the defect by calling
`fireEvent.keyDown(window, ...)` directly instead of starting from the focused
terminal.

Expected cleanup:

- Establish one explicit modal keyboard owner, using focus management, capture
  phase handling, or a shared terminal-suspension state.
- Prevent modal keys from reaching the PTY.
- Test with a focused `RawTerminalView` and the overlay mounted above it.

### 4. P1 — Agent question routing is not exact and is not durable

Relevant code:

- `backend/src/main.rs:108-117`
- `backend/src/main.rs:347-363`
- `src/core/ptyClient.ts:38-46`
- `src/core/ptyClient.ts:306-308`
- `src/hooks/usePtyEvents.ts:98-123`
- `src/core/sessionStore.ts:183-198`

The backend forwards `agent_session_id`, but the frontend event type drops the
field. `usePtyEvents` then calls `Object.values(prev.nodes).find(...)` and
selects the first session whose cwd matches the hook cwd.

Multiple agents in the same repository are therefore indistinguishable. The
wrong node can receive `blockedOnUser`, and the resulting native notification
can focus the wrong session. The pure notification test only proves that a
notice preserves the node id it was given; it does not prove the upstream hook
was assigned to the correct node.

Hook events are also sent over a Tokio broadcast channel with no retained
state. If no WebSocket receiver exists, `hooks.send(msg)` fails and the result
is discarded. Because `blockedOnUser` is persisted with the workspace, a
missed `Stop` can leave a previously blocked session permanently marked
`ASKS`.

Expected cleanup:

- Introduce a real mapping between vendor session identity and Doom Term PTY
  identity; cwd alone cannot be the primary key.
- Retain current hook state, or provide a state snapshot on client connect so a
  disconnect cannot lose the transition that clears a prompt.
- Add tests with two sessions sharing one cwd and with `PermissionRequest`,
  disconnect, `Stop`, reconnect.

### 5. P1 — Committed single-layout switching can activate a hidden node

Relevant committed code:

- `a0b34fa:src/hooks/useWorkspaceSet.ts:226-254`
- `a0b34fa:src/components/SplitPaneGrid.tsx:34-124`

Creating a new session in `single` layout replaces the pane-tree leaf but keeps
older sessions in `nodeIds`. Selecting one of those older, already-present ids
updates `activeNodeId` but leaves `paneTree` unchanged because the code tests
membership in `nodeIds`, not membership in the tree.

`SplitPaneGrid` treats the tree as visibility authority, so the chosen session
becomes active in state while remaining in the hidden-node wrapper. The user
continues seeing the previous pane and no active terminal receives focus.

This was reproduced with an active id that was absent from the tree. Existing
tests cover single layout without a `paneTree`, which is not representative of
production after migration.

The dirty worktree currently contains corrective logic using
`leafSessionIds()`/`paneLeaf()`. Verify it with a regression test before
considering this resolved.

### 6. P2 — Stored-only recovery snapshots silently become fresh shells

Relevant code:

- `src/core/sessionRecovery.ts:14-31`
- `src/hooks/useWorkspaceSet.ts:65-92`
- `src/App.tsx:66-72` in committed HEAD
- `src/core/ptyClient.ts:121-143`

`reconcileSessions()` correctly computes `snapshots`, but the application never
presents or enforces that state. The active stored node is immediately passed
to the daemon's attach-or-create `Spawn` path. If no live session exists, a
fresh shell is created under the stored id before reconciliation can preserve
it as a snapshot.

The stored command is not rerun, which is good, but cached transcript/UI state
followed by output from a new shell is not an honest recovered session.

Expected cleanup:

- Gate `ensureSession()` on reconciliation for restored ids.
- Render stored-only nodes explicitly as snapshots, with a deliberate action to
  start a fresh process if desired.
- Test cold startup with a stored active id and an empty daemon.

### 7. P2 — The Ctrl+K switcher resets during live updates and is not fuzzy

Relevant code:

- `src/App.tsx:184-198` in committed HEAD
- `src/core/sessionSwitcher.ts:3-42`
- `src/components/CommandPalette.tsx:30-43` in committed HEAD

`buildPaletteActions()` runs on every App render, even while the palette is
closed. Building session search text maps and joins every rendered scrollback
line for every session. Each build returns a fresh actions array;
`CommandPalette` derives a fresh filtered array and resets `selectedIndex` to
zero whenever that identity changes.

A mounted probe confirmed that replacing `actions` with an equivalent fresh
array resets keyboard selection to the first row. Live PTY output and the
two-second telemetry poll can therefore move the selection while the operator
is navigating.

The README calls this fuzzy search, but the implementation is plain
case-insensitive substring `includes`. The “attention-first” rank also checks
only `blockedOnUser`; failed and quiet sessions from the attention queue do not
receive priority.

Expected cleanup:

- Build/cache the expensive search corpus only when necessary.
- Reset selection on meaningful query/open changes, not array identity.
- Define whether search is substring or genuinely fuzzy, then align code and
  documentation.
- Rank all states the product calls “attention,” or narrow that claim.

### 8. P2 — Turn navigation is a prompt-text heuristic, not OSC 133

Relevant code:

- `README.md:76`
- `src/core/turnMarks.ts:21-41`
- `src/components/RawTerminalView.tsx:137`
- `src/components/RawTerminalView.tsx:220-239`

The README says semantic OSC-133 prompt boundaries demarcate turns. The feature
does not consume OSC-133 marks. It scans rendered lines with `^> ` for a small
set of recognized agent keys.

Marks also depend on the currently reported foreground agent. When that process
exits and the shell becomes foreground, `agentKey` becomes null and every
historical mark disappears, making previous turns unnavigable and uncopyable.

The known-limits section in `docs/REFORMATION_AGENT_REVIEW.md` accurately calls
this a conservative prompt-pattern heuristic. The README does not.

Expected cleanup:

- Either preserve OSC-133 boundary metadata in the screen/scrollback model and
  implement the advertised feature, or describe this strictly as heuristic
  agent-prompt navigation.
- Preserve established marks independently of the current foreground process.

### 9. P2 — Cross-target sidecar builds search the host artifact path

Relevant code:

- `tools/build-sidecar.mjs:25-47`

When `TAURI_ENV_TARGET_TRIPLE` is set, Cargo receives `--target <triple>` and
writes to `<target-dir>/<triple>/release/`. The script's candidates only search
`<target-dir>/release/`, `target/release/`, and `backend/target/release/`.

A mocked Cargo build placed the binary in the correct cross-target directory;
the script exited with “none of the candidate binary paths exist.” If a stale
host binary is present in one of the searched locations, the script may instead
copy that binary and relabel it with the requested target triple.

Expected cleanup:

- Include the target-triple directory whenever `--target` is used.
- Resolve the authoritative Cargo target directory rather than selecting the
  newest file among unrelated legacy locations.
- Add host and cross-target path-resolution tests.

### 10. P2 — Waiting rows can be invisible while remaining clickable

Relevant code:

- `src/hud/plate.js:486-513`
- `src/hud/canvas.ts:15-32`
- `src/hud/waiting.test.js:101-112`

The renderer checks a tail-dependent `room` calculation and silently skips a
row when fewer than three name characters fit. Hit testing only checks the
coarse `WAITING_ROWS_MIN_W` threshold and row number. It can therefore return a
session for pixels where no row was painted.

Render probes showed:

- At logical width 600, a short `2S` row is painted.
- At the same width, `ASKS`, `EXIT 1`, and `EXIT 101` rows are skipped.
- The hit test still treats those skipped row positions as actionable.

The narrow-zone test contains an unconditional assertion at
`src/hud/waiting.test.js:108`:

```js
assert.ok(expression === false || true);
```

Expected cleanup:

- Share one function that determines whether a row is actually rendered and
  use it for both painting and hit testing.
- Replace the tautological assertion with pixel assertions that distinguish a
  visible row from the count-only state.

### 11. P2 — The unified verification command can report success without HUD QA

Relevant code:

- `package.json:14-21`
- `tools/hud/cli.js:45-53`
- `Cargo.toml:8-11`
- `docs/REFORMATION_AGENT_REVIEW.md:167-194`

`npm run hud:check` passes `--if-exists`, and the CLI exits zero when
`.artifacts/plate-actual.png` is absent. In a clean isolated checkout it printed:

```text
HUD compare skipped: .artifacts/plate-actual.png not present
```

`npm run agent:verify` therefore succeeds without performing the advertised
pixel comparison. It also does not run the Vite production build, and the
workspace's `default-members` omit `src-tauri`, so its generic Cargo commands do
not compile or test the desktop shell.

The recorded historical “0 pixels differ” result may be genuine, but the
published clean-checkout verification command does not reproduce or enforce
it.

Expected cleanup:

- Generate the actual HUD image as part of the gate or fail when it is absent.
- Include `npm run build` in the unified verification command.
- Explicitly check the Tauri manifest when system dependencies are available,
  and report an environment block distinctly from success.

### 12. P2 — Unknown durability is rendered as known non-durability

Relevant code:

- `src/core/ptyClient.ts:169-176`
- `src/App.tsx:297-301` in committed HEAD
- `src/components/CloseSessionPrompt.tsx:44-47`

`getSessionMode()` documents null as unknown and says it must not be rendered as
a warning. The close prompt receives
`getSessionMode(id)?.durable ?? false`, turning unknown into non-durable and
displaying “PARK SURVIVES ONLY WHILE THIS DAEMON RUNS.” This is another direct
violation of the unknown-telemetry invariant.

Use an explicit unknown state in the prompt instead of a boolean default.

## Feature truth table

| # | Advertised feature | Review result |
|---:|---|---|
| 1 | Actionable attention queue | Partial: core ordering works; hook state and row visibility do not |
| 2 | Routed native notifications | Incorrect under replay, unknown exits, same-cwd routing, and dropped hooks |
| 3 | Attention-first fuzzy Ctrl+K switcher | Unstable during live updates; substring search; incomplete attention ranking |
| 4 | Terminal clipboard contract | Implemented, but multiline safety assumes bracketed-paste mode without observing it |
| 5 | Navigable semantic turn marks | Navigation helper works over supplied marks; OSC-133 claim is false |
| 6 | Developer quick select | Mostly correct for normal target counts |
| 7 | Persistent binary split tree | Pure tree algebra is sound; committed selection integration is broken |
| 8 | Spatial focus, direct labels, zoom | Geometry and zoom work; direct keyboard labels do not |
| 9 | Safe PARK versus KILL | Conservative policy is good; keyboard prompt and unknown durability are wrong |
| 10 | Durable discovery and recovery | Invalidated by dead-session listing and automatic snapshot spawning |

## Verification evidence

Executed against an isolated archive of committed HEAD:

- `npm test`: 49 Node tests and 294 Vitest tests passed.
- `npm run build`: passed; Vite transformed 82 modules.
- `cargo test --manifest-path crates/doom-term-pty/Cargo.toml`: 54 passed.
- `cargo test --manifest-path backend/Cargo.toml`: 57 passed, 3 live-account probes ignored.
- `npm run hud:check`: exited zero but skipped because the actual image was absent.
- Direct Tauri check: environment-blocked by missing `dbus-1` development metadata.
- `cargo fmt --check`: unavailable because the selected toolchain lacks `cargo-fmt`.
- Browser plugin and Playwright were unavailable. Focused jsdom integration tests
  and real daemon/WebSocket probes were used for the reproduced failures above.

The Vitest run also logs an unimplemented jsdom canvas `getContext` error from
`RawTerminalView.test.tsx` while still reporting the suite as passing. Do not
treat that suite as rendered HUD coverage.

## Recommended repair order

1. Stop ordinary selection from replaying consumed events.
2. Correct process-close status, map removal, and dead-entry replacement.
3. Fix modal keyboard ownership before further close/pane UI work.
4. Make hook identity exact and hook state recoverable after disconnects.
5. Verify and retain the current single-layout switching fix.
6. Enforce stored-snapshot semantics before automatic spawning.
7. Stabilize and lazily build the switcher search model.
8. Decide whether turn marks will truly use OSC 133 or be documented as
   heuristics.
9. Fix cross-target sidecar resolution.
10. Repair HUD hit testing and make verification gates fail closed.

Each P1 fix should land with an integration regression at the boundary where
the defect occurs. Adding more pure-function tests alone will not cover these
failures.
