/* Hit testing for the status plate.
 *
 * A port of src/hud/canvas.ts's waitingRowAtPoint / modeAtPoint / chipAtPoint,
 * kept honest the same way the original is: every region is computed from the
 * renderer's OWN geometry — its plateSpec() and waitingRowBox() — rather than
 * from numbers copied out of it. The rule that matters is that a row the
 * renderer refused to paint (because its name would not fit) must also be
 * unclickable; asking waitingRowBox() gets that for free, because the two
 * decisions become the same call.
 *
 * Each function takes the renderer module, so the forked plate and the verbatim
 * one are hit-tested against their own geometry and never each other's.
 */

/** Logical (plate-space) coordinates for a pointer event over the canvas. */
export function logicalPoint(canvas, ev, scale) {
  const r = canvas.getBoundingClientRect();
  return { x: (ev.clientX - r.left) / scale, y: (ev.clientY - r.top) / scale };
}

export function waitingRowAt(mod, logical, p, rows) {
  const spec = mod.plateSpec(logical);
  for (let i = 0; i < Math.min(mod.WAITING_ROWS, rows.length); i++) {
    const box = mod.waitingRowBox(spec, i, String(rows[i].tag ?? ''));
    if (!box) continue;
    if (p.x < box.x || p.x >= box.x + box.w) continue;
    const dy = p.y - box.y;
    if (dy >= 0 && dy < 6) return rows[i];
  }
  return null;
}

/** The MODE cell — the tier name and its label beneath it. */
export function modeAt(mod, logical, p) {
  const sx = mod.plateSpec(logical).sandboxX;
  return p.x >= sx - 56 && p.x <= sx + 6 && p.y >= 2 && p.y <= 30;
}

/** The three chips. 0 = top, 1 = middle, 2 = bottom, or null.
 *  A renderer that does not draw them reports no slot, so nothing is clickable
 *  where nothing was painted. */
export function chipAt(mod, logical, p) {
  const { cardsX } = mod.plateSpec(logical);
  if (cardsX == null) return null;
  if (p.x < cardsX - 3 || p.x > cardsX + 11) return null;
  if (p.y >= 1 && p.y < 10) return 0;
  if (p.y >= 10 && p.y < 20) return 1;
  if (p.y >= 20 && p.y <= 30) return 2;
  return null;
}

/** What is under the pointer, for both the click handler and the cursor. */
export function targetAt(mod, logical, p, rows) {
  const row = waitingRowAt(mod, logical, p, rows);
  if (row) return { kind: 'row', row };
  const chip = chipAt(mod, logical, p);
  if (chip !== null) return { kind: 'chip', chip };
  if (modeAt(mod, logical, p)) return { kind: 'mode' };
  return null;
}
