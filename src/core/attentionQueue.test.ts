import { describe, expect, it } from 'vitest';
import { AttentionQueue } from './attentionQueue';

describe('AttentionQueue', () => {
  it('keeps a quiet session acknowledged until it emits again', () => {
    const queue = new AttentionQueue();
    queue.noteOutput('a', 100);
    queue.acknowledge('a');

    expect(queue.isAcknowledged('a', false)).toBe(true);
    queue.noteOutput('a', 101);
    expect(queue.isAcknowledged('a', false)).toBe(false);
  });

  it('never acknowledges an explicit agent question', () => {
    const queue = new AttentionQueue();
    queue.noteOutput('a', 100);
    queue.acknowledge('a');

    expect(queue.isAcknowledged('a', true)).toBe(false);
  });

  it('cycles only through the rows that are actually visible', () => {
    const queue = new AttentionQueue();
    const rows = [{ sessionId: 'a' }, { sessionId: 'b' }, { sessionId: 'c' }];

    expect(queue.next(rows, null)).toBe('a');
    expect(queue.next(rows, 'a')).toBe('b');
    expect(queue.next(rows, 'c')).toBe('a');
    expect(queue.next([], 'a')).toBeNull();
  });
});
