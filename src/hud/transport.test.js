import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPlate, plateSpec } from './plate.js';

/*
 * The centre re-tools for the mode; left and right never move.
 *
 * Containment is the whole test surface, same as waiting.test.js: the transport
 * draws variable-width content (a query, a position, a hit count) next to
 * SANDBOX and the token table, and the failure mode is spilling over them.
 * Helpers are repeated here on purpose rather than shared — a test that imports
 * its own oracle from another test file fails in pairs.
 */

const T = { detached: true, line: 8412, total: 24190, query: 'RESIZE', hit: 3, hits: 17 };

function assertContained(full, empty, spec, what) {
  for (let y = 0; y < spec.height; y++) {
    for (let x = 0; x < spec.width; x++) {
      if (x >= spec.zoneX && x < spec.zoneX + spec.zoneW) continue;
      const i = (y * spec.width + x) * 4;
      assert.equal(full.data[i], empty.data[i], `${what} escaped the zone at ${x},${y}`);
      assert.equal(full.data[i + 1], empty.data[i + 1], `${what} escaped the zone at ${x},${y}`);
    }
  }
}

function zoneDiffers(a, b, spec) {
  for (let y = 0; y < spec.height; y++) {
    for (let x = spec.zoneX; x < spec.zoneX + spec.zoneW; x++) {
      const i = (y * spec.width + x) * 4;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1]) return true;
    }
  }
  return false;
}

test('the transport replaces the waiting column, not the whole plate', () => {
  const spec = plateSpec(720);
  const waiting = renderPlate({ mode: 'waiting', waiting: [] }, 1, spec);
  const transport = renderPlate({ mode: 'transport', transport: T }, 1, spec);
  assert.ok(zoneDiffers(waiting, transport, spec), 'the centre should change');
  assertContained(transport, waiting, spec, 'the transport');
});

test('an absurd query cannot overflow the zone', () => {
  const spec = plateSpec(720);
  assertContained(
    renderPlate({ mode: 'transport', transport: { ...T, query: 'A'.repeat(300) } }, 1, spec),
    renderPlate({ mode: 'waiting', waiting: [] }, 1, spec),
    spec, 'a 300-character query',
  );
});

test('absurd counts cannot overflow the zone either', () => {
  const spec = plateSpec(720);
  assertContained(
    renderPlate({ mode: 'transport', transport: {
      ...T, line: 999999999, total: 999999999, hit: 999999, hits: 999999,
    } }, 1, spec),
    renderPlate({ mode: 'waiting', waiting: [] }, 1, spec),
    spec, 'nine-digit counters',
  );
});

test('mode defaults to waiting, so an unset mode is not a blank centre', () => {
  const spec = plateSpec(720);
  assert.deepEqual(
    Array.from(renderPlate({ waiting: [] }, 1, spec).data),
    Array.from(renderPlate({ mode: 'waiting', waiting: [] }, 1, spec).data),
  );
});

test('transport mode with no transport state falls back rather than blanking', () => {
  const spec = plateSpec(720);
  assert.deepEqual(
    Array.from(renderPlate({ mode: 'transport', waiting: [] }, 1, spec).data),
    Array.from(renderPlate({ mode: 'waiting', waiting: [] }, 1, spec).data),
  );
});

test('a 480 plate has no zone, so the transport cannot touch the reference', () => {
  const spec = plateSpec(480);
  assert.deepEqual(
    Array.from(renderPlate({ mode: 'transport', transport: T }, 1, spec).data),
    Array.from(renderPlate({ mode: 'waiting', waiting: [] }, 1, spec).data),
  );
});
