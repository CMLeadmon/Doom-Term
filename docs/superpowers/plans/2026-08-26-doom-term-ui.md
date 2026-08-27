# Doom Term UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v0.1.0 dark-dashboard UI with the Doom Term material system — a pixel-exact 480×32 status plate plus a chrome/recess/bevel/ink surface above it — verified by byte-level image comparison rather than by eye.

**Architecture:** Two surfaces joined by shared material, not shared resolution. The plate is a bitmap rendered by `src/hud/plate.js` into an RGBA buffer and blitted to a canvas at integer scale; the reference CLI calls the *same function*, so the app and the acceptance images cannot drift. Everything above the plate is live DOM text styled from four CSS custom properties.

**Tech Stack:** React 19 + TypeScript + Vite 6, Tailwind 3 (being reduced to a utility layer, not a design system), Node's built-in test runner for pure logic, Vitest + jsdom for components.

**Spec:**
- `docs/design/hud-study.md` — seven plate variations (source: https://claude.ai/code/artifact/3074e8ac-a7e2-4672-8f5a-ca3505d23859)
- `docs/design/shell-spec.md` — surfaces above the plate (source: https://claude.ai/code/artifact/0f2421b1-6be2-4b50-9ff1-e2e094154286)
- `src/hud/plate.js` — executable spec for plate geometry; its header comment carries the `st_stuff.c` coordinate mapping
- `docs/design/reference/plate-480@1x.png` — byte-exact acceptance target

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Zero border radius.** No `rounded-*` class, no `border-radius`, anywhere, in any element. A global `* { border-radius: 0 }` reset enforces it.
- **No soft shadows.** Depth is the 1px hard bevel pair only. No `box-shadow` with a blur radius; no `filter: drop-shadow`.
- **No icon libraries.** `lucide-react` is removed from `package.json` in Task 1 and must not return. Marks are text glyphs (`▸ ─ +` etc.).
- **Integer plate scaling only.** `Math.floor(available / 480)`, minimum 1. Fractional scaling destroys the striation and the 1px bevels. Letterbox the remainder.
- **Red is reserved.** `#f01a12 / #d40b06 / #a80603` belong to the three plate numerals, diff deletions, and destructive affordances. Nothing else.
- **Five state colours, one meaning each:** live `#e0a92c`, passed `#5c9c3a`, failed `#d40b06`, waiting-on-you `#3a6fd8`, idle `#6b645a`.
- **Text on plate is near-black** (`#22201b`). Bone on grey fails contrast. Text on a recess is bone (`#d8cbb0`).
- **Nothing dimmer than `#c8bb9c` may sit on plate.** `#8f8672` against `#6f6f6d` is ~1.4:1 and is only legible on a dark recess.
- **Plate geometry lives in exactly one place:** `src/hud/plate.js`. Never hardcode a plate coordinate in a component.
- **Sandbox is a tier name** — `FULL` / `TREE` / `OFF`. Never a percentage.

---

## File Structure

**Already built (do not recreate — verify it still passes):**
- `src/hud/plate.js` — pure RGBA renderer + geometry constants. No DOM, no Node APIs. Imported by both the app and the CLI.
- `tools/hud/png.js` — dependency-free PNG encode/decode (Node zlib only).
- `tools/hud/cli.js` — `render` / `compare` / `ascii` subcommands.
- `docs/design/reference/plate-480@{1x,4x}.png` — acceptance images.

**Created by this plan:**
- `src/styles/material.css` — the four material tokens and the bevel utilities. The only place these values appear.
- `src/hud/canvas.ts` — mounts `renderPlate()` output into a `<canvas>` at integer scale.
- `src/hud/state.ts` — maps app state to the plate's `state` object. Pure; unit-tested.
- `src/components/Rail.tsx` — the gutter rail that replaces card borders.
- `src/components/Block.tsx` — one command: rail + body. Replaces `CommandBlock.tsx`.
- `src/components/ToolCall.tsx` — one four-column agent tool-call row.
- `src/components/Diff.tsx` — diff body + plate header + apply bar.
- `src/components/Approval.tsx` — the permission modal.
- `src/components/Panel.tsx` — one framed panel; session strip, palette and settings all use it.

**Deleted by this plan:**
- `src/components/DoomguyFace.tsx` — replaced by the agent mark inside `plate.js`.
- `src/components/CommandBlock.tsx` — replaced by `Block.tsx` + `Rail.tsx`.
- `src/components/CrtCompositor.tsx` — the scanline pass desaturates the exact colours the plate exists to show.

---

### Task 1: Material tokens and the test harness

Everything else is assembled from these four values. Nothing here is visible on its own, which is exactly why it goes first — every later task's review depends on the tokens being right.

**Files:**
- Create: `src/styles/material.css`
- Create: `src/styles/material.test.js`
- Modify: `src/index.css` (replace whole file)
- Modify: `package.json` (scripts + remove `lucide-react`, add `vitest`, `jsdom`)
- Modify: `tailwind.config.js:8-30` (delete the `doom` colour block)

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties `--plate`, `--ground`, `--bevel-up`, `--bevel-dn`, `--ink`, `--ink-tan`, `--ink-dim`, `--ink-plate`, `--st-live`, `--st-pass`, `--st-fail`, `--st-wait`, `--st-idle`; utility classes `.plate`, `.recess`, `.bev-up`, `.bev-dn`. Every later task uses these names verbatim.

- [ ] **Step 1: Write the failing test**

`src/styles/material.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./material.css', import.meta.url), 'utf8');

test('declares every material token exactly once', () => {
  const required = [
    '--plate', '--ground', '--bevel-up', '--bevel-dn',
    '--ink', '--ink-tan', '--ink-dim', '--ink-plate',
    '--st-live', '--st-pass', '--st-fail', '--st-wait', '--st-idle',
  ];
  for (const token of required) {
    const hits = css.split(`${token}:`).length - 1;
    assert.equal(hits, 1, `${token} should be declared once, found ${hits}`);
  }
});

test('no border radius survives anywhere', () => {
  assert.match(css, /\*\s*\{[^}]*border-radius:\s*0/, 'needs a global radius reset');
  assert.equal(/border-radius:\s*(?!0)/.test(css), false, 'a non-zero radius crept in');
});

test('no blurred shadows — depth is the bevel pair only', () => {
  // A hard bevel is `inset Npx Npx 0 <colour>`. Any third length is a blur.
  const shadows = css.match(/box-shadow:[^;]+;/g) || [];
  for (const s of shadows) {
    assert.equal(/\d+px\s+-?\d+px\s+[1-9]/.test(s), false, `blurred shadow: ${s}`);
  }
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test src/styles/material.test.js`
Expected: FAIL — `ENOENT ... material.css`

- [ ] **Step 3: Write the tokens**

`src/styles/material.css`:

```css
:root {
  color-scheme: dark;

  /* Chrome. Striated neutral grey at a 1px pitch, warm-biased.
     The brown people remember from Doom is level texture, not the bar. */
  --plate: repeating-linear-gradient(180deg,
    #767674 0 1px, #6d6d6b 1px 2px, #727270 2px 3px, #666664 3px 4px,
    #7a7a78 4px 5px, #6a6a68 5px 6px, #747472 6px 7px, #626260 7px 8px);

  /* Content sits in a recess cut into the plate. */
  --ground: #14120f;
  --ground-2: #1b1814;

  /* The only depth cue in the product. */
  --bevel-up: inset 1px 1px 0 #a2a29f, inset -1px -1px 0 #2f2f2e;
  --bevel-dn: inset 1px 1px 0 #171716, inset -1px -1px 0 #8e8e8b;

  /* Ink. --ink-plate is for text ON plate; bone on grey fails contrast. */
  --ink: #d8cbb0;
  --ink-tan: #c8bb9c;
  --ink-dim: #8f8672;
  --ink-plate: #22201b;

  /* State. One colour, one meaning, everywhere. */
  --st-live: #e0a92c;
  --st-pass: #5c9c3a;
  --st-fail: #d40b06;
  --st-wait: #3a6fd8;
  --st-idle: #6b645a;

  --mono: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
}

* { box-sizing: border-box; border-radius: 0; }

.plate  { background: var(--plate); box-shadow: var(--bevel-up); }
.recess { background: var(--ground); box-shadow: var(--bevel-dn); }
.bev-up { box-shadow: var(--bevel-up); }
.bev-dn { box-shadow: var(--bevel-dn); }
```

- [ ] **Step 4: Run the test and make sure it passes**

Run: `node --test src/styles/material.test.js`
Expected: PASS — 3 tests

- [ ] **Step 5: Replace `src/index.css` entirely**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@import "./styles/material.css";

@layer base {
  body {
    margin: 0;
    padding: 0;
    background: var(--ground);
    color: var(--ink);
    font-family: var(--mono);
    overflow: hidden;
    user-select: none;
    -webkit-font-smoothing: antialiased;
  }
  ::selection { background: var(--st-live); color: #000; }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: var(--ground); box-shadow: var(--bevel-dn); }
  ::-webkit-scrollbar-thumb { background: var(--plate); box-shadow: var(--bevel-up); }
}
```

- [ ] **Step 6: Delete the old palette from `tailwind.config.js`**

Remove the entire `colors.doom` block (lines 8–30) and the `boxShadow` block. Keep `fontFamily.mono`. The palette now lives in `material.css`; two sources of colour is how the greys drifted neutral in the first place.

- [ ] **Step 7: Update `package.json`**

Remove `"lucide-react"` from `dependencies`. Add to `devDependencies`: `"vitest": "^3.0.0"`, `"jsdom": "^26.0.0"`. Add scripts:

```json
"test": "node --test 'src/**/*.test.js' && vitest run",
"hud:ref": "node tools/hud/cli.js render docs/design/reference/plate-480@1x.png --scale 1 && node tools/hud/cli.js render docs/design/reference/plate-480@4x.png --scale 4",
"hud:check": "node tools/hud/cli.js compare docs/design/reference/plate-480@1x.png .artifacts/plate-actual.png --out .artifacts/plate-diff.png"
```

- [ ] **Step 8: Verify the build still compiles**

Run: `npm install && npm run build`
Expected: succeeds. Any `lucide-react` import error is a file Task 3–7 deletes; comment the import out and leave a `// TODO(task-N)` rather than reintroducing the dependency.

- [ ] **Step 9: Commit**

```bash
git add src/styles src/index.css tailwind.config.js package.json package-lock.json
git commit -m "feat(ui): add material tokens, drop the neutral grey palette and icon dependency"
```

---

### Task 2: Plate renderer in the app, gated by pixel comparison

This is the task the whole pixel-to-pixel requirement rests on. The app must not re-implement the plate — it calls the same `renderPlate()` the reference images came from.

**Files:**
- Create: `src/hud/canvas.ts`
- Create: `src/hud/state.ts`
- Create: `src/hud/state.test.js`
- Create: `src/components/StatusPlate.tsx`
- Delete: `src/components/DoomguyFace.tsx`, `src/components/StatusBar.tsx`

**Interfaces:**
- Consumes: `renderPlate(state, scale, spec)` and `PLATE_480` from `src/hud/plate.js`.
- Produces: `toPlateState(app: AppTelemetry): PlateState`; `mountPlate(canvas: HTMLCanvasElement, state, availableWidth): number` returning the integer scale used.

- [ ] **Step 1: Write the failing test**

`src/hud/state.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPlateState, plateScale } from './state.ts';

test('sandbox renders a tier name, never a percentage', () => {
  assert.equal(toPlateState({ isolation: 'sandbox' }).sandbox, 'FULL');
  assert.equal(toPlateState({ isolation: 'worktree' }).sandbox, 'TREE');
  assert.equal(toPlateState({ isolation: 'host' }).sandbox, 'OFF');
});

test('percentages clamp and round to a 3-character field', () => {
  assert.equal(toPlateState({ contextUsed: 0.613 }).context, '61%');
  assert.equal(toPlateState({ contextUsed: 1.5 }).context, '99%');
  assert.equal(toPlateState({ contextUsed: -1 }).context, '0%');
});

test('branch truncates from the left so the leaf survives', () => {
  const s = toPlateState({ branch: 'feature/webgl-compositor-rewrite-phase-two' });
  assert.equal(s.branch.length, 24);
  assert.match(s.branch, /PHASE-TWO$/);
  assert.match(s.branch, /^··/);
});

test('scale is always a positive integer', () => {
  assert.equal(plateScale(1920), 4);
  assert.equal(plateScale(1000), 2);
  assert.equal(plateScale(479), 1, 'never returns 0 — a 0-scale canvas is invisible');
  assert.equal(Number.isInteger(plateScale(1337)), true);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test src/hud/state.test.js`
Expected: FAIL — cannot resolve `./state.ts`

- [ ] **Step 3: Write `src/hud/state.ts`**

```ts
import { PLATE_480, truncateLeft } from './plate.js';

export type Isolation = 'sandbox' | 'worktree' | 'host';

export interface AppTelemetry {
  contextUsed?: number;   // 0..1
  rateUsed?: number;      // 0..1
  isolation?: Isolation;
  agent?: string;
  agentName?: string;
  model?: string;
  cwd?: string;
  branch?: string;
  credentials?: [boolean, boolean, boolean];
  tokens?: { in: number; out: number; cache: number; limit: [number, number, number, number] };
}

const TIER: Record<Isolation, string> = { sandbox: 'FULL', worktree: 'TREE', host: 'OFF' };

function pct(v: number | undefined): string {
  const n = Math.round(Math.min(1, Math.max(0, v ?? 0)) * 100);
  return `${Math.min(99, n)}%`;
}

const k = (n: number) => String(Math.round(n / 1000));

export function toPlateState(app: AppTelemetry) {
  const t = app.tokens;
  return {
    context: pct(app.contextUsed),
    usage: pct(app.rateUsed),
    sandbox: TIER[app.isolation ?? 'host'],
    agent: app.agent ?? 'claude',
    agentName: [app.agentName ?? 'CLAUDE CODE', app.model].filter(Boolean).join(' · ').toUpperCase(),
    path: (app.cwd ?? '~').toUpperCase(),
    branch: truncateLeft((app.branch ?? 'main').toUpperCase(), PLATE_480.valueChars),
    credentials: app.credentials ?? [false, false, false],
    table: t
      ? [
          ['IN', k(t.in), k(t.limit[0])],
          ['OUT', k(t.out), k(t.limit[1])],
          ['CAC', k(t.cache), k(t.limit[2])],
          ['TOT', k(t.in + t.out + t.cache), k(t.limit[3])],
        ]
      : undefined,
  };
}

/** Integer scale only — fractional scaling destroys the striation. */
export function plateScale(availableWidth: number): number {
  return Math.max(1, Math.floor(availableWidth / PLATE_480.width));
}
```

- [ ] **Step 4: Run the test and make sure it passes**

Run: `node --test src/hud/state.test.js`
Expected: PASS — 4 tests

- [ ] **Step 5: Write `src/hud/canvas.ts`**

```ts
import { renderPlate, PLATE_480 } from './plate.js';
import { plateScale } from './state';

/**
 * Blits renderPlate()'s RGBA buffer straight into the canvas. No 2D drawing
 * calls, no font rendering in the browser — the browser paints exactly the
 * bytes the reference CLI produced. Returns the scale used.
 */
export function mountPlate(
  canvas: HTMLCanvasElement,
  state: Record<string, unknown>,
  availableWidth: number,
): number {
  const scale = plateScale(availableWidth);
  const s = renderPlate(state, scale, PLATE_480);
  canvas.width = s.w;
  canvas.height = s.h;
  canvas.style.width = `${s.w}px`;
  canvas.style.height = `${s.h}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable — cannot render the status plate');
  ctx.imageSmoothingEnabled = false;
  const img = new ImageData(new Uint8ClampedArray(s.data), s.w, s.h);
  ctx.putImageData(img, 0, 0);
  return scale;
}
```

`src/hud/plate.js` already allocates `Uint8Array`, not `Buffer`, so it runs unmodified in the browser. No change needed here.

- [ ] **Step 6: Confirm the renderer is still browser-safe before wiring it in**

Run:
```bash
grep -nE "require\(|from 'node:|Buffer\.(alloc|from|concat)|process\.|__dirname" src/hud/plate.js
```
Expected: no output. A Node builtin in this file breaks the Vite build and, worse, would force a second browser-side implementation — which is exactly the drift this architecture exists to prevent.

- [ ] **Step 7: Write `src/components/StatusPlate.tsx`**

```tsx
import React, { useEffect, useRef } from 'react';
import { mountPlate } from '../hud/canvas';
import { toPlateState, type AppTelemetry } from '../hud/state';

export const StatusPlate: React.FC<{ telemetry: AppTelemetry }> = ({ telemetry }) => {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const draw = () => {
      if (!host.current || !canvas.current) return;
      mountPlate(canvas.current, toPlateState(telemetry), host.current.clientWidth);
    };
    draw();
    const ro = new ResizeObserver(draw);
    if (host.current) ro.observe(host.current);
    return () => ro.disconnect();
  }, [telemetry]);

  return (
    // Letterbox the remainder rather than stretching to fill.
    <div ref={host} className="shrink-0 flex justify-center bg-black">
      <canvas ref={canvas} aria-label="Status plate: context, usage, agent, path, branch, sandbox tier, credentials, token table" />
    </div>
  );
};
```

- [ ] **Step 8: Wire it into `src/App.tsx` and delete the old bar**

In `src/App.tsx`, replace the `<StatusBar ... />` element with `<StatusPlate telemetry={telemetry} />`, remove the `StatusBar` and `DoomguyFace` imports, and delete the `stbar` state block (`src/App.tsx:62-72`) — its fields are now derived by `toPlateState`.

```bash
git rm src/components/StatusBar.tsx src/components/DoomguyFace.tsx
```

- [ ] **Step 9: Capture the actual plate and run the pixel gate**

Run the app, then in DevTools console:

```js
const c = document.querySelector('canvas[aria-label^="Status plate"]');
// Re-render at 1x so the capture is directly comparable to the reference.
const { renderPlate, PLATE_480 } = await import('/src/hud/plate.js');
const s = renderPlate((await import('/src/hud/state.ts')).toPlateState(window.__telemetry), 1, PLATE_480);
const t = document.createElement('canvas'); t.width = s.w; t.height = s.h;
t.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(s.data), s.w, s.h), 0, 0);
t.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'plate-actual.png'; a.click(); });
```

Save to `.artifacts/plate-actual.png`, then:

Run: `npm run hud:check`
Expected: `mismatched: 0 (0.0000%)` and `PASS`. On failure, open `.artifacts/plate-diff.png` — magenta pixels are the mismatches and the console lists the first twelve with their coordinates and both colours.

- [ ] **Step 10: Commit**

```bash
git add src/hud src/components/StatusPlate.tsx src/App.tsx tools/hud/png.js
git commit -m "feat(hud): render the status plate from the shared reference renderer

The app and tools/hud/cli.js both call renderPlate(), so the browser paints
the same bytes as docs/design/reference/plate-480@1x.png. Verified by
npm run hud:check at 0 mismatched pixels."
```

---

### Task 3: The rail

Replaces the rounded card. The rail is a strip of plate in the gutter; output flows free on the ground with nothing around it. This deletes more code than it adds.

**Files:**
- Create: `src/components/Rail.tsx`, `src/components/Block.tsx`, `src/components/Block.test.tsx`
- Create: `vitest.config.ts`
- Delete: `src/components/CommandBlock.tsx`
- Modify: `src/App.tsx` (swap `CommandBlock` for `Block`)

**Interfaces:**
- Consumes: material classes `.plate`, `.recess` from Task 1.
- Produces: `type BlockStatus = 'live' | 'pass' | 'fail' | 'wait' | 'idle'`; `<Rail status={BlockStatus} />`; `<Block block={TerminalBlock} />`.

- [ ] **Step 1: Add `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, include: ['src/**/*.test.tsx'] },
});
```

- [ ] **Step 2: Write the failing test**

`src/components/Block.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Block } from './Block';

const base = { id: 'b1', command: 'cargo build --release', startedAt: 0, liveLines: [] };

describe('Block', () => {
  it('caps the rail with the state colour', () => {
    const { container } = render(<Block block={{ ...base, status: 'error', exitCode: 101 }} />);
    expect(container.querySelector('[data-cap]')?.getAttribute('data-cap')).toBe('fail');
  });

  it('shows exit code and duration on the command line', () => {
    render(<Block block={{ ...base, status: 'error', exitCode: 101, durationMs: 3104 }} />);
    expect(screen.getByText(/EXIT 101/)).toBeTruthy();
    expect(screen.getByText(/3\.10S/)).toBeTruthy();
  });

  it('draws no border around output — the rail is the only structure', () => {
    const { container } = render(<Block block={{ ...base, status: 'completed', exitCode: 0 }} />);
    const body = container.querySelector('[data-body]') as HTMLElement;
    expect(body.className).not.toMatch(/border|rounded/);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx vitest run src/components/Block.test.tsx`
Expected: FAIL — cannot resolve `./Block`

- [ ] **Step 4: Write `src/components/Rail.tsx`**

```tsx
import React from 'react';

export type BlockStatus = 'live' | 'pass' | 'fail' | 'wait' | 'idle';

const CAP: Record<BlockStatus, string> = {
  live: 'var(--st-live)', pass: 'var(--st-pass)', fail: 'var(--st-fail)',
  wait: 'var(--st-wait)', idle: 'var(--st-idle)',
};

/**
 * A strip of plate spanning the block's height, capped with its state.
 * This replaces the card border: block boundaries without boxing output.
 */
export const Rail: React.FC<{ status: BlockStatus; pinned?: boolean }> = ({ status, pinned }) => (
  <div
    className={`${pinned ? 'recess' : 'plate'} w-6 shrink-0 flex flex-col items-center pt-1`}
    aria-hidden="true"
  >
    <span className="recess w-4 h-3 flex items-center justify-center">
      <i data-cap={status} className="block w-1.5 h-1.5" style={{ background: CAP[status] }} />
    </span>
  </div>
);
```

- [ ] **Step 5: Write `src/components/Block.tsx`**

```tsx
import React from 'react';
import { Rail, type BlockStatus } from './Rail';
import type { TerminalBlock } from '../types/terminal';

function statusOf(b: TerminalBlock): BlockStatus {
  if (b.status === 'running') return 'live';
  if (b.exitCode == null) return 'idle';
  return b.exitCode === 0 ? 'pass' : 'fail';
}

const dur = (ms?: number) => (ms == null ? '' : ms < 1000 ? `${ms}MS` : `${(ms / 1000).toFixed(2)}S`);

export const Block: React.FC<{ block: TerminalBlock }> = ({ block }) => {
  const status = statusOf(block);
  const lines = block.snapshot ? block.snapshot.lines : block.liveLines;
  const meta = [dur(block.durationMs), block.exitCode != null ? `EXIT ${block.exitCode}` : null]
    .filter(Boolean).join(' · ');

  return (
    <div className="flex gap-3 px-3 pb-3">
      <Rail status={status} pinned={block.pinned} />
      <div data-body className="flex-1 min-w-0">
        <div className="flex gap-4 items-baseline text-[13px]">
          <span style={{ color: 'var(--st-live)' }}>▸</span>
          <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--ink)' }}>{block.command}</span>
          <span className="shrink-0 text-[11px] tracking-widest tabular-nums" style={{ color: 'var(--ink-dim)' }}>{meta}</span>
        </div>
        <div className="mt-0.5 text-[13px] whitespace-pre-wrap select-text" style={{ color: 'var(--ink-dim)' }}>
          {lines.map((l) => (
            <div key={l.id}>
              {l.spans.map((s, i) => (
                <span key={i} style={{ color: l.isError ? 'var(--st-fail)' : s.fg }}>{s.text}</span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 6: Run the tests and make sure they pass**

Run: `npx vitest run src/components/Block.test.tsx`
Expected: PASS — 3 tests

- [ ] **Step 7: Swap it into `src/App.tsx` and delete the card**

Replace the `<CommandBlock key=... />` element inside the `blocks.map` (`src/App.tsx:363-369`) with `<Block key={block.id} block={block} />`, update the import, then:

```bash
git rm src/components/CommandBlock.tsx
```

- [ ] **Step 8: Commit**

```bash
git add src/components/Rail.tsx src/components/Block.tsx src/components/Block.test.tsx vitest.config.ts src/App.tsx
git commit -m "feat(ui): replace command cards with the plate gutter rail"
```

---

### Task 4: Tool-call rows

An agent turn is a command like any other — same rail, same cap. The body is a fixed four-column row per call so you can scan what it touched without reading prose.

**Files:**
- Create: `src/components/ToolCall.tsx`, `src/components/ToolCall.test.tsx`
- Modify: `src/components/Block.tsx` (render `block.toolCalls` when present)
- Modify: `src/types/terminal.ts` (add the `ToolCall` type)

**Interfaces:**
- Consumes: `BlockStatus` from Task 3.
- Produces: `interface ToolCall { verb: 'READ'|'EDIT'|'GREP'|'SHELL'|'WEB'; target: string; result?: string; added?: number; removed?: number; live?: boolean }`.

- [ ] **Step 1: Write the failing test**

`src/components/ToolCall.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ToolCall } from './ToolCall';

describe('ToolCall', () => {
  it('names the verb, not the function that ran', () => {
    render(<ToolCall call={{ verb: 'EDIT', target: 'src/pty/demux.rs', added: 42, removed: 18 }} />);
    expect(screen.getByText('EDIT')).toBeTruthy();
  });

  it('colours added and removed counts separately', () => {
    const { container } = render(<ToolCall call={{ verb: 'EDIT', target: 'x.rs', added: 42, removed: 18 }} />);
    expect(container.querySelector('[data-add]')?.textContent).toBe('+42');
    expect(container.querySelector('[data-del]')?.textContent).toBe('−18');
  });

  it('only a live row is gold', () => {
    const { container: live } = render(<ToolCall call={{ verb: 'SHELL', target: 'cargo test', live: true }} />);
    const { container: done } = render(<ToolCall call={{ verb: 'SHELL', target: 'cargo test' }} />);
    expect(live.querySelector('[data-verb]')?.getAttribute('data-live')).toBe('true');
    expect(done.querySelector('[data-verb]')?.getAttribute('data-live')).toBe('false');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/components/ToolCall.test.tsx`
Expected: FAIL — cannot resolve `./ToolCall`

- [ ] **Step 3: Add the type to `src/types/terminal.ts`**

```ts
export interface ToolCall {
  verb: 'READ' | 'EDIT' | 'GREP' | 'SHELL' | 'WEB';
  target: string;
  result?: string;
  added?: number;
  removed?: number;
  live?: boolean;
}
```

Then add `toolCalls?: ToolCall[];` to the `TerminalBlock` interface.

- [ ] **Step 4: Write `src/components/ToolCall.tsx`**

```tsx
import React from 'react';
import type { ToolCall as Call } from '../types/terminal';

export const ToolCall: React.FC<{ call: Call }> = ({ call }) => {
  const live = call.live === true;
  const tone = live ? 'var(--st-live)' : 'var(--ink-tan)';
  return (
    <div className="flex gap-3 items-baseline text-[13px] py-px">
      <span data-verb data-live={String(live)} style={{ color: tone }}>▸</span>
      <span className="w-14 shrink-0 tracking-wider" style={{ color: tone }}>{call.verb}</span>
      <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--ink)' }}>{call.target}</span>
      <span className="shrink-0 text-[11px] tabular-nums" style={{ color: 'var(--ink-dim)' }}>
        {call.added != null && <span data-add style={{ color: 'var(--st-pass)' }}>+{call.added}</span>}
        {call.added != null && call.removed != null && ' '}
        {call.removed != null && <span data-del style={{ color: 'var(--st-fail)' }}>−{call.removed}</span>}
        {call.added == null && call.removed == null && call.result}
      </span>
    </div>
  );
};
```

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npx vitest run src/components/ToolCall.test.tsx`
Expected: PASS — 3 tests

- [ ] **Step 6: Render them from `Block.tsx`**

Immediately after the command line `</div>` and before the output `<div>`, insert:

```tsx
{block.toolCalls?.map((c, i) => <ToolCall key={i} call={c} />)}
```

- [ ] **Step 7: Commit**

```bash
git add src/components/ToolCall.tsx src/components/ToolCall.test.tsx src/components/Block.tsx src/types/terminal.ts
git commit -m "feat(ui): add four-column tool-call rows to agent turns"
```

---

### Task 5: Diff and apply

The highest-stakes surface on the stage, so it gets the most structure: plate header, recessed body, plate action bar. Changed lines are tinted grounds, not coloured borders — the tint is what the eye counts.

**Files:**
- Create: `src/components/Diff.tsx`, `src/components/Diff.test.tsx`

**Interfaces:**
- Produces: `interface DiffLine { n: number; sign: ' '|'+'|'-'; text: string }`; `<Diff file={string} lines={DiffLine[]} added={number} removed={number} onApply={()=>void} onReject={()=>void} />`.

- [ ] **Step 1: Write the failing test**

`src/components/Diff.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Diff } from './Diff';

const lines = [
  { n: 117, sign: ' ' as const, text: '  if self.in_osc {' },
  { n: 118, sign: '-' as const, text: '    self.osc_buf.push(byte);' },
  { n: 118, sign: '+' as const, text: '    if self.osc_buf.len() < OSC_MAX {' },
];

describe('Diff', () => {
  it('Enter applies and Escape rejects', () => {
    const onApply = vi.fn(), onReject = vi.fn();
    render(<Diff file="src/pty/demux.rs" lines={lines} added={42} removed={18} onApply={onApply} onReject={onReject} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onApply).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('tints changed rows rather than bordering them', () => {
    const { container } = render(<Diff file="x.rs" lines={lines} added={42} removed={18} onApply={()=>{}} onReject={()=>{}} />);
    const del = container.querySelector('[data-sign="-"]') as HTMLElement;
    expect(del.className).not.toMatch(/border/);
    expect(del.getAttribute('data-sign')).toBe('-');
  });

  it('line numbers are not selectable, so copying yields clean code', () => {
    const { container } = render(<Diff file="x.rs" lines={lines} added={42} removed={18} onApply={()=>{}} onReject={()=>{}} />);
    expect((container.querySelector('[data-ln]') as HTMLElement).className).toMatch(/select-none/);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/components/Diff.test.tsx`
Expected: FAIL — cannot resolve `./Diff`

- [ ] **Step 3: Write `src/components/Diff.tsx`**

```tsx
import React, { useEffect } from 'react';

export interface DiffLine { n: number; sign: ' ' | '+' | '-'; text: string }

const BG: Record<string, string> = { '+': '#101c0c', '-': '#1e0c0a', ' ': 'transparent' };
const FG: Record<string, string> = { '+': '#9fd07f', '-': '#e0938a', ' ': 'var(--ink-dim)' };
const SG: Record<string, string> = { '+': 'var(--st-pass)', '-': 'var(--st-fail)', ' ': '#5b5346' };

export const Diff: React.FC<{
  file: string; lines: DiffLine[]; added: number; removed: number;
  onApply: () => void; onReject: () => void;
}> = ({ file, lines, added, removed, onApply, onReject }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); onApply(); }
      if (e.key === 'Escape') { e.preventDefault(); onReject(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onApply, onReject]);

  return (
    <div className="mt-2">
      <div className="plate flex justify-between px-2 py-0.5 text-[11px] font-bold tracking-wider"
           style={{ color: 'var(--ink-plate)' }}>
        <span>{file.toUpperCase()}</span>
        <span className="flex gap-2 tabular-nums">
          <span style={{ color: '#14380c' }}>+{added}</span>
          <span style={{ color: '#4a0806' }}>−{removed}</span>
        </span>
      </div>
      <div className="recess">
        {lines.map((l, i) => (
          <div key={i} data-sign={l.sign} className="flex text-[13px] tabular-nums"
               style={{ background: BG[l.sign] }}>
            <span data-ln className="w-10 text-right pr-2 select-none shrink-0" style={{ color: '#5b5346' }}>{l.n}</span>
            <span className="w-4 select-none shrink-0" style={{ color: SG[l.sign] }}>{l.sign}</span>
            <span className="flex-1 min-w-0 whitespace-pre overflow-hidden" style={{ color: FG[l.sign] }}>{l.text}</span>
          </div>
        ))}
      </div>
      <div className="plate flex items-center gap-2 px-1.5 py-1 mt-1">
        {/* The gold ring marks the safe default and holds Enter. */}
        <button onClick={onApply} className="plate px-3 text-[12px] font-bold tracking-wider"
                style={{ color: '#3a2a04', boxShadow: 'var(--bevel-up), inset 0 0 0 2px var(--st-live)' }}>
          APPLY PATCH
        </button>
        <button onClick={onReject} className="plate px-3 text-[12px] font-bold tracking-wider"
                style={{ color: '#4a0806', boxShadow: 'var(--bevel-up), inset 0 0 0 2px #c02a22' }}>
          REJECT
        </button>
        <span className="ml-auto text-[11px] tracking-widest pr-1" style={{ color: '#2e2a24' }}>
          ENTER APPLY · ESC REJECT
        </span>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run src/components/Diff.test.tsx`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/components/Diff.tsx src/components/Diff.test.tsx
git commit -m "feat(ui): add diff review with tinted grounds and keyed apply/reject"
```

---

### Task 6: Approval

When an agent asks to run something you didn't type, the request must be unmistakable and the exact command readable. The dangerous action never holds the key your hands are already on.

**Files:**
- Create: `src/components/Approval.tsx`, `src/components/Approval.test.tsx`

**Interfaces:**
- Produces: `<Approval command={string} agent={string} cwd={string} isolation={'FULL'|'TREE'|'OFF'} consequence?={string} onRunOnce={()=>void} onAlways={()=>void} onDeny={()=>void} />`.

- [ ] **Step 1: Write the failing test**

`src/components/Approval.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Approval } from './Approval';

const props = {
  command: 'rm -rf target/', agent: 'CLAUDE CODE', cwd: '~/Projects/Doom Term',
  isolation: 'OFF' as const, consequence: 'DELETES 2 DIRECTORIES · NOT REVERSIBLE',
};

describe('Approval', () => {
  it('Escape denies — never runs', () => {
    const onDeny = vi.fn(), onRunOnce = vi.fn();
    render(<Approval {...props} onRunOnce={onRunOnce} onAlways={()=>{}} onDeny={onDeny} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDeny).toHaveBeenCalledOnce();
    expect(onRunOnce).not.toHaveBeenCalled();
  });

  it('Deny holds the safe ring, Run Once holds the red one', () => {
    render(<Approval {...props} onRunOnce={()=>{}} onAlways={()=>{}} onDeny={()=>{}} />);
    expect(screen.getByText('DENY').getAttribute('style')).toMatch(/--st-live/);
    expect(screen.getByText('RUN ONCE').getAttribute('style')).toMatch(/#c02a22/);
  });

  it('shows the command verbatim and states the consequence', () => {
    render(<Approval {...props} onRunOnce={()=>{}} onAlways={()=>{}} onDeny={()=>{}} />);
    expect(screen.getByText('rm -rf target/')).toBeTruthy();
    expect(screen.getByText(/NOT REVERSIBLE/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/components/Approval.test.tsx`
Expected: FAIL — cannot resolve `./Approval`

- [ ] **Step 3: Write `src/components/Approval.tsx`**

```tsx
import React, { useEffect } from 'react';

const SAFE = { boxShadow: 'var(--bevel-up), inset 0 0 0 2px var(--st-live)', color: '#3a2a04' };
const DANGER = { boxShadow: 'var(--bevel-up), inset 0 0 0 2px #c02a22', color: '#4a0806' };
const PLAIN = { boxShadow: 'var(--bevel-up)', color: 'var(--ink-plate)' };

export const Approval: React.FC<{
  command: string; agent: string; cwd: string;
  isolation: 'FULL' | 'TREE' | 'OFF'; consequence?: string;
  onRunOnce: () => void; onAlways: () => void; onDeny: () => void;
}> = ({ command, agent, cwd, isolation, consequence, onRunOnce, onAlways, onDeny }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onDeny(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDeny]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Run shell command?"
         className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: '#0b0a08e6' }}>
      <div className="plate p-1.5" style={{ width: 'min(34rem, 92vw)' }}>
        <div className="flex justify-between px-1 pb-1 text-[12px] font-bold tracking-widest"
             style={{ color: 'var(--ink-plate)' }}>
          <span>RUN SHELL COMMAND?</span>
          <span style={{ color: isolation === 'OFF' ? '#4a0806' : 'var(--ink-plate)' }}>
            SANDBOX {isolation} {isolation === 'OFF' ? '· YOUR HOST' : ''}
          </span>
        </div>
        <div className="recess px-2 py-1.5">
          <div className="text-[13px] whitespace-pre-wrap select-text" style={{ color: 'var(--ink)' }}>{command}</div>
          <div className="mt-1.5 text-[11px] tracking-wider" style={{ color: 'var(--ink-dim)' }}>
            {agent} · WORKING DIRECTORY {cwd.toUpperCase()}
            {consequence && <><br />{consequence}</>}
          </div>
        </div>
        <div className="plate flex items-center gap-2 px-1.5 py-1 mt-1">
          <button onClick={onRunOnce} className="plate px-3 text-[12px] font-bold tracking-wider" style={DANGER}>RUN ONCE</button>
          <button onClick={onAlways} className="plate px-3 text-[12px] font-bold tracking-wider" style={PLAIN}>ALWAYS ALLOW</button>
          <button onClick={onDeny} autoFocus className="plate px-3 text-[12px] font-bold tracking-wider" style={SAFE}>DENY</button>
          <span className="ml-auto text-[11px] tracking-widest pr-1" style={{ color: '#2e2a24' }}>ESC DENIES</span>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run src/components/Approval.test.tsx`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/components/Approval.tsx src/components/Approval.test.tsx
git commit -m "feat(ui): add approval modal — Esc denies, Deny holds the safe ring"
```

---

### Task 7: The panel, and deleting what it replaces

Session strip, command palette and settings are one component with three sources. Building three would produce three dialects.

**Files:**
- Create: `src/components/Panel.tsx`, `src/components/Panel.test.tsx`
- Delete: `src/components/HistoryModal.tsx`, `src/components/SettingsModal.tsx`, `src/components/CrtCompositor.tsx`
- Modify: `src/App.tsx` (drop `CrtCompositor`, `paletteFlash`, `scanlineIntensity`, `crtEnabled` state)

**Interfaces:**
- Produces: `interface PanelRow { kind: string; label: string; right?: string; selected?: boolean }`; `<Panel title={string} hint={string} rows={PanelRow[]} onPick={(i:number)=>void} />`.

- [ ] **Step 1: Write the failing test**

`src/components/Panel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Panel } from './Panel';

const rows = [
  { kind: 'RECENT', label: 'cargo test --workspace', right: 'EXIT 101', selected: true },
  { kind: 'FILE', label: 'src/pty/demux.rs', right: '412 LINES' },
];

describe('Panel', () => {
  it('selection is a raised plate button, not a highlight bar', () => {
    const { container } = render(<Panel title="RUN" hint="ESC CLOSE" rows={rows} onPick={()=>{}} />);
    const sel = container.querySelector('[data-selected="true"]') as HTMLElement;
    expect(sel.className).toMatch(/plate/);
  });

  it('kind is a column, not a badge', () => {
    render(<Panel title="RUN" hint="ESC CLOSE" rows={rows} onPick={()=>{}} />);
    expect(screen.getByText('RECENT')).toBeTruthy();
    expect(screen.getByText('FILE')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/components/Panel.test.tsx`
Expected: FAIL — cannot resolve `./Panel`

- [ ] **Step 3: Write `src/components/Panel.tsx`**

```tsx
import React from 'react';

export interface PanelRow { kind: string; label: string; right?: string; selected?: boolean }

export const Panel: React.FC<{
  title: string; hint: string; rows: PanelRow[]; onPick: (i: number) => void;
}> = ({ title, hint, rows, onPick }) => (
  <div className="plate p-1.5" style={{ width: 'min(36rem, 92vw)' }}>
    <div className="flex justify-between px-1 pb-1 text-[12px] font-bold tracking-widest"
         style={{ color: 'var(--ink-plate)' }}>
      <span>{title}</span><span>{hint}</span>
    </div>
    <div className="recess p-1">
      {rows.map((r, i) => (
        <button key={i} onClick={() => onPick(i)} data-selected={String(!!r.selected)}
                className={`w-full flex gap-3 items-baseline px-2 py-0.5 text-[13px] text-left ${r.selected ? 'plate' : ''}`}
                style={{ color: r.selected ? '#3a2a04' : 'var(--ink)' }}>
          <span className="w-20 shrink-0 tracking-wider"
                style={{ color: r.selected ? '#3d3830' : 'var(--ink-dim)' }}>{r.kind}</span>
          <span className="flex-1 min-w-0 truncate" style={{ fontWeight: r.selected ? 700 : 400 }}>{r.label}</span>
          <span className="shrink-0 text-[11px]"
                style={{ color: r.selected ? '#3d3830' : 'var(--ink-dim)' }}>{r.right}</span>
        </button>
      ))}
    </div>
  </div>
);
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npx vitest run src/components/Panel.test.tsx`
Expected: PASS — 2 tests

- [ ] **Step 5: Delete the replaced surfaces**

```bash
git rm src/components/HistoryModal.tsx src/components/SettingsModal.tsx src/components/CrtCompositor.tsx
```

In `src/App.tsx` remove: the `CrtCompositor` import and element, the `crtEnabled` / `scanlineIntensity` / `paletteFlash` state and `triggerFlash`, and the `HistoryModal` / `SettingsModal` elements. Replace the modal elements with `<Panel .../>` driven by `commandHistory`.

- [ ] **Step 6: Full verification**

Run: `npm run test && npm run build && npm run hud:check`
Expected: all tests pass, build succeeds, plate reports `mismatched: 0` and `PASS`.

Run: `grep -rn "rounded\|lucide\|drop-shadow" src/`
Expected: no output. Any hit is a constraint violation.

- [ ] **Step 7: Commit**

```bash
git add src/components/Panel.tsx src/components/Panel.test.tsx src/App.tsx
git commit -m "feat(ui): unify history, palette and settings into one panel; drop the CRT pass"
```

---

## Pixel-to-Pixel Verification Reference

The gate that makes "looks right" falsifiable.

**Generate the reference** (only when plate geometry intentionally changes):
```bash
npm run hud:ref
git diff --stat docs/design/reference/    # an unintended change shows up here
```

**Compare a capture:**
```bash
node tools/hud/cli.js compare docs/design/reference/plate-480@1x.png .artifacts/plate-actual.png --out .artifacts/plate-diff.png
```

**Reading a failure:**
- `FAIL size mismatch` — the capture is not 480×32. Crop to the plate rect; do not scale.
- `mismatched: N` with coordinates — the console prints the first twelve as `(x,y) ref #rrggbb actual #rrggbb Δn`. Cross-reference the coordinate against the slot table in `src/hud/plate.js`'s header comment to find which element moved.
- `.artifacts/plate-diff.png` — magenta on a dimmed original. A magenta rectangle is a displaced element; magenta speckle is a colour or antialiasing difference, which usually means something re-rendered text instead of blitting the buffer.

**Structural check without images:**
```bash
node tools/hud/cli.js ascii
```
Dumps the plate as classified characters. Catches collisions that a bounding-box assertion misses — this is how the 6px-pitch table overlap and the 1.4:1 contrast bug were both found.

**Tolerances:** `--tolerance 0 --max-bad 0` is correct and achievable, because the browser blits the same bytes the CLI generated. If a capture pipeline introduces colour management, use `--tolerance 2 --max-bad 0` rather than allowing bad pixels — a shifted element must never pass.

---

## Self-Review

**Spec coverage.** Material system → Task 1. Plate (variation 02, tools removed, widened panel, USAGE, sandbox tier) → Task 2 via `src/hud/plate.js`. Session strip → Task 7 (`Panel`). Rail → Task 3. Tool calls → Task 4. Diff/apply → Task 5. Approval → Task 6. Palette and settings → Task 7. **Gap accepted:** the shell spec's five-state reference is enforced by tokens in Task 1 and used in Tasks 3–4, but there is no dedicated task — it has no standalone deliverable.

**Placeholders.** None. Every code step carries the real content.

**Type consistency.** `BlockStatus` defined in `Rail.tsx` (Task 3), imported by `Block.tsx` (Task 3) and unchanged in Task 4. `ToolCall` defined in `types/terminal.ts` (Task 4), consumed by `ToolCall.tsx`. `PLATE_480.valueChars` (24) is used by both `truncateLeft` in `plate.js` and `toPlateState` in Task 2 — one constant, not two literals. `renderPlate(state, scale, spec)` has the same signature in `canvas.ts` and `cli.js`.

**Retired risk.** The renderer originally allocated `Buffer`, which would not run in the browser. That swap to `Uint8Array` has already been made and verified byte-neutral against the pre-swap reference (`mismatched: 0`), and `plate.js` is now confirmed free of Node builtins. Task 2 Step 6 keeps the check as a guard, not as open work.

**Live risk.** Every task after 1 assumes the material tokens are final. If a colour changes later, it changes in `material.css` only — a hex literal appearing in a component is a review rejection, because that is precisely how v0.1.0 ended up with a neutral grey ramp in `tailwind.config.js` and a second one inline.
