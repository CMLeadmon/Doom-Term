import { describe, it, expect } from 'vitest';
import { formatNodeTranscript } from './transcript';
import { createDefaultWorkspace } from './sessionStore';
import { SessionNode } from '../types/sessionTree';

describe('formatNodeTranscript', () => {
  it('renders the session screen, which is now its only source', () => {
    // This used to assert a block-formatted transcript with exit codes and
    // durations. The block editor is gone and nothing has created a block
    // since, so that shape was copying an empty string to the clipboard while
    // looking like a working feature. Full coverage lives in transcript.test.ts.
    const mockNode: SessionNode = {
      id: 'node-1',
      groupId: 'group-1',
      title: 'Agent 1',
      number: 1,
      kind: 'agent',
      cwd: '/test',
      gitBranch: 'main',
      activeBlockId: null,
      isTuiActive: false,
      agentState: 'idle',
      tuiLines: [
        { id: 'l0', spans: [{ text: '$ cargo test' }], isError: false, timestamp: 1000 },
        { id: 'l1', spans: [{ text: 'test result: ok' }], isError: false, timestamp: 1200 },
      ],
      commandHistory: [],
      createdAt: 1000,
    };

    const transcript = formatNodeTranscript(mockNode);
    expect(transcript).toContain('$ cargo test');
    expect(transcript).toContain('test result: ok');
  });
});

describe('SessionStore', () => {
  it('creates valid default workspace', () => {
    const ws = createDefaultWorkspace();
    expect(ws.id).toBe('project-root');
    expect(ws.groups.length).toBeGreaterThan(0);
    expect(Object.keys(ws.nodes).length).toBeGreaterThan(0);
  });
});
