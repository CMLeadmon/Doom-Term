/* Canvas painting for the plate and the agent rail. Every pixel here comes out
   of plate.js — the deprecated tree's reference renderer, shipped verbatim —
   so the marks and the plate cannot disagree with the app they came from. */
import * as VERBATIM from './plate.js';
import {
  Surface, upscale, px, well, drawAgentMark, STATUS_GLYPHS, COLORS,
} from './plate.js';

const STATUS_COLOR = {
  working: COLORS.stLive, failed: COLORS.stFail,
  asks: COLORS.stWait, quiet: COLORS.stIdle,
};

function blit(canvas, s) {
  canvas.width = s.w; canvas.height = s.h;
  canvas.style.width = `${s.w}px`; canvas.style.height = `${s.h}px`;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(s.data), s.w, s.h), 0, 0);
}

/* Mirrors src/hud/canvas.ts mountPlate: no 2D drawing calls and no font
   rendering in the browser — the canvas receives exactly the bytes plate.js
   produced, at an integer scale. */
export function paintPlate(canvas, state, logical, scale, mod = VERBATIM) {
  blit(canvas, mod.renderPlate(state, scale, mod.plateSpec(logical)));
}

export function paintMark(canvas, agent, phase, scale = 2) {
  const S = 24, s = Surface(S, S);
  well(s, 0, 0, S, S, COLORS.markFloor);
  drawAgentMark(s, agent, S / 2, S / 2, phase);
  blit(canvas, upscale(s, scale));
}

export function paintGlyph(canvas, status, scale = 2) {
  const rows = STATUS_GLYPHS[status] || STATUS_GLYPHS.quiet;
  const s = Surface(5, 6);
  const col = STATUS_COLOR[status] || COLORS.stIdle;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') px(s, x, y, 1, 1, col);
  });
  blit(canvas, upscale(s, scale));
}

/* The 1:1 study's mount. `still` freezes every mark at its base tone — used by
   the parity render, so the diff is not measuring which frame of the pulse
   happened to be caught. The fluid app drives the same primitives itself. */
export function mount(root, baseState, { still = false, logical = 1050, scale = 2 } = {}) {
  const plate = root.querySelector('canvas.plate');
  const marks = [...root.querySelectorAll('canvas.mk')];
  root.querySelectorAll('canvas.gl').forEach((c) => paintGlyph(c, c.dataset.status));

  const draw = (phase) => {
    paintPlate(plate, { ...baseState, pulse: phase, phase }, logical, scale);
    marks.forEach((c) => paintMark(c, c.dataset.agent,
      c.dataset.status === 'working' ? phase : undefined));
  };

  if (still || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    draw(undefined);
    return;
  }
  let last = 0;
  const tick = (now) => {
    const phase = (now % 500) / 500;
    if (now - last >= 33) { last = now; paintPlate(plate, { ...baseState, pulse: phase, phase }, logical, scale); }
    marks.forEach((c) => c.dataset.status === 'working' && paintMark(c, c.dataset.agent, phase));
    requestAnimationFrame(tick);
  };
  draw(0);
  requestAnimationFrame(tick);
}
