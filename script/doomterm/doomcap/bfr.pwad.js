#!/usr/bin/env node
'use strict';
/* The level the Big Fucking Replay footage is played in: the secret map of episode 2 with a crowd added to its first hall and
   the hall's pale marble floor darkened to a mossy green and lit a notch brighter. The output is that whole map, copied from the data file you give it,
   with its list of things and one sector changed. It is derived from that file, so it is built when the footage is recorded and
   is not kept in this repository.

     node script/doomterm/doomcap/bfr.pwad.js DOOM.WAD OUT.WAD */
const fs = require('fs');
const path = require('path');
const { readWad } = require('./wad.js');

const MAP = 'E2M9';
const MAP_LUMPS = ['THINGS', 'LINEDEFS', 'SIDEDEFS', 'VERTEXES', 'SEGS', 'SSECTORS', 'NODES', 'SECTORS', 'REJECT', 'BLOCKMAP'];
const THING_SIZE = 10;
const SECTOR_SIZE = 26;
const HALL = 17;
const HALL_FLOOR = 'FLOOR7_2';
const HALL_LIGHT = 176;
const ALL_SKILLS = 7;

const CYBERDEMON = 16, BARON = 3003, CACODEMON = 3005, IMP = 3001, DEMON = 3002, SERGEANT = 9, LOST_SOUL = 3006;

/* [type, x, y, angle in degrees]. Each stands on open floor of the first hall, clear of its walls, facing the middle. */
const CROWD = [
  [CYBERDEMON, 64, 300, 270], [CYBERDEMON, 64, -1000, 90],
  [DEMON, -300, 130, 315], [DEMON, 420, 130, 225], [DEMON, -300, -900, 45], [DEMON, 420, -900, 135],
  [IMP, -500, -380, 0], [IMP, -600, -380, 0], [IMP, -700, -330, 0], [IMP, -700, -430, 0],
  [SERGEANT, 700, -380, 180], [SERGEANT, 640, -380, 180], [SERGEANT, -800, -380, 0],
  [CACODEMON, 0, 420, 270], [CACODEMON, 130, 420, 270], [CACODEMON, 0, -1100, 90], [CACODEMON, 130, -1100, 90],
  [LOST_SOUL, -780, -360, 0], [LOST_SOUL, -780, -400, 0], [LOST_SOUL, -840, -380, 0],
  [LOST_SOUL, 740, -385, 180], [LOST_SOUL, 790, -385, 180], [LOST_SOUL, -60, 200, 270],
];

/* What a player picks up. Walking over one flashes the whole screen, so the map has none. */
const PICKUPS = new Set([
  2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2010, 2046, 2047, 2048, 2049, 17,
  2011, 2012, 2014, 2015, 2018, 2019, 2013, 2022, 2023, 2024, 2025, 2026, 2045, 83, 8, 5, 6, 13, 38, 39, 40,
]);

function thing(type, x, y, angle) {
  const out = Buffer.alloc(THING_SIZE);
  out.writeInt16LE(x, 0); out.writeInt16LE(y, 2); out.writeInt16LE(angle, 4); out.writeInt16LE(type, 6); out.writeInt16LE(ALL_SKILLS, 8);
  return out;
}

/* The map's own things without the pickups, then the crowd */
function crowdedThings(original) {
  const kept = [];
  for (let o = 0; o + THING_SIZE <= original.length; o += THING_SIZE) {
    if (!PICKUPS.has(original.readInt16LE(o + 6))) kept.push(original.subarray(o, o + THING_SIZE));
  }
  return Buffer.concat([...kept, ...CROWD.map(([type, x, y, angle]) => thing(type, x, y, angle))]);
}

/* The map's sectors with the first hall's floor flat renamed and its light raised a notch */
function retouchedSectors(original) {
  const out = Buffer.from(original);
  const at = HALL * SECTOR_SIZE;
  out.fill(0, at + 4, at + 12);
  out.write(HALL_FLOOR, at + 4, 'latin1');
  out.writeInt16LE(HALL_LIGHT, at + 20);
  return out;
}

/* A PWAD: the header, the lumps one after another, then the directory that names them */
function pwad(lumps) {
  let at = 12;
  const entries = lumps.map(({ name, data }) => { const e = { name, offset: at, size: data.length }; at += data.length; return e; });
  const header = Buffer.alloc(12);
  header.write('PWAD', 0, 'latin1'); header.writeInt32LE(lumps.length, 4); header.writeInt32LE(at, 8);
  const directory = Buffer.alloc(16 * lumps.length);
  entries.forEach((e, i) => { directory.writeInt32LE(e.offset, i * 16); directory.writeInt32LE(e.size, i * 16 + 4); directory.write(e.name, i * 16 + 8, 'latin1'); });
  return Buffer.concat([header, ...lumps.map((l) => l.data), directory]);
}

function buildPwad(iwad) {
  const wad = readWad(iwad);
  const at = wad.lumps.findIndex((l) => l.name === MAP);
  if (at < 0) throw new Error(`the data file has no map ${MAP}`);
  const lumps = [{ name: MAP, data: Buffer.alloc(0) }];
  MAP_LUMPS.forEach((name, k) => {
    const lump = wad.lumps[at + 1 + k];
    if (!lump || lump.name !== name) throw new Error(`${MAP} is missing its ${name} lump`);
    const data = iwad.subarray(lump.offset, lump.offset + lump.size);
    lumps.push({ name, data: name === 'THINGS' ? crowdedThings(data) : name === 'SECTORS' ? retouchedSectors(data) : data });
  });
  return pwad(lumps);
}

if (require.main === module) {
  const [from, to] = process.argv.slice(2);
  if (!to) { console.error('usage: node bfr.pwad.js DOOM.WAD OUT.WAD'); process.exit(2); }
  fs.mkdirSync(path.dirname(path.resolve(to)), { recursive: true });
  fs.writeFileSync(to, buildPwad(fs.readFileSync(from)));
}
module.exports = { buildPwad, crowdedThings, retouchedSectors, CROWD, PICKUPS, MAP, MAP_LUMPS, HALL, HALL_FLOOR };
