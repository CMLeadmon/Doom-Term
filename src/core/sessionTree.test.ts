import { describe, it, expect } from 'vitest';
import { ContextGraph } from './contextGraph';
import { TaskPipeline } from './taskPipeline';
import { InterAgentMessageBus } from './messageBus';
import { TokenMeter } from './tokenMeter';
import { WorktreeManager } from './worktreeManager';
import { BlockStore } from './blockStore';
import { createDefaultWorkspace } from './sessionStore';
import { SessionNode } from '../types/sessionTree';

describe('ContextGraph', () => {
  it('manages directional context links and queries upstream/downstream nodes', () => {
    const graph = new ContextGraph();
    const link1 = graph.addLink('node-1', 'node-2');
    expect(link1).not.toBeNull();
    expect(graph.getLinks().length).toBe(1);

    // Duplicate links are ignored
    expect(graph.addLink('node-1', 'node-2')).toBeNull();

    // Query links
    expect(graph.getLinkedUpstreamIds('node-2')).toEqual(['node-1']);
    expect(graph.getLinkedDownstreamIds('node-1')).toEqual(['node-2']);

    graph.removeLink('node-1', 'node-2');
    expect(graph.getLinks().length).toBe(0);
  });

  it('formats node transcripts and buffers', () => {
    const graph = new ContextGraph();
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

    const transcript = graph.getTranscript(mockNode);
    expect(transcript).toContain('$ cargo test');
    expect(transcript).toContain('test result: ok');
    expect(transcript).toContain('Exit Code: 0');

    const summary = graph.getSummary(mockNode);
    expect(summary.totalBlocks).toBe(1);
    expect(summary.lastExitCode).toBe(0);
  });
});

describe('TaskPipeline', () => {
  it('evaluates task dependencies and transitions to ready when upstream completes', () => {
    const pipeline = new TaskPipeline();
    pipeline.addTask('downstream-node', ['upstream-node'], 'echo "upstream done"');

    const mockNodes: Record<string, SessionNode> = {
      'upstream-node': {
        id: 'upstream-node',
        groupId: 'g1',
        title: 'Upstream',
        kind: 'terminal',
        cwd: '/test',
        gitBranch: 'main',
        activeBlockId: null,
        isTuiActive: false,
        agentState: 'idle',
        blocks: [
          {
            id: 'b1',
            command: 'build',
            status: 'completed',
            startedAt: 1000,
            completedAt: 2000,
            exitCode: 0,
            liveLines: [],
          },
        ],
        tuiLines: [],
        commandHistory: [],
        createdAt: 1000,
      },
    };

    const result = pipeline.evaluate(mockNodes);
    expect(result.readyTasks.length).toBe(1);
    expect(result.readyTasks[0].nodeId).toBe('downstream-node');
  });
});

describe('InterAgentMessageBus', () => {
  it('queues messages with nonces and delivers when target is idle', () => {
    const bus = new InterAgentMessageBus();
    const res = bus.queueMessage({
      senderId: 'agent-1',
      targetId: 'agent-2',
      text: 'Review diff in src/app.ts',
    });

    expect(res.success).toBe(true);
    expect(res.message?.nonce).toBeDefined();

    // Delivery while busy should return empty
    expect(bus.deliverPending('agent-2', false).length).toBe(0);

    // Delivery while idle should succeed
    const deliveries = bus.deliverPending('agent-2', true);
    expect(deliveries.length).toBe(1);
    expect(deliveries[0].formattedText).toContain('--- NODETERM MESSAGE');
    expect(deliveries[0].formattedText).toContain('reply-to: agent-1');
  });

  it('enforces 10s rate limit per sender->target pair', () => {
    const bus = new InterAgentMessageBus();
    bus.queueMessage({ senderId: 'a1', targetId: 'a2', text: 'First' });
    const second = bus.queueMessage({ senderId: 'a1', targetId: 'a2', text: 'Second' });
    expect(second.success).toBe(false);
    expect(second.error).toContain('Rate limited');
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

describe('WorktreeManager', () => {
  it('computes clean paths and worktree shell commands', () => {
    const path = WorktreeManager.getWorktreePath('/home/user/project', 'feature/auth');
    expect(path).toBe('/home/user/project/.worktrees/feature-auth');

    const cmd = WorktreeManager.generateWorktreeCommand('feature/auth');
    expect(cmd).toContain('git worktree add -b feature-auth .worktrees/feature-auth HEAD');
  });
});

describe('BlockStore', () => {
  it('freezes running blocks into immutable snapshots', () => {
    const store = new BlockStore();
    const frozen = store.freezeBlock(
      {
        id: 'b1',
        command: 'ls',
        status: 'running',
        startedAt: Date.now() - 100,
        liveLines: [{ id: 'l1', spans: [{ text: 'file.txt' }], timestamp: Date.now() }],
      },
      0,
      [{ id: 'l1', spans: [{ text: 'file.txt' }], timestamp: Date.now() }]
    );

    expect(frozen.status).toBe('completed');
    expect(frozen.snapshot).toBeDefined();
    expect(frozen.snapshot?.exitCode).toBe(0);
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
