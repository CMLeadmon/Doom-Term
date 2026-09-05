import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useWorkspaceSet } from './useWorkspaceSet';

/**
 * jsdom's `localStorage` is shadowed here by Node's own experimental global,
 * which is unavailable without `--localstorage-file`, so `window.localStorage`
 * is undefined by default. The hook reads storage at mount, so every case needs
 * a real one — see the same workaround in core/sessionStore.test.ts.
 */
const V2 = 'DOOM_TERM_WORKSPACES_V2';
let store: Map<string, string>;
let original: PropertyDescriptor | undefined;

beforeEach(() => {
  store = new Map();
  original = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
});

afterEach(() => {
  if (original) Object.defineProperty(window, 'localStorage', original);
  else delete (window as unknown as Record<string, unknown>).localStorage;
  vi.useRealTimers();
});

/** A stored set, as a previous run would have left it. */
const storedSet = () => JSON.stringify({
  workspaces: [{
    id: 'w', name: 'PROJ', rootPath: '/home/u/proj', activeGroupId: 'g',
    groups: [{
      id: 'g', projectId: 'w', name: 'Main Workstream', layout: 'single',
      activeNodeId: 'n1', nodeIds: ['n1'], paneTree: { type: 'leaf', sessionId: 'n1' },
      createdAt: 1,
    }],
    nodes: {
      n1: {
        id: 'n1', groupId: 'g', title: 'Terminal 1', number: 1, kind: 'terminal',
        cwd: '/home/u/proj', gitBranch: '', activeBlockId: null, isTuiActive: false,
        agentState: 'idle', tuiLines: [], commandHistory: [], createdAt: 1,
      },
    },
  }],
  activeWorkspaceId: 'w',
});

describe('first-run workspace choice', () => {
  it('asks where to open when there is nothing to restore', () => {
    const { result } = renderHook(() => useWorkspaceSet({}));
    expect(result.current.needsWorkspaceChoice).toBe(true);
  });

  it('does not ask when a workspace was restored', () => {
    // The folder was chosen once already; asking again every launch would be a
    // gate in front of work that is still running.
    store.set(V2, storedSet());
    const { result } = renderHook(() => useWorkspaceSet({}));
    expect(result.current.needsWorkspaceChoice).toBe(false);
    expect(result.current.workspace.rootPath).toBe('/home/u/proj');
  });

  it('opens the chosen folder as the only workspace', () => {
    const { result } = renderHook(() => useWorkspaceSet({}));
    act(() => result.current.chooseStartupWorkspace('/home/u/proj'));
    expect(result.current.needsWorkspaceChoice).toBe(false);
    expect(result.current.workspaceSet.workspaces).toHaveLength(1);
    expect(result.current.workspace.rootPath).toBe('/home/u/proj');
  });

  it('gives the chosen folder a session that may be bound', () => {
    // Nothing about it came off disk, so it must not wait on recovery and must
    // never be drawn as a snapshot of a session that never existed.
    const { result } = renderHook(() => useWorkspaceSet({}));
    act(() => result.current.chooseStartupWorkspace('/home/u/proj'));
    expect(result.current.bindingFor(result.current.activeNode.id)).toBe('ready');
  });

  it('opens HOME with a live session when the picker is dismissed', () => {
    // Esc is the documented way out, and it has to leave somewhere to type.
    const { result } = renderHook(() => useWorkspaceSet({}));
    act(() => result.current.dismissStartupChoice());
    expect(result.current.needsWorkspaceChoice).toBe(false);
    expect(result.current.workspace.rootPath).toBe('~');
    expect(result.current.bindingFor(result.current.activeNode.id)).toBe('ready');
  });

  it('remembers nothing while the choice is owed', () => {
    // Persisting the placeholder would make the next launch look like a
    // restore, and the prompt would never appear again.
    vi.useFakeTimers();
    renderHook(() => useWorkspaceSet({}));
    act(() => void vi.advanceTimersByTime(1000));
    expect(store.get(V2)).toBeUndefined();
  });

  it('remembers the workspace once the choice is made', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorkspaceSet({}));
    act(() => result.current.chooseStartupWorkspace('/home/u/proj'));
    act(() => void vi.advanceTimersByTime(1000));
    expect(store.get(V2)).toContain('/home/u/proj');
  });
});
