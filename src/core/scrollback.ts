import type { AnsiLine } from '../types/terminal';

/**
 * Reading back through a chromeless terminal.
 *
 * ── WHY THIS DOES NOT USE @xterm/addon-search ──────────────────────────────
 *
 * The obvious move is the vendor addon: it is MIT, the app already runs
 * @xterm/headless, and reusing it would retire code rather than add it. It does
 * not work. `loadAddon` succeeds and `findNext` then throws
 * `this._terminal.getSelectionPosition is not a function` — the addon drives
 * the terminal's SELECTION, which is a renderer concern that headless does not
 * have and is not going to grow. Verified against @xterm/addon-search 0.16.0
 * and @xterm/headless 6.0.0 on 2026-08-31.
 *
 * So the search runs over the AnsiLines the view already renders. That is a
 * smaller surface than it sounds: the lines are already built, already the unit
 * the gutter marks and the viewport address, and it costs no dependency.
 *
 * Mutable module state rather than React state, for the same reason
 * activityMonitor is: this is written on every scroll event and every keystroke
 * of a query, and neither belongs in localStorage.
 */

export interface ScrollbackState {
  detached: boolean;
  /** The line the viewport is showing. Equals `total` while following. */
  line: number;
  total: number;
  /** Uppercased: the plate's small font has no lowercase glyphs. */
  query: string;
  /** One-based, so it reads as "3 of 17". Zero when there are no hits. */
  hit: number;
  hits: number;
}

const ATTACHED: ScrollbackState = {
  detached: false, line: 0, total: 0, query: '', hit: 0, hits: 0,
};

const state = new Map<string, ScrollbackState>();
/** Hit line numbers per session, kept out of the state object the plate reads. */
const hitLines = new Map<string, number[]>();

const get = (id: string): ScrollbackState => state.get(id) ?? { ...ATTACHED };

/**
 * Line indices containing `query`, case-insensitively.
 *
 * Spans are joined first because a line is coloured in pieces and a match can
 * straddle two of them — searching span by span would miss `re|size`.
 *
 * The query is compared as TEXT, never compiled. Someone searching for `$5.00`
 * or `[` means those characters, and a regex would either throw or silently
 * match the wrong thing.
 */
export function findHits(lines: AnsiLine[], query: string): number[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const out: number[] = [];
  lines.forEach((line, i) => {
    const text = line.spans.map((s) => s.text).join('').toLowerCase();
    if (text.includes(needle)) out.push(i);
  });
  return out;
}

/** Following the tail is a MODE, not a position, so it stores no offset. */
export function attach(id: string, total: number): void {
  state.set(id, { ...ATTACHED, total, line: total });
  hitLines.delete(id);
}

export function detach(id: string, line: number): void {
  state.set(id, { ...get(id), detached: true, line });
}

export function reattach(id: string): void {
  const s = get(id);
  state.set(id, { ...s, detached: false, line: s.total });
}

/**
 * Run a query and jump to its first hit.
 *
 * Searching moves you, which means detaching — a search that found something
 * and left you at the tail would have found it for nobody. Clearing the query
 * puts you back on the tail, because that is what you were doing before.
 */
export function runSearch(id: string, query: string, lines: AnsiLine[]): void {
  const s = get(id);
  const found = findHits(lines, query);
  hitLines.set(id, found);

  if (!query.trim()) {
    state.set(id, { ...s, query: '', hit: 0, hits: 0, detached: false, line: s.total });
    return;
  }

  state.set(id, {
    ...s,
    query: query.toUpperCase(),
    hits: found.length,
    hit: found.length ? 1 : 0,
    detached: found.length ? true : s.detached,
    line: found.length ? found[0] : s.line,
  });
}

/** Next or previous hit, wrapping. `delta` is +1 or -1. */
export function stepHit(id: string, delta: number): void {
  const s = get(id);
  const found = hitLines.get(id) ?? [];
  if (!found.length) return;
  // Wrap rather than stop: with a count on screen you can already see where you
  // are, and stopping at the end just makes you press it again in the other
  // direction.
  const next = ((s.hit - 1 + delta) % found.length + found.length) % found.length;
  state.set(id, { ...s, hit: next + 1, line: found[next], detached: true });
}

export function stateOf(id: string): ScrollbackState {
  return state.get(id) ?? ATTACHED;
}

/** Forget one session, or all of them. */
export function resetScrollback(id?: string): void {
  if (id === undefined) {
    state.clear();
    hitLines.clear();
    return;
  }
  state.delete(id);
  hitLines.delete(id);
}
