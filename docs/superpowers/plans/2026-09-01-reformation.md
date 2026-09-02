# Reformation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the ten approved base-UX improvements while preserving Doom Term's chromeless, pass-through terminal model.

**Architecture:** Pure modules under `src/core` decide attention, notification, search, selection, pane-tree, close, and recovery behavior. React components translate DOM events into those operations. A single typed WebSocket request/reply lists daemon sessions; no new service or dependency is introduced.

**Tech Stack:** React 19, TypeScript 5.7, Vitest, Node test runner, Rust 2021, Tauri 2, tmux private socket.

**Spec:** `docs/superpowers/specs/2026-09-01-reformation-design.md`

## Global Constraints

- The status plate is the only persistent chrome.
- Plain Ctrl-letter input belongs to the PTY; app bindings use Ctrl+Shift or Ctrl+K.
- Display only observed state; unknown remains absent or `--`.
- No new runtime dependency.
- Recovery never executes a command.
- Existing workspace storage migrates without discarding sessions.
- Every new decision function is tested before production implementation.

---

### Task 1: Actionable Attention Queue

**Files:**
- Create: `src/core/attentionQueue.ts`
- Create: `src/core/attentionQueue.test.ts`
- Modify: `src/core/waitingList.ts`
- Modify: `src/hud/state.ts`
- Modify: `src/hud/canvas.ts`
- Modify: `src/components/StatusPlate.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `AttentionQueue` with `noteOutput`, `acknowledge`, `isAcknowledged`.
- Produces: `waitingRowAtPoint(width, dpr, x, y, rows) -> WaitingRow | null`.
- `WaitingRow` gains `sessionId` without exposing it to the pixel renderer.

- [x] Write tests proving quiet acknowledgements suppress a row until new output, while `ASKS` survives acknowledgement.
- [x] Run `npx vitest run src/core/attentionQueue.test.ts src/core/waitingList.test.ts` and confirm the new assertions fail for missing behavior.
- [x] Implement the queue and plate hit geometry; make click and `nextAttention` select and acknowledge the target.
- [x] Re-run the focused tests and commit `feat(attention): make the waiting queue operable`.

### Task 2: Routed Desktop Notifications

**Files:**
- Create: `src/core/sessionNotifications.ts`
- Create: `src/core/sessionNotifications.test.ts`
- Create: `src/hooks/useSessionNotifications.ts`
- Modify: `src/App.tsx`
- Modify: `src/hooks/usePtyEvents.ts`

**Interfaces:**
- Produces: `notificationTransition(previous, next, context) -> SessionNotice | null`.
- Produces: `SessionNotice = { key, sessionId, title, body }`.
- Records `lastExecutionStartedAt` and an incrementing `executionSerial` on `SessionNode`.

- [x] Write tests for background asks, non-zero exits, 10s successes, active-window suppression, and duplicate suppression keys.
- [x] Run `npx vitest run src/core/sessionNotifications.test.ts` and verify missing-module failure.
- [x] Implement the pure policy and a hook using the browser Notification API with click-to-select.
- [x] Extend PTY execution events with narrow node fields, run focused tests, and commit `feat(notifications): route attention to its session`.

### Task 3: Session Switcher Search and Preview

**Files:**
- Create: `src/core/sessionSwitcher.ts`
- Create: `src/core/sessionSwitcher.test.ts`
- Modify: `src/components/CommandPalette.tsx`
- Modify: `src/core/paletteActions.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `sessionSearchText(node, workspaceName)` and `rankSessions(nodes, activeId)`.
- `CommandPaletteAction` gains optional `searchText`, `preview`, `attention`, and `lastUsedAt`.

- [x] Write tests proving attention-first/MRU ranking and metadata/output searching.
- [x] Run the focused test and confirm failure.
- [x] Implement ranking, include the active and parked/recoverable sessions, and render a bounded preview for the selected action.
- [x] Run component and core tests, then commit `feat(palette): turn ctrl-k into the session switcher`.

### Task 4: Clipboard and Semantic Selection

**Files:**
- Create: `src/core/terminalSelection.ts`
- Create: `src/core/terminalSelection.test.ts`
- Modify: `src/core/keymap.ts`
- Modify: `src/components/RawTerminalView.tsx`
- Modify: `src/components/RawTerminalView.test.tsx`

**Interfaces:**
- Produces: `commandRegion(lines, clickedLine) -> { start, end }` using OSC-derived prompt/turn boundaries.
- Adds app actions `copySelection` and `pasteClipboard`.

- [x] Write failing keymap and region tests for Ctrl+Shift+C/V and command-region bounds.
- [x] Run focused tests and confirm behavior fails before implementation.
- [x] Implement clipboard reads/writes, bracketed multiline paste, and modifier triple-click region selection.
- [x] Run focused tests and commit `feat(terminal): complete clipboard and command selection`.

### Task 5: Turn Navigation

**Files:**
- Modify: `src/core/turnMarks.ts`
- Modify: `src/core/turnMarks.test.ts`
- Modify: `src/core/scrollback.ts`
- Modify: `src/components/RawTerminalView.tsx`
- Modify: `src/core/keymap.ts`

**Interfaces:**
- Produces: `stepTurn(markLines, currentLine, delta) -> number | null`.
- Adds `previousTurn`, `nextTurn`, and `copyTurn` view actions.

- [x] Add failing wraparound and empty-mark tests.
- [x] Run focused tests and confirm the expected assertion failures.
- [x] Implement scrolling to the returned line and copying the current turn range.
- [x] Run focused tests and commit `feat(scrollback): navigate and copy agent turns`.

### Task 6: Developer Quick Select

**Files:**
- Create: `src/core/quickSelect.ts`
- Create: `src/core/quickSelect.test.ts`
- Create: `src/components/QuickSelectOverlay.tsx`
- Create: `src/components/QuickSelectOverlay.test.tsx`
- Modify: `src/components/RawTerminalView.tsx`
- Modify: `src/core/keymap.ts`

**Interfaces:**
- Produces: `findQuickTargets(lines) -> QuickTarget[]` for URL, file-line, path, SHA, issue.
- Produces: deterministic home-row labels through `labelTargets`.

- [x] Write failing extraction, deduplication, precedence, and label tests.
- [x] Run focused tests and verify red.
- [x] Implement the pure scanner and transient keyboard overlay; Enter copies and Shift+Enter writes the value to the PTY.
- [x] Run core/component tests and commit `feat(terminal): add developer quick select`.

### Task 7: Persistent Split Tree

**Files:**
- Create: `src/core/paneTree.ts`
- Create: `src/core/paneTree.test.ts`
- Modify: `src/types/sessionTree.ts`
- Modify: `src/core/sessionStore.ts`
- Modify: `src/components/SplitPaneGrid.tsx`
- Modify: `src/components/SplitPaneGrid.test.tsx`
- Modify: `src/hooks/useWorkspaceSet.ts`
- Modify: `src/core/paletteActions.ts`

**Interfaces:**
- Produces: `PaneTree`, `treeFromLayout`, `splitLeaf`, `removeLeaf`, `setSplitRatio`, `equalizeTree`, `leafSessionIds`.
- `SessionGroup` gains optional `paneTree` and `zoomedSessionId`.

- [ ] Write failing pure tests for migration, split, removal, clamping, and equalization.
- [ ] Run focused tests and verify red.
- [ ] Implement the discriminated union and recursive renderer with pointer-resizable one-pixel dividers.
- [ ] Add palette actions for split right/down and equalize, run focused tests, and commit `feat(mux): persist a resizable split tree`.

### Task 8: Spatial Pane Navigation and Zoom

**Files:**
- Modify: `src/core/paneTree.ts`
- Modify: `src/core/paneTree.test.ts`
- Create: `src/components/PaneSelectOverlay.tsx`
- Create: `src/components/PaneSelectOverlay.test.tsx`
- Modify: `src/components/SplitPaneGrid.tsx`
- Modify: `src/core/keymap.ts`
- Modify: `src/hooks/useWorkspaceSet.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `paneRects(tree)`, `adjacentPane(tree, activeId, direction)`, and `paneLabels(tree)`.
- Adds actions `focusPane*`, `selectPane`, and `togglePaneZoom`.

- [ ] Write failing geometry tests for directional focus and stable labels.
- [ ] Run focused tests and verify red.
- [ ] Implement navigation, temporary labels, and zoom that preserves mounted siblings.
- [ ] Run focused/component tests and commit `feat(mux): add spatial focus and pane zoom`.

### Task 9: Prompt-Aware Detach and Kill

**Files:**
- Create: `src/core/sessionClose.ts`
- Create: `src/core/sessionClose.test.ts`
- Create: `src/components/CloseSessionPrompt.tsx`
- Create: `src/components/CloseSessionPrompt.test.tsx`
- Modify: `src/types/sessionTree.ts`
- Modify: `src/hooks/usePtyEvents.ts`
- Modify: `src/hooks/useWorkspaceSet.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `closeDisposition(node) -> 'kill' | 'confirm'`.
- `SessionNode` gains observed `atPrompt`, `parked`, and execution timing fields.
- Workspace operations gain `handleParkNode`, `handleRestoreNode`, and explicit `handleKillNode`.

- [ ] Write failing policy tests for idle prompt, running command, active agent, and non-durable sessions.
- [ ] Run focused tests and verify red.
- [ ] Record prompt/execution boundaries and implement the terse detach/kill prompt with detach selected by default.
- [ ] Run focused/component tests and commit `feat(session): separate parking from termination`.

### Task 10: Daemon Session Recovery

**Files:**
- Modify: `crates/doom-term-pty/src/tmux.rs`
- Modify: `backend/src/main.rs`
- Modify: `src/core/ptyClient.ts`
- Create: `src/core/sessionRecovery.ts`
- Create: `src/core/sessionRecovery.test.ts`
- Modify: `src/hooks/useWorkspaceSet.ts`
- Modify: `src/core/paletteActions.ts`

**Interfaces:**
- Adds client action `ListSessions { request_id }` and server event `SessionListing { request_id, sessions }`.
- Produces: `RecoverableSession = { id, cwd, command, durable }`.
- Produces: `reconcileSessions(storedIds, liveSessions) -> RecoveryState`.

- [ ] Write failing Rust tests for parsing/listing only Doom-prefixed tmux sessions and TypeScript tests for reconciliation.
- [ ] Run the focused Rust and TypeScript tests and verify red.
- [ ] Implement the protocol, correlated client promise, and palette recovery actions without automatic execution.
- [ ] Run focused tests and commit `feat(recovery): adopt live doom term sessions`.

### Task 11: Agent Review Documentation and Verification

**Files:**
- Create: `docs/REFORMATION_AGENT_REVIEW.md`
- Modify: `README.md`
- Modify: this plan's checkboxes as work lands.

**Interfaces:**
- Produces a reviewer map from each feature to invariants, files, tests, and manual probes.

- [ ] Document schema/protocol changes, event flows, keyboard bindings, recovery safety, and known platform limits.
- [ ] Run `npm test`, `npm run build`, `npm run hud:check`, PTY Rust tests, backend Rust tests, and the Tauri attempt.
- [ ] Inspect `git diff --check`, status, and the complete diff; fix every issue found.
- [ ] Commit `docs: add reformation agent review guide`.
