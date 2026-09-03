#!/usr/bin/env node
/**
 * HUD reference tooling.
 *
 *   node tools/hud/cli.js render  <out.png> [--scale N] [--state file.json]
 *   node tools/hud/cli.js compare <reference.png> <actual.png> [--out diff.png]
 *                                 [--tolerance N] [--max-bad N]
 *   node tools/hud/cli.js ascii   [--state file.json]
 *
 * `compare` exits 1 on any mismatch above tolerance, so it drops straight
 * into CI. `ascii` dumps the plate as text for eyeballing in a terminal or
 * a diff — it catches layout collisions that a bounding-box check misses.
 */
import fs from 'node:fs';
import path from 'node:path';
import { encodePNG, decodePNG } from './png.js';
import { renderPlate, PLATE_480, DEMO_STATE } from '../../src/hud/plate.js';

function arg(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? dflt : process.argv[i + 1];
}

/**
 * The reference PNG shows a populated plate, so this tool renders DEMO_STATE
 * rather than the app's DEFAULT_STATE — which deliberately claims nothing and
 * would render an empty plate.
 */
function loadState() {
  const f = arg('--state', null);
  if (!f) return DEMO_STATE;
  return { ...DEMO_STATE, ...JSON.parse(fs.readFileSync(f, 'utf8')) };
}

function cmdRender() {
  const out = process.argv[3];
  if (!out) die('usage: cli.js render <out.png> [--scale N] [--state file.json]');
  const scale = parseInt(arg('--scale', '1'), 10);
  const s = renderPlate(loadState(), scale, PLATE_480);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, encodePNG(s.data, s.w, s.h));
  console.log(`wrote ${out}  ${s.w}x${s.h}  (${PLATE_480.width}x${PLATE_480.height} @ ${scale}x)`);
}

function cmdCompare() {
  const refPath = process.argv[3];
  const actPath = process.argv[4];
  if (!refPath || !actPath) die('usage: cli.js compare <reference.png> <actual.png> [--out diff.png] [--if-exists]');

  if (process.argv.includes('--if-exists') && !fs.existsSync(actPath)) {
    console.log(`HUD compare skipped: ${actPath} not present`);
    process.exit(0);
  }

  const ref = decodePNG(fs.readFileSync(refPath));
  const act = decodePNG(fs.readFileSync(actPath));

  if (ref.width !== act.width || ref.height !== act.height) {
    console.error(`FAIL  size mismatch`);
    console.error(`  reference ${ref.width}x${ref.height}`);
    console.error(`  actual    ${act.width}x${act.height}`);
    console.error(`  Crop the screenshot to the plate rect and use an integer scale.`);
    process.exit(1);
  }

  const tolerance = parseInt(arg('--tolerance', '0'), 10);
  const maxBad = parseInt(arg('--max-bad', '0'), 10);
  const diff = Buffer.alloc(ref.width * ref.height * 4);
  let bad = 0, worst = 0;
  const samples = [];

  for (let i = 0; i < ref.width * ref.height; i++) {
    const d = i * 4;
    const dr = Math.abs(ref.data[d] - act.data[d]);
    const dg = Math.abs(ref.data[d + 1] - act.data[d + 1]);
    const db = Math.abs(ref.data[d + 2] - act.data[d + 2]);
    const delta = Math.max(dr, dg, db);
    if (delta > worst) worst = delta;
    if (delta > tolerance) {
      bad++;
      if (samples.length < 12) {
        samples.push({
          x: i % ref.width, y: (i / ref.width) | 0, delta,
          ref: rgbHex(ref.data, d), act: rgbHex(act.data, d),
        });
      }
      diff[d] = 255; diff[d + 1] = 0; diff[d + 2] = 255; diff[d + 3] = 255;
    } else {
      const grey = (ref.data[d] * 0.3 + ref.data[d + 1] * 0.59 + ref.data[d + 2] * 0.11) * 0.35 | 0;
      diff[d] = diff[d + 1] = diff[d + 2] = grey; diff[d + 3] = 255;
    }
  }

  const outPath = arg('--out', null);
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, encodePNG(diff, ref.width, ref.height));
  }

  const total = ref.width * ref.height;
  const pct = ((bad / total) * 100).toFixed(4);
  console.log(`${ref.width}x${ref.height}  ${total} px`);
  console.log(`mismatched: ${bad} (${pct}%)   worst channel delta: ${worst}   tolerance: ${tolerance}`);
  if (samples.length) {
    console.log('first mismatches:');
    for (const s of samples) {
      console.log(`  (${String(s.x).padStart(4)},${String(s.y).padStart(4)})  ref ${s.ref}  actual ${s.act}  Δ${s.delta}`);
    }
  }
  if (outPath) console.log(`diff image: ${outPath}  (magenta = mismatch)`);

  if (bad > maxBad) {
    console.error(`FAIL  ${bad} mismatched pixels exceeds --max-bad ${maxBad}`);
    process.exit(1);
  }
  console.log('PASS');
}

function rgbHex(buf, d) {
  return '#' + [buf[d], buf[d + 1], buf[d + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Classify each pixel into a legible character so layout reads in a terminal. */
function cmdAscii() {
  const s = renderPlate(loadState(), 1, PLATE_480);
  const legend = [
    ['#f01a12', '#'], ['#d40b06', '#'], ['#a80603', '#'], ['#3a0402', '.'],
    ['#e8dcbc', 'V'], ['#c8bb9c', 'L'], ['#8f8672', 'l'],
    ['#2b2b2a', '-'], ['#242423', '-'], ['#232323', '-'],
    ['#e08a63', '@'], ['#b4553a', '@'],
    ['#3a6fd8', 'K'], ['#e0c020', 'K'], ['#c02a22', 'K'], ['#ffffff', 'K'],
    ['#1c1c1b', '|'], ['#8e8e8b', '|'],
  ];
  const map = new Map(legend.map(([h, c]) => [h.toLowerCase(), c]));
  for (let y = 0; y < s.h; y++) {
    let line = '';
    for (let x = 0; x < s.w; x++) {
      line += map.get(rgbHex(s.data, (y * s.w + x) * 4)) || '~';
    }
    console.log(String(y).padStart(2) + '|' + line);
  }
  console.log('legend: # numeral  V value  L label  l dim  @ agent  K card  | bevel  - recess  ~ plate');
}

function die(msg) { console.error(msg); process.exit(2); }

const cmd = process.argv[2];
if (cmd === 'render') cmdRender();
else if (cmd === 'compare') cmdCompare();
else if (cmd === 'ascii') cmdAscii();
else die('usage: cli.js <render|compare|ascii> ...');
