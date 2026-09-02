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

/** Bracket multiline text so a shell or agent sees one paste operation. */
export function bracketPaste(text: string): string {
  return text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text;
}
