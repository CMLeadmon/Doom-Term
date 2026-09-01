# Direction B — Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three interactions the plate-only window still lacks — reading back through scrollback, being summoned by a blocked agent, and operating every session from one surface.

**Architecture:** A spike comes first, because Enhancements 2 and 3 both rest on detecting that an agent is asking a question, and that is the one thing in this design that might not work. Enhancement 1 is independent of the spike and can proceed in parallel. All three follow the same principle established in the visual plan: **the plate re-tools for the mode you are in**, because once the tab strip and the sidebar are gone there is nowhere else for a mode's controls to live.

**Tech Stack:** React 19 + TypeScript + Vite; `@xterm/headless` + `@xterm/addon-search` + `@xterm/addon-serialize` (all MIT); `plate.js` plain ES module; vitest + `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-31-doom-term-direction-b-design.md` §4 and §7. The visual plan (`2026-08-31-direction-b-visual.md`) is a prerequisite and is already merged.

## Global Constraints

All constraints from the visual plan still bind. In addition:

- **`plateSpec(480)` must keep deep-equalling `PLATE_480`.** `src/hud/spec.test.js` locks it; the transport must not add geometry that breaks it.
- **The centre zone is the only elastic member.** Every new plate mode draws inside `spec.zoneX .. zoneX + zoneW` and nowhere else. `src/hud/waiting.test.js` established the containment pattern — copy it for each new mode.
- **Left and right groups never change between modes.** Context, usage, sandbox and tokens are true whatever you are doing.
- **The app never blocks a command.** It has no standing to: in pass-through the agent types straight into the PTY. It only ever *notices* that an agent is blocked on you. Anything that reads as a gate is out of scope by decision (spec §3.6).
- **Licensing.** xterm.js and its addons are MIT and may be used directly. **nodeterm is BUSL-1.1 — techniques only, never code or comments.** Warp is closed source and contributes nothing but publicly observable ideas. Keep `THIRD-PARTY-NOTICES.md` accurate.
- **Gates for every task:** `npm run build` clean, `npm test` green (**233 baseline**: 43 `node --test` + 190 vitest), `npm run hud:check` green. Test counts only go up.

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `docs/superpowers/specs/2026-08-31-agent-question-detection.md` | *(new)* The spike's findings | 1 |
| `src/core/scrollback.ts` | *(new)* Detach state, position, search over the xterm buffer | 2 |
| `src/core/turnMarks.ts` | *(new)* Where each agent turn begins | 3 |
| `src/hud/plate.js` | `drawTransport` — the centre's second mode | 4 |
| `src/core/agentQuestion.ts` | *(new)* Detects a blocked agent; answer key table | 5 |
| `src/components/Summons.tsx` | *(new)* The full-sheet ask | 6 |
| `src/components/Rack.tsx` | *(new)* Every session at once, operable | 8 |
| `src/core/rackSlots.ts` | *(new)* Cells plus the next free creation slot | 9 |

---

## Task 1: SPIKE — can we tell that an agent is asking a question?

**This is a spike, not a feature.** Its output is an answer and a written finding, not code you keep. Enhancements 2 and 3 do not start until it lands. If the answer is no, both are redesigned or dropped — say so rather than building on a guess.

**Why it is first:** a false positive steals your screen while you are mid-thought. A miss parks an agent forever. Both failures are worse than not having the feature, which is not true of most things worth building.

- [ ] **Step 1: Capture real transcripts**

Run each agent to a genuine yes/no prompt and capture the raw PTY bytes. Do not paraphrase — the escape sequences are the subject.

```bash
mkdir -p .artifacts/question-probes
# For each of: claude, codex, agy
script -q -c "claude" .artifacts/question-probes/claude.raw
# drive it to a permission prompt, answer, exit
```

- [ ] **Step 2: Answer these four questions in writing**

For each agent, record:

1. **Is there a stable textual marker?** (e.g. `Do you want to proceed?`, a boxed menu, `❯` on an option row.) Quote it exactly, with surrounding bytes.
2. **Is there a non-textual signal?** Cursor-position report, a specific DECSET, a bell. These are far more robust than prose, which is localised and reworded between releases.
3. **What key answers it?** `y`, `1`, `Enter` on a highlighted row, arrow-then-Enter. This is the table Task 5 needs.
4. **Does the vendor expose a hook?** Claude Code has hooks; check whether any fire on permission prompts specifically. A hook beats every heuristic and is the nodeterm technique referenced in `2026-08-29-nodeterm-portable-improvements.md` §5.

- [ ] **Step 3: Write the finding**

Create `docs/superpowers/specs/2026-08-31-agent-question-detection.md`. It must state, per agent: the detection signal, its confidence, the answer keys, and the false-positive risk. If any agent has no reliable signal, say so plainly and recommend either excluding it or shipping Enhancement 2 in a notify-only form (list it as waiting, never take the screen).

- [ ] **Step 4: Decide, and record the decision**

Three outcomes, all acceptable:

- **Hooks available** → build on hooks, pattern-match only as fallback. Proceed to Task 5.
- **Pattern only, high confidence** → proceed to Task 5 with a per-agent table and a conservative default of *not* summoning.
- **No reliable signal** → **stop.** Enhancements 2 and 3 lose their answer-in-place behaviour. The rack still works as a viewer and a launcher (Tasks 8–10), and Enhancement 1 is unaffected. Update the spec, then skip to Task 8.

- [ ] **Step 5: Commit the finding**

```bash
git add docs/superpowers/specs/2026-08-31-agent-question-detection.md
git commit -m "docs: spike findings on agent question detection

Records what each agent CLI actually emits when it blocks on a yes/no, which
key answers it, and how confident the signal is. Enhancements 2 and 3 rest
entirely on this."
```

---

## Enhancement 1 — Reading back

Independent of the spike. Can start immediately.

### Task 2: Scrollback position and search over the xterm buffer

The app already runs `@xterm/headless` (`src/core/xtermScreen.ts`), so search comes from xterm.js rather than being hand-rolled. This is the highest-leverage borrow available and it retires code rather than adding it — the same argument `2026-08-29-nodeterm-portable-improvements.md` §1 makes about the emulator generally.

**Files:**
- Create: `src/core/scrollback.ts`, `src/core/scrollback.test.ts`
- Modify: `package.json` (add `@xterm/addon-search`)
- Modify: `THIRD-PARTY-NOTICES.md`

**Interfaces:**
- Produces: `ScrollbackState = { detached: boolean; line: number; total: number; query: string; hit: number; hits: number }`, and `scrollbackOf(sessionId) → ScrollbackState`. Task 4 draws it; Task 3 adds turn marks to it.

- [ ] **Step 1: Verify the addon works headless before designing around it**

`@xterm/addon-search` is documented against `@xterm/xterm`, not `@xterm/headless`. It operates on the buffer, so it *should* work — but confirm before building on it.

```bash
npm install @xterm/addon-search
node --input-type=module -e "
import { Terminal } from '@xterm/headless';
import { SearchAddon } from '@xterm/addon-search';
const t = new Terminal({ allowProposedApi: true, scrollback: 1000 });
const s = new SearchAddon();
t.loadAddon(s);
t.write('alpha\r\nbeta resize gamma\r\nresize\r\n', () => {
  console.log('findNext:', s.findNext('resize'));
});
"
```

Expected: prints `findNext: true`. **If it throws because the addon needs a renderer, stop and record that** — the fallback is to search `xtermLines.ts` output directly, which is more code but no new dependency. Choose before writing tests.

- [ ] **Step 2: Write the failing test**

Create `src/core/scrollback.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { attach, detach, reattach, search, stateOf, resetScrollback } from './scrollback';

describe('scrollback', () => {
  beforeEach(() => resetScrollback());

  it('follows the tail until you scroll away from it', () => {
    attach('s1', 100);
    expect(stateOf('s1').detached).toBe(false);
    detach('s1', 40);
    expect(stateOf('s1')).toMatchObject({ detached: true, line: 40, total: 100 });
  });

  it('reattaching returns you to the tail', () => {
    attach('s1', 100);
    detach('s1', 40);
    reattach('s1');
    expect(stateOf('s1')).toMatchObject({ detached: false, line: 100 });
  });

  it('reports hit position as one-based so it reads as "3 of 17"', () => {
    attach('s1', 100);
    search('s1', 'resize', [10, 20, 30]);
    expect(stateOf('s1')).toMatchObject({ query: 'RESIZE', hit: 1, hits: 3 });
  });

  it('an empty query clears the hits rather than reporting zero of zero', () => {
    attach('s1', 100);
    search('s1', 'resize', [10]);
    search('s1', '', []);
    expect(stateOf('s1')).toMatchObject({ query: '', hits: 0 });
  });

  it('a session with no scrollback state reports attached, not undefined', () => {
    expect(stateOf('never-seen')).toMatchObject({ detached: false, hits: 0 });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/core/scrollback.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `src/core/scrollback.ts`. Mutable module state, not React state, for the same reason `activityMonitor` is: this is written on scroll and on every keystroke of a query, and neither belongs in storage.

```ts
export interface ScrollbackState {
  detached: boolean;
  /** One-based line the viewport is showing, or `total` when following. */
  line: number;
  total: number;
  /** Uppercased for the plate, which has no lowercase glyphs. */
  query: string;
  /** One-based, so it reads as "3 of 17". Zero when there are no hits. */
  hit: number;
  hits: number;
}

const ATTACHED: ScrollbackState = {
  detached: false, line: 0, total: 0, query: '', hit: 0, hits: 0,
};

const state = new Map<string, ScrollbackState>();

/** Following the tail is a MODE, not a position — so it stores no offset. */
export function attach(id: string, total: number): void {
  state.set(id, { ...ATTACHED, total, line: total });
}

export function detach(id: string, line: number): void {
  const s = state.get(id) ?? { ...ATTACHED };
  state.set(id, { ...s, detached: true, line });
}

export function reattach(id: string): void {
  const s = state.get(id) ?? { ...ATTACHED };
  state.set(id, { ...s, detached: false, line: s.total });
}

export function search(id: string, query: string, hitLines: number[]): void {
  const s = state.get(id) ?? { ...ATTACHED };
  state.set(id, {
    ...s,
    query: query.toUpperCase(),
    hits: hitLines.length,
    hit: hitLines.length ? 1 : 0,
  });
}

export function stateOf(id: string): ScrollbackState {
  return state.get(id) ?? ATTACHED;
}

export function resetScrollback(): void {
  state.clear();
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run src/core/scrollback.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Record the dependency**

Add to `THIRD-PARTY-NOTICES.md` under the existing xterm entry:

```markdown
## @xterm/addon-search — MIT

Copyright (c) The xterm.js authors. <https://github.com/xtermjs/xterm.js>
```

- [ ] **Step 7: Full gate and commit**

```bash
npm test && npm run build && npm run hud:check
git add -A
git commit -m "feat(scrollback): detach state, position and search over the xterm buffer

Search comes from @xterm/addon-search (MIT) rather than being hand-rolled;
the app already runs @xterm/headless, so this retires code rather than adding
it. Following the tail is a mode, not a position, so it stores no offset."
```

### Task 3: Turn marks in the gutter

The block view's rails, reduced to what they were actually for. You do not need blocks to have boundaries — you need marks.

**Files:**
- Create: `src/core/turnMarks.ts`, `src/core/turnMarks.test.ts`
- Modify: `src/components/RawTerminalView.tsx`

**Interfaces:**
- Consumes: the spike's per-agent findings from Task 1 (Step 2, question 1) for the prompt shapes.
- Produces: `turnStarts(lines: AnsiLine[], agent: string | null) → Set<number>`.

- [ ] **Step 1: Write the failing test**

Create `src/core/turnMarks.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { turnStarts } from './turnMarks';

const lines = (...texts: string[]) =>
  texts.map((t, i) => ({ id: String(i), spans: [{ text: t }], isError: false }));

describe('turnStarts', () => {
  it('marks a claude turn at its prompt marker', () => {
    const ls = lines('  reading file', '> fix the resize path', '  edit ptyClient.ts');
    expect(turnStarts(ls as never, 'claude')).toEqual(new Set([1]));
  });

  it('marks nothing for a bare shell — there are no turns to mark', () => {
    const ls = lines('$ ls', 'a  b  c', '$ pwd');
    expect(turnStarts(ls as never, null).size).toBe(0);
  });

  it('does not mark a marker that appears mid-line', () => {
    // A diff line containing "> " is not the start of a turn.
    const ls = lines('  -  if (x) { return > y; }');
    expect(turnStarts(ls as never, 'claude').size).toBe(0);
  });

  it('is empty rather than throwing for an unknown agent', () => {
    expect(turnStarts(lines('> hello') as never, 'some-new-agent').size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/core/turnMarks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/core/turnMarks.ts`. **Fill the table from the spike's findings, not from memory** — the patterns below are the shape, and Task 1 supplies the contents.

```ts
import type { AnsiLine } from '../types/terminal';

/**
 * Where each agent's turn begins, per agent.
 *
 * Populated from docs/superpowers/specs/2026-08-31-agent-question-detection.md.
 * An agent with no entry gets no marks, which is the honest outcome: a gutter
 * mark in the wrong place is worse than no mark, because it is a boundary you
 * will navigate to and find nothing at.
 *
 * Anchored to the start of the line on purpose. A diff line containing "> " is
 * not the start of a turn, and an unanchored match finds several per screen.
 */
const TURN_START: Record<string, RegExp> = {
  claude: /^>\s/,
  codex: /^>\s/,
  antigravity: /^>\s/,
};
TURN_START.agy = TURN_START.antigravity;

export function turnStarts(lines: AnsiLine[], agent: string | null): Set<number> {
  const pattern = agent ? TURN_START[agent] : undefined;
  if (!pattern) return new Set();
  const out = new Set<number>();
  lines.forEach((line, i) => {
    const text = line.spans.map((s) => s.text).join('');
    if (pattern.test(text)) out.add(i);
  });
  return out;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/core/turnMarks.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Draw the gutter**

In `src/components/RawTerminalView.tsx`, give each rendered line a 16px gutter column and a 4px mark at a turn start. No card, no border, no header, no hover controls — four pixels is the whole feature.

```tsx
  const marks = turnStarts(lines, agentKey);
  // ...
        {lines.map((line, i) => (
          <div key={line.id} className="grid" style={{ gridTemplateColumns: '16px 1fr' }}>
            <i
              aria-hidden="true"
              className="block w-1 h-[13px] mt-[3px]"
              style={{ background: marks.has(i) ? 'var(--st-live)' : 'transparent' }}
            />
            <span className="whitespace-pre">
              {line.spans.map((span, spanIdx) => (
                <span key={spanIdx} style={spanStyle(span, line.isError)}>{span.text}</span>
              ))}
            </span>
          </div>
        ))}
```

`RawTerminalView` needs the agent key back as a prop for this — it was removed in the visual plan's Task 7 because nothing used it. Re-add it as `agentKey?: string | null`, distinct from the display name the plate draws.

**This changes the grid width the shell is told about.** `useTerminalSize` measures `scrollRef`; the gutter is inside it, so the reported column count must subtract the gutter or the shell will wrap 2 columns late. Verify with `tput cols` inside a session before and after.

- [ ] **Step 6: Full gate and commit**

```bash
npm test && npm run build
git add -A
git commit -m "feat(terminal): turn marks in the gutter

The block view's rails reduced to what they were for. You do not need blocks
to have boundaries, you need marks: four pixels at the start of each agent
turn, no card and no chrome. An agent with no known prompt shape gets no
marks, because a boundary in the wrong place is worse than none."
```

### Task 4: The plate's second mode — the transport

**Files:**
- Modify: `src/hud/plate.js` (`drawTransport`, mode dispatch)
- Create: `src/hud/transport.test.js`
- Modify: `src/hud/state.ts`

**Interfaces:**
- Consumes: `ScrollbackState` from Task 2.
- Produces: plate state gains `mode: 'waiting' | 'transport'` and `transport: ScrollbackState`.

- [ ] **Step 1: Write the failing test**

Create `src/hud/transport.test.js`, copying the containment helpers from `src/hud/waiting.test.js` verbatim (repeat them — do not import across test files):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPlate, plateSpec } from './plate.js';

function assertContained(full, empty, spec, what) {
  for (let y = 0; y < spec.height; y++) {
    for (let x = 0; x < spec.width; x++) {
      if (x >= spec.zoneX && x < spec.zoneX + spec.zoneW) continue;
      const i = (y * spec.width + x) * 4;
      assert.equal(full.data[i], empty.data[i], `${what} escaped the zone at ${x},${y}`);
    }
  }
}

const T = { detached: true, line: 8412, total: 24190, query: 'RESIZE', hit: 3, hits: 17 };

test('the transport replaces the waiting column, not the whole plate', () => {
  const spec = plateSpec(720);
  const waiting = renderPlate({ mode: 'waiting', waiting: [] }, 1, spec);
  const transport = renderPlate({ mode: 'transport', transport: T }, 1, spec);
  assertContained(transport, waiting, spec, 'the transport');
});

test('an absurd query cannot overflow the zone', () => {
  const spec = plateSpec(720);
  const long = { ...T, query: 'A'.repeat(300) };
  assertContained(
    renderPlate({ mode: 'transport', transport: long }, 1, spec),
    renderPlate({ mode: 'waiting', waiting: [] }, 1, spec),
    spec, 'a 300-character query',
  );
});

test('mode defaults to waiting, so an unset mode is not a blank centre', () => {
  const spec = plateSpec(720);
  assert.deepEqual(
    Array.from(renderPlate({ waiting: [] }, 1, spec).data),
    Array.from(renderPlate({ mode: 'waiting', waiting: [] }, 1, spec).data),
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test src/hud/transport.test.js`
Expected: FAIL — transport and waiting renders are identical.

- [ ] **Step 3: Implement**

In `src/hud/plate.js`, beside `drawWaiting`:

```js
/**
 * The centre's second mode: where you are in the buffer, and what you are
 * looking for.
 *
 * This is the direct consequence of the plate being the only chrome. Once the
 * tab strip and the sidebar are gone there is nowhere else for a mode's
 * controls to live, so the centre re-tools and the left and right groups —
 * true in every mode — never move.
 *
 * The detached indicator used to be a plate button floating in the pane with a
 * CSS animate-pulse on it. It is a readout now, next to every other fact about
 * the session.
 */
function drawTransport(s, spec, t) {
  const w = spec.zoneW;
  if (w < WAITING_MIN_W) return;
  const x0 = spec.zoneX, x1 = x0 + w - 1;
  well(s, x0, 1, w, 30, C.panelFloor);

  const tx = x0 + 50, tw = (x1 - 72) - tx;
  if (tw < 20) return;

  smText(s, x0 + 4, 5, 'SCROLL', C.tanDim);
  px(s, tx, 6, tw, 4, C.wellDark);
  const frac = t.total ? Math.min(1, Math.max(0, t.line / t.total)) : 1;
  const thumb = Math.max(8, Math.round(tw * 0.12));
  px(s, tx + Math.round((tw - thumb) * frac), 6, thumb, 4, C.stLive);
  smText(s, x1 - 4, 5, `${t.line}/${t.total}`, C.value, 'right');

  // Query is truncated to the track, never past it.
  const room = Math.floor(tw / ADV_SM);
  smText(s, x0 + 4, 13, 'FIND', C.tanDim);
  smText(s, tx, 13, String(t.query).slice(0, Math.max(0, room)), C.value);
  smText(s, x1 - 4, 13, t.hits ? `${t.hit}/${t.hits}` : '0/0', C.stLive, 'right');

  smText(s, x0 + 4, 21, 'TURNS', C.tanDim);
  smText(s, x1 - 4, 21, 'END RESUMES', C.tanDim, 'right');
}
```

Add to `DEFAULT_STATE`:

```js
  mode: 'waiting',                      // 'waiting' | 'transport'
  transport: null,
```

and replace the `drawWaiting` call at the end of `drawPlate`:

```js
  // The centre re-tools for the mode; left and right never move.
  if (st.mode === 'transport' && st.transport) drawTransport(s, spec, st.transport);
  else drawWaiting(s, spec, st.waiting);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test src/hud/transport.test.js && npm run hud:check`
Expected: PASS both. A 480 plate has no zone, so the reference is unaffected.

- [ ] **Step 5: Carry it through the adapter and wire the keys**

In `src/hud/state.ts`, add `mode?: 'waiting' | 'transport'` and `transport?: ScrollbackState` to `AppTelemetry`, and pass both through `toPlateState` with explicit defaults (`mode: app.mode ?? 'waiting'`, `transport: app.transport ?? null`).

In `RawTerminalView`, scrolling away from the bottom calls `detach`; `End` or `Enter` calls `reattach`; `Ctrl+F` opens the query. `App.tsx` reads `stateOf(activeNode.id)` in the existing 150ms telemetry interval and sets `mode` accordingly.

- [ ] **Step 6: Full gate and commit**

```bash
npm test && npm run build && npm run hud:check
git add -A
git commit -m "feat(hud): the plate re-tools into a scrollback transport

Once the tab strip and the sidebar are gone there is nowhere else for a mode's
controls to live, so the centre re-tools while left and right — true in every
mode — never move. The detached indicator stops being a pulsing button in the
pane and becomes a readout."
```

---

## Enhancement 2 — The summons

**Blocked on Task 1.** Do not start until the spike has landed and its finding says a signal exists.

### Task 5: Detect a blocked agent

**Files:**
- Create: `src/core/agentQuestion.ts`, `src/core/agentQuestion.test.ts`

**Interfaces:**
- Consumes: the spike's per-agent table.
- Produces: `detectQuestion(lines, agent) → { question: string; keys: AnswerKey[] } | null`, `AnswerKey = { key: string; label: string; bytes: string }`.

- [ ] **Step 1: Write the failing test**

Use **real captured transcripts** from Task 1, committed as fixtures under `src/core/__fixtures__/`. Do not hand-write what you think an agent emits — that is how a detector passes its tests and fails in the terminal.

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { detectQuestion } from './agentQuestion';

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')
    .split('\n')
    .map((t, i) => ({ id: String(i), spans: [{ text: t }], isError: false }));

describe('detectQuestion', () => {
  it('finds the question in a real claude permission prompt', () => {
    const r = detectQuestion(fixture('claude-permission.txt') as never, 'claude');
    expect(r).not.toBeNull();
    expect(r!.keys.map((k) => k.key)).toContain('y');
  });

  it('returns null for an agent mid-generation', () => {
    expect(detectQuestion(fixture('claude-working.txt') as never, 'claude')).toBeNull();
  });

  it('returns null for a bare shell prompt — a shell is always waiting', () => {
    expect(detectQuestion(fixture('shell-idle.txt') as never, null)).toBeNull();
  });

  it('returns null for an unknown agent rather than guessing', () => {
    expect(detectQuestion(fixture('claude-permission.txt') as never, 'new-agent')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement from the spike's table**

The default must be `null`. A detector that guesses steals the screen, and the whole design rests on the summons being rare and correct.

- [ ] **Step 3: Full gate and commit**

### Task 6: The summons view

**Files:**
- Create: `src/components/Summons.tsx`, `src/components/Summons.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the failing test**

The load-bearing behaviour is **you are never moved**:

```tsx
it('answering sends the key and does not switch you to that session', () => {
  const onAnswer = vi.fn();
  const onEnter = vi.fn();
  render(<Summons session={s} question="Proceed?" keys={KEYS} onAnswer={onAnswer} onEnter={onEnter} onLater={vi.fn()} />);
  fireEvent.keyDown(window, { key: 'y' });
  expect(onAnswer).toHaveBeenCalledWith('y');
  expect(onEnter).not.toHaveBeenCalled();
});

it('Enter is the only thing that moves you', () => {
  const onEnter = vi.fn();
  render(<Summons session={s} question="Proceed?" keys={KEYS} onAnswer={vi.fn()} onEnter={onEnter} onLater={vi.fn()} />);
  fireEvent.keyDown(window, { key: 'Enter' });
  expect(onEnter).toHaveBeenCalled();
});

it('L pushes it back to the quiet list', () => { /* onLater called, onAnswer not */ });
```

- [ ] **Step 2: Implement**

A full sheet of plate with the question cut into it — the inverse of the normal relationship, which is how you know you have left the session. The material inversion is the signal; do not add a modal backdrop.

Set `telemetry.pendingApproval` while a summons is up. **The plate already renders `SANDBOX WAIT` from it** (`toPlateState`), so this costs no new plate field — only the source of the signal changes, exactly as the visual plan's Task 6 commit message anticipated.

- [ ] **Step 3: Full gate and commit**

### Task 7: Two agents blocking at once

Named separately because it is the case that will actually happen and the artifact listed it as unhandled.

- [ ] **Step 1: Write the failing test** — the second summons queues; the first is not replaced mid-read.
- [ ] **Step 2: Implement** — a queue, with the count shown in the summons header (`2 of 3 waiting on you`).
- [ ] **Step 3: Full gate and commit**

---

## Enhancement 3 — The rack

Tasks 8 and 9 do **not** depend on the spike. Task 10 (answer in place) does.

### Task 8: The rack as a viewer

**Files:**
- Create: `src/components/Rack.tsx`, `src/components/Rack.test.tsx`
- Modify: `src/App.tsx`, `src/hooks/useGlobalKeys.ts`

**Prerequisite:** every session must render while hidden, or the cells are stale. `SplitPaneGrid` already keeps every pane mounted — confirm before building on it. This is nodeterm's technique from `2026-08-29-nodeterm-portable-improvements.md` §3, independently implemented.

- [ ] **Step 1: Write the failing test** — `Ctrl+K` shows one cell per session, each with its number, name, agent and last lines; the focused cell is marked; `Escape` returns.
- [ ] **Step 2: Implement** — a full sheet of plate with recessed cells, numbered 1–9.
- [ ] **Step 3: The plate becomes the rack's detail line** — the panel follows the rack cursor, showing the highlighted cell's agent, path and branch in the same three rows it uses for the session you are in. No new plate mode: this is the existing panel with different state, which is why the plate stays visible under an overlay that replaced everything else.
- [ ] **Step 4: Full gate and commit**

### Task 9: Starting work from the rack

**Files:**
- Create: `src/core/rackSlots.ts`, `src/core/rackSlots.test.ts`

**Interfaces:**
- Consumes: `nextSessionNumber` from the visual plan's Task 4.
- Produces: `rackCells(nodes) → RackCell[]` where a cell is either a session or the next free creation slot.

- [ ] **Step 1: Write the failing test** — cells are ordered by number; exactly one creation slot is offered, carrying the next free number; no creation slot appears when all nine are taken.
- [ ] **Step 2: Implement**
- [ ] **Step 3: Wire folder and agent selection** — this replaces `WorkspaceModal` as the primary path. Keep the modal until the rack path is proven, then delete it in its own commit.
- [ ] **Step 4: Full gate and commit**

### Task 10: Answering in place

**Blocked on Task 1 and Task 5.**

- [ ] **Step 1: Write the failing test** — a waiting cell shows its question and keys; pressing the key sends bytes to *that* session, and the rack stays open and focus does not move.
- [ ] **Step 2: Implement** — reuse `detectQuestion` and the answer-key table from Task 5. No second parser.
- [ ] **Step 3: Full gate and commit**

---

## Self-Review

**Spec coverage.** §4 scrollback → Tasks 2–4. §4 summons → Tasks 5–7. §4 rack → Tasks 8–10. §7 Q1 → Task 1, which gates the rest. §7 Q2 (do split panes die?) → Task 9 Step 3 note; `SplitPaneGrid` survives as the mount-everything mechanism the rack needs, which is the honest answer: the *layouts* die, the component does not. §7 Q3 (is a session more than one process?) is **still open and still unanswered** — it decides whether the waiting list counts sessions or tasks, and it is much cheaper to settle before Task 8 than after.

**Type consistency.** `ScrollbackState` is defined in Task 2 and consumed by Task 4. `AnswerKey` is defined in Task 5 and consumed by Tasks 6 and 10 — one parser, one table, no second implementation. `nextSessionNumber` keeps its visual-plan name in Task 9.

**Known risks.**

1. **Task 1 may fail.** Its Step 4 lists all three outcomes and what to do for each. Enhancement 1 and Tasks 8–9 survive a negative result; Tasks 5–7 and 10 do not.
2. **`@xterm/addon-search` may not work headless.** Task 2 Step 1 checks this before anything is designed around it, and names the fallback.
3. **The gutter changes the reported column count** (Task 3 Step 5). If missed, every shell wraps two columns early and it will look like an emulator bug rather than a layout one.

---

## Execution log — 2026-08-31

**Task 1 (spike): done.** Answer is yes for Claude Code and Codex via
`PermissionRequest` / `permission_request`, no for agy. See
`docs/superpowers/specs/2026-08-31-agent-question-detection.md`. It also found
that **nodeterm already holds both hook slots on this machine**, so the
installer must append rather than replace, and that `backend/src` has no hook
handling at all — Tasks 5–7 are re-scoped there into 5a–5d.

**Task 2 Step 1 (the addon gate): failed, fallback taken.**
`@xterm/addon-search` 0.16.0 loads against `@xterm/headless` 6.0.0 and then
`findNext()` throws `this._terminal.getSelectionPosition is not a function` —
it drives the terminal's selection, a renderer concern headless does not have.
The dependency was removed rather than shipped unused, and the search runs over
the `AnsiLine[]` the view already renders, exactly as this step's fallback said.

**Tasks 2, 3 and 4: done and merged.** `scrollback.ts`, `turnMarks.ts`, the
plate's `transport` mode, `useTerminalSize(…, reservedPx)`, and the wiring in
`RawTerminalView` and `App`. 221 vitest + 49 node tests green,
`hud:check` still 0 mismatched.

### Scrollback: a false alarm, and what it actually was

An earlier reading suggested the emulator retained no scrollback — `seq 1 150`
appeared to leave only 46 rows starting at line 107. **That was wrong**, and the
commit message on `1ae9812` says so incorrectly.

Re-measured after a hard reload, same command, same session:

```
getLines().length          139
scrollHeight/clientHeight  2509 / 796   (1713px of travel)
plate in transport mode    SCROLL 42/139
```

Scrollback accumulates and is scrollable. The 46-row reading came from a
session whose buffer had just been re-populated from the daemon's replay after a
page reload, so it held only what the replay carried — not what the emulator is
capable of retaining. No emulator defect, and **Task 2b is not needed**.

The real lesson is about testing method, not the emulator: measurements taken
against a hot-reloaded page are not trustworthy for anything held in module
state, because Vite replaces the module and clears the state while React keeps
its own. The `WAITING 0` reading below had the same cause.

### Verified live, 2026-08-31 (Chrome DevTools against the running app)

| Workflow | Result |
| --- | --- |
| Terminal I/O in a plain shell | Works — MOTD, prompt, command echo, output |
| New session (`Ctrl+Shift+T`) | Works; named `CLEADMON` from cwd leaf, numbered 2 |
| `Ctrl+1…9` switching | Works; `Ctrl+7` with no session 7 is a correct no-op |
| Waiting list on the plate | Works — `WAITING 1`, row `2 CLEADMON 11S`, counting up to `1M06S` |
| Scroll away from tail | Plate re-tools to `SCROLL 42/139`, thumb tracks position |
| `End` | Returns to the tail |
| Command palette (`Ctrl+P`) | Works, 10 actions, sidebar toggle correctly gone |
| Close (`Ctrl+W`) + recreate | Number 2 released and **reused**, not incremented to 3 |

**Development-only gotcha worth recording:** `activityMonitor` and `scrollback`
keep their state at module scope. A Vite hot update replaces those modules and
clears the maps while React state survives, so the waiting list reads empty
until the affected sessions emit again. Production is unaffected — there is no
HMR — but it will mislead anyone testing without a hard reload.
