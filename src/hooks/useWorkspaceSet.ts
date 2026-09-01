import { useCallback, useEffect, useMemo, useState } from 'react';
import { ProjectWorkspace, SessionNode, SplitLayoutMode, WorkspaceSet } from '../types/sessionTree';
import { SessionStore, createWorkspaceForFolder } from '../core/sessionStore';
import { activeWorkspace, closeWorkspace, openWorkspace, replaceWorkspace } from '../core/workspaceSet';
import { nextSessionTitle } from '../core/sessionNaming';
import { nextSessionNumber } from '../core/sessionNumbers';
import { uniqueId } from '../core/ids';
import { disposeEmulator, BOOTSTRAP_COLS, BOOTSTRAP_ROWS } from '../core/emulatorRegistry';
import { disposeActivity } from '../core/activityMonitor';
import { ptyClient } from '../core/ptyClient';
import { audioEngine } from '../core/audioEngine';

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

  const handleCreateNode = (groupId: string, kind: SessionNode['kind'] = 'terminal') => {
    const newNodeId = uniqueId('node');
    const title = nextSessionTitle(
      kind,
      Object.values(workspace.nodes).map((n) => n.title)
    );
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
      cwd: telemetry.cwd ?? '~',
      // No branch until the daemon reports one for this directory.
      gitBranch: telemetry.branch ?? '',
      activeBlockId: null,
      isTuiActive: false,
      agentState: 'idle',
      blocks: [],
      tuiLines: [],
      commandHistory: [],
      scratchpadContent: kind === 'scratchpad' ? '' : undefined,
      createdAt: Date.now(),
    };

    setWorkspace((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === group.id
          ? {
              ...g,
              activeNodeId: newNodeId,
              nodeIds: [...g.nodeIds, newNodeId],
            }
          : g
      ),
      nodes: {
        ...prev.nodes,
        [newNodeId]: newNode,
      },
    }));

    if (kind === 'terminal' || kind === 'agent') {
      ptyClient.setActiveSession(newNodeId);
      ptyClient.spawnSession(newNodeId, BOOTSTRAP_COLS, BOOTSTRAP_ROWS, newNode.cwd);
    }
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
        // The daemon still owns this session; ensureSession replays its
        // scrollback rather than spawning a second shell in the same folder.
        ptyClient.ensureSession(nodeId, ws.rootPath);
        ptyClient.requestTelemetry(ws.rootPath);
      }
      return next;
    });
  };

  const handleCloseWorkspace = (id: string) => {
    const closing = workspaceSet.workspaces.find((w) => w.id === id);
    closing?.groups.flatMap((g) => g.nodeIds).forEach((nodeId) => ptyClient.killSession(nodeId));
    setWorkspaceSet((prev) => closeWorkspace(prev, id));
  };

  const handleSelectNode = (nodeId: string, groupId?: string) => {
    const targetGroupId = groupId || workspace.nodes[nodeId]?.groupId || activeGroup.id;
    setWorkspace((prev) => ({
      ...prev,
      activeGroupId: targetGroupId,
      groups: prev.groups.map((g) =>
        g.id === targetGroupId ? { ...g, activeNodeId: nodeId } : g
      ),
    }));
    ptyClient.setActiveSession(nodeId);
  };

  const handleSetGroupLayout = (groupId: string, layout: SplitLayoutMode) => {
    setWorkspace((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => (g.id === groupId ? { ...g, layout } : g)),
    }));
    audioEngine.playSound('click', 3);
  };

  const handleCloseNode = (nodeId: string) => {
    if (Object.keys(workspace.nodes).length <= 1) return;

    ptyClient.killSession(nodeId);
    disposeEmulator(nodeId);
    disposeActivity(nodeId);

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
    handleCreateNode,
    handleRenameNode,
    handleOpenWorkspaceFolder,
    handleSelectWorkspace,
    handleCloseWorkspace,
    handleSelectNode,
    handleSetGroupLayout,
    handleCloseNode,
  };
}
