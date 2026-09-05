/**
 * Subsequence matching for the switcher, because that is what is advertised.
 *
 * The palette filtered with a plain case-insensitive `includes`. That is a
 * substring search, and the README called it fuzzy — so "dtsrv" found nothing
 * in "doom-term-server" and the documented way to reach a session did not work.
 * Either the code or the sentence had to change; this is the code.
 *
 * Scoring exists so that ranking survives contact with a large corpus. The
 * search text deliberately includes whole scrollbacks, so almost everything
 * matches a short query somewhere; without a score the operator gets a list in
 * arbitrary order and has to read all of it.
 *
 * Higher is better. `null` means no match at all — distinct from a score of
 * zero, which is a poor match that should still be shown.
 */

/** A contiguous run is worth this much per character beyond the first. */
const RUN_BONUS = 8;
/** A character that starts a word is a much stronger signal than one inside. */
const BOUNDARY_BONUS = 12;
/** Matching from the very start is stronger still. */
const PREFIX_BONUS = 16;
/** Every skipped character costs a little, so early matches win. */
const GAP_PENALTY = 1;

const isBoundary = (haystack: string, at: number): boolean => {
  if (at === 0) return true;
  const previous = haystack[at - 1];
  return previous === ' ' || previous === '/' || previous === '-' ||
    previous === '_' || previous === '.' || previous === '\n' || previous === ':';
};

/**
 * Score `needle` against `haystack`, or null when it is not a subsequence.
 *
 * Greedy left-to-right rather than optimal: an exhaustive search over a corpus
 * that contains entire terminal scrollbacks is not something to run on every
 * keystroke, and the greedy answer is the one a person predicts.
 */
export function fuzzyScore(haystack: string, needle: string): number | null {
  const target = haystack.toLowerCase();
  const query = needle.toLowerCase().trim();
  if (!query) return 0;
  if (!target) return null;

  // A literal substring is not merely a match, it is the best kind. Ranking it
  // explicitly keeps exact typing predictable — the thing subsequence matching
  // is most likely to make feel arbitrary.
  const direct = target.indexOf(query);
  if (direct !== -1) {
    return 1000 + (isBoundary(target, direct) ? BOUNDARY_BONUS : 0) - Math.min(direct, 100);
  }

  let score = 0;
  let at = 0;
  let previousMatch = -2;

  for (const char of query) {
    const found = target.indexOf(char, at);
    if (found === -1) return null;
    if (found === previousMatch + 1) score += RUN_BONUS;
    if (isBoundary(target, found)) score += found === 0 ? PREFIX_BONUS : BOUNDARY_BONUS;
    score -= Math.min(found - at, 20) * GAP_PENALTY;
    previousMatch = found;
    at = found + 1;
  }

  return score;
}

/** Whether `needle` matches at all. */
export function fuzzyMatches(haystack: string, needle: string): boolean {
  return fuzzyScore(haystack, needle) !== null;
}
