/**
 * The Doom palette and the error heuristic.
 *
 * Extracted from terminalEmulator.ts so both screen implementations can share
 * them, and so they survive that file's deletion. The colours are calibrated
 * for WCAG 2.1 AA against --ground; do not adjust one without re-checking it.
 */

// Calibrated WCAG 2.1 AA Doom Palette
export const DOOM_PALETTE = {
  black: '#121212',
  brightBlack: '#808080', // lifted from #555555 (2.51:1) to 4.73:1 on --ground
  red: '#ff4444', // Calibrated Blood Red
  brightRed: '#ff6666',
  green: '#00ff41', // Toxic Slime Green
  brightGreen: '#55ff55', // BFG Emerald
  yellow: '#d49b00', // Doom Gold
  brightYellow: '#ffd700',
  blue: '#3b82f6',
  brightBlue: '#60a5fa',
  magenta: '#d070fb',
  brightMagenta: '#e879f9',
  cyan: '#00e5ff', // Plasma Cyan
  brightCyan: '#67e8f9',
  white: '#f0f0f0', // Phosphor White
  brightWhite: '#ffffff',
};

export const STANDARD_COLORS = [
  DOOM_PALETTE.black,
  DOOM_PALETTE.red,
  DOOM_PALETTE.green,
  DOOM_PALETTE.yellow,
  DOOM_PALETTE.blue,
  DOOM_PALETTE.magenta,
  DOOM_PALETTE.cyan,
  DOOM_PALETTE.white,
];

export const BRIGHT_COLORS = [
  DOOM_PALETTE.brightBlack,
  DOOM_PALETTE.brightRed,
  DOOM_PALETTE.brightGreen,
  DOOM_PALETTE.brightYellow,
  DOOM_PALETTE.brightBlue,
  DOOM_PALETTE.brightMagenta,
  DOOM_PALETTE.brightCyan,
  DOOM_PALETTE.brightWhite,
];

export function parse256Color(index: number): string {
  if (index < 8) return STANDARD_COLORS[index];
  if (index < 16) return BRIGHT_COLORS[index - 8];
  if (index <= 231) {
    const cubeIdx = index - 16;
    const r = Math.floor(cubeIdx / 36);
    const g = Math.floor((cubeIdx % 36) / 6);
    const b = cubeIdx % 6;
    const toVal = (c: number) => (c === 0 ? 0 : 55 + c * 40);
    return `rgb(${toVal(r)}, ${toVal(g)}, ${toVal(b)})`;
  }
  if (index <= 255) {
    const gray = 8 + (index - 232) * 10;
    return `rgb(${gray}, ${gray}, ${gray})`;
  }
  return DOOM_PALETTE.white;
}

/**
 * Lines that genuinely announce a failure. Deliberately anchored: a bare
 * occurrence of the word "error" anywhere in a line is not enough, or every
 * `grep error` hit and every commit message mentioning it would be flagged.
 */
const ERROR_PATTERNS: RegExp[] = [
  /^\s*(?:error|fatal|panic|exception)\b\s*[:[]/i,
  /^\s*(?:npm\s+)?ERR!/,
  /^\s*FAILED?\b/,
  /^\s*Traceback\b/,
  /^\s*[\w./\\-]+:\d+:\d+:\s*(?:error|fatal)\b/i,
  /^\s*panic:/i,
];

export function looksLikeError(text: string): boolean {
  return ERROR_PATTERNS.some((re) => re.test(text));
}
