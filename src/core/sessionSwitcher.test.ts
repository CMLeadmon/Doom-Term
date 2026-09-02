import { describe, expect, it } from 'vitest';
import type { SessionNode } from '../types/sessionTree';
import { previewSession, rankSessions, sessionSearchText } from './sessionSwitcher';

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
