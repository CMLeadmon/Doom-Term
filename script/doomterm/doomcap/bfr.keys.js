#!/usr/bin/env node
'use strict';
/* The key script of the Big Fucking Replay loop: a player in the crowded hall who raises the heaviest weapon and fires it
   as fast as it will go while running and strafing round the hall and whipping round to the biggest threat in view.

     node script/doomterm/doomcap/bfr.keys.js OUT.txt

   Frames are counted from the first one the engine draws; after the level's opening melt there is one a game tic. */
const fs = require('fs');
const path = require('path');
const { KeyScript } = require('./keys.js');

/* [from, to] frames each key is held. A bot found them: it replayed the engine in short chunks, read the state of the last tic,
   and chose the next few. Each launch it aimed at the biggest cluster of monsters it could see, favouring the Cyberdemons, with
   the ball clear of anything close enough to white out the screen. Between launches it ran and strafed in runs of ten to
   twenty-five tics and snapped round to whatever was attacking it, at about the pace of the Replay pack's demo. The engine plays a
   script the same way every time, so they stay right for the same engine, data file and level. */
const HOLDS = {
  shift: [[76, 440]],
  ctrl: [[150, 440]],
  up: [[141, 151], [211, 226], [241, 256], [336, 346], [356, 371], [376, 401], [411, 440]],
  down: [[151, 166], [191, 211], [226, 241], [281, 301]],
  comma: [[76, 96], [121, 141], [166, 191], [211, 226], [241, 256], [281, 301], [326, 356], [371, 386], [391, 401], [426, 440]],
  period: [[96, 121], [141, 166], [191, 211], [256, 281], [356, 371], [401, 406]],
  left: [[151, 161], [171, 193], [201, 211], [221, 227], [231, 236], [251, 261], [286, 301], [336, 340], [341, 346], [371, 385], [426, 440]],
  right: [[261, 281], [301, 311], [316, 326], [351, 361], [396, 406], [416, 426]],
};

function buildKeys() {
  const k = new KeyScript();
  k.type(42, 'iddqd', 3).type(60, 'idkfa', 3);
  k.tap(80, '7', 2);
  for (const [key, spans] of Object.entries(HOLDS)) for (const [from, to] of spans) k.hold(from, to, key);
  return k;
}

if (require.main === module) {
  const out = process.argv[2];
  if (!out) { console.error('usage: node bfr.keys.js OUT.txt'); process.exit(2); }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, buildKeys().text());
}
module.exports = { buildKeys, HOLDS };
