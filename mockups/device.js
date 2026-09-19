/* The Warp Sidecar study: markup built to the numbers in scripts/measure.py's
   output, plus the Doom Term plate and agent rail. Shared by index.html (the
   published page) and app.html (the bare 1:1 render the parity diff uses), so
   the thing measured and the thing shown cannot diverge. */

import { ICON } from './icons.js';

/* ---------------------------------------------------------------- titlebar */
const titlebar = () => `
<div class="tb">
  <span class="light r"></span><span class="light y"></span><span class="light g"></span>
  <span class="panel-btn"></span>
  <span class="ico i1">${ICON.panel}</span>
  <span class="ico i2">${ICON.wrench}</span>
  <span class="ico i3">${ICON.grid}</span>
  <div class="search">${ICON.search}<span>Search sessions, agents, files...</span></div>
  <div class="dpill">${ICON.diffic}<span class="a">+53</span><span class="d">-15</span></div>
  <span class="ico inbox">${ICON.inbox}</span>
  <div class="avatar">E</div>
</div>`;

/* ----------------------------------------------------------------- sidebar */
const CARDS = [
  { on: true,  ic: '<span style="background:#3b7ff5;color:#07152b">' + ICON.ready + '</span>',
    t: '<span class="st">&#9671;</span> Ready (dbt)', b: 'eric/influencer-data' },
  { ic: '<span style="background:#20262b;color:#cfd4d6">' + ICON.file + '</span>',
    t: 'Can you double check &hellip;', b: 'main' },
  { ic: '<span style="background:#2a2f31;color:#cfd4d6">' + ICON.gear + '</span>',
    t: 'Debug dbt build', b: 'eric/influencer-data' },
  { ic: '<span style="background:#e8825f;color:#3a1a0c">' + ICON.bolt + '</span>',
    t: 'Pull channel history fro&hellip;', b: 'main' },
  { ic: '<span style="background:#20262b;color:#cfd4d6">' + ICON.rich + '</span>',
    t: 'Create Deep-Link With &hellip;', b: 'eric/nextCommand-in-pay&hellip;' },
];
const sidebar = () => `
<div class="sb">
  <div class="find">${ICON.search}<span>Search tabs...</span><span class="sp"></span>
    <span class="act">${ICON.sliders}</span><span class="act">${ICON.plus}</span></div>
  ${CARDS.map((c, i) => `
  <div class="card${c.on ? ' on' : ''}" style="top:${103 - 54 + i * 75}px">
    <span class="ic">${c.ic}</span>
    <span class="txt"><span class="t">${c.t}</span>
      <span class="b">${ICON.branch}${c.b}</span></span>
  </div>`).join('')}
</div>`;

/* -------------------------------------------------------------- centre pane */
const L = (s) => s;
const BODY = [
  '      <span class="lav">influencer</span> attribution logic in',
  '      <span class="lav">int_influencer_data.sql</span> to use exact promo code',
  '      matches only, preventing false positives from prefix',
  '      matching.',
  '   <span class="bld">4. Enhanced Documentation and Testing:</span>',
  '       <span class="lav">*</span> Added comprehensive YAML documentation for the',
  '         <span class="lav">int_influencer_data</span> model in',
  '         <span class="lav">models/users/_users.yml</span>.',
  '       <span class="lav">*</span> Implemented a uniqueness test on the combination',
  '         of <span class="lav">utm_source</span>, <span class="lav">utm_medium</span>, <span class="lav">utm_campaign</span>, and',
  '         <span class="lav">utm_content</span>.',
  '       <span class="lav">*</span> Added inline comments and YAML documentation',
  '         explaining the rationale for the <span class="lav">2025-01-01</span> data',
  '         cutoff.',
].join('\n');

const pane = () => `
<div class="pane">
  <div class="ph">
    <span class="esc">${ICON.back}<b>ESC</b> for terminal</span>
    <span class="mid">${ICON.check}Audit Creator Data Models</span>
    <span class="right">${ICON.share}${ICON.kebab}</span>
  </div>

  <div class="t-line t-prompt">~/Documents/Code/dbt git:(eric/influencer-data) PR #667</div>
  <div class="t-line t-agent">gemini</div>
  <div class="t-line t-body">${BODY}</div>

  <div class="rule"></div>
  <div class="t-line t-hint">auto-accept edits <span class="d">Shift+Tab to plan</span></div>

  <div class="input"><span>&gt;</span><span class="car"></span><span class="ph2">Type your message or @path/to/file</span></div>

  <div class="meta">
    <div class="row l"><span class="c1">workspace (/directory)</span><span>branch</span></div>
    <div class="row v"><span class="c1">~/Documents/Code/dbt</span><span>eric/influencer-data</span><span class="dots">&hellip;</span></div>
  </div>
  <div class="lines">Lines: 509 (grid: 69, flat: 440); Size: 277.7 KB (grid: 194.5 KB, flat: 83.2 KB)</div>

  <div class="tools">
    <span class="go">&gt;</span>
    <span class="ic">${ICON.plus}</span>
    <span class="ic">${ICON.mic}</span>
    <span class="b">${ICON.file}<span>3</span><span style="color:#6f7476">&bull;</span><span class="a">+53</span><span class="d">-15</span></span>
    <span class="b">${ICON.monitor}<span>/remote-control</span></span>
    <span class="b">${ICON.files}<span>File explorer</span></span>
    <span class="b">${ICON.rich}<span>Rich Input</span><span class="kbd">^G</span></span>
  </div>

  <div class="status">
    <span class="b">${ICON.folder}~/Documents/Code/dbt</span>
    <span class="b">${ICON.branch}eric/influencer-data</span>
    <span class="b">${ICON.sliders}</span>
  </div>
</div>`;

/* ---------------------------------------------------------- code review panel */
const DIFF = [
  ['',    'n',   10, 'g.utm_content;'],
  ['199', 'n',   17, 'uf.signup_date'],
  ['200', 'n',   10, '<span class="kw">from</span> user_promo_co'],
  ['201', 'n',   10, '<span class="kw">join</span> oz_campaign_g'],
  ['202', 'n',   12, '<span class="kw">on</span> <span class="fn">lower</span>(pc.pr'],
  ['',    'del', 13, '<span class="kw">or</span> ('],
  ['',    'del', 16, '<span class="fn">length</span>(pc.'],
  ['',    'del', 16, '<span class="kw">and</span> <span class="fn">lower</span>('],
  ['',    'del', 13, ')'],
  ['203', 'n',   10, '<span class="kw">join</span> {{ <span class="fn">ref</span>(\'core_'],
  ['204', 'n',   12, '<span class="kw">on</span> pc.user_id'],
  ['',    'del', 11, '<span class="kw">where</span> uf.signup_da'],
  ['205', 'add', 10, '<span class="kw">where</span>'],
  ['206', 'add', 12, '<span class="cm">-- Consistent</span>'],
  ['207', 'add', 12, 'uf.signup_date'],
  ['208', 'n',   10, ')'],
  ['',    'gap',  0, ''],
  ['240', 'n',   10, 'a.utm_source,'],
  ['241', 'n',   10, 'a.utm_medium,'],
  ['242', 'n',   10, 'a.utm_campaign,'],
  ['243', 'n',   10, 'a.utm_content,'],
  ['244', 'n',   10, '<span class="fn">count</span>(<span class="kw">distinct</span> a.s'],
  ['',    'del', 10, '<span class="fn">count</span>(<span class="kw">distinct</span> cas'],
  ['',    'del', 10, '<span class="fn">count</span>(<span class="kw">distinct</span> cas'],
];
const review = () => `
<div class="rev">
  <div class="h">${ICON.rich}<span>Code review</span></div>
  <div class="hr">${ICON.expand}${ICON.close}</div>
  <div class="repo"><span>eric/influencer-data</span>
    <span class="n">${ICON.file}3</span><span style="color:#6f7476">&bull;</span>
    <span class="a">+53</span><span class="d">-15</span></div>
  <div class="drop"><span>Uncommitted changes</span>${ICON.chev}</div>
  <div class="discard">${ICON.undo}<span>Discard all</span></div>
  <div class="kebab">${ICON.kebab}</div>
  <div class="file">
    ${ICON.chev}<span class="nm">t_influencer_data.sql</span>${ICON.copy}
    <span class="pill"><span class="a">+13</span><span style="color:#6f7476">&middot;</span><span class="d">-14</span></span>
    <span class="tail">${ICON.clip}${ICON.undo}${ICON.ext}</span>
  </div>
  <div class="diff">
    ${DIFF.map(([n, k, ind, code]) =>
      `<div class="dl ${k}"><em>${n}</em><span class="c">${' '.repeat(ind)}${code}</span></div>`).join('')}
  </div>
  <div class="bolt">${ICON.bolt}</div>
</div>`;

/* ------------------------------------------------------- plate + agent rail */
export const RAIL = [
  { n: '1', agent: 'gemini',      status: 'working' },
  { n: '2', agent: 'claude',      status: 'asks'    },
  { n: '3', agent: 'codex',       status: 'working' },
  { n: '5', agent: 'antigravity', status: 'failed'  },
  { n: '7', agent: 'opencode',    status: 'quiet'   },
];
const rail = () => `<div class="rail" role="group" aria-label="Active agents">${
  RAIL.map((r) => `
  <div class="slot ${r.status}" title="Session ${r.n} &middot; ${r.agent} &middot; ${r.status}">
    <canvas class="mk" data-agent="${r.agent}" data-status="${r.status}"></canvas>
    <div class="m"><span class="n">${r.n}</span><canvas class="gl" data-status="${r.status}"></canvas></div>
  </div>`).join('')}</div>`;

export const PLATE_STATE = {
  context: '61%', usage: '34%', sandbox: 'FULL',
  agent: 'gemini', agentName: 'GEMINI CLI',
  path: '~/DOCUMENTS/CODE/DBT', branch: 'ERIC/INFLUENCER-DATA',
  chips: [true, true, false],
  table: [['IN', '14', '128'], ['OUT', '3', '32'], ['CAC', '88', '200'], ['TOT', '105', '360']],
  mode: 'waiting',
  waiting: [
    { sessionId: 's2', n: '2', name: 'DOUBLE-CHECK', status: 'asks',    tag: 'CLDE' },
    { sessionId: 's3', n: '3', name: 'DEBUG-DBT-BUILD', status: 'working', tag: 'CODX' },
    { sessionId: 's5', n: '5', name: 'CHANNEL-HISTORY', status: 'failed',  tag: 'AGY'  },
    { sessionId: 's7', n: '7', name: 'DEEP-LINK', status: 'quiet',   tag: 'OPEN' },
  ],
};

export function deviceHTML() {
  return `<div class="device">
    <div class="app">${titlebar()}${sidebar()}${pane()}${review()}${rail()}</div>
    <div class="dock"><canvas class="plate"></canvas></div>
  </div>`;
}
