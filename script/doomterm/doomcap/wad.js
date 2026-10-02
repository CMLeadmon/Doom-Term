'use strict';
/* The parts of a WAD file the Replay builder reads: its type, its lump directory, and the header
   and length of a recorded demo. */
const crypto = require('crypto');

function readWad(buf) {
  if (buf.length < 12) throw new Error('not a WAD file: it is shorter than a header');
  const type = buf.toString('latin1', 0, 4);
  if (type !== 'IWAD' && type !== 'PWAD') throw new Error(`not a WAD file: it starts with ${JSON.stringify(type)}`);
  const count = buf.readInt32LE(4), at = buf.readInt32LE(8);
  if (count < 0 || at < 12 || at + count * 16 > buf.length) throw new Error('the WAD directory lies outside the file');
  const lumps = [];
  for (let i = 0; i < count; i++) {
    const o = at + i * 16;
    const lump = { offset: buf.readInt32LE(o), size: buf.readInt32LE(o + 4), name: buf.toString('latin1', o + 8, o + 16).replace(/\0.*$/, '') };
    if (lump.offset < 0 || lump.size < 0 || lump.offset + lump.size > buf.length) throw new Error(`lump ${lump.name} lies outside the file`);
    lumps.push(lump);
  }
  return {
    type,
    lumps,
    bytes: buf.length,
    sha1: crypto.createHash('sha1').update(buf).digest('hex'),
    lump(name) {
      const found = lumps.find((l) => l.name === name.toUpperCase());
      if (!found) throw new Error(`the WAD has no lump named ${name.toUpperCase()}`);
      return buf.subarray(found.offset, found.offset + found.size);
    },
  };
}

/* A Doom 1.9 demo is thirteen header bytes (version, skill, episode, map, deathmatch, respawn, fast,
   no monsters, console player, four player flags), then four bytes per player per tic, then 0x80. */
function parseDemo(lump) {
  if (lump.length < 14) throw new Error('the demo is shorter than its header');
  if (lump[0] !== 109) throw new Error(`only Doom 1.9 demos (version 109) are supported, this is version ${lump[0]}`);
  if (lump[lump.length - 1] !== 0x80) throw new Error('the demo does not end with its end marker');
  const players = [lump[9], lump[10], lump[11], lump[12]].filter(Boolean).length;
  if (players < 1) throw new Error('the demo has no players');
  const body = lump.length - 14;
  if (body % (4 * players) !== 0) throw new Error('the demo body is not a whole number of tics');
  return { version: lump[0], skill: lump[1], episode: lump[2], map: lump[3], players, tics: body / (4 * players) };
}

module.exports = { readWad, parseDemo };
