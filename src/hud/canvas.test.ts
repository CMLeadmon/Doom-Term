import { describe, expect, it } from 'vitest';
import { plateSpec, waitingRowBox, WAITING_ROWS } from './plate.js';
import { waitingRowAtPoint } from './canvas';
import type { WaitingRow } from './state';

const row = (over: Partial<WaitingRow>): WaitingRow => ({
  sessionId: 'x', n: '1', name: 'NAME', status: 'quiet', tag: 'CLAU', ...over,
});

const rows = [
  row({ sessionId: 'a', n: '1', name: 'ONE' }),
  row({ sessionId: 'b', n: '2', name: 'TWO' }),
];

/** The plate scales at integer ratios; dpr 1 gives scale 2, so points double. */
const SCALE = 2;

describe('waitingRowAtPoint', () => {
  it('maps a scaled canvas point back to its waiting row', () => {
    const spec = plateSpec(720);
    expect(waitingRowAtPoint(1440, 1, (spec.zoneX + 60) * SCALE, 14 * SCALE, rows)?.sessionId)
      .toBe('b');
  });

  it('ignores the caption, narrow plates, and points outside the rows', () => {
    const wide = plateSpec(720);
    expect(waitingRowAtPoint(1440, 1, (wide.zoneX + 10) * SCALE, 8, rows)).toBeNull();
    expect(waitingRowAtPoint(960, 1, 100, 20, rows)).toBeNull();
    expect(waitingRowAtPoint(1440, 1, (wide.zoneX + 60) * SCALE, 31 * SCALE, rows)).toBeNull();
  });

  it('returns nothing for a row slot the list does not fill', () => {
    const spec = plateSpec(900);
    expect(waitingRowAtPoint(1800, 1, (spec.zoneX + 60) * SCALE, 22 * SCALE, rows)).toBeNull();
  });
});

describe('the second column is clickable, and only where it is drawn', () => {
  const six = Array.from({ length: WAITING_ROWS }, (_, i) =>
    row({ sessionId: `s${i}`, n: String(i + 1), name: `ROW-${i}` }));

  const spec = plateSpec(900);
  const at = (logicalX: number, logicalY: number) =>
    waitingRowAtPoint(900 * SCALE, 1, logicalX * SCALE, logicalY * SCALE, six);

  it('selects a row from the right column, not the left one beside it', () => {
    // The bug this guards is the obvious one: a hit test that derives the row
    // from y alone answers with the LEFT column's row wherever you click.
    const right = waitingRowBox(spec, 3, 'CLAU');
    expect(right).toBeTruthy();
    expect(at(right!.x + 2, right!.y + 2)?.sessionId).toBe('s3');
  });

  it('walks the whole right column in order', () => {
    for (const i of [3, 4, 5]) {
      const box = waitingRowBox(spec, i, 'CLAU')!;
      expect(at(box.x + 2, box.y + 2)?.sessionId).toBe(`s${i}`);
    }
  });

  it('selects nothing in the gutter between the columns', () => {
    const left = waitingRowBox(spec, 0, 'CLAU')!;
    const right = waitingRowBox(spec, 3, 'CLAU')!;
    const gutterMid = Math.floor((left.x + left.w + right.x) / 2);
    expect(gutterMid).toBeGreaterThan(left.x + left.w - 1);
    expect(gutterMid).toBeLessThan(right.x);
    expect(at(gutterMid, left.y + 2)).toBeNull();
  });

  it('agrees with the renderer everywhere, at every width', () => {
    // One predicate for both sides. Every point that resolves to a row must be
    // inside that row's painted box, and every painted row must be reachable.
    for (const w of [600, 660, 720, 900, 1100, 1400]) {
      const s = plateSpec(w);
      const hit = (lx: number, ly: number) =>
        waitingRowAtPoint(w * SCALE, 1, lx * SCALE, ly * SCALE, six);
      for (let i = 0; i < WAITING_ROWS; i++) {
        const box = waitingRowBox(s, i, six[i].tag);
        if (box) {
          expect(hit(box.x + 1, box.y + 1)?.sessionId).toBe(`s${i}`);
          expect(hit(box.x + box.w - 1, box.y + 1)?.sessionId).toBe(`s${i}`);
        } else {
          // Nothing was painted for this row, so nothing may be selected by it.
          const ghost = { x: s.zoneX + 58, y: 5 + (i % 3) * 8 };
          expect(hit(ghost.x + 1, ghost.y + 1)?.sessionId).not.toBe(`s${i}`);
        }
      }
    }
  });
});

describe('a row that was never painted is not clickable', () => {
  /**
   * The renderer skips any row whose right-aligned tag leaves fewer than three
   * characters for the name, and that threshold is per-row. Hit testing checked
   * only the coarse zone width and the row number, so it returned a session for
   * pixels where nothing had been drawn — an invisible control that still does
   * something.
   */
  const mixed = [
    row({ sessionId: 'short', n: '1', name: 'ALPHA', tag: 'SH' }),
    row({ sessionId: 'long', n: '2', name: 'BRAVO', tag: 'X'.repeat(24) }),
  ];

  const spec = plateSpec(720);
  const at = (available: number, logicalX: number, logicalY: number) =>
    waitingRowAtPoint(available, 1, logicalX * SCALE, logicalY * SCALE, mixed);

  it('still selects the row that IS painted', () => {
    expect(at(720 * SCALE, spec.zoneX + 60, 6)?.sessionId).toBe('short');
  });

  it('returns nothing where the skipped row would have been', () => {
    expect(at(720 * SCALE, spec.zoneX + 60, 14)).toBeNull();
  });

  it('selects both once the plate is wide enough to draw both', () => {
    const wide = plateSpec(1400);
    expect(at(1400 * SCALE, wide.zoneX + 60, 6)?.sessionId).toBe('short');
    expect(at(1400 * SCALE, wide.zoneX + 60, 14)?.sessionId).toBe('long');
  });
});
