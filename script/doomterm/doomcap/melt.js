'use strict';
/* The screen melt: the transition Doom plays between two screens, written from how it behaves
   rather than copied. The screen is cut into columns two pixels wide. Each column waits a staggered
   number of tics, then falls away at a growing speed, uncovering the second screen from the top
   while the first slides down over it. No new colour is ever made, so the result stays within a
   frame's 256 colours. */

const COLUMN = 2;

function xorshift32(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s;
  };
}

/* One start offset per column: the first within 15 tics of zero, each later one within one of its
   neighbour, none earlier than 15 tics. */
function startOffsets(columns, random) {
  const y = new Int32Array(columns);
  y[0] = -(random() % 16);
  for (let i = 1; i < columns; i++) {
    y[i] = y[i - 1] + (random() % 3) - 1;
    if (y[i] > 0) y[i] = 0;
    else if (y[i] === -16) y[i] = -15;
  }
  return y;
}

/* One game tic: waiting columns count toward zero, falling columns move 1, 2, 4, 8 rows and then 8 a
   tic. Returns true while any column moved. */
function tick(y, height) {
  let moved = false;
  for (let i = 0; i < y.length; i++) {
    if (y[i] < 0) {
      y[i]++;
      moved = true;
    } else if (y[i] < height) {
      let dy = y[i] < 16 ? y[i] + 1 : 8;
      if (y[i] + dy >= height) dy = height - y[i];
      y[i] += dy;
      moved = true;
    }
  }
  return moved;
}

/* The screen with every column fallen to its offset: the second screen shows above the offset at its
   own height, and the first screen slid down by the offset shows below it. */
function render(from, to, y, width, height) {
  const out = new Uint32Array(width * height);
  for (let x = 0; x < width; x++) {
    const cut = Math.min(Math.max(y[(x / COLUMN) | 0], 0), height);
    for (let r = 0; r < cut; r++) out[r * width + x] = to[r * width + x];
    for (let r = cut; r < height; r++) out[r * width + x] = from[(r - cut) * width + x];
  }
  return out;
}

/* A frame is a repeat of the screen that follows the melt once fewer than this share of its pixels differ */
const SETTLED = 0.005;

/* Every `ticsPerFrame` tics, a frame of the melt from `from` to `to`, stopping once the frame is
   all but the second screen, which is the frame that follows the melt. */
function meltFrames(from, to, { width, height, seed = 1993, ticsPerFrame = 2 }) {
  const y = startOffsets(width / COLUMN, xorshift32(seed));
  const out = [];
  for (;;) {
    let moved = false;
    for (let t = 0; t < ticsPerFrame; t++) moved = tick(y, height) || moved;
    if (!moved) return out;
    const frame = render(from, to, y, width, height);
    let differing = 0;
    for (let i = 0; i < frame.length; i++) if (frame[i] !== to[i]) differing++;
    if (differing < frame.length * SETTLED) return out;
    out.push(frame);
  }
}

module.exports = { meltFrames, startOffsets, tick, render, xorshift32, COLUMN, SETTLED };
