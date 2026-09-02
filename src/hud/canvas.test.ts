import { describe, expect, it } from 'vitest';
import { plateSpec } from './plate.js';
import { waitingRowAtPoint } from './canvas';

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
