/**
 * Builds the Doom Term design-system bundle into docs/design/ds/.
 *
 * Each emitted file is a self-contained preview card. The first line carries
 * the `@dsCard` marker the Design System pane indexes on.
 *
 * TOKENS below is the canonical set. Task 1 of
 * docs/superpowers/plans/2026-08-26-doom-term-ui.md copies it verbatim into
 * src/styles/material.css; the values must stay identical in both places.
 * They are inlined per-card rather than linked because a design-system card
 * has to render standalone, with no external stylesheet to resolve.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not .pathname — the repo path contains a space, which
// .pathname would hand back percent-encoded.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = path.join(ROOT, 'docs/design/ds');

const PLATE_PNG = fs.readFileSync(path.join(ROOT, 'docs/design/reference/plate-480@1x.png')).toString('base64');

export const TOKENS = `
  --plate: repeating-linear-gradient(180deg,
    #767674 0 1px, #6d6d6b 1px 2px, #727270 2px 3px, #666664 3px 4px,
    #7a7a78 4px 5px, #6a6a68 5px 6px, #747472 6px 7px, #626260 7px 8px);
  --ground: #14120f;
  --ground-2: #1b1814;
  --bevel-up: inset 1px 1px 0 #a2a29f, inset -1px -1px 0 #2f2f2e;
  --bevel-dn: inset 1px 1px 0 #171716, inset -1px -1px 0 #8e8e8b;
  --ink: #d8cbb0;
  --ink-tan: #c8bb9c;
  --ink-dim: #8f8672;
  --ink-plate: #22201b;
  --st-live: #e0a92c;
  --st-pass: #5c9c3a;
  --st-fail: #d40b06;
  --st-wait: #3a6fd8;
  --st-idle: #6b645a;
  --mono: ui-monospace,"SF Mono","Cascadia Mono",Menlo,Consolas,monospace;
`;

const BASE = `
*{box-sizing:border-box;border-radius:0}
:root{${TOKENS}}
body{margin:0;padding:22px;background:var(--ground);color:var(--ink);
  font-family:var(--mono);font-size:13px;line-height:1.5;-webkit-font-smoothing:antialiased}
.plate{background:var(--plate);box-shadow:var(--bevel-up)}
.recess{background:var(--ground);box-shadow:var(--bevel-dn)}
h2{margin:0 0 4px;font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:var(--st-live);font-weight:700}
p.note{margin:0 0 16px;font-size:12px;color:var(--ink-dim);max-width:62ch}
.stack{display:flex;flex-direction:column;gap:14px}
code{color:var(--ink-tan);font-size:11.5px}
`;

function card(group, title, note, body, extraCss = '') {
  return `<!-- @dsCard group="${group}" -->
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${title}</title>
<style>${BASE}${extraCss}</style>
</head><body>
<h2>${title}</h2>
<p class="note">${note}</p>
${body}
</body></html>
`;
}

const files = {};

/* ------------------------------------------------ foundations */

files['foundations/material.html'] = card(
  'Foundations', 'Material',
  'Four things, and no fifth. If a surface cannot be described as plate, recess, bevel or ink, it does not belong in the build.',
  `<div class="grid">
    <div><div class="demo plate"></div><b>Plate</b><span>Striated neutral grey, 1px pitch. All chrome. Never behind body text.</span></div>
    <div><div class="demo recess"></div><b>Recess</b><span><code>#14120F</code>. Everything you read or type sits in one.</span></div>
    <div><div class="demo plate lbl">RAISED · PRESSED</div><b>Bevel</b><span>1px hard pair. Light <code>#A2A29F</code> top-left, dark <code>#2F2F2E</code> bottom-right. No soft shadow exists.</span></div>
    <div><div class="demo recess ink"><span style="color:var(--ink)">body</span><span style="color:var(--ink-tan)">label</span><span style="color:var(--ink-dim)">dim</span><span style="color:var(--ink-plate);background:#8a8a88;padding:0 3px">on plate</span></div><b>Ink</b><span>Bone on recess, near-black on plate. Bone on grey fails contrast.</span></div>
  </div>`,
  `.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:18px}
   .demo{height:58px;margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:9px;font-size:10.5px;letter-spacing:.14em;font-weight:700;color:var(--ink-plate)}
   .demo.ink{justify-content:flex-start;padding:0 11px;font-weight:400;letter-spacing:0}
   b{display:block;font-size:12px;color:var(--ink);margin-bottom:2px}
   span{font-size:11.5px;color:var(--ink-dim);line-height:1.5}`
);

files['foundations/color.html'] = card(
  'Foundations', 'Colour',
  'Five states, one colour each. A colour means one thing everywhere in the application or it means nothing. Semantic colour is separate from the plate greys and never decorates.',
  `<div class="stack">
    <div><div class="row">
      ${[['--st-live','Live','Running, streaming, waiting on a tool. The only state that animates.'],
         ['--st-pass','Passed','Exit 0, tests green, patch applied.'],
         ['--st-fail','Failed','Non-zero exit, panic, rejected patch. Also every diff deletion.'],
         ['--st-wait','Waiting on you','Approval pending. Informational — never a status.'],
         ['--st-idle','Idle','Settled, backgrounded, nothing to say.']]
        .map(([v,n,d])=>`<div class="sw"><i style="background:var(${v})"></i><div><b>${n}</b><span>${d}</span><code>var(${v})</code></div></div>`).join('')}
    </div></div>
    <div><h3>Plate greys</h3><div class="ramp">
      ${['#767674','#727270','#6d6d6b','#6a6a68','#666664','#626260','#a2a29f','#2f2f2e']
        .map(c=>`<i style="background:${c}" title="${c}"></i>`).join('')}
    </div><span class="cap">Striation tones, then the bevel pair. The brown people remember from Doom is level texture — the bar itself is neutral.</span></div>
  </div>`,
  `.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
   .sw{display:flex;gap:11px;align-items:flex-start}
   .sw i{width:26px;height:26px;flex-shrink:0;box-shadow:inset 0 0 0 1px rgba(0,0,0,.5)}
   .sw b{display:block;font-size:12px;color:var(--ink)}
   .sw span{display:block;font-size:11.5px;color:var(--ink-dim);margin:1px 0 2px}
   h3{margin:0 0 7px;font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-tan);font-weight:700}
   .ramp{display:flex}.ramp i{flex:1;height:26px;display:block}
   .cap{display:block;font-size:11.5px;color:var(--ink-dim);margin-top:6px}`
);

files['foundations/type.html'] = card(
  'Foundations', 'Type',
  'Two bitmap faces for the plate, one monospace for everything above it. The plate faces are hand-authored glyph tables in src/hud/plate.js — not fonts, so they never reflow or hint differently between machines.',
  `<div class="stack">
    <div><h3>Plate · numeral face — 8 × 14</h3>
      <img src="data:image/png;base64,${PLATE_PNG}" alt="Status plate showing the numeral and label faces" class="shot">
      <span class="cap">Red numerals right-align at their slot X, as Doom drew them. Letters exist so a categorical value (<code>FULL</code>) can occupy a numeral slot.</span></div>
    <div><h3>Surface · roles</h3>
      <div class="recess roles">
        <div><span style="color:var(--ink);font-size:14px">Body — command text and output</span><em>13px · var(--ink)</em></div>
        <div><span style="color:var(--ink-tan);letter-spacing:.16em;font-size:11px">LABEL — COLUMN HEADS AND VERBS</span><em>11px · .16em · var(--ink-tan)</em></div>
        <div><span style="color:var(--ink-dim);font-size:11px">Dim — metadata, durations, exit codes</span><em>11px · var(--ink-dim)</em></div>
      </div></div>
  </div>`,
  `h3{margin:0 0 7px;font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:var(--ink-tan);font-weight:700}
   .shot{display:block;width:100%;height:auto;image-rendering:pixelated;box-shadow:var(--bevel-dn)}
   .cap{display:block;font-size:11.5px;color:var(--ink-dim);margin-top:7px}
   .roles{padding:12px 14px;display:flex;flex-direction:column;gap:10px}
   .roles div{display:flex;justify-content:space-between;align-items:baseline;gap:16px;flex-wrap:wrap}
   .roles em{font-style:normal;font-size:10.5px;color:var(--st-live);letter-spacing:.08em}`
);

/* ------------------------------------------------ components */

files['components/status-plate.html'] = card(
  'Components', 'Status plate',
  'The byte-exact reference image, 480 × 32. The app blits the same buffer this was rendered from, so npm run hud:check passes at zero mismatched pixels. Scale by whole integers only — fractional scaling destroys the striation and the 1px bevels.',
  `<img src="data:image/png;base64,${PLATE_PNG}" alt="Status plate: context, usage, agent panel, sandbox tier, credentials, token table" class="shot">
   <div class="slots">
     ${[['x44','CONTEXT','Context window filled, %'],
        ['x90','USAGE','Rate limit consumed, %'],
        ['x104','PANEL','Agent · path · branch. 226px, 24-char value column'],
        ['x381','SANDBOX','Tier NAME — FULL / TREE / OFF. Never a percentage'],
        ['x399','CREDENTIALS','SSH · cloud · signing'],
        ['x411','TOKENS','Current against limit, 7px row pitch']]
       .map(([x,n,d])=>`<div><code>${x}</code><b>${n}</b><span>${d}</span></div>`).join('')}
   </div>`,
  `.shot{display:block;width:100%;height:auto;image-rendering:pixelated;box-shadow:var(--bevel-dn)}
   .slots{margin-top:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
   .slots div{border-top:1px solid #2a241d;padding-top:8px}
   .slots code{display:block;font-size:10.5px;color:var(--st-live);letter-spacing:.1em}
   .slots b{display:block;font-size:12px;color:var(--ink);margin:2px 0 1px}
   .slots span{font-size:11.5px;color:var(--ink-dim);line-height:1.45}`
);

const railRow = (cap, cmd, meta, out, outColor) => `
  <div class="blk">
    <div class="rail plate"><span class="capw recess"><i style="background:var(--st-${cap})"></i></span></div>
    <div class="body">
      <div class="cmd"><span class="mk">▸</span><span class="t">${cmd}</span><span class="m">${meta}</span></div>
      <div class="out"${outColor ? ` style="color:${outColor}"` : ''}>${out}</div>
    </div>
  </div>`;

files['components/rail.html'] = card(
  'Components', 'Command rail',
  'Replaces the card border. Each command owns a segment of plate in the gutter, capped with its exit state; output flows free on the ground with nothing around it. Block boundaries without boxing, full window width for long lines, and native drag-select.',
  `<div class="recess pad">
    ${railRow('pass','cargo build --release','0.42S · EXIT 0','Finished release [optimized] target(s) in 0.42s')}
    ${railRow('fail','cargo test --workspace','3.10S · EXIT 101','test result: FAILED. 41 passed; 2 failed; 0 ignored','#e0705c')}
    ${railRow('live','cargo build --release','RUNNING · 1.8S','   Compiling doom-term v0.1.0')}
  </div>`,
  `.pad{padding:12px 0}
   .blk{display:flex;gap:11px;padding:0 12px 12px}
   .rail{width:22px;flex-shrink:0;display:flex;flex-direction:column;align-items:center;padding-top:4px}
   .capw{width:15px;height:12px;display:flex;align-items:center;justify-content:center}
   .capw i{width:6px;height:6px;display:block}
   .body{flex:1;min-width:0}
   .cmd{display:flex;gap:14px;align-items:baseline}
   .cmd .mk{color:var(--st-live)}
   .cmd .t{flex:1;min-width:0;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
   .cmd .m{flex-shrink:0;font-size:11px;letter-spacing:.1em;color:var(--ink-dim)}
   .out{margin-top:2px;color:var(--ink-dim);white-space:pre-wrap}`
);

files['components/tool-calls.html'] = card(
  'Components', 'Tool calls',
  'An agent turn is a command like any other — same rail, same cap. The body is a fixed four-column row per call: mark, verb, target, result. Columns align down the whole turn so you can scan what it touched without reading prose. Only the row in flight is gold.',
  `<div class="recess pad">
    ${[['READ','src/pty/demux.rs','412 lines','',''],
       ['GREP','OSC_MAX · 3 files','7 hits','',''],
       ['EDIT','src/pty/demux.rs','','+42','−18'],
       ['EDIT','src/pty/mod.rs','','+4','−1'],
       ['SHELL','cargo test pty::demux','running…','','live']]
      .map(([v,t,r,a,d])=>{
        const live = d==='live';
        const right = a ? `<span style="color:var(--st-pass)">${a}</span> <span style="color:var(--st-fail)">${d}</span>` : r;
        return `<div class="tool"><span class="mk"${live?' style="color:var(--st-live)"':''}>▸</span><span class="n"${live?' style="color:var(--st-live)"':''}>${v}</span><span class="t">${t}</span><span class="r">${right}</span></div>`;
      }).join('')}
  </div>`,
  `.pad{padding:12px 14px}
   .tool{display:flex;gap:11px;align-items:baseline;padding:1px 0}
   .tool .mk,.tool .n{color:var(--ink-tan)}
   .tool .n{width:52px;flex-shrink:0;letter-spacing:.08em}
   .tool .t{flex:1;min-width:0;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
   .tool .r{flex-shrink:0;font-size:11px;color:var(--ink-dim);font-variant-numeric:tabular-nums}`
);

files['components/diff.html'] = card(
  'Components', 'Diff and apply',
  'The highest-stakes surface on the stage: plate header, recessed body, plate action bar. Changed lines are tinted grounds, not coloured borders — the tint is what the eye counts. Apply is ringed gold and bound to Enter; Reject is ringed red. The dangerous action is never the one your hands are already on.',
  `<div class="dh plate"><span>SRC/PTY/DEMUX.RS</span><span class="s"><b style="color:#14380c">+42</b><b style="color:#4a0806">−18</b></span></div>
   <div class="recess">
     ${[[117,' ','        if self.in_osc {'],
        [118,'-','            self.osc_buf.push(byte);'],
        [119,'-','            if byte == 0x07 { self.finish_osc(); }'],
        [118,'+','            if self.osc_buf.len() &lt; OSC_MAX {'],
        [119,'+','                self.osc_buf.push(byte);'],
        [120,'+','            } else {'],
        [121,'+','                self.state = State::Ground;'],
        [122,'+','            }'],
        [123,' ','            return;']]
       .map(([n,s,t])=>`<div class="dl ${s==='+'?'add':s==='-'?'del':''}"><span class="ln">${n}</span><span class="sg">${s}</span><span class="c">${t}</span></div>`).join('')}
   </div>
   <div class="bar plate">
     <button class="btn pri">APPLY PATCH</button>
     <button class="btn">NEXT FILE</button>
     <button class="btn dgr">REJECT</button>
     <span class="hint">ENTER APPLY · TAB NEXT · ESC REJECT</span>
   </div>`,
  `.dh{display:flex;justify-content:space-between;padding:3px 9px;font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--ink-plate)}
   .dh .s{display:flex;gap:10px}.dh b{font-weight:700}
   .dl{display:flex;font-variant-numeric:tabular-nums}
   .dl .ln{width:38px;text-align:right;padding-right:9px;color:#5b5346;flex-shrink:0;user-select:none}
   .dl .sg{width:15px;flex-shrink:0;user-select:none;color:#5b5346}
   .dl .c{flex:1;min-width:0;white-space:pre;overflow:hidden;color:var(--ink-dim)}
   .dl.add{background:#101c0c}.dl.add .sg{color:var(--st-pass)}.dl.add .c{color:#9fd07f}
   .dl.del{background:#1e0c0a}.dl.del .sg{color:var(--st-fail)}.dl.del .c{color:#e0938a}
   .bar{display:flex;align-items:center;gap:8px;padding:5px 6px;margin-top:5px}
   .btn{background:var(--plate);box-shadow:var(--bevel-up);border:0;padding:2px 13px;font-family:var(--mono);
     font-size:11.5px;font-weight:700;letter-spacing:.1em;color:var(--ink-plate);cursor:default}
   .btn.pri{color:#3a2a04;box-shadow:var(--bevel-up),inset 0 0 0 2px var(--st-live)}
   .btn.dgr{color:#4a0806;box-shadow:var(--bevel-up),inset 0 0 0 2px #c02a22}
   .hint{margin-left:auto;font-size:10.5px;letter-spacing:.12em;color:#2e2a24;padding-right:4px}`
);

files['components/approval.html'] = card(
  'Components', 'Approval',
  'When an agent asks to run something you did not type, the request must be unmistakable and the exact command readable. Deny holds the gold ring and Escape; Run Once holds the red one — the ring colours the risk, not the recommendation. If it cannot be undone, the consequence line is mandatory.',
  `<div class="panel plate">
     <div class="ph"><span>RUN SHELL COMMAND?</span><span style="color:#4a0806">SANDBOX OFF · YOUR HOST</span></div>
     <div class="pb recess">
       <div class="cmd">rm -rf target/ &amp;&amp; cargo clean --manifest-path backend/Cargo.toml</div>
       <div class="meta">CLAUDE CODE · WORKING DIRECTORY ~/PROJECTS/DOOM TERM<br>DELETES 2 DIRECTORIES · NOT REVERSIBLE</div>
     </div>
     <div class="bar plate">
       <button class="btn dgr">RUN ONCE</button>
       <button class="btn">ALWAYS ALLOW</button>
       <button class="btn pri">DENY</button>
       <span class="hint">ESC DENIES</span>
     </div>
   </div>`,
  `.panel{padding:6px;max-width:520px}
   .ph{display:flex;justify-content:space-between;padding:1px 5px 5px;font-size:11.5px;font-weight:700;letter-spacing:.13em;color:var(--ink-plate)}
   .pb{padding:9px 11px}
   .cmd{color:var(--ink);white-space:pre-wrap}
   .meta{margin-top:7px;font-size:10.5px;letter-spacing:.07em;color:var(--ink-dim);line-height:1.6}
   .bar{display:flex;align-items:center;gap:8px;padding:5px 6px;margin-top:5px}
   .btn{background:var(--plate);box-shadow:var(--bevel-up);border:0;padding:2px 13px;font-family:var(--mono);
     font-size:11.5px;font-weight:700;letter-spacing:.1em;color:var(--ink-plate);cursor:default}
   .btn.pri{color:#3a2a04;box-shadow:var(--bevel-up),inset 0 0 0 2px var(--st-live)}
   .btn.dgr{color:#4a0806;box-shadow:var(--bevel-up),inset 0 0 0 2px #c02a22}
   .hint{margin-left:auto;font-size:10.5px;letter-spacing:.12em;color:#2e2a24;padding-right:4px}`
);

files['components/panel.html'] = card(
  'Components', 'Panel',
  'History, file open and settings search are one component with three sources — building three would produce three dialects. The selected row is a raised plate button, not a highlight bar: it reads as the thing Enter will press, which is what it is. Kind is a column, not a badge.',
  `<div class="panel plate">
     <div class="ph"><span>RUN · OPEN · RECALL</span><span>↑↓ MOVE · ENTER RUN · ESC CLOSE</span></div>
     <div class="pb recess">
       <div class="field recess"><span style="color:var(--st-live)">▸</span><span>test</span></div>
       ${[['RECENT','cargo test --workspace','3.10S · EXIT 101',1],
          ['RECENT','cargo test pty::demux -- --nocapture','6 PASSED',0],
          ['FILE','src/pty/demux.rs','412 LINES',0],
          ['FILE','backend/src/wad/playpal.rs','188 LINES',0],
          ['ACTION','Toggle status plate','⌘/',0],
          ['ACTION','Switch agent…','⌘K',0]]
         .map(([k,v,r,sel])=>`<div class="row${sel?' sel plate':''}"><span class="k">${k}</span><span class="v">${v}</span><span class="r">${r}</span></div>`).join('')}
     </div>
   </div>`,
  `.panel{padding:6px;max-width:560px}
   .ph{display:flex;justify-content:space-between;padding:1px 5px 5px;font-size:11.5px;font-weight:700;letter-spacing:.13em;color:var(--ink-plate)}
   .pb{padding:5px}
   .field{padding:3px 9px;display:flex;gap:7px;margin-bottom:5px;color:var(--ink)}
   .row{display:flex;gap:11px;align-items:baseline;padding:2px 8px;color:var(--ink)}
   .row .k{width:74px;flex-shrink:0;letter-spacing:.08em;color:var(--ink-dim)}
   .row .v{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
   .row .r{flex-shrink:0;font-size:10.5px;color:var(--ink-dim)}
   .row.sel{color:#2a2620}.row.sel .k,.row.sel .r{color:#3d3830}
   .row.sel .v{color:#3a2a04;font-weight:700}`
);

files['components/session-strip.html'] = card(
  'Components', 'Session strip',
  'Tabs are plate segments. The active one is pressed in, not highlighted — the bevel inverts, which is how a physical control tells you which one is down. The dot carries session state, so four dots tell you the state of four sessions without switching to any of them.',
  `<div class="strip plate">
     <span class="tab sel"><i style="background:var(--st-live)"></i>doom-term</span>
     <span class="tab"><i style="background:var(--st-pass)"></i>backend</span>
     <span class="tab"><i style="background:var(--st-fail)"></i>wad-parser</span>
     <span class="tab"><i style="background:var(--st-idle)"></i>notes</span>
     <span class="tab add">+</span>
     <span class="meta"><span>~/PROJECTS/DOOM TERM</span><span><b>MAIN</b></span></span>
   </div>`,
  `.strip{display:flex;align-items:center;height:31px;padding:0 6px}
   .tab{background:var(--plate);box-shadow:var(--bevel-up);height:23px;display:flex;align-items:center;gap:6px;
     padding:0 11px;font-size:11.5px;color:var(--ink-plate);font-weight:700;letter-spacing:.05em;margin-right:4px}
   .tab i{width:6px;height:6px;display:block;box-shadow:inset 0 0 0 1px rgba(0,0,0,.5)}
   .tab.sel{box-shadow:var(--bevel-dn);background:#33302b;color:var(--st-live)}
   .tab.add{padding:0 9px;color:#3a352d}
   .meta{margin-left:auto;display:flex;gap:16px;font-size:10.5px;color:#2e2a24;letter-spacing:.1em;padding-right:5px}
   .meta b{color:#14120f}`
);

/* ------------------------------------------------ emit */

fs.rmSync(OUT, { recursive: true, force: true });
for (const [rel, html] of Object.entries(files)) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, html);
  console.log(`${rel}  ${html.length} bytes`);
}
console.log(`\n${Object.keys(files).length} cards -> docs/design/ds/`);
