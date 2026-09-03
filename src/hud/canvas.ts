import {
  renderPlate,
  plateSpec,
  waitingRowIsRendered,
  WAITING_ROWS,
  WAITING_ROWS_MIN_W,
} from './plate.js';
import { plateScale, plateWidth } from './state';
import type { WaitingRow } from './state';

/**
 * Resolve a pointer in CSS pixels to one of the rows drawn by drawWaiting().
 * The renderer and this hit test share the exported geometry constants; a row
 * cannot become clickable somewhere different from where its pixels live.
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
  if (spec.zoneW < WAITING_ROWS_MIN_W) return null;
  const logicalX = x / scale;
  const logicalY = y / scale;
  const rowX = spec.zoneX + 58;
  if (logicalX < rowX || logicalX >= spec.zoneX + spec.zoneW) return null;
  const index = Math.floor((logicalY - 5) / 8);
  if (index < 0 || index >= WAITING_ROWS || index >= rows.length) return null;
  // Ask whether this row was actually PAINTED, rather than assuming the coarse
  // zone-width check above stands in for it. The renderer also skips any row
  // whose right-aligned tail leaves fewer than three characters for the name,
  // and that is per-row: at a logical width of 600 a short `2S` row is drawn
  // while `ASKS`, `EXIT 1` and `EXIT 101` are not. Hit testing still returned a
  // session for those positions — a control you cannot see that does something.
  if (!waitingRowIsRendered(spec, String(rows[index].tail ?? ''))) return null;
  const withinGlyph = logicalY - (5 + index * 8);
  return withinGlyph >= 0 && withinGlyph < 6 ? rows[index] : null;
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
