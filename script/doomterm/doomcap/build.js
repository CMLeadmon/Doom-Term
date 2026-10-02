#!/usr/bin/env node
'use strict';
/* Builds a theme pack's loop from recorded footage.

     node script/doomterm/doomcap/build.js --pack ID --frames FILE --wad FILE --engine TEXT \
       (--demo NAME | --keys FILE --warp "1 8" --skill 4) [--promise-contrast N --promise-holds N]

   FILE is a frame stream from capture.sh or play.sh. Its frames are the clip, in order, and are assumed
   to be evenly spaced game tics. A screen melt from the last frame back to the first closes the loop.
   Rows are repeated to give the 4:3 shape the game was meant to be seen in, and the frames are written
   as a GIF with the delays that hold 17.5 frames a second. Also writes ID.manifest.json, which
   check.js tests the committed GIF against. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Gif = require('../themegen/gif.js');
const { frames: readFrames } = require('./frames.js');
const { readWad, parseDemo } = require('./wad.js');
const { meltFrames } = require('./melt.js');

const WIDTH = 320, SOURCE_HEIGHT = 200, HEIGHT = 240;
/* Seven frames of two game tics each last 14 tics, which is 40 hundredths of a second */
const DELAY_PATTERN = [6, 6, 6, 6, 6, 5, 5];

/* 200 rows to 240 by repeating rows, which adds no colour. The repeated rows are spread evenly. */
function aspectCorrect(frame) {
  const out = new Uint32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    const source = Math.min(SOURCE_HEIGHT - 1, Math.floor(((y + 0.5) * SOURCE_HEIGHT) / HEIGHT));
    out.set(frame.subarray(source * WIDTH, source * WIDTH + WIDTH), y * WIDTH);
  }
  return out;
}

const delaysFor = (count) => Array.from({ length: count }, (_, i) => DELAY_PATTERN[i % DELAY_PATTERN.length]);

/* One colour table for the whole loop and an index buffer per frame, which is the form the writer takes */
function indexFrames(frames) {
  const seen = new Map(), colors = [];
  const indexed = frames.map((f) => {
    const out = new Uint16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      let k = seen.get(f[i]);
      if (k === undefined) {
        k = colors.length;
        seen.set(f[i], k);
        colors.push([(f[i] >> 16) & 255, (f[i] >> 8) & 255, f[i] & 255]);
      }
      out[i] = k;
    }
    return out;
  });
  return { colors, indexed };
}

function buildLoop(clip, { seed = 1993 } = {}) {
  const melt = meltFrames(clip[clip.length - 1], clip[0], { width: WIDTH, height: SOURCE_HEIGHT, seed });
  const all = clip.concat(melt).map(aspectCorrect);
  const { colors, indexed } = indexFrames(all);
  const delays = delaysFor(all.length);
  const { bytes, maxUsed } = Gif.encode(indexed, colors, WIDTH, HEIGHT, delays);
  return { bytes, maxColours: maxUsed, frames: all.length, clipFrames: clip.length, meltFrames: melt.length, delays, seed };
}

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0 || !process.argv[at + 1]) {
    if (fallback === undefined) { console.error(`missing --${name}`); process.exit(2); }
    return fallback;
  }
  return process.argv[at + 1];
}

const has = (name) => process.argv.includes(`--${name}`);

/* Where the footage came from: a demo built into the data file, or a scripted run of a level */
function sourceOf(wad) {
  if (has('demo')) {
    const lump = arg('demo').toUpperCase();
    const demo = parseDemo(wad.lump(lump));
    return { demo: { lump, version: demo.version, skill: demo.skill, episode: demo.episode, map: demo.map, tics: demo.tics } };
  }
  const keysPath = path.resolve(arg('keys'));
  const keys = fs.readFileSync(keysPath);
  return {
    play: {
      warp: arg('warp'),
      skill: Number(arg('skill')),
      keys: { file: path.basename(keysPath), sha256: crypto.createHash('sha256').update(keys).digest('hex'), events: keys.toString('utf8').split('\n').filter(Boolean).length },
    },
  };
}

function main() {
  const repo = path.join(__dirname, '..', '..', '..');
  const pack = arg('pack', 'replay');
  const stream = fs.readFileSync(arg('frames'));
  const clipLimit = Number(arg('clip', '0'));
  const clip = [], indexes = [];
  for (const f of readFrames(stream)) {
    if (f.width !== WIDTH || f.height !== SOURCE_HEIGHT) throw new Error(`frame ${f.index} is ${f.width}x${f.height}, expected ${WIDTH}x${SOURCE_HEIGHT}`);
    clip.push(f.pixels);
    indexes.push(f.index);
    if (clipLimit && clip.length === clipLimit) break;
  }
  if (clip.length < 2) throw new Error('the clip needs at least two frames');
  const stride = indexes[1] - indexes[0];
  if (indexes.some((v, i) => v !== indexes[0] + i * stride)) throw new Error('the frames are not evenly spaced');
  if (stride !== 2) throw new Error(`frames must be two game tics apart for 17.5 frames a second, they are ${stride}`);

  const wad = readWad(fs.readFileSync(arg('wad')));
  const source = sourceOf(wad);

  const built = buildLoop(clip, { seed: Number(arg('seed', '1993')) });
  const out = path.resolve(arg('out', path.join(repo, 'themes', pack, `${pack}.gif`)));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, built.bytes);

  const loopCs = built.delays.reduce((a, b) => a + b, 0);
  const manifest = {
    pack,
    source: { data: { file: path.basename(arg('wad')), type: wad.type, bytes: wad.bytes, sha1: wad.sha1 }, ...source, engine: arg('engine') },
    clip: { firstFrame: indexes[0], strideTics: stride, frames: built.clipFrames },
    melt: { frames: built.meltFrames, seed: built.seed },
    gif: {
      width: WIDTH,
      height: HEIGHT,
      frames: built.frames,
      loopHundredths: loopCs,
      framesPerSecond: Number(((built.frames * 100) / loopCs).toFixed(3)),
      maxColoursPerFrame: built.maxColours,
      bytes: built.bytes.length,
      sha256: crypto.createHash('sha256').update(built.bytes).digest('hex'),
    },
  };
  if (has('promise-contrast')) manifest.promise = { contrast: Number(arg('promise-contrast')), holdsTo: Number(arg('promise-holds')) };
  const manifestPath = path.resolve(arg('manifest', path.join(__dirname, `${pack}.manifest.json`)));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${out}: ${built.frames} frames (${built.clipFrames} of play, ${built.meltFrames} of melt), ${WIDTH}x${HEIGHT}, ${built.bytes.length} bytes, at most ${built.maxColours} colours per frame`);
  console.log(`${manifestPath} written`);
}

if (require.main === module) main();
module.exports = { aspectCorrect, delaysFor, indexFrames, buildLoop, WIDTH, HEIGHT, SOURCE_HEIGHT, DELAY_PATTERN };
