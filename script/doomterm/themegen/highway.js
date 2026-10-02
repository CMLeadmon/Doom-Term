/* Blue Highway: a misty West Virginia dawn behind a tractor-trailer that holds its place.
   Everything except the rig scrolls left; the sun and the rig never move. Each scrolling layer
   moves a whole number of its own tiles per loop, so frame 100 equals frame 0. */
const Highway = (() => {
'use strict';
const K = typeof Kit !== 'undefined' ? Kit : require('./kit.js');
const { W, H, FRAMES, TAU, NONE, clamp, lerp, smooth, mod, fract, hash, fbm, pk, Palette, Canvas, Layer, compose, grid } = K;

const SUN = { x: 307, y: 106, r: 19 };
const GY = 244;            // ground contact of the tyres
const BRIDGE_X = 67;       // gorge centre inside the far tile; crosses the sun at half loop
const SHIFT = { far: 480, mid: 960, near: 1440, road: 1800 };

const pal = Palette();
const SKY = pal.ramp([[0, '#173a78'], [.3, '#3a76b8'], [.55, '#86b8de'], [.75, '#cfe3ee'], [.89, '#f7dcc0'], [1, '#ffe9c6']], 40);
const SUNC = [pal.one('#fffaf0'), pal.one('#ffefc8'), pal.one('#ffd9a0')];
const FAR = pal.ramp([[0, '#235a49'], [1, '#b2d3c6']], 12);
const FARW = pal.ramp([[0, '#45703f'], [1, '#f1d9a8']], 8);
const MID = pal.ramp([[0, '#154a32'], [1, '#9cc4ac']], 12);
const MIDW = pal.ramp([[0, '#335c35'], [1, '#e8cf9c']], 8);
const NEAR = pal.ramp([[0, '#0b2c20'], [.5, '#17503a'], [1, '#68a083']], 12);
const BANK = pal.ramp([[0, '#12382a'], [.6, '#2a6a3e'], [1, '#7da04e']], 8);
const BRIDGE = [pal.one('#2c4a62'), pal.one('#46687f'), pal.one('#6c8ea3')];
const ASPH = pal.ramp([[0, '#18212f'], [1, '#3a4658']], 8);
const LINE = [pal.one('#e9f1f7'), pal.one('#b9c8d6')];
const RAIL = { hi: pal.one('#c3d0dc'), mid: pal.one('#8c9db0'), lo: pal.one('#56667a'), post: pal.one('#243040'), refl: pal.one('#ffa63a') };
const SIGN = { g: pal.one('#1f6b45'), gh: pal.one('#2a8a58'), w: pal.one('#f2f6f2') };
const SMOKE = pal.ramp([[0, '#eef3f8'], [1, '#93a7bc']], 5);
const BEAM = pal.ramp([[0, '#fff6d8'], [1, '#ffc872']], 4);
const WOOD = pal.one('#2a2018'), WIRE = pal.one('#1d2a3a');
const BARN = { wall: pal.one('#7a2b26'), roof: pal.one('#3a2c2c'), trim: pal.one('#d9d4c8'), silo: pal.one('#8aa0ab'), cap: pal.one('#4b5a66') };
const BIRD = pal.one('#1c3156');
const T = {
  shadow: ASPH.base,
  outline: pal.one('#070c16'),
  tl: pal.one('#dbe7f2'), tm: pal.one('#c3d3e2'), td: pal.one('#9fb4c8'), rib: pal.one('#b3c5d6'), top: pal.one('#f6fafd'),
  navy: pal.one('#15295a'), navyHi: pal.one('#274a86'), navyLo: pal.one('#0d1a3c'), skirt: pal.one('#0f1c3d'),
  blue: pal.one('#2196f3'), blueLo: pal.one('#1673c4'), orange: pal.one('#f37327'), orangeHi: pal.one('#ffa057'),
  ch1: pal.one('#f4fbff'), ch2: pal.one('#c5d3e0'), ch3: pal.one('#8497ab'), ch4: pal.one('#4b5d72'),
  under: pal.one('#0e1624'), under2: pal.one('#1b2636'),
  tire: pal.one('#0a0e16'), tire2: pal.one('#222c3c'), rim: pal.one('#9bb0c4'), rimLo: pal.one('#566a82'), hub: pal.one('#e2ecf5'), lug: pal.one('#2a3646'), shine: pal.one('#f2f8ff'),
  g1: pal.one('#8ec0e6'), g2: pal.one('#4e84b8'), g3: pal.one('#2b567f'), gs: pal.one('#d4ecfb'),
  lamp: pal.one('#fff4cc'), amber: pal.one('#ffa63a'), red: pal.one('#e8343c'), redDim: pal.one('#8c1c24'), rubber: pal.one('#141b26'),
  tapeW: pal.one('#e8eef4'), tapeR: pal.one('#c8323a'),
};
if (pal.colors.length > 256) throw new Error(`highway palette has ${pal.colors.length} colours`);

const tri = (f) => 1 - Math.abs(2 * f - 1);
/* one bob step up for a quarter of each cycle, the four-state cycle the reference pixel vehicles use */
const bob = (u, cycles, phase) => (Math.floor(fract(u * cycles + phase) * 4) === 1 ? -1 : 0);

const GLYPH = {
  W: ['#...#', '#...#', '#...#', '#.#.#', '##.##', '#...#'],
  V: ['#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...'],
  9: ['.###.', '#...#', '.####', '....#', '....#', '.###.'],
};

function wheel(c, cx, cy, rot, dual) {
  if (dual) c.disc(cx + 2, cy, 8, T.tire);
  for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
    const d = Math.hypot(dx, dy);
    if (d > 8.2) continue;
    let col = T.tire;
    if (d > 6.6) col = T.tire2;
    if (d <= 5.8) col = T.rim;
    if (d <= 5.8 && d > 5.0) col = T.rimLo;
    if (d <= 3.0) col = T.hub;
    const a = Math.atan2(dy, dx);
    if (d <= 5.2 && d > 3.2) {
      const q = mod(a - rot, TAU / 5);
      if (q < 0.36) col = T.shine;
      else if (Math.abs(q - TAU / 10) < 0.2 && d > 3.6 && d < 4.8) col = T.lug;
    }
    c.P(cx + dx, cy + dy, col);
  }
  c.P(cx, cy, T.lug);
}

function trailer(c, dyT) {
  const { R, P } = c;
  const x0 = 88, x1 = 310, y0 = 187 + dyT, y1 = 227 + dyT;
  // underside: rails, skirt, landing gear, rear bumper
  R(96, y1, 206, 3, T.under2);
  R(150, y1, 108, 9, T.skirt); R(150, y1, 108, 1, T.navyHi);
  R(264, y1, 2, 244 - y1, T.under); R(274, y1, 2, 244 - y1, T.under); R(262, 243, 16, 1, T.ch4); R(268, y1 + 3, 4, 2, T.ch3);
  R(84, y1 + 5, 8, 5, T.ch3); R(84, y1 + 5, 8, 1, T.ch2); R(84, y1 + 9, 8, 1, T.ch4);
  // box
  R(x0, y0, x1 - x0, y1 - y0, T.tl);
  R(x0, y0, x1 - x0, 2, T.top); R(x0, y0 + 2, x1 - x0, 1, T.tm);
  for (let x = x0 + 10; x < x1 - 2; x += 9) R(x, y0 + 3, 1, y1 - y0 - 6, (x - x0) % 27 === 1 ? T.td : T.rib);
  R(x0, y0, 1, y1 - y0, T.td); R(x1 - 2, y0, 2, y1 - y0, T.td);
  P(x0, y0, NONE); P(x1 - 1, y0, NONE); P(x0, y1 - 1, NONE);
  // rear doors
  R(x0 + 1, y0 + 3, 9, y1 - y0 - 4, T.tm);
  for (let y = y0 + 7; y < y1 - 4; y += 12) R(x0 + 1, y, 9, 1, T.td);
  R(x0 + 5, y0 + 3, 1, y1 - y0 - 6, T.td); R(x0 + 8, y0 + 11, 1, 13, T.ch4); R(x0 + 3, y0 + 11, 1, 13, T.ch4);
  // livery: three ridge lines over a navy band, a sun between the first two
  const band = y1 - 4;
  const sunX = x0 + 176, sunY = band - 17;
  c.disc(sunX, sunY, 3.4, T.orange); c.disc(sunX, sunY, 2, T.orangeHi);
  for (let x = x0 + 11; x < x1 - 2; x += 1) {
    const u0 = x - x0;
    const hA = Math.round(15 * tri(fract(u0 / 61 + 0.1)) + 4 * tri(fract(u0 / 17)));
    const hB = Math.round(11 * tri(fract(u0 / 43 + 0.5)) + 3 * tri(fract(u0 / 13)));
    const hC = Math.round(7 * tri(fract(u0 / 29 + 0.25)) + 2 * tri(fract(u0 / 9)));
    R(x, band - hA, 1, hA + 1, T.blue); P(x, band - hA, T.blueLo);
    R(x, band - hB, 1, hB + 1, T.navyHi);
    R(x, band - hC, 1, hC + 1, T.navy);
    P(x, band - hC, T.navyHi);
  }
  R(x0 + 10, band + 1, x1 - x0 - 12, 3, T.navy);
  R(x0 + 10, band + 1, x1 - x0 - 12, 1, T.orange);
  for (let x = x0 + 10; x < x1 - 2; x++) R(x, y1 - 2, 1, 1, Math.floor((x - x0) / 3) % 2 ? T.tapeW : T.tapeR);
  R(x0 + 10, y1 - 1, x1 - x0 - 12, 1, T.navyLo);
  // lights
  for (let x = x0 + 30; x < x1 - 6; x += 40) R(x, y0 + 1, 2, 1, T.amber);
  R(x0 + 1, y0 + 1, 2, 2, T.amber); R(x1 - 4, y0 + 1, 2, 2, T.amber);
  R(x0 + 1, y1 - 12, 2, 3, T.red); R(x0 + 1, y1 - 8, 2, 3, T.red); R(x0 + 1, y0 + 4, 2, 2, T.red); R(x0 + 3, y1 - 12, 1, 7, T.redDim);
  R(x1 - 1, y0, 1, y1 - y0, T.outline);
}

function tractor(c, dyC) {
  const { R, P, poly, disc } = c;
  const d = dyC;
  // frame, fifth wheel, air lines
  R(290, 229 + d, 142, 4, T.under2);
  R(292, 226 + d, 26, 3, T.under); R(292, 226 + d, 26, 1, T.ch4);
  R(311, 214, 1, 13, T.under); R(318, 214, 1, 13, T.under); R(311, 214, 8, 1, T.under); R(311, 220 + d, 15, 1, T.under); R(322, 220 + d, 1, 5, T.under);
  // fuel tank
  R(336, 229 + d, 28, 13, T.ch3); R(336, 229 + d, 28, 3, T.ch1); R(336, 232 + d, 28, 4, T.ch2); R(336, 239 + d, 28, 3, T.ch4);
  R(344, 229 + d, 1, 13, T.under2); R(356, 229 + d, 1, 13, T.under2); R(338, 227 + d, 4, 2, T.ch3);
  // sleeper with a roof fairing that rises to the trailer's roofline
  R(322, 196 + d, 36, 42 - d, T.navy);
  poly([[358, 194 + d], [358, 197 + d], [322, 197 + d], [322, 187 + d]], T.navyHi);
  poly([[322, 187 + d], [358, 194 + d], [358, 195 + d], [322, 188 + d]], T.orangeHi);
  R(329, 203 + d, 18, 10, T.g2); R(329, 203 + d, 18, 4, T.g1); R(329, 210 + d, 18, 3, T.g3);
  poly([[336, 203 + d], [339, 203 + d], [334, 212 + d], [331, 212 + d]], T.gs);
  R(349, 204 + d, 6, 8, T.navyLo); for (let y = 205; y < 212; y += 2) R(350, y + d, 4, 1, T.ch4);
  R(322, 197 + d, 1, 41 - d, T.outline);
  // cab
  poly([[393, 214 + d], [387, 196 + d], [360, 194 + d], [358, 238], [393, 238]], T.navy);
  R(360, 194 + d, 26, 2, T.navyHi); R(360, 194 + d, 26, 1, T.orangeHi);
  R(371, 196 + d, 20, 3, T.ch4); R(371, 196 + d, 20, 1, T.ch2);
  poly([[392, 213 + d], [386, 200 + d], [376, 200 + d], [376, 213 + d]], T.g2);
  poly([[386, 200 + d], [376, 200 + d], [376, 206 + d], [388, 206 + d]], T.g1);
  poly([[383, 200 + d], [380, 200 + d], [377, 213 + d], [379, 213 + d]], T.gs);
  poly([[374, 201 + d], [374, 213 + d], [362, 213 + d], [361, 205 + d]], T.g2);
  poly([[374, 201 + d], [374, 207 + d], [361, 207 + d], [361, 205 + d]], T.g1);
  poly([[369, 202 + d], [366, 202 + d], [363, 212 + d], [366, 212 + d]], T.gs);
  R(375, 214 + d, 1, 24 - d, T.navyLo); R(361, 214 + d, 1, 24 - d, T.navyLo); R(371, 221 + d, 4, 1, T.ch2); R(371, 222 + d, 4, 1, T.ch4);
  R(364, 238, 14, 2, T.ch3); R(364, 238, 14, 1, T.ch2);
  R(392, 204 + d, 5, 1, T.ch3); R(395, 202 + d, 3, 11, T.under2); R(395, 202 + d, 1, 11, T.ch2); R(396, 214 + d, 2, 3, T.under2); R(395, 214 + d, 1, 3, T.ch2);
  // hood, grille, lamp, bumper
  poly([[393, 214 + d], [426, 214 + d], [431, 219 + d], [431, 236], [393, 236]], T.navy);
  R(394, 214 + d, 32, 1, T.orangeHi); R(394, 215 + d, 32, 2, T.navyHi);
  for (let x = 399; x <= 411; x += 6) R(x, 220 + d, 3, 7, T.navyLo);
  R(393, 230 + d, 38, 1, T.ch3);
  R(427, 217 + d, 5, 18 - d, T.ch2); for (let y = 218; y < 235; y += 2) R(428, y + d, 4, 1, T.ch3);
  R(426, 215 + d, 6, 5, T.lamp); R(427, 216 + d, 3, 3, T.ch1); R(427, 220 + d, 5, 1, T.amber);
  R(428, 212 + d, 2, 2, T.ch2); P(428, 212 + d, T.ch1);
  R(425, 236, 13, 4, T.ch2); R(425, 236, 13, 1, T.ch1); R(425, 239, 13, 1, T.ch4);
  // beltline stripes across sleeper, cab and hood
  R(322, 224 + d, 108, 2, T.blue); R(322, 226 + d, 108, 1, T.orange); R(322, 218 + d, 36, 1, T.navyLo);
  R(358, 236, 3, 3, T.red);
  // exhaust stacks
  R(361, 170 + d, 3, 27, T.ch2); R(361, 170 + d, 1, 27, T.ch1); R(366, 170 + d, 3, 27, T.ch2); R(366, 170 + d, 1, 27, T.ch1);
  R(360, 168 + d, 5, 3, T.ch3); R(365, 168 + d, 5, 3, T.ch3); R(361, 190 + d, 3, 6, T.ch4); R(366, 190 + d, 3, 6, T.ch4);
  R(386, 199 + d, 3, 1, T.amber); R(358, 194 + d, 3, 1, T.amber);
  // steering well
  disc(410, 236, 10, T.under);
}

function drawRig(L, u) {
  const dyT = bob(u, 3, 0.6), dyC = bob(u, 5, 0.1);
  const rot = TAU * 5 * u;
  tractor(L, dyC);
  [[292, true], [311, true], [112, true], [131, true]].forEach(([x, dual]) => wheel(L, x, GY - 8, rot, dual));
  trailer(L, dyT);
  L.R(276, 232, 3, 12, T.rubber); L.R(100, 232, 3, 12, T.rubber); L.R(99, 232, 1, 12, T.ch4); L.R(277, 235, 1, 6, T.ch3); L.R(101, 235, 1, 6, T.ch3);
  wheel(L, 410, GY - 8, rot, false);
  L.R(397, 227 + dyC, 26, 2, T.navyHi); L.R(397, 229 + dyC, 2, 4, T.navy); L.R(421, 229 + dyC, 2, 4, T.navy);
}

function beam(c, u) {
  const flick = 1 + 0.06 * Math.sin(TAU * 2 * u);
  for (let x = 433; x < W; x++) {
    const dx = x - 433, fall = 1 - dx / 46;
    if (fall <= 0) break;
    const half = 3 + dx * 0.26;
    for (let y = Math.floor(218 - half); y <= Math.ceil(218 + half * 1.6); y++) {
      const q = (y - 218) / (y >= 218 ? half * 1.6 : half);
      const dens = fall * (1 - Math.abs(q)) * 0.95 * flick;
      if (dens > 0.04) { const l = pk(dens, 4, x, y); if (l > 0) c.P(x, y, BEAM.base + (3 - l)); }
    }
  }
}

function smoke(c, u) {
  // each puff is a cluster of lobes, solid in the core and dithered only at the rim
  for (let i = 0; i < 6; i++) {
    const t = fract(u * 3 + i / 6);
    const cx = 367 - t * 74 + 1.5 * Math.sin(TAU * (t * 2 + i));
    const cy = 167 - t * 30;
    const r = 2.4 + 6.2 * t;
    const lvl = Math.min(4, Math.floor(t * 4.6));
    for (let dy = -Math.ceil(r + 2); dy <= Math.ceil(r + 2); dy++) for (let dx = -Math.ceil(r + 2); dx <= Math.ceil(r + 2); dx++) {
      const lobe = Math.min(Math.hypot(dx, dy), Math.hypot(dx - r * 0.55, dy + r * 0.2) * 1.15, Math.hypot(dx + r * 0.5, dy - r * 0.25) * 1.2);
      if (lobe > r) continue;
      const dens = (1 - t * 0.6) * (1 - lobe / (r + 0.8)) * 2.2;
      const x = Math.round(cx + dx), y = Math.round(cy + dy);
      if (dens > 0.7 || pk(dens, 2, x, y) === 1) c.P(x, y, SMOKE.base + lvl);
    }
  }
}

function render(frame) {
  const u = frame / FRAMES;
  const B = new Uint8Array(W * H);
  const c = Canvas(B);

  const farTop = new Float32Array(W), midTop = new Float32Array(W), nearTop = new Float32Array(W), gorgeDx = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const xf = mod(x + u * SHIFT.far, 480);
    let dx = xf - BRIDGE_X; dx -= 480 * Math.round(dx / 480);
    gorgeDx[x] = dx;
    let crest = 136 - 42 * (1 - Math.abs(2 * fbm(xf / 480 * 5, 0.5, 5, 1, 11, 4) - 1));
    const adx = Math.abs(dx);
    if (adx < 54) crest = Math.max(crest, lerp(166, crest, Math.pow(smooth(adx / 54), 0.55)));
    farTop[x] = crest;

    const xm = mod(x + u * SHIFT.mid, 480);
    let m = 160 - 28 * (1 - Math.abs(2 * fbm(xm / 480 * 7, 0.5, 7, 1, 17, 4) - 1));
    m -= 5 * Math.max(0, hash(Math.floor(xm / 4), 2, 41) - 0.45) * tri(fract(xm / 4));
    midTop[x] = m;

    const xn = mod(x + u * SHIFT.near, 480);
    let n = 192 - 14 * (1 - Math.abs(2 * fbm(xn / 480 * 4, 0.5, 4, 1, 23, 3) - 1));
    const ci = Math.floor(xn / 10), f = fract(xn / 10), hg = 3 + 11 * hash(ci, 3, 43);
    n -= hg * (hash(ci, 4, 43) < 0.5 ? tri(f) : Math.sqrt(Math.max(0, 1 - (2 * f - 1) ** 2)));
    nearTop[x] = n;
  }

  const clouds = grid(0, 180, (x, y) => fbm(((x + u * 480) / 480) * 4, (y / 300) * 13, 4, 13, 3, 3));
  const clouds2 = grid(0, 150, (x, y) => fbm(((x + u * 960) / 480) * 3, (y / 300) * 9, 3, 9, 29, 3));
  const farFog = grid(86, 200, (x, y) => fbm(((x + u * SHIFT.far * 2) / 480) * 6, (y / 300) * 9, 6, 9, 5, 3));
  const midFog = grid(120, 226, (x, y) => fbm(((x + u * 480 * 3) / 480) * 5, (y / 300) * 9, 5, 9, 7, 3));
  const warmAt = (x, y) => 0.95 * Math.exp(-(((x - SUN.x) / 100) ** 2 + ((y - 124) / 70) ** 2));

  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      const o = y * W + x;
      let col;
      if (y >= 234) {
        if (y < 236) col = LINE[1];
        else {
          const g = hash(mod(x + u * SHIFT.road, 450), y, 77);
          const sheen = 0.2 * Math.exp(-(((x - SUN.x) / 90) ** 2)) * clamp(1 - (y - 236) / 30);
          col = ASPH.base + pk(0.22 + 0.5 * g + 0.1 * (y - 236) / 64 + sheen, ASPH.n, x, y);
          const xx = mod(x + u * SHIFT.road, 90);
          if (y >= 263 && y <= 266 && xx < 45) col = (y === 263 || y === 266) ? LINE[1] : LINE[0];
        }
      } else if (y >= 214) {
        const xp = mod(x + u * SHIFT.road, 45);
        if (y < 219) {
          col = y < 216 ? RAIL.hi : y < 218 ? RAIL.mid : RAIL.lo;
          if (y === 216 && xp >= 20 && xp < 22 && Math.floor((x + u * SHIFT.road) / 45) % 2 === 0) col = RAIL.refl;
        } else if (xp < 3 && y < 232) col = RAIL.post;
        else col = BANK.base + pk(0.15 + 0.2 * hash(x >> 1, y >> 1, 9) + (hash(x, y >> 3, 12) > 0.86 ? 0.28 : 0), BANK.n, x, y);
      } else if (y >= nearTop[x]) {
        const d = y - nearTop[x];
        if (d > 15) col = BANK.base + pk(0.25 + 0.45 * hash(x, y >> 1, 13) * (1 - (y - nearTop[x] - 15) / 40) + 0.12 * (y > 205 ? (y - 205) / 9 : 0), BANK.n, x, y);
        else col = NEAR.base + pk(0.1 + 0.42 * Math.max(0, 1 - d / 9) + 0.2 * hash(x >> 1, y >> 1, 3) + 0.22 * clamp((midFog(x, y) - 0.5) * 2 + 0.2) + 0.12 * (hash(x, y, 5) > 0.93 ? 1 : 0), NEAR.n, x, y);
      } else if (y >= midTop[x]) {
        const d = y - midTop[x];
        const m = clamp(0.06 + 0.5 * (d / 56) + (midFog(x, y) - 0.5) * 0.55) * 0.85;
        const rim = d < 1.5 ? 0.35 : 0;
        col = pk(warmAt(x, y), 2, x, y) === 1 ? MIDW.base + pk(m + rim, MIDW.n, x, y) : MID.base + pk(m + rim * 0.5, MID.n, x, y);
      } else if (y >= farTop[x]) {
        const d = y - farTop[x];
        const m = clamp(0.1 + 0.55 * (d / 60) + (farFog(x, y) - 0.5) * 0.5) * 0.9;
        const rim = d < 1.5 ? 0.3 : 0;
        col = pk(warmAt(x, y), 2, x, y) === 1 ? FARW.base + pk(m + rim, FARW.n, x, y) : FAR.base + pk(m + rim * 0.5, FAR.n, x, y);
      } else {
        const dsun = Math.hypot(x - SUN.x, y - SUN.y);
        if (dsun < SUN.r) col = dsun < SUN.r - 5 ? SUNC[0] : dsun < SUN.r - 2 ? SUNC[1] : SUNC[2];
        else {
          let v = Math.pow(clamp(y / 178), 1.15) * 0.8;
          v += 0.2 * Math.exp(-((dsun / 95) ** 2)) + 0.3 * Math.exp(-((dsun / 34) ** 2));
          const a = Math.atan2(y - SUN.y, x - SUN.x);
          v += 0.07 * Math.pow(clamp(0.5 + 0.5 * Math.sin(17 * a + 1.6 * Math.sin(TAU * u))), 3) * Math.exp(-dsun / 200);
          const streak = smooth((clouds(x, y) - 0.52) * 5) * 0.14 * smooth(y / 30) * (1 - smooth((y - 130) / 40));
          const puff = smooth((clouds2(x, y) - 0.56) * 6) * smooth(y / 14) * (1 - smooth((y - 118) / 30));
          v += streak + puff * (0.1 + 0.2 * clamp((y - 40) / 90)) * (1 + 0.5 * Math.exp(-((dsun / 120) ** 2)));
          v *= 0.78 + 0.22 * smooth(x / 280);
          col = SKY.base + pk(clamp(v), SKY.n, x, y);
        }
      }
      B[o] = col;
    }
  }

  bridge(B, gorgeDx, midTop);
  scenery(c, u, nearTop);
  const L = Layer();
  drawRig(L, u);
  c.R(92, GY, 346, 5, T.shadow);
  for (let x = 90; x < 440; x++) if ((x < 100 || x > 430) && (x & 1)) c.P(x, GY, ASPH.base + 2);
  compose(B, L, T.outline);
  beam(c, u);
  smoke(c, u);
  return B;
}

function bridge(B, gorgeDx, midTop) {
  const deck = 119;
  for (let x = 0; x < W; x++) {
    const dx = gorgeDx[x], adx = Math.abs(dx);
    if (adx > 56) continue;
    const arch = adx <= 42 ? 156 - 36 * (1 - (adx / 42) ** 2) : 0;
    for (let y = deck - 2; y < 170 && y < midTop[x]; y++) {
      let col = -1;
      if (y === deck || y === deck + 1) col = BRIDGE[0];
      else if (y === deck - 1 && (x & 1) === 0) col = BRIDGE[1];
      else if (adx <= 42 && y >= arch && y < arch + 2.5) col = BRIDGE[0];
      else if (adx <= 42 && y > deck + 1 && y < arch && Math.round(dx) % 6 === 0) col = BRIDGE[1];
      else if (adx > 42 && y > deck + 1 && y < arch + 40 && Math.round(dx) % 6 === 0 && y < 150) col = BRIDGE[2];
      if (col >= 0) B[y * W + x] = col;
    }
  }
}

/* Behind the rig: birds, a barn and silo, utility poles with sagging wires, the highway sign. */
function scenery(c, u, nearTop) {
  const { R, P, ell } = c;
  // a small flock gliding left, a little faster than the far ridge
  for (let i = 0; i < 5; i++) {
    const x = Math.round(mod(380 + i * 15 - u * 560, 560) - 40);
    const y = Math.round(74 + (i % 3) * 7 + 4 * Math.sin(TAU * (u * 2 + i * 0.3)));
    if (Math.floor(u * 32 + i * 0.5) % 2) { P(x - 1, y - 1, BIRD); P(x - 2, y - 2, BIRD); P(x + 1, y - 1, BIRD); P(x + 2, y - 2, BIRD); }
    else { P(x - 1, y, BIRD); P(x - 2, y + 1, BIRD); P(x + 1, y, BIRD); P(x + 2, y + 1, BIRD); }
    P(x, y, BIRD);
  }
  // barn and silo on the near hills, once per tile
  for (let k = 0; k < 3; k++) {
    const xc = Math.round(mod(300 - u * SHIFT.near + k * 480, 1440) - 20);
    if (xc < -40 || xc > W + 40) continue;
    const base = Math.round(nearTop[clamp(xc, 0, W - 1)]) + 3;
    R(xc - 13, base - 14, 26, 14, BARN.wall);
    c.poly([[xc - 15, base - 13], [xc - 9, base - 21], [xc + 9, base - 21], [xc + 15, base - 13]], BARN.roof);
    R(xc - 4, base - 10, 8, 10, BARN.trim); R(xc - 3, base - 9, 6, 9, BARN.wall);
    c.capsule(xc - 3, base - 9, xc + 3, base - 1, 0.5, BARN.trim); c.capsule(xc + 3, base - 9, xc - 3, base - 1, 0.5, BARN.trim);
    R(xc + 15, base - 24, 7, 24, BARN.silo); R(xc + 15, base - 24, 2, 24, BARN.trim);
    ell(xc + 18.5, base - 25, 4, 3, BARN.cap);
  }
  // poles and wires at road speed
  const pole = mod(400 - u * SHIFT.road, 450);
  for (let k = -1; k < 2; k++) {
    const px = Math.round(pole + k * 450);
    if (px < -20 || px > W + 20) continue;
    R(px - 1, 128, 3, 90, WOOD); R(px - 8, 133, 17, 2, WOOD); R(px - 7, 131, 1, 2, RAIL.hi); R(px + 7, 131, 1, 2, RAIL.hi);
  }
  for (let x = 0; x < W; x++) {
    const t = mod(x - pole, 450) / 450, sag = 4 * t * (1 - t) * 15;
    P(x, Math.round(132 + sag), WIRE); P(x, Math.round(136 + sag), WIRE);
  }
  // highway sign
  const ox = mod(250 - u * SHIFT.road, 900) - 40;
  if (ox > -40 && ox < W) {
    R(ox + 7, 192, 2, 22, RAIL.post); R(ox + 25, 192, 2, 22, RAIL.post);
    R(ox, 174, 34, 18, SIGN.w); R(ox + 1, 175, 32, 16, SIGN.g); R(ox + 1, 175, 32, 1, SIGN.gh);
    const put = (ch, gx, gy) => GLYPH[ch].forEach((row, j) => [...row].forEach((v, i) => { if (v === '#') P(ox + gx + i, gy + j, SIGN.w); }));
    put('W', 5, 178); put('V', 11, 178); put('7', 20, 178); put('9', 26, 178);
    R(ox + 4, 186, 26, 1, SIGN.w);
  }
}

/* the rig alone on a transparent layer, for tests */
function rig(frame) { const L = Layer(); drawRig(L, frame / FRAMES); return L.buf; }

return { id: 'bluehighway', W, H, FRAMES, palette: pal.colors, render, rig, hero: 50 };
})();
if (typeof module !== 'undefined') module.exports = Highway;
