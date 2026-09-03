import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PaneDirection, PaneTree, ProjectWorkspace, SessionNode, SplitLayoutMode, WorkspaceSet,
} from '../types/sessionTree';
import { SessionStore, createWorkspaceForFolder } from '../core/sessionStore';
import { activeWorkspace, closeWorkspace, openWorkspace, replaceWorkspace } from '../core/workspaceSet';
import { nextSessionTitle, derivedSessionTitle } from '../core/sessionNaming';
import { nextSessionNumber } from '../core/sessionNumbers';
import { uniqueId } from '../core/ids';
import { disposeEmulator, BOOTSTRAP_COLS, BOOTSTRAP_ROWS } from '../core/emulatorRegistry';
import { disposeActivity } from '../core/activityMonitor';
import { attentionQueue } from '../core/attentionQueue';
import { ptyClient } from '../core/ptyClient';
import { audioEngine } from '../core/audioEngine';
import { equalizeTree, leafSessionIds, paneLeaf, removeLeaf, replaceLeaf, splitLeaf, treeFromLayout } from '../core/paneTree';
import {
  reconcileSessions, type RecoverableSession, type RecoveryState,
} from '../core/sessionRecovery';

/** Where a new session starts when the daemon has told us where we are. */
export interface SessionDefaults {
  cwd?: string;
  branch?: string;
}

/**
 * All open project folders, the one in focus, and everything that mutates
 * them.
 *
 * `setWorkspace` edits whichever workspace has focus and leaves the rest of
 * the set alone, so callers written against a single workspace keep working.
 */
export function useWorkspaceSet(telemetry: SessionDefaults) {
  const [workspaceSet, setWorkspaceSet] = useState<WorkspaceSet>(() =>
    SessionStore.loadWorkspaceSet()
  );
  const workspace = useMemo(() => activeWorkspace(workspaceSet), [workspaceSet]);
  const workspaceSetRef = useRef(workspaceSet);
  workspaceSetRef.current = workspaceSet;
  const [recoveryState, setRecoveryState] = useState<RecoveryState>({
    matched: [], recoverable: [], snapshots: [],
  });

  const setWorkspace = useCallback(
    (updater: (prev: ProjectWorkspace) => ProjectWorkspace) => {
      setWorkspaceSet((prevSet) => replaceWorkspace(prevSet, updater(activeWorkspace(prevSet))));
    },
    []
  );

  const activeGroup = useMemo(
    () => workspace.groups.find((g) => g.id === workspace.activeGroupId) || workspace.groups[0],
    [workspace]
  );

  const activeNode = useMemo(
    () => workspace.nodes[activeGroup.activeNodeId] || Object.values(workspace.nodes)[0],
    [workspace, activeGroup]
  );

  useEffect(() => {
    SessionStore.saveWorkspaceSet(workspaceSet);
  }, [workspaceSet]);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      if (!ptyClient.getIsConnected()) return;
      try {
        const listing = await ptyClient.listSessions();
        if (disposed) return;
        const storedIds = workspaceSetRef.current.workspaces.flatMap((candidate) =>
          Object.keys(candidate.nodes)
        );
        const next = reconcileSessions(storedIds, listing.sessions);
        setRecoveryState((previous) =>
          JSON.stringify(previous) === JSON.stringify(next) ? previous : next
        );
      } catch {
        // A daemon restart is normal. The next interval asks again; recovery
        // never turns a missing reply into an automatic spawn.
      }
    };
    void refresh();
    // Longer than the request's 5 s timeout, so an unresponsive daemon cannot
    // accumulate overlapping recovery requests.
    const timer = window.setInterval(() => void refresh(), 6000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  const handleCreateNode = (
    groupId: string,
    kind: SessionNode['kind'] = 'terminal',
    splitDirection?: PaneDirection,
  ) => {
    const newNodeId = uniqueId('node');
    const cwd = telemetry.cwd ?? '~';
    const branch = telemetry.branch ?? '';
    // A terminal is identified by where it is; a scratchpad has no location to
    // be identified by, so it keeps the counted title.
    const title =
      kind === 'scratchpad'
        ? nextSessionTitle(kind, Object.values(workspace.nodes).map((n) => n.title))
        : derivedSessionTitle(cwd, branch);
    const group = workspace.groups.find((g) => g.id === groupId) || activeGroup;

    const newNode: SessionNode = {
      id: newNodeId,
      groupId: group.id,
      title,
      // Lowest free slot across the whole workspace, so closing 2 and opening
      // another gives you 2 again rather than drifting out of Ctrl+N's reach.
      number: nextSessionNumber(
        Object.values(workspace.nodes)
          .map((n) => n.number)
          .filter((n): n is number => n !== null),
      ),
      kind,
      cwd,
      // No branch until the daemon reports one for this directory.
      gitBranch: branch,
      activeBlockId: null,
      isTuiActive: false,
      agentState: 'idle',
      tuiLines: [],
      commandHistory: [],
      scratchpadContent: kind === 'scratchpad' ? '' : undefined,
      createdAt: Date.now(),
    };

    setWorkspace((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => {
        if (g.id !== group.id) return g;
        const baseTree = g.paneTree
          ?? treeFromLayout(g.layout, [g.activeNodeId, ...g.nodeIds.filter((id) => id !== g.activeNodeId)]);
        const paneTree = splitDirection && baseTree
          ? splitLeaf(baseTree, g.activeNodeId, newNodeId, splitDirection)
          : g.paneTree
            ? (g.layout === 'single'
                ? paneLeaf(newNodeId)
                : splitLeaf(g.paneTree, g.activeNodeId, newNodeId, 'row'))
            : undefined;
        return {
          ...g,
          activeNodeId: newNodeId,
          nodeIds: [...g.nodeIds, newNodeId],
          paneTree,
        };
      }),
      nodes: {
        ...prev.nodes,
        [newNodeId]: newNode,
      },
    }));

    if (kind === 'terminal' || kind === 'agent') {
      ptyClient.setActiveSession(newNodeId);
      ptyClient.spawnSession(newNodeId, BOOTSTRAP_COLS, BOOTSTRAP_ROWS, newNode.cwd);
    }
    return newNodeId;
  };

  const handleRenameNode = (nodeId: string, newTitle: string) => {
    setWorkspace((prev) => {
      const node = prev.nodes[nodeId];
      if (!node) return prev;
      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [nodeId]: {
            ...node,
            title: newTitle,
            // Yours now. Derivation must never take it back.
            titleLocked: true,
          },
        },
      };
    });
    audioEngine.playSound('click', 3);
  };

  // Opening a folder adds a workspace. It used to replace the whole state,
  // which discarded the previous folder's sessions and scrollback outright.
  const handleOpenWorkspaceFolder = (folderPath: string, name?: string) => {
    setWorkspaceSet((prev) => {
      const next = openWorkspace(prev, createWorkspaceForFolder(folderPath, name));
      const opened = activeWorkspace(next);
      const nodeId = opened.groups[0]?.activeNodeId;
      if (nodeId) {
        ptyClient.ensureSession(nodeId, opened.rootPath);
        ptyClient.requestTelemetry(opened.rootPath);
      }
      return next;
    });
    audioEngine.playSound('door', 2);
  };

  const handleSelectWorkspace = (id: string) => {
    setWorkspaceSet((prev) => {
      const next = { ...prev, activeWorkspaceId: id };
      const ws = activeWorkspace(next);
      const nodeId = ws.groups.find((g) => g.id === ws.activeGroupId)?.activeNodeId;
      if (nodeId) {
        // The daemon still owns this session, so this binds rather than
        // spawning a second shell in the same folder. It no longer replays:
        // this connection has been receiving the session all along.
        ptyClient.ensureSession(nodeId, ws.rootPath);
        ptyClient.requestTelemetry(ws.rootPath);
      }
      return next;
    });
  };

  const handleCloseWorkspace = (id: string) => {
    const closing = workspaceSet.workspaces.find((w) => w.id === id);
    Object.values(closing?.nodes ?? {}).forEach((node) => {
      if (node.kind !== 'scratchpad') ptyClient.killSession(node.id);
    });
    setWorkspaceSet((prev) => closeWorkspace(prev, id));
  };

  const handleSelectNode = (nodeId: string, groupId?: string) => {
    const targetGroupId = groupId || workspace.nodes[nodeId]?.groupId || activeGroup.id;
    setWorkspace((prev) => ({
      ...prev,
      activeGroupId: targetGroupId,
      groups: prev.groups.map((g) => {
        if (g.id !== targetGroupId) return g;

        let nextPaneTree: PaneTree | undefined;
        if (g.layout === 'single') {
          nextPaneTree = paneLeaf(nodeId);
        } else if (g.paneTree) {
          const leaves = leafSessionIds(g.paneTree);
          if (leaves.includes(nodeId)) {
            nextPaneTree = g.paneTree;
          } else {
            nextPaneTree = replaceLeaf(g.paneTree, g.activeNodeId, nodeId);
          }
        } else {
          nextPaneTree = paneLeaf(nodeId);
        }

        return {
          ...g,
          activeNodeId: nodeId,
          nodeIds: g.nodeIds.includes(nodeId) ? g.nodeIds : [...g.nodeIds, nodeId],
          paneTree: nextPaneTree,
          zoomedSessionId: g.zoomedSessionId ? nodeId : undefined,
        };
      }),
      nodes: prev.nodes[nodeId]
        ? {
            ...prev.nodes,
            [nodeId]: { ...prev.nodes[nodeId], parked: false, lastUsedAt: Date.now() },
          }
        : prev.nodes,
    }));
    ptyClient.setActiveSession(nodeId);
  };

  /** Restoring is selecting: it re-enters geometry and takes keyboard focus. */
  const handleRestoreNode = (nodeId: string) => handleSelectNode(nodeId);

  const handleRecoverSession = (session: RecoverableSession) => {
    if (workspace.nodes[session.id]) {
      handleSelectNode(session.id);
      return;
    }
    const group = activeGroup;
    const recovered: SessionNode = {
      id: session.id,
      groupId: group.id,
      title: derivedSessionTitle(session.cwd || '~', ''),
      number: nextSessionNumber(
        Object.values(workspace.nodes).map((node) => node.number).filter((n): n is number => n !== null),
      ),
      kind: 'terminal',
      cwd: session.cwd || '~',
      gitBranch: '',
      activeBlockId: null,
      isTuiActive: false,
      agentState: 'idle',
      tuiLines: [],
      commandHistory: [],
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };
    setWorkspace((prev) => ({
      ...prev,
      activeGroupId: group.id,
      groups: prev.groups.map((candidate) => {
        if (candidate.id !== group.id) return candidate;
        const base = candidate.paneTree ?? paneLeaf(candidate.activeNodeId);
        return {
          ...candidate,
          activeNodeId: session.id,
          nodeIds: [...candidate.nodeIds, session.id],
          paneTree: splitLeaf(base, candidate.activeNodeId, session.id, 'row'),
        };
      }),
      nodes: { ...prev.nodes, [session.id]: recovered },
    }));
    // Spawn is attach-or-create. For a listed tmux id this attaches and replays
    // its buffer; it never re-executes the command reported by ListSessions.
    ptyClient.ensureSession(session.id, recovered.cwd);
    setRecoveryState((previous) => ({
      ...previous,
      matched: [...previous.matched, session.id],
      recoverable: previous.recoverable.filter((candidate) => candidate.id !== session.id),
    }));
  };

  const handleSetGroupLayout = (groupId: string, layout: SplitLayoutMode) => {
    setWorkspace((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => g.id === groupId
        ? {
            ...g,
            layout,
            paneTree: treeFromLayout(
              layout,
              [g.activeNodeId, ...g.nodeIds.filter((id) => id !== g.activeNodeId)],
            ) ?? undefined,
          }
        : g),
    }));
    audioEngine.playSound('click', 3);
  };

  const handleSetPaneTree = (groupId: string, paneTree: PaneTree) => {
    setWorkspace((prev) => ({
      ...prev,
      groups: prev.groups.map((group) => group.id === groupId ? { ...group, paneTree } : group),
    }));
  };

  const handleEqualizePanes = (groupId: string) => {
    setWorkspace((prev) => ({
      ...prev,
      groups: prev.groups.map((group) => group.id === groupId && group.paneTree
        ? { ...group, paneTree: equalizeTree(group.paneTree) }
        : group),
    }));
  };

  const handleTogglePaneZoom = (groupId: string, sessionId: string) => {
    setWorkspace((prev) => ({
      ...prev,
      groups: prev.groups.map((group) => group.id === groupId
        ? {
            ...group,
            zoomedSessionId: group.zoomedSessionId === sessionId ? undefined : sessionId,
          }
        : group),
    }));
  };

  const handleParkNode = (nodeId: string) => {
    const node = workspace.nodes[nodeId];
    const group = workspace.groups.find((candidate) => candidate.id === node?.groupId);
    if (!node || !group) return;
    const sibling = group.nodeIds.find((id) => id !== nodeId);
    const fallback = sibling ?? handleCreateNode(group.id, 'terminal');

    setWorkspace((prev) => ({
      ...prev,
      groups: prev.groups.map((candidate) => {
        if (candidate.id !== group.id) return candidate;
        return {
          ...candidate,
          nodeIds: candidate.nodeIds.filter((id) => id !== nodeId),
          activeNodeId: candidate.activeNodeId === nodeId ? fallback : candidate.activeNodeId,
          paneTree: candidate.paneTree
            ? removeLeaf(candidate.paneTree, nodeId) ?? paneLeaf(fallback)
            : paneLeaf(fallback),
          zoomedSessionId: candidate.zoomedSessionId === nodeId
            ? undefined
            : candidate.zoomedSessionId,
        };
      }),
      nodes: {
        ...prev.nodes,
        [nodeId]: { ...prev.nodes[nodeId], parked: true },
      },
    }));
    ptyClient.setActiveSession(fallback);
  };

  const handleKillNode = (nodeId: string) => {
    // Closing the last session used to be refused outright, which left Ctrl+W
    // silently doing nothing and no way at all to restart a wedged shell — and
    // with the tab strip gone there is no × to fall back on either. There must
    // always be somewhere to type, so replace it rather than refuse: open a
    // fresh session first, then close this one.
    const group = workspace.groups.find((candidate) => candidate.id === workspace.nodes[nodeId]?.groupId);
    if (group && group.nodeIds.length <= 1 && !workspace.nodes[nodeId]?.parked) {
      handleCreateNode(group.id, 'terminal');
    }

    ptyClient.killSession(nodeId);
    disposeEmulator(nodeId);
    disposeActivity(nodeId);
    attentionQueue.dispose(nodeId);

    setWorkspace((prev) => {
      const nextNodes = { ...prev.nodes };
      delete nextNodes[nodeId];

      const nextGroups = prev.groups
        .map((g) => {
          const filtered = g.nodeIds.filter((id) => id !== nodeId);
          return {
            ...g,
            nodeIds: filtered,
            activeNodeId: g.activeNodeId === nodeId ? filtered[0] || '' : g.activeNodeId,
            paneTree: g.paneTree ? removeLeaf(g.paneTree, nodeId) ?? undefined : undefined,
            zoomedSessionId: g.zoomedSessionId === nodeId ? undefined : g.zoomedSessionId,
          };
        })
        .filter((g) => g.nodeIds.length > 0);

      const nextActiveGroupId = nextGroups.some((g) => g.id === prev.activeGroupId)
        ? prev.activeGroupId
        : nextGroups[0]?.id || '';

      return {
        ...prev,
        activeGroupId: nextActiveGroupId,
        groups: nextGroups,
        nodes: nextNodes,
      };
    });
  };

  return {
    workspaceSet,
    workspace,
    setWorkspace,
    activeGroup,
    activeNode,
    recoveryState,
    handleCreateNode,
    handleRenameNode,
    handleOpenWorkspaceFolder,
    handleSelectWorkspace,
    handleCloseWorkspace,
    handleSelectNode,
    handleRestoreNode,
    handleRecoverSession,
    handleSetGroupLayout,
    handleSetPaneTree,
    handleEqualizePanes,
    handleTogglePaneZoom,
    handleParkNode,
    handleKillNode,
  };
}
