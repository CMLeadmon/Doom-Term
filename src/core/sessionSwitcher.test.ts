import { describe, expect, it } from 'vitest';
import type { SessionNode } from '../types/sessionTree';
import {
  attentionRank, previewSession, rankSessions, sessionSearchText,
} from './sessionSwitcher';

const node = (id: string, over: Partial<SessionNode> = {}): SessionNode => ({
  id, groupId: 'g', title: id.toUpperCase(), number: 1, kind: 'terminal', cwd: '/repo',
  gitBranch: 'main', activeBlockId: null, isTuiActive: false, agentState: 'idle',
  tuiLines: [], commandHistory: [], createdAt: 0, ...over,
});

describe('rankSessions', () => {
  it('orders explicit attention before recency, then uses stable numbers', () => {
    const rows = [
      node('old', { number: 3, lastUsedAt: 1 }),
      node('recent', { number: 2, lastUsedAt: 9 }),
      node('asks', { number: 8, lastUsedAt: 0, blockedOnUser: true }),
      node('same', { number: 1, lastUsedAt: 1 }),
    ];
    expect(rankSessions(rows).map((row) => row.id)).toEqual(['asks', 'recent', 'same', 'old']);
  });

  it('does not mutate workspace order while ranking', () => {
    const rows = [node('b', { number: 2 }), node('a', { number: 1 })];
    rankSessions(rows);
    expect(rows.map((row) => row.id)).toEqual(['b', 'a']);
  });
});

describe('session search and preview', () => {
  const rich = node('n', {
    title: 'INDEXER', cwd: '/src/search', gitBranch: 'fix/token-index', foregroundAgent: 'codex',
    tuiLines: [
      { id: '1', spans: [{ text: 'first' }], isError: false, timestamp: 0 },
      { id: '2', spans: [{ text: 'needle in output' }], isError: false, timestamp: 0 },
    ],
  });

  it('searches metadata and rendered output as one lower-case field', () => {
    const text = sessionSearchText(rich, 'Doom Term');
    for (const part of ['indexer', '/src/search', 'fix/token-index', 'codex', 'needle in output', 'doom term']) {
      expect(text).toContain(part);
    }
  });

  it('previews only the newest non-empty lines', () => {
    expect(previewSession(rich, 1)).toBe('needle in output');
  });
});

describe('attention ranking covers everything the plate calls attention', () => {
  // The switcher promoted only blockedOnUser while calling itself
  // attention-first, so it disagreed with the plate's waiting rows: a command
  // that FAILED and output nobody has read are both in that queue.
  const unread = { isAcknowledged: () => false };
  const seen = { isAcknowledged: () => true };

  it('puts an explicit question first', () => {
    expect(attentionRank(node('a', { blockedOnUser: true }), unread)).toBe(0);
  });

  it('ranks a failed command above unread output', () => {
    const failed = attentionRank(node('a', { lastExitCode: 1 }), unread);
    const quiet = attentionRank(node('b', { lastExitCode: 0 }), unread);
    expect(failed).toBeLessThan(quiet);
  });

  it('treats an unknown exit code as no claim on attention', () => {
    // null is unknown, not failure. Promoting it would invent a failure.
    expect(attentionRank(node('a', { lastExitCode: null }), seen)).toBe(3);
  });

  it('promotes a failed session over a more recently used healthy one', () => {
    const rows = [
      node('healthy', { number: 1, lastUsedAt: 100 }),
      node('failed', { number: 2, lastUsedAt: 1, lastExitCode: 2 }),
    ];
    expect(rankSessions(rows, seen).map((row) => row.id)).toEqual(['failed', 'healthy']);
  });

  it('still ranks an explicit question above a failure', () => {
    const rows = [
      node('failed', { number: 1, lastUsedAt: 100, lastExitCode: 2 }),
      node('asks', { number: 2, lastUsedAt: 1, blockedOnUser: true }),
    ];
    expect(rankSessions(rows, seen).map((row) => row.id)).toEqual(['asks', 'failed']);
  });

  it('behaves as before when no acknowledgement probe is supplied', () => {
    const rows = [
      node('old', { number: 3, lastUsedAt: 1 }),
      node('recent', { number: 2, lastUsedAt: 9 }),
    ];
    expect(rankSessions(rows).map((row) => row.id)).toEqual(['recent', 'old']);
  });
});
