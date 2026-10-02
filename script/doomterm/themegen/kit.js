/* Shared kit for the two proposed backdrops. Pure functions: no clock, no randomness beyond
   a fixed integer hash. Every scene renders into a palette-index buffer, so a frame can never
   hold more colours than its palette, which is what the GIF encoder needs (256 per frame). */
const Kit = (() => {
'use strict';
const W = 480, H = 300, FRAMES = 100, FPS = 12.5;
const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const mod = (a, n) => ((a % n) + n) % n;
/* rounded to 1e-9 so a phase computed at u = 1 lands exactly where it does at u = 0 */
const fract = (x) => { const q = Math.round((x - Math.floor(x)) * 1e9) / 1e9; return q >= 1 ? 0 : q; };
const hexRgb = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

function hash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/* Value noise on a torus: every period is a whole number of lattice cells, so a pattern shifted by
   exactly one period lands on itself. That is what lets a scrolling layer close its loop. */
function vnoise(x, y, px, py, s) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const X0 = mod(x0, px), X1 = mod(x0 + 1, px), Y0 = mod(y0, py), Y1 = mod(y0 + 1, py);
  const a = hash(X0, Y0, s), b = hash(X1, Y0, s), c = hash(X0, Y1, s), d = hash(X1, Y1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, px, py, s, oct) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(x * f, y * f, px * f, py * f, s + o * 17);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);
/* value in 0..1 to a ramp level, dithered by screen position */
const pk = (v, n, x, y) => clamp(Math.floor(v * (n - 1) + BAYER[((y & 3) << 2) | (x & 3)] + 0.5), 0, n - 1);

function Palette() {
  const colors = [];
  return {
    colors,
    one(hex) { colors.push(hexRgb(hex)); return colors.length - 1; },
    ramp(stops, n) {
      const base = colors.length;
      const cs = stops.map(([p, h]) => [p, hexRgb(h)]);
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1);
        let j = 0;
        while (j < cs.length - 2 && t > cs[j + 1][0]) j++;
        const [p0, c0] = cs[j], [p1, c1] = cs[j + 1];
        const k = clamp((t - p0) / (p1 - p0));
        colors.push([0, 1, 2].map((c) => Math.round(lerp(c0[c], c1[c], k))));
      }
      return { base, n };
    },
  };
}

/* Drawing on a palette-index buffer B. */
function Canvas(B) {
  const P = (x, y, c) => { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < W && y < H) B[y * W + x] = c; };
  const R = (x, y, w, h, c) => {
    x |= 0; y |= 0; w |= 0; h |= 0;
    const x1 = Math.min(W, x + w), y1 = Math.min(H, y + h);
    for (let j = Math.max(0, y); j < y1; j++) for (let i = Math.max(0, x); i < x1; i++) B[j * W + i] = c;
  };
  const poly = (pts, c) => {
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
    for (let y = Math.ceil(lo); y <= Math.floor(hi); y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
        if ((y0 <= y && y < y1) || (y1 <= y && y < y0)) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) P(x, y, c);
    }
  };
  const disc = (cx, cy, r, c) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.25) P(x, y, c);
    }
  };
  const ell = (cx, cy, rx, ry, c) => {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.05) P(x, y, c);
    }
  };
  /* a thick segment: every pixel within r of the line from (x0,y0) to (x1,y1) */
  const capsule = (x0, y0, x1, y1, r, c) => {
    const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1;
    for (let y = Math.floor(Math.min(y0, y1) - r); y <= Math.ceil(Math.max(y0, y1) + r); y++) {
      for (let x = Math.floor(Math.min(x0, x1) - r); x <= Math.ceil(Math.max(x0, x1) + r); x++) {
        const t = clamp(((x - x0) * dx + (y - y0) * dy) / len2);
        if ((x - (x0 + t * dx)) ** 2 + (y - (y0 + t * dy)) ** 2 <= r * r + 0.2) P(x, y, c);
      }
    }
  };
  return { P, R, poly, disc, ell, capsule };
}

/* A transparent drawing layer. Anything drawn on it can be composited onto a frame with a
   one-pixel outline around the silhouette, which is how the reference pixel vehicles are drawn. */
const NONE = 255;
function Layer() {
  const buf = new Uint8Array(W * H).fill(NONE);
  return { buf, ...Canvas(buf) };
}
function compose(B, layer, outline) {
  const L = layer.buf;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, v = L[i];
    if (v !== NONE) { B[i] = v; continue; }
    if (outline === undefined) continue;
    if ((x > 0 && L[i - 1] !== NONE) || (x < W - 1 && L[i + 1] !== NONE) || (y > 0 && L[i - W] !== NONE) || (y < H - 1 && L[i + W] !== NONE)) B[i] = outline;
  }
}

/* Noise sampled once per 2x2 block, which is enough for mist and halves the cost of a frame. */
function grid(y0, y1, fn) {
  const gw = W >> 1, gh = ((y1 - y0) >> 1) + 1;
  const a = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) a[j * gw + i] = fn(i * 2 + 1, y0 + j * 2 + 1);
  return (x, y) => a[(((y - y0) >> 1) * gw) + (x >> 1)];
}

function toRGBA(B, colors, out) {
  const lut = new Uint32Array(colors.length);
  colors.forEach((c, i) => { lut[i] = (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]; });
  const o32 = new Uint32Array(out.buffer, out.byteOffset, B.length);
  for (let i = 0; i < B.length; i++) o32[i] = lut[B[i]];
  return out;
}

return { W, H, FRAMES, FPS, TAU, NONE, clamp, lerp, smooth, mod, fract, hexRgb, hash, vnoise, fbm, pk, Palette, Canvas, Layer, compose, grid, toRGBA, BAYER };
})();
if (typeof module !== 'undefined') module.exports = Kit;
