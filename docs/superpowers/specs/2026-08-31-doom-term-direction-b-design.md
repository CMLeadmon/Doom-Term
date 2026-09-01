# Doom Term — Direction B: the plate is the only chrome

Design settled 2026-08-31. Supersedes the chrome sections of
`2026-08-28-doom-term-review.md`; the material system and the plate renderer
are unchanged and remain load-bearing.

Visual proposals:
- Three directions — <https://claude.ai/code/artifact/da77d870-bb0f-49cf-baf4-c6b91d891e88>
- Direction B in full — <https://claude.ai/code/artifact/1f43f29b-ee75-4e5b-b5a6-ea9c3b82f0fe>

---

## 1. What Doom Term is

An **agent supervisor**. One agent holds the screen; the others run where you
cannot see them. The product's single job is to tell you *which of the ones you
cannot see has stopped and wants you*, without taking screen away from the one
you are looking at.

Everything below follows from that sentence.

## 2. The thesis

**The plate is the only chrome.** The terminal reaches all four window edges.
There is no tab strip, no sidebar, no pane header, and no command editor. Every
fact the window used to carry in HTML is either on the plate or is not shown.

The plate earns this because it is *rendered, not styled*: `renderPlate()` blits
an RGBA buffer at integer scale with smoothing off. Nothing else in the app was
built that way, and every HTML surface broke at least one of the plate's own
rules — hover-only controls, narration instead of labels, path and branch shown
three times, `#2a2620` ink on `#6d6d6b` plate at ~2.5:1, and a CSS
`animate-pulse` over a design whose thesis is a hard pixel grid.

## 3. Decisions

### 3.1 The plate spans the window

Doom measured its offsets from **both** edges of a 320-wide bar, so they survive
a stretch. The left group stays pinned at `contextX 44` / `usageX 90`; the right
group's columns become `W−99`, `W−81`, `W−69`, `W−29`, `W−3`, `W−25`.

**Invariant:** evaluated at `W = 480` these must equal the shipped
`PLATE_480` values (381, 399, 411, 451, 477, 455). The full-width plate is a
generalisation of the shipped geometry, never a redraw of it. This is testable
and must be tested.

The **centre is the only elastic member**. Left and right groups never move,
because context, usage, sandbox and tokens are true in every mode.

### 3.2 Scale stops maximising

`plateScale()` currently returns `floor(width / 480)`, so a 1920px window renders
at 4× and gains **no** logical width. Full-width means choosing a *legibility*
scale — 2×, or 3× when `devicePixelRatio >= 2` — and spending the remainder on
the centre. Integer only; fractional scaling destroys the striation.

### 3.3 The centre carries the waiting list

Only sessions that have **stopped and want you** get pixels. A running agent
needs nothing from you and gets nothing.

- Caption `WAITING` over a display numeral, set exactly as `CONTEXT` and
  `USAGE` are. It is a quantity you can run out of patience with.
- Up to three rows: session number, name, and time since last output.
- Names truncate to whatever the window left over — never an overflow.
- Below ~110px of centre zone, the count stands alone rather than printing
  three characters and a guess.
- An empty list is a good state and reads as such.

### 3.4 Sessions are numbered

Every session carries a stable number 1–9. `Ctrl+1`…`Ctrl+9` jumps directly.
The waiting rows show theirs, so the list is also the switcher.

Numbers are assigned by **lowest free slot at creation** and released on close.
They persist with the workspace so `Ctrl+2` means the same thing tomorrow.

### 3.5 Sessions name themselves, and you can override

1. On creation: folder + branch — `DOOM-TERM/CLEAN-SLATE`.
2. Once the session has an agent and a first instruction, that instruction,
   slugged and capped — `PTY-SOCKET-FIX`.
3. A user rename wins permanently and is never overwritten.

There is never a moment with no name, because in this direction a nameless
session is an invisible one.

### 3.6 The approval gate is dropped

`securityAnalyzer.ts`, `Approval.tsx` and the risk interception in
`handleExecuteCommand` are deleted. Claude Code and Codex already prompt before
their own risky calls, and in pass-through the app never sees the command
anyway — the agent types it straight into the PTY.

**This splits one idea into two.** The old gate both *decided* whether a command
should run and *told you* something needed attention. Only the first job is
gone. Noticing that an agent is blocked on you is retained, and is the whole
subject of the enhancement plan.

### 3.7 One view: the raw terminal

The block model is deleted — `Block`, `BlockPane`, `Rail`, `CommandEditor`,
`Diff`, `ToolCall` and the `TerminalBlock` type. A shell is just another process
that owns the keyboard, so every session renders `RawTerminalView`.

`ownsKeyboard` disappears with it: there is no second mode to choose between.

### 3.8 The terminal keeps one pixel of recess

"Edge to edge" meant no chrome, not no boundary. The plate is raised, so content
is cut into it with the same `--bevel-dn` everything else uses.

## 4. What is explicitly out of scope here

These are the enhancement plan, not this one:

- **Scrollback, search and turn marks.** The plate re-tooling into a transport.
- **The summons.** Detecting that an agent is blocked and taking the screen.
- **The rack.** `Ctrl+K`, answering in place, and creating sessions.

Until the rack exists, session switching is `Ctrl+1`…`Ctrl+9` and the waiting
rows. That is a usable product on its own, which is the bar each plan has to
clear.

## 5. Constraints carried forward

Unchanged from the clean-slate spec and still binding:

- Every displayed datum is observed, never invented. No honest source → `--`.
- No game vocabulary in any user-visible string.
- Four materials, no fifth: plate, recess, 1px bevel pair, ink.
  `border-radius: 0`; depth is the bevel pair only.
- Plate scales by integers only.
- Text on plate is `#22201b`; text in a recess is `--ink` / `--ink-tan` /
  `--ink-dim` on `--ground`.
- Five states, one colour each. Red on the plate is reserved for display
  numerals.
- Every ink token clears WCAG AA against `--ground`
  (`src/styles/material.test.js`).

## 6. Prior art and licensing

- **xterm.js** (MIT) — already a dependency. Code may be used directly.
- **tmux** (ISC) — already bundled.
- **nodeterm** (BUSL-1.1, © Enes Kirca) — **techniques only, never code or
  comments.** See `2026-08-29-nodeterm-portable-improvements.md`. Relevant
  items: keeping offscreen panes mounted (§3), echo-verified command delivery
  (§2), hook-based agent identity (§5).
- **Warp** — closed source. No code is available to borrow; only publicly
  observable ideas, and its principal one (blocks) is being removed here.

`THIRD-PARTY-NOTICES.md` records the independent-implementation position and
must stay accurate.

## 7. Open questions

Deferred, and none of them block this plan:

1. **How the app knows an agent is asking.** Everything in the enhancement plan
   rests on it. Hooks where the vendor has them, prompt-shape matching as the
   fallback. Needs a spike against real Claude Code, Codex and agy sessions
   before the enhancement plan is executed.
2. **Do split panes die?** `SplitPaneGrid` survives this plan rendering a single
   pane. The rack is the intended replacement.
3. **Is a session ever more than one process?** Decides whether the waiting list
   counts sessions or tasks.
