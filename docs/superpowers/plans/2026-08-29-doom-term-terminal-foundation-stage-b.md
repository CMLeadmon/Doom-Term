# Terminal Foundation Stage B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-written `terminalEmulator.ts` with `@xterm/headless` so Doom Term stops maintaining a VT emulator, and gets a real character-width model in the bargain.

**Architecture:** Extract the surface the app already consumes as a `TerminalScreen` interface, implement it over `@xterm/headless`, prove the new implementation against the existing emulator's own test corpus, then delete 858 lines. The Doom palette, the `AnsiLine`/`AnsiSpan` model and the block UI are untouched — only parsing is replaced. xterm parses asynchronously, so the per-chunk React update in `usePtyEvents` becomes a coalesced per-frame update; that is forced, not optional.

**Tech Stack:** `@xterm/headless@6.0.0`, `@xterm/addon-unicode11@0.9.0`, TypeScript, React 19, Vitest with jsdom.

**Spec:** `docs/superpowers/specs/2026-08-29-doom-term-terminal-foundation-design.md` (Stage B). Stage A shipped in `41583fb..c680358`.

## Global Constraints

- **Never copy nodeterm source.** nodeterm is BUSL-1.1, Doom Term is MIT. Techniques are free; code and comments are not. `@xterm/*` is MIT and carries none of this.
- **Every non-obvious fix carries a comment naming the failure that motivated it.**
- **No game vocabulary** in any user-visible string.
- `new Terminal({ allowProposedApi: true })` is **required** — `registerMarker` and the unicode API are proposed API and throw without it.
- **`term.write()` is asynchronous.** Never read the buffer on the line after a write. Every read follows the write callback. This is the single most common way to get this wrong.
- xterm attribute predicates (`isBold()`, `isInverse()`, …) return **numbers**, not booleans. Coerce with `!!` before putting them in an `AnsiSpan`.
- TS tests: `npx vitest run <path>` for one file; `npm test` for everything. Typecheck with `npx tsc --noEmit`.

## Already done, before Task 1

The B0 feasibility spike from the design doc **has been run and passed** (2026-08-29). Findings, all verified under Vite + jsdom in this repo:

| Question | Answer |
|---|---|
| Does `@xterm/headless` import and parse in the browser bundle? | **Yes.** No fallback to `@xterm/xterm` needed. |
| Does `Unicode11Addon` load onto *headless*? | **Yes.** `🎉` is width 1 without it, width 2 with it — the exact live defect. |
| Does `buffer.type` track alt-screen? | Yes: `'normal'` / `'alternate'`. |
| Is `registerMarker(0).line` stable as the buffer scrolls? | Yes. |
| Is `write()` synchronous? | **No.** Reads must follow the write callback. |

`@xterm/headless@6.0.0` and `@xterm/addon-unicode11@0.9.0` are **already installed** — `package.json` and `package-lock.json` are modified in the working tree. Task 1 commits them.

## Explicitly out of scope

The design doc's B5 had two halves. **Coalescing updates is in this plan** — async parsing forces it. **Returning only the viewport is not.** That changes the scroll authority from the DOM container to xterm's viewport and removes `RawTerminalView`'s tail-follow (`RawTerminalView.tsx:109`), which is a UI change deserving its own plan. Coalescing alone removes the per-chunk update storm; virtualization is about DOM node count and comes next.

---

### Task 1: Extract the seam and the palette, delete confirmed-dead code

Three things the app consumes today live inside the file being deleted, and three things in it are provably dead. Separating them first makes the swap a contained change rather than a rewrite.

**Dead code, verified by grep this session:**
- `configureEmulators` (`emulatorRegistry.ts:28`) has **zero callers**, so `sharedEvents` is always `{}` and every `TerminalEvents` callback — `onCwd`, `onTitle`, `onPromptStart`, `onCommandStart`, `onExecutionStart`, `onExecutionEnd`, `onAgentState`, `onAltScreen`, `onBell` — never fires. The Rust demuxer supplies all of those as `DemuxEvent`s instead. The whole interface goes.
- `src/core/ansiParser.ts` has **zero consumers** (the only grep hit is a string literal inside a test assertion), and with it `renderAnsiText`.

**Files:**
- Create: `src/core/palette.ts`, `src/core/terminalScreen.ts`
- Modify: `src/core/terminalEmulator.ts` (remove palette exports, `TerminalEvents`, `renderAnsiText`), `src/core/emulatorRegistry.ts`, `src/core/terminalEmulator.test.ts` (import path)
- Delete: `src/core/ansiParser.ts`
- Test: existing suites must stay green; no new tests.

**Interfaces:**
- Produces: `src/core/palette.ts` exporting `DOOM_PALETTE`, `parse256Color(index: number): string`, `looksLikeError(text: string): boolean`. `src/core/terminalScreen.ts` exporting `interface TerminalScreen`. Tasks 2, 3, 5 consume both.

- [ ] **Step 1: Move the palette out of the file being deleted**

Create `src/core/palette.ts` and move `DOOM_PALETTE`, `STANDARD_COLORS`, `BRIGHT_COLORS`, `parse256Color`, `ERROR_PATTERNS` and `looksLikeError` into it **verbatim** from `terminalEmulator.ts:1-79`, keeping every comment. Add a header:

```ts
/**
 * The Doom palette and the error heuristic.
 *
 * Extracted from terminalEmulator.ts so both screen implementations can share
 * them, and so they survive that file's deletion. The colours are calibrated
 * for WCAG 2.1 AA against --ground; do not adjust one without re-checking it.
 */
```

Then in `terminalEmulator.ts`, delete those declarations and re-export from the new home so nothing breaks yet:

```ts
import { looksLikeError, parse256Color, STANDARD_COLORS, BRIGHT_COLORS } from './palette';
export { DOOM_PALETTE, parse256Color, looksLikeError } from './palette';
```

`STANDARD_COLORS` and `BRIGHT_COLORS` must be exported from `palette.ts` too, since `applySgr` uses them.

- [ ] **Step 2: Define the seam**

Create `src/core/terminalScreen.ts`:

```ts
import type { AnsiLine } from '../types/terminal';

/**
 * What the app needs from a terminal screen, independent of who parses.
 *
 * Extracted so `@xterm/headless` can be dropped in behind the existing
 * consumers rather than rewriting them, and so both implementations can be run
 * against the same tests while the swap is proven.
 */
export interface TerminalScreen {
  /**
   * Feed bytes. Parsing is ASYNCHRONOUS — the buffer is not updated when this
   * returns. Read only after `onParsed` fires.
   */
  write(data: string): void;

  /**
   * Fires after a batch of writes has been parsed, coalesced to at most one
   * call per frame. Returns an unsubscribe.
   */
  onParsed(cb: () => void): () => void;

  isAltScreen(): boolean;

  /**
   * An opaque handle to the cursor's current row, for `linesSince`. A plain
   * number because it is persisted on the block (`TerminalBlock.outputMark`).
   */
  mark(): number;

  getLines(): AnsiLine[];

  /** Rows from `mark` to the end. Falls back to everything if the mark is gone. */
  linesSince(mark: number): AnsiLine[];

  resize(cols: number, rows: number): void;
  reset(): void;
  dispose(): void;
}
```

- [ ] **Step 3: Delete the dead events interface and the dead parser**

In `terminalEmulator.ts`: delete `interface TerminalEvents`, the `events` field, the `events` option, and every `this.events.…?.()` call site. `handleOsc` keeps its OSC *swallowing* — the tests assert records never reach the screen — but its bodies become plain `return`s where they only fired an event.

In `emulatorRegistry.ts`: delete `configureEmulators`, `sharedEvents`, and the `events:` argument to the constructor.

Delete the file `src/core/ansiParser.ts`.

- [ ] **Step 4: Make `TerminalEmulator` satisfy the seam**

`TerminalEmulator` already has `write`, `isAltScreen`, `mark`, `getLines`, `linesSince`, `resize` and `reset` with compatible signatures. It needs two additions so it satisfies `TerminalScreen` and the tests can run against either implementation:

```ts
  /** Synchronous parser: the bytes are on screen before write() returns. */
  onParsed(cb: () => void): () => void {
    this.parsedListeners.add(cb);
    return () => this.parsedListeners.delete(cb);
  }

  dispose(): void {
    this.parsedListeners.clear();
  }
```

with `private parsedListeners = new Set<() => void>();` as a field, and at the end of `write()`:

```ts
    for (const cb of this.parsedListeners) cb();
```

Declare the class as implementing the interface: `export class TerminalEmulator implements TerminalScreen {`.

- [ ] **Step 5: Verify nothing broke**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all pass. The emulator's own suite is untouched behaviour, so any failure here is a bad move, not a real change.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/core/palette.ts src/core/terminalScreen.ts \
        src/core/terminalEmulator.ts src/core/terminalEmulator.test.ts src/core/emulatorRegistry.ts
git rm src/core/ansiParser.ts
git commit -m "refactor(terminal): extract the screen seam and palette, drop dead code"
```

---

### Task 2: Render an xterm buffer to `AnsiLine[]`

The conversion, as a pure function over a buffer, so it tests directly against a real `Terminal` without any of the wrapper's lifecycle. This is where the Unicode fix actually lands: a cell whose `getWidth()` is 0 is the trailing half of a wide character and must be skipped, or every emoji doubles.

**Files:**
- Create: `src/core/xtermLines.ts`
- Test: `src/core/xtermLines.test.ts`

**Interfaces:**
- Consumes: `parse256Color`, `looksLikeError` from `src/core/palette.ts` (Task 1); `AnsiLine`, `AnsiSpan` from `src/types/terminal.ts`.
- Produces: `linesFrom(buffer: IBuffer, startLine: number): AnsiLine[]`. Task 3 consumes it.

- [ ] **Step 1: Write the failing test**

Create `src/core/xtermLines.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Terminal } from '@xterm/headless';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { linesFrom } from './xtermLines';
import { DOOM_PALETTE } from './palette';

/** xterm parses on a scheduled callback, so every read must follow the write. */
const feed = (term: Terminal, data: string) =>
  new Promise<void>((resolve) => term.write(data, resolve));

const makeTerm = (cols = 40, rows = 10) => {
  const term = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 100 });
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = '11';
  return term;
};

const plain = (lines: { spans: { text: string }[] }[]) =>
  lines.map((l) => l.spans.map((s) => s.text).join(''));

describe('linesFrom', () => {
  it('renders plain text as a single span', async () => {
    const term = makeTerm();
    await feed(term, 'hello world');
    expect(plain(linesFrom(term.buffer.active, 0))[0]).toBe('hello world');
  });

  it('splits a run at each attribute change and maps the Doom palette', async () => {
    const term = makeTerm();
    await feed(term, 'plain \x1b[32mgreen\x1b[0m');
    const spans = linesFrom(term.buffer.active, 0)[0].spans;
    expect(spans[0].text).toBe('plain ');
    expect(spans[0].fg).toBeUndefined();
    expect(spans[1].text).toBe('green');
    expect(spans[1].fg).toBe(DOOM_PALETTE.green);
  });

  it('carries every attribute the span model has', async () => {
    const term = makeTerm();
    await feed(term, '\x1b[1;3;4;7;9;2mx');
    const s = linesFrom(term.buffer.active, 0)[0].spans[0];
    expect(s.bold).toBe(true);
    expect(s.italic).toBe(true);
    expect(s.underline).toBe(true);
    expect(s.invert).toBe(true);
    expect(s.strikethrough).toBe(true);
    expect(s.dim).toBe(true);
  });

  it('reads a 24-bit colour as rgb()', async () => {
    const term = makeTerm();
    await feed(term, '\x1b[38;2;10;20;30mx');
    expect(linesFrom(term.buffer.active, 0)[0].spans[0].fg).toBe('rgb(10, 20, 30)');
  });

  it('emits a wide character once, not twice', async () => {
    // The live defect: with no width model a two-cell glyph advanced one cell
    // and every column after it sheared.
    const term = makeTerm();
    await feed(term, '\u{1f389}A');
    expect(plain(linesFrom(term.buffer.active, 0))[0]).toBe('\u{1f389}A');
  });

  it('trims trailing blanks so a row is not full-width whitespace', async () => {
    const term = makeTerm();
    await feed(term, 'short');
    expect(plain(linesFrom(term.buffer.active, 0))[0]).toBe('short');
  });

  it('flags a line that announces a failure', async () => {
    const term = makeTerm();
    await feed(term, 'error: something broke');
    expect(linesFrom(term.buffer.active, 0)[0].isError).toBe(true);
  });

  it('does not flag an ordinary line that merely contains the word', async () => {
    const term = makeTerm();
    await feed(term, 'grep -rn error src/');
    expect(linesFrom(term.buffer.active, 0)[0].isError).toBe(false);
  });

  it('starts where it is told, for a block reading from its mark', async () => {
    const term = makeTerm();
    await feed(term, 'one\r\ntwo\r\nthree\r\n');
    expect(plain(linesFrom(term.buffer.active, 1))).toEqual(['two', 'three', '']);
  });

  it('gives every row a stable id for React to key on', async () => {
    const term = makeTerm();
    await feed(term, 'a\r\nb\r\n');
    const ids = linesFrom(term.buffer.active, 0).map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/xtermLines.test.ts`
Expected: FAIL with "Failed to resolve import ./xtermLines".

- [ ] **Step 3: Write the implementation**

Create `src/core/xtermLines.ts`:

```ts
import type { IBuffer, IBufferCell, IBufferLine } from '@xterm/headless';
import type { AnsiLine, AnsiSpan } from '../types/terminal';
import { looksLikeError, parse256Color } from './palette';

/**
 * An xterm buffer to the span model the block and raw views render.
 *
 * Pure and buffer-shaped rather than terminal-shaped so it tests against a
 * plain Terminal with no wrapper lifecycle in the way.
 */

type Attr = Omit<AnsiSpan, 'text'>;

/**
 * xterm reports colour three ways and the predicates are the stable API — the
 * raw mode constants are internal encoding. RGB arrives packed in one integer.
 */
function colourOf(cell: IBufferCell, fg: boolean): string | undefined {
  if (fg ? cell.isFgDefault() : cell.isBgDefault()) return undefined;
  const value = fg ? cell.getFgColor() : cell.getBgColor();
  if (fg ? cell.isFgPalette() : cell.isBgPalette()) return parse256Color(value);
  return `rgb(${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff})`;
}

/** xterm's attribute predicates return numbers, not booleans. */
function attrOf(cell: IBufferCell): Attr {
  return {
    fg: colourOf(cell, true),
    bg: colourOf(cell, false),
    bold: !!cell.isBold(),
    dim: !!cell.isDim(),
    italic: !!cell.isItalic(),
    underline: !!cell.isUnderline(),
    strikethrough: !!cell.isStrikethrough(),
    invert: !!cell.isInverse(),
  };
}

function sameAttr(a: Attr, b: Attr): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.invert === b.invert
  );
}

/** Last column holding anything worth drawing; trailing blanks carry no information. */
function lastInkedColumn(line: IBufferLine, probe: IBufferCell): number {
  for (let x = line.length - 1; x >= 0; x--) {
    const cell = line.getCell(x, probe);
    if (!cell) continue;
    if (cell.getWidth() === 0) continue;
    const chars = cell.getChars();
    if (chars !== '' && chars !== ' ') return x;
    if (!cell.isBgDefault()) return x;
  }
  return -1;
}

function lineToAnsi(line: IBufferLine, id: string, probe: IBufferCell): AnsiLine {
  const spans: AnsiSpan[] = [];
  let run: Attr | null = null;
  let text = '';

  const flush = () => {
    if (text.length === 0) return;
    spans.push({ text, ...(run ?? {}) });
    text = '';
  };

  const end = lastInkedColumn(line, probe);
  for (let x = 0; x <= end; x++) {
    const cell = line.getCell(x, probe);
    if (!cell) continue;
    // Width 0 is the trailing half of a wide character; its glyph already came
    // with the leading cell. Emitting it is how an emoji renders twice.
    if (cell.getWidth() === 0) continue;
    const attr = attrOf(cell);
    if (run === null || !sameAttr(run, attr)) {
      flush();
      run = attr;
    }
    // An untouched cell reports the empty string, not a space.
    text += cell.getChars() || ' ';
  }
  flush();

  const plain = spans.map((s) => s.text).join('');
  if (spans.length === 0) spans.push({ text: ' ' });

  return { id, spans, isError: looksLikeError(plain), timestamp: Date.now() };
}

/**
 * Rows from `startLine` to the end of the buffer.
 *
 * The id is the absolute buffer line. It shifts by one each time scrollback
 * trims, which costs a re-render of the rows below; a monotonic id would need a
 * line-creation event xterm does not expose.
 */
export function linesFrom(buffer: IBuffer, startLine: number): AnsiLine[] {
  const out: AnsiLine[] = [];
  const probe = buffer.getNullCell();
  const from = Math.max(0, startLine);
  for (let y = from; y < buffer.length; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    out.push(lineToAnsi(line, `row-${y}`, probe));
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/core/xtermLines.test.ts`
Expected: PASS, 10 tests.

If the wide-character test fails with a doubled glyph, `allowProposedApi` or the Unicode 11 activation is missing from `makeTerm` — the addon is what grants the second cell.

- [ ] **Step 5: Commit**

```bash
git add src/core/xtermLines.ts src/core/xtermLines.test.ts
git commit -m "feat(terminal): render an xterm buffer to the span model"
```

---

### Task 3: `XtermScreen`

The wrapper: lifecycle, Unicode activation, marks, and the coalesced parse notification.

**Files:**
- Create: `src/core/xtermScreen.ts`
- Test: `src/core/xtermScreen.test.ts`

**Interfaces:**
- Consumes: `TerminalScreen` (Task 1), `linesFrom` (Task 2).
- Produces: `class XtermScreen implements TerminalScreen`, constructor `new XtermScreen(cols: number, rows: number)`. Task 5 constructs it.

- [ ] **Step 1: Write the failing test**

Create `src/core/xtermScreen.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { XtermScreen } from './xtermScreen';

/** Resolve once the screen reports a parse; xterm's write is asynchronous. */
const parsed = (screen: XtermScreen, data: string) =>
  new Promise<void>((resolve) => {
    const off = screen.onParsed(() => {
      off();
      resolve();
    });
    screen.write(data);
  });

const plain = (lines: { spans: { text: string }[] }[]) =>
  lines.map((l) => l.spans.map((s) => s.text).join(''));

beforeEach(() => {
  // Coalescing runs on a frame; fire it straight through in tests.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());

describe('XtermScreen', () => {
  it('announces a parse and then reads back what was written', async () => {
    const screen = new XtermScreen(40, 10);
    await parsed(screen, 'hello');
    expect(plain(screen.getLines())[0]).toBe('hello');
  });

  it('reports alt-screen', async () => {
    const screen = new XtermScreen(40, 10);
    expect(screen.isAltScreen()).toBe(false);
    await parsed(screen, '\x1b[?1049h');
    expect(screen.isAltScreen()).toBe(true);
    await parsed(screen, '\x1b[?1049l');
    expect(screen.isAltScreen()).toBe(false);
  });

  it('reads a block from its mark, not from the top', async () => {
    const screen = new XtermScreen(40, 10);
    await parsed(screen, 'before\r\n');
    const mark = screen.mark();
    await parsed(screen, 'after one\r\nafter two\r\n');
    expect(plain(screen.linesSince(mark))).toContain('after one');
    expect(plain(screen.linesSince(mark))).not.toContain('before');
  });

  it('falls back to the whole buffer for a mark it does not know', async () => {
    // A mark restored from a persisted session belongs to a screen that no
    // longer exists; showing everything beats showing nothing.
    const screen = new XtermScreen(40, 10);
    await parsed(screen, 'restored\r\n');
    expect(plain(screen.linesSince(9999))[0]).toBe('restored');
  });

  it('gives a wide character its second cell', async () => {
    const screen = new XtermScreen(40, 10);
    await parsed(screen, '\u{1f389}A');
    expect(plain(screen.getLines())[0]).toBe('\u{1f389}A');
  });

  it('coalesces a burst of writes into one notification', async () => {
    const screen = new XtermScreen(40, 10);
    const seen = vi.fn();
    screen.onParsed(seen);
    screen.write('a');
    screen.write('b');
    screen.write('c');
    await new Promise((r) => setTimeout(r, 0));
    expect(seen.mock.calls.length).toBeLessThan(3);
  });

  it('resizes and stops notifying once disposed', async () => {
    const screen = new XtermScreen(40, 10);
    screen.resize(20, 5);
    const seen = vi.fn();
    screen.onParsed(seen);
    screen.dispose();
    screen.write('ignored');
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/xtermScreen.test.ts`
Expected: FAIL with "Failed to resolve import ./xtermScreen".

- [ ] **Step 3: Write the implementation**

Create `src/core/xtermScreen.ts`:

```ts
import { Terminal } from '@xterm/headless';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import type { IMarker } from '@xterm/headless';
import type { AnsiLine } from '../types/terminal';
import type { TerminalScreen } from './terminalScreen';
import { linesFrom } from './xtermLines';

/** Matches what the hand-written emulator kept, so scrollback depth is unchanged. */
const SCROLLBACK = 5000;

/**
 * A terminal screen backed by @xterm/headless.
 *
 * Replaces a hand-written VT emulator that had no character-width model at all:
 * it advanced one cell per code point, so every emoji overlapped its neighbour
 * and every column after a wide glyph sheared. xterm ships a real width table,
 * and the Unicode 11 addon puts it on the same table as tmux (utf8proc) and the
 * agent CLIs (string-width) — agreement is the goal, not the number 11.
 */
export class XtermScreen implements TerminalScreen {
  private term: Terminal;
  private listeners = new Set<() => void>();
  private marks = new Map<number, IMarker>();
  private nextMarkId = 1;
  private frame = 0;
  private disposed = false;

  constructor(cols: number, rows: number) {
    this.term = new Terminal({
      cols,
      rows,
      scrollback: SCROLLBACK,
      // registerMarker and the unicode API are proposed API and throw without this.
      allowProposedApi: true,
    });
    try {
      this.term.loadAddon(new Unicode11Addon());
      this.term.unicode.activeVersion = '11';
    } catch (err) {
      // Non-fatal by design: a terminal on the old width table renders as it did
      // yesterday, which is far better than a terminal that does not open.
      console.warn('[terminal] could not activate Unicode 11 widths', err);
    }
  }

  write(data: string): void {
    if (this.disposed) return;
    this.term.write(data, () => this.scheduleNotify());
  }

  /**
   * One notification per frame, however many chunks arrived.
   *
   * A busy agent delivers many writes per frame and each one used to drive a
   * full React update over the whole scrollback.
   */
  private scheduleNotify(): void {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.disposed) return;
      for (const cb of [...this.listeners]) cb();
    });
  }

  onParsed(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  isAltScreen(): boolean {
    return this.term.buffer.active.type === 'alternate';
  }

  /**
   * Returns an opaque handle rather than a line number: the marker underneath
   * is trim-compensated by xterm, so a block keeps pointing at its own output
   * even after scrollback drops rows above it. The handle is a number because
   * it is persisted on the block.
   */
  mark(): number {
    const id = this.nextMarkId++;
    const marker = this.term.registerMarker(0);
    if (marker) {
      this.marks.set(id, marker);
      marker.onDispose(() => this.marks.delete(id));
    }
    return id;
  }

  getLines(): AnsiLine[] {
    return linesFrom(this.term.buffer.active, 0);
  }

  linesSince(mark: number): AnsiLine[] {
    const marker = this.marks.get(mark);
    // An unknown mark is a restored session's, or one whose line has scrolled
    // out. Everything beats nothing.
    if (!marker) return this.getLines();
    return linesFrom(this.term.buffer.active, marker.line);
  }

  resize(cols: number, rows: number): void {
    if (this.disposed) return;
    this.term.resize(cols, rows);
  }

  reset(): void {
    if (this.disposed) return;
    this.term.reset();
    this.marks.clear();
  }

  dispose(): void {
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.listeners.clear();
    this.marks.clear();
    this.term.dispose();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/core/xtermScreen.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/xtermScreen.ts src/core/xtermScreen.test.ts
git commit -m "feat(terminal): add XtermScreen over @xterm/headless"
```

---

### Task 4: Prove parity against the emulator's own corpus

`terminalEmulator.test.ts` is 264 lines of behaviour assertions written against real defects — escape swallowing, spinner rows, chunk boundaries. Running `XtermScreen` against the same expectations is what makes deleting 858 lines safe, and it is the step that will surface the SGR and erase-semantics differences a hand-rolled emulator always has.

**Files:**
- Create: `src/core/screenParity.test.ts`
- Test: itself.

**Interfaces:**
- Consumes: `XtermScreen` (Task 3).

The corpus is **30 tests in 9 `describe` blocks**. Port all of them except where noted:

| `describe` | Port? |
|---|---|
| `escape sequences never reach the screen` | Yes |
| `in-line cursor control` | Yes |
| `parser state survives chunk boundaries` | Yes |
| `cursor addressing` | Yes |
| `alternate screen` | Yes |
| `shell integration and working directory` | **Partly — see below** |
| `block scoping via marks` | Yes, via `mark()` / `linesSince()` |
| `error detection is anchored, not keyword soup` | Yes |
| `regression: bytes captured from the live PTY daemon` | Yes — highest value, real captured bytes |

**`shell integration and working directory` is the exception.** Its three tests construct `new TerminalEmulator({ events: {...} })` and assert `onPromptStart`/`onCommandStart`/`onExecutionStart`/`onExecutionEnd`/`onCwd` fire. Task 1 deletes that interface as dead — `configureEmulators` has zero callers, so those callbacks never fired in the running app, and the Rust demuxer supplies every one of those events instead. Coverage does not disappear; it already exists in `crates/doom-term-pty/src/demuxer.rs` as `test_osc_133_demuxing`, `osc_3008_reports_the_working_directory` and `osc_7_reports_the_working_directory`.

So: **do not port the event assertions.** Do port the *screen* assertion embedded in the OSC 3008 case — `expect(rows(emu)).toEqual([''])` — as a check that xterm does not print the record either. Write it as its own test with a comment explaining where the event coverage went.

- [ ] **Step 1: Port the corpus**

Read `src/core/terminalEmulator.test.ts` in full. For each `it(...)` in the blocks marked Yes above, write the equivalent against `XtermScreen` in `src/core/screenParity.test.ts`, using this helper so writes are awaited:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { XtermScreen } from './xtermScreen';

const feed = (screen: XtermScreen, data: string) =>
  new Promise<void>((resolve) => {
    const off = screen.onParsed(() => {
      off();
      resolve();
    });
    screen.write(data);
  });

const rows = (screen: XtermScreen) =>
  screen.getLines().map((l) => l.spans.map((s) => s.text).join('').replace(/\s+$/, ''));

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());
```

Port every case. The assertions carry across unchanged — they are about rendered text, not about internals.

- [ ] **Step 2: Run and triage**

Run: `npx vitest run src/core/screenParity.test.ts`

Some cases are expected to differ, and each divergence must be classified before it is accepted:

- **xterm is right, the old emulator was wrong** — keep xterm's behaviour and change the ported assertion, with a comment saying what the old one asserted and why it was wrong. Wide characters are the known example.
- **A genuine regression** — fix `xtermLines.ts` or `xtermScreen.ts`.

Do not silently relax an assertion. If a divergence cannot be classified confidently, **stop and ask** rather than guessing — a wrong call here is a defect that ships behind a green suite.

- [ ] **Step 3: Record what diverged**

Add a comment block at the top of `screenParity.test.ts` listing every assertion that changed and why, so the next reader knows the difference was decided rather than drifted.

- [ ] **Step 4: Commit**

```bash
git add src/core/screenParity.test.ts
git commit -m "test(terminal): run the emulator corpus against XtermScreen"
```

---

### Task 5: Switch the app to `XtermScreen`

The registry hands out the new implementation, and `usePtyEvents` stops reading the buffer on the line after the write — which it cannot do any more, because parsing is asynchronous.

**Files:**
- Modify: `src/core/emulatorRegistry.ts`, `src/hooks/usePtyEvents.ts:22-75`
- Test: `src/core/emulatorRegistry.test.ts`, `src/hooks/usePtyEvents.test.ts`

**Interfaces:**
- Consumes: `XtermScreen` (Task 3), `TerminalScreen` (Task 1).
- Produces: `getEmulator(sessionId): TerminalScreen` (unchanged name, new return type), `onScreenParsed(cb: (sessionId: string) => void): () => void`.

- [ ] **Step 1: Hand out XtermScreen and emit parse events centrally**

In `src/core/emulatorRegistry.ts`, replace the `TerminalEmulator` construction with `XtermScreen`, retype the map to `TerminalScreen`, and add one global parse emitter so consumers keep a single subscription:

```ts
const parsedListeners = new Set<(sessionId: string) => void>();

/**
 * Fires when any session has parsed a batch, already coalesced per frame by the
 * screen. One subscription for the whole app, matching how PTY events arrive:
 * handlers reach the right session through the id, not through a closure.
 */
export function onScreenParsed(cb: (sessionId: string) => void): () => void {
  parsedListeners.add(cb);
  return () => parsedListeners.delete(cb);
}
```

and inside `getEmulator`, when creating a screen:

```ts
    emu = new XtermScreen(BOOTSTRAP_COLS, BOOTSTRAP_ROWS);
    emu.onParsed(() => {
      for (const cb of [...parsedListeners]) cb(sessionId);
    });
    emulators.set(sessionId, emu);
```

`disposeEmulator` must now call `screen.dispose()` before dropping it — an xterm holds a scheduled frame and listeners that a `Map.delete` does not release:

```ts
export function disposeEmulator(sessionId: string): void {
  emulators.get(sessionId)?.dispose();
  emulators.delete(sessionId);
}
```

Do the same in `resetAllEmulators`.

- [ ] **Step 2: Split the write from the read in `usePtyEvents`**

In `src/hooks/usePtyEvents.ts`, `onOutput` becomes write-only:

```ts
      onOutput: (rawChunk, sessionId) => {
        // Feed the session's own screen. Parsing is asynchronous, so the render
        // happens in the onScreenParsed handler below rather than here — reading
        // the buffer on the next line would read the previous frame's content.
        getEmulator(sessionId).write(rawChunk);

        // Recorded here, not in an updater: React may run an updater late or
        // more than once, and the mark's pulse is timed off this.
        noteOutput(sessionId);
      },
```

Then register the render, keeping the existing body verbatim from the old `setWorkspace` call — the block-versus-TUI branch, the `foregroundAgent` check and the `linesSince` read are all unchanged:

```ts
    const unbindParsed = onScreenParsed((sessionId) => {
      const emu = getEmulator(sessionId);
      const inAltScreen = emu.isAltScreen();

      setWorkspace((prev) => {
        // …the existing body, unchanged…
      });
    });
```

Add `unbindParsed()` to the effect's cleanup alongside `unbindPty()` and `unbindTele()`.

- [ ] **Step 3: Stub the frame in the affected tests**

`XtermScreen` coalesces on `requestAnimationFrame`, which jsdom provides but which does not run inside a synchronous test. Add to `src/core/emulatorRegistry.test.ts` and `src/hooks/usePtyEvents.test.ts`:

```ts
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());
```

Both suites also need their writes awaited rather than read on the next line. Convert their assertions to the `feed` pattern from Task 3.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all suites pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/emulatorRegistry.ts src/core/emulatorRegistry.test.ts \
        src/hooks/usePtyEvents.ts src/hooks/usePtyEvents.test.ts
git commit -m "feat(terminal): parse with xterm and render once per frame"
```

---

### Task 6: Delete the hand-written emulator

**Files:**
- Delete: `src/core/terminalEmulator.ts`, `src/core/terminalEmulator.test.ts`
- Modify: any remaining importer

- [ ] **Step 1: Confirm nothing imports it**

Run: `grep -rn "terminalEmulator" src/`
Expected: only `src/core/terminalEmulator.ts` and `src/core/terminalEmulator.test.ts` themselves. Anything else must be repointed at `./palette` or `./terminalScreen` before deleting.

- [ ] **Step 2: Delete**

```bash
git rm src/core/terminalEmulator.ts src/core/terminalEmulator.test.ts
```

The behaviour those tests protected now lives in `src/core/screenParity.test.ts` from Task 4. Do not delete them before that file is green.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all suites pass.

Run: `git diff --stat HEAD~1 -- src/core/`
Expected: a net deletion of roughly 1,100 lines across the two files.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(terminal): delete the hand-written VT emulator"
```

---

## Verification

- [ ] `npx tsc --noEmit` — no errors
- [ ] `npm test` — all pass
- [ ] `cargo test --manifest-path crates/doom-term-pty/Cargo.toml` — unaffected, still green
- [ ] `npm run build` — the production bundle resolves `@xterm/headless`, which the test environment does not prove on its own
- [ ] Live, per `doom-term-two-tabs-fight-over-sessions`: **close duplicate browser tabs first.** Then:
  - `printf '⭐ \U0001F389 日本語 |\n'` — every glyph occupies its own cells and the trailing `|` is not overlapped or clipped
  - Run an agent CLI (`claude`, `codex`, `agy`) and confirm its box-drawing frame closes cleanly and the in-progress input line is not clipped at its head
  - Scroll back through a long output and confirm rows are not duplicated or dropped
