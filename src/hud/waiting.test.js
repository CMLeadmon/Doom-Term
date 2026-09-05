import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPlate, plateSpec, waitingRowIsRendered } from './plate.js';

/*
 * The waiting column draws into the elastic centre and NOWHERE else.
 *
 * That containment is the whole test surface here: the column takes a variable
 * amount of space at a variable width, and the failure mode is a long name or
 * a long tail spilling over SANDBOX or the token table. Comparing whole
 * renders against an empty-list render catches that exactly, without asserting
 * on glyph positions that are allowed to change.
 */

const ROWS = [
  { n: '2', name: 'PTY-SOCKET-FIX', tail: '4M12S' },
  { n: '5', name: 'BENCH', tail: '51S' },
  { n: '6', name: 'RELEASE', tail: 'EXIT 101', failed: true },
];

/** Does any pixel inside the centre zone differ between two renders? */
function zoneDiffers(a, b, spec) {
  for (let y = 0; y < spec.height; y++) {
    for (let x = spec.zoneX; x < spec.zoneX + spec.zoneW; x++) {
      const i = (y * spec.width + x) * 4;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1]) return true;
    }
  }
  return false;
}

/** Is there any non-plate ink inside the zone at all? */
function inkedInZone(render, spec) {
  for (let y = 0; y < spec.height; y++) {
    for (let x = spec.zoneX; x < spec.zoneX + spec.zoneW; x++) {
      const i = (y * spec.width + x) * 4;
      if (render.data[i] < 0x40) return true;   // the well floor is dark
    }
  }
  return false;
}

/**
 * Did anything change where a waiting ROW would be drawn?
 *
 * Rows start at x0+58 and sit on the 8px pitch from y=5. Compared against a
 * render of the SAME width with an empty list rather than against an absolute
 * brightness: the well's own bevel lives in this band too, and thresholding
 * on it is how a "no rows" assertion accidentally passes on chrome.
 */
function rowBandDiffers(a, b, spec) {
  const from = spec.zoneX + 58;
  const to = spec.zoneX + spec.zoneW;
  for (let row = 0; row < 3; row++) {
    for (let y = 5 + row * 8; y < 5 + row * 8 + 6; y++) {
      for (let x = from; x < to; x++) {
        const i = (y * spec.width + x) * 4;
        if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1]) return true;
      }
    }
  }
  return false;
}

/** Assert that nothing outside the zone moved. */
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

test('the waiting column draws into the centre zone at a wide width', () => {
  const spec = plateSpec(720);
  const empty = renderPlate({ waiting: [] }, 1, spec);
  const full = renderPlate({ waiting: ROWS }, 1, spec);
  assert.ok(zoneDiffers(empty, full, spec), 'rows should change the zone');
});

test('a 480 plate has no zone, so waiting rows cannot corrupt it', () => {
  const spec = plateSpec(480);
  const empty = renderPlate({ waiting: [] }, 1, spec);
  const full = renderPlate({ waiting: ROWS }, 1, spec);
  assert.deepEqual(Array.from(full.data), Array.from(empty.data));
});

test('nothing is ever drawn outside the centre zone', () => {
  const spec = plateSpec(720);
  assertContained(
    renderPlate({ waiting: ROWS }, 1, spec),
    renderPlate({ waiting: [] }, 1, spec),
    spec,
    'a normal row',
  );
});

test('a long name is truncated rather than overflowing its row', () => {
  const spec = plateSpec(720);
  assertContained(
    renderPlate({ waiting: [{ n: '2', name: 'A'.repeat(200), tail: '4M12S' }] }, 1, spec),
    renderPlate({ waiting: [] }, 1, spec),
    spec,
    'a 200-character name',
  );
});

test('a long tail cannot push a name out of the zone either', () => {
  const spec = plateSpec(720);
  assertContained(
    renderPlate({ waiting: [{ n: '2', name: 'PTY-SOCKET-FIX', tail: 'X'.repeat(80) }] }, 1, spec),
    renderPlate({ waiting: [] }, 1, spec),
    spec,
    'an 80-character tail',
  );
});

test('more rows than fit are dropped, not stacked past the well', () => {
  const spec = plateSpec(720);
  const many = Array.from({ length: 12 }, (_, i) => ({
    n: String(i), name: `SESSION-${i}`, tail: '9M99S',
  }));
  assertContained(
    renderPlate({ waiting: many }, 1, spec),
    renderPlate({ waiting: [] }, 1, spec),
    spec,
    'twelve rows',
  );
});

test('a narrow zone still shows the count, without rows', () => {
  // 600 gives a 120px zone (rows fit); 570 gives 90px (count only).
  const narrow = plateSpec(570);
  assert.ok(narrow.zoneW > 60 && narrow.zoneW < 110, `zone was ${narrow.zoneW}`);
  const empty = renderPlate({ waiting: [] }, 1, narrow);
  const full = renderPlate({ waiting: ROWS }, 1, narrow);

  // The well and caption still draw, so the zone is not blank. This line used
  // to read `assert.ok(expression === false || true)`, which is true for every
  // possible value of the expression — it asserted nothing at all while
  // appearing to cover the narrow-zone case. Assert on the pixels instead.
  assert.ok(inkedInZone(empty, narrow), 'the well and caption should still draw');

  // The count differs between an empty list and three waiting...
  assert.ok(zoneDiffers(empty, full, narrow), 'the count should differ');
  // ...but no ROW is painted, which is the actual claim of this test. Rows sit
  // at y=5,13,21 to the right of the count; the count itself is left of x0+52.
  assert.equal(
    rowBandDiffers(full, empty, narrow),
    false,
    'a narrow zone must draw no rows, only the count',
  );
  assertContained(full, empty, narrow, 'a narrow-zone render');
});

test('an empty list is a state, not an absence — the well still draws', () => {
  const spec = plateSpec(720);
  const withWell = renderPlate({ waiting: [] }, 1, spec);
  // Compare against a plate whose zone was never touched: force it by using a
  // width where the zone is zero, then checking the wide one has ink there.
  let inked = false;
  for (let x = spec.zoneX; x < spec.zoneX + spec.zoneW; x++) {
    const i = (1 * spec.width + x) * 4;
    if (withWell.data[i] < 0x40) { inked = true; break; }  // well floor is dark
  }
  assert.ok(inked, 'the empty well should still be cut into the plate');
});

test('the hit test and the renderer agree about which rows exist', () => {
  // The renderer skipped any row whose right-aligned tail left fewer than three
  // characters for the name, and hit testing checked only the coarse zone width
  // and the row number. At 600 a short `2S` row is painted while `ASKS`,
  // `EXIT 1` and `EXIT 101` are not — and clicking where those would have been
  // still selected a session. Both now ask one predicate.
  const spec = plateSpec(600);
  assert.ok(spec.zoneW >= 110, `zone was ${spec.zoneW}; this test needs rows to fit`);

  const short = waitingRowIsRendered(spec, '2S');
  const long = waitingRowIsRendered(spec, 'EXIT 101');
  assert.equal(short, true, 'a short tail leaves room for a name');
  assert.equal(long, false, 'a long tail does not, at this width');

  // And the prediction matches what is actually painted.
  const withShort = renderPlate({ waiting: [{ n: '1', name: 'ALPHA', tail: '2S' }] }, 1, spec);
  const withLong = renderPlate(
    { waiting: [{ n: '1', name: 'ALPHA', tail: 'EXIT 101', failed: true }] }, 1, spec,
  );
  const blank = renderPlate({ waiting: [] }, 1, spec);
  assert.equal(rowBandDiffers(withShort, blank, spec), true, 'the short row should be painted');
  assert.equal(rowBandDiffers(withLong, blank, spec), false, 'the long row should not be');
});

test('a wide enough zone paints every row, whatever its tail', () => {
  const spec = plateSpec(900);
  for (const tail of ['2S', 'ASKS', 'EXIT 1', 'EXIT 101']) {
    assert.equal(waitingRowIsRendered(spec, tail), true, `tail ${tail} should fit at 900`);
  }
});

test('no row is claimed to exist below the rows-minimum width', () => {
  const narrow = plateSpec(570);
  assert.equal(waitingRowIsRendered(narrow, '2S'), false);
});
