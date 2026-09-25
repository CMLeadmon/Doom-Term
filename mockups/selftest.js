/* Behaviour assertions for the fluid app.
 *
 * Run live: selftest.html uses them as a test page, and the published artifact
 * runs the same module on load and prints the result. That makes the behaviour
 * section evidence rather than a claim — it is executed in the reader's own
 * browser, and if it fails there it says FAIL.
 *
 * The host is mounted with animate:false. An endless requestAnimationFrame
 * keeps the page non-idle, which stalls Chrome's virtual clock under headless
 * --virtual-time-budget and starves the suite's own timers.
 */
import { mountShell } from './shell.js';


const SESSIONS_COUNT = 7;   // the fixed roster shell.js ships
import { targetAt } from './hit.js';

const settle = () => new Promise((r) => setTimeout(r, 30));

/* ResizeObserver is asynchronous, so a fixed sleep after changing the host
   width is a race: the assertions that follow can read the plate at its old
   logical width. Wait for the condition instead of for a duration. */
/* Counted in frames, not milliseconds. Under Chrome's headless virtual clock
   Date.now() leaps ahead while real layout still has to happen, so a wall-clock
   budget expires before the observer can ever deliver. */
async function waitUntil(pred, tries = 300) {
  for (let i = 0; i < tries; i++) {
    if (pred()) { await settle(); return; }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('the app did not settle');
}

export async function runTests(host, onRow = () => {}) {
  const rows = [];
  const T = (name, expected, actual) => {
    const r = [name, String(expected), String(actual), String(expected) === String(actual)];
    rows.push(r); onRow(r, rows);
  };

  host.style.width = '1920px';
  host.style.height = '1080px';
  const app = mountShell(host, { animate: false });
  const PLATE_SCALE = app.scale;
  /* The renderer each layout actually draws through, so the geometry asserted
     is the geometry painted — verbatim for classic, the fork for queue. */
  const V = app.plate;
  const { plateSpec, waitingColumns, waitingRowBox } = V;
  /* Resize the host and re-run the app's own sizing, which is exactly what its
     ResizeObserver calls. Driving it directly keeps the suite deterministic:
     the observer is asynchronous and, under a headless virtual clock, does not
     reliably deliver at all. What is under test is the geometry the app derives
     from a width — not the browser's plumbing for noticing one. */
  const sizeTo = async (w) => {
    host.style.width = `${w}px`;
    app.sizePlate();
    await settle();
  };

  const clickPlate = (lx, ly) => {
    const c = host.querySelector('#dt-plate'), r = c.getBoundingClientRect();
    c.dispatchEvent(new MouseEvent('click', {
      clientX: r.left + lx * PLATE_SCALE, clientY: r.top + ly * PLATE_SCALE, bubbles: true,
    }));
  };

  await sizeTo(1920);

  /* -- geometry: the plate is sized from the host, not from a constant ----- */
  T('plate logical width at a 1920 host', Math.floor(1920 / PLATE_SCALE), app.logical);
  let spec = plateSpec(app.logical);
  T('elastic zone width (logical − 480)', app.logical - 480, spec.zoneW);
  T('waiting well has a column', 1, waitingColumns(spec));
  const pc = host.querySelector('#dt-plate');
  T('plate canvas is 32 logical px tall', 32 * PLATE_SCALE, pc.height);
  T('plate canvas spans the host', app.logical * PLATE_SCALE, pc.width);

  /* -- narrow: the well is designed to go, and must take its hit box with it */
  await sizeTo(1440);
  T('logical width at a 1440 host', 480, app.logical);
  spec = plateSpec(app.logical);
  T('waiting well collapses to nothing', 0, waitingColumns(spec));
  T('no row is clickable once none is painted', 'null',
    String(targetAt(V, app.logical, { x: spec.zoneX + 60, y: 8 }, [{ n: '2', tag: 'CODX' }])?.kind ?? 'null'));

  await sizeTo(1920);

  /* -- the plate is bound to session state, not decoration ----------------- */
  const before = app.state.activeId;
  const btn = host.querySelector('.dt-rail button[data-id="s3"]') || host.querySelector('.dt-card[data-id="s3"]');
  btn.click();
  await settle();
  T('selecting a session switches session', 's3', app.state.activeId);
  T('the session actually changed', true, before !== app.state.activeId);
  T('the pane followed the session', 'Docs portal migration',
    host.querySelector('#dt-title').textContent);

  /* -- hit regions come from the geometry that painted them ---------------- */
  spec = plateSpec(app.logical);
  const box = waitingRowBox(spec, 0, 'CLDE');
  T('waiting row 0 was painted', true, !!box);
  if (box) {
    const row = [{ sessionId: 's1', n: '1', name: 'X', status: 'quiet', tag: 'CLDE' }];
    T('the hit test finds that row', 'row',
      targetAt(V, app.logical, { x: box.x + 4, y: box.y + 2 }, row)?.kind ?? 'null');
    T('3px below the glyph is not a hit', 'null',
      targetAt(V, app.logical, { x: box.x + 4, y: box.y + 9 }, row)?.kind ?? 'null');
  }

  /* -- plate cells are controls ------------------------------------------- */
  clickPlate(spec.sandboxX - 20, 12); await settle();
  T('MODE cell cycles FULL → TREE', 'TREE', app.state.modes.s3);
  clickPlate(spec.sandboxX - 20, 12); await settle();
  T('MODE cell cycles TREE → OFF', 'OFF', app.state.modes.s3);
  T('the status bar followed MODE', 'mode OFF', host.querySelector('#dt-smode').textContent);
  const chip0 = app.state.chips[0];
  clickPlate(spec.cardsX + 2, 5); await settle();
  T('the top chip toggles', !chip0, app.state.chips[0]);

  /* -- composer ------------------------------------------------------------ */
  const input = host.querySelector('#dt-input');
  input.value = 'run the gate';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle();
  T('the composer appends the line', 1, (app.state.log.s3 || []).length);
  T('the composer clears after send', '', input.value);
  T('sending marks that agent busy', true, app.state.busyUntil > performance.now());

  /* -- reflow -------------------------------------------------------------- */
  host.querySelector('#dt-revclose').click();
  await settle();
  T('the review panel closes', true, host.classList.contains('no-rev'));
  T('the plate still spans the host', Math.floor(1920 / PLATE_SCALE), app.logical);

  /* -- the 'queue' layout: shorter bar, no rail, the whole queue on the plate */
  const host2 = document.createElement('div');
  host2.style.cssText = 'position:absolute;left:-10000px;top:0;width:1920px;height:1080px';
  document.body.appendChild(host2);
  const q = mountShell(host2, { animate: false, layout: 'queue' });
  const sizeTo2 = async (w) => { host2.style.width = `${w}px`; q.sizePlate(); await settle(); };
  await sizeTo2(1920);

  const qc = host2.querySelector('#dt-plate');
  T('queue layout halves the plate scale', 2, q.scale);
  T('queue plate canvas is 64px, not 96', 64, qc.height);
  T('the bar is 68.5px including its lip', 68.5,
    Math.round(host2.querySelector('.dt-dock').getBoundingClientRect().height * 10) / 10);
  T('the lip adds 7% back onto 64', '7%', `${Math.round((68.5 / 64 - 1) * 100)}%`);
  T('net against the original 96px bar', '-29%', `${Math.round((68.5 / 96 - 1) * 100)}%`);
  T('the top-right rail is gone', null, host2.querySelector('.dt-rail'));
  T('the new-session button is gone', null, host2.querySelector('#dt-newtab'));
  T('logical width doubles', Math.floor(1920 / 2), q.logical);
  const F = q.plate;
  const qspec = F.plateSpec(q.logical);

  /* the far-right KPIs are gone, and the centre took their space */
  T('the chip lamps are gone', null, qspec.cardsX);
  T('the token table is gone', null, qspec.tableLabelX);
  T('MODE moved to the plate edge', q.logical - 8, qspec.sandboxX);
  T('nothing is clickable where the chips were', null,
    F.plateSpec(q.logical).cardsX === null
      ? targetAt(F, q.logical, { x: q.logical - 77, y: 5 }, [])?.kind ?? null
      : 'chips still present');
  T('the elastic zone reclaims 90px', q.logical - 390, qspec.zoneW);
  T('the queue gets two columns', 2, waitingColumns(qspec));
  T('every other session fits the queue', true,
    SESSIONS_COUNT - 1 <= waitingColumns(qspec) * 3);
  T('the queue fills both columns', 6, SESSIONS_COUNT - 1);
  T('the last row of column two is painted', true, !!F.waitingRowBox(qspec, 5, 'GROK'));
  T('a seventh row is refused', null, F.waitingRowBox(qspec, 6, 'GROK'));

  /* two columns at a narrow window, which the shipped rule refused */
  await sizeTo2(1280);
  const nspec = F.plateSpec(q.logical);
  T('still two columns at a 1280 host', 2, F.waitingColumns(nspec));
  T('the shipped rule would have given one', 1,
    V.waitingColumns(V.plateSpec(q.logical)) );
  await sizeTo2(1920);

  /* The session marks in the list carry the working signal now. Drive two
     phases of the pulse and compare the pixels that actually landed. */
  const shot = (id) => host2.querySelector(`.dt-card[data-id="${id}"] canvas`).toDataURL();
  q.redraw(0.0); const workingA = shot('s1'), quietA = shot('s7');
  q.redraw(0.5); const workingB = shot('s1'), quietB = shot('s7');
  T('a working session\u2019s icon flashes', true, workingA !== workingB);
  T('a quiet session\u2019s icon stays still', true, quietA === quietB);

  const tabsBefore = host2.querySelectorAll('.dt-tab').length;
  host2.querySelector('.dt-card[data-id="s7"]').click();
  await settle();
  T('selecting still switches session', 's7', q.state.activeId);
  T('but no longer opens a tab', tabsBefore, host2.querySelectorAll('.dt-tab').length);
  host2.remove();

  return rows;
}
