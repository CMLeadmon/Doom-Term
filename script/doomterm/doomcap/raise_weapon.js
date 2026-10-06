#!/usr/bin/env node
'use strict';
/* An add-on that raises the BFG 9000 on screen. The game draws the weapon at the very bottom of the picture, where a window
   that crops the picture and a status plate over its lower edge leave almost none of it showing. The add-on holds the weapon's
   five sprites with one number changed in each header, the offset that places the sprite, and nothing else. It is copied from
   your data file when the footage is recorded, so it is never kept in this repository. The engine loads it with -merge.

     node script/doomterm/doomcap/raise_weapon.js DOOM.WAD OUT.wad [PIXELS] */
const fs = require('fs');
const { readWad } = require('./wad.js');
const { wadBytes } = require('./mapkit.js');

/* The weapon ready, firing and flashing, as the data file names its sprites */
const SPRITES = ['BFGGA0', 'BFGGB0', 'BFGGC0', 'BFGFA0', 'BFGFB0'];
const DEFAULT_PIXELS = 34;
const TOP_OFFSET = 6;

function raiseSprites(iwad, pixels = DEFAULT_PIXELS) {
  const wad = readWad(iwad);
  const entries = SPRITES.map((name) => {
    const at = wad.lumps.find((lump) => lump.name === name);
    if (!at) throw new Error(`the data file has no sprite ${name}`);
    const data = Buffer.from(iwad.subarray(at.offset, at.offset + at.size));
    data.writeInt16LE(data.readInt16LE(TOP_OFFSET) + pixels, TOP_OFFSET);
    return { name, data };
  });
  return wadBytes([{ name: 'SS_START', data: Buffer.alloc(0) }, ...entries, { name: 'SS_END', data: Buffer.alloc(0) }]);
}

if (require.main === module) {
  const [input, out, pixels = DEFAULT_PIXELS] = process.argv.slice(2);
  if (!input || !out) {
    console.error('usage: node raise_weapon.js DOOM.WAD OUT.wad [PIXELS]');
    process.exit(2);
  }
  fs.writeFileSync(out, raiseSprites(fs.readFileSync(input), Number(pixels)));
  console.log(`wrote ${out}: the weapon is ${pixels} pixels higher`);
}

module.exports = { raiseSprites, SPRITES, DEFAULT_PIXELS };
