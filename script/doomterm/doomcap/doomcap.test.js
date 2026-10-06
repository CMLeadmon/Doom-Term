'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const Gif = require('../themegen/gif.js');
const { readWad, parseDemo } = require('./wad.js');
const { frames: readFrames, record } = require('./frames.js');
const { meltFrames, startOffsets, tick, render, xorshift32, SETTLED } = require('./melt.js');
const { aspectCorrect, delaysFor, indexFrames, buildLoop, WIDTH, HEIGHT, SOURCE_HEIGHT } = require('./build.js');
const { worstContrast, ceiling, sample } = require('./contrast.js');
const { KeyScript, turnTics, NAMED, isKey } = require('./keys.js');
const { MapKit, LINE, MAP_LUMPS, wadBytes, rect } = require('./mapkit.js');
const { buildNave, NAVE, MAP, CYBERDEMON, PLAYER } = require('./bfr.pwad.js');
const { raiseSprites, SPRITES, DEFAULT_PIXELS } = require('./raise_weapon.js');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

function wadWith(type, lumps) {
  const header = Buffer.alloc(12);
  header.write(type, 0, 'latin1');
  let offset = 12;
  const bodies = lumps.map(([, body]) => { const at = offset; offset += body.length; return at; });
  header.writeInt32LE(lumps.length, 4);
  header.writeInt32LE(offset, 8);
  const dir = Buffer.alloc(16 * lumps.length);
  lumps.forEach(([name, body], i) => {
    dir.writeInt32LE(bodies[i], i * 16); dir.writeInt32LE(body.length, i * 16 + 4); dir.write(name, i * 16 + 8, 'latin1');
  });
  return Buffer.concat([header, ...lumps.map(([, body]) => body), dir]);
}

function demo(tics, { version = 109, players = 1 } = {}) {
  const head = Buffer.from([version, 2, 1, 3, 0, 0, 0, 0, 0, players > 0 ? 1 : 0, players > 1 ? 1 : 0, 0, 0]);
  return Buffer.concat([head, Buffer.alloc(tics * 4 * players), Buffer.from([0x80])]);
}

test('a WAD is read into its type, directory and lumps', () => {
  const wad = readWad(wadWith('IWAD', [['DEMO2', demo(10)], ['PLAYPAL', Buffer.from('abc')]]));
  assert.equal(wad.type, 'IWAD');
  assert.deepEqual(wad.lumps.map((l) => l.name), ['DEMO2', 'PLAYPAL']);
  assert.equal(wad.lump('playpal').toString(), 'abc');
  assert.match(wad.sha1, /^[0-9a-f]{40}$/);
});

test('a file that is not a WAD, or lies about its directory, is refused', () => {
  assert.throws(() => readWad(Buffer.from('PK\u0003\u0004nothing here')), /not a WAD/);
  assert.throws(() => readWad(Buffer.alloc(4)), /shorter than a header/);
  const bad = wadWith('IWAD', [['A', Buffer.from('x')]]);
  bad.writeInt32LE(1000, 8);
  assert.throws(() => readWad(bad), /outside the file/);
  assert.throws(() => readWad(wadWith('IWAD', [['A', Buffer.from('x')]])).lump('missing'), /no lump named MISSING/);
});

test('a demo header and its length in tics are read', () => {
  assert.deepEqual(parseDemo(demo(3836)), { version: 109, skill: 2, episode: 1, map: 3, players: 1, tics: 3836 });
  assert.equal(parseDemo(demo(50, { players: 2 })).tics, 50);
});

test('a demo of another version, without its end marker or cut short is refused', () => {
  assert.throws(() => parseDemo(demo(5, { version: 104 })), /version 109/);
  const unmarked = demo(5); unmarked[unmarked.length - 1] = 0;
  assert.throws(() => parseDemo(unmarked), /end marker/);
  assert.throws(() => parseDemo(demo(5).subarray(0, 10)), /shorter than its header/);
  const ragged = Buffer.concat([demo(5).subarray(0, 15), Buffer.from([0x80])]);
  assert.throws(() => parseDemo(ragged), /whole number of tics/);
});

test('the frame stream the shim writes reads back as the pixels that went in', () => {
  const a = Uint32Array.from([0xff0000, 0x00ff00, 0x0000ff, 0x123456]);
  const b = Uint32Array.from([1, 2, 3, 4]);
  const stream = Buffer.concat([record(35, 2, 2, a), record(37, 2, 2, b)]);
  const read = [...readFrames(stream)];
  assert.deepEqual(read.map((f) => [f.index, f.width, f.height]), [[35, 2, 2], [37, 2, 2]]);
  assert.deepEqual([...read[0].pixels], [...a]);
  assert.deepEqual([...read[1].pixels], [...b]);
  assert.throws(() => [...readFrames(stream.subarray(0, stream.length - 3))], /cut short/);
  assert.throws(() => [...readFrames(Buffer.concat([stream, Buffer.from('garbage-garbage-g')]))], /no frame record/);
});

/* Frames whose every pixel says where it came from, so the melt can be checked pixel by pixel */
const MARK_FROM = 0x100000, MARK_TO = 0x200000;
const markedFrame = (mark, w, h) => Uint32Array.from({ length: w * h }, (_, i) => mark | i);

test('the melt only ever shows pixels of the two screens, each in a place the melt allows', () => {
  const w = 40, h = 60, from = markedFrame(MARK_FROM, w, h), to = markedFrame(MARK_TO, w, h);
  const melt = meltFrames(from, to, { width: w, height: h });
  assert.ok(melt.length > 5);
  for (const f of melt) {
    for (let x = 0; x < w; x++) {
      let cut = 0;
      while (cut < h && f[cut * w + x] === (MARK_TO | (cut * w + x))) cut++;
      for (let r = cut; r < h; r++) assert.equal(f[r * w + x], MARK_FROM | ((r - cut) * w + x), `column ${x} row ${r}`);
    }
  }
});

test('a column that has begun to fall never climbs back, and the melt starts and ends on the two screens', () => {
  const w = 40, h = 60, from = markedFrame(MARK_FROM, w, h), to = markedFrame(MARK_TO, w, h);
  const melt = meltFrames(from, to, { width: w, height: h });
  const cuts = (f) => Array.from({ length: w }, (_, x) => { let c = 0; while (c < h && f[c * w + x] === (MARK_TO | (c * w + x))) c++; return c; });
  let previous = cuts(from);
  for (const f of melt) {
    const now = cuts(f);
    now.forEach((c, x) => assert.ok(c >= previous[x], `column ${x} went back`));
    previous = now;
  }
  const last = cuts(melt[melt.length - 1]);
  assert.ok(last.every((c) => c <= h) && Math.max(...last) > h / 2, 'the last frame is almost fully uncovered');
  assert.ok(melt[0].filter((v, i) => v === from[i]).length > (w * h) / 2, 'the first frame is mostly the first screen');
  /* Run on until every column has fallen: the result is the second screen exactly */
  const y = startOffsets(w / 2, xorshift32(1993));
  while (tick(y, h)) { /* keep falling */ }
  assert.deepEqual([...render(from, to, y, w, h)], [...to]);
});

test('the melt never ends on a repeat of the screen that follows it', () => {
  const w = 320, h = 200, from = markedFrame(MARK_FROM, w, h), to = markedFrame(MARK_TO, w, h);
  const melt = meltFrames(from, to, { width: w, height: h });
  const differing = (f) => f.reduce((n, v, i) => n + (v !== to[i] ? 1 : 0), 0) / f.length;
  assert.ok(differing(melt[melt.length - 1]) >= SETTLED, 'the last frame still differs from the next screen');
  for (let i = 1; i < melt.length; i++) assert.ok(differing(melt[i]) <= differing(melt[i - 1]) + 1e-9, `frame ${i} uncovers less than the one before`);
});

test('the melt of a full screen takes about a second at two tics a frame, and is the same every time', () => {
  const from = markedFrame(MARK_FROM, 320, 200), to = markedFrame(MARK_TO, 320, 200);
  const a = meltFrames(from, to, { width: 320, height: 200 });
  assert.ok(a.length >= 15 && a.length <= 26, `${a.length} frames`);
  const b = meltFrames(from, to, { width: 320, height: 200 });
  assert.equal(a.length, b.length);
  assert.deepEqual([...a[7]], [...b[7]]);
  const other = meltFrames(from, to, { width: 320, height: 200, seed: 7 });
  assert.notDeepEqual([...other[7]], [...a[7]]);
});

test('repeating rows gives 240 rows from 200, using every source row once or twice, evenly', () => {
  const source = Uint32Array.from({ length: WIDTH * SOURCE_HEIGHT }, (_, i) => Math.floor(i / WIDTH));
  const out = aspectCorrect(source);
  assert.equal(out.length, WIDTH * HEIGHT);
  const uses = new Array(SOURCE_HEIGHT).fill(0);
  let previous = -1, longestRun = 0, run = 0;
  for (let y = 0; y < HEIGHT; y++) {
    const row = out[y * WIDTH];
    assert.ok(out.subarray(y * WIDTH, y * WIDTH + WIDTH).every((v) => v === row), 'a row is copied whole');
    assert.ok(row >= previous, 'rows stay in order');
    uses[row]++;
    run = row === previous ? run + 1 : 1;
    longestRun = Math.max(longestRun, run);
    previous = row;
  }
  assert.ok(uses.every((n) => n === 1 || n === 2));
  assert.equal(uses.filter((n) => n === 2).length, 40);
  assert.equal(longestRun, 2);
  assert.equal(out[0], 0);
  assert.equal(out[(HEIGHT - 1) * WIDTH], SOURCE_HEIGHT - 1);
});

test('the delays hold 17.5 frames a second and never go below the 50 ms the app allows', () => {
  const d = delaysFor(70);
  assert.ok(d.every((v) => v >= 5));
  for (let at = 0; at < 70; at += 7) assert.equal(d.slice(at, at + 7).reduce((a, b) => a + b, 0), 40);
  let elapsed = 0;
  d.forEach((v, i) => {
    elapsed += v * 10;
    const ideal = ((i + 1) * 2 * 1000) / 35;
    assert.ok(Math.abs(elapsed - ideal) <= 20, `frame ${i} drifts ${elapsed - ideal} ms`);
  });
});

test('a clip becomes a loop of its frames and a melt, with the delays, and decodes back unchanged', () => {
  const palette = [0x101010, 0x806040, 0xc03020, 0xe0e0a0];
  const clip = Array.from({ length: 6 }, (_, k) => Uint32Array.from({ length: WIDTH * SOURCE_HEIGHT }, (_, i) => palette[(((i % WIDTH) >> 4) + (i / WIDTH >> 3) + k) % 4]));
  const built = buildLoop(clip);
  assert.equal(built.clipFrames, 6);
  assert.equal(built.frames, 6 + built.meltFrames);
  assert.ok(built.maxColours <= 4);
  const gif = Gif.decode(built.bytes);
  assert.equal(gif.width, WIDTH);
  assert.equal(gif.height, HEIGHT);
  assert.equal(gif.frames.length, built.frames);
  assert.deepEqual(gif.delays, built.delays);
  const expected = aspectCorrect(clip[3]);
  const decoded = gif.frames[3];
  for (let i = 0; i < expected.length; i += 997) {
    assert.deepEqual([decoded[i * 3], decoded[i * 3 + 1], decoded[i * 3 + 2]], [(expected[i] >> 16) & 255, (expected[i] >> 8) & 255, expected[i] & 255]);
  }
  assert.ok(Buffer.from(built.bytes).includes(Buffer.from('NETSCAPE2.0')), 'the loop repeats forever');
});

test('a frame with more than 256 colours is refused rather than degraded', () => {
  const rich = Uint32Array.from({ length: WIDTH * SOURCE_HEIGHT }, (_, i) => i % 300);
  assert.throws(() => buildLoop([rich, rich]), /frame uses \d+ colours/);
});

test('one colour table serves the whole loop', () => {
  const { colors, indexed } = indexFrames([Uint32Array.from([5, 6, 5]), Uint32Array.from([6, 7, 7])]);
  assert.equal(colors.length, 3);
  assert.deepEqual(indexed.map((f) => [...f]), [[0, 1, 0], [1, 2, 2]]);
});

test('contrast falls as the footage strengthens, and the ceiling is the last opacity that still passes', () => {
  const grey = (n) => sample(new Uint8Array(64 * 64 * 3).fill(n), 64, 64, 4);
  const fg = [232, 232, 236], bg = [14, 13, 12];
  const pictures = [grey(200), grey(90)];
  let last = Infinity;
  for (let a = 0; a <= 100; a += 10) {
    const v = worstContrast(pictures, fg, bg, a / 100);
    assert.ok(v <= last + 1e-9);
    last = v;
  }
  for (const target of [7, 4.5]) {
    const c = ceiling(pictures, fg, bg, target);
    assert.ok(worstContrast(pictures, fg, bg, c / 100) >= target);
    if (c < 100) assert.ok(worstContrast(pictures, fg, bg, (c + 1) / 100) < target);
  }
});

test('the capture shim names every setting its header documents and builds where SDL2 is installed', (t) => {
  const source = fs.readFileSync(path.join(__dirname, 'shim', 'doomcap_shim.c'), 'utf8');
  for (const name of ['DOOMCAP_OUT', 'DOOMCAP_FIRST', 'DOOMCAP_LAST', 'DOOMCAP_STEP']) assert.ok(source.includes(name), name);
  const flags = spawnSync('sdl2-config', ['--cflags'], { encoding: 'utf8' });
  if (flags.error || flags.status !== 0) return t.skip('SDL2 development files are not installed');
  const compile = spawnSync('gcc', ['-fsyntax-only', '-Wall', '-Wextra', ...flags.stdout.trim().split(/\s+/), path.join(__dirname, 'shim', 'doomcap_shim.c')], { encoding: 'utf8' });
  assert.equal(compile.status, 0, compile.stderr);
});

test('a key script lists presses in time order, releasing before pressing at the same frame', () => {
  const k = new KeyScript().up(10, 'b').down(5, 'b').down(10, 'a').up(12, 'a').tap(20, 'c', 1).tap(21, 'c', 1).type(30, 'ab', 2);
  assert.equal(k.text(), [
    '5 down b', '10 up b', '10 down a', '12 up a',
    '20 down c', '21 up c', '21 down c', '22 up c',
    '30 down a', '31 up a', '32 down b', '33 up b',
  ].join('\n') + '\n');
});

test('a key script refuses what the shim could not play', () => {
  assert.throws(() => new KeyScript().down(5, 'f13'), /unknown key/);
  assert.throws(() => new KeyScript().down(-1, 'a'), /whole number/);
  assert.throws(() => new KeyScript().hold(5, 5, 'a'), /empty/);
  assert.throws(() => new KeyScript().down(1, 'a').down(2, 'a').text(), /already held/);
  assert.throws(() => new KeyScript().up(1, 'a').text(), /without being held/);
  assert.throws(() => new KeyScript().down(1, 'a').text(), /still held/);
});

test('a held turn takes six slow tics and then turns at the normal or the fast rate', () => {
  assert.equal(turnTics(10.5), 6);
  assert.ok(turnTics(90) >= 27 && turnTics(90) <= 30, `${turnTics(90)} tics for 90 degrees`);
  assert.ok(turnTics(90, true) < turnTics(90));
  assert.equal(turnTics(0), 0);
});

test('every key name a script may use is one the shim understands', () => {
  const source = fs.readFileSync(path.join(__dirname, 'shim', 'doomcap_shim.c'), 'utf8');
  for (const name of NAMED) assert.ok(source.includes(`"${name}"`), `the shim lacks ${name}`);
  assert.ok(isKey('a') && isKey('z') && isKey('0') && isKey('9') && !isKey('A') && !isKey('10'));
});

test('a key script carries mouse movement in time order among the keys and reads back as written', () => {
  const k = new KeyScript().down(5, 'ctrl').mouse(7, -68, 0).mouse(6, 12, 3).up(9, 'ctrl');
  const text = k.text();
  assert.equal(text, '5 down ctrl\n6 mouse 12 3\n7 mouse -68 0\n9 up ctrl\n');
  assert.equal(KeyScript.parse(text).text(), text);
  assert.equal(KeyScript.parse('# a comment\n\n5 down a\n6 up a\n').text(), '5 down a\n6 up a\n');
});

test('a key script refuses mouse movement the shim could not play and lines it cannot read', () => {
  assert.throws(() => new KeyScript().mouse(3, 1.5, 0), /not whole/);
  assert.throws(() => new KeyScript().mouse(-1, 1, 1), /whole number/);
  assert.throws(() => KeyScript.parse('5 jump ctrl'), /not a key script line/);
  assert.throws(() => KeyScript.parse('5 down a\n').text(), /still held/);
});

test('the capture shim answers the engine\'s mouse reads from the script', () => {
  const source = fs.readFileSync(path.join(__dirname, 'shim', 'doomcap_shim.c'), 'utf8');
  assert.ok(source.includes('SDL_GetRelativeMouseState') && source.includes('"%ld mouse %d %d"'));
});

test('the Big Fucking Replay key script is the one its manifest recorded the footage from', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'bfr.manifest.json'), 'utf8'));
  const text = fs.readFileSync(path.join(__dirname, 'bfr.keys.txt'), 'utf8');
  const { keys } = manifest.source.play;
  assert.equal(sha256(text), keys.sha256, 'the script changed: record the footage again');
  assert.equal(text.split('\n').filter(Boolean).length, keys.events);
  assert.match(text, /^42 down i\n/, 'the script starts with the cheat codes');
  const script = KeyScript.parse(text);
  script.validate();
  const lastFrame = manifest.clip.firstFrame + manifest.clip.strideTics * (manifest.clip.frames - 1);
  const played = script.events.filter((e) => e.frame <= lastFrame);
  assert.ok(played.length > 300 && played.some((e) => e.action === 'mouse'), 'the run is steered by the mouse');
  assert.ok(script.events.filter((e) => e.frame > lastFrame).every((e) => e.action === 'up'), 'after the clip the script only lets go of keys');
});

/* A hall of two sectors with one of everything the kit draws */
function smallHall() {
  const map = new MapKit('E1M1');
  const floor = map.sector({ floor: 0, ceiling: 128, floorFlat: 'floor4_8', ceilingFlat: 'CEIL5_1', light: 144 });
  const step = map.sector({ floor: 16, ceiling: 128 });
  map.line([0, 0], [0, 64], { front: { sector: floor, middle: 'gstone1' } });
  map.seam([64, 64], [0, 64], step, floor);
  map.fence([10, 10], [20, 10], floor);
  map.pillar(rect(30, 30, 40, 40), floor, 'MARBLE1');
  map.thing(1, 5, 6, 90);
  return map;
}
const text8 = (buf, at) => buf.toString('latin1', at, at + 8).replace(/\0+$/, '');

test('a level made with the kit has its lumps in the sizes and fields the engine reads', () => {
  const lumps = smallHall().lumps();
  assert.deepEqual([5, 6, 90, 1, 7], [0, 2, 4, 6, 8].map((o) => lumps.THINGS.readInt16LE(o)));
  assert.equal(lumps.LINEDEFS.length, 14 * 7, 'a wall, a seam, a fence and four sides of a pillar');
  assert.equal(lumps.VERTEXES.length, 4 * 9, 'the corner the wall and the seam share is stored once');
  const flags = Array.from({ length: 7 }, (_, i) => lumps.LINEDEFS.readInt16LE(i * 14 + 4));
  assert.deepEqual(flags, [LINE.BLOCKING, LINE.TWOSIDED, LINE.BLOCKMONSTERS | LINE.TWOSIDED, ...Array(4).fill(LINE.BLOCKING)]);
  assert.equal(text8(lumps.SIDEDEFS, 20), 'GSTONE1', 'texture names are upper-cased');
  assert.equal(text8(lumps.SECTORS, 4), 'FLOOR4_8');
  assert.deepEqual([0, 128, 144], [0, 2, 20].map((o) => lumps.SECTORS.readInt16LE(o)));
});

test('the reject table hides a pair of sectors from each other in both directions and nothing else', () => {
  const map = smallHall();
  map.cannotSee = (a, b) => a === 1 && b === 0;
  const table = map.rejectTable();
  const bit = (a, b) => (table[(a * 2 + b) >> 3] >> ((a * 2 + b) & 7)) & 1;
  assert.deepEqual([bit(0, 0), bit(0, 1), bit(1, 0), bit(1, 1)], [0, 1, 1, 0]);
});

test('a PWAD is written with its lumps in order and read back by the WAD reader', () => {
  const pwad = readWad(wadBytes([{ name: 'AAA', data: Buffer.alloc(0) }, { name: 'BBB', data: Buffer.from('xyz') }]));
  assert.equal(pwad.type, 'PWAD');
  assert.deepEqual(pwad.lumps.map((l) => [l.name, l.size]), [['AAA', 0], ['BBB', 3]]);
  assert.equal(pwad.lump('bbb').toString(), 'xyz');
});

test('the nave has two Cyberdemons on its stage between the fences and the player in the aisle facing them', () => {
  const map = buildNave();
  const cyberdemons = map.things.filter((t) => t.type === CYBERDEMON);
  assert.equal(cyberdemons.length, 2);
  const stageY = NAVE.aisleBays * NAVE.bay, length = (NAVE.aisleBays + NAVE.stageBays) * NAVE.bay, radius = 40;
  for (const t of cyberdemons) {
    assert.ok(Math.abs(t.x) + radius < NAVE.fenceX, `a Cyberdemon at ${t.x} does not fit between the fences`);
    assert.ok(t.y - radius > stageY && t.y + radius < length, `a Cyberdemon at ${t.y} is not on the stage`);
  }
  assert.ok(Math.hypot(cyberdemons[0].x - cyberdemons[1].x, cyberdemons[0].y - cyberdemons[1].y) >= 2 * radius, 'they stand on top of each other');
  const players = map.things.filter((t) => t.type === PLAYER);
  assert.equal(players.length, 1);
  assert.ok(players[0].y < stageY && Math.abs(players[0].x) < NAVE.width / 2, 'the player starts in the aisle');
  assert.equal(players[0].angle, 90, 'facing the stage');
});

test('every wall of the nave refers to vertices, sides and sectors that exist, and closes the hall', () => {
  const map = buildNave(), lumps = map.lumps();
  const sectors = lumps.SECTORS.length / 26, vertices = lumps.VERTEXES.length / 4, sides = lumps.SIDEDEFS.length / 30;
  assert.equal(sectors, NAVE.aisleBays + NAVE.stageBays);
  for (let i = 0; i < sides; i++) assert.ok(lumps.SIDEDEFS.readInt16LE(i * 30 + 28) < sectors, `side ${i} names a sector that does not exist`);
  const edges = new Map();
  for (let i = 0; i < lumps.LINEDEFS.length / 14; i++) {
    const [from, to, flags, , , right, left] = Array.from({ length: 7 }, (_, k) => lumps.LINEDEFS.readInt16LE(i * 14 + k * 2));
    assert.ok(from < vertices && to < vertices && right < sides && left < sides, `line ${i} points outside the level`);
    assert.equal(left >= 0, Boolean(flags & LINE.TWOSIDED), `line ${i} has the wrong number of sides for its flags`);
    if (left < 0) edges.set(`${from}>${to}`, true);
  }
  assert.ok(edges.size >= 2 * (NAVE.aisleBays + NAVE.stageBays) + 1 + NAVE.width / 128, 'the outer wall is there');
  const fences = map.lines.filter((l) => l.flags & LINE.BLOCKMONSTERS).map((l) => [map.vertices[l.from], map.vertices[l.to]]);
  assert.ok(fences.length >= 2 * NAVE.stageBays);
  for (const [a, b] of fences) {
    assert.ok(Math.abs(a[0]) === NAVE.fenceX && a[0] === b[0], 'a fence runs along x = fenceX');
    assert.ok(Math.min(a[1], b[1]) >= NAVE.aisleBays * NAVE.bay, 'and only on the stage');
  }
});

test('the nave names textures and flats that fit the eight characters the engine reads', () => {
  const map = buildNave();
  const names = [...map.sides.flatMap((s) => [s.upper, s.lower, s.middle]), ...map.sectors.flatMap((s) => [s.floorFlat, s.ceilingFlat])];
  for (const name of names) assert.match(name, /^[A-Z0-9_-]{1,8}$/, `${name} is not a name the engine could look up`);
});

test('with the node builder installed the nave becomes the PWAD the footage was played in', (t) => {
  const probe = spawnSync(process.env.BSP || 'bsp', ['--help'], { encoding: 'utf8' });
  if (probe.error || !/BSP v5\.2/.test(`${probe.stdout}${probe.stderr}`)) return t.skip('BSP 5.2 is not installed');
  const pwad = buildNave().build();
  const out = readWad(pwad);
  assert.deepEqual(out.lumps.map((l) => l.name), [MAP, ...MAP_LUMPS]);
  for (const name of ['SEGS', 'SSECTORS', 'NODES']) assert.ok(out.lumps.find((l) => l.name === name).size > 0, `${name} was not built`);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'bfr.manifest.json'), 'utf8'));
  assert.equal(sha256(pwad), manifest.source.play.pwad.sha256, 'the level changed: record the footage again');
  assert.equal(pwad.length, manifest.source.play.pwad.bytes);
});

/* A stand-in for the game's data file: the weapon's five sprites, each with a header and a few bytes of picture */
function fakeSprites() {
  const sprite = (top) => { const b = Buffer.alloc(24, 7); b.writeInt16LE(170, 0); b.writeInt16LE(84, 2); b.writeInt16LE(-81, 4); b.writeInt16LE(top, 6); return b; };
  return wadWith('IWAD', [['PLAYPAL', Buffer.from('p')], ...SPRITES.map((name, i) => [name, sprite(-116 - i)]), ['SHTGA0', sprite(-108)]]);
}

test('the weapon add-on holds the five BFG sprites with only their top offset raised', () => {
  const iwad = fakeSprites(), source = readWad(iwad);
  const out = readWad(raiseSprites(iwad));
  assert.equal(out.type, 'PWAD');
  assert.deepEqual(out.lumps.map((l) => l.name), ['SS_START', ...SPRITES, 'SS_END']);
  const pwad = raiseSprites(iwad);
  SPRITES.forEach((name, i) => {
    const was = source.lump(name), is = pwad.subarray(out.lumps[i + 1].offset, out.lumps[i + 1].offset + out.lumps[i + 1].size);
    assert.equal(is.readInt16LE(6), was.readInt16LE(6) + DEFAULT_PIXELS, `${name} was not raised`);
    assert.ok(Buffer.concat([is.subarray(0, 6), is.subarray(8)]).equals(Buffer.concat([was.subarray(0, 6), was.subarray(8)])), `${name} changed beyond its top offset`);
  });
  assert.equal(readWad(raiseSprites(iwad, 10)).lump('BFGGA0').readInt16LE(6), -116 + 10);
});

test('the weapon add-on refuses a data file without the weapon', () => {
  assert.throws(() => raiseSprites(wadWith('IWAD', [['PLAYPAL', Buffer.from('p')]])), /no sprite BFGGA0/);
});

test('the checker passes for every pack committed in this repository', () => {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'check.js')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  for (const file of fs.readdirSync(__dirname).filter((f) => f.endsWith('.manifest.json'))) {
    assert.ok(run.stdout.includes(`${file.replace('.manifest.json', '')}: `), `${file} was not checked`);
  }
});
