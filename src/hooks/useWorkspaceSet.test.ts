import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useWorkspaceSet } from './useWorkspaceSet';
import { usePtyEvents } from './usePtyEvents';
import { ptyClient } from '../core/ptyClient';
import { useState } from 'react';
import type { AppTelemetry } from '../hud/state';
import { closeDisposition } from '../core/sessionClose';
import { leafSessionIds } from '../core/paneTree';

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
  it('repairs duplicate restored numbers while preserving already unique slots', () => {
    const stored = JSON.parse(storedSet());
    const other = structuredClone(stored.workspaces[0]);
    other.id = 'second';
    other.rootPath = '/second';
    other.nodes = {
      n2: { ...other.nodes.n1, id: 'n2', number: 1 },
      n3: { ...other.nodes.n1, id: 'n3', number: 2 },
    };
    other.groups[0].nodeIds = ['n2', 'n3'];
    other.groups[0].activeNodeId = 'n2';
    other.groups[0].paneTree = { type: 'leaf', sessionId: 'n2' };
    stored.workspaces.push(other);
    store.set(V2, JSON.stringify(stored));
    const { result } = renderHook(() => useWorkspaceSet());
    const numbers = result.current.workspaceSet.workspaces.flatMap(w => Object.values(w.nodes).map(n => n.number));
    expect(numbers).toEqual([1, 3, 2]);
  });

  it('allocates new terminals from slots free across all workspaces', () => {
    store.set(V2, storedSet());
    const { result } = renderHook(() => useWorkspaceSet());
    act(() => result.current.handleOpenWorkspaceFolder('/second'));
    act(() => result.current.handleCreateNode(result.current.activeGroup.id));
    const numbers = result.current.workspaceSet.workspaces.flatMap(w => Object.values(w.nodes).map(n => n.number));
    expect(numbers).toEqual([1, 2, 3]);
  });
  it('creates a terminal in its selected group directory before telemetry arrives', () => {
    store.set(V2, storedSet());
    const { result } = renderHook(() => useWorkspaceSet());
    act(() => result.current.handleOpenWorkspaceFolder('/second'));
    act(() => result.current.handleCreateNode(result.current.activeGroup.id));
    expect(result.current.activeNode.cwd).toBe('/second');
    expect(result.current.activeNode.gitBranch).toBe('');
  });
  it('preserves sibling panes when creating a normal terminal inside an explicit split', () => {
    store.set(V2, storedSet());
    const { result } = renderHook(() => useWorkspaceSet());
    act(() => result.current.handleCreateNode('g', 'terminal', 'row'));
    expect(leafSessionIds(result.current.activeGroup.paneTree!)).toHaveLength(2);
    let replacement: string;
    act(() => { replacement = result.current.handleCreateNode('g'); });
    expect(leafSessionIds(result.current.activeGroup.paneTree!)).toEqual(['n1', replacement!]);
  });
  it('does not kill sessions when closing the last workspace is refused', () => {
    store.set(V2, storedSet());
    const kill = vi.spyOn(ptyClient, 'killSession').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useWorkspaceSet());
      act(() => result.current.handleCloseWorkspace('w'));
      expect(result.current.workspace.id).toBe('w');
      expect(result.current.activeNode.id).toBe('n1');
      expect(kill).not.toHaveBeenCalled();
    } finally { kill.mockRestore(); }
  });
  it('selects a session in its owning workspace without adding it to the foreground group', () => {
    store.set(V2, storedSet());
    const { result } = renderHook(() => useWorkspaceSet());
    act(() => result.current.handleOpenWorkspaceFolder('/second'));
    const secondId = result.current.workspace.id;
    act(() => result.current.handleSelectNode('n1'));
    expect(result.current.workspace.id).toBe('w');
    expect(result.current.activeNode.id).toBe('n1');
    expect(result.current.activeGroup.paneTree).toMatchObject({ type: 'leaf', sessionId: 'n1' });
    expect(result.current.workspaceSet.workspaces.find(w => w.id === secondId)!.groups[0].nodeIds).not.toContain('n1');
    act(() => result.current.handleSelectNode('nonexistent'));
    expect(result.current.activeNode.id).toBe('n1');
    expect(ptyClient.getSessionId()).toBe('n1');
  });
  it('keeps a rendered shell prompt idle until execution actually starts', () => {
    store.set(V2, storedSet());
    const { result } = renderHook(() => {
      const workspaces = useWorkspaceSet();
      const [, setTelemetry] = useState<AppTelemetry>({});
      usePtyEvents(workspaces.setEventWorkspace, setTelemetry);
      return workspaces;
    });
    const receive = (event: string) => (ptyClient as unknown as {
      handleServerMessage: (message: unknown) => void;
    }).handleServerMessage({ event: 'PtyEvent', data: { session_id: 'n1', event: { type: event } } });
    act(() => { receive('PromptStart'); receive('CommandStart'); });
    expect(closeDisposition(result.current.activeNode)).toBe('kill');
    act(() => receive('ExecutionStart'));
    expect(closeDisposition(result.current.activeNode)).toBe('confirm');
  });
  it('routes background workspace events without changing focus or visible telemetry', () => {
    store.set(V2, storedSet());
    const { result } = renderHook(() => {
      const workspaces = useWorkspaceSet();
      const [telemetry, setTelemetry] = useState<AppTelemetry>({ cwd: '/visible' });
      usePtyEvents(workspaces.setEventWorkspace, setTelemetry);
      return { ...workspaces, telemetry };
    });
    act(() => result.current.handleOpenWorkspaceFolder('/visible'));
    const activeId = result.current.activeNode.id;
    ptyClient.setActiveSession(activeId);
    const receive = (message: unknown) => (ptyClient as unknown as {
      handleServerMessage: (message: unknown) => void;
    }).handleServerMessage(message);
    act(() => {
      receive({ event: 'AgentEvent', data: { agent: 'claude', event: 'PermissionRequest', doom_session_id: 'n1', cwd: '/home/u/proj' } });
      receive({ event: 'Telemetry', data: { session_id: 'n1', current_dir: '/home/u/proj/sub', git_branch: 'feature/observed', agent_key: 'claude', isolation: 'host' } });
    });
    const background = result.current.workspaceSet.workspaces.find((w) => w.id === 'w')!.nodes.n1;
    expect(background.blockedOnUser).toBe(true);
    expect(background.gitBranch).toBe('feature/observed');
    expect(background.cwd).toBe('/home/u/proj/sub');
    expect(result.current.activeNode.id).toBe(activeId);
    expect(result.current.telemetry.cwd).toBe('/visible');
    act(() => receive({ event: 'SessionClosed', data: { session_id: 'n1' } }));
    expect(result.current.workspaceSet.workspaces.find((w) => w.id === 'w')!.nodes.n1.exited).toBe(true);
  });
  it('asks where to open when there is nothing to restore', () => {
    const { result } = renderHook(() => useWorkspaceSet());
    expect(result.current.needsWorkspaceChoice).toBe(true);
  });

  it('does not ask when a workspace was restored', () => {
    // The folder was chosen once already; asking again every launch would be a
    // gate in front of work that is still running.
    store.set(V2, storedSet());
    const { result } = renderHook(() => useWorkspaceSet());
    expect(result.current.needsWorkspaceChoice).toBe(false);
    expect(result.current.workspace.rootPath).toBe('/home/u/proj');
  });

  it('opens the chosen folder as the only workspace', () => {
    const { result } = renderHook(() => useWorkspaceSet());
    act(() => result.current.chooseStartupWorkspace('/home/u/proj'));
    expect(result.current.needsWorkspaceChoice).toBe(false);
    expect(result.current.workspaceSet.workspaces).toHaveLength(1);
    expect(result.current.workspace.rootPath).toBe('/home/u/proj');
  });

  it('gives the chosen folder a session that may be bound', () => {
    // Nothing about it came off disk, so it must not wait on recovery and must
    // never be drawn as a snapshot of a session that never existed.
    const { result } = renderHook(() => useWorkspaceSet());
    act(() => result.current.chooseStartupWorkspace('/home/u/proj'));
    expect(result.current.bindingFor(result.current.activeNode.id)).toBe('ready');
  });

  it('opens HOME with a live session when the picker is dismissed', () => {
    // Esc is the documented way out, and it has to leave somewhere to type.
    const { result } = renderHook(() => useWorkspaceSet());
    act(() => result.current.dismissStartupChoice());
    expect(result.current.needsWorkspaceChoice).toBe(false);
    expect(result.current.workspace.rootPath).toBe('~');
    expect(result.current.bindingFor(result.current.activeNode.id)).toBe('ready');
  });

  it('remembers nothing while the choice is owed', () => {
    // Persisting the placeholder would make the next launch look like a
    // restore, and the prompt would never appear again.
    vi.useFakeTimers();
    renderHook(() => useWorkspaceSet());
    act(() => void vi.advanceTimersByTime(1000));
    expect(store.get(V2)).toBeUndefined();
  });

  it('remembers the workspace once the choice is made', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorkspaceSet());
    act(() => result.current.chooseStartupWorkspace('/home/u/proj'));
    act(() => void vi.advanceTimersByTime(1000));
    expect(store.get(V2)).toContain('/home/u/proj');
  });
});
