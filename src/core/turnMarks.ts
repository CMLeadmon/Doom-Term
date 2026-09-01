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
