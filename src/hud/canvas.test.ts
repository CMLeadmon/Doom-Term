import { describe, expect, it } from 'vitest';
import { plateSpec } from './plate.js';
import { waitingRowAtPoint, chipAtPoint } from './canvas';

const rows = [
  { sessionId: 'a', n: '1', name: 'ONE', tail: '2S' },
  { sessionId: 'b', n: '2', name: 'TWO', tail: '3S' },
];

describe('waitingRowAtPoint', () => {
  it('maps a scaled canvas point back to its waiting row', () => {
    const spec = plateSpec(720);
    const scale = 2;
    const x = (spec.zoneX + 60) * scale;
    const y = 14 * scale;

    expect(waitingRowAtPoint(1440, 1, x, y, rows)?.sessionId).toBe('b');
  });

  it('ignores the caption, narrow plates, and points outside the rows', () => {
    const wide = plateSpec(720);
    expect(waitingRowAtPoint(1440, 1, (wide.zoneX + 10) * 2, 8, rows)).toBeNull();
    expect(waitingRowAtPoint(960, 1, 100, 20, rows)).toBeNull();
    expect(waitingRowAtPoint(1440, 1, (wide.zoneX + 60) * 2, 31 * 2, rows)).toBeNull();
  });
});

describe('a row that was never painted is not clickable', () => {
  /**
   * The renderer skips any row whose right-aligned tail leaves fewer than three
   * characters for the name, and that threshold is per-row: `2S` and `EXIT 101`
   * are not the same width. Hit testing checked only the coarse zone width and
   * the row number, so it returned a session for pixels where nothing had been
   * drawn — an invisible control that still does something.
   */
  const mixed = [
    { sessionId: 'short', n: '1', name: 'ALPHA', tail: '2S' },
    { sessionId: 'long', n: '2', name: 'BRAVO', tail: 'EXIT 101', failed: true },
  ];

  // A logical plate width of 600 is where the review reproduced this: rows fit
  // at all, but only a short tail leaves room for a name. The plate scales at
  // integer ratios and dpr 1 gives scale 2, so the AVAILABLE width is doubled
  // and points are in device pixels.
  const SCALE = 2;
  const spec = plateSpec(600);
  const at = (available: number, logicalX: number, logicalY: number) =>
    waitingRowAtPoint(available, 1, logicalX * SCALE, logicalY * SCALE, mixed);

  it('still selects the row that IS painted', () => {
    expect(at(600 * SCALE, spec.zoneX + 60, 6)?.sessionId).toBe('short');
  });

  it('returns nothing where the skipped row would have been', () => {
    expect(at(600 * SCALE, spec.zoneX + 60, 14)).toBeNull();
  });

  it('selects both once the plate is wide enough to draw both', () => {
    const wide = plateSpec(900);
    expect(at(900 * SCALE, wide.zoneX + 60, 6)?.sessionId).toBe('short');
    expect(at(900 * SCALE, wide.zoneX + 60, 14)?.sessionId).toBe('long');
  });
});

describe('chipAtPoint', () => {
  it('detects clicks on each of the 3 chips', () => {
    const spec = plateSpec(720);
    const cardsX = typeof spec.cardsX === 'number' ? spec.cardsX : 720 - 81;
    const scale = 2;
    const x = (cardsX + 4) * scale;

    expect(chipAtPoint(1440, 1, x, 5 * scale)).toBe(0); // Top (Blue)
    expect(chipAtPoint(1440, 1, x, 15 * scale)).toBe(1); // Middle (Gold)
    expect(chipAtPoint(1440, 1, x, 25 * scale)).toBe(2); // Bottom (Red)
  });

  it('returns null outside the cards area', () => {
    const spec = plateSpec(720);
    const cardsX = typeof spec.cardsX === 'number' ? spec.cardsX : 720 - 81;
    const scale = 2;
    expect(chipAtPoint(1440, 1, (cardsX - 20) * scale, 5 * scale)).toBeNull();
    expect(chipAtPoint(1440, 1, (cardsX + 30) * scale, 5 * scale)).toBeNull();
  });
});
