/**
 * The Doom Term status plate — reference renderer.
 *
 * This is the SINGLE SOURCE OF TRUTH for plate geometry. The browser
 * app (src/hud/canvas.ts) and the reference CLI (tools/hud/cli.js) both
 * call renderPlate() from HERE, so they cannot drift. `npm run hud:check`
 * proves it by diffing a screenshot against output from this file.
 *
 * Geometry derives from id Software's st_stuff.c (linuxdoom-1.10).
 * Bar-local y = screen y - 168, because the 320x32 bar sat at y=168 on a
 * 320x200 screen. Numerals are RIGHT-ALIGNED at their X, as Doom drew them.
 *
 *   AMMO   x44  y171  ->  CONTEXT   (context window filled, %)
 *   HEALTH x90  y171  ->  USAGE     (rate limit consumed, %)
 *   ARMS   x111 y172  ->  dropped   (see PLATE_480: panel reclaims it)
 *   FACE   x143 y168  ->  agent mark, 24x29 well
 *   ARMOR  x221 y171  ->  SANDBOX   (tier NAME: FULL / TREE / OFF)
 *   KEYS   x239 y171/181/191, 8x5  ->  credentials
 *   AMMO table x288 (current) / x314 (limit), y173/179/185/191
 */

// ---------------------------------------------------------------- fonts

/** STTNUM-alike. 8 wide x 14 tall. Digits, % and the letters SANDBOX needs. */
const FONT_BIG = {
  '0': ['.111111.','11111111','111..111','111..111','111..111','111..111','111..111','111..111','111..111','111..111','111..111','111..111','11111111','.111111.'],
  '1': ['...11...','..111...','.1111...','11111...','...11...','...11...','...11...','...11...','...11...','...11...','...11...','...11...','11111111','11111111'],
  '2': ['.111111.','11111111','11....11','.....111','....111.','...111..','..111...','.111....','111.....','11......','11......','11......','11111111','11111111'],
  '3': ['.111111.','11111111','11....11','......11','....111.','...111..','...111..','......11','......11','11....11','11....11','11111111','11111111','.111111.'],
  '4': ['....111.','...1111.','..11111.','.111.11.','111..11.','11...11.','11...11.','11111111','11111111','.....11.','.....11.','.....11.','.....11.','.....11.'],
  '5': ['11111111','11111111','11......','11......','11......','1111111.','11111111','.....111','......11','......11','11....11','11....11','11111111','.111111.'],
  '6': ['..11111.','.1111111','111.....','11......','11......','1111111.','11111111','111...11','11....11','11....11','11....11','111...11','11111111','.111111.'],
  '7': ['11111111','11111111','.....111','.....111','....111.','....111.','...111..','...111..','..111...','..111...','.111....','.111....','111.....','111.....'],
  '8': ['.111111.','11111111','111..111','111..111','111..111','.111111.','.111111.','11111111','111..111','111..111','111..111','111..111','11111111','.111111.'],
  '9': ['.111111.','11111111','111..111','11....11','11....11','11111111','.1111111','......11','......11','......11','......11','.....111','1111111.','.111111.'],
  '%': ['11....11','11...11.','11..11..','....11..','...11...','..11....','.11.....','11....11','11...11.','.....11.','....11..','........','........','........'],
  'F': ['11111111','11111111','11......','11......','11......','1111111.','1111111.','11......','11......','11......','11......','11......','11......','11......'],
  'U': ['111..111','111..111','111..111','111..111','111..111','111..111','111..111','111..111','111..111','111..111','111..111','111..111','11111111','.111111.'],
  'L': ['111.....','111.....','111.....','111.....','111.....','111.....','111.....','111.....','111.....','111.....','111.....','111.....','11111111','11111111'],
  'T': ['11111111','11111111','...11...','...11...','...11...','...11...','...11...','...11...','...11...','...11...','...11...','...11...','...11...','...11...'],
  'R': ['1111111.','11111111','111..111','111..111','111..111','1111111.','1111111.','111.11..','111..11.','111..11.','111...11','111...11','111...11','111...11'],
  'E': ['11111111','11111111','11......','11......','11......','1111111.','1111111.','11......','11......','11......','11......','11......','11111111','11111111'],
  'O': ['.111111.','11111111','111..111','111..111','111..111','111..111','111..111','111..111','111..111','111..111','111..111','111..111','11111111','.111111.'],
  'W': ['111...11','111...11','111...11','111...11','111...11','111...11','111.1.11','111.1.11','111.1.11','11.111.1','11.111.1','.1.1.1..','.1.1.1..','........'],
  'A': ['.111111.','11111111','111..111','111..111','111..111','11111111','11111111','111..111','111..111','111..111','111..111','111..111','111..111','111..111'],
  'I': ['11111111','11111111','...11...','...11...','...11...','...11...','...11...','...11...','...11...','...11...','...11...','...11...','11111111','11111111'],
  'S': ['.111111.','11111111','111.....','111.....','111.....','.111111.','.1111111','.....111','.....111','.....111','111..111','111..111','11111111','.111111.'],
  'K': ['111..111','111..111','111.111.','111111..','11111...','111111..','111.111.','111..111','111..111','111...11','111...11','111...11','111...11','111...11'],
  ' ': ['........','........','........','........','........','........','........','........','........','........','........','........','........','........'],
};

/** Label / table face. 5 wide x 6 tall — the scale Doom's baked labels used. */
const FONT_SM = {
  A:['.###.','#...#','#...#','#####','#...#','#...#'], B:['####.','#...#','####.','#...#','#...#','####.'],
  C:['.####','#....','#....','#....','#....','.####'], D:['####.','#...#','#...#','#...#','#...#','####.'],
  E:['#####','#....','####.','#....','#....','#####'], F:['#####','#....','####.','#....','#....','#....'],
  G:['.####','#....','#..##','#...#','#...#','.####'], H:['#...#','#...#','#####','#...#','#...#','#...#'],
  I:['.###.','..#..','..#..','..#..','..#..','.###.'], J:['..###','...#.','...#.','...#.','#..#.','.##..'],
  K:['#...#','#..#.','###..','#..#.','#..#.','#...#'], L:['#....','#....','#....','#....','#....','#####'],
  M:['#...#','##.##','#.#.#','#...#','#...#','#...#'], N:['#...#','##..#','#.#.#','#..##','#...#','#...#'],
  O:['.###.','#...#','#...#','#...#','#...#','.###.'], P:['####.','#...#','####.','#....','#....','#....'],
  Q:['.###.','#...#','#...#','#.#.#','#..#.','.##.#'], R:['####.','#...#','####.','#.#..','#..#.','#...#'],
  S:['.####','#....','.###.','....#','....#','####.'], T:['#####','..#..','..#..','..#..','..#..','..#..'],
  U:['#...#','#...#','#...#','#...#','#...#','.###.'], V:['#...#','#...#','#...#','#...#','.#.#.','..#..'],
  W:['#...#','#...#','#...#','#.#.#','##.##','#...#'], X:['#...#','.#.#.','..#..','..#..','.#.#.','#...#'],
  Y:['#...#','.#.#.','..#..','..#..','..#..','..#..'], Z:['#####','...#.','..#..','.#...','#....','#####'],
  '0':['.###.','#..##','#.#.#','##..#','#...#','.###.'], '1':['..#..','.##..','..#..','..#..','..#..','.###.'],
  '2':['.###.','#...#','...#.','..#..','.#...','#####'], '3':['####.','....#','.###.','....#','....#','####.'],
  '4':['#..#.','#..#.','#####','...#.','...#.','...#.'], '5':['#####','#....','####.','....#','#...#','.###.'],
  '6':['.###.','#....','####.','#...#','#...#','.###.'], '7':['#####','....#','...#.','..#..','.#...','.#...'],
  '8':['.###.','#...#','.###.','#...#','#...#','.###.'], '9':['.###.','#...#','.####','....#','....#','.###.'],
  '%':['##..#','##.#.','..#..','.#.##','#..##','.....'], '/':['....#','...#.','..#..','.#...','#....','.....'],
  '.':['.....','.....','.....','.....','.....','..#..'], '-':['.....','.....','.....','#####','.....','.....'],
  '·':['.....','.....','..#..','.....','.....','.....'], '~':['.....','.....','.##.#','#..#.','.....','.....'],
  ':':['.....','..#..','.....','.....','..#..','.....'], ' ':['.....','.....','.....','.....','.....','.....'],
};

const ADV_BIG = 9;    // 8px glyph + 1px gap
const ADV_SM = 6;     // 5px glyph + 1px gap
const TABLE_PITCH = 7; // 6px glyph + 1px gap — see drawPlate for why not 6

// ---------------------------------------------------------------- palette

const C = {
  // plate striation, 8 tones at 1px pitch — warm-biased neutral grey
  striae: ['#767674','#6d6d6b','#727270','#666664','#7a7a78','#6a6a68','#747472','#626260'],
  grainHi: '#7e7e7c', grainLo: '#61615f',
  bevelHi: '#a2a29f', bevelHiSide: '#9a9a97',
  bevelLo: '#2f2f2e', bevelLoSide: '#3a3a39',
  wellDark: '#171716', wellLight: '#8e8e8b',
  wellFloor: '#242423', panelFloor: '#2b2b2a', markFloor: '#232323',
  grooveDark: '#1c1c1b', grooveLight: '#8e8e8b',
  numHi: '#f01a12', numMid: '#d40b06', numLo: '#a80603', numShadow: '#3a0402',
  tan: '#c8bb9c', tanDim: '#8f8672', value: '#e8dcbc',
  cardBlue: '#3a6fd8', cardGold: '#e0c020', cardRed: '#c02a22',
  cardOff: '#4a4a48', cardLipOn: '#ffffff', cardLipOff: '#5e5e5c', cardShadow: '#1c1c1b',
  rule: '#4e4e4c', mark: '#e08a63', markDim: '#b4553a',
};

function hex(s) {
  return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
}

// ---------------------------------------------------------------- surface

/** Uint8Array, not Buffer — this module must run in the browser too. */
function Surface(w, h) {
  return { w, h, data: new Uint8Array(w * h * 4) };
}

function px(s, x, y, w, h, col) {
  const [r, g, b] = typeof col === 'string' ? hex(col) : col;
  x |= 0; y |= 0; w |= 0; h |= 0;
  for (let j = y; j < y + h; j++) {
    if (j < 0 || j >= s.h) continue;
    for (let i = x; i < x + w; i++) {
      if (i < 0 || i >= s.w) continue;
      const d = (j * s.w + i) * 4;
      s.data[d] = r; s.data[d + 1] = g; s.data[d + 2] = b; s.data[d + 3] = 255;
    }
  }
}

/** Raised plate: horizontal striations + fine grain + a hard bevel pair. */
function striate(s, x, y, w, h, beveled) {
  for (let i = 0; i < h; i++) {
    px(s, x, y + i, w, 1, C.striae[(i * 5 + x * 3) % C.striae.length]);
    for (let j = i % 3; j < w; j += 7) {
      px(s, x + j, y + i, 1, 1, (i + j) % 2 ? C.grainHi : C.grainLo);
    }
  }
  if (beveled) {
    px(s, x, y, w, 1, C.bevelHi);
    px(s, x, y, 1, h, C.bevelHiSide);
    px(s, x, y + h - 1, w, 1, C.bevelLo);
    px(s, x + w - 1, y, 1, h, C.bevelLoSide);
  }
}

/** Recess: inverted bevel, dark grey floor (never black — Doom's wasn't). */
function well(s, x, y, w, h, floor) {
  px(s, x, y, w, h, floor || C.wellFloor);
  px(s, x, y, w, 1, C.wellDark);
  px(s, x, y, 1, h, C.wellDark);
  px(s, x, y + h - 1, w, 1, C.wellLight);
  px(s, x + w - 1, y, 1, h, C.wellLight);
}

/** The milled divider the plate uses between cells. */
function groove(s, x, y, h) {
  px(s, x, y, 1, h, C.grooveDark);
  px(s, x + 1, y, 1, h, C.grooveLight);
}

function glyph(s, font, x, y, ch, col, shadow) {
  const rows = font[ch] || font[' '];
  if (!rows) return;
  const gw = rows[0].length;
  if (shadow) {
    for (let r = 0; r < rows.length; r++)
      for (let c = 0; c < gw; c++)
        if (rows[r][c] !== '.') px(s, x + c + 1, y + r + 1, 1, 1, shadow);
  }
  for (let r = 0; r < rows.length; r++) {
    // STTNUM digits are brighter across the top third
    const tone = col === null ? (r < 5 ? C.numHi : r < 10 ? C.numMid : C.numLo) : col;
    for (let c = 0; c < gw; c++) {
      if (rows[r][c] !== '.') px(s, x + c, y + r, 1, 1, tone);
    }
  }
}

/** Red display numerals. `align:'right'` matches Doom's own alignment. */
function bigText(s, x, y, str, align) {
  const total = str.length * ADV_BIG - 1;
  const sx = align === 'right' ? x - total : x;
  for (let i = 0; i < str.length; i++) glyph(s, FONT_BIG, sx + i * ADV_BIG, y, str[i], null, C.numShadow);
  return total;
}

function smText(s, x, y, str, col, align) {
  const total = str.length * ADV_SM - 1;
  const sx = align === 'right' ? x - total : x;
  for (let i = 0; i < str.length; i++) glyph(s, FONT_SM, sx + i * ADV_SM, y, str[i].toUpperCase(), col, null);
  return total;
}

/** Agent mark, drawn to fill the 24x29 well the mugshot occupied. */
const MARKS = {
  claude(s, cx, cy, col) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      for (let r = 2; r <= 9; r++) {
        const wgt = r < 7 ? 2 : 1;
        px(s, Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.92),
           wgt, wgt, r < 7 ? col : C.markDim);
      }
    }
    px(s, cx - 1, cy - 1, 3, 3, col);
  },
  gemini(s, cx, cy, col) {
    for (let d = 0; d <= 10; d++) {
      const wgt = Math.max(1, Math.round((10 - d) / 2.4));
      px(s, cx - (wgt >> 1), cy - d, wgt, 1, col);
      px(s, cx - (wgt >> 1), cy + d, wgt, 1, col);
      px(s, cx - d, cy - (wgt >> 1), 1, wgt, col);
      px(s, cx + d, cy - (wgt >> 1), 1, wgt, col);
    }
  },
};

// ---------------------------------------------------------------- the plate

/** Default state. Every field is what the plate reads from the app. */
const DEFAULT_STATE = {
  context: '61%',                       // context window filled
  usage: '34%',                         // rate limit consumed
  sandbox: 'FULL',                      // FULL | TREE | OFF — never a percentage
  agent: 'claude',
  agentName: 'CLAUDE CODE · OPUS 5',
  path: '~/PROJECTS/DOOM TERM',
  branch: 'FEATURE/WEBGL-COMPOSITOR',
  credentials: [true, true, false],     // ssh, cloud, signing
  table: [['IN', '14', '128'], ['OUT', '3', '32'], ['CAC', '88', '200'], ['TOT', '105', '360']],
};

/** Column geometry for the 480-wide widescreen plate. */
const PLATE_480 = {
  width: 480, height: 32,
  contextX: 44, usageX: 90,             // native Doom offsets, left group
  panelX: 104, panelW: 226,             // reclaims the dropped ARMS slot
  markX: 107, markW: 24,
  grooveX: 136,
  labelX: 141,                          // label column, 6 chars
  valueX: 182, valueChars: 24,          // value column, 24 chars
  sandboxX: 381,                        // = 480 - (320 - 221), native right offset
  cardsX: 399,                          // = 480 - (320 - 239)
  tableLabelX: 411, tableCurX: 451, tableLimX: 477, tableRuleX: 455,
};

function drawPlate(s, spec, state) {
  const st = Object.assign({}, DEFAULT_STATE, state || {});
  striate(s, 0, 0, spec.width, spec.height, true);

  // LEFT — two percentages, of two things you can actually run out of
  bigText(s, spec.contextX, 3, st.context, 'right');
  smText(s, spec.contextX, 21, 'CONTEXT', C.tan, 'right');
  bigText(s, spec.usageX, 3, st.usage, 'right');
  smText(s, spec.usageX, 21, 'USAGE', C.tan, 'right');

  // CENTRE — fixed label column, wide value column
  well(s, spec.panelX, 1, spec.panelW, 30, C.panelFloor);
  well(s, spec.markX, 4, spec.markW, 24, C.markFloor);
  (MARKS[st.agent] || MARKS.claude)(s, spec.markX + 12, 16, C.mark);
  groove(s, spec.grooveX, 4, 24);
  const rows = [['AGENT', st.agentName], ['PATH', st.path], ['BRANCH', st.branch]];
  rows.forEach(([k, v], i) => {
    const y = 5 + i * 8;
    smText(s, spec.labelX, y, k, C.tanDim);
    smText(s, spec.valueX, y, truncateLeft(v, spec.valueChars), C.value);
  });

  // RIGHT — a tier name. Isolation was never a percentage.
  bigText(s, spec.sandboxX, 3, st.sandbox, 'right');
  smText(s, spec.sandboxX, 21, 'SANDBOX', C.tan, 'right');

  const cardCols = [C.cardBlue, C.cardGold, C.cardRed];
  st.credentials.forEach((on, i) => {
    const y = 3 + i * 10;
    px(s, spec.cardsX, y, 8, 5, on ? cardCols[i] : C.cardOff);
    px(s, spec.cardsX, y, 8, 1, on ? C.cardLipOn : C.cardLipOff);
    px(s, spec.cardsX, y + 4, 8, 1, C.cardShadow);
  });

  // Doom's table sat on a 6px pitch because its table font was 5 tall.
  // Ours is 6 tall, so the pitch has to be 7 or adjacent rows touch.
  // Everything here sits ON plate, so nothing dimmer than C.tan is legible
  // against #6f6f6d — the dim tone is reserved for text on a dark recess.
  st.table.forEach((row, i) => {
    const y = 4 + i * TABLE_PITCH;
    smText(s, spec.tableLabelX, y, row[0], C.tan);
    smText(s, spec.tableCurX, y, row[1], C.value, 'right');
    smText(s, spec.tableLimX, y, row[2], C.tan, 'right');
  });
  px(s, spec.tableRuleX, 4, 1, 27, C.rule);
}

/**
 * Truncate from the LEFT so the leaf survives: a branch is identified by
 * its tail, not its prefix.
 */
function truncateLeft(str, max) {
  if (str.length <= max) return str;
  return '··' + str.slice(str.length - (max - 2));
}

/** Nearest-neighbour integer upscale. Never call with a fractional scale. */
function upscale(s, scale) {
  if (!Number.isInteger(scale) || scale < 1) {
    throw new Error(`scale must be a positive integer, got ${scale}`);
  }
  if (scale === 1) return s;
  const out = Surface(s.w * scale, s.h * scale);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const src = (y * s.w + x) * 4;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const d = ((y * scale + dy) * out.w + x * scale + dx) * 4;
          out.data.set(s.data.subarray(src, src + 4), d);
        }
      }
    }
  }
  return out;
}

function renderPlate(state, scale, spec) {
  const sp = spec || PLATE_480;
  const s = Surface(sp.width, sp.height);
  drawPlate(s, sp, state);
  return upscale(s, scale || 1);
}

export {
  renderPlate, drawPlate, upscale, Surface, px, striate, well, groove,
  bigText, smText, truncateLeft, FONT_BIG, FONT_SM, MARKS,
  PLATE_480, DEFAULT_STATE, C as COLORS, ADV_BIG, ADV_SM, TABLE_PITCH,
};
