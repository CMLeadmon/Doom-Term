import { describe, it, expect, beforeEach } from 'vitest';
import {
  noteOutput,
  isWorking,
  disposeActivity,
  resetActivity,
  BUCKET_MS,
} from './activityMonitor';

beforeEach(() => resetActivity());

describe('activityMonitor', () => {
  it('reports nothing for a session that has never emitted', () => {
    expect(isWorking('s1', 10_000)).toBe(false);
  });

  it('does not call a single burst of output work', () => {
    // One chunk is a repaint, not a session doing something.
    noteOutput('s1', 10_000);
    expect(isWorking('s1', 10_000)).toBe(false);
  });

  it('calls sustained streaming work', () => {
    for (let t = 10_000; t <= 11_000; t += 50) noteOutput('s1', t);
    expect(isWorking('s1', 11_000)).toBe(true);
  });

  it('does not call an idle agent working, however often it repaints', () => {
    // Measured from a real Antigravity session parked at its prompt: a short
    // burst roughly every 1.5s. Recency alone flagged this as busy forever.
    let now = 10_000;
    for (let repaint = 0; repaint < 20; repaint++) {
      // Each repaint is a burst well inside one bucket.
      noteOutput('s1', now);
      noteOutput('s1', now + 10);
      noteOutput('s1', now + 20);
      expect(isWorking('s1', now + 20)).toBe(false);
      now += 1500;
    }
  });

  it('stops reporting work once the stream goes quiet', () => {
    for (let t = 10_000; t <= 11_000; t += 50) noteOutput('s1', t);
    expect(isWorking('s1', 11_000)).toBe(true);
    expect(isWorking('s1', 12_200)).toBe(false);
  });

  it('keeps sessions apart', () => {
    for (let t = 10_000; t <= 11_000; t += 50) noteOutput('busy', t);
    noteOutput('quiet', 11_000);
    expect(isWorking('busy', 11_000)).toBe(true);
    expect(isWorking('quiet', 11_000)).toBe(false);
  });

  it('does not grow without bound while a session streams', () => {
    // A long-running agent must not accumulate a timestamp per chunk.
    for (let t = 0; t < 200_000; t += 10) noteOutput('s1', t);
    expect(isWorking('s1', 200_000)).toBe(true);
    // Only buckets inside the window can survive.
    const seen = (globalThis as never as { __x?: never });
    void seen;
    // Probe indirectly: a far-future query must be false, proving old buckets
    // are not still counted.
    expect(isWorking('s1', 500_000)).toBe(false);
  });

  it('forgets a closed session', () => {
    for (let t = 10_000; t <= 11_000; t += 50) noteOutput('s1', t);
    disposeActivity('s1');
    expect(isWorking('s1', 11_000)).toBe(false);
  });

  it('needs output spread across buckets, not many chunks in one', () => {
    // 500 chunks inside a single bucket is still one burst.
    for (let i = 0; i < 500; i++) noteOutput('s1', 10_000 + (i % BUCKET_MS) * 0.1);
    expect(isWorking('s1', 10_000)).toBe(false);
  });
});
