import { describe, it, expect } from 'vitest';
import { buildWaitingList } from './waitingList';
// The renderer's own count, not a second implementation of it: plate.js cannot
// import TypeScript, so a copy here would be the one that drifted.
import { waitingCount } from '../hud/plate.js';
import type { SessionNode } from '../types/sessionTree';

const node = (over: Partial<SessionNode>): SessionNode => ({
  id: 'n', groupId: 'g', title: 'T', number: 1, kind: 'terminal', cwd: '/x',
  gitBranch: '', activeBlockId: null, isTuiActive: false, agentState: 'idle',
  tuiLines: [], commandHistory: [], createdAt: 0, ...over,
});

/** Every session emitted at t=1000 unless a test says otherwise. */
const probe = (isBusy: boolean, at: number | undefined) => ({
  isBusy: () => isBusy,
  lastOutputAt: () => at,
});
const idle = probe(false, 1_000);
const busy = probe(true, 1_000);
/** Has never emitted. Not the same as "emitted a long time ago". */
const never = probe(false, undefined);

describe('the row a session earns', () => {
  it('carries a status and a vendor tag, and NOTHING derived from a clock', () => {
    // The timers are gone. A row that still held elapsed time would force the
    // plate to redraw every tick to advance a number nobody asked for, and
    // buildWaitingList would need `now` back to compute it.
    const rows = buildWaitingList(
      [node({ id: 'a', number: 2, title: 'PTY-FIX', foregroundAgent: 'claude' })],
      'other', idle,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      sessionId: 'a', n: '2', name: 'PTY-FIX', status: 'quiet', tag: 'CLAU',
    });
  });

  it('is quiet when the session merely stopped', () => {
    const rows = buildWaitingList([node({ id: 'a' })], 'other', idle);
    expect(rows[0].status).toBe('quiet');
  });

  it('is asks when the agent SAID it is blocked on a human', () => {
    const rows = buildWaitingList(
      [node({ id: 'a', blockedOnUser: true })], 'other', idle,
    );
    expect(rows[0].status).toBe('asks');
  });

  it('is failed when the process died with a non-zero code', () => {
    const rows = buildWaitingList(
      [node({ id: 'a', lastExitCode: 101 })], 'other', idle,
    );
    expect(rows[0].status).toBe('failed');
  });

  it('does not treat a clean exit as a failure', () => {
    const rows = buildWaitingList(
      [node({ id: 'a', lastExitCode: 0 })], 'other', idle,
    );
    expect(rows[0].status).toBe('quiet');
  });

  it('lets a live question outrank a stale exit code', () => {
    // The agent is asking you something NOW. What its last command exited with
    // is history, and history must not mask a live request.
    const rows = buildWaitingList(
      [node({ id: 'a', lastExitCode: 101, blockedOnUser: true })], 'other', idle,
    );
    expect(rows[0].status).toBe('asks');
  });

  it('renders an unnumbered session with a dash rather than "null"', () => {
    expect(buildWaitingList([node({ id: 'a', number: null })], 'x', idle)[0].n).toBe('-');
  });
});

describe('the vendor tag', () => {
  it('names the vendor the kernel actually reported', () => {
    const tagOf = (agent: string | null) =>
      buildWaitingList([node({ id: 'a', foregroundAgent: agent })], 'x', idle)[0].tag;
    expect(tagOf('claude')).toBe('CLAU');
    expect(tagOf('codex')).toBe('CODX');
    expect(tagOf('gemini')).toBe('GEMI');
    expect(tagOf('antigravity')).toBe('AGY');
    expect(tagOf('aider')).toBe('AIDR');
    expect(tagOf('opencode')).toBe('OPCD');
    expect(tagOf('grok')).toBe('GROK');
    expect(tagOf('copilot')).toBe('CPLT');
  });

  it('says SH for a bare shell, which is not an agent', () => {
    expect(buildWaitingList([node({ id: 'a', foregroundAgent: null })], 'x', idle)[0].tag).toBe('SH');
    expect(buildWaitingList([node({ id: 'a' })], 'x', idle)[0].tag).toBe('SH');
  });

  it('shows an unmapped agent key rather than calling it a shell', () => {
    // The kernel is the source of these keys, so a key we have no tag for is a
    // real agent this table has not caught up with. Printing SH would claim it
    // is a plain shell, which is a lie the plate must not tell.
    expect(buildWaitingList(
      [node({ id: 'a', foregroundAgent: 'newagent' })], 'x', idle,
    )[0].tag).toBe('NEWA');
  });

  it('never exceeds the four characters the column reserves', () => {
    const tag = buildWaitingList(
      [node({ id: 'a', foregroundAgent: 'a-very-long-future-agent-name' })], 'x', idle,
    )[0].tag;
    expect(tag.length).toBeLessThanOrEqual(4);
  });
});

describe('the order rows are owed to you in', () => {
  /** Distinct silence times so "longest wait first" is decidable. */
  const at = (times: Record<string, number>) => ({
    isBusy: (id: string) => times[id] === undefined,
    lastOutputAt: (id: string) => times[id] ?? 1_000,
  });

  it('ranks a live question above a dead process above mere silence', () => {
    const nodes = [
      node({ id: 'q', number: 1, title: 'QUIET' }),
      node({ id: 'f', number: 2, title: 'FAILED', lastExitCode: 101 }),
      node({ id: 'a', number: 3, title: 'ASKING', blockedOnUser: true }),
    ];
    expect(buildWaitingList(nodes, 'x', at({ q: 1, f: 2, a: 3 })).map((r) => r.name))
      .toEqual(['ASKING', 'FAILED', 'QUIET']);
  });

  it('puts the longest wait first within a rank — that is the one going stale', () => {
    const nodes = [
      node({ id: 'new', number: 1, title: 'NEW' }),
      node({ id: 'old', number: 2, title: 'OLD' }),
    ];
    expect(buildWaitingList(nodes, 'x', at({ new: 4_000, old: 1_000 })).map((r) => r.name))
      .toEqual(['OLD', 'NEW']);
  });

  it('lets a question outrank a longer silence — it SAID it needs you', () => {
    const nodes = [
      node({ id: 'quiet', number: 1, title: 'QUIET' }),
      node({ id: 'asks', number: 2, title: 'ASKING', blockedOnUser: true }),
    ];
    expect(buildWaitingList(nodes, 'x', at({ quiet: 0, asks: 4_900 })).map((r) => r.name))
      .toEqual(['ASKING', 'QUIET']);
  });

  it('appends every working session BELOW every waiting one', () => {
    // Working rows are filler for space nothing waiting wanted. Interleaving
    // them would spend a scarce row slot on a session that wants nothing.
    const nodes = [
      node({ id: 'w1', number: 1, title: 'BUSY-ONE' }),
      node({ id: 'q', number: 8, title: 'QUIET' }),
      node({ id: 'w2', number: 2, title: 'BUSY-TWO' }),
    ];
    const rows = buildWaitingList(nodes, 'x', at({ q: 1_000 }));
    expect(rows.map((r) => r.name)).toEqual(['QUIET', 'BUSY-ONE', 'BUSY-TWO']);
    expect(rows.map((r) => r.status)).toEqual(['quiet', 'working', 'working']);
  });

  it('orders working rows by slot number, not by recency', () => {
    // An agent emits constantly, so a recency sort would have these rows
    // trading places several times a second. On this plate movement means
    // something, and "nothing has changed" must look like nothing changed.
    const nodes = [
      node({ id: 'c', number: 7, title: 'SEVEN' }),
      node({ id: 'a', number: 2, title: 'TWO' }),
      node({ id: 'b', number: 4, title: 'FOUR' }),
    ];
    expect(buildWaitingList(nodes, 'x', at({})).map((r) => r.name))
      .toEqual(['TWO', 'FOUR', 'SEVEN']);
  });

  it('sorts an unnumbered working session last rather than first', () => {
    // Number('-') is NaN, and NaN in a comparator silently keeps input order.
    const nodes = [
      node({ id: 'x', number: null, title: 'NO-SLOT' }),
      node({ id: 'a', number: 9, title: 'NINE' }),
    ];
    expect(buildWaitingList(nodes, 'other', at({})).map((r) => r.name))
      .toEqual(['NINE', 'NO-SLOT']);
  });
});

describe('the count the numeral shows', () => {
  it('counts what wants you, not what is merely on the list', () => {
    // The well exists to answer "how many sessions want me". Counting working
    // filler would inflate that number every time an agent started thinking.
    const nodes = [
      node({ id: 'q', number: 1, title: 'QUIET' }),
      node({ id: 'w', number: 2, title: 'BUSY' }),
    ];
    const rows = buildWaitingList(nodes, 'x', {
      isBusy: (id: string) => id === 'w',
      lastOutputAt: () => 1_000,
    });
    expect(rows).toHaveLength(2);
    expect(waitingCount(rows)).toBe(1);
  });

  it('is zero when everything on the list is working', () => {
    const rows = buildWaitingList([node({ id: 'a' })], 'x', busy);
    expect(waitingCount(rows)).toBe(0);
  });
});

describe('who earns a row at all', () => {
  it('never lists the session you are looking at', () => {
    expect(buildWaitingList([node({ id: 'a' })], 'a', idle)).toHaveLength(0);
  });

  it('never lists a session that has produced nothing yet', () => {
    // Not started is not the same as stopped, and claiming otherwise would put
    // every freshly opened terminal in the list.
    expect(buildWaitingList([node({ id: 'a' })], 'other', never)).toHaveLength(0);
  });

  it('never lists a scratchpad — it has no process to be waiting on', () => {
    expect(buildWaitingList([node({ id: 'a', kind: 'scratchpad' })], 'other', idle)).toHaveLength(0);
  });

  it('omits an acknowledged quiet session until it emits again', () => {
    const attention = { isAcknowledged: (id: string, blocked: boolean) => id === 'a' && !blocked };
    expect(buildWaitingList([node({ id: 'a' })], 'other', idle, attention)).toHaveLength(0);
  });

  it('keeps an explicit question even when ordinary quiet would be acknowledged', () => {
    const attention = { isAcknowledged: () => true };
    const rows = buildWaitingList([node({ id: 'a', blockedOnUser: true })], 'other', idle, attention);
    expect(rows[0].status).toBe('asks');
  });

  it('does not let acknowledgement hide a session that is working', () => {
    // Acknowledgement settles a request for attention. A working session is
    // not asking for any, so the two have nothing to say to each other.
    const attention = { isAcknowledged: () => true };
    const rows = buildWaitingList([node({ id: 'a' })], 'other', busy, attention);
    expect(rows.map((r) => r.status)).toEqual(['working']);
  });
});
