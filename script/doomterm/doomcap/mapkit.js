'use strict';
/* A small kit for drawing a Doom level from nothing: sectors, walls, fences and things go in, a PWAD comes out. The
   level's lumps are written here and its nodes are built by the `bsp` program (BSP 5.2; Fedora: dnf install bsp), which
   the engine needs. Coordinates are map units with y up. A wall runs with its front on the right. */
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

/* The linedef flags a level made here uses */
const LINE = { BLOCKING: 1, BLOCKMONSTERS: 2, TWOSIDED: 4, DONTPEGBOTTOM: 16 };
const MAP_LUMPS = ['THINGS', 'LINEDEFS', 'SIDEDEFS', 'VERTEXES', 'SEGS', 'SSECTORS', 'NODES', 'SECTORS', 'REJECT', 'BLOCKMAP'];

const name8 = (text) => {
  const out = Buffer.alloc(8);
  out.write(text.toUpperCase(), 0, 'latin1');
  return out;
};

/* A PWAD of the lumps given as [{ name, data }] */
function wadBytes(entries) {
  let at = 12;
  const placed = entries.map((e) => { const entry = { name: e.name, at, size: e.data.length }; at += e.data.length; return entry; });
  const head = Buffer.alloc(12);
  head.write('PWAD', 0, 'latin1');
  head.writeInt32LE(entries.length, 4);
  head.writeInt32LE(at, 8);
  const directory = Buffer.alloc(16 * entries.length);
  placed.forEach((p, i) => { directory.writeInt32LE(p.at, i * 16); directory.writeInt32LE(p.size, i * 16 + 4); directory.write(p.name, i * 16 + 8, 'latin1'); });
  return Buffer.concat([head, ...entries.map((e) => e.data), directory]);
}

class MapKit {
  constructor(map) {
    this.map = map;
    this.vertices = [];
    this.known = new Map();
    this.sectors = [];
    this.sides = [];
    this.lines = [];
    this.things = [];
    /* (a, b) => true when a monster in sector a may not see the player in sector b */
    this.cannotSee = null;
  }

  vertex(x, y) {
    const key = `${x},${y}`;
    if (!this.known.has(key)) { this.known.set(key, this.vertices.length); this.vertices.push([x, y]); }
    return this.known.get(key);
  }

  sector(options = {}) {
    this.sectors.push({ floor: 0, ceiling: 128, floorFlat: 'FLAT1', ceilingFlat: 'CEIL1_1', light: 160, ...options });
    return this.sectors.length - 1;
  }

  side(options) {
    this.sides.push({ upper: '-', lower: '-', middle: '-', ...options });
    return this.sides.length - 1;
  }

  /* One wall from a to b. `front` is the side on its right; a `back` side makes it passable. */
  line(a, b, { front, back, flags = 0 }) {
    const right = this.side(front);
    const left = back ? this.side(back) : -1;
    this.lines.push({ from: this.vertex(...a), to: this.vertex(...b), flags: flags | (left >= 0 ? LINE.TWOSIDED : LINE.BLOCKING), right, left });
  }

  /* A solid column in `sector`, its corners counter-clockwise */
  pillar(corners, sector, texture) {
    corners.forEach((a, i) => this.line(a, corners[(i + 1) % corners.length], { front: { sector, middle: texture } }));
  }

  /* An invisible line inside one sector that monsters cannot cross. The player and every missile pass. */
  fence(a, b, sector) {
    this.line(a, b, { front: { sector }, back: { sector }, flags: LINE.BLOCKMONSTERS });
  }

  /* The edge between two sectors with nothing drawn on it */
  seam(a, b, frontSector, backSector) {
    this.line(a, b, { front: { sector: frontSector }, back: { sector: backSector } });
  }

  thing(type, x, y, angle = 0) {
    this.things.push({ type, x, y, angle, skills: 7 });
  }

  /* The level's lumps before its nodes are built */
  lumps() {
    const things = Buffer.alloc(10 * this.things.length);
    this.things.forEach((t, i) => [t.x, t.y, t.angle, t.type, t.skills].forEach((v, k) => things.writeInt16LE(v, i * 10 + k * 2)));
    const lines = Buffer.alloc(14 * this.lines.length);
    this.lines.forEach((l, i) => [l.from, l.to, l.flags, 0, 0, l.right, l.left].forEach((v, k) => lines.writeInt16LE(v, i * 14 + k * 2)));
    const sides = Buffer.alloc(30 * this.sides.length);
    this.sides.forEach((s, i) => {
      const at = i * 30;
      name8(s.upper).copy(sides, at + 4);
      name8(s.lower).copy(sides, at + 12);
      name8(s.middle).copy(sides, at + 20);
      sides.writeInt16LE(s.sector, at + 28);
    });
    const vertices = Buffer.alloc(4 * this.vertices.length);
    this.vertices.forEach(([x, y], i) => { vertices.writeInt16LE(x, i * 4); vertices.writeInt16LE(y, i * 4 + 2); });
    const sectors = Buffer.alloc(26 * this.sectors.length);
    this.sectors.forEach((s, i) => {
      const at = i * 26;
      sectors.writeInt16LE(s.floor, at);
      sectors.writeInt16LE(s.ceiling, at + 2);
      name8(s.floorFlat).copy(sectors, at + 4);
      name8(s.ceilingFlat).copy(sectors, at + 12);
      sectors.writeInt16LE(s.light, at + 20);
    });
    return { THINGS: things, LINEDEFS: lines, SIDEDEFS: sides, VERTEXES: vertices, SECTORS: sectors };
  }

  /* One bit for every pair of sectors, set where `cannotSee` hides the player from a monster, in either direction */
  rejectTable() {
    const n = this.sectors.length, table = Buffer.alloc(Math.ceil((n * n) / 8));
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        if (this.cannotSee(a, b) || this.cannotSee(b, a)) table[(a * n + b) >> 3] |= 1 << ((a * n + b) & 7);
      }
    }
    return table;
  }

  /* The PWAD with its nodes built by `bsp` (or the program named by $BSP). The level's own reject table is kept. */
  build(program = process.env.BSP || 'bsp') {
    const lumps = this.lumps();
    if (this.cannotSee) lumps.REJECT = this.rejectTable();
    const entries = [{ name: this.map, data: Buffer.alloc(0) }, ...MAP_LUMPS.map((name) => ({ name, data: lumps[name] || Buffer.alloc(0) }))];
    const dir = fs.mkdtempSync(`${os.tmpdir()}/mapkit-`);
    try {
      fs.writeFileSync(`${dir}/in.wad`, wadBytes(entries));
      execFileSync(program, ['-q', ...(this.cannotSee ? ['-noreject'] : []), `${dir}/in.wad`, '-o', `${dir}/out.wad`], { stdio: 'pipe' });
      return fs.readFileSync(`${dir}/out.wad`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

module.exports = { MapKit, LINE, MAP_LUMPS, wadBytes, rect };
