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
