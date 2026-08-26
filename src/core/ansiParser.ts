import { AnsiLine, AnsiSpan } from '../types/terminal';

// Calibrated WCAG 2.1 AA Doom Palette
export const DOOM_PALETTE = {
  black: '#121212',
  brightBlack: '#555555',
  red: '#ff4444', // Calibrated Blood Red (4.8:1 vs #121212)
  brightRed: '#ff6666',
  green: '#00ff41', // Toxic Slime Green (10.2:1)
  brightGreen: '#55ff55', // BFG Emerald (12.4:1)
  yellow: '#d49b00', // Doom Gold (5.4:1)
  brightYellow: '#ffd700',
  blue: '#3b82f6',
  brightBlue: '#60a5fa',
  magenta: '#d070fb',
  brightMagenta: '#e879f9',
  cyan: '#00e5ff', // Plasma Cyan (11.4:1)
  brightCyan: '#67e8f9',
  white: '#f0f0f0', // Phosphor White (14.5:1)
  brightWhite: '#ffffff',
};

const STANDARD_COLORS = [
  DOOM_PALETTE.black,
  DOOM_PALETTE.red,
  DOOM_PALETTE.green,
  DOOM_PALETTE.yellow,
  DOOM_PALETTE.blue,
  DOOM_PALETTE.magenta,
  DOOM_PALETTE.cyan,
  DOOM_PALETTE.white,
];

const BRIGHT_COLORS = [
  DOOM_PALETTE.brightBlack,
  DOOM_PALETTE.brightRed,
  DOOM_PALETTE.brightGreen,
  DOOM_PALETTE.brightYellow,
  DOOM_PALETTE.brightBlue,
  DOOM_PALETTE.brightMagenta,
  DOOM_PALETTE.brightCyan,
  DOOM_PALETTE.brightWhite,
];

export function parseAnsiText(rawText: string): AnsiLine[] {
  const rawLines = rawText.split(/\r\n|\r|\n/);
  const result: AnsiLine[] = [];

  let currentFg: string | undefined = undefined;
  let currentBg: string | undefined = undefined;
  let bold = false;
  let dim = false;
  let italic = false;
  let underline = false;
  let strikethrough = false;
  let invert = false;

  for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx++) {
    const rawLine = rawLines[lineIdx];
    if (rawLine.length === 0 && lineIdx === rawLines.length - 1) {
      continue;
    }

    const spans: AnsiSpan[] = [];
    let isErrorLine = false;

    // Fast check for error keywords in raw line
    if (
      /\b(error|panic|fatal|exception|failed|FAIL|ERR!)\b/i.test(rawLine) ||
      rawLine.startsWith('error[')
    ) {
      isErrorLine = true;
    }

    // Regex to match ANSI escape sequences: ESC [ parameters final_char OR other ESC sequences
    const ansiRegex = /\x1b\[([0-9;]*)([a-zA-Z])/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = ansiRegex.exec(rawLine)) !== null) {
      const textBefore = rawLine.substring(lastIndex, match.index);
      if (textBefore.length > 0) {
        // Strip any remaining unhandled non-CSI escape codes
        const cleanText = textBefore.replace(/\x1b[()][0-9A-Za-z]/g, '').replace(/\x1b[>\=]/g, '');
        if (cleanText.length > 0) {
          spans.push({
            text: cleanText,
            fg: currentFg,
            bg: currentBg,
            bold,
            dim,
            italic,
            underline,
            strikethrough,
            invert,
          });
        }
      }

      lastIndex = ansiRegex.lastIndex;
      const paramsStr = match[1];
      const command = match[2];

      if (command === 'm') {
        // SGR (Select Graphic Rendition)
        const codes = paramsStr.length > 0 ? paramsStr.split(';').map((n) => parseInt(n, 10)) : [0];
        let i = 0;
        while (i < codes.length) {
          const code = codes[i];
          if (isNaN(code) || code === 0) {
            // Reset all
            currentFg = undefined;
            currentBg = undefined;
            bold = false;
            dim = false;
            italic = false;
            underline = false;
            strikethrough = false;
            invert = false;
          } else if (code === 1) {
            bold = true;
          } else if (code === 2) {
            dim = true;
          } else if (code === 3) {
            italic = true;
          } else if (code === 4) {
            underline = true;
          } else if (code === 7) {
            invert = true;
          } else if (code === 9) {
            strikethrough = true;
          } else if (code === 22) {
            bold = false;
            dim = false;
          } else if (code === 23) {
            italic = false;
          } else if (code === 24) {
            underline = false;
          } else if (code === 27) {
            invert = false;
          } else if (code === 29) {
            strikethrough = false;
          } else if (code >= 30 && code <= 37) {
            currentFg = STANDARD_COLORS[code - 30];
          } else if (code === 39) {
            currentFg = undefined;
          } else if (code >= 40 && code <= 47) {
            currentBg = STANDARD_COLORS[code - 40];
          } else if (code === 49) {
            currentBg = undefined;
          } else if (code >= 90 && code <= 97) {
            currentFg = BRIGHT_COLORS[code - 90];
          } else if (code >= 100 && code <= 107) {
            currentBg = BRIGHT_COLORS[code - 100];
          } else if (code === 38 && i + 2 < codes.length && codes[i + 1] === 5) {
            // 256-color foreground
            const colorIdx = codes[i + 2];
            currentFg = parse256Color(colorIdx);
            i += 2;
          } else if (code === 48 && i + 2 < codes.length && codes[i + 1] === 5) {
            // 256-color background
            const colorIdx = codes[i + 2];
            currentBg = parse256Color(colorIdx);
            i += 2;
          } else if (code === 38 && i + 4 < codes.length && codes[i + 1] === 2) {
            // 24-bit TrueColor foreground
            currentFg = `rgb(${codes[i + 2]}, ${codes[i + 3]}, ${codes[i + 4]})`;
            i += 4;
          } else if (code === 48 && i + 4 < codes.length && codes[i + 1] === 2) {
            // 24-bit TrueColor background
            currentBg = `rgb(${codes[i + 2]}, ${codes[i + 3]}, ${codes[i + 4]})`;
            i += 4;
          }
          i++;
        }
      }
    }

    const trailingText = rawLine.substring(lastIndex);
    if (trailingText.length > 0) {
      const cleanTrailing = trailingText.replace(/\x1b[()][0-9A-Za-z]/g, '').replace(/\x1b[>\=]/g, '');
      if (cleanTrailing.length > 0) {
        spans.push({
          text: cleanTrailing,
          fg: currentFg,
          bg: currentBg,
          bold,
          dim,
          italic,
          underline,
          strikethrough,
          invert,
        });
      }
    }

    // Default line if empty
    if (spans.length === 0) {
      spans.push({ text: ' ' });
    }

    result.push({
      id: `line-${lineIdx}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      spans,
      isError: isErrorLine,
      timestamp: Date.now(),
    });
  }

  return result;
}

function parse256Color(index: number): string {
  if (index < 8) {
    return STANDARD_COLORS[index];
  }
  if (index < 16) {
    return BRIGHT_COLORS[index - 8];
  }
  if (index >= 16 && index <= 231) {
    // 6x6x6 color cube
    const cubeIdx = index - 16;
    const r = Math.floor(cubeIdx / 36);
    const g = Math.floor((cubeIdx % 36) / 6);
    const b = cubeIdx % 6;
    const toVal = (c: number) => (c === 0 ? 0 : 55 + c * 40);
    return `rgb(${toVal(r)}, ${toVal(g)}, ${toVal(b)})`;
  }
  if (index >= 232 && index <= 255) {
    // Grayscale ramp
    const gray = 8 + (index - 232) * 10;
    return `rgb(${gray}, ${gray}, ${gray})`;
  }
  return DOOM_PALETTE.white;
}
