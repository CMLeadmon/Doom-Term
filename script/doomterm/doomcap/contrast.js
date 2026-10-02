'use strict';
/* The measure behind the Blue Highway and Canopy table: the theme's text colour against the
   brightest tenth of the picture once the picture is faded over the theme's background. "Brightest
   tenth" is the 90th-percentile pixel luminance. */
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const luminance = (r, g, b) => 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b];
const hex = (color) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));

/* Every `stride`-th pixel in each direction of an RGB buffer, as a flat triple array */
function sample(rgb, width, height, stride) {
  const out = [];
  for (let y = 0; y < height; y += stride) for (let x = 0; x < width; x += stride) {
    const o = (y * width + x) * 3;
    out.push(rgb[o], rgb[o + 1], rgb[o + 2]);
  }
  return Uint8Array.from(out);
}

function brightestTenth(triples, bg, alpha) {
  const n = triples.length / 3, lum = new Float32Array(n), inv = 1 - alpha;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    lum[i] = luminance(Math.round(bg[0] * inv + triples[j] * alpha), Math.round(bg[1] * inv + triples[j + 1] * alpha), Math.round(bg[2] * inv + triples[j + 2] * alpha));
  }
  lum.sort();
  return lum[Math.floor(0.9 * (n - 1))];
}

/* The lowest contrast of `fg` over any of the sampled frames at footage opacity `alpha` (0..1) */
function worstContrast(samples, fg, bg, alpha) {
  const lf = luminance(fg[0], fg[1], fg[2]);
  let worst = Infinity;
  for (const s of samples) worst = Math.min(worst, (lf + 0.05) / (brightestTenth(s, bg, alpha) + 0.05));
  return worst;
}

/* The highest whole-percent opacity at which the worst contrast is still at least `target` */
function ceiling(samples, fg, bg, target) {
  if (worstContrast(samples, fg, bg, 1) >= target) return 100;
  let lo = 0, hi = 100;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (worstContrast(samples, fg, bg, mid / 100) >= target) lo = mid; else hi = mid;
  }
  return lo;
}

module.exports = { luminance, hex, sample, worstContrast, ceiling };
