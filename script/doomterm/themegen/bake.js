#!/usr/bin/env node
/* Bakes the Blue Highway and Canopy loops to GIFs, or checks that the committed GIFs still match
   their generators.

     node script/doomterm/themegen/bake.js                # write themes/<id>/<id>.gif
     node script/doomterm/themegen/bake.js --check        # verify, change nothing

   The check is tolerant of last-bit floating point differences between JavaScript engines: each
   decoded frame may differ from a fresh render in at most 0.2% of its pixels. */
'use strict';
const fs = require('fs');
const path = require('path');
const Kit = require('./kit.js');
const Gif = require('./gif.js');

const THEMES = { bluehighway: require('./highway.js'), canopy: require('./canopy.js') };
const DELAY_CS = 8;
const MAX_DIFFERING = Math.floor(Kit.W * Kit.H * 0.002);
const OUT = path.join(__dirname, '..', '..', '..', 'themes');

function render(scene) {
  return Array.from({ length: Kit.FRAMES }, (_, f) => scene.render(f));
}

function invariants(id, scene, frames) {
  const problems = [];
  const first = frames[0], wrapped = scene.render(Kit.FRAMES);
  if (first.some((v, i) => v !== wrapped[i])) problems.push('frame 101 differs from frame 1, so the loop does not close');
  const again = scene.render(37);
  if (again.some((v, i) => v !== frames[37][i])) problems.push('rendering the same frame twice gives different pixels');
  frames.forEach((f, k) => {
    const seen = new Set(f);
    if (seen.size > 256) problems.push(`frame ${k} uses ${seen.size} colours`);
  });
  if (id === 'bluehighway') {
    let lo = Infinity, hi = -1;
    for (let k = 0; k < Kit.FRAMES; k++) {
      const rig = scene.rig(k);
      for (let y = 0; y < Kit.H; y++) for (let x = 0; x < Kit.W; x++) if (rig[y * Kit.W + x] !== Kit.NONE) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    }
    if (lo !== 84 || hi !== 437) problems.push(`the rig moved: its horizontal extent is ${lo}..${hi}, expected 84..437`);
  }
  return problems;
}

function main() {
  const check = process.argv.includes('--check');
  const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  let failed = false;
  for (const id of ids.length ? ids : Object.keys(THEMES)) {
    const scene = THEMES[id];
    if (!scene) { console.error(`unknown theme: ${id}`); process.exit(2); }
    const frames = render(scene);
    const file = path.join(OUT, id, `${id}.gif`);
    if (!check) {
      const { bytes, maxUsed } = Gif.encode(frames, scene.palette, Kit.W, Kit.H, DELAY_CS);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
      console.log(`${file}: ${Kit.FRAMES} frames, ${Kit.W}x${Kit.H}, ${bytes.length} bytes, at most ${maxUsed} colours per frame`);
      continue;
    }
    const problems = invariants(id, scene, frames);
    const gif = Gif.decode(fs.readFileSync(file));
    if (gif.width !== Kit.W || gif.height !== Kit.H || gif.frames.length !== Kit.FRAMES) problems.push(`${file} is ${gif.width}x${gif.height} with ${gif.frames.length} frames`);
    else {
      let worst = 0;
      frames.forEach((f, k) => {
        let differing = 0;
        for (let i = 0; i < f.length; i++) {
          const c = scene.palette[f[i]], o = i * 3, g = gif.frames[k];
          if (g[o] !== c[0] || g[o + 1] !== c[1] || g[o + 2] !== c[2]) differing++;
        }
        worst = Math.max(worst, differing);
      });
      if (worst > MAX_DIFFERING) problems.push(`the committed GIF differs from a fresh render in up to ${worst} pixels of a frame (limit ${MAX_DIFFERING}); run bake.js`);
      console.log(`${id}: committed GIF matches the generator (worst frame differs in ${worst} pixels)`);
    }
    for (const p of problems) { console.error(`${id}: ${p}`); failed = true; }
  }
  process.exit(failed ? 1 : 0);
}
main();
