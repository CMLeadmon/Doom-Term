import test from 'node:test';
import assert from 'node:assert/strict';
import { plateSpec, PLATE_480 } from './plate.js';

/*
 * The safety property for the full-width plate.
 *
 * Doom measured its offsets from BOTH edges of the 320-wide bar, so they
 * survive a stretch. If plateSpec(480) reproduces the shipped numbers exactly,
 * the wide plate is a GENERALISATION of Doom's measurements. If it ever stops
 * doing so, someone has redrawn the bar — which is a different product.
 */

test('plateSpec(480) reproduces the shipped geometry exactly', () => {
  assert.deepEqual(plateSpec(480), {
    width: 480, height: 32,
    contextX: 44, usageX: 90,
    panelX: 104, panelW: 226,
    markX: 107, markW: 24,
    grooveX: 136,
    labelX: 141, valueX: 182, valueChars: 24,
    sandboxX: 381, cardsX: 399,
    tableLabelX: 411, tableCurX: 451, tableLimX: 477, tableRuleX: 455,
    zoneX: 334, zoneW: 0,
  });
});

test('PLATE_480 is plateSpec(480)', () => {
  assert.deepEqual(PLATE_480, plateSpec(480));
});

test('only the centre stretches — left and right groups hold their offsets', () => {
  const a = plateSpec(480);
  const b = plateSpec(960);

  assert.equal(b.contextX, a.contextX);
  assert.equal(b.usageX, a.usageX);
  assert.equal(b.panelX, a.panelX);
  assert.equal(b.panelW, a.panelW);

  // The right group is pinned to the right edge, so its distance from W is fixed.
  assert.equal(960 - b.sandboxX, 480 - a.sandboxX);
  assert.equal(960 - b.cardsX, 480 - a.cardsX);
  assert.equal(960 - b.tableLimX, 480 - a.tableLimX);

  // The centre absorbs every pixel of the difference.
  assert.equal(b.zoneW - a.zoneW, 480);
});

test('a 480 plate has no centre zone, so the waiting column cannot draw', () => {
  assert.equal(plateSpec(480).zoneW, 0);
});

test('the zone never goes negative on an undersized plate', () => {
  assert.equal(plateSpec(320).zoneW, 0);
});
