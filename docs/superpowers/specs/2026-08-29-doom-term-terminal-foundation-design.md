# Terminal foundation: a real VT model, correct sizing, and a surviving session

Design for Tier 1 + Tier 2 of the nodeterm review
(`2026-08-29-nodeterm-portable-improvements.md`), plus the two defects that
review missed and the one it got structurally wrong.

Every item below names the defect that motivates it, with a file and line, in
the practice `plate.js` and `foreground.rs` already follow. Several of these
fixes only make sense once you know which symptom they came from.

---

## Licensing, before anything else

nodeterm is **BUSL-1.1**, © Enes Kirca. Doom Term is **MIT**. BUSL-1.1 is
source-available, not open source, and its Additional Use Grant covers
production *use*, not relicensing. The review's instruction to "port it more or
less verbatim" would breach that licence and make Doom Term's own LICENSE false
as to the copied files.

So: nodeterm is a **reference, never a source tree**. The techniques are facts
and are free to reuse — echo-verify before submitting, hold keystrokes during a
fragile window, quantize cell metrics to integers. The expression is not, and
that explicitly includes the long why-comments, which are the most clearly
copyrightable part of the work. Read it, close it, write ours, credit it as
prior art in `THIRD-PARTY-NOTICES.md`.

`@xterm/*` is MIT and carries none of this. tmux is ISC, libevent BSD, ncurses
MIT-like — bundling those creates attribution *obligations*, not restrictions,
and they belong in the same notices file.

---

## What is actually wrong today

Four defects, in the order they bite. Two are not in the nodeterm review.

**1. Every terminal is hardcoded 120×30 and never resized.** `resizeEmulators()`
has zero callers. `ptyClient.resize()` and `resizeSession()` have zero callers.
Both spawn sites pass literal `120, 30` (`ptyClient.ts:101`,
`useWorkspaceSet.ts:97`). The only `ResizeObserver` in the tree is in
`StatusPlate.tsx`, for HUD graphics. **`SIGWINCH` never fires.** Every agent CLI
wraps its output and sizes its box-drawing frames for 120 columns forever, and
an alt-screen TUI is locked to a 30-row screen buffer regardless of window
height. This is the highest-frequency visible defect in the application.

**2. UTF-8 corrupts at chunk boundaries.** `demuxer.rs:133,161,172,235` call
`String::from_utf8_lossy` on each 8192-byte read (`session.rs:138`). A
multi-byte character straddling the boundary becomes U+FFFD permanently. The
same file already fixed exactly this class of bug for ESC — see the comment at
`demuxer.rs:193-195`, "a read can end exactly on the ESC" — and did not carry
the lesson to UTF-8. This survives any emulator change, because it happens
upstream in Rust.

**3. `terminalEmulator.ts` has no character-width model.** `putChar`
(`terminalEmulator.ts:379`) writes one cell and does `cursorX++`, with no width
lookup. Because `write()` iterates with `for (const ch of data)` — code points,
not grapheme clusters — a combining mark or a ZWJ emoji sequence consumes a cell
each. There is no width table *and* no clustering.

**4. The whole scrollback re-renders on every PTY chunk.** `usePtyEvents.ts:48`
calls `emu.getLines()`, which rebuilds an `AnsiLine` for every row of scrollback
— up to 5000, each with a fresh `Date.now()` — and `RawTerminalView.tsx:235`
maps all of them to DOM with no virtualization. The block path allocates the
full array before slicing, too (`linesSince`, `terminalEmulator.ts:238`). Every
8KB of agent output costs O(scrollback × cols) allocation plus a full React
reconciliation.

And one structural fact that shapes Stage D: **the daemon's ring holds 500
*events*, not a screen** (`session.rs:127,157-160`). Replay reconstructs a
partial byte stream for the frontend to re-parse. Enlarging it cannot make
reattach lossless; only a screen model or a session substrate can.

Two smaller notes. `vte = "0.14"` is declared in both `Cargo.toml` files and
never imported — a real parser was budgeted for and hand-rolled instead. And
`README.md:99,155` advertises a "Dual-Mode WebGL / Canvas2D Fallback" that does
not exist.

---

## Correcting the review

The review says nodeterm "runs `@xterm/xterm` with the WebGL addon." It does
both, at different layers, and the split is the interesting part:

```
dependencies:    @xterm/headless, addon-serialize, addon-unicode11, addon-web-links
devDependencies: @xterm/xterm, addon-webgl, addon-fit, addon-search
```

`@xterm/headless` is the **runtime** dependency because it runs in the host
process as the authoritative screen model — that is what makes their reattach
lossless. The full renderer is bundled into the UI layer. We take the headless
half, which fits Doom Term better: it replaces parsing only, and leaves the Doom
palette, the `AnsiLine`/`AnsiSpan` model and the block UI untouched.

One consequence, and it promotes an item the review filed under "smaller things
worth lifting": **headless has no DOM, so `addon-fit` cannot measure it.** Cell
measurement is not a nice-to-have, it is the prerequisite for resize. Stage A
builds it.

---

## Stages

Ordered so each one de-risks the next. Resize must precede tmux, because tmux
sessions are sized and attaching at the wrong size is miserable to debug.
Replacing the emulator before adding tmux means tmux's repaints land in a
correct VT model rather than a broken one.

### Stage A — Foundation

No xterm yet. All of this is independently valuable and unblocks everything
after it.

**A1. Hold back incomplete UTF-8 in the demuxer.** Add a bounded
`utf8_tail: Vec<u8>` field to `StreamDemuxer`. At the top of `process_bytes`,
seed the output accumulator from it:

```rust
let mut output_chunk = std::mem::take(&mut self.utf8_tail);
```

Replace all four `from_utf8_lossy` sites with one helper that splits on
`std::str::from_utf8`'s error: when `error_len() == None` the trailing bytes are
an *incomplete* sequence, so emit `[..valid_up_to()]` and keep the remainder for
the next chunk; when `error_len() == Some(n)` the bytes are genuinely invalid,
so emit lossily and continue — real garbage must not be held forever. Cap the
tail at 3 bytes and flush lossily beyond that, since no valid sequence is
longer.

*Tests:* split a 3-byte character across two `process_bytes` calls and assert no
U+FFFD; same for a 4-byte emoji split at each of its three interior offsets; and
assert genuinely invalid bytes still surface rather than accumulating. Rust
unit tests in the existing style — there are already 48.

**A2. Measure the cell, then wire resize.** A new `src/core/cellMetrics.ts`
measures the mono font with canvas `measureText` over a long run (divide, don't
measure one glyph) and quantizes to integers, because a fractional advance
accumulates into a full column of drift across an 80-column row. A new
`useTerminalSize(ref, sessionId)` hook observes the pane, computes
`cols = floor(w / cellW)` and `rows = floor(h / cellH)`, clamps to sane minima,
coalesces resize storms with rAF, and calls both sides.

`emulatorRegistry.ts` needs an API change: `resizeEmulators(cols, rows)` resizes
*every* emulator to one size and mutates a module-level default, which is wrong
the moment two panes differ. Replace it with
`resizeEmulator(sessionId, cols, rows)`. Fix both `spawnSession` sites to pass
measured dimensions rather than `120, 30`.

**A3. Correct the README.** Remove the WebGL/Canvas2D dual-mode claim at
`README.md:99,155` and describe the render path that exists.

### Stage B — Replace the emulator

**B0. Spike first (~15 min).** `@xterm/headless` is published for Node; nodeterm
runs it in Electron's main process, not a browser. Confirm it bundles under Vite
and parses in the renderer. Fallback if it does not: `@xterm/xterm` constructed
but never `open()`ed, which exposes the identical buffer API at the cost of some
dead DOM code. Decide before writing anything on top of it.

**B1. Extract the seam, then implement behind it.** `usePtyEvents.ts` and
`emulatorRegistry.ts` consume a specific surface: `write`, `isAltScreen`,
`mark`, `getLines`, `linesSince`, `resize`, `reset`. Extract it as a
`TerminalScreen` interface, add `xtermScreen.ts` implementing it over xterm, and
keep `terminalEmulator.ts` in the tree until parity is proven. Mapping:

| `TerminalScreen` | xterm |
|---|---|
| `write` | `term.write(data)` |
| `isAltScreen()` | `buffer.active.type === 'alternate'` |
| `mark()` | `term.registerMarker(0)` — a real marker, not an integer |
| `getLines()` | walk `buffer.active`, build `AnsiLine[]` |
| `linesSince(m)` | walk from `m.line` to the end |
| `resize` / `reset` | `term.resize` / `term.reset` |

`registerMarker` is a genuine improvement over the current integer scheme
(`terminalEmulator.ts:229`): markers track their line as the buffer scrolls and
dispose themselves when it falls out of scrollback, which is exactly the signal
the block model needs and currently has to infer.

**B2. Cells to spans, preserving the palette.** Walk each line with
`line.getCell(x, ref)` and **skip cells where `getWidth() === 0`** — those are
the trailing half of a wide character, and skipping them is the Unicode fix
made concrete. Route palette indices through the existing `DOOM_PALETTE` and
`parse256Color` so the Doom colours survive the swap; use `getFgColorMode()` to
tell default from palette from RGB. `looksLikeError()` and `spanStyle()` are
untouched — they read output, not emulator state.

**B3. Activate Unicode 11.** Load the addon and set
`term.unicode.activeVersion = '11'`, non-fatally: a terminal on the old table
renders as it did yesterday, which beats a terminal that does not open. The
goal is *agreement* with tmux and the agent CLIs, not the number 11.

**B4. Prove parity, then delete.** Run both implementations over the corpus in
`terminalEmulator.test.ts` and assert identical `AnsiLine[]`. That is the cheap,
strong de-risking step for a 858-line deletion, and it will find the SGR and
erase-semantics differences that a hand-rolled emulator always has. Delete
`terminalEmulator.ts` once it passes.

**B5. Stop re-rendering the scrollback.** Drive updates from xterm's render
event on a coalesced frame rather than once per PTY chunk, and have `getLines()`
return the viewport window rather than the whole buffer. This changes the scroll
model — the DOM container stops being the scroll authority and xterm's viewport
takes over, so wheel and keyboard scrolling must translate to
`term.scrollLines()`, and `RawTerminalView`'s `scrollTop = scrollHeight`
tail-follow (`RawTerminalView.tsx:109`) goes away.

That is the subtlest change in this design, so it is last in the stage and can
ship a release behind the rest. The cheaper interim, if it needs to be deferred:
memoize the line component on the stable `AnsiLine.id` so React reconciles only
changed lines. That cuts reconciliation but not DOM node count, so it is a
stopgap, not the fix.

### Stage C — Lifecycle

**C1. Keep offscreen panes mounted.** `SplitPaneGrid.tsx:27-31` renders only the
active node in `single` layout, so every tab switch remounts a subtree. Render
every node in the group and toggle visibility instead.

Two gotchas to design for rather than discover. `display: none` removes layout,
so a hidden pane has `scrollHeight === 0` and any scroll restoration on it
silently does nothing — use `visibility: hidden` with absolute positioning, or
defer scroll work until the pane becomes visible. And `RawTerminalView`'s focus
effect keys on `isActive` (`RawTerminalView.tsx:100-105`); with every pane
mounted, exactly one must hold focus, so that effect needs to also *release*
focus when a pane deactivates.

**C2. Echo-verified command delivery.** `ptyClient.submitCommandToSession`
writes `${command}\n` blind in one shot, which races shell init: zsh's rc/ZLE
setup resets the tty with a flush that can eat part of a queued line, and a
mangled line submitted anyway strands the shell at `quote>`. Write the line
*without* Enter, wait for the shell to echo its tail back, then submit. On
timeout, `Ctrl-U` and rewrite, bounded; the final attempt submits unverified,
because a terminal whose echo we cannot recognise must never block a launch —
that worst case is exactly today's behaviour.

Our own implementation, our own constants, our own comments. Pure with injected
IO, so it unit-tests without a PTY.

**C3. Bounded input buffer.** C2 opens a window, up to attempts × timeout long,
where anything typed lands inside an unsubmitted line. Hold keystrokes for the
duration; flush them in order once the line is confirmed submitted, or drop them
if the wake failed — never splice them into the command. Bounded, with a loud
refusal rather than a silent drop.

### Stage D — tmux as the session substrate

The daemon's 500-event ring replays what it captured, but the shell dies with
the daemon — as it did during the review session itself, taking a running
Antigravity with it. tmux is what makes the shell outlive both the daemon and
the UI.

**D1. Bundle tmux as a second Tauri sidecar,** following the existing
`tools/build-sidecar.mjs` pattern (`<name>-<triple>` next to `bundle.externalBin`).
Be clear-eyed: tmux is a C program with libevent and ncurses dependencies, so
this is real per-platform packaging work — obtaining or building a static binary
for each target triple, and carrying the ISC/BSD/MIT notices. It is the largest
non-code cost in this design.

**D2. One tmux session per pane,** created with an explicit size
(`new-session -A -s doom-<id> -x <cols> -y <rows>`) — which is why Stage A comes
first. Reattach on daemon start by listing sessions and re-attaching;
`capture-pane` recovers scrollback that the live attach does not repaint. The
ring buffer's role shrinks to in-flight events.

**D3. Degrade honestly.** If the sidecar is missing or tmux fails to start, fall
back to today's direct spawn and say so in the UI rather than pretending the
session is durable. A persistence guarantee that silently is not one is worse
than none.

### Stage E — Hook-based identity and a real CONTEXT %

Folds in `docs/superpowers/plans/2026-08-29-doom-term-usage-percentage.md`.

Doom Term identifies the agent from `/proc/<pid>/stat` field 8 → `comm`
(`foreground.rs:31-35`), which is honest and yields only a binary name. That is
why the plate has no model field, and why CONTEXT % cannot become real on the
current mechanism: `claude` appends and closes its transcript rather than
holding the fd open, so `/proc` cannot find it.

Install the vendors' own hooks to get `session_id` and `transcript_path` in
every payload, then tail the transcript backwards for the newest assistant
`usage` block. The denominator comes from the model *family*, not the id, since
the id stays bare even when a 1M window is active. USAGE % and CONTEXT % remain
two unrelated sources and must not be conflated.

---

## Testing

- **Rust:** unit tests for the UTF-8 carry, including split at every interior
  offset of a 4-byte sequence, and the invalid-bytes case.
- **Parity:** both screen implementations over the `terminalEmulator.test.ts`
  corpus, asserting identical output. This is what makes the 858-line deletion
  safe.
- **Pure modules:** cell metrics, command delivery and the input buffer are all
  injected-IO and test without a DOM or a PTY.
- **Live:** per `doom-term-two-tabs-fight-over-sessions`, close duplicate
  browser tabs before any live verification — shared `localStorage` manufactures
  phantom bugs.

## Sequencing and risk

| Stage | Independently shippable | Main risk |
|---|---|---|
| A | Yes | None material; all additive |
| B | Yes, after B4 parity | B0 spike could force the `@xterm/xterm` fallback; B5 changes the scroll model |
| C | Yes | C1's focus and layout gotchas |
| D | Yes | Per-platform tmux packaging is the real cost |
| E | Yes | Depends on vendor hook formats, which move |

Stage A should land regardless of what happens to the rest: defect 2 is
corrupting output today, and defect 1 affects every session.
