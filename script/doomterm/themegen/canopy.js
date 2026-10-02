/* Canopy: the inside of an Amazon rainforest. Tall trunks stand in mist under a leaf ceiling, and
   shafts of light enter through a gap at the top right. A scarlet macaw crosses once per loop, a
   spider monkey swings on a liana, blue morphos flutter, leaves fall, and the floor is busy with a
   mossy log, a poison-dart frog, mushrooms, ferns and a rippling puddle. Every term is periodic in
   the loop phase u, so frame 100 equals frame 0. */
const Canopy = (() => {
'use strict';
const K = typeof Kit !== 'undefined' ? Kit : require('./kit.js');
const { W, H, FRAMES, TAU, NONE, clamp, lerp, smooth, mod, fract, hash, fbm, pk, Palette, Canvas, Layer, compose, grid } = K;

const pal = Palette();
const HAZE = pal.ramp([[0, '#04130d'], [.28, '#0c3d2b'], [.52, '#2f8a55'], [.74, '#a2d46c'], [.9, '#e6f2a8'], [1, '#fffadc']], 40);
const FARC = pal.ramp([[0, '#0f4a3c'], [.55, '#4d9a78'], [1, '#c4e6b4']], 12);
const BARK = pal.ramp([[0, '#0b0805'], [.42, '#2a2211'], [.74, '#566a38'], [1, '#a8c888']], 14);
const LEAF = pal.ramp([[0, '#031e13'], [.55, '#0f5a30'], [1, '#52b05a']], 12);
const FLOOR = pal.ramp([[0, '#02140c'], [.5, '#0b3f27'], [1, '#4a9a52']], 12);
const FRONT = pal.ramp([[0, '#02140c'], [.55, '#0a4a28'], [1, '#58b05a']], 12);
const FRONTH = pal.one('#8fdc78');
const LIANA = [pal.one('#0a1a0f'), pal.one('#16341d')];
const MOTE = [pal.one('#fff3a0'), pal.one('#d6ff7a'), pal.one('#8cffa0')];
const BLOOM = [pal.one('#ff5a3c'), pal.one('#ffb23a'), pal.one('#e86ab8')];
const MOSS = pal.ramp([[0, '#0d2a14'], [1, '#6fb04a']], 6);
const LITTER = pal.ramp([[0, '#1a1208'], [.5, '#5a4020'], [1, '#a8803a']], 6);
const RINGS = [pal.one('#a9824e'), pal.one('#7a5a30'), pal.one('#c9a46a')];
const GLOW = pal.ramp([[0, '#133f3a'], [.4, '#1c6a5c'], [.75, '#37a790'], [1, '#9ffff0']], 4);
const MUSH = { red: pal.one('#d8362a'), orange: pal.one('#f09a30'), cream: pal.one('#e8dcc0'), dot: pal.one('#f6f2e6'), stem: pal.one('#cfc5a8') };
const FROG = { blue: pal.one('#2a62d0'), pale: pal.one('#7fa8f0'), spot: pal.one('#0a0a1a'), gold: pal.one('#f0c030') };
const MACAW = { red: pal.one('#d9281c'), redDk: pal.one('#8e1612'), yellow: pal.one('#ffcc2a'), blue: pal.one('#2a63d6'), blueDk: pal.one('#1a3f94'), turq: pal.one('#26b6d8'), white: pal.one('#f2ece2'), beak: pal.one('#e8dcc0'), beakDk: pal.one('#3a3028'), eye: pal.one('#0a0606'), outline: pal.one('#140c0c') };
const MONKEY = { dk: pal.one('#3b2514'), mid: pal.one('#5a3a1e'), belly: pal.one('#9a7144'), skin: pal.one('#c79a72'), hand: pal.one('#1a1008'), eyeW: pal.one('#f4ead0'), outline: pal.one('#0b0804') };
const VINE = [pal.one('#2d3b1c'), pal.one('#4b6a2c')];
const MORPHO = { blue: pal.one('#2d6bff'), light: pal.one('#8ccaff'), edge: pal.one('#06123a') };
const EGRET = pal.one('#f4f0e6');
const FALL = [pal.one('#8ac24a'), pal.one('#d9c84a')];
if (pal.colors.length > 256) throw new Error(`canopy palette has ${pal.colors.length} colours`);

const FLOOR_Y = 198;
const FAR = Array.from({ length: 17 }, (_, i) => ({
  x: (i + 0.15 + 0.7 * hash(i, 1, 101)) * (W / 17), w: 2.2 + 3 * hash(i, 2, 101), lean: (hash(i, 3, 101) - 0.5) * 18,
}));
const MID = [
  { x: 54, w: 10, lean: 6, seed: 3 }, { x: 148, w: 7, lean: -5, seed: 4 }, { x: 236, w: 11, lean: 4, seed: 5 },
  { x: 326, w: 8, lean: -6, seed: 6 }, { x: 404, w: 9, lean: 5, seed: 7 }, { x: 462, w: 6, lean: -3, seed: 8 },
];
const trunkX = (t, y) => t.x + t.lean * ((y - 150) / 150) + 2 * Math.sin(y * 0.02 + t.seed);

/* Shafts run down and to the left at about 28 degrees from vertical. p is the distance across
   them, q the distance along them from the gap. */
function lightAt(x, y, u) {
  const p = x * 0.88 + y * 0.47, q = -x * 0.47 + y * 0.88;
  const a = Math.sin(TAU * (p / 96 - u)) + 0.6 * Math.sin(TAU * (p / 51 - 2 * u) + 1.1) + 0.35 * Math.sin(TAU * (p / 29 - u) + 2.3);
  const shaft = Math.pow(clamp(0.5 + 0.28 * a), 2.0);
  const dapple = fbm(p / 18, q / 26, 40, 40, 13, 2);
  const along = Math.exp(-Math.max(0, q + 110) / 300);
  return shaft * (0.45 + 0.55 * dapple) * along * (1 + 0.1 * Math.sin(TAU * u));
}

function ceiling(u) {
  const out = new Float32Array(W);
  const n = 11, cx = [], cy = [], cr = [];
  for (let i = 0; i < n; i++) { cx.push((i + hash(i, 1, 61) * 0.6) * (W / n)); cr.push(24 + 22 * hash(i, 2, 61)); cy.push(18 + 22 * hash(i, 3, 61)); }
  for (let x = 0; x < W; x++) {
    const xs = x + 2.2 * Math.sin(TAU * u + x * 0.025);
    let best = 14;
    for (let i = 0; i < n; i++) {
      let dx = xs - cx[i]; dx -= W * Math.round(dx / W);
      if (Math.abs(dx) < cr[i]) best = Math.max(best, cy[i] + Math.sqrt(cr[i] ** 2 - dx * dx) * 0.8);
    }
    out[x] = lerp(best, 4, smooth((x - 330) / 90) * 0.9);
  }
  return out;
}

/* ------------------------------------------------------------------ foliage */
const FRONDS = [
  { bx: -22, by: 300, ang: -1.2, len: 200, wid: 28, droop: 1.45, amp: 0.035, ph: 0.4, light: 1 },
  { bx: -30, by: 262, ang: -0.55, len: 170, wid: 24, droop: 1.1, amp: 0.04, ph: 2.2, light: 1 },
  { bx: 14, by: 312, ang: -1.75, len: 150, wid: 22, droop: -0.3, amp: 0.03, ph: 4.1, light: -1 },
  { bx: 504, by: 306, ang: -1.95, len: 190, wid: 27, droop: -1.35, amp: 0.035, ph: 3.3, light: -1 },
  { bx: 498, by: 270, ang: -2.55, len: 150, wid: 22, droop: -1.0, amp: 0.04, ph: 5.2, light: -1 },
];
function frond(c, f, u) {
  const a0 = f.ang + f.amp * Math.sin(TAU * u + f.ph);
  const N = Math.ceil(f.len * 1.6), ds = f.len / N;
  let x = f.bx, y = f.by;
  for (let i = 0; i <= N; i++) {
    const t = i / N, th = a0 + f.droop * t * t;
    const nx = -Math.sin(th), ny = Math.cos(th);
    const hw = f.wid * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 0.85) * (t < 0.05 ? t / 0.05 : 1);
    for (let j = -hw; j <= hw; j += 0.55) {
      const px = Math.round(x + nx * j), py = Math.round(y + ny * j);
      const side = hw > 0 ? j / hw : 0;
      let v = 0.28 + 0.26 * side * f.light + 0.14 * (1 - t);
      if (fract(t * f.len / 7 - Math.abs(j) / (hw * 2 + 1)) < 0.12) v -= 0.14;
      if (Math.abs(j) < 0.75) v += 0.34;
      let col = FRONT.base + pk(clamp(v), FRONT.n, px, py);
      if (Math.abs(side) > 0.92 && side * f.light > 0) col = FRONTH;
      c.P(px, py, col);
    }
    x += Math.cos(th) * ds; y += Math.sin(th) * ds;
  }
}

/* A fern: nine arching fronds fanned from a base, each lined with leaflets, swaying in place. */
function fern(c, bx, by, s, u, ph, lift) {
  const nf = 9;
  for (let i = 0; i < nf; i++) {
    const a0 = -2.75 + i * (2.2 / (nf - 1)) + 0.05 * Math.sin(TAU * u + ph + i);
    const len = (32 + 10 * Math.sin(i * 1.7 + ph)) * s;
    const dir = Math.sign(Math.cos(a0)) || 1;
    let x = bx, y = by, a = a0;
    const steps = Math.ceil(len / 1.5);
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      a += dir * (0.02 + 0.035 * t);
      x += Math.cos(a) * 1.5; y += Math.sin(a) * 1.5;
      c.P(Math.round(x), Math.round(y), FRONT.base + pk(clamp(0.9 + lift), FRONT.n, k, i));
      if (k % 2 === 0) {
        const ll = (1 - t) * 5 * s + 1, nx = -Math.sin(a), ny = Math.cos(a);
        for (let j = 1; j <= ll; j++) {
          const col = FRONT.base + pk(clamp(0.5 + 0.42 * (1 - t) + lift - j * 0.04), FRONT.n, k + j, i);
          c.P(Math.round(x + nx * j + Math.cos(a) * j * 0.5), Math.round(y + ny * j + Math.sin(a) * j * 0.5), col);
          c.P(Math.round(x - nx * j + Math.cos(a) * j * 0.5), Math.round(y - ny * j + Math.sin(a) * j * 0.5), col);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ the floor */
function floorProps(c, u) {
  const { P, R, ell, disc, capsule } = c;
  // leaf litter
  for (let y = 204; y < H; y++) for (let x = 0; x < W; x++) {
    const h = hash(x, y, 71);
    if (h > 0.972 - (y - 204) * 0.0001) {
      const col = hash(x, y, 72) > 0.93 ? FALL[1] : LITTER.base + 1 + Math.floor(hash(x, y, 73) * 3);
      P(x, y, col);
      if (hash(x >> 1, y, 74) > 0.5) P(x + 1, y, col);
    }
  }
  // puddle with ripples and a reflection of the bright gap
  const pcx = 338, pcy = 258, prx = 58, pry = 10;
  ell(pcx, pcy, prx + 1, pry + 1, FLOOR.base);
  for (let y = pcy - pry; y <= pcy + pry; y++) for (let x = pcx - prx; x <= pcx + prx; x++) {
    const e = ((x - pcx) / prx) ** 2 + ((y - pcy) / pry) ** 2;
    if (e > 1) continue;
    const gap = Math.exp(-(((x - 410) / 150) ** 2));
    const v = 0.2 + 0.3 * gap + 0.03 * Math.sin((y - pcy) * 2.1 + x * 0.04 + TAU * u) + 0.05 * (1 - e) - 0.22 * smooth((e - 0.65) / 0.35);
    P(x, y, HAZE.base + pk(clamp(v), HAZE.n, x, y));
  }
  [[330, 257, 0], [356, 260, 1], [314, 262, 2]].forEach(([dx, dy, k]) => {
    const t = fract(u * 3 + k / 3), r = 1.5 + 24 * t;
    for (let a = 0, na = Math.max(60, Math.round(r * 9)); a < na; a++) {
      const th = (a / na) * TAU, x = Math.round(dx + Math.cos(th) * r), y = Math.round(dy + Math.sin(th) * r * 0.2);
      const e = ((x - pcx) / prx) ** 2 + ((y - pcy) / pry) ** 2;
      if (e < 0.92 && (1 - t) > 0.12) P(x, y, HAZE.base + Math.min(HAZE.n - 1, 22 + Math.round((1 - t) * 14)));
    }
  });
  // mossy fallen log, cut end facing right
  const ly = 243, x0 = 84, x1 = 250;
  ell(x1 - 70, ly + 9, 90, 3.5, FLOOR.base);
  for (let x = x0; x <= x1; x++) {
    const r = 8 - 0.8 * (x - x0) / (x1 - x0) + 0.6 * Math.sin(x * 0.11);
    for (let y = Math.floor(ly - r); y <= Math.ceil(ly + r); y++) {
      const d = (y - ly) / r;
      const bark = fbm(x * 0.5, y / 3, 80, 12, 21, 3);
      const v = 0.34 + 0.3 * (-d) + 0.4 * (bark - 0.5) - (d > 0.6 ? 0.18 : 0);
      let col = BARK.base + pk(clamp(v), BARK.n, x, y);
      const mossAmt = smooth((-d - 0.25) / 0.5) * (0.4 + 0.7 * fbm(x / 9, y / 4, 18, 8, 33, 2)) + 0.2 * smooth(fbm(x / 6, y / 5, 28, 8, 35, 2) - 0.6);
      if (mossAmt > 0.5) col = MOSS.base + pk(clamp(0.35 + 0.5 * (-d) + 0.3 * (fbm(x / 3, y / 3, 60, 12, 37, 2) - 0.5)), MOSS.n, x, y);
      P(x, y, col);
    }
  }
  ell(x1, ly, 3.4, 8.3, RINGS[1]); ell(x1, ly, 2.6, 6.6, RINGS[0]); ell(x1, ly, 1.6, 4.0, RINGS[1]); ell(x1, ly, 0.8, 1.8, RINGS[2]);
  // poison-dart frog on the log, throat pulsing
  const fx = 176, fy = 234, pulse = 0.5 + 0.5 * Math.sin(TAU * 6 * u);
  ell(fx, fy - 3.5, 6.4, 4, FROG.blue);
  capsule(fx - 4, fy - 1, fx - 9, fy + 0.5, 1.5, FROG.blue); capsule(fx - 9, fy + 0.5, fx - 5, fy + 1.6, 1.2, FROG.blue);
  capsule(fx + 4, fy - 1, fx + 8, fy, 1.2, FROG.blue); P(fx + 9, fy, FROG.spot);
  ell(fx + 5.5, fy - 2 + pulse * 0.5, 1.8 + pulse * 0.9, 1.5 + pulse * 0.9, FROG.pale);
  [[-2, -6], [-4, -3], [1, -4], [-1, -2], [-5, -5], [2, -7]].forEach(([dx, dy]) => { P(fx + dx, fy + dy, FROG.spot); P(fx + dx + 1, fy + dy, FROG.spot); });
  disc(fx + 3.5, fy - 7, 1.9, FROG.gold); P(fx + 4, fy - 7, FROG.spot);
  // mushrooms by the log's far end
  const cap = (mx, my, w, h, col, dots) => {
    R(mx, my, 1, h, MUSH.stem); ell(mx, my, w, h * 0.55, col);
    if (dots) { P(mx - 1, my - 1, MUSH.dot); P(mx + 1, my, MUSH.dot); }
  };
  cap(92, 248, 4, 6, MUSH.red, true); cap(100, 250, 3, 4, MUSH.orange, false); cap(105, 247, 3, 5, MUSH.cream, false); cap(88, 251, 2, 3, MUSH.red, false);
  // a bioluminescent cluster that breathes
  const gl = 0.55 + 0.45 * Math.sin(TAU * 3 * u);
  for (let y = 236; y <= 262; y++) for (let x = 268; x <= 304; x++) {
    const d = Math.hypot((x - 286) / 1.5, y - 249), dens = (1 - d / 15) * gl;
    if (d < 15 && dens > 0.05 && pk(dens, 2, x, y) === 1) P(x, y, GLOW.base + (dens > 0.5 ? 1 : 0));
  }
  [[281, 252, 2], [287, 250, 3], [292, 253, 2], [284, 255, 1], [290, 256, 1]].forEach(([mx, my, h]) => { R(mx, my - h, 1, h + 1, GLOW.base + 1); R(mx - 1, my - h - 1, 3, 1, GLOW.base + (gl > 0.5 ? 3 : 2)); });
  // ferns at three depths
  [[22, 226, .6, 0.3], [62, 222, .55, 1.4], [196, 226, .6, 2.2], [262, 232, .7, 3.1], [372, 230, .7, 0.9], [440, 236, .8, 4.0], [476, 226, .6, 5.1], [120, 228, .7, 2.9]].forEach(([bx, by, s, ph]) => fern(c, bx, by, s, u, ph, 0.04));
}

/* ------------------------------------------------------------------ creatures */
function macaw(c, u) {
  const { R, P, disc, ell, capsule } = c;
  const cx = (W + 60) - u * (W + 120), cy = 116 + 14 * Math.sin(TAU * u) - 1.5 * Math.sin(TAU * 20 * u + 1.2);
  const ph = TAU * 20 * u;
  // far wing, behind the body
  const wing = (rootX, rootY, a, near) => {
    const tipX = rootX + 17 * Math.cos(a) + 5, tipY = rootY + 17 * Math.sin(a);
    const midX = rootX + (tipX - rootX) * 0.42, midY = rootY + (tipY - rootY) * 0.42;
    capsule(rootX, rootY, midX, midY, near ? 2.7 : 2.3, MACAW.yellow);
    capsule(midX, midY, tipX, tipY, near ? 2.2 : 1.9, near ? MACAW.blue : MACAW.blueDk);
    capsule(midX + 1, midY + 1, tipX, tipY, 0.9, MACAW.turq);
    capsule(rootX, rootY, rootX + 3, rootY + 1, near ? 2 : 1.6, MACAW.red);
  };
  const a = -0.35 - 1.05 * Math.sin(ph);
  wing(cx - 1, cy - 2, a - 0.15, false);
  // tail
  capsule(cx + 5, cy + 0.5, cx + 17, cy + 3, 1.7, MACAW.red); capsule(cx + 15, cy + 3, cx + 26, cy + 5, 1.4, MACAW.blue); capsule(cx + 18, cy + 4, cx + 26, cy + 5, 0.6, MACAW.yellow);
  // body, head, beak
  capsule(cx + 4, cy, cx - 6, cy - 1, 3.3, MACAW.red); capsule(cx + 2, cy + 1.5, cx - 4, cy + 1.2, 1.3, MACAW.redDk);
  disc(cx - 9, cy - 2, 3.2, MACAW.red); ell(cx - 11, cy - 2, 1.7, 2.1, MACAW.white); P(cx - 11, cy - 3, MACAW.eye);
  capsule(cx - 12, cy - 1, cx - 14, cy + 1.5, 1.3, MACAW.beak); P(cx - 14, cy + 2, MACAW.beakDk); P(cx - 13, cy + 2, MACAW.beakDk);
  P(cx - 7, cy - 4, MACAW.yellow); P(cx - 8, cy - 5, MACAW.red);
  capsule(cx - 5, cy + 3, cx - 5, cy + 4, 0.7, MACAW.beakDk);
  wing(cx - 2, cy - 2, a, true);
}

function egrets(c, u) {
  for (let i = 0; i < 4; i++) {
    const x = Math.round(mod(60 + i * 18 + u * 560, 560) - 40), y = Math.round(78 + (i % 2) * 8 + 3 * Math.sin(TAU * (u * 2 + i * 0.4)));
    if (Math.floor(u * 24 + i * 0.5) % 2) { c.P(x - 1, y - 1, EGRET); c.P(x - 2, y - 2, EGRET); c.P(x + 1, y - 1, EGRET); c.P(x + 2, y - 2, EGRET); }
    else { c.P(x - 1, y, EGRET); c.P(x - 2, y + 1, EGRET); c.P(x + 1, y, EGRET); c.P(x + 2, y + 1, EGRET); }
    c.P(x, y, EGRET);
  }
}

/* A spider monkey hanging from a liana by one arm, swinging as a pendulum with its body, legs and
   prehensile tail trailing a little behind. */
function monkey(c, u) {
  const { P, disc, ell, capsule } = c;
  const ax = 366, ay = 6, len = 108;
  const th = 0.42 * Math.sin(TAU * 2 * u);
  const gx = ax + len * Math.sin(th), gy = ay + len * Math.cos(th);
  capsule(ax, ay, gx, gy, 1.1, VINE[0]); capsule(ax + 1, ay, gx + 1, gy, 0.5, VINE[1]);
  const tb = 0.46 * Math.sin(TAU * 2 * u - 0.35);
  const d = [Math.sin(tb), Math.cos(tb)], n = [Math.cos(tb), -Math.sin(tb)];
  const at = (p, a, b) => [p[0] + d[0] * a + n[0] * b, p[1] + d[1] * a + n[1] * b];
  const G = [gx, gy], S = at(G, 9, 0), Hp = at(S, 11, 0);
  const sw = (k) => Math.sin(TAU * 2 * u + k);
  // tail
  let tx = Hp[0], ty = Hp[1], ta = Math.atan2(d[1], d[0]) + 2.2 + 0.25 * sw(-0.9);
  for (let i = 0; i < 20; i++) { ta -= 0.11 + 0.012 * i; tx += Math.cos(ta) * 1.4; ty += Math.sin(ta) * 1.4; disc(tx, ty, 1.05 - i * 0.012, MONKEY.mid); }
  // far leg, far arm
  const K2 = at(Hp, 5, 3 + 2.5 * sw(-0.6)), F2 = at(K2, 6, 1.5);
  capsule(Hp[0], Hp[1], K2[0], K2[1], 1.3, MONKEY.mid); capsule(K2[0], K2[1], F2[0], F2[1], 1.1, MONKEY.mid); disc(F2[0], F2[1], 1.3, MONKEY.hand);
  // body and belly
  capsule(S[0], S[1], Hp[0], Hp[1], 3.1, MONKEY.dk);
  const b0 = at(S, 1, 1.2), b1 = at(Hp, -1, 1.2);
  capsule(b0[0], b0[1], b1[0], b1[1], 1.4, MONKEY.belly);
  // near leg
  const K1 = at(Hp, 5, -2 + 3 * sw(-1.2)), F1 = at(K1, 6, -3 * sw(-1.2));
  capsule(Hp[0], Hp[1], K1[0], K1[1], 1.5, MONKEY.dk); capsule(K1[0], K1[1], F1[0], F1[1], 1.3, MONKEY.dk); disc(F1[0], F1[1], 1.5, MONKEY.hand);
  // free arm reaching forward
  const E = at(S, 5, 5 + 2.5 * sw(0.9)), Hn = at(E, 4, 2 * sw(0.9));
  capsule(S[0], S[1], E[0], E[1], 1.3, MONKEY.dk); capsule(E[0], E[1], Hn[0], Hn[1], 1.2, MONKEY.dk); disc(Hn[0], Hn[1], 1.4, MONKEY.hand);
  // gripping arm and hand
  capsule(S[0], S[1], G[0], G[1], 1.4, MONKEY.dk); disc(G[0], G[1], 1.7, MONKEY.hand);
  // head
  const hd = at(S, -1.5, 3.5);
  disc(hd[0], hd[1], 3.8, MONKEY.dk);
  const face = at(hd, 0.5, 1.9);
  ell(face[0], face[1], 2.3, 2.6, MONKEY.skin);
  const eye = at(hd, -0.8, 2.4); P(Math.round(eye[0]), Math.round(eye[1]), MONKEY.eyeW); P(Math.round(eye[0] + n[0]), Math.round(eye[1] + n[1]), MONKEY.hand);
  const ear = at(hd, -1.5, -2.2); disc(ear[0], ear[1], 1.1, MONKEY.mid);
  const mouth = at(hd, 2.2, 3); P(Math.round(mouth[0]), Math.round(mouth[1]), MONKEY.hand);
}

function morphos(c, u) {
  [[150, 150, 34, 14, 1, 1, 0.1], [300, 188, 28, 12, 2, 1, 0.45], [214, 132, 22, 10, 1, 2, 0.8]].forEach(([bx, by, ax, ay, c1, c2, ph], i) => {
    const x = bx + ax * Math.sin(TAU * (c1 * u + ph)), y = by + ay * Math.sin(TAU * (c2 * u + ph * 1.7));
    const open = Math.abs(Math.sin(TAU * (16 * u + i * 0.2)));
    const w = Math.round(1 + 3 * open), h = Math.round(1 + 2 * open);
    for (const s of [-1, 1]) {
      for (let dy = -h; dy <= h; dy++) for (let dx = 1; dx <= w; dx++) {
        if (dx * dx / (w * w + 0.1) + dy * dy / (h * h + 0.1) > 1.1) continue;
        c.P(Math.round(x + s * dx), Math.round(y + dy), dx === w || Math.abs(dy) === h ? MORPHO.edge : dy < 0 ? MORPHO.light : MORPHO.blue);
      }
    }
    c.P(Math.round(x), Math.round(y), MORPHO.edge); c.P(Math.round(x), Math.round(y + 1), MORPHO.edge);
  });
}

function fallingLeaves(c, u) {
  for (let i = 0; i < 8; i++) {
    const span = H + 40;
    const y = mod(hash(i, 1, 81) * span + u * span, span) - 20;
    const x = hash(i, 2, 81) * W + 12 * Math.sin(TAU * (2 * u + hash(i, 3, 81)));
    const flip = Math.sin(TAU * (4 * u + i * 0.3)) > 0;
    const col = FALL[i % 2], xr = Math.round(x), yr = Math.round(y);
    c.P(xr, yr, col); c.P(xr + 1, yr + (flip ? 1 : 0), col); c.P(xr + 2, yr + (flip ? 0 : 1), col);
  }
}

function render(frame) {
  const u = frame / FRAMES;
  const B = new Uint8Array(W * H);
  const c = Canvas(B);
  const ceil = ceiling(u);

  const FB = Layer();
  floorProps(FB, u);

  const light = grid(0, H, (x, y) => lightAt(x, y, u));
  const mistA = grid(0, H, (x, y) => fbm(((x + u * 240) / 240) * 4, (y / 300) * 9, 4, 9, 5, 3));
  const mistB = grid(0, H, (x, y) => fbm(((x - u * 160) / 160) * 3, (y / 300) * 11, 3, 11, 9, 3));

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sw = 1.6 * Math.sin(TAU * u + y * 0.045 + x * 0.013);
      const ray = light(x, y);
      const fog = (mistA(x, y) + mistB(x, y)) * 0.5;
      const ground = Math.exp(-(((y - 204) / 34) ** 2)) * clamp((fog - 0.34) * 3.2);
      let col;
      if (y < ceil[x]) {
        const d = ceil[x] - y;
        const tex = fbm((x + sw) / 7, y / 7, 69, 64, 11, 3);
        const v = 0.10 + 0.50 * Math.exp(-d / 5) * (0.35 + 0.65 * clamp(x / 420)) + 0.5 * (tex - 0.5) * (0.4 + Math.exp(-d / 14)) + 0.5 * ray * Math.exp(-d / 14);
        col = LEAF.base + pk(clamp(v), LEAF.n, x, y);
      } else {
        let hit = -1, side = 0, cxp = 0, hw = 0;
        for (let i = 0; i < MID.length; i++) {
          const t = MID[i];
          cxp = trunkX(t, y);
          hw = t.w * 0.5 + Math.pow(Math.max(0, y - 232) / 64, 2) * 9;
          if (Math.abs(x - cxp) <= hw) { hit = i; side = (x - cxp) / hw; break; }
        }
        if (hit >= 0) {
          const t = MID[hit];
          const bark = fbm((x - t.x) * 0.9 + t.seed * 7, y / 20, 30, 24, t.seed, 3);
          const v = 0.16 + 0.34 * clamp(0.5 + side * 0.55) + 0.34 * (bark - 0.5) + 0.55 * ray + 0.45 * ground + 0.18 * clamp((fog - 0.45) * 2);
          col = BARK.base + pk(clamp(v), BARK.n, x, y);
        } else if (y >= FLOOR_Y) {
          const fb = FB.buf[y * W + x];
          if (fb !== NONE) col = fb;
          else {
            const tex = fbm(x / 6, y / 9, 80, 40, 17, 3);
            const v = 0.16 + 0.42 * Math.exp(-(y - FLOOR_Y) / 26) + 0.42 * (tex - 0.5) + 0.3 * ray + 0.4 * ground - 0.2 * smooth((y - 252) / 40);
            col = FLOOR.base + pk(clamp(v), FLOOR.n, x, y);
          }
        } else {
          let far = false, fs = 0;
          for (let i = 0; i < FAR.length; i++) {
            const t = FAR[i];
            const cxp2 = t.x + t.lean * ((y - 100) / 200);
            if (Math.abs(x - cxp2) <= t.w * 0.5) { far = true; fs = (x - cxp2) / (t.w * 0.5); break; }
          }
          if (far) {
            const hz = 0.32 * Math.exp(-(((y - 178) / 70) ** 2));
            const v = 0.22 + 0.10 * fs + hz * 0.9 + 0.5 * ray + 0.3 * (fog - 0.5) + 0.3 * ground - 0.14 * smooth((100 - y) / 80);
            col = FARC.base + pk(clamp(v), FARC.n, x, y);
          } else {
            const gap = Math.exp(-((((x - 410) / 150) ** 2) + (((y - 6) / 120) ** 2)));
            const v = 0.16 + 0.32 * Math.exp(-(((y - 178) / 70) ** 2)) + 0.52 * gap + 0.5 * ray + 0.3 * (fog - 0.5) + 0.3 * ground;
            col = HAZE.base + pk(clamp(v), HAZE.n, x, y);
          }
        }
      }
      B[y * W + x] = col;
    }
  }

  // blooms on two trunks, a bromeliad on a third, blooms along the ceiling edge
  [[MID[2], 168, 1], [MID[4], 150, -1]].forEach(([t, y, s]) => {
    const bx = Math.round(trunkX(t, y) + s * (t.w * 0.5 + 2));
    c.P(bx, y, BLOOM[0]); c.P(bx + 1, y, BLOOM[0]); c.P(bx, y + 1, BLOOM[1]); c.P(bx - 1, y - 1, BLOOM[2]); c.P(bx + 1, y - 1, BLOOM[2]);
  });
  { const t = MID[1], by = 206, bx = Math.round(trunkX(t, by));
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI + (i / 8) * Math.PI + 0.05 * Math.sin(TAU * u + i);
      c.capsule(bx, by, bx + Math.cos(a) * 9, by + Math.sin(a) * 7, 0.8, FRONT.base + 6 + (i % 3));
    }
    c.disc(bx, by - 1, 1.6, BLOOM[0]); c.P(bx, by - 2, BLOOM[1]); }
  [60, 128, 214, 290, 402, 452].forEach((x, i) => { const y = Math.floor(ceil[x]) + 1; c.P(x, y, BLOOM[i % 3]); c.P(x + 1, y, BLOOM[(i + 1) % 3]); c.P(x, y + 1, BLOOM[i % 3]); });

  // hanging lianas
  [[40, 120, 0.5], [118, 150, 2.1], [196, 96, 4.0], [276, 170, 1.2], [436, 110, 3.3]].forEach(([x0, len, ph], i) => {
    const top = Math.floor(ceil[x0]) - 4;
    for (let y = Math.max(0, top); y < top + len; y++) {
      const x = Math.round(x0 + 5 * Math.sin(y * 0.034 + ph + TAU * u) * ((y - top) / len));
      c.P(x, y, LIANA[0]);
      if (i % 2 === 0) c.P(x + 1, y, LIANA[1]);
      if ((y - top) % 17 === 9) { c.P(x - 1, y, FRONT.base + 6); c.P(x + 2, y, FRONT.base + 6); c.P(x, y + 1, FRONT.base + 5); }
    }
  });

  // fireflies
  for (let i = 0; i < 34; i++) {
    const bx = hash(i, 1, 91) * W, by = 90 + hash(i, 2, 91) * 170;
    const cx = bx + (6 + 10 * hash(i, 3, 91)) * Math.sin(TAU * (1 + (i % 2)) * u + hash(i, 4, 91) * TAU);
    const cy = by + (4 + 8 * hash(i, 5, 91)) * Math.sin(TAU * (1 + ((i >> 1) % 2)) * u + hash(i, 6, 91) * TAU);
    const b = 0.5 + 0.5 * Math.sin(TAU * (1 + (i % 3)) * u + hash(i, 7, 91) * TAU);
    if (b < 0.25) continue;
    const x = Math.round(cx), y = Math.round(cy);
    c.P(x, y, b > 0.7 ? MOTE[0] : MOTE[1]);
    if (b > 0.85) { c.P(x - 1, y, MOTE[2]); c.P(x + 1, y, MOTE[2]); c.P(x, y - 1, MOTE[2]); c.P(x, y + 1, MOTE[2]); }
  }

  egrets(c, u);
  // creatures, outlined, in front of the trunks
  const SP = Layer();
  monkey(SP, u);
  compose(B, SP, MONKEY.outline);
  const BD = Layer();
  macaw(BD, u);
  compose(B, BD, MACAW.outline);
  const BF = Layer();
  morphos(BF, u);
  compose(B, BF);
  fallingLeaves(c, u);

  // foreground: near ferns and corner fronds
  fern(c, 112, 302, 1.5, u, 0.7, -0.04); fern(c, 256, 304, 1.65, u, 2.4, -0.06); fern(c, 392, 300, 1.45, u, 4.2, -0.04);
  FRONDS.forEach((f) => frond(c, f, u));
  return B;
}

return { id: 'canopy', W, H, FRAMES, palette: pal.colors, render, hero: 46 };
})();
if (typeof module !== 'undefined') module.exports = Canopy;
