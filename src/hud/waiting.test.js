import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderPlate,
  plateSpec,
  waitingRowBox,
  waitingColumns,
  waitingDividerX,
  WAITING_ROWS,
  WAITING_ROWS_PER_COL,
} from './plate.js';

/*
 * The waiting column draws into the elastic centre and NOWHERE else.
 *
 * That containment is the whole test surface here: the column takes a variable
 * amount of space at a variable width, and the failure mode is a long name or
 * a long tag spilling over SANDBOX or the token table. Comparing whole renders
 * against an empty-list render catches that exactly, without asserting on
 * glyph positions that are allowed to change.
 *
 * Since the well went to two columns the second failure mode is subtler: the
 * right-hand column starts partway across the zone, so a row that overruns its
 * own column corrupts its neighbour rather than escaping the plate. Assertions
 * on the zone alone cannot see that, so the per-row box is checked too.
 */

const ROWS = [
  { n: '2', name: 'PTY-SOCKET-FIX', status: 'asks', tag: 'CLAU' },
  { n: '5', name: 'BENCH', status: 'quiet', tag: 'SH' },
  { n: '6', name: 'RELEASE', status: 'failed', tag: 'CODX' },
  { n: '7', name: 'DOCS', status: 'quiet', tag: 'GEMI' },
  { n: '9', name: 'WEBGL', status: 'working', tag: 'AGY' },
  { n: '3', name: 'SANDBOX', status: 'working', tag: 'CLAU' },
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
 * Did anything change where waiting ROWS are drawn?
 *
 * Rows sit on the 8px pitch from y=5, to the right of the count. Compared
 * against a render of the SAME width with an empty list rather than against an
 * absolute brightness: the well's own bevel lives in this band too, and
 * thresholding on it is how a "no rows" assertion accidentally passes on chrome.
 */
function rowBandDiffers(a, b, spec) {
  const from = spec.zoneX + 58;
  const to = spec.zoneX + spec.zoneW;
  for (let row = 0; row < WAITING_ROWS_PER_COL; row++) {
    for (let y = 5 + row * 8; y < 5 + row * 8 + 6; y++) {
      for (let x = from; x < to; x++) {
        const i = (y * spec.width + x) * 4;
        if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1]) return true;
      }
    }
  }
  return false;
}

/** Did anything change inside ONE row's own box? */
function boxDiffers(a, b, spec, box) {
  for (let y = box.y; y < box.y + 6; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const i = (y * spec.width + x) * 4;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1]) return true;
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

/** Is this exact colour painted anywhere in the zone? */
function hasColor(render, spec, hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  for (let y = 0; y < spec.height; y++) {
    for (let x = spec.zoneX; x < spec.zoneX + spec.zoneW; x++) {
      const i = (y * spec.width + x) * 4;
      if (render.data[i] === r && render.data[i + 1] === g && render.data[i + 2] === b) return true;
    }
  }
  return false;
}

// ------------------------------------------------------- containment

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
    renderPlate({ waiting: [{ n: '2', name: 'A'.repeat(200), status: 'quiet', tag: 'CLAU' }] }, 1, spec),
    renderPlate({ waiting: [] }, 1, spec),
    spec,
    'a 200-character name',
  );
});

test('a long tag cannot push a name out of the zone either', () => {
  const spec = plateSpec(720);
  assertContained(
    renderPlate({ waiting: [{ n: '2', name: 'PTY-SOCKET-FIX', status: 'quiet', tag: 'X'.repeat(80) }] }, 1, spec),
    renderPlate({ waiting: [] }, 1, spec),
    spec,
    'an 80-character tag',
  );
});

test('more rows than fit are dropped, not stacked past the well', () => {
  const spec = plateSpec(720);
  const many = Array.from({ length: 24 }, (_, i) => ({
    n: String(i % 10), name: `SESSION-${i}`, status: 'quiet', tag: 'CLAU',
  }));
  assertContained(
    renderPlate({ waiting: many }, 1, spec),
    renderPlate({ waiting: [] }, 1, spec),
    spec,
    'twenty-four rows',
  );
});

test('an empty list is a state, not an absence — the well still draws', () => {
  const spec = plateSpec(720);
  const withWell = renderPlate({ waiting: [] }, 1, spec);
  let inked = false;
  for (let x = spec.zoneX; x < spec.zoneX + spec.zoneW; x++) {
    const i = (1 * spec.width + x) * 4;
    if (withWell.data[i] < 0x40) { inked = true; break; }  // well floor is dark
  }
  assert.ok(inked, 'the empty well should still be cut into the plate');
});

// ------------------------------------------------------- two columns

test('a wide zone holds two columns, a medium one holds a single column', () => {
  // A column is only claimed when it can hold an honest row: the slot number,
  // the status glyph, three characters of name and a four-character tag. 600
  // leaves 62px of row area and cannot, so it reports no columns rather than
  // promising one it would then refuse to paint.
  assert.equal(waitingColumns(plateSpec(900)), 2, '900 is wide enough for two');
  assert.equal(waitingColumns(plateSpec(660)), 1, '660 fits one column only');
  assert.equal(waitingColumns(plateSpec(600)), 0, '600 cannot hold an honest row');
  assert.equal(waitingColumns(plateSpec(570)), 0, '570 is count-only');
});

test('a second column is refused when it would reduce names to fragments', () => {
  // Three characters is the floor for a row that EXISTS; it is not the bar for
  // spending half the zone on a second column. At 700 two columns fit and turn
  // PTY-SOCKET-FIX and SANDBOX-TIER into `PTY-` and `SAND` — six rows nobody
  // can identify, where three readable ones would have fitted. More rows is
  // not the goal; knowing which session is which is.
  const spec = plateSpec(700);
  assert.equal(waitingColumns(spec), 1, '700 should stay single-column');

  const box = waitingRowBox(spec, 0, 'CLAU');
  assert.ok(box.nameRoom >= 10, `a single column should read properly, got ${box.nameRoom}`);
});

test('every column that IS taken can hold a name worth reading', () => {
  for (const w of [600, 660, 700, 780, 900, 1100, 1400, 1920]) {
    const spec = plateSpec(w);
    if (waitingColumns(spec) === 0) continue;
    const box = waitingRowBox(spec, 0, 'CLAU');
    assert.ok(box, `w=${w}: a claimed column must paint its first row`);
    assert.ok(box.nameRoom >= 10, `w=${w}: name room was only ${box.nameRoom}`);
  }
});

test('the second column doubles the rows on offer, and no more', () => {
  const wide = plateSpec(900);
  const single = plateSpec(660);
  const boxes = (spec) => ROWS.map((r, i) => waitingRowBox(spec, i, r.tag)).filter(Boolean);
  assert.equal(boxes(wide).length, WAITING_ROWS, 'two columns show six rows');
  assert.equal(boxes(single).length, WAITING_ROWS_PER_COL, 'one column shows three');
  assert.equal(WAITING_ROWS, WAITING_ROWS_PER_COL * 2);
});

test('columns fill top to bottom, then across', () => {
  // Column-major, so the left column never reflows as the window narrows: the
  // three most-owed rows are the three that survive losing the right column.
  const spec = plateSpec(900);
  const box = (i) => waitingRowBox(spec, i, 'CLAU');

  assert.equal(box(0).x, box(1).x, 'rows 0 and 1 share a column');
  assert.equal(box(1).x, box(2).x, 'rows 1 and 2 share a column');
  assert.ok(box(1).y > box(0).y, 'row 1 sits below row 0');
  assert.ok(box(2).y > box(1).y, 'row 2 sits below row 1');

  assert.ok(box(3).x > box(2).x, 'row 3 starts a new column to the right');
  assert.equal(box(3).y, box(0).y, 'and starts at the top of it');
  assert.equal(box(4).y, box(1).y);
  assert.equal(box(5).y, box(2).y);
});

test('the rows that survive a narrowing are the three most owed', () => {
  const single = plateSpec(660);
  assert.ok(waitingRowBox(single, 2, 'CLAU'), 'row 2 is still drawn');
  assert.equal(waitingRowBox(single, 3, 'CLAU'), null, 'row 3 is not');
});

test('no box ever overlaps its neighbour or leaves the zone', () => {
  // The right column begins partway across the zone, so an overrun corrupts a
  // neighbouring row rather than escaping the plate — invisible to a
  // zone-containment check, which is why the boxes are asserted directly.
  for (const w of [600, 720, 900, 1100, 1400, 1920]) {
    const spec = plateSpec(w);
    const boxes = [];
    for (let i = 0; i < WAITING_ROWS; i++) {
      const b = waitingRowBox(spec, i, 'EXIT');
      if (b) boxes.push(b);
    }
    for (const b of boxes) {
      assert.ok(b.x >= spec.zoneX + 58, `w=${w}: box starts before the row area`);
      assert.ok(b.x + b.w <= spec.zoneX + spec.zoneW, `w=${w}: box runs past the zone`);
      assert.ok(b.nameRoom >= 3, `w=${w}: a drawn box must hold an honest name`);
    }
    for (const a of boxes) {
      for (const b of boxes) {
        if (a === b) continue;
        const sameBand = a.y === b.y;
        const overlaps = a.x < b.x + b.w && b.x < a.x + a.w;
        assert.ok(!(sameBand && overlaps), `w=${w}: two boxes overlap at y=${a.y}`);
      }
    }
  }
});

test('both columns are actually painted, not just measured', () => {
  const spec = plateSpec(900);
  const empty = renderPlate({ waiting: [] }, 1, spec);
  const full = renderPlate({ waiting: ROWS }, 1, spec);
  for (let i = 0; i < WAITING_ROWS; i++) {
    const box = waitingRowBox(spec, i, ROWS[i].tag);
    assert.ok(box, `row ${i} should have a box at this width`);
    assert.ok(boxDiffers(full, empty, spec, box), `row ${i} should be painted`);
  }
});

test('the tag keeps clear of the well wall rather than touching it', () => {
  // The rightmost column ends at the zone edge, which is where the well's own
  // border is cut. A tag right-aligned onto that pixel sits ON the wall — it
  // stays inside the zone, so containment says nothing, and it still reads as
  // a rendering fault.
  for (const w of [660, 900, 1400]) {
    const spec = plateSpec(w);
    const last = waitingRowBox(spec, waitingColumns(spec) === 2 ? 3 : 0, 'CLAU');
    assert.ok(last, `w=${w}: expected a row`);
    assert.ok(
      last.tagX <= spec.zoneX + spec.zoneW - 1 - 3,
      `w=${w}: the tag ends at ${last.tagX}, on the well wall at ${spec.zoneX + spec.zoneW - 1}`,
    );
  }
});

test('a groove separates the columns, so a tag cannot read as its neighbour', () => {
  // The tag is right-aligned at its column's edge, which puts it directly
  // beside the NEXT column's slot number: `CLAU 7 ·DOCS-PORTAL` read as one
  // row. A groove is what this plate already uses to say "different field",
  // and it costs no name room because it lives in the gutter.
  const spec = plateSpec(1100);
  const x = waitingDividerX(spec);
  assert.ok(x, 'two columns should be divided');

  // It sits in the gutter: clear of both columns, touching neither.
  const left = waitingRowBox(spec, 0, 'CLAU');
  const right = waitingRowBox(spec, 3, 'CLAU');
  assert.ok(x >= left.x + left.w, 'the groove must not eat into the left column');
  assert.ok(x + 2 <= right.x, 'nor into the right one');
});

test('a single column has nothing to divide', () => {
  assert.equal(waitingColumns(plateSpec(660)), 1, 'this width is the single-column case');
  assert.equal(waitingDividerX(plateSpec(660)), null, 'one column needs no groove');
  assert.equal(waitingDividerX(plateSpec(570)), null, 'and neither does none');
});

// ------------------------------------------------------- renderer / hit test

test('the hit test and the renderer agree about which rows exist', () => {
  // One predicate, asked by both. They used to decide separately: the renderer
  // skipped any row whose right-aligned tail left fewer than three characters
  // for the name, while hit testing checked only the coarse zone width and the
  // row number — so clicking where a skipped row would have been still selected
  // a session. An invisible control that does something is worse than a missing
  // one, and a second column doubles the ways they can disagree.
  for (const w of [570, 600, 660, 720, 800, 900, 1100, 1400]) {
    const spec = plateSpec(w);
    const empty = renderPlate({ waiting: [] }, 1, spec);
    const full = renderPlate({ waiting: ROWS }, 1, spec);
    for (let i = 0; i < WAITING_ROWS; i++) {
      const box = waitingRowBox(spec, i, ROWS[i].tag);
      if (!box) continue;
      assert.ok(
        boxDiffers(full, empty, spec, box),
        `w=${w}: row ${i} is claimed to exist but nothing was painted in its box`,
      );
    }
  }
});

test('a row whose tag leaves no honest room for a name is not claimed', () => {
  const spec = plateSpec(660);
  const long = waitingRowBox(spec, 0, 'X'.repeat(40));
  assert.equal(long, null, 'a 40-character tag cannot leave three name characters');
});

test('no row is claimed to exist below the rows-minimum width', () => {
  const narrow = plateSpec(570);
  assert.equal(waitingRowBox(narrow, 0, 'CLAU'), null);
});

test('a narrow zone still shows the count, without rows', () => {
  // 600 gives a 120px zone (rows fit); 570 gives 90px (count only).
  const narrow = plateSpec(570);
  assert.ok(narrow.zoneW > 60 && narrow.zoneW < 110, `zone was ${narrow.zoneW}`);
  const empty = renderPlate({ waiting: [] }, 1, narrow);
  const full = renderPlate({ waiting: ROWS }, 1, narrow);

  assert.ok(inkedInZone(empty, narrow), 'the well and caption should still draw');
  assert.ok(zoneDiffers(empty, full, narrow), 'the count should differ');
  assert.equal(
    rowBandDiffers(full, empty, narrow),
    false,
    'a narrow zone must draw no rows, only the count',
  );
  assertContained(full, empty, narrow, 'a narrow-zone render');
});

// ------------------------------------------------------- status glyphs

test('each status paints its own canonical colour', () => {
  // One colour, one meaning — the same five the stylesheet defines. A status
  // that borrowed another's colour would be a lie told at a glance.
  const spec = plateSpec(900);
  const only = (status) =>
    renderPlate({ waiting: [{ n: '1', name: 'ALPHA', status, tag: 'CLAU' }] }, 1, spec);

  assert.ok(hasColor(only('asks'), spec, '#5b8ae8'), 'asks is --st-wait');
  assert.ok(hasColor(only('failed'), spec, '#ef4136'), 'failed is --st-fail');
  assert.ok(hasColor(only('working'), spec, '#e0a92c'), 'working is --st-live');
  assert.ok(hasColor(only('quiet'), spec, '#847c6e'), 'quiet is --st-idle');
});

test('no two statuses paint the same glyph', () => {
  // Colour alone is not the indicator: the shapes differ too, so the meaning
  // survives a colourblind operator and a badly calibrated panel.
  const spec = plateSpec(900);
  const render = (status) =>
    Array.from(renderPlate(
      { waiting: [{ n: '1', name: 'ALPHA', status, tag: 'CLAU' }] }, 1, spec,
    ).data);

  const shapes = ['asks', 'failed', 'quiet', 'working'].map(render);
  for (let a = 0; a < shapes.length; a++) {
    for (let b = a + 1; b < shapes.length; b++) {
      assert.notDeepEqual(shapes[a], shapes[b], 'two statuses rendered identically');
    }
  }
});

test('only the working glyph moves, and only when it is given a phase', () => {
  // An indicator that always moves says nothing, and one that never moves
  // cannot report work. The phase reaches every row, so the discipline has to
  // be in the glyph: `working` is the only status that earned an animation.
  const spec = plateSpec(900);
  const at = (status, phase) => Array.from(renderPlate(
    { waiting: [{ n: '1', name: 'ALPHA', status, tag: 'CLAU' }], phase }, 1, spec,
  ).data);

  assert.notDeepEqual(at('working', 0), at('working', 0.5), 'working should animate');
  for (const still of ['asks', 'failed', 'quiet']) {
    assert.deepEqual(at(still, 0), at(still, 0.5), `${still} must not animate`);
  }
});

test('a halted phase draws the working glyph still, and at full strength', () => {
  // undefined is halted, not "phase zero". A settled plate is one blit, and a
  // permanently dim indicator reads as broken rather than as idle.
  const spec = plateSpec(900);
  const halted = renderPlate(
    { waiting: [{ n: '1', name: 'ALPHA', status: 'working', tag: 'CLAU' }] }, 1, spec,
  );
  assert.ok(hasColor(halted, spec, '#e0a92c'), 'a halted working glyph is full --st-live');
});

test('an unknown status is drawn as unknown, never as good news', () => {
  // Axiom 3: what is not measured renders as unknown. Falling through to the
  // quiet glyph would report a settled session we know nothing about.
  const spec = plateSpec(900);
  const weird = renderPlate({ waiting: [{ n: '1', name: 'ALPHA', status: 'nonsense', tag: 'SH' }] }, 1, spec);
  const quiet = renderPlate({ waiting: [{ n: '1', name: 'ALPHA', status: 'quiet', tag: 'SH' }] }, 1, spec);
  assert.notDeepEqual(Array.from(weird.data), Array.from(quiet.data));
  assertContained(weird, renderPlate({ waiting: [] }, 1, spec), spec, 'an unknown status');
});

// ------------------------------------------------------- the count

test('the numeral counts what wants you, not the rows on display', () => {
  // Working rows are filler for space nothing waiting wanted. Counting them
  // would inflate the one number the well exists to answer.
  const spec = plateSpec(900);
  const oneWaiting = renderPlate({
    waiting: [
      { n: '1', name: 'ALPHA', status: 'quiet', tag: 'SH' },
      { n: '2', name: 'BETA', status: 'working', tag: 'CLAU' },
      { n: '3', name: 'GAMMA', status: 'working', tag: 'CLAU' },
    ],
  }, 1, spec);

  // The numeral lives left of the groove at x0+52, clear of every row.
  const countBand = (render) => {
    const out = [];
    for (let y = 0; y < spec.height; y++) {
      for (let x = spec.zoneX; x < spec.zoneX + 52; x++) {
        const i = (y * spec.width + x) * 4;
        out.push(render.data[i], render.data[i + 1], render.data[i + 2]);
      }
    }
    return out;
  };

  const justOne = renderPlate({
    waiting: [{ n: '1', name: 'ALPHA', status: 'quiet', tag: 'SH' }],
  }, 1, spec);
  assert.deepEqual(countBand(oneWaiting), countBand(justOne), 'both should read 1');

  const threeWaiting = renderPlate({
    waiting: [
      { n: '1', name: 'ALPHA', status: 'quiet', tag: 'SH' },
      { n: '2', name: 'BETA', status: 'quiet', tag: 'CLAU' },
      { n: '3', name: 'GAMMA', status: 'quiet', tag: 'CLAU' },
    ],
  }, 1, spec);
  assert.notDeepEqual(countBand(threeWaiting), countBand(oneWaiting), '3 must not read as 1');
});
