import { ProjectWorkspace, SessionGroup, SessionNode, WorkspaceSet } from '../types/sessionTree';
import { uniqueId } from './ids';

const STORAGE_KEY = 'DOOM_TERM_WORKSPACE_V1';

export function createDefaultWorkspace(): ProjectWorkspace {
  const initialNode: SessionNode = {
    id: 'node-1',
    groupId: 'group-main',
    title: 'Terminal 1',
    kind: 'terminal',
    cwd: '~',
    // Unknown until the daemon reports it — same rule as createWorkspaceForFolder.
    gitBranch: '',
    activeBlockId: null,
    isTuiActive: false,
    agentState: 'idle',
    blocks: [],
    tuiLines: [],
    commandHistory: [],
    createdAt: Date.now(),
  };

  const initialGroup: SessionGroup = {
    id: 'group-main',
    projectId: 'project-root',
    name: 'Main Workstream',
    layout: 'single',
    activeNodeId: 'node-1',
    nodeIds: ['node-1'],
    createdAt: Date.now(),
  };

  return {
    id: 'project-root',
    // The home directory, not a path from the author's own machine. Anyone
    // else's first launch pointed at a folder that did not exist.
    name: 'HOME',
    rootPath: '~',
    groups: [initialGroup],
    nodes: {
      'node-1': initialNode,
    },
    activeGroupId: 'group-main',
  };
}

const RECENT_KEY = 'DOOM_TERM_RECENT_WORKSPACES_V1';

export function createWorkspaceForFolder(folderPath: string, customName?: string): ProjectWorkspace {
  const folderName = folderPath.replace(/\/+$/, '').split('/').pop() || 'Workspace';
  const name = customName || folderName.toUpperCase();
  const nodeId = uniqueId('node');
  const groupId = uniqueId('group');
  const projectId = uniqueId('project');

  const initialNode: SessionNode = {
    id: nodeId,
    groupId: groupId,
    title: 'Terminal 1',
    kind: 'terminal',
    cwd: folderPath,
    // Unknown until the daemon reports it. A folder that is not a repository
    // has no branch, and claiming 'main' was how one still showed BRANCH: MAIN.
    gitBranch: '',
    activeBlockId: null,
    isTuiActive: false,
    agentState: 'idle',
    blocks: [],
    tuiLines: [],
    commandHistory: [],
    createdAt: Date.now(),
  };

  const initialGroup: SessionGroup = {
    id: groupId,
    projectId,
    name: 'Main Workstream',
    layout: 'single',
    activeNodeId: nodeId,
    nodeIds: [nodeId],
    createdAt: Date.now(),
  };

  return {
    id: projectId,
    name,
    rootPath: folderPath,
    groups: [initialGroup],
    nodes: {
      [nodeId]: initialNode,
    },
    activeGroupId: groupId,
  };
}

const SET_STORAGE_KEY = 'DOOM_TERM_WORKSPACES_V2';

function singleton(ws: ProjectWorkspace): WorkspaceSet {
  return { workspaces: [ws], activeWorkspaceId: ws.id };
}

export class SessionStore {
  private static saveTimeout: number | null = null;

  public static loadWorkspaceSet(): WorkspaceSet {
    if (typeof window === 'undefined' || !window.localStorage) {
      return singleton(createDefaultWorkspace());
    }

    try {
      const saved = window.localStorage.getItem(SET_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as WorkspaceSet;
        if (parsed.workspaces?.length) return parsed;
      }

      // Migrate a V1 single workspace rather than dropping the user's sessions.
      const legacy = window.localStorage.getItem(STORAGE_KEY);
      if (legacy) {
        const ws = JSON.parse(legacy) as ProjectWorkspace;
        if (ws.groups && ws.nodes && Object.keys(ws.nodes).length > 0) return singleton(ws);
      }
    } catch (e) {
      console.warn('⚡ Failed to restore Doom Term workspaces from storage, starting fresh:', e);
    }

    return singleton(createDefaultWorkspace());
  }

  public static saveWorkspaceSet(set: WorkspaceSet) {
    if (typeof window === 'undefined' || !window.localStorage) return;

    if (this.saveTimeout) {
      window.clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = window.setTimeout(() => {
      try {
        window.localStorage.setItem(SET_STORAGE_KEY, JSON.stringify(set));
        const active = set.workspaces.find((w) => w.id === set.activeWorkspaceId);
        if (active) this.addRecentWorkspace(active.rootPath, active.name);
      } catch (e) {
        console.warn('⚡ Error saving workspaces to storage:', e);
      }
    }, 400);
  }

  /** Only paths the user has actually opened. A clean machine has no recents. */
  public static loadRecentWorkspaces(): { name: string; path: string }[] {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    try {
      const saved = window.localStorage.getItem(RECENT_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return [];
  }

  public static addRecentWorkspace(path: string, name?: string) {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const current = this.loadRecentWorkspaces().filter((r) => r.path !== path);
      const folderName = path.replace(/\/+$/, '').split('/').pop() || 'Workspace';
      current.unshift({
        name: name || folderName.toUpperCase(),
        path,
      });
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(current.slice(0, 10)));
    } catch {
      // ignore
    }
  }
}
