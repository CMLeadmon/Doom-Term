# Doom Term Reformation Design

Approved 2026-09-01. This design turns the ten competitive-review findings
into one deliberately narrow release. It does not revive tabs, a sidebar,
blocks, plugins, or permanent pane controls.

## Product invariant

Doom Term is an agent supervisor with one focused terminal and one persistent
piece of chrome: the status plate. Every new control is either a direct action
or a temporary mode. The terminal process keeps plain Ctrl-letter bindings;
application commands use the existing Ctrl+Shift namespace or Ctrl+K.

## Features

1. **Actionable attention queue.** Waiting rows carry session ids, can be
   clicked, and can be visited with a next-attention command. Visiting a quiet
   row acknowledges it until the session emits again. A vendor `ASKS` event is
   never acknowledged until its hook clears.
2. **Routed notifications.** Background asks, failures, and long commands may
   emit one native notification per transition. Activating it focuses the
   exact session. Active-window noise and duplicate transitions are suppressed.
3. **Session switcher.** Ctrl+K orders sessions by attention and recency,
   searches their metadata and visible buffer, and shows a short selected-row
   preview without switching.
4. **Clipboard contract.** Ctrl+Shift+C copies the current DOM selection and
   Ctrl+Shift+V writes clipboard text as one bracketed paste. Plain Ctrl+C
   remains SIGINT. Modifier triple-click selects a trusted prompt/turn region.
5. **Navigable turn marks.** Previous/next turn actions move the existing
   scroll viewport. The current turn can be copied without reintroducing cards.
6. **Developer quick select.** A temporary overlay labels URLs, file paths,
   `file:line` references, commit hashes, and issue ids from the visible buffer.
   Enter copies; Shift+Enter inserts into the PTY.
7. **Minimum split tree.** A group may persist a binary row/column tree whose
   leaves reference sessions. Splits preserve ratios, render recursively, and
   can be equalized or resized from one-pixel dividers.
8. **Pane navigation and zoom.** Spatial navigation selects adjacent leaves;
   a temporary label mode selects directly; zoom hides siblings without
   destroying their DOM, scroll, or layout.
9. **Detach versus kill.** Closing a session at an idle shell kills it. Closing
   a running process opens a terse transient choice whose safe default parks
   the session. Parked sessions stay in the switcher and can be restored.
10. **Recovery.** The daemon reports the sessions held in memory or discoverable
    on Doom Term's private tmux socket. The client reconciles these with stored
    nodes and exposes unmatched sessions as recoverable. It never silently
    reruns a command after a daemon restart.

## Architecture

Pure modules own decisions and geometry. React components own focus and DOM
events only. `PtyClient` owns transport correlation. The Rust daemon owns the
authoritative list of live PTYs/tmux sessions. Workspace schema additions are
optional and migrated on read so old localStorage remains valid.

The split tree is a discriminated union:

```ts
type PaneTree =
  | { type: 'leaf'; id: string; sessionId: string }
  | {
      type: 'split'; id: string; direction: 'row' | 'column'; ratio: number;
      first: PaneTree; second: PaneTree;
    };
```

## Notification policy

- `ASKS`: notify once when a background session transitions false -> true.
- failed command: notify once when a new non-zero execution result arrives.
- successful command: notify only when its measured duration is at least 10s.
- never notify the active session while the document is focused.
- notification activation selects the session; permission denial is silent.

## Recovery policy

The daemon's session list is authoritative for process liveness. localStorage
is authoritative for names, workspaces, split trees, parked state, and cached
screen content. Reconciliation keeps matching ids, offers unmatched daemon ids
as `RECOVERABLE`, and marks stored ids missing from the daemon as snapshots.
No command is executed by recovery.

## Review gates

- No new runtime dependency.
- New decision logic has a red/green test cycle.
- `npm test`, `npm run build`, PTY Rust tests, and backend Rust tests pass.
- `npm run hud:check` proves the unselected plate remains pixel-identical.
- Tauri compilation is attempted and any host-library limitation is recorded.
