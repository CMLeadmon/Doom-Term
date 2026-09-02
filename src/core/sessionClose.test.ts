import { describe, expect, it } from 'vitest';
import type { SessionNode } from '../types/sessionTree';
import { closeDisposition } from './sessionClose';

const node = (over: Partial<SessionNode> = {}): SessionNode => ({
  id: 'n', groupId: 'g', title: 'N', number: 1, kind: 'terminal', cwd: '/', gitBranch: '',
  activeBlockId: null, isTuiActive: false, agentState: 'idle', tuiLines: [], commandHistory: [],
  createdAt: 0, ...over,
});

describe('closeDisposition', () => {
  it('kills an observed idle shell without ceremony', () => {
    expect(closeDisposition(node({ atPrompt: true }))).toBe('kill');
  });

  it('confirms before touching a running command or active agent', () => {
    expect(closeDisposition(node({ atPrompt: false, lastExecutionStartedAt: 1 }))).toBe('confirm');
    expect(closeDisposition(node({ atPrompt: true, foregroundAgent: 'codex' }))).toBe('confirm');
  });

  it('treats unknown prompt state and non-durable live work conservatively', () => {
    expect(closeDisposition(node(), false)).toBe('confirm');
    expect(closeDisposition(node({ atPrompt: false }), false)).toBe('confirm');
  });

  it('closes a scratchpad directly because it owns no process', () => {
    expect(closeDisposition(node({ kind: 'scratchpad' }))).toBe('kill');
  });
});
