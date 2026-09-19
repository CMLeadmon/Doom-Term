/* Doom Term — the fluid, interactive app.
 *
 * Everything the plate shows is derived from the session you have selected, so
 * clicking an agent anywhere moves the plate with it. The plate is not a
 * picture bolted to the bottom: it is bound to the same state the rest of the
 * chrome reads, and its clickable regions are computed from the geometry that
 * painted them (see hit.js).
 */
import { ICON } from './icons.js';
import { paintPlate, paintMark, paintGlyph } from './paint.js';
import * as PLATE_VERBATIM from './plate.js';
import * as PLATE_DOOM from './plate.doom.js';
import { logicalPoint, targetAt } from './hit.js';

export const PLATE_SCALE = 3;          // default: 32 logical px -> 96 on screen

/* Two arrangements of the same app.
 *
 * 'queue' halves the plate scale, which is the only lever on its height — the
 * bar is 32 LOGICAL px and renderPlate() takes an integer scale, so 96 -> 64 is
 * the nearest cut to a third, not a free choice. Halving it doubles the logical
 * width, and the elastic centre is `logical - 480`: at 1920 the well goes from
 * 160px and one column to 480px and two. That is what puts the whole session
 * queue back on the plate, and why the separate rail is no longer earning the
 * corner it sat in.
 */
export const LAYOUTS = {
  classic: { scale: 3, rail: true,  sidebarPulse: false, tabAdd: true,  plate: PLATE_VERBATIM },
  /* The queue layout draws through plate.doom.js: no chips, no token table,
     MODE at the edge, and a queue that always splits in two. */
  queue:   { scale: 2, rail: false, sidebarPulse: true,  tabAdd: false, plate: PLATE_DOOM },
};
const BUSY_MS = 2600;                  // how long a sent message keeps the mark alive

/* Rate limit is an account-wide reading, so it is the same in every session;
   context is per-session because each one has its own window. */
const USAGE = 0.34;

const SESSIONS = [
  {
    id: 's1', n: '1', agent: 'claude', tag: 'CLDE', status: 'working',
    title: 'WebGL compositor spike', agentName: 'Claude Code · Opus 5',
    cwd: '~/Projects/Doom Term', branch: 'feature/webgl-compositor',
    context: 0.61, mode: 'FULL', files: 3, add: 53, del: 15,
    table: [['IN', '14', '128'], ['OUT', '3', '32'], ['CAC', '88', '200'], ['TOT', '105', '360']],
    ask: 'Move the plate compositor onto WebGL, but keep renderPlate() as the source of truth.',
    reply: 'Reading src/hud/canvas.ts first — the blit path is the part that has to stay byte-exact.',
    cmds: [['ok', 'cargo test -p doom_term_hud'], ['ok', 'npm run hud:check'],
           ['run', 'cargo bench --bench plate_blit']],
    diff: {
      file: 'src/hud/canvas.ts', add: 15, del: 3,
      lines: [['', '41', '  <dt-k>const</dt-k> ctx = canvas.<dt-f>getContext</dt-f>(<dt-s>\'2d\'</dt-s>);'],
              ['del', '', '  ctx.<dt-f>drawImage</dt-f>(bitmap, 0, 0);'],
              ['add', '42', '  ctx.imageSmoothingEnabled = <dt-k>false</dt-k>;'],
              ['add', '43', '  ctx.<dt-f>putImageData</dt-f>(img, 0, 0);'],
              ['', '44', '  <dt-c>// the browser paints exactly what plate.js produced</dt-c>']],
    },
  },
  {
    id: 's2', n: '2', agent: 'codex', tag: 'CODX', status: 'asks',
    title: 'PTY socket teardown', agentName: 'Codex · GPT-5',
    cwd: '~/Projects/Doom Term', branch: 'fix/pty-socket-teardown',
    context: 0.38, mode: 'TREE', files: 1, add: 12, del: 40,
    table: [['IN', '9', '128'], ['OUT', '2', '32'], ['CAC', '51', '200'], ['TOT', '62', '360']],
    ask: 'The daemon leaks a socket when the last pane closes. Find it.',
    reply: 'Found it — the drop guard runs before the reaper, so the fd is still registered. Confirm before I patch?',
    cmds: [['ok', 'cargo test -p doom_term_daemon pty::'], ['bad', 'cargo test --all-targets'],
           ['ok', 'ss -x | grep doom-term']],
    diff: null,
  },
  {
    id: 's3', n: '3', agent: 'antigravity', tag: 'AGY', status: 'working',
    title: 'Docs portal migration', agentName: 'Antigravity · Gemini',
    cwd: '~/Projects/doom-docs', branch: 'main',
    context: 0.72, mode: 'FULL', files: 28, add: 914, del: 260,
    table: [['IN', '31', '128'], ['OUT', '11', '32'], ['CAC', '140', '200'], ['TOT', '182', '360']],
    ask: 'Port every page under docs/design to the new front-matter schema.',
    reply: 'Twenty-eight files. Doing them in one pass and reporting a digest rather than streaming each diff.',
    cmds: [['ok', 'npm run docs:lint'], ['run', 'npm run docs:build']],
    diff: null,
  },
  {
    id: 's5', n: '5', agent: 'opencode', tag: 'OPEN', status: 'failed',
    title: 'Sandbox tier audit', agentName: 'opencode',
    cwd: '~/Projects/Doom Term', branch: 'audit/sandbox-tier',
    context: 0.19, mode: 'OFF', files: 0, add: 0, del: 0,
    table: [['IN', '4', '128'], ['OUT', '1', '32'], ['CAC', '12', '200'], ['TOT', '17', '360']],
    ask: 'Check that every tier name the plate can draw is one the kernel can actually report.',
    reply: 'Build failed before I got there — ring wants lib.exe on this target.',
    cmds: [['ok', 'cargo tree -p doom_term_kernel'], ['bad', 'cargo check --all-targets']],
    diff: null,
  },
  {
    id: 's7', n: '7', agent: 'gemini', tag: 'GEM', status: 'quiet',
    title: 'Theme token sweep', agentName: 'Gemini CLI',
    cwd: '~/Projects/Doom Term', branch: 'chore/theme-tokens',
    context: 0.44, mode: 'FULL', files: 6, add: 88, del: 88,
    table: [['IN', '7', '128'], ['OUT', '2', '32'], ['CAC', '33', '200'], ['TOT', '42', '360']],
    ask: 'Replace every literal colour in src/styles with a material.css token.',
    reply: 'Done — six files, no visual change. The contrast guard still passes.',
    cmds: [['ok', 'npm run test -- material'], ['ok', 'git diff --stat']],
    diff: null,
  },
  {
    id: 's8', n: '8', agent: 'aider', tag: 'AIDR', status: 'asks',
    title: 'Signal handler audit', agentName: 'aider',
    cwd: '~/Projects/Doom Term', branch: 'fix/sigwinch-relay',
    context: 0.29, mode: 'TREE', files: 2, add: 31, del: 9,
    table: [['IN', '6', '128'], ['OUT', '2', '32'], ['CAC', '24', '200'], ['TOT', '32', '360']],
    ask: 'SIGWINCH is not reaching the pane after a split. Trace it.',
    reply: 'The relay drops it while the pty is being re-registered. Want the guard or the reorder?',
    cmds: [['ok', 'cargo test -p doom_term_daemon signal::'], ['run', 'strace -e trace=signal -p $(pgrep doom-term)']],
    diff: null,
  },
  {
    id: 's9', n: '9', agent: 'grok', tag: 'GROK', status: 'quiet',
    title: 'Kernel foreground probe', agentName: 'Grok',
    cwd: '~/Projects/Doom Term', branch: 'spike/foreground-rs',
    context: 0.53, mode: 'FULL', files: 4, add: 67, del: 22,
    table: [['IN', '11', '128'], ['OUT', '4', '32'], ['CAC', '46', '200'], ['TOT', '61', '360']],
    ask: 'Does classify_agent see agy as antigravity, or does it still fall through?',
    reply: 'It resolves. The alias is in the kernel table, so the well draws the prism, not the burst.',
    cmds: [['ok', 'cargo test -p doom_term_kernel foreground::classify'], ['ok', 'rg "agy" crates/kernel/src/foreground.rs']],
    diff: null,
  },
];

const REV_DIFF = [
  ['', '38', 10, '<span class="kw">fn</span> <span class="fn">plate_width</span>('],
  ['', '39', 12, 'available: <span class="kw">u32</span>,'],
  ['del', '', 12, 'scale: <span class="kw">u32</span>,'],
  ['add', '40', 12, 'scale: <span class="kw">NonZeroU32</span>,'],
  ['', '41', 10, ') -&gt; <span class="kw">u32</span> {'],
  ['add', '42', 12, '<span class="cm">// never below the reference width</span>'],
  ['add', '43', 12, '<span class="fn">max</span>(PLATE_480.width, available / scale)'],
  ['del', '', 12, 'available / scale'],
  ['', '44', 10, '}'],
];

const byId = (id) => SESSIONS.find((s) => s.id === id);
const pct = (v) => `${Math.min(99, Math.round(v * 100))}%`;

/* ----------------------------------------------------------------- markup */
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tags = (t) => t.replace(/<dt-(k|f|s|c|lav)>/g, '<span class="dt-$1">').replace(/<\/dt-(?:k|f|s|c|lav)>/g, '</span>');

const shellHTML = (L) => `
<div class="dt-bar">
  <span class="dt-lights"><i></i><i></i><i></i></span>
  <button class="dt-ico on" title="Toggle sidebar">${ICON.panel}</button>
  <button class="dt-ico" title="Settings">${ICON.wrench}</button>
  <div class="dt-tabs" id="dt-tabs"></div>
  ${L.tabAdd ? `<button class="dt-ico" id="dt-newtab" title="New session">${ICON.plus}</button>` : ''}
  <div class="dt-search">${ICON.search}<span>Search sessions, agents, files…</span></div>
  <div class="dt-right">
    <span class="dt-dpill" id="dt-dpill"></span>
    <button class="dt-ico" title="Notifications">${ICON.inbox}</button>
    <span class="dt-avatar">C</span>
  </div>
</div>

<div class="dt-main">
  <aside class="dt-side">
    <div class="dt-find">${ICON.search}<span>Search sessions…</span><span class="sp"></span>
      <button>${ICON.sliders}</button><button>${ICON.plus}</button></div>
    <div class="dt-grp">Sessions</div>
    <div class="dt-cards" id="dt-cards"></div>
  </aside>

  <section class="dt-pane">
    <div class="dt-phead">
      ${ICON.back}<span>ESC for terminal</span>
      <span class="mid">${ICON.check}<span id="dt-title"></span></span>
      <span class="end">${ICON.share}${ICON.kebab}</span>
    </div>
    <div class="dt-stream" id="dt-stream"></div>
    <div class="dt-foot">
      <label class="dt-composer">
        <span>&gt;</span>
        <input id="dt-input" placeholder="Type your message or @path/to/file" autocomplete="off" aria-label="Message">
        <span class="kbd">⌘I</span>
      </label>
      <div class="dt-meta">
        <div><b>workspace</b><span id="dt-cwd"></span></div>
        <div><b>branch</b><span id="dt-branch"></span></div>
        <div><b>context</b><span id="dt-ctx"></span></div>
      </div>
      <div class="dt-tools" id="dt-tools"></div>
    </div>
    <div class="dt-status">
      <span>${ICON.folder}<i id="dt-scwd"></i></span>
      <span>${ICON.branch}<i id="dt-sbranch"></i></span>
      <span>${ICON.sliders}<i id="dt-smode"></i></span>
    </div>
  </section>

  <aside class="dt-rev">
    <div class="rh">${ICON.rich}<span>Code review</span>
      <span class="end"><button title="Expand">${ICON.expand}</button>
        <button id="dt-revclose" title="Close panel">${ICON.close}</button></span></div>
    <div class="repo" id="dt-repo"></div>
    <div class="ctl">
      <span class="drop"><span>Uncommitted changes</span>${ICON.chev}</span>
      <button>${ICON.undo}<span>Discard</span></button>
    </div>
    <div class="file">${ICON.chev}<span class="nm">crates/hud/src/spec.rs</span>${ICON.copy}
      <span class="pill"><span class="a">+4</span><span class="d">-2</span></span></div>
    <div class="body">${REV_DIFF.map(([k, n, ind, code]) =>
      `<div class="dl ${k}"><em>${n}</em><span>${' '.repeat(ind)}${code}</span></div>`).join('')}</div>
  </aside>
</div>

<div class="dt-dock"><canvas id="dt-plate"></canvas></div>
${L.rail ? '<div class="dt-rail" id="dt-rail" role="group" aria-label="Active agents"></div>' : ''}`;

/* ------------------------------------------------------------------ mount */
/* `animate:false` mounts everything still — no rAF loop. The self test needs
   it (an endless rAF keeps the page non-idle, which stops Chrome's virtual
   clock and starves the test's own timers), and it is the honest mode for a
   screenshot. */
export function mountShell(root, { animate = true, layout = 'classic' } = {}) {
  const L = LAYOUTS[layout] || LAYOUTS.classic;
  const SCALE = L.scale;
  const P = L.plate;
  /* Per instance, not per module. The published page mounts this twice — once
     visibly and once off-screen for the behaviour suite — and a shared state
     object let the suite's session switch leak into the app on screen. */
  const state = {
    activeId: 's1',
    tabs: ['s1', 's2', 's3'],
    chips: [true, true, false],
    modes: {},                 // per-session override from clicking the MODE cell
    rev: true,
    busyUntil: 0,
    log: {},                   // lines typed into the composer
  };
  const active = () => byId(state.activeId) || SESSIONS[0];
  const modeOf = (s) => state.modes[s.id] ?? s.mode;
  const busy = (s) => s.status === 'working'
    || (s.id === state.activeId && performance.now() < state.busyUntil);

  /* Every session except the one on screen — observed status, never invented. */
  const waitingRows = () => SESSIONS.filter((s) => s.id !== state.activeId).map((s) => ({
    sessionId: s.id, n: s.n, name: s.title.toUpperCase().replace(/\s+/g, '-'),
    status: s.status, tag: s.tag,
  }));

  function plateState(phase) {
    const s = active();
    return {
      context: pct(s.context), usage: pct(USAGE), sandbox: modeOf(s),
      agent: s.agent, agentName: s.agentName,
      path: s.cwd, branch: s.branch,
      chips: state.chips, table: s.table,
      mode: 'waiting', waiting: waitingRows(),
      pulse: busy(s) ? phase : undefined, phase,
    };
  }

  root.classList.add('dt');
  root.classList.toggle('no-rail', !L.rail);
  root.classList.toggle('plate-2x', SCALE === 2);
  root.innerHTML = shellHTML(L);

  const $ = (id) => root.querySelector(`#${id}`);
  const plate = $('dt-plate');
  const railEl = $('dt-rail');
  const reduced = !animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let logical = 480;

  /* -- rail: one slot per session, the mark drawn by plate.js itself -------- */
  let slots = [];
  if (railEl) {
    railEl.innerHTML = SESSIONS.map((s) => `
      <button data-id="${s.id}" class="${s.status}" title="Session ${s.n} · ${s.agent} · ${s.status}">
        <canvas class="mk"></canvas>
        <span class="m"><span class="n">${s.n}</span><canvas class="gl"></canvas></span>
      </button>`).join('');
    slots = [...railEl.querySelectorAll('button')].map((b) => ({
      el: b, s: byId(b.dataset.id),
      mk: b.querySelector('canvas.mk'), gl: b.querySelector('canvas.gl'),
    }));
    slots.forEach((sl) => paintGlyph(sl.gl, sl.s.status, 1));
  }
  /* Session marks in the list. In the queue layout these carry the working
     signal the rail used to, so they are collected for the animation loop. */
  let cardMarks = [];

  /* -- render ------------------------------------------------------------- */
  function renderTabs() {
    $('dt-tabs').innerHTML = state.tabs.map((id) => {
      const s = byId(id);
      return `<button class="dt-tab ${id === state.activeId ? 'on' : ''}" data-id="${id}">
        <canvas data-mark="${s.agent}"></canvas><span class="lbl">${esc(s.title)}</span>
        <span class="x" data-close="${id}">×</span></button>`;
    }).join('');
    $('dt-tabs').querySelectorAll('canvas[data-mark]').forEach((c) => {
      paintMark(c, c.dataset.mark, undefined, 1);
      c.style.width = c.style.height = '14px';
    });
  }

  function renderCards() {
    $('dt-cards').innerHTML = SESSIONS.map((s) => `
      <button class="dt-card ${s.id === state.activeId ? 'on' : ''}" data-id="${s.id}">
        <canvas data-mark="${s.agent}"></canvas>
        <span class="txt"><span class="t">${esc(s.title)}</span>
          <span class="b">${ICON.branch}${esc(s.branch)}</span></span>
        <span class="st ${s.status}" title="${s.status}"></span>
      </button>`).join('');
    $('dt-cards').querySelectorAll('canvas[data-mark]').forEach((c) => {
      paintMark(c, c.dataset.mark, undefined, 1);
      c.style.width = c.style.height = '24px';
    });
    cardMarks = [...$('dt-cards').querySelectorAll('canvas[data-mark]')].map((c) => ({
      canvas: c, s: byId(c.closest('[data-id]').dataset.id),
    }));
  }

  function renderPane() {
    const s = active();
    const typed = (state.log[s.id] || []).map((t) =>
      `<div class="dt-q"><span class="who">C</span><div><div class="ask">${esc(t)}</div></div></div>`).join('');
    $('dt-stream').innerHTML = `
      <div class="dt-q"><span class="who">C</span><div>
        <div class="ask">${esc(s.ask)}</div>
        <div class="reply">${esc(s.reply)}</div></div></div>
      <div class="dt-cmds">${s.cmds.map(([k, c]) =>
        `<div class="dt-cmd ${k}"><span class="m">${k === 'ok' ? '✓' : k === 'bad' ? '✕' : '●'}</span>
         <code>${esc(c)}</code></div>`).join('')}</div>
      ${s.diff ? `<div class="dt-diff">
        <div class="h"><span class="sq"></span><span>${esc(s.diff.file)}</span>
          <span class="cnt"><span class="a">+${s.diff.add}</span><span class="d">-${s.diff.del}</span></span></div>
        <div class="b">${s.diff.lines.map(([k, n, t]) =>
          `<div class="dt-ln ${k}"><em>${n}</em>${tags(t)}</div>`).join('')}</div></div>` : ''}
      ${typed}`;
    $('dt-stream').scrollTop = $('dt-stream').scrollHeight;

    $('dt-title').textContent = s.title;
    $('dt-cwd').textContent = s.cwd;
    $('dt-branch').textContent = s.branch;
    $('dt-ctx').textContent = `${pct(s.context)} of window`;
    $('dt-scwd').textContent = s.cwd;
    $('dt-sbranch').textContent = s.branch;
    $('dt-smode').textContent = `mode ${modeOf(s)}`;
    $('dt-dpill').innerHTML = `${ICON.diffic}<span class="a">+${s.add}</span><span class="d">-${s.del}</span>`;
    $('dt-repo').innerHTML =
      `${ICON.branch}<span>${esc(s.branch)}</span>${ICON.file}<span>${s.files}</span>
       <span class="a">+${s.add}</span><span class="d">-${s.del}</span>`;
    $('dt-tools').innerHTML = `
      <span class="go">&gt;</span>
      <button class="dt-chip">${ICON.file}<span>${s.files}</span>
        <span class="a">+${s.add}</span><span class="d">-${s.del}</span></button>
      <button class="dt-chip">${ICON.monitor}<span>${esc(s.agentName)}</span></button>
      <button class="dt-chip">${ICON.files}<span>File explorer</span></button>`;
    slots.forEach((sl) => sl.el.classList.toggle('on', sl.s.id === state.activeId));
  }

  function renderAll() { renderTabs(); renderCards(); renderPane(); }

  function select(id) {
    if (!byId(id) || id === state.activeId) return;
    state.activeId = id;
    if (L.tabAdd && !state.tabs.includes(id)) state.tabs.push(id);
    renderAll();
    draw(0);
  }

  /* -- plate -------------------------------------------------------------- */
  function sizePlate() {
    logical = Math.max(480, Math.floor(root.clientWidth / SCALE));
    draw(reduced ? undefined : 0);
  }
  function draw(phase) {
    paintPlate(plate, plateState(phase), logical, SCALE, P);
    slots.forEach((sl) => paintMark(sl.mk, sl.s.agent, busy(sl.s) ? phase : undefined, 1));
    if (L.sidebarPulse) {
      cardMarks.forEach((m) => paintMark(m.canvas, m.s.agent, busy(m.s) ? phase : undefined, 1));
    }
  }

  /* -- interaction -------------------------------------------------------- */
  root.addEventListener('click', (e) => {
    const close = e.target.closest('[data-close]');
    if (close) {
      e.stopPropagation();
      const id = close.dataset.close;
      state.tabs = state.tabs.filter((t) => t !== id);
      if (state.activeId === id && state.tabs.length) state.activeId = state.tabs[0];
      renderAll(); draw(0);
      return;
    }
    const pick = e.target.closest('[data-id]');
    if (pick) { select(pick.dataset.id); return; }
    if (e.target.closest('#dt-revclose')) { root.classList.toggle('no-rev'); sizePlate(); return; }
    if (L.tabAdd && e.target.closest('#dt-newtab')) {
      const next = SESSIONS.find((s) => !state.tabs.includes(s.id));
      if (next) { state.tabs.push(next.id); select(next.id); }
    }
  });

  /* The plate's own cells. Regions come from hit.js, which asks plate.js where
     each one was painted — so a row the renderer skipped is never clickable. */
  plate.addEventListener('click', (e) => {
    const t = targetAt(P, logical, logicalPoint(plate, e, SCALE), waitingRows());
    if (!t) return;
    if (t.kind === 'row') select(t.row.sessionId);
    else if (t.kind === 'chip') { state.chips[t.chip] = !state.chips[t.chip]; draw(0); }
    else if (t.kind === 'mode') {
      const s = active(), order = ['FULL', 'TREE', 'OFF'];
      state.modes[s.id] = order[(order.indexOf(modeOf(s)) + 1) % order.length];
      renderPane(); draw(0);
    }
  });
  plate.addEventListener('mousemove', (e) => {
    const t = targetAt(P, logical, logicalPoint(plate, e, SCALE), waitingRows());
    plate.classList.toggle('hot', !!t);
  });
  plate.addEventListener('mouseleave', () => plate.classList.remove('hot'));

  $('dt-input').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.currentTarget.value.trim()) return;
    const s = active();
    (state.log[s.id] ||= []).push(e.currentTarget.value.trim());
    e.currentTarget.value = '';
    state.busyUntil = performance.now() + BUSY_MS;   // the mark lives, then goes still
    renderPane();
  });

  new ResizeObserver(sizePlate).observe(root);

  /* -- go ----------------------------------------------------------------- */
  renderAll();
  sizePlate();
  if (!reduced) {
    let last = 0;
    const tick = (now) => {
      const phase = (now % 500) / 500;
      if (now - last >= 33) { last = now; paintPlate(plate, plateState(phase), logical, SCALE, P); }
      slots.forEach((sl) => busy(sl.s) && paintMark(sl.mk, sl.s.agent, phase, 1));
      if (L.sidebarPulse) {
        cardMarks.forEach((m) => busy(m.s) && paintMark(m.canvas, m.s.agent, phase, 1));
      }
    
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* `redraw` exists so the behaviour suite can drive a known animation phase
     and compare what actually landed on the canvas, rather than trusting that
     wiring a pulse means a pulse is drawn. */
  return {
    select, sizePlate, redraw: draw, state, plate: P,
    get logical() { return logical; }, scale: SCALE, layout: L,
  };
}
