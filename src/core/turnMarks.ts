import type { AnsiLine } from '../types/terminal';

/**
 * Where each agent's turn begins.
 *
 * This is the block view's rail, reduced to what it was actually for. We cut
 * blocks because their chrome — the card, the header, the four hover-only
 * buttons — cost far more than it earned. The one thing they genuinely gave
 * you was A PLACE TO STOP when reading back, and that survives as four pixels
 * in the gutter.
 *
 * Anchored to the start of the line on purpose. A diff line containing "> " is
 * not the start of a turn, and an unanchored match finds several per screen.
 *
 * An agent with no entry gets no marks, which is the honest outcome: a gutter
 * mark in the wrong place is worse than no mark at all, because it is a
 * boundary you will navigate to and find nothing at. Populate from
 * docs/superpowers/specs/2026-08-31-agent-question-detection.md as each agent's
 * prompt shape is confirmed.
 */
const TURN_START: Record<string, RegExp> = {
  claude: /^>\s/,
  codex: /^>\s/,
  antigravity: /^>\s/,
};
// agy is the binary, antigravity the product — same prompt, same marks.
TURN_START.agy = TURN_START.antigravity;

export function turnStarts(lines: AnsiLine[], agent: string | null): Set<number> {
  const pattern = agent ? TURN_START[agent] : undefined;
  if (!pattern) return new Set();
  const out = new Set<number>();
  lines.forEach((line, i) => {
    // Joined first: a line is coloured in pieces and the marker can be its own
    // span, so testing span-by-span would miss the common case.
    if (pattern.test(line.spans.map((s) => s.text).join(''))) out.add(i);
  });
  return out;
}

/** Find the neighbouring trusted turn boundary, wrapping at either end. */
export function stepTurn(
  markLines: ReadonlySet<number>,
  currentLine: number,
  delta: -1 | 1,
): number | null {
  const ordered = [...markLines].sort((a, b) => a - b);
  if (!ordered.length) return null;
  if (delta > 0) return ordered.find((line) => line > currentLine) ?? ordered[0];
  return [...ordered].reverse().find((line) => line < currentLine) ?? ordered.at(-1) ?? null;
}

/** Plain text for the turn containing currentLine, ready for the clipboard. */
export function turnText(
  lines: AnsiLine[],
  markLines: ReadonlySet<number>,
  currentLine: number,
): string {
  const ordered = [...markLines].sort((a, b) => a - b);
  const start = ordered.filter((line) => line <= currentLine).at(-1);
  if (start === undefined) return '';
  const next = ordered.find((line) => line > start) ?? lines.length;
  return lines
    .slice(start, next)
    .map((line) => line.spans.map((span) => span.text).join('').trimEnd())
    .join('\n');
}
