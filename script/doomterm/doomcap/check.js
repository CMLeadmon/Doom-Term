#!/usr/bin/env node
'use strict';
/* Checks the committed loop of every pack that has a manifest here, without the game data: the GIF is the
   one the manifest says was recorded, it has the shape and timing the app can show, its seam is smoother
   than the play on either side of it, and the contrast the pack's README promises holds over every frame.

     node script/doomterm/doomcap/check.js [PACK ...] */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Gif = require('../themegen/gif.js');
const { delaysFor, WIDTH, HEIGHT } = require('./build.js');
const { hex, sample, worstContrast, ceiling } = require('./contrast.js');

const repo = path.join(__dirname, '..', '..', '..');
const MAX_DECODED_MIB = 60;
const DEFAULT_PROMISE = { contrast: 7, holdsTo: 0 };

function checkPack(manifestFile) {
  const problems = [];
  const expect = (ok, message) => { if (!ok) problems.push(message); };

  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const pack = path.join(repo, 'themes', manifest.pack);
  const promise = { ...DEFAULT_PROMISE, ...manifest.promise };
  const bytes = fs.readFileSync(path.join(pack, `${manifest.pack}.gif`));
  expect(bytes.length === manifest.gif.bytes, `the GIF is ${bytes.length} bytes, the manifest says ${manifest.gif.bytes}`);
  expect(crypto.createHash('sha256').update(bytes).digest('hex') === manifest.gif.sha256, 'the GIF is not the one the manifest recorded; run build.js and commit both');

  const gif = Gif.decode(bytes);
  const { frames } = gif, play = manifest.clip.frames;
  expect(gif.width === WIDTH && gif.height === HEIGHT, `the GIF is ${gif.width}x${gif.height}`);
  expect(frames.length === manifest.gif.frames, `the GIF has ${frames.length} frames, the manifest says ${manifest.gif.frames}`);
  expect(frames.length === play + manifest.melt.frames, 'the frames are not the play followed by the melt');
  expect(JSON.stringify(gif.delays) === JSON.stringify(delaysFor(frames.length)), 'the delays are not the 17.5 frames a second pattern');
  expect(gif.delays.every((d) => d >= 5), 'a frame is shown for less than the 50 ms the app allows');
  expect(bytes.includes(Buffer.concat([Buffer.from('NETSCAPE2.0'), Buffer.from([3, 1, 0, 0])])), 'the GIF does not loop forever');
  const decodedMiB = (gif.width * gif.height * 4 * frames.length) / 2 ** 20;
  expect(decodedMiB <= MAX_DECODED_MIB, `decoded, the frames take ${decodedMiB.toFixed(1)} MiB, over ${MAX_DECODED_MIB}`);
  frames.forEach((f, k) => {
    const seen = new Set();
    for (let i = 0; i < f.length; i += 3) seen.add((f[i] << 16) | (f[i + 1] << 8) | f[i + 2]);
    expect(seen.size <= 256, `frame ${k} uses ${seen.size} colours`);
  });

  const area = gif.width * gif.height;
  const apart = (a, b) => { let n = 0; for (let i = 0; i < area; i++) if (frames[a][i * 3] !== frames[b][i * 3] || frames[a][i * 3 + 1] !== frames[b][i * 3 + 1] || frames[a][i * 3 + 2] !== frames[b][i * 3 + 2]) n++; return n / area; };
  const steps = Array.from({ length: play - 1 }, (_, i) => apart(i, i + 1)).sort((a, b) => a - b);
  const typical = steps[steps.length >> 1];
  const seamIn = apart(play - 1, play), seamOut = apart(frames.length - 1, 0);
  expect(seamIn > 0 && seamIn < typical, `the melt begins with a jump of ${seamIn.toFixed(3)}, play steps by ${typical.toFixed(3)}`);
  expect(seamOut > 0 && seamOut < typical, `the loop closes with a jump of ${seamOut.toFixed(3)}, play steps by ${typical.toFixed(3)}`);

  const yaml = fs.readFileSync(path.join(pack, `${manifest.pack}.yaml`), 'utf8');
  const color = (key) => hex(yaml.match(new RegExp(`^${key}: '(#[0-9a-f]{6})'`, 'm'))[1]);
  const opacity = Number(yaml.match(/^ {2}opacity: (\d+)$/m)[1]);
  const samples = frames.map((f) => sample(f, gif.width, gif.height, 8));
  const contrast = worstContrast(samples, color('foreground'), color('background'), opacity / 100);
  const holds = ceiling(samples, color('foreground'), color('background'), 7);
  expect(contrast >= promise.contrast, `the text has ${contrast.toFixed(1)}:1 at opacity ${opacity}, the README promises ${promise.contrast}:1`);
  expect(holds >= promise.holdsTo, `7:1 holds only to ${holds}%, the README promises ${promise.holdsTo}%`);

  const readme = fs.readFileSync(path.join(pack, 'README.txt'), 'utf8');
  expect(/not affiliated with, endorsed by or\s+sponsored by id Software or ZeniMax Media/.test(readme), 'the README lacks the non-affiliation line');

  const summary = [
    `${manifest.pack}: ${frames.length} frames (${play} of play, ${manifest.melt.frames} of melt), ${gif.width}x${gif.height}, ${(bytes.length / 2 ** 20).toFixed(1)} MiB, ${decodedMiB.toFixed(1)} MiB decoded`,
    `${manifest.pack}: seam steps ${seamIn.toFixed(3)} in and ${seamOut.toFixed(3)} out against ${typical.toFixed(3)} for play; text ${contrast.toFixed(1)}:1 at opacity ${opacity}, 7:1 holds to ${holds}%`,
  ];
  return { problems, summary, pack: manifest.pack };
}

const wanted = process.argv.slice(2);
const manifests = fs.readdirSync(__dirname).filter((f) => f.endsWith('.manifest.json')).sort()
  .filter((f) => !wanted.length || wanted.includes(f.replace('.manifest.json', '')));
if (!manifests.length) { console.error('no manifest to check'); process.exit(2); }
let failed = false;
for (const file of manifests) {
  const { problems, summary, pack } = checkPack(path.join(__dirname, file));
  if (problems.length) { failed = true; for (const p of problems) console.error(`${pack}: ${p}`); } else summary.forEach((line) => console.log(line));
}
process.exit(failed ? 1 : 0);
