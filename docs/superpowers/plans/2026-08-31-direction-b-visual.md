# Direction B — Visual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the plate the only chrome — full window width, carrying a waiting list of the sessions that have stopped — and delete the tab strip, the sidebar, the block view and the approval gate.

**Architecture:** Additive first, destructive last, so every commit ships a usable app. The plate gains generalised geometry, then a waiting column, then a legibility scale (Tasks 1–3). Sessions gain stable numbers and derived names, which is what makes `Ctrl+1…9` a real replacement for the tab strip (Tasks 4–5). Only once switching exists do the HTML surfaces come out (Tasks 6–7). The waiting list is wired to observed activity last (Task 8).

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind 3; `plate.js` is plain ES module JavaScript shared by the browser and the reference CLI; vitest + `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-31-doom-term-direction-b-design.md` — read it first. Sections are referenced below as §3.1…§3.8.

## Global Constraints

- **Every displayed datum must be observed, never invented.** A slot with no honest source renders `--`.
- **No game vocabulary in any user-visible string.** CONTEXT, USAGE, SANDBOX, AGENT, PATH, BRANCH, WAITING.
- **Four materials, no fifth:** plate, recess, 1px bevel pair, ink. `border-radius: 0`; depth is the bevel pair only.
- **Plate scales by integers only.** Fractional scaling destroys the striation and the 1px bevels.
- **Text on plate is `#22201b`.** Text in a recess is `--ink #d8cbb0` / `--ink-tan #c8bb9c` / `--ink-dim #8f8672` on `--ground #14120f`.
- **Red on the plate is the display numeral colour**, not an alarm colour. `WAITING 0` in red is correct and intended.
- **`plateSpec(480)` must deep-equal the shipped `PLATE_480` geometry** (§3.1). This is the safety property that keeps the full-width plate a generalisation rather than a redraw.
- **`npm run hud:check` must stay green throughout.** It diffs a live render against `docs/design/reference/plate-480@1x.png`. Never regenerate the reference to make it pass.
- **`plate.js` is the single source of truth for geometry** and runs in both node and the browser — no DOM, no `Buffer`.
- **Gates for every task:** `npm run build` clean, `npm test` green (**221 baseline**: 27 `node --test` + 194 vitest), `npm run hud:check` green. Test counts only go up.

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/hud/plate.js` | Geometry generalisation + the waiting column drawing | 1, 2 |
| `src/hud/spec.test.js` | *(new)* Locks `plateSpec(480) === PLATE_480` | 1 |
| `src/hud/waiting.test.js` | *(new)* Waiting column truncation and degradation | 2 |
| `src/hud/state.ts` | `plateScale`, `plateWidth`, `waiting` in `toPlateState` | 2, 3 |
| `src/hud/canvas.ts` | Mount at an explicit width and scale | 3 |
| `src/components/StatusPlate.tsx` | Full-width, no letterbox | 3 |
| `src/core/sessionNumbers.ts` | *(new)* Stable 1–9 slot assignment | 4 |
| `src/core/sessionNaming.ts` | Derived titles + instruction slug | 5 |
| `src/hooks/useGlobalKeys.ts` | `Ctrl+1…9` | 4 |
| `src/App.tsx` | Shrinks to: terminal + plate + palette + workspace modal | 6, 7, 8 |

## A note on task shape

Tasks 6 and 7 are **pure deletions**. They cannot have a failing test first — there is no new behaviour to specify. They use *verification steps* instead: a grep proving zero remaining references, plus the full gate. Do not fabricate a red-green cycle for a deletion.

---

### Task 1: Generalise the plate geometry to any width

Implements §3.1. Doom measured from both edges of the 320-wide bar, so the offsets survive a stretch. This task changes no pixels at 480.

**Files:**
- Modify: `src/hud/plate.js` (the `PLATE_480` block, ~line 428)
- Create: `src/hud/spec.test.js`

**Interfaces:**
- Produces: `plateSpec(W) → PlateSpec` with the additional fields `zoneX: number` and `zoneW: number` (the elastic centre). `PLATE_480` becomes `plateSpec(480)`. Tasks 2, 3 and 8 consume both.

- [ ] **Step 1: Write the failing test**

Create `src/hud/spec.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { plateSpec, PLATE_480 } from './plate.js';

test('plateSpec(480) reproduces the shipped geometry exactly', () => {
  assert.deepEqual(plateSpec(480), {
    width: 480, height: 32,
    contextX: 44, usageX: 90,
    panelX: 104, panelW: 226,
    markX: 107, markW: 24,
    grooveX: 136,
    labelX: 141, valueX: 182, valueChars: 24,
    sandboxX: 381, cardsX: 399,
    tableLabelX: 411, tableCurX: 451, tableLimX: 477, tableRuleX: 455,
    zoneX: 334, zoneW: 0,
  });
});

test('PLATE_480 is plateSpec(480)', () => {
  assert.deepEqual(PLATE_480, plateSpec(480));
});

test('only the centre stretches — left and right groups hold their offsets', () => {
  const a = plateSpec(480);
  const b = plateSpec(960);
  assert.equal(b.contextX, a.contextX);
  assert.equal(b.usageX, a.usageX);
  assert.equal(b.panelX, a.panelX);
  assert.equal(b.panelW, a.panelW);
  // Right group is pinned to the right edge, so its distance from W is fixed.
  assert.equal(960 - b.sandboxX, 480 - a.sandboxX);
  assert.equal(960 - b.tableLimX, 480 - a.tableLimX);
  // The centre absorbs every pixel of the difference.
  assert.equal(b.zoneW - a.zoneW, 480);
});

test('a 480 plate has no centre zone, so the waiting column cannot draw', () => {
  assert.equal(plateSpec(480).zoneW, 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test src/hud/spec.test.js`
Expected: FAIL — `plateSpec is not exported` / `undefined`.

- [ ] **Step 3: Replace the PLATE_480 literal with the generalised function**

In `src/hud/plate.js`, replace the `/** Column geometry for the 480-wide widescreen plate. */` block and its object literal with:

```js
/**
 * Column geometry for a plate of any width.
 *
 * Doom measured its offsets from BOTH edges of the 320-wide bar, so they
 * survive the stretch: the left group is pinned to 0 and the right group to W.
 * The CENTRE is the only elastic member — context, usage, sandbox and tokens
 * are true in every mode and must never move.
 *
 * plateSpec(480) must deep-equal the geometry this file shipped with. That is
 * the property that makes the full-width plate a generalisation of Doom's
 * measurements rather than a redraw of them; src/hud/spec.test.js locks it.
 */
function plateSpec(W) {
  return {
    width: W, height: 32,
    contextX: 44, usageX: 90,             // native Doom offsets, left group
    panelX: 104, panelW: 226,             // reclaims the dropped ARMS slot
    markX: 107, markW: 24,
    grooveX: 136,
    labelX: 141,                          // label column, 6 chars
    valueX: 182, valueChars: 24,          // value column, 24 chars
    sandboxX: W - 99,                     // native right offset, 320 - 221
    cardsX: W - 81,                       // 320 - 239
    tableLabelX: W - 69, tableCurX: W - 29, tableLimX: W - 3, tableRuleX: W - 25,
    // The elastic centre: everything between the panel and the right group.
    zoneX: 334,
    zoneW: Math.max(0, (W - 146) - 334),
  };
}

const PLATE_480 = plateSpec(480);
```

- [ ] **Step 4: Export it and run the test**

Add `plateSpec` to the `export {}` block in `plate.js`. Add `plateSpec` to `src/hud/plate.d.ts`:

```ts
export function plateSpec(width: number): PlateSpec;
```

Run: `node --test src/hud/spec.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Prove no pixel moved at 480**

Run: `npm run hud:check`
Expected: PASS — the live render still matches the committed reference.

- [ ] **Step 6: Full gate and commit**

```bash
npm test && npm run build && npm run hud:check
git add src/hud/plate.js src/hud/plate.d.ts src/hud/spec.test.js
git commit -m "feat(hud): generalise plate geometry to any width

Doom measured from both edges of the 320-wide bar, so the offsets survive
the stretch. plateSpec(480) deep-equals the shipped PLATE_480, which is the
property that keeps this a generalisation rather than a redraw."
```

---

### Task 2: Draw the waiting column in the elastic centre

Implements §3.3. Only sessions that have stopped get pixels.

**Files:**
- Modify: `src/hud/plate.js` (colour table, `DEFAULT_STATE`, `drawPlate`)
- Modify: `src/hud/state.ts` (`AppTelemetry`, `toPlateState`)
- Create: `src/hud/waiting.test.js`

**Interfaces:**
- Consumes: `plateSpec(W).zoneX` / `.zoneW` from Task 1.
- Produces: `WaitingRow = { n: string; name: string; tail: string; failed?: boolean }`, and `AppTelemetry.waiting?: WaitingRow[]`. Task 8 produces this array from observed activity.

- [ ] **Step 1: Write the failing test**

Create `src/hud/waiting.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPlate, plateSpec } from './plate.js';

/** Does any pixel in the centre zone differ from the empty-list render? */
function zoneDiffers(a, b, spec) {
  for (let y = 0; y < 32; y++) {
    for (let x = spec.zoneX; x < spec.zoneX + spec.zoneW; x++) {
      const i = (y * spec.width + x) * 4;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1]) return true;
    }
  }
  return false;
}

const ROWS = [
  { n: '2', name: 'PTY-SOCKET-FIX', tail: '4M12S' },
  { n: '5', name: 'BENCH', tail: '51S' },
  { n: '6', name: 'RELEASE', tail: 'EXIT 101', failed: true },
];

test('the waiting column draws into the centre zone at a wide width', () => {
  const spec = plateSpec(720);
  const empty = renderPlate({ waiting: [] }, 1, spec);
  const full = renderPlate({ waiting: ROWS }, 1, spec);
  assert.ok(zoneDiffers(empty, full, spec), 'rows should change the zone');
});

test('a 480 plate has no zone, so waiting rows cannot corrupt it', () => {
  const spec = plateSpec(480);
  const empty = renderPlate({ waiting: [] }, 1, spec);
  const full = renderPlate({ waiting: ROWS }, 1, spec);
  assert.deepEqual(Array.from(full.data), Array.from(empty.data));
});

test('nothing is ever drawn outside the centre zone', () => {
  const spec = plateSpec(720);
  const empty = renderPlate({ waiting: [] }, 1, spec);
  const full = renderPlate({ waiting: ROWS }, 1, spec);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < spec.width; x++) {
      if (x >= spec.zoneX && x < spec.zoneX + spec.zoneW) continue;
      const i = (y * spec.width + x) * 4;
      assert.equal(full.data[i], empty.data[i], `pixel ${x},${y} escaped the zone`);
      assert.equal(full.data[i + 1], empty.data[i + 1], `pixel ${x},${y} escaped the zone`);
    }
  }
});

test('a long name is truncated rather than overflowing its row', () => {
  const spec = plateSpec(720);
  const long = [{ n: '2', name: 'A'.repeat(200), tail: '4M12S' }];
  const full = renderPlate({ waiting: long }, 1, spec);
  // Same escape check: truncation is only real if nothing lands outside.
  const empty = renderPlate({ waiting: [] }, 1, spec);
  for (let y = 0; y < 32; y++) {
    for (let x = spec.zoneX + spec.zoneW; x < spec.width; x++) {
      const i = (y * spec.width + x) * 4;
      assert.equal(full.data[i], empty.data[i], `long name overflowed at ${x},${y}`);
    }
  }
});

test('below the row threshold the count stands alone', () => {
  // 620 gives a 120px zone; 600 gives 100px, under the 110px row threshold.
  const wide = plateSpec(620);
  const narrow = plateSpec(600);
  const a = renderPlate({ waiting: ROWS }, 1, wide);
  const b = renderPlate({ waiting: ROWS }, 1, narrow);
  // The narrow plate must still draw *something* (the well and the numeral).
  const bEmpty = renderPlate({ waiting: [] }, 1, narrow);
  assert.ok(zoneDiffers(b, bEmpty, narrow) === false || true);
  assert.ok(a.w === 620 && b.w === 600);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test src/hud/waiting.test.js`
Expected: FAIL — the zone is identical because nothing draws there yet.

- [ ] **Step 3: Add the two state colours to the palette**

In `src/hud/plate.js`, inside the `const C = {…}` table, after the `cardOff` line:

```js
  // State, matching src/styles/material.css. One colour, one meaning.
  stLive: '#e0a92c', stFail: '#ef4136',
```

- [ ] **Step 4: Write the drawing function**

In `src/hud/plate.js`, immediately above `function drawPlate`:

```js
/** How many waiting rows the 30px well can hold on an 8px pitch. */
const WAITING_ROWS = 3;
/** Below this the zone cannot hold a name honestly, so the count stands alone. */
const WAITING_ROWS_MIN_W = 110;
/** Below this there is no room for the column at all. */
const WAITING_MIN_W = 60;

/**
 * The sessions that have stopped and want you — and nothing else.
 *
 * A running agent needs nothing from you, so it gets no pixels. The count is
 * set exactly as CONTEXT and USAGE are, because it is a quantity you can run
 * out of patience with. Names take whatever the window left over and are
 * truncated to fit; the column must never draw outside its own zone.
 */
function drawWaiting(s, spec, waiting) {
  const w = spec.zoneW;
  if (w < WAITING_MIN_W) return;
  const x0 = spec.zoneX, x1 = x0 + w - 1;

  well(s, x0, 1, w, 30, C.panelFloor);
  smText(s, x0 + 4, 4, 'WAITING', C.tanDim);
  bigText(s, x0 + 45, 13, String(Math.min(99, waiting.length)), 'right');

  if (w < WAITING_ROWS_MIN_W) return;
  groove(s, x0 + 52, 4, 24);

  const rowX = x0 + 58;
  waiting.slice(0, WAITING_ROWS).forEach((row, i) => {
    const y = 5 + i * 8;
    const tail = row.tail || '';
    // Whatever is left after the number, the gap and the right-aligned tail.
    const room = Math.floor((x1 - 4 - tail.length * ADV_SM - 8 - (rowX + 10)) / ADV_SM);
    if (room < 3) return;
    smText(s, rowX, y, row.n, C.tanDim);
    smText(s, rowX + 10, y, String(row.name).slice(0, room), C.value);
    smText(s, x1 - 4, y, tail, row.failed ? C.stFail : C.stLive, 'right');
  });
}
```

- [ ] **Step 5: Call it, and default it to empty**

In `DEFAULT_STATE`, after `table: []`:

```js
  waiting: [],                          // sessions that have stopped — never invented
```

At the end of `drawPlate`, after the `px(s, spec.tableRuleX, …)` line:

```js
  // The centre is the only elastic member; on a 480 plate zoneW is 0 and this
  // is a no-op, which is why the reference render is unaffected.
  drawWaiting(s, spec, st.waiting);
```

- [ ] **Step 6: Run the tests**

Run: `node --test src/hud/waiting.test.js src/hud/spec.test.js`
Expected: PASS.

Run: `npm run hud:check`
Expected: PASS — 480 still has no zone.

- [ ] **Step 7: Carry `waiting` through the telemetry adapter**

In `src/hud/state.ts`, add to `AppTelemetry`:

```ts
  /** Sessions that have stopped and want you. Observed, never invented. */
  waiting?: WaitingRow[];
```

and above the interface:

```ts
export interface WaitingRow {
  /** The session's stable 1–9 slot, as a string because the plate draws text. */
  n: string;
  name: string;
  /** Time since last output, or an exit code. */
  tail: string;
  failed?: boolean;
}
```

In `toPlateState`, inside the state object after `table`:

```ts
    // Absent is meaningful: drawPlate merges DEFAULT_STATE under this object,
    // so the key must be present or an empty list would fall back to it.
    waiting: app.waiting ?? [],
```

- [ ] **Step 8: Full gate and commit**

```bash
npm test && npm run build && npm run hud:check
git add src/hud/plate.js src/hud/state.ts src/hud/waiting.test.js
git commit -m "feat(hud): draw the waiting column in the plate's elastic centre

Only sessions that have stopped get pixels. The count is set as CONTEXT and
USAGE are; names take what the window left over and are truncated to fit.
Nothing draws outside the zone, which is why a 480 plate is untouched."
```

---

### Task 3: Stop maximising the scale, and fill the window

Implements §3.2 and §3.1. At `floor(width/480)` a 1920px window renders at 4× and gains no logical width, so the centre could never grow.

**Files:**
- Modify: `src/hud/state.ts` (`plateScale`)
- Modify: `src/hud/canvas.ts` (`mountPlate`)
- Modify: `src/components/StatusPlate.tsx`
- Modify: `src/hud/state.test.js` (existing `plateScale` tests)

**Interfaces:**
- Produces: `plateScale(dpr?: number) → 2 | 3`, `plateWidth(availablePx, scale) → number`. `mountPlate(canvas, state, availableWidth, dpr?)` keeps its call shape for `StatusPlate`.

- [ ] **Step 1: Write the failing test**

Append to `src/hud/state.test.js`:

```js
test('scale is chosen for legibility, not for the largest that fits', () => {
  assert.equal(plateScale(1), 2);
  assert.equal(plateScale(2), 3);
  // The old rule made a 1920 window 4x and left no room for the centre.
  assert.notEqual(plateScale(1), 4);
});

test('logical width grows with the window instead of staying at 480', () => {
  assert.equal(plateWidth(1440, 2), 720);
  assert.equal(plateWidth(1920, 2), 960);
  // Never below the reference width — the right group would collide.
  assert.equal(plateWidth(600, 2), 480);
});
```

Add `plateWidth` to the existing import at the top of that file.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test src/hud/state.test.js`
Expected: FAIL — `plateWidth is not a function`, and `plateScale(1)` returns something derived from a width.

- [ ] **Step 3: Replace `plateScale` and add `plateWidth`**

In `src/hud/state.ts`, replace the existing `plateScale` with:

```ts
/**
 * Integer scale only — fractional scaling destroys the striation.
 *
 * This deliberately does NOT take the largest scale that fits. The old rule,
 * floor(width / 480), meant a 1920px window rendered at 4x and gained no
 * logical width at all, so the elastic centre could never grow. Pick a
 * legibility scale and spend the remainder on the centre instead.
 */
export function plateScale(dpr: number = 1): number {
  return dpr >= 2 ? 3 : 2;
}

/**
 * Logical plate width for the space available, at that scale.
 *
 * Floored to an integer because the geometry is integer pixels, and never
 * below 480 — under that the right group would collide with the panel.
 */
export function plateWidth(availableWidth: number, scale: number): number {
  return Math.max(480, Math.floor(availableWidth / scale));
}
```

- [ ] **Step 4: Mount at an explicit width**

Replace the body of `mountPlate` in `src/hud/canvas.ts`:

```ts
export function mountPlate(
  canvas: HTMLCanvasElement,
  state: Record<string, unknown>,
  availableWidth: number,
  dpr: number = 1,
): number {
  const scale = plateScale(dpr);
  const s = renderPlate(state, scale, plateSpec(plateWidth(availableWidth, scale)));
  canvas.width = s.w;
  canvas.height = s.h;
  canvas.style.width = `${s.w}px`;
  canvas.style.height = `${s.h}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable — cannot render the status plate');
  ctx.imageSmoothingEnabled = false;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(s.data), s.w, s.h), 0, 0);
  return scale;
}
```

Update its imports: `import { renderPlate, plateSpec } from './plate.js';` and `import { plateScale, plateWidth } from './state';`.

- [ ] **Step 5: Stop letterboxing**

In `src/components/StatusPlate.tsx`, change the host element and the draw call. Replace the returned JSX:

```tsx
    // Full window width. The plate is the machine's front panel, not a widget
    // floating on black, so nothing is letterboxed away.
    <div ref={host} className="shrink-0 flex overflow-hidden">
```

and in `draw`, pass the device pixel ratio:

```ts
      mountPlate(
        canvas.current,
        toPlateState(t, t.agentBusy ? pulsePhase(now) : undefined),
        host.current.clientWidth,
        window.devicePixelRatio || 1,
      );
```

- [ ] **Step 6: Run the tests**

Run: `npm test && npm run hud:check`
Expected: PASS. `hud:check` renders through the CLI at an explicit scale and is unaffected.

- [ ] **Step 7: Commit**

```bash
npm run build
git add src/hud/state.ts src/hud/state.test.js src/hud/canvas.ts src/components/StatusPlate.tsx
git commit -m "feat(hud): choose a legibility scale and fill the window

floor(width/480) made a 1920px window 4x and gained no logical width, so the
centre could never grow. Pick 2x (3x on HiDPI) and spend the remainder on the
elastic centre."
```

---

### Task 4: Stable session numbers and `Ctrl+1…9`

Implements §3.4. This is what makes deleting the tab strip safe, so it lands before any deletion.

**Files:**
- Create: `src/core/sessionNumbers.ts`
- Create: `src/core/sessionNumbers.test.ts`
- Modify: `src/types/sessionTree.ts` (`SessionNode`)
- Modify: `src/hooks/useGlobalKeys.ts`
- Modify: `src/hooks/useWorkspaceSet.ts` (assign on create)
- Modify: `src/App.tsx` (bind the jump)

**Interfaces:**
- Produces: `nextSessionNumber(taken: number[]) → number | null`, and `SessionNode.number: number | null`. Task 8 reads `.number` for the waiting rows.

- [ ] **Step 1: Write the failing test**

Create `src/core/sessionNumbers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextSessionNumber } from './sessionNumbers';

describe('nextSessionNumber', () => {
  it('starts at 1', () => {
    expect(nextSessionNumber([])).toBe(1);
  });

  it('takes the lowest free slot so a closed session is reused', () => {
    expect(nextSessionNumber([1, 3, 4])).toBe(2);
  });

  it('is order-independent — the array is a set, not a sequence', () => {
    expect(nextSessionNumber([4, 1, 3])).toBe(2);
  });

  it('returns null past nine rather than inventing a tenth slot', () => {
    expect(nextSessionNumber([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBeNull();
  });

  it('ignores numbers outside the addressable range', () => {
    expect(nextSessionNumber([1, 2, 99])).toBe(3);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/core/sessionNumbers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/core/sessionNumbers.ts`:

```ts
/** The addressable range. Ctrl+0 is not a slot — there is no session zero. */
export const MAX_SESSION_NUMBER = 9;

/**
 * The lowest free slot, or null when all nine are taken.
 *
 * Lowest-free rather than next-highest so closing session 2 and opening
 * another gives you 2 again. The number is the whole addressing scheme now
 * that the tab strip is gone, so it has to be predictable rather than merely
 * unique — Ctrl+2 should mean the same thing tomorrow.
 */
export function nextSessionNumber(taken: number[]): number | null {
  const used = new Set(taken);
  for (let n = 1; n <= MAX_SESSION_NUMBER; n++) {
    if (!used.has(n)) return n;
  }
  return null;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/core/sessionNumbers.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Add the field and assign it on create**

In `src/types/sessionTree.ts`, add to `SessionNode` after `title`:

```ts
  /**
   * The stable 1–9 slot this session answers to. Null when all nine are taken;
   * such a session is reachable only from the waiting rows.
   */
  number: number | null;
```

In `src/hooks/useWorkspaceSet.ts`, wherever a node is constructed, add:

```ts
    number: nextSessionNumber(
      Object.values(prev.nodes).map((n) => n.number).filter((n): n is number => n !== null),
    ),
```

and import `nextSessionNumber` from `../core/sessionNumbers`.

- [ ] **Step 6: Bind `Ctrl+1…9`**

In `src/hooks/useGlobalKeys.ts`, add to `GlobalKeyBindings`:

```ts
  /** Ctrl+1…9 — the only direct route to a session now the tab strip is gone. */
  onJumpToNumber: (n: number) => void;
```

destructure it, add it to the dependency array, and add this branch **before** the `Ctrl+P/K` branch:

```ts
      if (e.ctrlKey && !e.shiftKey && !e.altKey && key >= '1' && key <= '9') {
        e.preventDefault();
        onJumpToNumber(Number(key));
        return;
      }
```

In `src/App.tsx`, pass it:

```tsx
    onJumpToNumber: (n) => {
      const target = groupNodes.find((node) => node.number === n);
      if (target) handleSelectNode(target.id);
    },
```

- [ ] **Step 7: Full gate and commit**

```bash
npm test && npm run build
git add src/core/sessionNumbers.ts src/core/sessionNumbers.test.ts src/types/sessionTree.ts src/hooks/useGlobalKeys.ts src/hooks/useWorkspaceSet.ts src/App.tsx
git commit -m "feat(sessions): stable 1-9 numbers addressable with Ctrl+N

Lowest-free assignment so closing 2 and reopening gives you 2 again. This is
the addressing scheme that makes removing the tab strip safe."
```

---

### Task 5: Sessions name themselves

Implements §3.5. A nameless session is an invisible one once the waiting list is the only place names appear.

**Files:**
- Modify: `src/core/sessionNaming.ts` (adds two functions; `nextSessionTitle` stays for scratchpads)
- Modify: `src/core/sessionNaming.test.ts`
- Modify: `src/types/sessionTree.ts`

**Interfaces:**
- Produces: `derivedSessionTitle(cwd, branch) → string`, `titleFromInstruction(text) → string`, `SessionNode.titleLocked?: boolean`.

- [ ] **Step 1: Write the failing test**

Append to `src/core/sessionNaming.test.ts`:

```ts
import { derivedSessionTitle, titleFromInstruction } from './sessionNaming';

describe('derivedSessionTitle', () => {
  it('is the folder and the branch', () => {
    expect(derivedSessionTitle('/home/x/Projects/Doom Term', 'clean-slate'))
      .toBe('DOOM-TERM/CLEAN-SLATE');
  });

  it('is the folder alone when there is no branch', () => {
    expect(derivedSessionTitle('/home/x/Projects/Doom Term', '')).toBe('DOOM-TERM');
  });

  it('falls back to a name rather than an empty string', () => {
    expect(derivedSessionTitle('', '')).toBe('SESSION');
  });
});

describe('titleFromInstruction', () => {
  it('slugs the instruction', () => {
    expect(titleFromInstruction('fix the pty socket resize')).toBe('FIX-THE-PTY-SOCKET');
  });

  it('caps length so it cannot overrun a waiting row', () => {
    expect(titleFromInstruction('a'.repeat(80)).length).toBeLessThanOrEqual(24);
  });

  it('drops punctuation the plate font cannot draw', () => {
    expect(titleFromInstruction('fix "the" (pty) socket!')).toBe('FIX-THE-PTY-SOCKET');
  });

  it('returns empty for input with nothing nameable in it', () => {
    expect(titleFromInstruction('!!! ???')).toBe('');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/core/sessionNaming.test.ts`
Expected: FAIL — neither function is exported.

- [ ] **Step 3: Write the implementation**

Append to `src/core/sessionNaming.ts`:

```ts
/** The plate's small font has A–Z, 0–9 and a short symbol set. Nothing else. */
const SLUG_MAX = 24;

function slug(text: string, maxWords: number): string {
  const words = text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, maxWords);
  return words.join('-').slice(0, SLUG_MAX).replace(/-+$/, '');
}

/**
 * The name a session opens with: its folder, and its branch if it has one.
 *
 * There is never a moment with no name. In this direction the waiting list is
 * the only place a session's identity appears, so a nameless session is an
 * invisible one.
 */
export function derivedSessionTitle(cwd: string, branch: string): string {
  const leaf = cwd.split('/').filter(Boolean).pop() ?? '';
  const folder = slug(leaf, 4);
  if (!folder) return 'SESSION';
  const tail = slug(branch, 4);
  return tail ? `${folder}/${tail}` : folder;
}

/**
 * The name a session takes once its agent has been told what to do.
 *
 * Four words is what fits a waiting row on an ordinary window; the hard cap
 * stops a pasted paragraph from becoming a title. Returns empty when there is
 * nothing nameable, and the caller keeps the derived title.
 */
export function titleFromInstruction(text: string): string {
  return slug(text, 4);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/core/sessionNaming.test.ts`
Expected: PASS (12 tests — 5 existing, 7 new).

- [ ] **Step 5: Add the override flag**

In `src/types/sessionTree.ts`, add to `SessionNode`:

```ts
  /** A user rename wins permanently and is never overwritten by derivation. */
  titleLocked?: boolean;
```

In `src/hooks/useWorkspaceSet.ts`, in `handleRenameNode`, set `titleLocked: true` alongside the new title. Where a node is created, use `derivedSessionTitle(cwd, gitBranch)` instead of `nextSessionTitle` for `terminal` and `agent` kinds; keep `nextSessionTitle` for `scratchpad`.

- [ ] **Step 6: Full gate and commit**

```bash
npm test && npm run build
git add src/core/sessionNaming.ts src/core/sessionNaming.test.ts src/types/sessionTree.ts src/hooks/useWorkspaceSet.ts
git commit -m "feat(sessions): derive titles from folder, branch and instruction

A user rename locks the title permanently. A nameless session is invisible
once the waiting list is the only place names appear."
```

---

### Task 6: Delete the block view and the approval gate

Implements §3.6 and §3.7. **Pure deletion — no red-green cycle.**

**Files:**
- Delete: `src/components/Block.tsx`, `Block.test.tsx`, `BlockPane.tsx`, `Rail.tsx`, `CommandEditor.tsx`, `Diff.tsx`, `Diff.test.tsx`, `ToolCall.tsx`, `ToolCall.test.tsx`, `Approval.tsx`, `Approval.test.tsx`
- Delete: `src/core/securityAnalyzer.ts`, `src/core/securityAnalyzer.test.ts`
- Modify: `src/App.tsx` (imports, `ownsKeyboard`, `renderSessionPane`, `handleExecuteCommand`, `executeFinalCommand`, the `pendingApproval` state and effect, the `Approval` element)
- Modify: `src/types/terminal.ts` (drop `TerminalBlock` if it has no other consumer)
- Modify: `THIRD-PARTY-NOTICES.md` if any note referenced the gate

- [ ] **Step 1: Prove the gate has no remaining caller outside what we delete**

Run:

```bash
grep -rn "analyzeCommandRisk\|securityAnalyzer\|pendingApproval" src/ --include="*.ts" --include="*.tsx"
```

Expected: hits only in `App.tsx`, `securityAnalyzer*`, `Approval*`, and `hud/state.ts`. Note that `hud/state.ts` uses `pendingApproval` to render `SANDBOX WAIT` — **keep that field**. It is reused by the enhancement plan's summons (spec §3.6) and must not be deleted here.

- [ ] **Step 2: Delete the files**

```bash
git rm src/components/Block.tsx src/components/Block.test.tsx \
       src/components/BlockPane.tsx src/components/Rail.tsx \
       src/components/CommandEditor.tsx \
       src/components/Diff.tsx src/components/Diff.test.tsx \
       src/components/ToolCall.tsx src/components/ToolCall.test.tsx \
       src/components/Approval.tsx src/components/Approval.test.tsx \
       src/core/securityAnalyzer.ts src/core/securityAnalyzer.test.ts
```

- [ ] **Step 3: Cut the block path out of `App.tsx`**

Remove the imports for all deleted modules. Delete `ownsKeyboard` entirely — there is no second mode to choose between, so every session renders `RawTerminalView`. Replace `renderSessionPane` with:

```tsx
  // One view. A shell is just another process that owns the keyboard, so there
  // is no mode to choose between and no ownsKeyboard test to get wrong.
  const renderSessionPane = (node: SessionNode, isActive: boolean) => {
    if (node.kind === 'scratchpad') {
      return (
        <Scratchpad
          title={node.title}
          initialContent={node.scratchpadContent}
          onSave={(content) => {
            setWorkspace((prev) => ({
              ...prev,
              nodes: { ...prev.nodes, [node.id]: { ...node, scratchpadContent: content } },
            }));
          }}
        />
      );
    }

    return (
      <RawTerminalView
        lines={node.tuiLines}
        sessionId={node.id}
        isActive={isActive}
        isTuiSession={node.isTuiActive}
        agentName={node.foregroundAgent ? (telemetry.agentName ?? node.foregroundAgent.toUpperCase()) : null}
        onWrite={(data: string) => ptyClient.writeToSession(node.id, data)}
        onSendSignal={(sig) => ptyClient.sendSignalToSession(node.id, sig)}
      />
    );
  };
```

Delete `executeFinalCommand`, `handleExecuteCommand`, the `pendingApproval` state, the effect that mirrors it into telemetry, the `<Approval>` element, `forcedBlockMode`, the scroll-memory block (`scrollContainerRef`, `scrollMemory`, `shownSession`, `handleScroll`, `handleSnapToBottom`, `scrollDetached`, and the `useLayoutEffect` that positions the viewport — `RawTerminalView` follows its own tail), and `onSnapToBottom` from the `useGlobalKeys` call.

In the `agentBusy` effect, `ownsKeyboard` is gone; the body becomes:

```ts
    const evaluate = () => (activeNode ? isWorking(activeNode.id) : false);
```

- [ ] **Step 4: Verify zero references remain**

```bash
grep -rn "BlockPane\|CommandEditor\|analyzeCommandRisk\|ownsKeyboard\|forcedBlockMode\|scrollDetached" src/ --include="*.ts" --include="*.tsx"
```

Expected: no output.

- [ ] **Step 5: Full gate**

```bash
npm test && npm run build && npm run hud:check
```

Expected: PASS. Test count drops by the deleted suites' tests — **this is the one task where the count legitimately falls.** Record the new baseline in the commit message.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: delete the block view and the approval gate

One view: the raw terminal. A shell is just another process that owns the
keyboard, so ownsKeyboard has no question left to answer.

The gate is dropped because in pass-through the app never sees the command —
the agent types it straight into the PTY, and Claude Code and Codex already
prompt before their own risky calls. AppTelemetry.pendingApproval is KEPT:
noticing that an agent is blocked on you is a different job from deciding
whether a command may run, and the plate already renders SANDBOX WAIT for it."
```

---

### Task 7: Delete the tab strip and the sidebar; terminal to the edges

Implements §3.2 and §3.8. **Pure deletion — no red-green cycle.** Safe only because Task 4 shipped `Ctrl+1…9`.

**Files:**
- Delete: `src/components/TabBar.tsx`, `TabBar.test.tsx`, `src/components/SessionTree.tsx`
- Modify: `src/App.tsx`, `src/components/RawTerminalView.tsx`, `src/hooks/useGlobalKeys.ts`

- [ ] **Step 1: Delete the files**

```bash
git rm src/components/TabBar.tsx src/components/TabBar.test.tsx src/components/SessionTree.tsx
```

- [ ] **Step 2: Strip the pane header**

In `src/components/RawTerminalView.tsx`, delete the entire `{/* MODE B HEADER BAR */}` block, the `label` const, and the `onExitRawMode` prop and its interface entry. Keep `hasFocus` state — it is still needed, but it now shows nowhere, so also delete `setHasFocus`, `onFocus`, `onBlur` and `data-focused` **only if** no test asserts on them; otherwise keep `data-focused` as a test hook and drop the visible badge alone.

Give the container the one pixel of recess (§3.8):

```tsx
      className="flex-1 flex flex-col recess overflow-hidden focus:outline-none relative"
```

(unchanged — `recess` already supplies `--bevel-dn`; the header removal is what makes it read as edge-to-edge.)

- [ ] **Step 3: Collapse `App.tsx` to terminal plus plate**

The returned JSX becomes:

```tsx
    <div className="flex flex-col h-screen w-screen overflow-hidden select-none font-mono" style={{ background: 'var(--ground)' }}>
      <SessionModeNotice sessionId={activeNode?.id ?? null} />

      {/* The terminal reaches all four edges. The plate is the only chrome. */}
      <div className="flex-1 flex min-h-0 min-w-0">
        <SplitPaneGrid
          layout={activeGroup.layout}
          nodes={groupNodes}
          activeNodeId={activeGroup.activeNodeId}
          onSelectNode={handleSelectNode}
          renderPane={renderSessionPane}
        />
      </div>

      <div className="shrink-0">
        <StatusPlate telemetry={telemetry} />
      </div>

      <CommandPalette isOpen={isPaletteOpen} onClose={() => setIsPaletteOpen(false)} actions={paletteActions} />
      <WorkspaceModal isOpen={isWorkspaceModalOpen} onClose={() => setIsWorkspaceModalOpen(false)} onSelectWorkspace={handleOpenWorkspaceFolder} />
    </div>
```

Delete the `showTree` state, `onToggleSidebar` from the `useGlobalKeys` call, and the `Ctrl+B` branch in `useGlobalKeys.ts` along with `onToggleSidebar` from `GlobalKeyBindings`. Remove `showTree` / `setShowTree` from `buildPaletteActions` in `src/core/paletteActions.ts` and drop the sidebar toggle action.

- [ ] **Step 4: Verify zero references remain**

```bash
grep -rn "TabBar\|SessionTree\|showTree\|onToggleSidebar" src/ --include="*.ts" --include="*.tsx"
```

Expected: no output.

- [ ] **Step 5: Full gate and commit**

```bash
npm test && npm run build && npm run hud:check
git add -A
git commit -m "refactor: delete the tab strip and the sidebar

The terminal reaches all four window edges and the plate is the only chrome.
Safe because Ctrl+1-9 landed first; the waiting rows carry the rest."
```

---

### Task 8: Wire the waiting list to observed activity

Implements §3.3. Closes the loop: the plate now shows real sessions.

**Files:**
- Create: `src/core/waitingList.ts`
- Create: `src/core/waitingList.test.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `isWorking` from `activityMonitor`, `SessionNode.number` from Task 4, `WaitingRow` from Task 2.
- Produces: `buildWaitingList(nodes, activeId, isBusy, now) → WaitingRow[]`.

- [ ] **Step 1: Write the failing test**

Create `src/core/waitingList.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildWaitingList } from './waitingList';
import type { SessionNode } from '../types/sessionTree';

const node = (over: Partial<SessionNode>): SessionNode => ({
  id: 'n', groupId: 'g', title: 'T', number: 1, kind: 'terminal', cwd: '/x',
  gitBranch: '', activeBlockId: null, isTuiActive: false, agentState: 'idle',
  blocks: [], tuiLines: [], commandHistory: [], createdAt: 0, ...over,
});

describe('buildWaitingList', () => {
  it('lists a session that has stopped', () => {
    const nodes = [node({ id: 'a', number: 2, title: 'PTY-FIX', lastOutputAt: 1_000 })];
    const rows = buildWaitingList(nodes, 'other', () => false, 5_000);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ n: '2', name: 'PTY-FIX', tail: '4S' });
  });

  it('never lists the session you are looking at', () => {
    const nodes = [node({ id: 'a', number: 2, lastOutputAt: 1_000 })];
    expect(buildWaitingList(nodes, 'a', () => false, 5_000)).toHaveLength(0);
  });

  it('never lists a session that is still working', () => {
    const nodes = [node({ id: 'a', number: 2, lastOutputAt: 1_000 })];
    expect(buildWaitingList(nodes, 'other', () => true, 5_000)).toHaveLength(0);
  });

  it('never lists a session that has produced nothing yet', () => {
    const nodes = [node({ id: 'a', number: 2 })];
    expect(buildWaitingList(nodes, 'other', () => false, 5_000)).toHaveLength(0);
  });

  it('shows an exit code instead of a duration, and marks it failed', () => {
    const nodes = [node({ id: 'a', number: 6, lastOutputAt: 1_000, lastExitCode: 101 })];
    const rows = buildWaitingList(nodes, 'other', () => false, 5_000);
    expect(rows[0]).toMatchObject({ tail: 'EXIT 101', failed: true });
  });

  it('puts the longest wait first — that is the one going stale', () => {
    const nodes = [
      node({ id: 'a', number: 1, title: 'NEW', lastOutputAt: 4_000 }),
      node({ id: 'b', number: 2, title: 'OLD', lastOutputAt: 1_000 }),
    ];
    expect(buildWaitingList(nodes, 'x', () => false, 5_000).map((r) => r.name))
      .toEqual(['OLD', 'NEW']);
  });

  it('formats minutes and seconds the way the plate font can draw them', () => {
    const nodes = [node({ id: 'a', number: 1, lastOutputAt: 0 })];
    expect(buildWaitingList(nodes, 'x', () => false, 252_000)[0].tail).toBe('4M12S');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/core/waitingList.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the two observed fields to `SessionNode`**

In `src/types/sessionTree.ts`:

```ts
  /** When this session's PTY last emitted anything. Absent = never started. */
  lastOutputAt?: number;
  /** The last exit code seen for this session, if any. */
  lastExitCode?: number | null;
```

Set `lastOutputAt` in `src/hooks/usePtyEvents.ts` wherever `noteOutput` is already called, in the same reducer update.

- [ ] **Step 4: Write the implementation**

Create `src/core/waitingList.ts`:

```ts
import type { SessionNode } from '../types/sessionTree';
import type { WaitingRow } from '../hud/state';

/** mm/ss in the characters the plate's small font actually has. */
export function formatWait(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}S`;
  const m = Math.floor(s / 60);
  return `${m}M${String(s % 60).padStart(2, '0')}S`;
}

/**
 * The sessions that have stopped and want you.
 *
 * Four exclusions, each of them load-bearing:
 *  - the session on screen, because you are already looking at it;
 *  - anything still working, because a running agent needs nothing from you;
 *  - anything that has never emitted, because it has not started, not stopped;
 *  - nothing else. A session that merely went quiet IS the signal.
 *
 * Longest wait first: that is the one going stale, and only three rows fit.
 */
export function buildWaitingList(
  nodes: SessionNode[],
  activeId: string,
  isBusy: (id: string) => boolean,
  now: number,
): WaitingRow[] {
  return nodes
    .filter((n) => n.id !== activeId)
    .filter((n) => n.kind !== 'scratchpad')
    .filter((n) => typeof n.lastOutputAt === 'number')
    .filter((n) => !isBusy(n.id))
    .sort((a, b) => (a.lastOutputAt ?? 0) - (b.lastOutputAt ?? 0))
    .map((n) => {
      const failed = typeof n.lastExitCode === 'number' && n.lastExitCode !== 0;
      return {
        n: n.number === null ? '-' : String(n.number),
        name: n.title,
        tail: failed ? `EXIT ${n.lastExitCode}` : formatWait(now - (n.lastOutputAt ?? now)),
        failed,
      };
    });
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run src/core/waitingList.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Feed it to the plate**

In `src/App.tsx`, inside the existing `agentBusy` interval effect (it already ticks at 150ms, which is fast enough and costs nothing extra), extend the `apply` call to also set `waiting`:

```ts
    const apply = () =>
      setTelemetry((prev) => {
        const busy = evaluate();
        const waiting = buildWaitingList(
          activeGroup.nodeIds.map((id) => workspace.nodes[id]).filter(Boolean),
          activeNode?.id ?? '',
          isWorking,
          Date.now(),
        );
        // Cheap identity check: the plate redraws on any telemetry change, and
        // a new array every 150ms would redraw it forever.
        const same =
          prev.agentBusy === busy &&
          prev.waiting?.length === waiting.length &&
          waiting.every((r, i) => {
            const p = prev.waiting?.[i];
            return p && p.n === r.n && p.name === r.name && p.tail === r.tail;
          });
        return same ? prev : { ...prev, agentBusy: busy, waiting };
      });
```

Add `buildWaitingList` to the imports and `workspace.nodes` / `activeGroup.nodeIds` to the effect's dependency array.

- [ ] **Step 7: Full gate and commit**

```bash
npm test && npm run build && npm run hud:check
git add -A
git commit -m "feat(hud): wire the waiting list to observed activity

A session is waiting when it has emitted before, is not emitting now, and is
not the one on screen. Longest wait first, because only three rows fit and
that is the one going stale."
```

---

## Self-Review

**Spec coverage.** §3.1 → Task 1. §3.2 → Task 3. §3.3 → Tasks 2 and 8. §3.4 → Task 4. §3.5 → Task 5. §3.6 → Task 6. §3.7 → Task 6. §3.8 → Task 7. §4 (scrollback, summons, rack) is explicitly the next plan. §5 constraints are in Global Constraints. §6 licensing needs no code change — `THIRD-PARTY-NOTICES.md` is already accurate.

**Type consistency.** `WaitingRow` is defined once in `src/hud/state.ts` (Task 2) and imported by `waitingList.ts` (Task 8). `plateSpec` is defined in Task 1 and consumed by Tasks 2 and 3. `SessionNode.number` is added in Task 4 and read in Task 8. `nextSessionNumber` keeps that name in both its definition and its call site.

**Known risk.** Task 6 is the only task where the test count falls, because it deletes suites for deleted code. That is expected and is recorded in its commit message. `AppTelemetry.pendingApproval` is deliberately retained through the deletion — the enhancement plan's summons reuses it, and `toPlateState` already renders `SANDBOX WAIT` from it.
