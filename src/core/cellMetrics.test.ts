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
