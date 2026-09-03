import { describe, expect, it } from 'vitest';
import {
  reconcileSessions, sessionBinding, type RecoverableSession, type RecoveryState,
} from './sessionRecovery';

const live = (id: string): RecoverableSession => ({
  id, cwd: `/repo/${id}`, command: 'bash', durable: true,
});

describe('reconcileSessions', () => {
  it('separates matches, daemon-only recoverables, and stored snapshots', () => {
    expect(reconcileSessions(['kept', 'snapshot'], [live('kept'), live('orphan')])).toEqual({
      matched: ['kept'],
      recoverable: [live('orphan')],
      snapshots: ['snapshot'],
    });
  });

  it('deduplicates daemon records by id without mutating input order', () => {
    const rows = [live('orphan'), { ...live('orphan'), command: 'codex' }];
    expect(reconcileSessions([], rows).recoverable).toEqual([live('orphan')]);
    expect(rows).toHaveLength(2);
  });
});

const NOTHING: RecoveryState = { matched: [], recoverable: [], snapshots: [] };

describe('cold startup with a stored active id', () => {
  it('does not bind a restored id before the daemon has been asked', () => {
    // The exact cold-start path. Spawn is attach-or-create, so handing a
    // restored id to it against an empty daemon created a FRESH shell under
    // that id — cached transcript lines with a new process behind them,
    // presented as a recovered session.
    expect(sessionBinding('stored', true, false, NOTHING)).toBe('waiting');
  });

  it('presents a restored id the empty daemon does not hold as a snapshot', () => {
    const state = reconcileSessions(['stored'], []);
    expect(state.snapshots).toEqual(['stored']);
    expect(sessionBinding('stored', true, true, state)).toBe('snapshot');
  });

  it('binds a restored id the daemon still holds', () => {
    const state = reconcileSessions(['stored'], [live('stored')]);
    expect(state.matched).toEqual(['stored']);
    expect(sessionBinding('stored', true, true, state)).toBe('ready');
  });

  it('never makes a session created in this run wait on recovery', () => {
    // A new terminal has no stored state to lose, and blocking it on a
    // round-trip would be a visible stall on Ctrl+Shift+T.
    expect(sessionBinding('fresh', false, false, NOTHING)).toBe('ready');
  });

  it('keeps waiting while the daemon is unreachable rather than spawning', () => {
    // listSessions rejects on a timeout, so `reconciled` stays false. Releasing
    // the id on failure would restore exactly the bug.
    expect(sessionBinding('stored', true, false, NOTHING)).not.toBe('ready');
  });
});
