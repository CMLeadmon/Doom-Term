/**
 * Is a session's agent actually working, as opposed to merely alive?
 *
 * The agent mark pulses on this answer, so it has to be observed rather than
 * declared, and it has to be able to say NO — an indicator that never stops
 * moving reports nothing.
 *
 * ── WHY RECENCY ALONE IS NOT ENOUGH ────────────────────────────────────────
 *
 * The obvious test is "did output arrive in the last N ms". Measured against a
 * real Antigravity session parked at its prompt, that flags busy forever: agy
 * repaints its own footer on a timer, so output lands in a short burst roughly
 * every 1.3–2 s and the flag oscillates true/false about twice a second. Claude
 * Code and Codex do the same thing with their spinners. Every one of those
 * repaints is real output; none of them is work.
 *
 * What separates them is CONTINUITY, not recency. A footer repaint is one burst
 * with a long gap after it. Generation streams into essentially every window.
 * So the test is how many recent time buckets saw any output at all, and an
 * idle heartbeat cannot reach the threshold no matter how often it fires,
 * because it is one burst rather than many.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT CLAIM ──────────────────────────────────
 *
 * An agent that has gone silent waiting on its provider is reported as not
 * working, because from a terminal that is indistinguishable from an agent that
 * has finished. Guessing otherwise would be inventing state, and the mark going
 * still is the honest answer to "the terminal cannot see anything happening".
 *
 * Mutable and non-serialisable, so it lives outside React state for the same
 * reason the emulators do — and so a PTY chunk does not write to storage.
 */

/** Bucket width. Narrow enough that a burst cannot span many of them. */
export const BUCKET_MS = 200;
/** How far back the test looks. Five buckets. */
export const WINDOW_MS = 1000;
/**
 * Buckets that must have seen output. Measured: an idle agy footer repaint
 * covers one bucket, occasionally two as a burst straddles a boundary; active
 * generation covers four or five. Three is the gap between them.
 */
export const BUSY_BUCKETS = 3;

const BUCKETS = Math.round(WINDOW_MS / BUCKET_MS);

/** Bucket indices that saw output, per session. Bounded by construction. */
const activity = new Map<string, Set<number>>();

const bucketOf = (t: number) => Math.floor(t / BUCKET_MS);

/** Record that this session's PTY emitted something. */
export function noteOutput(sessionId: string, now: number = Date.now()): void {
  const b = bucketOf(now);
  let seen = activity.get(sessionId);
  if (!seen) {
    seen = new Set();
    activity.set(sessionId, seen);
  }
  seen.add(b);
  lastOutput.set(sessionId, now);
  // Drop anything that has fallen out of the window, so the set stays small
  // whether or not anyone ever asks about this session again.
  for (const old of seen) {
    if (old <= b - BUCKETS) seen.delete(old);
  }
}

/** Has output been arriving continuously enough to call this work? */
export function isWorking(sessionId: string, now: number = Date.now()): boolean {
  const seen = activity.get(sessionId);
  if (!seen) return false;
  const b = bucketOf(now);
  let live = 0;
  for (const bucket of seen) {
    if (bucket > b - BUCKETS && bucket <= b) live++;
  }
  return live >= BUSY_BUCKETS;
}

/** Forget a session — called when its node is closed. */
export function disposeActivity(sessionId: string): void {
  activity.delete(sessionId);
  lastOutput.delete(sessionId);
}

/** Test hook. */
export function resetActivity(): void {
  activity.clear();
  lastOutput.clear();
}

/** When each session last emitted. Same store, same reason, same lifetime. */
const lastOutput = new Map<string, number>();

/**
 * When this session last emitted anything, or undefined if it never has.
 *
 * Undefined is meaningful and is NOT the same as "a long time ago": a session
 * that has never emitted has not started, and a terminal that has not started
 * has not stopped either. The waiting list leans on that distinction to keep
 * every freshly opened terminal out of itself.
 */
export function lastOutputAt(sessionId: string): number | undefined {
  return lastOutput.get(sessionId);
}
