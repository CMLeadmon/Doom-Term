import { describe, it, expect } from 'vitest';
import { detectAgentFromSession, calculateSessionTelemetry } from './agentDetector';
import { SessionNode } from '../types/sessionTree';

describe('agentDetector', () => {
  const createMockNode = (overrides: Partial<SessionNode> = {}): SessionNode => ({
    id: 'node-1',
    groupId: 'group-1',
    title: 'Terminal 1',
    kind: 'terminal',
    cwd: '~/Projects/Doom Term',
    gitBranch: 'main',
    activeBlockId: null,
    isTuiActive: false,
    agentState: 'idle',
    blocks: [],
    tuiLines: [],
    commandHistory: [],
    createdAt: Date.now(),
    ...overrides,
  });

  it('detects plain shell when no agent commands or titles are present', () => {
    const node = createMockNode({
      title: 'Terminal 1',
      kind: 'terminal',
      commandHistory: ['ls -la', 'git status', 'cargo test'],
    });

    const info = detectAgentFromSession(node);
    expect(info.isAgent).toBe(false);
    expect(info.agent).toBe('doom');
    expect(info.agentName).toBe('BASH · SHELL');

    const tele = calculateSessionTelemetry(node, false);
    expect(tele.agent).toBe('doom');
    expect(tele.tokens).toBeUndefined();
    expect(tele.shellMetrics).toBeDefined();
    expect(tele.shellMetrics?.commands).toBe(0);
  });

  it('detects Claude agent when kind is agent or command is claude', () => {
    const nodeByKind = createMockNode({
      title: 'Agent 1',
      kind: 'agent',
    });
    expect(detectAgentFromSession(nodeByKind).agent).toBe('claude');

    const nodeByCmd = createMockNode({
      commandHistory: ['claude "fix the bug"'],
    });
    const info = detectAgentFromSession(nodeByCmd);
    expect(info.isAgent).toBe(true);
    expect(info.agent).toBe('claude');
    expect(info.agentName).toBe('CLAUDE CODE');

    const tele = calculateSessionTelemetry(nodeByCmd, false, 5000);
    expect(tele.agent).toBe('claude');
    expect(tele.tokens).toBeDefined();
    expect(tele.tokens?.in).toBeGreaterThan(0);
    expect(tele.contextUsed).toBeGreaterThan(0);
    expect(tele.rateUsed).toBeGreaterThan(0);
  });

  it('detects Gemini CLI session', () => {
    const node = createMockNode({
      commandHistory: ['gemini generate "hello"'],
    });
    const info = detectAgentFromSession(node);
    expect(info.isAgent).toBe(true);
    expect(info.agent).toBe('gemini');
    expect(info.agentName).toBe('GEMINI CLI');
  });

  it('detects OpenAI Codex / ChatGPT CLI session', () => {
    const node = createMockNode({
      commandHistory: ['codex review src/'],
    });
    const info = detectAgentFromSession(node);
    expect(info.isAgent).toBe(true);
    expect(info.agent).toBe('codex');
    expect(info.agentName).toBe('CODEX');
  });

  it('detects OpenCode and Grok CLI sessions', () => {
    const openCodeNode = createMockNode({ commandHistory: ['opencode start'] });
    expect(detectAgentFromSession(openCodeNode).agent).toBe('opencode');

    const grokNode = createMockNode({ commandHistory: ['grok --prompt "hi"'] });
    expect(detectAgentFromSession(grokNode).agent).toBe('grok');
  });

  it('calculates realistic context and rate usage in active agent state', () => {
    const activeAgentNode = createMockNode({
      kind: 'agent',
      agentState: 'running',
      blocks: [
        {
          id: 'b1',
          command: 'analyze codebase architecture',
          status: 'running',
          startedAt: Date.now(),
          currentDir: '~/Projects/Doom Term',
          gitBranch: 'main',
          liveLines: [
            { id: 'l1', timestamp: 0, spans: [{ text: 'Deep analysis of all 12 modules completed.' }] },
          ],
        },
      ],
    });

    const tele = calculateSessionTelemetry(activeAgentNode, false);
    expect(tele.contextUsed).toBeGreaterThan(0.01);
    expect(tele.contextUsed).toBeLessThan(1.0);
    expect(tele.rateUsed).toBeGreaterThan(0.4); // Active generation burst
    expect(tele.tokens).toBeDefined();
    expect(tele.tokens!.in + tele.tokens!.out + tele.tokens!.cache).toBeGreaterThan(1000);
  });
});
