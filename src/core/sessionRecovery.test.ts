import { describe, expect, it } from 'vitest';
import { reconcileSessions, type RecoverableSession } from './sessionRecovery';

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
