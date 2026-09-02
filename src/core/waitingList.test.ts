import { describe, it, expect } from 'vitest';
import { buildWaitingList, formatWait } from './waitingList';
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

describe('formatWait', () => {
  it('is seconds under a minute', () => {
    expect(formatWait(4_000)).toBe('4S');
  });

  it('pads the seconds so the column does not jitter', () => {
    expect(formatWait(252_000)).toBe('4M12S');
    expect(formatWait(65_000)).toBe('1M05S');
  });

  it('never goes negative if a clock moves backwards', () => {
    expect(formatWait(-5_000)).toBe('0S');
  });
});

describe('buildWaitingList', () => {
  it('lists a session that has stopped', () => {
    const rows = buildWaitingList(
      [node({ id: 'a', number: 2, title: 'PTY-FIX' })],
      'other', idle, 5_000,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: 'a', n: '2', name: 'PTY-FIX', tail: '4S', failed: false });
  });

  it('omits an acknowledged quiet session until it emits again', () => {
    const nodes = [node({ id: 'a', number: 2 })];
    const attention = { isAcknowledged: (id: string, blocked: boolean) => id === 'a' && !blocked };
    expect(buildWaitingList(nodes, 'other', idle, 5_000, attention)).toHaveLength(0);
  });

  it('keeps an explicit question even when ordinary quiet would be acknowledged', () => {
    const nodes = [node({ id: 'a', number: 2, blockedOnUser: true })];
    const attention = { isAcknowledged: () => true };
    expect(buildWaitingList(nodes, 'other', idle, 5_000, attention)[0].tail).toBe('ASKS');
  });

  it('never lists the session you are looking at', () => {
    const nodes = [node({ id: 'a', number: 2 })];
    expect(buildWaitingList(nodes, 'a', idle, 5_000)).toHaveLength(0);
  });

  it('never lists a session that is still working', () => {
    const nodes = [node({ id: 'a', number: 2 })];
    expect(buildWaitingList(nodes, 'other', busy, 5_000)).toHaveLength(0);
  });

  it('never lists a session that has produced nothing yet', () => {
    // Not started is not the same as stopped, and claiming otherwise would put
    // every freshly opened terminal in the list.
    const nodes = [node({ id: 'a', number: 2 })];
    expect(buildWaitingList(nodes, 'other', never, 5_000)).toHaveLength(0);
  });

  it('never lists a scratchpad — it has no process to be waiting on', () => {
    const nodes = [node({ id: 'a', kind: 'scratchpad' })];
    expect(buildWaitingList(nodes, 'other', idle, 5_000)).toHaveLength(0);
  });

  it('shows an exit code instead of a duration, and marks it failed', () => {
    const rows = buildWaitingList(
      [node({ id: 'a', number: 6, lastExitCode: 101 })],
      'other', idle, 5_000,
    );
    expect(rows[0]).toMatchObject({ tail: 'EXIT 101', failed: true });
  });

  it('does not treat a clean exit as a failure', () => {
    const rows = buildWaitingList(
      [node({ id: 'a', number: 6, lastExitCode: 0 })],
      'other', idle, 5_000,
    );
    expect(rows[0]).toMatchObject({ tail: '4S', failed: false });
  });

  it('puts the longest wait first — that is the one going stale', () => {
    const nodes = [
      node({ id: 'a', number: 1, title: 'NEW' }),
      node({ id: 'b', number: 2, title: 'OLD' }),
    ];
    const times: Record<string, number> = { a: 4_000, b: 1_000 };
    const staggered = { isBusy: () => false, lastOutputAt: (id: string) => times[id] };
    expect(buildWaitingList(nodes, 'x', staggered, 5_000).map((r) => r.name))
      .toEqual(['OLD', 'NEW']);
  });

  it('renders an unnumbered session with a dash rather than "null"', () => {
    const nodes = [node({ id: 'a', number: null })];
    expect(buildWaitingList(nodes, 'x', idle, 5_000)[0].n).toBe('-');
  });
});

describe('blockedOnUser', () => {
  it('says ASKS rather than a duration you would have to interpret', () => {
    const rows = buildWaitingList(
      [node({ id: 'a', number: 3, title: 'API', blockedOnUser: true })],
      'other', idle, 5_000,
    );
    expect(rows[0]).toMatchObject({ n: '3', name: 'API', tail: 'ASKS' });
  });

  it('outranks a longer silent wait — it SAID it needs you', () => {
    const nodes = [
      node({ id: 'quiet', number: 1, title: 'QUIET' }),
      node({ id: 'asks', number: 2, title: 'ASKING', blockedOnUser: true }),
    ];
    const times: Record<string, number> = { quiet: 0, asks: 4_900 };
    const staggered = { isBusy: () => false, lastOutputAt: (id: string) => times[id] };
    expect(buildWaitingList(nodes, 'x', staggered, 5_000).map((r) => r.name))
      .toEqual(['ASKING', 'QUIET']);
  });

  it('still never lists the session you are looking at, blocked or not', () => {
    const nodes = [node({ id: 'a', number: 2, blockedOnUser: true })];
    expect(buildWaitingList(nodes, 'a', idle, 5_000)).toHaveLength(0);
  });
});
