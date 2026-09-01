/** The addressable range. Ctrl+0 is not a slot — there is no session zero. */
export const MAX_SESSION_NUMBER = 9;

/**
 * The lowest free slot, or null when all nine are taken.
 *
 * LOWEST-free rather than next-highest, so closing session 2 and opening
 * another gives you 2 again. The number is the entire addressing scheme now
 * that the tab strip is gone, which means it has to be PREDICTABLE rather than
 * merely unique — Ctrl+2 should mean the same thing tomorrow morning as it did
 * last night, and a monotonic counter would quietly stop being reachable at
 * all once it passed nine.
 *
 * Null is honest rather than a fallback: a tenth session exists and works, it
 * simply has no key of its own, and is reached from the waiting rows instead.
 */
export function nextSessionNumber(taken: number[]): number | null {
  const used = new Set(taken);
  for (let n = 1; n <= MAX_SESSION_NUMBER; n++) {
    if (!used.has(n)) return n;
  }
  return null;
}
