import { describe, it, expect } from 'vitest';
import { TokenMeter } from './tokenMeter';
import { formatNodeTranscript } from './transcript';
import { createDefaultWorkspace } from './sessionStore';
import { SessionNode } from '../types/sessionTree';

describe('formatNodeTranscript', () => {
  it('formats node transcripts and buffers', () => {
    const mockNode: SessionNode = {
      id: 'node-1',
      groupId: 'group-1',
      title: 'Agent 1',
      kind: 'agent',
      cwd: '/test',
      gitBranch: 'main',
      activeBlockId: null,
      isTuiActive: false,
      agentState: 'idle',
      blocks: [
        {
          id: 'b1',
          command: 'cargo test',
          status: 'completed',
          startedAt: 1000,
          completedAt: 1500,
          durationMs: 500,
          exitCode: 0,
          liveLines: [{ id: 'l1', spans: [{ text: 'test result: ok' }], timestamp: 1200 }],
        },
      ],
      tuiLines: [],
      commandHistory: [],
      createdAt: 1000,
    };

    const transcript = formatNodeTranscript(mockNode);
    expect(transcript).toContain('$ cargo test');
    expect(transcript).toContain('test result: ok');
    expect(transcript).toContain('Exit Code: 0');
  });
});

describe('TokenMeter', () => {
  it('calculates token counts and context percentages correctly', () => {
    const metrics = TokenMeter.calculateTokens(3800, 7600, 'claude-3-7-sonnet');
    expect(metrics.tokensIn).toBeGreaterThan(800);
    expect(metrics.tokensOut).toBeGreaterThan(0);
    expect(metrics.totalTokens).toBe(metrics.tokensIn + metrics.tokensOut + metrics.tokensCache);
    expect(metrics.contextPct).toBeGreaterThan(0);
    expect(metrics.contextPct).toBeLessThan(1);
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
