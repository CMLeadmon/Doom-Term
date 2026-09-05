import {
  renderPlate,
  plateSpec,
  waitingRowBox,
  WAITING_ROWS,
} from './plate.js';
import { plateScale, plateWidth } from './state';
import type { WaitingRow } from './state';

/**
 * Resolve a pointer in CSS pixels to one of the rows drawn by drawWaiting().
 *
 * This does not compute a row from the point; it asks each row where it was
 * PAINTED and checks whether the point landed there. The distinction is the
 * whole correctness argument. Deriving an index from y alone was survivable
 * while the well was a single column, and stopped being so the moment a second
 * one appeared beside it: every click in the right-hand column would have
 * answered with the left-hand row sharing its row band.
 *
 * Asking waitingRowBox() also keeps the per-row skip honest for free. A row
 * whose right-aligned tag leaves fewer than three characters for its name is
 * never painted, and now can never be selected either — the two decisions are
 * the same call.
 */
export function waitingRowAtPoint(
  availableWidth: number,
  devicePixelRatio: number,
  x: number,
  y: number,
  rows: WaitingRow[],
): WaitingRow | null {
  const scale = plateScale(devicePixelRatio);
  const spec = plateSpec(plateWidth(availableWidth, scale));
  const logicalX = x / scale;
  const logicalY = y / scale;

  for (let i = 0; i < Math.min(WAITING_ROWS, rows.length); i++) {
    const box = waitingRowBox(spec, i, String(rows[i].tag ?? ''));
    if (!box) continue;
    if (logicalX < box.x || logicalX >= box.x + box.w) continue;
    const withinGlyph = logicalY - box.y;
    if (withinGlyph >= 0 && withinGlyph < 6) return rows[i];
  }
  return null;
}

/**
 * Detects clicks on the MODE plate cell to trigger the permission mode selector.
 */
export function modeAtPoint(
  availableWidth: number,
  devicePixelRatio: number,
  x: number,
  y: number,
): boolean {
  const scale = plateScale(devicePixelRatio);
  const w = plateWidth(availableWidth, scale);
  const spec = plateSpec(w);
  const sandboxX = typeof spec.sandboxX === 'number' ? spec.sandboxX : w - 99;
  const logicalX = x / scale;
  const logicalY = y / scale;
  return (
    logicalX >= sandboxX - 56 &&
    logicalX <= sandboxX + 6 &&
    logicalY >= 2 &&
    logicalY <= 30
  );
}

/**
 * Blits renderPlate()'s RGBA buffer straight into the canvas. No 2D drawing
 * calls, no font rendering in the browser — the browser paints exactly the
 * bytes the reference CLI produced. Returns the scale used.
 *
 * The plate is drawn to the FULL available width rather than to a fixed 480
 * and letterboxed: it is the machine's front panel, not a widget floating on
 * black, and the width is what gives the waiting column somewhere to live.
 */
export function mountPlate(
  canvas: HTMLCanvasElement,
  state: Record<string, unknown>,
  availableWidth: number,
  devicePixelRatio: number = 1,
): number {
  const scale = plateScale(devicePixelRatio);
  const s = renderPlate(state, scale, plateSpec(plateWidth(availableWidth, scale)));
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
