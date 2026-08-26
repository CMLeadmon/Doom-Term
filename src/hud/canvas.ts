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
