#!/usr/bin/env node
'use strict';
/* The hall the Big Fucking Replay footage is played in: a green-stone nave 1024 units wide with a colonnade and tall
   torches down an aisle that steps up onto a lit stage in front of a wall of carved faces. Two Cyberdemons stand on the
   stage. The level is drawn here from nothing and replaces the first map of the first episode. It holds none of the game's
   own levels, only the names of textures and flats that the game's data file supplies when it is played.

     node script/doomterm/doomcap/bfr.pwad.js OUT.wad

   Needs the `bsp` node builder (see mapkit.js). */
const fs = require('fs');
const { MapKit, rect } = require('./mapkit.js');

const MAP = 'E1M1';
const PLAYER = 1, TALL_GREEN_TORCH = 45, CYBERDEMON = 16;
/* The width of the carved-face textures, which the back wall is cut into so each shows whole */
const PANEL = 128;

const NAVE = {
  width: 1024, bay: 128, aisleBays: 8, stageBays: 2, ceiling: 224, stageFloor: 32, stageHeight: 128,
  floorFlat: 'DEM1_6', ceilingFlat: 'CEIL5_1', wall: 'GSTONE1', pillar: 'MARBLE1', ledge: 'MARBLE2',
  faces: ['MARBFACE', 'MARBFAC2', 'MARBFAC3', 'MARBFAC2'],
  aisleLight: [128, 152], stageLight: 255,
  playerStart: [0, 600, 90],
  /* x of the invisible fences that keep the Cyberdemons between them on the stage */
  fenceX: 200,
  /* The stage cannot see the aisle's near half, so a monster stops shooting once the player is close */
  hiddenFromStageAt: 640,
  cyberdemons: [[-100, 1190, 270], [100, 1190, 270]],
};

function buildNave(options = {}) {
  const o = { ...NAVE, ...options };
  const map = new MapKit(MAP);
  const half = o.width / 2, bays = o.aisleBays + o.stageBays, length = bays * o.bay, stageY = o.aisleBays * o.bay;
  const bayOf = (y) => Math.min(bays - 1, Math.max(0, Math.floor(y / o.bay)));

  const bay = [];
  for (let i = 0; i < bays; i++) {
    bay.push(i < o.aisleBays
      ? map.sector({ floor: 0, ceiling: o.ceiling, floorFlat: o.floorFlat, ceilingFlat: o.ceilingFlat, light: o.aisleLight[Math.floor(i / 2) % 2] })
      : map.sector({ floor: o.stageFloor, ceiling: o.stageFloor + o.stageHeight, floorFlat: o.floorFlat, ceilingFlat: o.ceilingFlat, light: o.stageLight }));
  }
  for (let i = 0; i < bays; i++) {
    const y0 = i * o.bay, y1 = y0 + o.bay;
    map.line([-half, y0], [-half, y1], { front: { sector: bay[i], middle: o.wall } });
    map.line([half, y1], [half, y0], { front: { sector: bay[i], middle: o.wall } });
    if (i + 1 === o.aisleBays) {
      map.line([half, y1], [-half, y1], { front: { sector: bay[i + 1] }, back: { sector: bay[i], lower: o.ledge, upper: o.wall }, flags: 16 });
    } else if (i + 1 < bays) {
      map.seam([half, y1], [-half, y1], bay[i + 1], bay[i]);
    }
  }
  map.line([half, 0], [-half, 0], { front: { sector: bay[0], middle: o.wall } });
  for (let k = 0; k < o.width / PANEL; k++) {
    const x0 = -half + k * PANEL;
    map.line([x0, length], [x0 + PANEL, length], { front: { sector: bay[bays - 1], middle: o.faces[k % o.faces.length] } });
  }

  for (let i = 0; i < o.aisleBays; i += 2) {
    const y = i * o.bay + o.bay / 2;
    for (const x of [-330, 330]) map.pillar(rect(x - 28, y - 28, x + 28, y + 28), bay[i], o.pillar);
    for (const x of [-450, 450]) map.thing(TALL_GREEN_TORCH, x, y, 0);
  }
  for (const x of [-460, 460]) {
    map.thing(TALL_GREEN_TORCH, x, stageY + 80, 0);
    map.thing(TALL_GREEN_TORCH, x, length - 60, 0);
  }

  for (const x of [-o.fenceX, o.fenceX]) {
    const cuts = [stageY];
    for (let y = stageY + o.bay; y < length; y += o.bay) cuts.push(y);
    cuts.push(length - 8);
    for (let k = 0; k + 1 < cuts.length; k++) map.fence([x, cuts[k]], [x, cuts[k + 1]], bay[bayOf((cuts[k] + cuts[k + 1]) / 2)]);
  }
  const hidden = bayOf(o.hiddenFromStageAt);
  map.cannotSee = (a, b) => a >= o.aisleBays && b >= hidden && b < o.aisleBays;

  map.thing(PLAYER, ...o.playerStart);
  for (const [x, y, angle] of o.cyberdemons) map.thing(CYBERDEMON, x, y, angle);
  return map;
}

if (require.main === module) {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: node bfr.pwad.js OUT.wad');
    process.exit(2);
  }
  const wad = buildNave().build();
  fs.writeFileSync(out, wad);
  console.log(`wrote ${out}: ${wad.length} bytes`);
}

module.exports = { buildNave, NAVE, MAP, CYBERDEMON, PLAYER };
