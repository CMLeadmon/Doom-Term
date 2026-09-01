# Terminal Foundation Stage A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop corrupting UTF-8 at PTY read boundaries, and make every terminal report its real size to the shell instead of a hardcoded 120×30.

**Architecture:** Two independent fixes that share no code. In Rust, the stream demuxer grows a bounded carry buffer so a multi-byte character split across two 8192-byte reads is rejoined instead of being replaced with U+FFFD. In TypeScript, a pure cell-geometry module plus a `ResizeObserver` hook derive a real grid from each pane and push it to both the PTY (`SIGWINCH`) and the session's emulator. No xterm yet — this stage deliberately keeps the existing emulator so it can ship on its own.

**Tech Stack:** Rust (`crates/doom-term-pty`, `std::str::from_utf8`), TypeScript + React 19, Vitest with jsdom, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-08-29-doom-term-terminal-foundation-design.md` (Stage A; Stages B–E get their own plans)

## Global Constraints

- **Never copy nodeterm source.** nodeterm is BUSL-1.1, Doom Term is MIT. Techniques are free to reuse; code and comments are not. Write ours from behavior.
- **Every non-obvious fix carries a comment naming the failure that motivated it**, in the practice `plate.js`, `foreground.rs` and `demuxer.rs` already follow.
- **No game vocabulary** in any user-visible string.
- Rust tests: `cargo test --manifest-path crates/doom-term-pty/Cargo.toml`. This crate builds with the normal toolchain — the doom-tauri toolbox is only needed for `src-tauri`.
- TS tests: `npx vitest run <path>` for one file; `npm test` for the whole suite.
- jsdom provides **no `ResizeObserver`** and **no canvas 2D context** (`getContext('2d')` returns `null`). Keep geometry arithmetic pure and testable; stub the DOM pieces.
- Terminal grids are clamped to a floor of **20 cols × 4 rows**. Agent CLIs do arithmetic on `$COLUMNS` and emit negative padding or divide by zero on a degenerate grid.

---

### Task 1: Hold incomplete UTF-8 across PTY reads

A PTY read ends on an arbitrary byte boundary (`session.rs:138` reads 8192 bytes at a time), so a multi-byte character routinely straddles two reads. `String::from_utf8_lossy` turns each half into U+FFFD and the character is gone for good. This is the same end-of-read hazard the demuxer already handles for ESC — see the comment at `demuxer.rs:193-195`, "a read can end exactly on the ESC" — never carried across to UTF-8.

**Files:**
- Modify: `crates/doom-term-pty/src/demuxer.rs` (struct at `:27-39`, `new()` at `:42-54`, `process_bytes` at `:76-240`)
- Test: `crates/doom-term-pty/src/demuxer.rs` (`mod tests` at `:328`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks depend on. `DemuxEvent::Output { data: String }` keeps its exact shape — this task changes only *which* bytes reach it.

**Design note — only the final flush holds bytes.** `process_bytes` flushes `output_chunk` at four places. Three are mid-chunk, immediately before an OSC or CSI event, and those keep `from_utf8_lossy` deliberately: in well-formed output a complete character always precedes an ESC, so a truncation there is genuinely malformed input, not a boundary artifact. Holding bytes at those sites would also reorder text against control events — text captured before an `ExecutionStart` would surface after it and land in the wrong block. Only the flush at the end of the read can legitimately hold.

- [ ] **Step 1: Write the failing tests**

Add to `mod tests` in `crates/doom-term-pty/src/demuxer.rs`:

```rust
/// The existing tests repeat this filter inline; the new cases below need it
/// several times over.
fn text_of(events: &[DemuxEvent]) -> String {
    events
        .iter()
        .filter_map(|e| match e {
            DemuxEvent::Output { data } => Some(data.as_str()),
            _ => None,
        })
        .collect()
}

#[test]
fn a_multibyte_character_split_across_reads_survives() {
    let mut demuxer = StreamDemuxer::new();
    // "é" is C3 A9. An 8192-byte read lands between them often enough to see
    // it during any agent session that prints accented text or box drawing.
    let first = demuxer.process_bytes(b"caf\xc3");
    assert_eq!(text_of(&first), "caf", "a dangling lead byte must be held, not replaced");

    let second = demuxer.process_bytes(b"\xa9 au lait");
    assert_eq!(text_of(&second), "\u{e9} au lait", "the held byte must rejoin its tail");
}

#[test]
fn a_four_byte_emoji_survives_a_split_at_every_interior_offset() {
    // "🎉" is F0 9F 8E 89, so a read can end after one, two or three of them.
    let emoji = "\u{1f389}".as_bytes();
    for split in 1..emoji.len() {
        let mut demuxer = StreamDemuxer::new();
        let first = demuxer.process_bytes(&emoji[..split]);
        let second = demuxer.process_bytes(&emoji[split..]);
        let text = format!("{}{}", text_of(&first), text_of(&second));
        assert_eq!(text, "\u{1f389}", "a split after {split} byte(s) must still yield the character");
    }
}

#[test]
fn genuinely_invalid_bytes_are_still_replaced() {
    let mut demuxer = StreamDemuxer::new();
    // FF can never begin a UTF-8 sequence. Holding it would stall the stream
    // forever waiting for a continuation that cannot come.
    let events = demuxer.process_bytes(b"ok\xff");
    assert_eq!(text_of(&events), "ok\u{fffd}", "malformed input must not accumulate");
}

#[test]
fn a_character_split_before_an_escape_is_not_held_past_it() {
    let mut demuxer = StreamDemuxer::new();
    // A truncated character followed by an ESC is malformed input, not a read
    // boundary. Holding it here would reorder text against the event.
    let events = demuxer.process_bytes(b"text\xc3\x1b]133;C\x07");
    assert!(events.iter().any(|e| matches!(e, DemuxEvent::ExecutionStart)));
    assert!(text_of(&events).starts_with("text"), "text must still precede the event");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path crates/doom-term-pty/Cargo.toml demuxer`
Expected: FAIL. `a_multibyte_character_split_across_reads_survives` reports `caf\u{fffd}` against `caf`; the emoji case fails at every split offset.

- [ ] **Step 3: Add the carry field to the demuxer**

In `crates/doom-term-pty/src/demuxer.rs`, add a field to `StreamDemuxer` (after `pending_responses` at `:38`):

```rust
    /// Trailing bytes of a UTF-8 sequence that the last read cut in half.
    /// At most three, since no sequence is longer than four bytes.
    utf8_tail: Vec<u8>,
```

And initialise it in `new()` (after `pending_responses: Vec::new(),` at `:52`):

```rust
            utf8_tail: Vec::new(),
```

- [ ] **Step 4: Add the split helper**

Add this free function immediately above `impl StreamDemuxer` in `crates/doom-term-pty/src/demuxer.rs`:

```rust
/// Accumulated output bytes to a renderable String, holding back any trailing
/// INCOMPLETE UTF-8 sequence for the next read to finish.
///
/// A PTY read ends on an arbitrary byte boundary (8192 bytes, `session.rs`), so
/// a multi-byte character routinely straddles two reads. `from_utf8_lossy`
/// turns each half into U+FFFD and the character is lost — the same end-of-read
/// hazard this demuxer already tracks for ESC, left unhandled for UTF-8 until
/// 2026-08-29. Nerd Font icons and box drawing made it visible constantly.
///
/// Only genuinely incomplete trailing bytes are held. Bytes that can never
/// begin or continue a sequence are still replaced, because malformed input
/// must not accumulate forever waiting for a continuation that cannot come.
fn take_output(chunk: &mut Vec<u8>, tail: &mut Vec<u8>) -> String {
    let split = match std::str::from_utf8(chunk) {
        Ok(_) => chunk.len(),
        // `error_len() == None` means the input ENDED mid-sequence: hold it.
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        // A real encoding error: mark it and move on.
        Err(_) => chunk.len(),
    };
    *tail = chunk.split_off(split);
    let text = String::from_utf8_lossy(chunk).to_string();
    chunk.clear();
    text
}
```

- [ ] **Step 5: Seed each read from the carry, and hold on the final flush**

In `process_bytes`, replace the accumulator initialisation at `demuxer.rs:78`:

```rust
        let mut output_chunk = Vec::new();
```

with:

```rust
        // Whatever the last read cut in half rejoins the front of this one.
        let mut output_chunk = std::mem::take(&mut self.utf8_tail);
```

Then replace the final flush at `demuxer.rs:233-237`:

```rust
        if !output_chunk.is_empty() {
            events.push(DemuxEvent::Output {
                data: String::from_utf8_lossy(&output_chunk).to_string(),
            });
        }
```

with:

```rust
        if !output_chunk.is_empty() {
            let data = take_output(&mut output_chunk, &mut self.utf8_tail);
            // A read that was nothing but the head of a split character emits
            // no event at all — the bytes are held, not dropped.
            if !data.is_empty() {
                events.push(DemuxEvent::Output { data });
            }
        }
```

Leave the three mid-chunk flushes at `:133`, `:161` and `:172` exactly as they are — see the design note above.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test --manifest-path crates/doom-term-pty/Cargo.toml`
Expected: PASS, all tests including the pre-existing 48.

- [ ] **Step 7: Commit**

```bash
git add crates/doom-term-pty/src/demuxer.rs
git commit -m "fix(pty): rejoin UTF-8 characters split across read boundaries"
```

---

### Task 2: Cell metrics and grid arithmetic

Pure geometry, split out from the DOM so every branch is testable without a canvas — the same discipline `keyToBytes` follows in `RawTerminalView.tsx:25`. jsdom returns `null` from `getContext('2d')`, so the measuring wrapper must survive that too.

**Files:**
- Create: `src/core/cellMetrics.ts`
- Test: `src/core/cellMetrics.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface CellMetrics { width: number; height: number }`, `interface GridSize { cols: number; rows: number }`, `quantizeCell(rawWidth: number, rawHeight: number): CellMetrics`, `gridSize(widthPx: number, heightPx: number, cell: CellMetrics): GridSize`, `measureCell(el: HTMLElement): CellMetrics`. Task 4 consumes `gridSize`, `measureCell` and `GridSize`.

- [ ] **Step 1: Write the failing test**

Create `src/core/cellMetrics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { quantizeCell, gridSize } from './cellMetrics';

describe('quantizeCell', () => {
  it('floors a fractional advance so it cannot drift across a row', () => {
    // At 7.2px per cell an 80-column row is 16px wider than 80 whole cells,
    // which is a full column of drift by the right margin.
    expect(quantizeCell(7.2, 15.6)).toEqual({ width: 7, height: 15 });
  });

  it('never returns a zero dimension, which would divide by zero downstream', () => {
    expect(quantizeCell(0, 0)).toEqual({ width: 1, height: 1 });
    expect(quantizeCell(0.4, 0.9)).toEqual({ width: 1, height: 1 });
  });
});

describe('gridSize', () => {
  const cell = { width: 7, height: 15 };

  it('floors, because a partly visible column is one the shell wraps into', () => {
    expect(gridSize(703, 452, cell)).toEqual({ cols: 100, rows: 30 });
  });

  it('clamps to a floor an agent CLI can do arithmetic on', () => {
    expect(gridSize(10, 10, cell)).toEqual({ cols: 20, rows: 4 });
  });

  it('reports a real grid for an ordinary pane', () => {
    expect(gridSize(1400, 900, cell)).toEqual({ cols: 200, rows: 60 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/cellMetrics.test.ts`
Expected: FAIL with "Failed to resolve import ./cellMetrics".

- [ ] **Step 3: Write the implementation**

Create `src/core/cellMetrics.ts`:

```ts
/**
 * Terminal cell geometry.
 *
 * Kept pure and separate from the DOM so every branch tests without a canvas —
 * jsdom has no 2D context at all. `measureCell` is the only part that touches
 * the document, and it degrades rather than throwing.
 */

export interface CellMetrics {
  width: number;
  height: number;
}

export interface GridSize {
  cols: number;
  rows: number;
}

/**
 * A grid smaller than this is one an agent CLI cannot draw into: they divide by
 * `$COLUMNS`, subtract fixed margins from it, and emit negative padding or a
 * division by zero when the answer goes non-positive.
 */
const MIN_COLS = 20;
const MIN_ROWS = 4;

/** Measured over a run of this many glyphs; one glyph's advance rounds badly. */
const SAMPLE_LEN = 100;

/** Used when there is no 2D context to measure with, as in jsdom. */
const FALLBACK: CellMetrics = { width: 8, height: 16 };

/**
 * Integer cell metrics. A monospace advance is rarely a whole number of pixels
 * at a given size, and the fraction accumulates: quantize once here so every
 * consumer shares one integer rather than each rounding its own way.
 */
export function quantizeCell(rawWidth: number, rawHeight: number): CellMetrics {
  return {
    width: Math.max(1, Math.floor(rawWidth)),
    height: Math.max(1, Math.floor(rawHeight)),
  };
}

/**
 * Pixels to a terminal grid. Floor, never round: a partly visible column is one
 * the shell would wrap text into and the reader cannot see.
 */
export function gridSize(widthPx: number, heightPx: number, cell: CellMetrics): GridSize {
  return {
    cols: Math.max(MIN_COLS, Math.floor(widthPx / cell.width)),
    rows: Math.max(MIN_ROWS, Math.floor(heightPx / cell.height)),
  };
}

/**
 * Measure the cell of the font an element actually renders with.
 *
 * Returns a usable fallback rather than throwing when there is no 2D context,
 * because a terminal that opens at a slightly wrong size beats one that does
 * not open.
 */
export function measureCell(el: HTMLElement): CellMetrics {
  const style = getComputedStyle(el);
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return FALLBACK;

  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const width = ctx.measureText('M'.repeat(SAMPLE_LEN)).width / SAMPLE_LEN;

  // `line-height: normal` does not parse to a number; fall back to the ratio
  // browsers use for it.
  const lineHeight = parseFloat(style.lineHeight);
  const fontSize = parseFloat(style.fontSize);
  const height = Number.isFinite(lineHeight) ? lineHeight : fontSize * 1.2;

  if (!Number.isFinite(width) || width <= 0) return FALLBACK;
  return quantizeCell(width, height);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/core/cellMetrics.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/cellMetrics.ts src/core/cellMetrics.test.ts
git commit -m "feat(terminal): add integer cell metrics and grid arithmetic"
```

---

### Task 3: Resize one session's emulator, not all of them

`resizeEmulators(cols, rows)` (`emulatorRegistry.ts:35-39`) resizes *every* emulator to one size and mutates a module-level default. That is wrong the moment two panes in a split differ, which is the normal case. It also has zero callers today, so there is no migration to do — only a replacement.

**Files:**
- Modify: `src/core/emulatorRegistry.ts:12-13, 35-39`
- Test: `src/core/emulatorRegistry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `resizeEmulator(sessionId: string, cols: number, rows: number): void`. Task 6 calls it. `resizeEmulators` (plural) is removed.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('emulator registry', ...)` block in `src/core/emulatorRegistry.test.ts`:

```ts
  it('resizes one session without touching another', () => {
    // A split grid holds panes of different sizes. The old global form resized
    // every emulator to whichever pane reported last.
    resizeEmulator('narrow', 20, 4);
    resizeEmulator('wide', 200, 50);

    getEmulator('narrow').write('x'.repeat(25));
    getEmulator('wide').write('y'.repeat(25));

    expect(text(getEmulator('narrow').getLines()).length).toBe(2);
    expect(text(getEmulator('wide').getLines()).length).toBe(1);
  });
```

Add `resizeEmulator` to the import on line 2:

```ts
import { getEmulator, disposeEmulator, resetAllEmulators, resizeEmulator } from './emulatorRegistry';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/emulatorRegistry.test.ts`
Expected: FAIL with "resizeEmulator is not a function".

- [ ] **Step 3: Replace the global resize with a per-session one**

In `src/core/emulatorRegistry.ts`, replace lines 12-13:

```ts
let defaultCols = 120;
let defaultRows = 30;
```

with:

```ts
/**
 * The grid a session starts on, for the frame between mount and the pane
 * reporting its real size. `resizeEmulator` corrects it immediately; nothing
 * should ever render at these numbers.
 *
 * Exported because the PTY must be spawned at the same numbers the emulator
 * assumes — the two disagreeing is a shell wrapping at one width against a grid
 * of another.
 */
export const BOOTSTRAP_COLS = 120;
export const BOOTSTRAP_ROWS = 30;
```

Update the constructor call inside `getEmulator` (`:25`) to use them:

```ts
    emu = new TerminalEmulator({ cols: BOOTSTRAP_COLS, rows: BOOTSTRAP_ROWS, events: sharedEvents });
```

Then replace `resizeEmulators` (`:35-39`) with:

```ts
/**
 * Resize one session's grid.
 *
 * Per session, not global: two panes in a split are different sizes, and the
 * previous global form resized every emulator to whichever pane reported last.
 */
export function resizeEmulator(sessionId: string, cols: number, rows: number): void {
  getEmulator(sessionId).resize(cols, rows);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/core/emulatorRegistry.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Confirm nothing referenced the removed export**

Run: `grep -rn "resizeEmulators" src/`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/core/emulatorRegistry.ts src/core/emulatorRegistry.test.ts
git commit -m "refactor(terminal): resize emulators per session rather than globally"
```

---

### Task 4: The `useTerminalSize` hook

Observes a pane's grid area and pushes the derived size to both the emulator and the PTY. jsdom has no `ResizeObserver`, so the test installs a stub that captures the callback and fires it on demand.

**Files:**
- Create: `src/hooks/useTerminalSize.ts`
- Test: `src/hooks/useTerminalSize.test.ts`

**Interfaces:**
- Consumes: `gridSize`, `measureCell`, `GridSize` from `src/core/cellMetrics.ts` (Task 2); `resizeEmulator` from `src/core/emulatorRegistry.ts` (Task 3); `ptyClient.resizeSession(sessionId, cols, rows)` from `src/core/ptyClient.ts:354`.
- Produces: `useTerminalSize(ref: React.RefObject<HTMLElement | null>, sessionId: string | null): void`. Tasks 5 and 6 call it.

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useTerminalSize.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTerminalSize } from './useTerminalSize';
import { ptyClient } from '../core/ptyClient';
import { resizeEmulator } from '../core/emulatorRegistry';

vi.mock('../core/ptyClient', () => ({
  ptyClient: { resizeSession: vi.fn() },
}));
vi.mock('../core/emulatorRegistry', () => ({
  resizeEmulator: vi.fn(),
}));
// jsdom has no canvas, so pin the cell instead of measuring one.
vi.mock('../core/cellMetrics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/cellMetrics')>()),
  measureCell: () => ({ width: 7, height: 15 }),
}));

let fire: (() => void) | null = null;

class StubResizeObserver {
  constructor(cb: () => void) {
    fire = cb;
  }
  observe() {}
  disconnect() {}
}

function paneOf(width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
  return el;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
  // The hook coalesces on a frame; run the callback immediately in tests.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.clearAllMocks();
  fire = null;
});

afterEach(() => vi.unstubAllGlobals());

describe('useTerminalSize', () => {
  it('reports the measured grid to both the PTY and the emulator on mount', () => {
    const ref = { current: paneOf(700, 450) };
    renderHook(() => useTerminalSize(ref, 'session-1'));

    expect(ptyClient.resizeSession).toHaveBeenCalledWith('session-1', 100, 30);
    expect(resizeEmulator).toHaveBeenCalledWith('session-1', 100, 30);
  });

  it('does not resend an unchanged size', () => {
    const ref = { current: paneOf(700, 450) };
    renderHook(() => useTerminalSize(ref, 'session-1'));
    expect(ptyClient.resizeSession).toHaveBeenCalledTimes(1);

    // A repaint that does not change the grid must not cost a SIGWINCH: every
    // one of those makes a running agent redraw itself.
    fire?.();
    expect(ptyClient.resizeSession).toHaveBeenCalledTimes(1);
  });

  it('reports again when the grid actually changes', () => {
    const el = paneOf(700, 450);
    const ref = { current: el };
    renderHook(() => useTerminalSize(ref, 'session-1'));

    Object.defineProperty(el, 'clientWidth', { value: 350, configurable: true });
    fire?.();

    expect(ptyClient.resizeSession).toHaveBeenLastCalledWith('session-1', 50, 30);
  });

  it('does nothing for a pane with no session, such as a scratchpad', () => {
    const ref = { current: paneOf(700, 450) };
    renderHook(() => useTerminalSize(ref, null));

    expect(ptyClient.resizeSession).not.toHaveBeenCalled();
    expect(resizeEmulator).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/hooks/useTerminalSize.test.ts`
Expected: FAIL with "Failed to resolve import ./useTerminalSize".

- [ ] **Step 3: Write the implementation**

Create `src/hooks/useTerminalSize.ts`:

```ts
import { useEffect, useRef } from 'react';
import { gridSize, measureCell, type GridSize } from '../core/cellMetrics';
import { resizeEmulator } from '../core/emulatorRegistry';
import { ptyClient } from '../core/ptyClient';

/**
 * Keep one session's grid matched to the pane that shows it.
 *
 * Until 2026-08-29 nothing called this: sessions were spawned at a hardcoded
 * 120x30 and never resized, so SIGWINCH never fired and every agent CLI wrapped
 * its output and sized its frames for 120 columns whatever the window was
 * actually doing. `resizeEmulators` and `ptyClient.resize` both existed with
 * zero callers.
 *
 * Pass `sessionId: null` for a pane that owns no PTY, such as a scratchpad.
 */
export function useTerminalSize(
  ref: React.RefObject<HTMLElement | null>,
  sessionId: string | null,
): void {
  const last = useRef<GridSize | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !sessionId) return;

    last.current = null;
    let frame = 0;

    const apply = () => {
      frame = 0;
      const next = gridSize(el.clientWidth, el.clientHeight, measureCell(el));
      // A no-op resize is not free: each one is a SIGWINCH, and a running agent
      // answers it by redrawing its whole frame. Only report real changes.
      if (last.current && last.current.cols === next.cols && last.current.rows === next.rows) {
        return;
      }
      last.current = next;
      resizeEmulator(sessionId, next.cols, next.rows);
      ptyClient.resizeSession(sessionId, next.cols, next.rows);
    };

    // A drag emits a resize per frame; coalesce so one gesture is one SIGWINCH.
    const observer = new ResizeObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(apply);
    });
    observer.observe(el);
    apply();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [ref, sessionId]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/hooks/useTerminalSize.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useTerminalSize.ts src/hooks/useTerminalSize.test.ts
git commit -m "feat(terminal): add useTerminalSize to drive PTY and emulator resize"
```

---

### Task 5: Extract `BlockPane` from `App.tsx`

`renderSessionPane` (`App.tsx:292`) is a plain function, not a component, so a hook cannot be called inside it — it runs conditionally and more than once per render in a split layout. The block branch therefore has nowhere to put `useTerminalSize`. Extracting it into a real component is what makes Task 6 legal, and `App.tsx` is 488 lines with this function carrying three different pane types.

This task is a pure move: no behaviour changes, so the existing tests are the check.

**Files:**
- Create: `src/components/BlockPane.tsx`
- Modify: `src/App.tsx:335-...` (the final `return` of `renderSessionPane`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `BlockPane` component with props
  `{ node: SessionNode; isActive: boolean; scrollContainerRef: React.RefObject<HTMLDivElement | null>; scrollDetached: boolean; onScroll: () => void; onSnapToBottom: () => void; onExecute: (cmd: string) => void; onApplyDiff: (file: string) => void; onOpenHistory: () => void }`.
  Task 6 adds the sizing to this component.

The prop list is exactly the set of values the moved JSX closes over today:
`scrollContainerRef` (`App.tsx:65`), `handleScroll` (`:185`), `scrollDetached`
(`:64`), `handleSnapToBottom` (`:201`), `handleExecuteCommand` (`:250`),
`executeFinalCommand` (`:210`, narrowed to `onApplyDiff`) and `setIsPaletteOpen`
(narrowed to `onOpenHistory`). `ptyClient`, `Block` and `CommandEditor` are
module imports and stay imports.

- [ ] **Step 1: Create the component**

Create `src/components/BlockPane.tsx`:

```tsx
import React from 'react';
import { Block } from './Block';
import { CommandEditor } from './CommandEditor';
import { ptyClient } from '../core/ptyClient';
import { SessionNode } from '../types/sessionTree';

export interface BlockPaneProps {
  node: SessionNode;
  isActive: boolean;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  scrollDetached: boolean;
  onScroll: () => void;
  onSnapToBottom: () => void;
  onExecute: (cmd: string) => void;
  onApplyDiff: (file: string) => void;
  onOpenHistory: () => void;
}

/**
 * The block view of a session.
 *
 * A real component rather than a branch of `renderSessionPane`, because a pane
 * has to run hooks: `useTerminalSize` cannot be called from a function that
 * runs conditionally and twice over in a split layout.
 */
export const BlockPane: React.FC<BlockPaneProps> = ({
  node,
  isActive,
  scrollContainerRef,
  scrollDetached,
  onScroll,
  onSnapToBottom,
  onExecute,
  onApplyDiff,
  onOpenHistory,
}) => {
  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* Blocks Scroll Area */}
      <div
        ref={isActive ? scrollContainerRef : undefined}
        onScroll={isActive ? onScroll : undefined}
        className="flex-1 overflow-y-auto px-2 py-1 space-y-1.5 min-h-0"
      >
        {node.blocks.length === 0 ? (
          <div className="text-[12px] p-2 select-none" style={{ color: 'var(--ink-dim)' }}>
            Type a command below to execute.
          </div>
        ) : (
          node.blocks.map((block) => (
            <Block key={block.id} block={block} onApplyDiff={onApplyDiff} />
          ))
        )}
      </div>

      {/* Scroll Detached Indicator */}
      {isActive && scrollDetached && (
        <div className="flex justify-center my-1 select-none">
          <button
            onClick={onSnapToBottom}
            className="plate px-3 py-0.5 text-[11px] font-bold tracking-wider animate-pulse"
            style={{ color: 'var(--ink-plate)' }}
          >
            [SCROLL DETACHED — PRESS SPACE TO RESUME]
          </button>
        </div>
      )}

      {/* Bottom Command Editor */}
      <div className="mt-auto px-2 pb-1.5 pt-1">
        <CommandEditor
          onExecute={onExecute}
          onSendSignal={(sig) => ptyClient.sendSignalToSession(node.id, sig)}
          onOpenHistory={onOpenHistory}
          history={node.commandHistory}
          currentDir={node.cwd}
          gitBranch={node.gitBranch}
          isRunning={node.agentState === 'running'}
        />
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Replace the branch in `App.tsx` with the component**

In `src/App.tsx`, add the import alongside the other component imports (near `:11-15`):

```tsx
import { BlockPane } from './components/BlockPane';
```

Replace the whole final `return (...)` of `renderSessionPane` — lines `335-384` — with:

```tsx
    return (
      <BlockPane
        node={node}
        isActive={isActive}
        scrollContainerRef={scrollContainerRef}
        scrollDetached={scrollDetached}
        onScroll={handleScroll}
        onSnapToBottom={handleSnapToBottom}
        onExecute={handleExecuteCommand}
        onApplyDiff={(file) => executeFinalCommand(`git apply ${file}`)}
        onOpenHistory={() => setIsPaletteOpen(true)}
      />
    );
```

- [ ] **Step 3: Remove imports that `App.tsx` no longer uses**

`Block` and `CommandEditor` moved out. Check whether `App.tsx` still references
them anywhere else before deleting their imports:

Run: `grep -n "<Block\b\|<CommandEditor" src/App.tsx`
Expected: no output. If so, delete those two import lines. `tsc --noEmit` in
Step 4 catches it either way — `noUnusedLocals` is not on, so this is a
tidiness step, not a correctness one.

- [ ] **Step 4: Verify the move changed nothing**

Run: `npx tsc --noEmit`
Expected: no errors. A missing prop surfaces here — that is the check that Step 1 was complete.

Run: `npm test`
Expected: PASS, the whole suite as before.

- [ ] **Step 5: Commit**

```bash
git add src/components/BlockPane.tsx src/App.tsx
git commit -m "refactor(ui): extract BlockPane so a pane can run hooks"
```

---

### Task 6: Wire sizing into both panes and spawn at a real size

Both views of a session get the hook, on the element that actually holds the character grid. The guard in Task 4 means switching between them costs no `SIGWINCH` unless the grid genuinely differs.

**Files:**
- Modify: `src/components/RawTerminalView.tsx:6-16` (props), `:93` (refs), and the props destructure at `:84-92`
- Modify: `src/components/BlockPane.tsx` (from Task 5)
- Modify: `src/App.tsx:313` (pass `sessionId`)
- Modify: `src/core/ptyClient.ts:101`, `src/hooks/useWorkspaceSet.ts:97` (spawn size)
- Test: `src/components/RawTerminalView.test.tsx`

**Interfaces:**
- Consumes: `useTerminalSize` from Task 4; `BlockPane` from Task 5.
- Produces: `RawTerminalView` gains an optional `sessionId?: string | null` prop, defaulting to `null`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/RawTerminalView.test.tsx`:

```tsx
it('reports its grid size for the session it belongs to', () => {
  const spy = vi.spyOn(ptyClient, 'resizeSession').mockImplementation(() => {});
  render(
    <RawTerminalView
      lines={[]}
      sessionId="session-1"
      onWrite={() => {}}
      onSendSignal={() => {}}
    />,
  );
  expect(spy).toHaveBeenCalledWith('session-1', expect.any(Number), expect.any(Number));
  spy.mockRestore();
});
```

Add to the imports at the top of that file, if not already present:

```tsx
import { vi } from 'vitest';
import { ptyClient } from '../core/ptyClient';
```

jsdom has no `ResizeObserver`; add this above the new test so the component can mount:

```tsx
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/RawTerminalView.test.tsx`
Expected: FAIL — `resizeSession` is never called, because the component does not size itself yet.

- [ ] **Step 3: Size the pass-through view**

In `src/components/RawTerminalView.tsx`, add to `RawTerminalViewProps` (after `isActive` at `:15`):

```tsx
  /** The session whose grid this pane sizes. Null for a view with no PTY. */
  sessionId?: string | null;
```

Add `sessionId = null,` to the props destructure (after `isActive = true,` at `:91`), and add the import plus the hook call. The observed element is `scrollRef` — the container that holds the character grid at `:231-234`, not the outer box, because the header plate above it is chrome and not part of the grid:

```tsx
import { useTerminalSize } from '../hooks/useTerminalSize';
```

```tsx
  // Size from the grid container, not the outer box: the header plate above it
  // is chrome, and counting it would hand the shell more rows than it can show.
  useTerminalSize(scrollRef, sessionId);
```

Place the hook call immediately after the `useLayoutEffect` at `:109-111`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/RawTerminalView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Pass the session id from `App.tsx`**

In `src/App.tsx`, add to the `RawTerminalView` element at `:313`:

```tsx
          sessionId={node.id}
```

- [ ] **Step 6: Size the block view**

In `src/components/BlockPane.tsx`, add a ref for the blocks scroll area and call the hook on it. The existing `scrollContainerRef` is bound conditionally on `isActive`, so it cannot serve — add a second, unconditional ref on the same element:

Change the existing React import and add the hook import:

```tsx
import React, { useRef } from 'react';
import { useTerminalSize } from '../hooks/useTerminalSize';
```

Then, inside the component body above the `return`:

```tsx
  // The shell wraps at $COLUMNS whichever view is showing, so the block pane
  // has to report a size too. Unconditional, unlike scrollContainerRef, which
  // is only bound for the active pane.
  const gridRef = useRef<HTMLDivElement | null>(null);
  useTerminalSize(gridRef, node.id);
```

Bind it on the blocks scroll area alongside the existing ref:

```tsx
        <div
          ref={(el) => {
            gridRef.current = el;
            if (isActive) scrollContainerRef.current = el;
          }}
          onScroll={isActive ? onScroll : undefined}
          className="flex-1 overflow-y-auto px-2 py-1 space-y-1.5 min-h-0"
        >
```

- [ ] **Step 7: Spawn at a measured size instead of 120×30**

The hook corrects the size within a frame of mount, but the shell prints its first prompt before that. Spawn at the same bootstrap the emulator uses so the two agree, and let the hook correct both together.

In `src/core/ptyClient.ts:101`, replace:

```ts
    this.spawnSession(id, 120, 30, cwd);
```

with:

```ts
    // The pane corrects this within a frame of mount via useTerminalSize; these
    // are only what the shell sees for its first prompt.
    this.spawnSession(id, BOOTSTRAP_COLS, BOOTSTRAP_ROWS, cwd);
```

In `src/hooks/useWorkspaceSet.ts:97`, replace:

```ts
      ptyClient.spawnSession(newNodeId, 120, 30, newNode.cwd);
```

with:

```ts
      ptyClient.spawnSession(newNodeId, BOOTSTRAP_COLS, BOOTSTRAP_ROWS, newNode.cwd);
```

Task 3 already exported both constants from `src/core/emulatorRegistry.ts`. Import them in each file:

```ts
import { BOOTSTRAP_COLS, BOOTSTRAP_ROWS } from './emulatorRegistry';
```

(in `useWorkspaceSet.ts` the path is `'../core/emulatorRegistry'`)

Also drop the now-misleading defaults on the `spawnSession` signature at `ptyClient.ts:307`:

```ts
  public spawnSession(id: string, cols: number, rows: number, cwd?: string, shell?: string) {
```

- [ ] **Step 8: Remove the dead `resize` wrapper**

`ptyClient.resize(cols, rows)` (`:361-363`) resizes whatever session happens to be active, which is the wrong unit now that every pane reports its own. It has no callers. Delete it.

Run: `grep -rn "ptyClient.resize(" src/`
Expected: no output.

- [ ] **Step 9: Verify the whole suite**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/components/RawTerminalView.tsx src/components/RawTerminalView.test.tsx \
        src/components/BlockPane.tsx src/App.tsx \
        src/core/ptyClient.ts src/core/emulatorRegistry.ts src/hooks/useWorkspaceSet.ts
git commit -m "feat(terminal): size every session from its pane instead of a fixed 120x30"
```

---

### Task 7: Correct the README's render-path claim

`README.md:99` and `:155` advertise a "Dual-Mode WebGL / Canvas2D Fallback" with "automatic fallback if WebGL contexts crash". No WebGL terminal renderer exists — the terminal renders as DOM spans (`RawTerminalView.tsx:235-244`). The only canvas in the tree draws the HUD plate.

**Files:**
- Modify: `README.md:99, 155-156`

**Interfaces:** none.

- [ ] **Step 1: Read the surrounding sections**

Run: `sed -n '90,110p;150,160p' README.md`

Note the numbering and heading style so the replacement matches its neighbours.

- [ ] **Step 2: Replace the architecture-list entry**

At `README.md:99`, replace:

```
        C14[14. Dual-Mode WebGL / Canvas2D Fallback]
```

with:

```
        C14[14. DOM Span Renderer with Integer Cell Metrics]
```

- [ ] **Step 3: Replace the section body**

At `README.md:155-156`, replace:

```
### 14. Dual-Mode WebGL / Canvas2D Fallback
* High-reliability rendering with automatic fallback if WebGL contexts crash or are unavailable in headless environments.
```

with:

```
### 14. DOM Span Renderer with Integer Cell Metrics
* Terminal output renders as styled DOM spans, one run per attribute change. Cell width and height are measured from the rendered font and quantized to whole pixels, so a fractional advance cannot accumulate into a column of drift across a row.
* The HUD plate is the only canvas surface in the application.
```

- [ ] **Step 4: Verify no other stale render claims remain**

Run: `grep -n -i "webgl\|gpu" README.md`
Expected: only the line at `:53`, which is example text inside a mocked-up agent prompt, not a capability claim. Leave it.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: describe the renderer that exists, not a WebGL path that does not"
```

---

## Verification

After Task 7, confirm the stage end to end.

- [ ] `cargo test --manifest-path crates/doom-term-pty/Cargo.toml` — all pass
- [ ] `npx tsc --noEmit` — no errors
- [ ] `npm test` — all pass
- [ ] Live check, per `doom-term-two-tabs-fight-over-sessions`: **close every duplicate browser tab first**, shared `localStorage` manufactures phantom bugs. Then start the app, open a terminal, and run `echo $COLUMNS && echo $LINES`. The numbers must match the pane, and must change when the window is resized. Before this stage they were always 120 and 30.
- [ ] Live check: `printf 'caf\xc3\xa9 \xf0\x9f\x8e\x89\n'` renders `café 🎉` with no replacement characters.
