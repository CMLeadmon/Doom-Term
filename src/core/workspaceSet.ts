import { ProjectWorkspace, WorkspaceSet } from '../types/sessionTree';

export function activeWorkspace(set: WorkspaceSet): ProjectWorkspace {
  return set.workspaces.find((w) => w.id === set.activeWorkspaceId) ?? set.workspaces[0];
}

/**
 * Add a workspace, or focus the one already holding that folder.
 *
 * Opening used to replace the whole state, which discarded the previous
 * folder's sessions and scrollback outright.
 */
export function openWorkspace(set: WorkspaceSet, ws: ProjectWorkspace): WorkspaceSet {
  const existing = set.workspaces.find((w) => w.rootPath === ws.rootPath);
  if (existing) {
    return { ...set, activeWorkspaceId: existing.id };
  }
  return {
    workspaces: [...set.workspaces, ws],
    activeWorkspaceId: ws.id,
  };
}

/** Close a workspace. The last one is never closed — there must be somewhere to type. */
export function closeWorkspace(set: WorkspaceSet, id: string): WorkspaceSet {
  if (set.workspaces.length <= 1) return set;
  const remaining = set.workspaces.filter((w) => w.id !== id);
  return {
    workspaces: remaining,
    activeWorkspaceId:
      set.activeWorkspaceId === id ? remaining[remaining.length - 1].id : set.activeWorkspaceId,
  };
}

/** Swap one workspace for an edited copy, leaving the rest of the set alone. */
export function replaceWorkspace(set: WorkspaceSet, ws: ProjectWorkspace): WorkspaceSet {
  return { ...set, workspaces: set.workspaces.map((w) => (w.id === ws.id ? ws : w)) };
}
