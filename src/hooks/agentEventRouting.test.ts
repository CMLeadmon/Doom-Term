import { describe, it, expect } from 'vitest';
import { resolveAgentEventTarget } from './usePtyEvents';
import type { SessionNode } from '../types/sessionTree';

/**
 * Hook routing, at the point where it decides WHICH session is waiting on you.
 *
 * The existing coverage started one step further downstream: it proved that a
 * notification preserves the node id it was handed. That is true and useless
 * here — the defect was in choosing the id.
 */

function node(id: string, cwd: string): SessionNode {
  return {
    id,
    groupId: 'g1',
    title: id,
    number: null,
    kind: 'terminal',
    cwd,
    gitBranch: '',
    activeBlockId: null,
    isTuiActive: false,
    agentState: 'idle',
    tuiLines: [],
    commandHistory: [],
    createdAt: 0,
  };
}

const nodes: Record<string, SessionNode> = {
  first: node('first', '/repo'),
  second: node('second', '/repo'),
  elsewhere: node('elsewhere', '/other'),
};

describe('two agents in one repository', () => {
  it('routes to the pane the hook named, not the first one in the directory', () => {
    // The whole failure: `find(n => n.cwd === cwd)` returned `first` for both
    // agents, so the wrong session was marked as blocked and the native
    // notification focused a session that was not asking anything.
    expect(resolveAgentEventTarget(nodes, { cwd: '/repo', doomSessionId: 'second' })?.id).toBe(
      'second',
    );
    expect(resolveAgentEventTarget(nodes, { cwd: '/repo', doomSessionId: 'first' })?.id).toBe(
      'first',
    );
  });

  it('refuses to guess when only the directory is known and it is ambiguous', () => {
    // An agent started before its session carried DOOM_TERM_SESSION_ID. Marking
    // an arbitrary one of the two is worse than marking neither: it puts a
    // session that is not waiting into the attention queue, where the only way
    // to clear it is to visit it.
    expect(resolveAgentEventTarget(nodes, { cwd: '/repo' })).toBeNull();
  });

  it('still correlates by directory when that answer is unambiguous', () => {
    expect(resolveAgentEventTarget(nodes, { cwd: '/other' })?.id).toBe('elsewhere');
  });
});

describe('an event that names nothing we hold', () => {
  it('is dropped rather than applied to something else', () => {
    expect(resolveAgentEventTarget(nodes, { doomSessionId: 'ghost' })).toBeNull();
    expect(resolveAgentEventTarget(nodes, { cwd: '/nowhere' })).toBeNull();
    expect(resolveAgentEventTarget(nodes, {})).toBeNull();
  });

  it('does not fall back to the directory when an explicit id missed', () => {
    // A named pane that we no longer hold is an answer: that session is gone.
    // Falling through to the cwd would resurrect the exact bug this fixes.
    expect(resolveAgentEventTarget(nodes, { cwd: '/other', doomSessionId: 'ghost' })).toBeNull();
  });
});
