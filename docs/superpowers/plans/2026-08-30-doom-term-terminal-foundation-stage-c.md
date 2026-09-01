# Terminal Foundation Stage C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop throwing away a pane on every tab switch, and stop launching commands into a shell that may not be listening yet.

**Architecture:** Three changes to the pane and command lifecycle. Panes all stay mounted and toggle visibility, so a switch is a style change rather than a remount. Command submission becomes two acts — write the line, wait for the shell to echo it, then send Enter — with bounded retries and a fail-open last attempt. Because that opens a window where typing would land inside an unsubmitted line, keystrokes are held for its duration and flushed in order once the line has left. The two new modules are pure with injected IO and test without a DOM or a PTY.

**Tech Stack:** TypeScript, React 19, Vitest with jsdom.

**Spec:** `docs/superpowers/specs/2026-08-29-doom-term-terminal-foundation-design.md` (Stage C). Stage A shipped in `41583fb..c680358`, Stage B in `62f816a..6291f1c`.

## Global Constraints

- **Never copy nodeterm source.** nodeterm is BUSL-1.1, Doom Term is MIT. The technique — echo-verify before submitting, hold keystrokes during the window — is a fact and free to reuse. The code and its comments are not. Write ours from behaviour.
- **Every non-obvious fix carries a comment naming the failure that motivated it.**
- **No game vocabulary** in any user-visible string.
- `ptyClient.writeToSession` **never throws**: when the socket is down it queues into `pendingWrites`. Delivery code must not carry transport-exception machinery it does not need.
- jsdom gives every element a **zero layout box** (`clientWidth === 0`). Tests that need a real one must stub it.
- TS tests: `npx vitest run <path>` for one file; `npm test` for everything. Typecheck with `npx tsc --noEmit`.

## Ordering note

Task 1 is a genuine prerequisite for Task 2, not tidy-up. Once every pane is mounted, a hidden pane still runs `useTerminalSize`; without a zero-size guard it would read a `0 × 0` box, clamp to the `20 × 4` floor, and resize that session's PTY. Every background agent would be handed a 20-column terminal on the next tab switch.

---

### Task 1: Harden `useTerminalSize` against hidden and unlaid-out panes

Two defects, both latent today and both load-bearing once Task 2 mounts every pane.

**Zero-size box.** `gridSize` clamps its floor at 20 × 4, so a pane with no layout box reports a real-looking grid instead of nothing.

**The frame guard tests the wrong thing.** `if (frame) return; frame = requestAnimationFrame(apply)` — a callback that runs synchronously fires *before* the assignment completes, so `frame` is left non-zero forever and every later resize is swallowed. Real browser `rAF` is asynchronous so this does not bite today, but it is the same bug already fixed in `xtermScreen.ts:56-68`.

**Files:**
- Modify: `src/hooks/useTerminalSize.ts:26-56`
- Modify: `src/components/RawTerminalView.test.tsx` (the sizing test needs a real layout box)
- Test: `src/hooks/useTerminalSize.test.ts`

**Interfaces:**
- Consumes / produces: no signature changes. `useTerminalSize(ref, sessionId)` is unchanged.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('useTerminalSize', ...)` in `src/hooks/useTerminalSize.test.ts`:

```ts
  it('ignores a pane with no layout box', () => {
    // A hidden or not-yet-laid-out pane measures 0x0. Sizing from that clamps to
    // the 20x4 floor and hands that session a 20-column terminal.
    const ref = { current: paneOf(0, 0) };
    renderHook(() => useTerminalSize(ref, 'session-1'));

    expect(ptyClient.resizeSession).not.toHaveBeenCalled();
    expect(resizeEmulator).not.toHaveBeenCalled();
  });

  it('reports once a hidden pane is given a box', () => {
    const el = paneOf(0, 0);
    const ref = { current: el };
    renderHook(() => useTerminalSize(ref, 'session-1'));
    expect(ptyClient.resizeSession).not.toHaveBeenCalled();

    Object.defineProperty(el, 'clientWidth', { value: 700, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 450, configurable: true });
    fire?.();

    expect(ptyClient.resizeSession).toHaveBeenCalledWith('session-1', 100, 30);
  });

  it('keeps reporting after a frame that ran synchronously', () => {
    // The guard must not latch. Testing the frame handle rather than a flag set
    // before scheduling leaves it non-zero forever the first time a callback
    // runs inside requestAnimationFrame().
    const el = paneOf(700, 450);
    const ref = { current: el };
    renderHook(() => useTerminalSize(ref, 'session-1'));

    Object.defineProperty(el, 'clientWidth', { value: 350, configurable: true });
    fire?.();
    Object.defineProperty(el, 'clientWidth', { value: 210, configurable: true });
    fire?.();

    expect(ptyClient.resizeSession).toHaveBeenLastCalledWith('session-1', 30, 30);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hooks/useTerminalSize.test.ts`
Expected: FAIL. The first two report a `20, 4` resize that should not happen; the third reports `50, 30` because the second `fire?.()` was swallowed by the latched guard.

- [ ] **Step 3: Fix both defects**

In `src/hooks/useTerminalSize.ts`, replace the body of the effect from `let frame = 0;` through the cleanup return with:

```ts
    let frame = 0;
    let scheduled = false;

    const apply = () => {
      scheduled = false;
      frame = 0;
      // A pane with no layout box is hidden, or has not been laid out yet.
      // gridSize would clamp 0x0 up to its 20x4 floor and hand this session a
      // 20-column terminal — which is what every backgrounded pane would get
      // the moment panes stopped being unmounted on a tab switch.
      if (el.clientWidth === 0 || el.clientHeight === 0) return;

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
    // Guard on a flag set BEFORE scheduling, not on the frame handle: a callback
    // that runs synchronously fires before the handle is assigned, leaving it
    // non-zero forever and swallowing every later resize.
    const observer = new ResizeObserver(() => {
      if (scheduled) return;
      scheduled = true;
      frame = requestAnimationFrame(apply);
    });
    observer.observe(el);
    apply();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      scheduled = false;
      observer.disconnect();
    };
```

- [ ] **Step 4: Give the RawTerminalView sizing test a real box**

`RawTerminalView.test.tsx`'s `reports its grid size for the session it belongs to` passes today only because jsdom's `0 × 0` clamped up to the floor. With the guard it stops resizing at all, which is now correct — so the test must supply a box. Replace that test with:

```tsx
  it('reports its grid size for the session it belongs to', () => {
    // Before this, every session ran at a hardcoded 120x30 for its whole life:
    // nothing ever called resizeSession, so SIGWINCH never fired.
    //
    // jsdom gives every element a zero layout box, and the hook deliberately
    // ignores those, so give the prototype a real one for this test.
    const w = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(700);
    const h = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(450);
    const spy = vi.spyOn(ptyClient, 'resizeSession').mockImplementation(() => {});

    render(<RawTerminalView {...base} sessionId="session-1" isActive />);

    expect(spy).toHaveBeenCalledWith('session-1', expect.any(Number), expect.any(Number));
    spy.mockRestore();
    w.mockRestore();
    h.mockRestore();
  });
```

- [ ] **Step 5: Verify**

Run: `npx vitest run src/hooks/useTerminalSize.test.ts src/components/RawTerminalView.test.tsx`
Expected: PASS, 7 and 15 tests.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useTerminalSize.ts src/hooks/useTerminalSize.test.ts \
        src/components/RawTerminalView.test.tsx
git commit -m "fix(terminal): ignore unlaid-out panes and stop the frame guard latching"
```

---

### Task 2: Keep offscreen panes mounted

`SplitPaneGrid.tsx:27-34` renders only the active node in `single` layout, so every tab switch throws away the inactive pane's React subtree and rebuilds the other from state. Render all of them and toggle visibility instead: a switch becomes a style change.

**Files:**
- Modify: `src/components/SplitPaneGrid.tsx:27-34`
- Modify: `src/components/RawTerminalView.tsx:100-105` (release focus on deactivate)
- Modify: `src/components/BlockPane.tsx` (never null the shared scroll ref)
- Modify: `src/components/ArchitecturalComponents.test.tsx` (one test name and assertion)
- Test: `src/components/SplitPaneGrid.test.tsx` (new)

**Interfaces:**
- Consumes: nothing from Task 1 by name; depends on its zero-size guard for correctness.
- Produces: no prop changes. `SplitPaneGrid`'s signature is unchanged.

**Why `visibility` and not `display`.** `display: none` removes the box from layout, so a hidden pane measures `0 × 0`. Task 1 makes that harmless rather than catastrophic, but it also means a backgrounded pane would stop tracking the window size and come back stale. `visibility: hidden` keeps the box, so `useTerminalSize` keeps reporting the truth for every pane, and it already removes the subtree from the tab order.

- [ ] **Step 1: Write the failing test**

Create `src/components/SplitPaneGrid.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SplitPaneGrid } from './SplitPaneGrid';
import { SessionNode } from '../types/sessionTree';

const node = (id: string, title: string): SessionNode => ({
  id,
  groupId: 'g1',
  title,
  kind: 'terminal',
  cwd: '/test',
  gitBranch: 'main',
  activeBlockId: null,
  isTuiActive: false,
  agentState: 'idle',
  blocks: [],
  tuiLines: [],
  commandHistory: [],
  createdAt: 1000,
});

const nodes = [node('n1', 'One'), node('n2', 'Two')];

const renderGrid = (activeNodeId: string) =>
  render(
    <SplitPaneGrid
      layout="single"
      nodes={nodes}
      activeNodeId={activeNodeId}
      onSelectNode={vi.fn()}
      renderPane={(n) => <div>Pane: {n.title}</div>}
    />
  );

/** The visibility-toggling wrapper this pane is rendered inside. */
const paneBox = (title: string): HTMLElement =>
  screen.getByText(`Pane: ${title}`).closest('[data-pane]') as HTMLElement;

describe('SplitPaneGrid single layout', () => {
  it('mounts every pane, not only the active one', () => {
    // A tab switch used to unmount the inactive pane and rebuild the other from
    // state, throwing away its DOM, scroll position and focus.
    renderGrid('n1');
    expect(screen.getByText('Pane: One')).toBeDefined();
    expect(screen.getByText('Pane: Two')).toBeDefined();
  });

  it('shows only the active pane', () => {
    renderGrid('n1');
    expect(paneBox('One').style.visibility).toBe('visible');
    expect(paneBox('Two').style.visibility).toBe('hidden');
  });

  it('does not let a hidden pane take the mouse', () => {
    renderGrid('n1');
    expect(paneBox('Two').style.pointerEvents).toBe('none');
  });

  it('falls back to the first pane when the active id matches nothing', () => {
    renderGrid('gone');
    expect(paneBox('One').style.visibility).toBe('visible');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/SplitPaneGrid.test.tsx`
Expected: FAIL — `Pane: Two` is not in the document, and `paneBox` returns null.

- [ ] **Step 3: Mount every pane**

In `src/components/SplitPaneGrid.tsx`, replace the `single` branch (`:27-34`) with:

```tsx
  if (layout === 'single' || nodes.length === 1) {
    // Every pane stays mounted and only the active one is shown. Rendering just
    // the active node meant a tab switch unmounted its subtree and rebuilt the
    // other from state — throwing away the DOM, the scroll position and focus.
    //
    // visibility rather than display: display:none removes the layout box, so a
    // backgrounded pane would measure 0x0 and stop tracking the window size.
    const activeId = nodes.some((n) => n.id === activeNodeId) ? activeNodeId : nodes[0].id;
    return (
      <div className="flex-1 relative min-h-0 min-w-0">
        {nodes.map((node) => {
          const isActive = node.id === activeId;
          return (
            <div
              key={node.id}
              data-pane={node.id}
              aria-hidden={!isActive}
              className="absolute inset-0 flex flex-col min-h-0 min-w-0"
              style={{
                visibility: isActive ? 'visible' : 'hidden',
                pointerEvents: isActive ? 'auto' : 'none',
              }}
            >
              {renderPane(node, isActive)}
            </div>
          );
        })}
      </div>
    );
  }
```

- [ ] **Step 4: Release the keyboard when a pane deactivates**

In `src/components/RawTerminalView.tsx`, replace the focus effect at `:100-105`:

```tsx
  // Take the keyboard as soon as this pane is the active one, and give it back
  // as soon as it is not. A pass-through terminal that is not focused is a
  // terminal you cannot type into with nothing on screen to say why — and now
  // that every pane stays mounted, a hidden one still holding focus would
  // swallow every keystroke silently.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (isActive) {
      if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
      return;
    }
    if (el.contains(document.activeElement)) {
      (document.activeElement as HTMLElement | null)?.blur();
    }
  }, [isActive]);
```

- [ ] **Step 5: Stop the shared scroll ref being nulled by the pane losing focus**

In `src/components/BlockPane.tsx`, change the blocks scroll area ref callback:

```tsx
        ref={(el) => {
          gridRef.current = el;
          // Never null the shared ref. With every pane mounted, React detaches
          // the deactivating pane's ref after attaching the activating one's, so
          // an unguarded assignment would clear the ref that was just set and
          // the scroll restore would silently do nothing.
          if (isActive && el) scrollContainerRef.current = el;
        }}
```

- [ ] **Step 6: Update the stale assertion in the architectural suite**

`ArchitecturalComponents.test.tsx`'s `renders single pane when mode is single` still passes, but its name now asserts the opposite of the behaviour. Rename it and widen it:

```tsx
  it('mounts every pane in single mode and shows the active one', () => {
    const onSelect = vi.fn();
    render(
      <SplitPaneGrid
        layout="single"
        nodes={mockNodes}
        activeNodeId="n1"
        onSelectNode={onSelect}
        renderPane={(node) => <div>Pane: {node.title}</div>}
      />
    );

    expect(screen.getByText('Pane: Terminal 1')).toBeDefined();
    expect(screen.getByText('Pane: Agent 2')).toBeDefined();
  });
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all suites pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/SplitPaneGrid.tsx src/components/SplitPaneGrid.test.tsx \
        src/components/RawTerminalView.tsx src/components/BlockPane.tsx \
        src/components/ArchitecturalComponents.test.tsx
git commit -m "feat(ui): keep every pane mounted and toggle visibility on switch"
```

---

### Task 3: Echo-verified command delivery

`ptyClient.submitCommandToSession` writes `${command}\n` blind, in one shot. That races shell init: zsh's rc and ZLE setup reset the tty with a flush that can eat part of a queued line, and a mangled line submitted anyway strands the shell at `quote>`. The failure is silent and expensive — you believe you dispatched work and did not.

Write the line **without** Enter, wait until the shell echoes its tail back, then submit. On a verify timeout, `Ctrl-U` and rewrite, bounded; the last attempt submits unverified, because a terminal whose echo we cannot recognise must never block a launch — and that worst case is exactly today's behaviour.

**Files:**
- Create: `src/core/commandDelivery.ts`
- Test: `src/core/commandDelivery.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type DeliveryOutcome = 'verified' | 'unverified' | 'cancelled'`; `interface DeliveryIo { write(data: string): void; onData(cb: (chunk: string) => void): () => void }`; `deliverCommand(io: DeliveryIo, command: string, onSettled?: (outcome: DeliveryOutcome) => void): () => void`; constants `VERIFY_TIMEOUT_MS`, `DELIVERY_ATTEMPTS`, `ECHO_TAIL_CHARS`, `KILL_LINE`; helpers `stripControl`, `echoComplete`. Task 5 consumes `deliverCommand` and `KILL_LINE`.

- [ ] **Step 1: Write the failing test**

Create `src/core/commandDelivery.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  deliverCommand,
  stripControl,
  echoComplete,
  KILL_LINE,
  VERIFY_TIMEOUT_MS,
  DELIVERY_ATTEMPTS,
  type DeliveryOutcome,
} from './commandDelivery';

/** A fake terminal: records what was written, lets a test feed the echo back. */
function fakeIo() {
  const written: string[] = [];
  const listeners = new Set<(chunk: string) => void>();
  return {
    written,
    echo: (chunk: string) => listeners.forEach((cb) => cb(chunk)),
    io: {
      write: (data: string) => written.push(data),
      onData: (cb: (chunk: string) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('stripControl', () => {
  it('drops escape sequences and line breaks so the echo can be compared', () => {
    expect(stripControl('\x1b[32mls -la\x1b[0m\r\n')).toBe('ls -la');
    expect(stripControl('\x1b]0;title\x07ls')).toBe('ls');
  });
});

describe('echoComplete', () => {
  it('matches on the tail, because the head is polluted by the prompt', () => {
    expect(echoComplete('user@host:~$ deploy --now', 'deploy --now')).toBe(true);
    expect(echoComplete('user@host:~$ deploy --n', 'deploy --now')).toBe(false);
  });
});

describe('deliverCommand', () => {
  it('writes the line without Enter and waits', () => {
    const f = fakeIo();
    deliverCommand(f.io, 'echo hi');
    expect(f.written).toEqual(['echo hi']);
  });

  it('submits once the shell echoes the line back', () => {
    const f = fakeIo();
    const settled = vi.fn();
    deliverCommand(f.io, 'echo hi', settled);
    f.echo('user@host:~$ echo hi');
    expect(f.written).toEqual(['echo hi', '\r']);
    expect(settled).toHaveBeenCalledWith('verified');
  });

  it('ignores escape sequences in the echo', () => {
    const f = fakeIo();
    deliverCommand(f.io, 'echo hi');
    f.echo('\x1b[32muser@host\x1b[0m:~$ echo \x1b[1mhi\x1b[0m\r\n');
    expect(f.written).toEqual(['echo hi', '\r']);
  });

  it('reassembles an echo that arrives in pieces', () => {
    const f = fakeIo();
    deliverCommand(f.io, 'echo hi');
    f.echo('user@host:~$ ec');
    expect(f.written).toEqual(['echo hi']);
    f.echo('ho hi');
    expect(f.written).toEqual(['echo hi', '\r']);
  });

  it('clears the pending line and rewrites when the echo never comes', () => {
    const f = fakeIo();
    deliverCommand(f.io, 'echo hi');
    vi.advanceTimersByTime(VERIFY_TIMEOUT_MS);
    expect(f.written).toEqual(['echo hi', KILL_LINE, 'echo hi']);
  });

  it('fails open on the last attempt rather than blocking the launch', () => {
    const f = fakeIo();
    const settled = vi.fn();
    deliverCommand(f.io, 'echo hi', settled);
    for (let i = 0; i < DELIVERY_ATTEMPTS; i++) vi.advanceTimersByTime(VERIFY_TIMEOUT_MS);
    expect(f.written[f.written.length - 1]).toBe('\r');
    expect(settled).toHaveBeenCalledWith('unverified');
  });

  it('settles exactly once', () => {
    const f = fakeIo();
    const settled = vi.fn();
    deliverCommand(f.io, 'echo hi', settled);
    f.echo('$ echo hi');
    f.echo('$ echo hi');
    vi.advanceTimersByTime(VERIFY_TIMEOUT_MS * DELIVERY_ATTEMPTS);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('does not submit twice when the io echoes synchronously', () => {
    // An io whose write feeds straight back into onData would otherwise
    // re-enter the listener while the tail still matches.
    const listeners = new Set<(chunk: string) => void>();
    const written: string[] = [];
    const io = {
      write: (data: string) => {
        written.push(data);
        listeners.forEach((cb) => cb(data));
      },
      onData: (cb: (chunk: string) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    };
    deliverCommand(io, 'echo hi');
    expect(written).toEqual(['echo hi', '\r']);
  });

  it('stops and unsubscribes when cancelled', () => {
    const f = fakeIo();
    const settled = vi.fn();
    const cancel = deliverCommand(f.io, 'echo hi', settled);
    cancel();
    expect(settled).toHaveBeenCalledWith('cancelled' as DeliveryOutcome);
    expect(f.listenerCount).toBe(0);

    vi.advanceTimersByTime(VERIFY_TIMEOUT_MS * DELIVERY_ATTEMPTS);
    expect(f.written).toEqual(['echo hi']);
  });

  it('does not re-announce when cancelled after it already submitted', () => {
    const f = fakeIo();
    const settled = vi.fn();
    const cancel = deliverCommand(f.io, 'echo hi', settled);
    f.echo('$ echo hi');
    cancel();
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith('verified');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/commandDelivery.test.ts`
Expected: FAIL with "Failed to resolve import ./commandDelivery".

- [ ] **Step 3: Write the implementation**

Create `src/core/commandDelivery.ts`:

```ts
/**
 * Two-act delivery of a command into a shell that may not be listening yet.
 *
 * Writing line-plus-Enter in one shot races shell init: zsh's rc and ZLE setup
 * reset the tty with a flush that can swallow part of a queued line, and a
 * mangled line submitted anyway strands the shell at `quote>`. Nothing reports
 * it — you believe you dispatched work and did not.
 *
 * So: write the line WITHOUT Enter, wait for the shell to echo its tail back,
 * and only then submit. A verify timeout clears the pending line and rewrites
 * it. The last attempt submits unverified on purpose — a terminal whose echo we
 * cannot recognise must never block a launch, and that worst case is exactly
 * the behaviour this replaces.
 *
 * Pure apart from the injected io, so every branch tests without a PTY.
 */

/**
 * Local PTY echo comes back in well under 100ms. This is generous enough to
 * cover a shell still running its rc files, and short enough that the fail-open
 * path (three of these) does not feel like a hang.
 */
export const VERIFY_TIMEOUT_MS = 1200;

export const DELIVERY_ATTEMPTS = 3;

/**
 * Match on the tail rather than the whole line: the head arrives fused to the
 * prompt. Long enough to be unambiguous, short enough that a line-wrap redraw
 * interleaved mid-echo rarely lands inside the window.
 */
export const ECHO_TAIL_CHARS = 32;

/** Ctrl-U — clear the pending input line before rewriting it. */
export const KILL_LINE = '\x15';

// CSI, OSC and single-character ESC sequences.
// eslint-disable-next-line no-control-regex
const ESCAPE_SEQUENCE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;

/**
 * Echo stream to comparable text: drop escape sequences and line breaks. A
 * shell re-wraps a long line with its own CR/LF at the terminal width, which
 * would otherwise break the match in the middle.
 */
export function stripControl(chunk: string): string {
  return chunk.replace(ESCAPE_SEQUENCE, '').replace(/[\r\n]/g, '');
}

/** Has the shell echoed the whole line back? */
export function echoComplete(seen: string, command: string): boolean {
  return seen.includes(command.slice(-ECHO_TAIL_CHARS));
}

export type DeliveryOutcome = 'verified' | 'unverified' | 'cancelled';

export interface DeliveryIo {
  write(data: string): void;
  /** Subscribe to this session's output; returns an unsubscribe. */
  onData(cb: (chunk: string) => void): () => void;
}

/**
 * Deliver `command` plus Enter, echo-verified with bounded retries.
 *
 * Returns a cancel function; call it on teardown or when a newer command
 * supersedes this one. `onSettled` fires exactly once, when the line has left
 * the pane or the delivery was abandoned — callers need to know when the LINE
 * is gone, not merely when it was started, because the retries run for up to
 * DELIVERY_ATTEMPTS x VERIFY_TIMEOUT_MS and anything typed inside that window
 * would land in the un-submitted line.
 */
export function deliverCommand(
  io: DeliveryIo,
  command: string,
  onSettled?: (outcome: DeliveryOutcome) => void
): () => void {
  let settled = false;
  let attempt = 0;
  let seen = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;

  /**
   * End the delivery exactly once.
   *
   * The order inside here is load-bearing in both directions. The guard and the
   * unsubscribe come FIRST, so an io that echoes writes back synchronously
   * cannot re-enter the listener below while the tail still matches and submit
   * again. `onSettled` comes LAST, after the Enter has gone out — the caller
   * releases held keystrokes from it, and those must land after the command
   * line was submitted, never inside it.
   */
  const finish = (outcome: DeliveryOutcome, sendEnter: boolean): void => {
    if (settled) return; // a cancel after the submit must not re-announce it
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    unsubscribe?.();
    if (sendEnter) io.write('\r');
    onSettled?.(outcome);
  };

  const submit = (outcome: DeliveryOutcome): void => finish(outcome, true);

  const onTimeout = (): void => {
    if (settled) return;
    if (attempt >= DELIVERY_ATTEMPTS) {
      submit('unverified');
      return;
    }
    io.write(KILL_LINE);
    attemptOnce();
  };

  const attemptOnce = (): void => {
    if (settled) return;
    attempt += 1;
    seen = '';
    // Arm before writing, for the same synchronous-echo case: a timer armed
    // after a write that already settled the delivery would outlive it.
    timer = setTimeout(onTimeout, VERIFY_TIMEOUT_MS);
    io.write(command);
  };

  unsubscribe = io.onData((chunk) => {
    if (settled) return;
    seen += stripControl(chunk);
    if (echoComplete(seen, command)) submit('verified');
  });

  attemptOnce();

  return () => finish('cancelled', false);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/core/commandDelivery.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/commandDelivery.ts src/core/commandDelivery.test.ts
git commit -m "feat(pty): add echo-verified command delivery"
```

---

### Task 4: A bounded hold buffer for the delivery window

Task 3 opens a window up to `DELIVERY_ATTEMPTS × VERIFY_TIMEOUT_MS` long during which the command line is written but not submitted. Anything typed in it would be spliced into the command. Hold those keystrokes and release them in order once the line has left, or drop them if it never did — never let them join the command.

**Files:**
- Create: `src/core/holdBuffer.ts`
- Test: `src/core/holdBuffer.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `const HOLD_LIMIT_CHARS: number`; `type OfferResult = 'send' | 'held' | 'full'`; `class HoldBuffer` with `isHolding: boolean` (getter), `hold(): void`, `offer(data: string): OfferResult`, `flush(): string[]`, `discard(): void`. Task 5 consumes all of it.

- [ ] **Step 1: Write the failing test**

Create `src/core/holdBuffer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { HoldBuffer, HOLD_LIMIT_CHARS } from './holdBuffer';

describe('HoldBuffer', () => {
  it('passes input straight through when it is not holding', () => {
    const buf = new HoldBuffer();
    expect(buf.isHolding).toBe(false);
    expect(buf.offer('a')).toBe('send');
  });

  it('holds input while a command line is in flight', () => {
    const buf = new HoldBuffer();
    buf.hold();
    expect(buf.offer('a')).toBe('held');
    expect(buf.isHolding).toBe(true);
  });

  it('releases what it held, in the order it arrived', () => {
    const buf = new HoldBuffer();
    buf.hold();
    buf.offer('one');
    buf.offer('two');
    buf.offer('three');
    expect(buf.flush()).toEqual(['one', 'two', 'three']);
  });

  it('goes back to passing through after a flush', () => {
    const buf = new HoldBuffer();
    buf.hold();
    buf.offer('a');
    buf.flush();
    expect(buf.isHolding).toBe(false);
    expect(buf.offer('b')).toBe('send');
  });

  it('drops what it held when the delivery failed', () => {
    // Held keys belong to the user's next input, never to a command that was
    // abandoned — splicing them in is the failure this exists to prevent.
    const buf = new HoldBuffer();
    buf.hold();
    buf.offer('a');
    buf.discard();
    expect(buf.isHolding).toBe(false);
    expect(buf.flush()).toEqual([]);
  });

  it('refuses loudly past its limit rather than dropping silently', () => {
    const buf = new HoldBuffer();
    buf.hold();
    expect(buf.offer('x'.repeat(HOLD_LIMIT_CHARS))).toBe('held');
    expect(buf.offer('one more')).toBe('full');
  });

  it('keeps what it already held when a later offer is refused', () => {
    const buf = new HoldBuffer();
    buf.hold();
    buf.offer('keep me');
    buf.offer('x'.repeat(HOLD_LIMIT_CHARS));
    expect(buf.flush()).toEqual(['keep me']);
  });

  it('is reusable across commands', () => {
    const buf = new HoldBuffer();
    buf.hold();
    buf.offer('first');
    expect(buf.flush()).toEqual(['first']);
    buf.hold();
    buf.offer('second');
    expect(buf.flush()).toEqual(['second']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/holdBuffer.test.ts`
Expected: FAIL with "Failed to resolve import ./holdBuffer".

- [ ] **Step 3: Write the implementation**

Create `src/core/holdBuffer.ts`:

```ts
/**
 * Keystrokes held while a command line is written but not yet submitted.
 *
 * Echo-verified delivery leaves the line sitting in the shell's editor for up
 * to three verify timeouts. Anything typed in that window would be spliced into
 * the command — a stray character in a `git push`, or a bare Enter that submits
 * a half-written line. Hold them, then release them in order once the line has
 * gone, or drop them if it never did.
 *
 * Bounded, and the refusal is explicit: a silent drop is indistinguishable from
 * a terminal that has stopped responding.
 */

/** Roughly a screenful of typing. Past this the window is not the problem. */
export const HOLD_LIMIT_CHARS = 4096;

export type OfferResult = 'send' | 'held' | 'full';

export class HoldBuffer {
  private queue: string[] = [];
  private size = 0;
  private holding = false;

  get isHolding(): boolean {
    return this.holding;
  }

  /** Begin holding. Called when a delivery starts. */
  hold(): void {
    this.holding = true;
  }

  /** Offer input. `send` means the caller should write it through as usual. */
  offer(data: string): OfferResult {
    if (!this.holding) return 'send';
    if (this.size + data.length > HOLD_LIMIT_CHARS) return 'full';
    this.queue.push(data);
    this.size += data.length;
    return 'held';
  }

  /** Release everything held, in arrival order, and resume passing through. */
  flush(): string[] {
    const released = this.queue;
    this.queue = [];
    this.size = 0;
    this.holding = false;
    return released;
  }

  /** The delivery was abandoned; what was held must never reach the shell. */
  discard(): void {
    this.queue = [];
    this.size = 0;
    this.holding = false;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/core/holdBuffer.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/holdBuffer.ts src/core/holdBuffer.test.ts
git commit -m "feat(pty): add a bounded hold buffer for the delivery window"
```

---

### Task 5: Wire delivery and holding into `ptyClient`

**Files:**
- Modify: `src/core/ptyClient.ts` — fields near `:38`, `writeToSession` at `:324`, `submitCommandToSession` at `:339`, `killSession` at `:375`
- Test: `src/core/ptyClient.test.ts`

**Interfaces:**
- Consumes: `deliverCommand` (Task 3), `HoldBuffer` (Task 4).
- Produces: no public signature changes. `submitCommandToSession(sessionId, command)` and `writeToSession(sessionId, data)` keep their shapes; a new private `sendWrite(sessionId, data)` carries the old `writeToSession` body.

**Scoping decision.** Only single-line commands are echo-verified. A multi-line command already goes as a bracketed paste, which the shell consumes as one unit — there is no partially-typed line to verify, and matching an echo through a paste blob is a different problem. Multi-line keeps the existing path unchanged.

- [ ] **Step 1: Write the failing test**

Append to `src/core/ptyClient.test.ts`:

```ts
/** The chunk handlers a delivery registered for a session. */
function echoTo(sessionId: string, chunk: string): void {
  const handlers = (
    ptyClient as unknown as {
      sessionHandlers: Map<string, Set<{ onOutput: (d: string, s: string) => void }>>;
    }
  ).sessionHandlers.get(sessionId);
  handlers?.forEach((h) => h.onOutput(chunk, sessionId));
}

const payloads = (sent: unknown[]): string[] =>
  sent
    .filter((m): m is { action: string; payload: { data: string } } => {
      const msg = m as { action?: string };
      return msg.action === 'Write';
    })
    .map((m) => m.payload.data);

describe('command delivery', () => {
  it('writes the line first and submits only once the shell echoes it', () => {
    const sent = captureSends(() => {
      ptyClient.submitCommandToSession('d1', 'echo hi');
      echoTo('d1', 'user@host:~$ echo hi');
    });
    expect(payloads(sent)).toEqual(['echo hi', '\r']);
  });

  it('holds what is typed during the window and releases it after the line', () => {
    // Typed inside the delivery window, these used to land INSIDE the command.
    const sent = captureSends(() => {
      ptyClient.submitCommandToSession('d2', 'ls');
      ptyClient.writeToSession('d2', 'x');
      ptyClient.writeToSession('d2', 'y');
      echoTo('d2', '$ ls');
    });
    expect(payloads(sent)).toEqual(['ls', '\r', 'x', 'y']);
  });

  it('passes typing straight through when no delivery is in flight', () => {
    const sent = captureSends(() => {
      ptyClient.writeToSession('d3', 'plain');
    });
    expect(payloads(sent)).toEqual(['plain']);
  });

  it('sends a multi-line command as one bracketed paste, unverified', () => {
    const sent = captureSends(() => {
      ptyClient.submitCommandToSession('d4', 'one\ntwo');
    });
    expect(payloads(sent)).toEqual(['\x1b[200~one\ntwo\x1b[201~\n']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/ptyClient.test.ts`
Expected: FAIL — the first test sees `['echo hi\n']`, because delivery is still a single blind write.

- [ ] **Step 3: Add the imports and per-session state**

In `src/core/ptyClient.ts`, add to the imports at the top:

```ts
import { deliverCommand } from './commandDelivery';
import { HoldBuffer } from './holdBuffer';
```

and to the class fields, after `private sessionHandlers` (`:39`):

```ts
  /** Cancel functions for deliveries still in flight, keyed by session. */
  private deliveries: Map<string, () => void> = new Map();
  /** Keystrokes held while a session's command line is unsubmitted. */
  private holds: Map<string, HoldBuffer> = new Map();
```

- [ ] **Step 4: Route writes through the hold buffer**

Replace `writeToSession` (`:324-333`) with:

```ts
  public writeToSession(sessionId: string, data: string) {
    const hold = this.holds.get(sessionId);
    if (hold?.isHolding) {
      const result = hold.offer(data);
      if (result === 'held') return;
      if (result === 'full') {
        // Loud rather than silent: a dropped keystroke is indistinguishable
        // from a terminal that has stopped responding.
        console.warn(`[pty] input held for ${sessionId} is full; keystroke refused`);
        return;
      }
    }
    this.sendWrite(sessionId, data);
  }

  /**
   * Write to a session without passing through the hold buffer.
   *
   * The delivery machinery writes the command line itself, so it must not be
   * held by the very buffer it opened.
   */
  private sendWrite(sessionId: string, data: string) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingWrites.push({ sessionId, data });
      return;
    }
    this.send({
      action: 'Write',
      payload: { id: sessionId, data },
    });
  }
```

- [ ] **Step 5: Make submission two-act**

Replace `submitCommandToSession` (`:339-351`) with:

```ts
  public submitCommandToSession(sessionId: string, command: string) {
    if (command.includes('\n')) {
      // A multi-line command goes as a bracketed paste, which the shell takes as
      // one unit — there is no partially-typed line to verify.
      this.sendWrite(sessionId, `\x1b[200~${command}\x1b[201~\n`);
      return;
    }

    // A delivery still in flight is superseded: two of them interleaving would
    // splice their lines together in the shell's editor.
    this.deliveries.get(sessionId)?.();

    // const, not let: TypeScript does not narrow a captured `let` inside the
    // closure below, so a conditionally-assigned one reads as possibly undefined.
    const hold = this.holds.get(sessionId) ?? new HoldBuffer();
    this.holds.set(sessionId, hold);
    hold.hold();

    const cancel = deliverCommand(
      {
        write: (data) => this.sendWrite(sessionId, data),
        onData: (cb) =>
          this.registerSessionHandler(sessionId, { onOutput: (chunk) => cb(chunk) }),
      },
      command,
      (outcome) => {
        this.deliveries.delete(sessionId);
        // Keys typed during the window are the user's next input, not part of
        // this command. They go out only once the line has left the pane, and
        // are dropped outright if it never did.
        if (outcome === 'cancelled') {
          hold.discard();
          return;
        }
        for (const data of hold.flush()) this.sendWrite(sessionId, data);
      }
    );
    this.deliveries.set(sessionId, cancel);
  }
```

- [ ] **Step 6: Release the session's delivery state when it is killed**

Replace `killSession` (`:375-380`) with:

```ts
  public killSession(sessionId: string) {
    // Cancel before the kill: a delivery left in flight would keep its retry
    // timer alive and write into a session that no longer exists.
    this.deliveries.get(sessionId)?.();
    this.deliveries.delete(sessionId);
    this.holds.delete(sessionId);
    this.send({
      action: 'Kill',
      payload: { id: sessionId },
    });
  }
```

- [ ] **Step 7: Verify**

Run: `npx vitest run src/core/ptyClient.test.ts`
Expected: PASS, 9 tests.

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all suites pass.

- [ ] **Step 8: Commit**

```bash
git add src/core/ptyClient.ts src/core/ptyClient.test.ts
git commit -m "feat(pty): echo-verify command delivery and hold input during it"
```

---

## Verification

- [ ] `npx tsc --noEmit` — no errors
- [ ] `npm test` — all pass
- [ ] `cargo test --manifest-path crates/doom-term-pty/Cargo.toml` — unaffected, still green
- [ ] `npm run build` — production bundle still resolves
- [ ] Live, per `doom-term-two-tabs-fight-over-sessions`: **close duplicate browser tabs first.**
  - Switch tabs repeatedly with output running in both; neither pane should flash, lose its scroll position, or come back at the wrong size
  - Type into a pane, switch away and back; the keyboard should come back to the visible pane and nothing should be swallowed
  - Launch an agent (`claude`, `codex`, `agy`) from the block editor; it should start every time, with no shell left at `quote>`
  - Type immediately after pressing Enter on a command; the characters should appear after the command runs, never inside it
