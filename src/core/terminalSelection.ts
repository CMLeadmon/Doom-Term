import type { AnsiLine } from '../types/terminal';

export interface LineRegion {
  start: number;
  end: number;
}

/**
 * Expand a clicked row to the surrounding trusted turn boundaries.
 *
 * Boundaries come from the same conservative marks drawn in the gutter. When
 * no preceding mark exists we select only the clicked line: inventing a shell
 * command boundary is worse than making the operator drag once.
 */
export function commandRegion(
  lines: AnsiLine[],
  clickedLine: number,
  boundaries: ReadonlySet<number>,
): LineRegion {
  const clicked = Math.max(0, Math.min(clickedLine, Math.max(0, lines.length - 1)));
  const ordered = [...boundaries]
    .filter((line) => line >= 0 && line < lines.length)
    .sort((a, b) => a - b);
  const start = ordered.filter((line) => line <= clicked).at(-1);
  if (start === undefined) return { start: clicked, end: clicked };
  const next = ordered.find((line) => line > start);
  return { start, end: next === undefined ? lines.length - 1 : next - 1 };
}

/** Bound the original input before allocating normalized or framed copies. */
export function assertClipboardSize(text: string): void {
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0)!;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (bytes > 1024 * 1024) throw new Error('Paste exceeds the 1 MiB limit; nothing was sent.');
  }
}

/** Defensive outer-mode check only. The daemon owns child admission/framing. */
export function prepareClipboardText(text: string, bracketedMode: boolean): string | null {
  assertClipboardSize(text);
  const clean = text.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  if (!clean) return '';
  if (!bracketedMode && clean.includes('\n')) return null;
  return clean;
}
