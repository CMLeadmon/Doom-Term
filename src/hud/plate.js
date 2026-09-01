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
  // An unknown value renders '--'. Without this glyph the slot draws blank,
  // which reads as "nothing here" rather than "not measured".
  '-': ['........','........','........','........','........','11111111','11111111','........','........','........','........','........','........','........'],
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
  // State, matching src/styles/material.css. One colour, one meaning.
  stLive: '#e0a92c', stFail: '#ef4136',
};

/**
 * One colour per agent, because the well draws that vendor's mark.
 *
 * Every mark used to be painted in C.mark — Anthropic's copper — so Gemini's
 * star and Antigravity's prism came out in Claude's colour. The key comes from
 * the kernel (foreground.rs classify_agent), so an entry here is a real product,
 * and an agent with no entry falls back to the plate's own tan rather than
 * borrowing whichever colour happened to be first.
 *
 * These are stand-in colours matched to each vendor's own mark, at the fidelity
 * a 24x29 well allows. Replace with vendor assets when they exist.
 */
const AGENT_COLORS = {
  claude: '#e08a63',
  codex: '#e6e6e6',
  gemini: '#8ab6ff',
  antigravity: '#d8ecff',
  aider: '#d8b45f',
  opencode: '#8fd4a0',
  grok: '#e6e6e6',
  copilot: '#c8b4ff',
  // Not a vendor. A shell gets the plate's own tan.
  shell: '#c8bb9c',
};

function hex(s) {
  return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
}

/** Blend towards `to` by `t`. Returns [r,g,b], which px() accepts directly. */
function mix(from, to, t) {
  const a = typeof from === 'string' ? hex(from) : from;
  const b = typeof to === 'string' ? hex(to) : to;
  const k = Math.min(1, Math.max(0, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];

/**
 * The mark's colour ladder for one animation phase.
 *
 * A 24x29 well has no room for opacity or blur, so the glow is a quantised
 * colour ramp — which is how Doom animated its own light levels. `pulse` is the
 * phase 0..1 of one cycle; `undefined` means the agent is not working and the
 * mark sits at its steady base colour with no ring.
 */
function markTones(agentKey, pulse) {
  const base = AGENT_COLORS[agentKey] || C.tan;
  if (pulse === undefined) {
    return { core: hex(base), dim: mix(base, BLACK, 0.45), ring: null };
  }
  // Raised cosine: a swell and a fall, not a blink. Peaks at phase 0.5.
  const glow = (1 - Math.cos(pulse * Math.PI * 2)) / 2;
  return {
    // Steps up towards white-hot at the peak, down towards its own shadow at
    // the trough, so the mark reads as metal glowing rather than a flashing LED.
    core: glow > 0.5 ? mix(base, WHITE, (glow - 0.5) * 1.1) : mix(base, BLACK, (0.5 - glow) * 0.7),
    dim: mix(base, BLACK, 0.5 - glow * 0.25),
    ring: { phase: pulse, base },
  };
}

/**
 * The shock ring: a 1px circle leaving the mark once per cycle, dimming as it
 * grows and dying against the well wall. This is the part that reads as
 * "working" at a glance — the colour ramp alone is too subtle at 1x scale.
 *
 * `clip` is the well interior, because px() clips to the surface, not the recess.
 */
function shockRing(s, cx, cy, phase, base, clip) {
  const r = 3 + phase * 10;
  // Fades out over the travel so the ring dissolves instead of hitting the wall.
  const fade = 1 - phase;
  if (fade <= 0.02) return;
  const col = mix(clip.floor, base, fade * 0.85);
  const steps = Math.max(12, Math.round(r * 6));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    // Same 0.92 vertical squash the marks use, so the ring stays concentric
    // with them on the plate's non-square pixel budget.
    const x = Math.round(cx + Math.cos(a) * r);
    const y = Math.round(cy + Math.sin(a) * r * 0.92);
    if (x < clip.x || x >= clip.x + clip.w || y < clip.y || y >= clip.y + clip.h) continue;
    px(s, x, y, 1, 1, col);
  }
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

/**
 * Agent mark, drawn to fill the 24x29 well the mugshot occupied.
 *
 * Every mark takes (surface, cx, cy, col, dim). `dim` is the accent tone and is
 * derived from `col` by the caller — it used to be the fixed C.markDim, which
 * put copper accents on every vendor's mark regardless of whose it was.
 */
const MARKS = {
  claude(s, cx, cy, col, dim) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      for (let r = 2; r <= 9; r++) {
        const wgt = r < 7 ? 2 : 1;
        px(s, Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.92),
           wgt, wgt, r < 7 ? col : dim);
      }
    }
    px(s, cx - 1, cy - 1, 3, 3, col);
  },
  /**
   * Antigravity: a rising prism of stacked chevrons, lightest at the top.
   * It had no mark of its own and drew Gemini's star — a different product.
   */
  antigravity(s, cx, cy, col, dim) {
    const tones = [col, mix(col, dim, 0.45), dim];
    for (let i = 0; i < 3; i++) {
      const top = cy - 9 + i * 7;
      const wdt = 4 + i * 3;
      for (let row = 0; row < 5; row++) {
        const span = Math.max(1, wdt - row);
        px(s, cx - span, top + row, span * 2, 1, tones[i]);
      }
    }
  },
  /** aider: an inward caret pair — a patch closing on a line. */
  aider(s, cx, cy, col, dim) {
    for (let i = 0; i < 5; i++) {
      px(s, cx - 8 + i, cy - 5 + i, 2, 2, col);
      px(s, cx - 8 + i, cy + 5 - i, 2, 2, col);
      px(s, cx + 7 - i, cy - 5 + i, 2, 2, col);
      px(s, cx + 7 - i, cy + 5 - i, 2, 2, col);
    }
    px(s, cx - 1, cy - 1, 3, 3, dim);
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
  codex(s, cx, cy, col) {
    px(s, cx - 7, cy - 7, 14, 2, col);
    px(s, cx - 7, cy + 5, 14, 2, col);
    px(s, cx - 7, cy - 7, 2, 14, col);
    px(s, cx + 5, cy - 7, 2, 14, col);
    px(s, cx - 2, cy - 3, 2, 6, col);
    px(s, cx, cy - 1, 2, 2, col);
  },
  opencode(s, cx, cy, col) {
    // Crisp curly code braces
    px(s, cx - 6, cy - 6, 4, 1, col);
    px(s, cx - 6, cy - 5, 2, 4, col);
    px(s, cx - 8, cy - 1, 2, 2, col);
    px(s, cx - 6, cy + 1, 2, 4, col);
    px(s, cx - 6, cy + 5, 4, 1, col);

    px(s, cx + 2, cy - 6, 4, 1, col);
    px(s, cx + 4, cy - 5, 2, 4, col);
    px(s, cx + 6, cy - 1, 2, 2, col);
    px(s, cx + 4, cy + 1, 2, 4, col);
    px(s, cx + 2, cy + 5, 4, 1, col);
  },
  copilot(s, cx, cy, col, dim) {
    // Winged visor mark
    for (let i = 0; i < 7; i++) {
      px(s, cx - i - 1, cy + i - 3, 2, 2, col);
      px(s, cx + i, cy + i - 3, 2, 2, col);
    }
    px(s, cx - 4, cy - 1, 8, 2, dim);
  },
  grok(s, cx, cy, col, dim) {
    // Crisp xAI Grok cross mark
    for (let i = -5; i <= 5; i++) {
      px(s, cx + i - 1, cy + i, 2, 2, col);
      px(s, cx - i - 1, cy + i, 2, 2, col);
    }
    px(s, cx - 2, cy - 2, 4, 4, dim);
  },
  shell(s, cx, cy, col, dim) {
    // A prompt chevron and its caret. The well says what is running in the
    // terminal; with no agent attached, the honest answer is "a shell".
    for (let i = 0; i < 5; i++) {
      px(s, cx - 7 + i, cy - 5 + i, 2, 2, col);
      px(s, cx - 7 + i, cy + 5 - i, 2, 2, col);
    }
    px(s, cx + 1, cy + 5, 7, 2, dim);
  },
};
MARKS.terminal = MARKS.shell;
MARKS.bash = MARKS.shell;
MARKS.zsh = MARKS.shell;
MARKS.fish = MARKS.shell;
MARKS.none = MARKS.shell;
// agy is the binary, antigravity the product. Both draw the prism, and neither
// draws Claude's burst any more.
MARKS.agy = MARKS.antigravity;

// ---------------------------------------------------------------- the plate

/**
 * What the plate falls back to for any field the app does not supply.
 * drawPlate merges this UNDER every real state, so every value here has to be
 * one the app would be willing to show as fact. It claims nothing.
 */
const DEFAULT_STATE = {
  context: '--',                        // context window filled — unknowable
  usage: '--',                          // rate limit consumed — unknowable
  sandbox: 'OFF',                       // FULL | TREE | OFF — never a percentage
  agent: 'shell',
  agentName: '',
  // Phase 0..1 of the working animation. undefined = halted, drawn still.
  pulse: undefined,
  path: '~',
  branch: '',
  credentials: [false, false, false],   // ssh, cloud, signing
  table: [],
  waiting: [],                          // sessions that have stopped — never invented
};

/**
 * Presentation values for the committed reference PNG and the design docs.
 * Only tools/hud/cli.js renders from this; it must never reach the app, which
 * is why it is a separate constant rather than a populated DEFAULT_STATE.
 */
const DEMO_STATE = {
  context: '61%',
  usage: '34%',
  sandbox: 'FULL',
  agent: 'claude',
  agentName: 'CLAUDE CODE · OPUS 5',
  path: '~/PROJECTS/DOOM TERM',
  branch: 'FEATURE/WEBGL-COMPOSITOR',
  credentials: [true, true, false],
  table: [['IN', '14', '128'], ['OUT', '3', '32'], ['CAC', '88', '200'], ['TOT', '105', '360']],
};

/**
 * Column geometry for a plate of any width.
 *
 * Doom measured its offsets from BOTH edges of the 320-wide bar, so they
 * survive the stretch: the left group is pinned to 0 and the right group to W.
 * The CENTRE is the only elastic member — context, usage, sandbox and tokens
 * are true in every mode and must never move.
 *
 * plateSpec(480) must deep-equal the geometry this file shipped with. That is
 * the property that keeps the full-width plate a generalisation of Doom's own
 * measurements rather than a redraw of them; src/hud/spec.test.js locks it.
 */
function plateSpec(W) {
  return {
    width: W, height: 32,
    contextX: 44, usageX: 90,             // native Doom offsets, left group
    panelX: 104, panelW: 226,             // reclaims the dropped ARMS slot
    markX: 107, markW: 24,
    grooveX: 136,
    labelX: 141,                          // label column, 6 chars
    valueX: 182, valueChars: 24,          // value column, 24 chars
    sandboxX: W - 99,                     // native right offset, 320 - 221
    cardsX: W - 81,                       // 320 - 239
    tableLabelX: W - 69, tableCurX: W - 29, tableLimX: W - 3, tableRuleX: W - 25,
    // The elastic centre: everything between the panel and the right group.
    // Zero on a 480 plate, which is why the reference render is unaffected.
    zoneX: 334,
    zoneW: Math.max(0, (W - 146) - 334),
  };
}

const PLATE_480 = plateSpec(480);

/** How many rows the 30px well holds on the panel's own 8px pitch. */
const WAITING_ROWS = 3;
/** Under this the zone cannot hold a name honestly, so the count stands alone. */
const WAITING_ROWS_MIN_W = 110;
/** Under this there is no room for the column at all. */
const WAITING_MIN_W = 60;

/**
 * The sessions that have stopped and want you — and nothing else.
 *
 * A running agent needs nothing from you, so it gets no pixels. The count is
 * set exactly as CONTEXT and USAGE are, because it is a quantity you can run
 * out of patience with; red here is the display-numeral colour, not an alarm.
 *
 * Every row takes whatever the window left over and is truncated to fit. The
 * column must never draw outside spec.zoneX..zoneX+zoneW — SANDBOX and the
 * token table are immediately to its right, and a long session name is the
 * obvious way to land on top of them. src/hud/waiting.test.js proves it does
 * not, at several widths and with deliberately hostile input.
 */
function drawWaiting(s, spec, waiting) {
  const w = spec.zoneW;
  if (w < WAITING_MIN_W) return;
  const x0 = spec.zoneX, x1 = x0 + w - 1;

  // An empty list is a STATE, not an absence: the well is cut whether or not
  // anything is in it, and reading it empty is the most useful glance there is.
  well(s, x0, 1, w, 30, C.panelFloor);
  smText(s, x0 + 4, 4, 'WAITING', C.tanDim);
  bigText(s, x0 + 45, 13, String(Math.min(99, waiting.length)), 'right');

  if (w < WAITING_ROWS_MIN_W) return;
  groove(s, x0 + 52, 4, 24);

  const rowX = x0 + 58;
  waiting.slice(0, WAITING_ROWS).forEach((row, i) => {
    const y = 5 + i * 8;
    const tail = String(row.tail ?? '');
    // Whatever is left after the number, the gap, and the right-aligned tail.
    const room = Math.floor((x1 - 4 - tail.length * ADV_SM - 8 - (rowX + 10)) / ADV_SM);
    if (room < 3) return;
    smText(s, rowX, y, row.n, C.tanDim);
    smText(s, rowX + 10, y, String(row.name).slice(0, room), C.value);
    smText(s, x1 - 4, y, tail, row.failed ? C.stFail : C.stLive, 'right');
  });
}

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

  // The agent well. `pulse` is a phase 0..1 while the agent is working and
  // undefined when it has halted, so a still plate is a stopped agent — the
  // indicator has to mean something when it is NOT moving too.
  const tones = markTones(st.agent, st.pulse);
  // At the peak the floor lifts one step, so the recess reads as lit from
  // within rather than the mark merely changing colour.
  const lift = st.pulse === undefined ? 0 : (1 - Math.cos(st.pulse * Math.PI * 2)) / 2;
  const floor = lift > 0 ? mix(C.markFloor, tones.core, lift * 0.12) : C.markFloor;
  well(s, spec.markX, 4, spec.markW, 24, floor);
  if (tones.ring) {
    shockRing(s, spec.markX + 12, 16, tones.ring.phase, tones.ring.base, {
      x: spec.markX + 1, y: 5, w: spec.markW - 2, h: 22, floor,
    });
  }
  // An unrecognised key is not an excuse to draw someone else's logo.
  (MARKS[st.agent] || MARKS.shell)(s, spec.markX + 12, 16, tones.core, tones.dim);
  groove(s, spec.grooveX, 4, 24);
  const SHELL_KEYS = ['shell', 'terminal', 'bash', 'zsh', 'fish', 'none'];
  const agentLabel = SHELL_KEYS.includes(st.agent) ? 'SHELL' : 'AGENT';
  const rows = [[agentLabel, st.agentName], ['PATH', st.path], ['BRANCH', st.branch]];
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

  // CENTRE-RIGHT — the only elastic member. On a 480 plate zoneW is 0 and this
  // is a no-op, which is why the committed reference render is unaffected.
  drawWaiting(s, spec, st.waiting);
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
  bigText, smText, truncateLeft, FONT_BIG, FONT_SM, MARKS, markTones, mix,
  plateSpec, PLATE_480, DEFAULT_STATE, DEMO_STATE, C as COLORS, AGENT_COLORS,
  ADV_BIG, ADV_SM, TABLE_PITCH,
};
