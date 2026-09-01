# What Doom Term should take from nodeterm

Reviewed 2026-08-29 against `/home/cleadmon/Projects/WindowsNodeTerm/nodeterm`
(Electron + React 18 + zustand + node-pty). Ordered by what it would fix in
Doom Term today, not by how impressive the module is.

The framing that matters: **nodeterm does not write a terminal emulator.** It
runs `@xterm/xterm` with the WebGL addon and spends its own effort on the layer
above — delivery, ownership, lifecycle, identity. Doom Term hand-rolls
`src/core/terminalEmulator.ts` and then has to re-solve, badly, every problem
xterm solved a decade ago. Most of the items below are downstream of that one
decision.

---

## 1. Adopt a real VT emulator (`@xterm/xterm` + `addon-webgl`)

**What Doom Term does now.** `terminalEmulator.ts` is a hand-written grid with
its own scrollback, cursor and SGR handling. It is the single largest source of
residual defects, and two are visible in a five-minute session:

- **No Unicode width table.** nodeterm's `renderer/terminal/unicode-width.ts`
  documents the exact failure and its fix at length: xterm.js ships Unicode 6
  widths, while tmux (utf8proc) and every agent CLI (`string-width`/`wcwidth`)
  are on a current table. They disagree about every emoji and every symbol that
  gained Emoji Presentation, so a glyph whose ink is two cells advances one and
  either overlaps its neighbour or gets clipped to a sliver. nodeterm fixes it
  by installing `@xterm/addon-unicode11` and activating version 11 explicitly.
  Doom Term has no width table at all — which is why the Bazzite MOTD's Nerd
  Font icons render as boxes and the columns after them shear.
- **Transient clipping of an in-progress input line.** Live-observed: while
  typing into Antigravity, the partially-typed line renders with its head
  missing (`y with exactly the word…` for `reply with exactly the word…`) as the
  agent repaints. The bytes are delivered correctly — the agent echoes the full
  line on submit and answers — so this is purely the emulator mis-replaying a
  redraw that moves the cursor backwards over a row it has already emitted.

**Take:** replace the emulator, keep the block model on top of it via
`@xterm/addon-serialize` for snapshots. This is the highest-leverage change on
this list and it retires code rather than adding it.

## 2. Echo-verified command delivery (`renderer/terminal/command-delivery.ts`)

**What Doom Term does now.** `ptyClient.submitCommandToSession` writes
`${command}\n` blind, in one shot.

nodeterm's module exists because that races shell init: zsh's rc/ZLE setup
resets the tty with a flush that can eat part of a queued line, and a mangled
line submitted anyway strands the shell at `quote>`. Their field report is three
spawned agents, none started. The fix is two-act — write the line **without**
Enter, wait until the shell echoes its tail back (`ECHO_TAIL_CHARS = 24`, escape
sequences stripped), *then* submit; on a 2 s verify timeout, `Ctrl-U` and
rewrite, up to three attempts, with the last attempt submitting unverified so an
unrecognised echo can never block a launch.

**Take:** port it more or less verbatim for the one-shot launch path (running
`agy`, `claude`, `codex` from the block editor). It is pure, injected-IO and
already unit-tested there.

## 3. Keep offscreen panes alive (`offscreen-policy.ts`, `hibernation-policy.ts`)

**What Doom Term does now.** `SplitPaneGrid` in `single` layout renders **only**
the active node. Every tab switch throws away the inactive pane's React subtree
and rebuilds the other from state.

nodeterm keeps a node mounted and only tears down its xterm+PTY client after
**ten minutes** offscreen (`OFFSCREEN_DISPOSE_MS_DEFAULT`), and even then only
because tmux is holding the session so re-attach redraws it. The load-bearing
sentence in their own comment is that this is false without tmux — see item 4.

**Take:** render every pane in the group and toggle visibility, so a switch is a
style change rather than a remount. (Doom Term now positions the viewport in a
layout effect and remembers per-session scroll, which removes the after-paint
jump; keeping panes mounted is the structural version of the same fix.)

## 4. tmux as the session substrate (`pty-bundled-tmux`, `pty-coattach`)

nodeterm bundles tmux and co-attaches to it, which is what makes item 3 safe,
makes a reload lossless, and lets an agent survive the UI dying. Doom Term's
500-event ring buffer in the daemon is a partial substitute: it replays what it
captured, but the shell dies with the daemon — as it did during this session's
own daemon restart, taking a running Antigravity with it.

**Take:** worth it, but it is a substantial change to the daemon's model. Treat
as its own project, not a follow-up commit.

## 5. Hook-based agent identity, not `/proc`

Doom Term identifies the agent from `/proc/<pid>/stat` field 8 (`tpgid`) →
`/proc/<tpgid>/comm`. That is honest and it works, but it yields only a binary
name — which is why the plate deliberately has no model field.

nodeterm installs the vendors' own hooks and gets `session_id` and
`transcript_path` in every payload, which is what lets it tail the transcript
for a real context percentage. `/proc` cannot do this: `claude` appends and
closes its transcript rather than holding the fd open (verified 2026-08-29, see
`nodeterm-usage-reference-implementation`).

**Take:** already planned in
`docs/superpowers/plans/2026-08-29-doom-term-usage-percentage.md`. Note the
prerequisite — the CONTEXT slot cannot become real without it.

## 6. A bounded input buffer for fragile windows (`wake-input-buffer.ts`)

A small, pure state machine that HOLDS keystrokes while a resume line is being
delivered and either flushes them in order once the line is confirmed submitted,
or drops them if the wake failed — never splicing them into the command. Bounded
at 4096 chars, and the refusal is loud (`queueFull`) rather than a silent drop.

**Take:** pairs with item 2. The same window exists in Doom Term the moment
command delivery stops being a single blind write.

## 7. Smaller things worth lifting

| Module | Why |
| --- | --- |
| `osc52.ts` | Clipboard from inside the terminal, **write-only** — a `?` read query is ignored so a remote program can never exfiltrate the local clipboard. Doom Term's demuxer drops OSC 52 entirely. |
| `file-links.ts`, `file-link-dialect.ts` | Clickable `path:line` in output, per-shell dialect. Obvious fit for the block model. |
| `middle-click.ts` | Primary-selection paste. Doom Term already uses middle-click to close a tab — check the collision. |
| `renderer-mode.ts` | Enforces exactly one GPU renderer owns state, with the call ORDER as a tested contract. Relevant if Doom Term ever ships the WebGL path its README claims. |
| `char-size-quantize.ts` | Integer cell metrics — the same discipline as the plate's integer scaling, applied to text. |
| `agent-restart.ts` | In-place restart choreography (clear the line with `Ctrl-U`, type the exit command, relaunch) rather than killing the pane. |

## 8. What Doom Term should NOT take

- **The node-graph canvas** (`@xyflow/react`). Doom Term's spatial model is the
  split grid and the session tree; a free canvas is a different product.
- **`smart-whisper` / speech.** No bearing on a terminal.
- **Electron.** Tauri is the smaller, correct choice here.
- **nodeterm's HUD indicator vocabulary.** It ranks Claude nearest the notch by
  brand. Doom Term's well is one agent — whichever holds *this* session — and
  that is the better rule.

---

## Cross-cutting note

Every nodeterm module read for this review carries a comment explaining the
*failure that motivated it*, usually with a date and a field report. That is the
practice most worth copying, and Doom Term already does it in `plate.js` and
`foreground.rs`. Keep it: several of the fixes above are only obvious once you
know which symptom they came from.
