import { describe, it, expect } from 'vitest';
import { formatNodeTranscript } from './transcript';
import type { SessionNode } from '../types/sessionTree';

const node = (texts: string[]): SessionNode => ({
  id: 'n', groupId: 'g', title: 'T', number: 1, kind: 'terminal', cwd: '/x',
  gitBranch: '', activeBlockId: null, isTuiActive: false, agentState: 'idle',
  tuiLines: texts.map((t, i) => ({ id: String(i), spans: [{ text: t }], isError: false, timestamp: 0 })),
  commandHistory: [], createdAt: 0,
});

describe('formatNodeTranscript', () => {
  it('renders the screen the view shows, not blocks that no longer exist', () => {
    expect(formatNodeTranscript(node(['$ ls', 'a  b']))).toBe('$ ls\na  b');
  });

  it('joins spans, because a line is coloured in pieces', () => {
    const n = node([]);
    n.tuiLines = [{ id: '0', isError: false, timestamp: 0, spans: [{ text: 're' }, { text: 'size' }] }];
    expect(formatNodeTranscript(n)).toBe('resize');
  });

  it('keeps the newest lines when capped', () => {
    expect(formatNodeTranscript(node(['a', 'b', 'c']), 2)).toBe('b\nc');
  });

  it('trims the padding the grid adds, so it pastes clean', () => {
    expect(formatNodeTranscript(node(['hello        ']))).toBe('hello');
  });

  it('is empty for a session that has said nothing', () => {
    expect(formatNodeTranscript(node([]))).toBe('');
  });
});
