import { ProjectWorkspace, SessionGroup, SessionNode } from '../types/sessionTree';
import { parseAnsiText } from './ansiParser';

const STORAGE_KEY = 'DOOM_TERM_WORKSPACE_V1';

export function createDefaultWorkspace(): ProjectWorkspace {
  const initialNode: SessionNode = {
    id: 'node-1',
    groupId: 'group-main',
    title: 'Terminal 1',
    kind: 'terminal',
    cwd: '~/Projects/Doom Term',
    gitBranch: 'main',
    activeBlockId: null,
    isTuiActive: false,
    agentState: 'idle',
    blocks: [
      {
        id: 'welcome-block',
        command: 'doom-term --version',
        status: 'completed',
        startedAt: Date.now() - 2000,
        completedAt: Date.now() - 1950,
        durationMs: 50,
        exitCode: 0,
        gitBranch: 'main',
        liveLines: parseAnsiText(
          '\x1b[33m⚡ Doom Term v0.2.0 (Architectural Baseline)\x1b[0m\n\x1b[32m[+] 20 Architectural Improvements from nodeterm & VelaTerm Active\x1b[0m\n\x1b[36m[+] Hierarchical Project / Worktree Tree & Split Grid Compositor Active\x1b[0m\n\x1b[35m[+] Inter-Node Context Links & Queued Inter-Agent Messaging Bus Ready\x1b[0m\n\x1b[34m[+] Multi-Lens Verification Panel & Live Markdown Scratchpad Armed\x1b[0m\nPress Ctrl+P for Command Palette, Ctrl+Shift+T for New Terminal, Alt+Arrow for Split Panes.'
        ),
        snapshot: {
          id: 'welcome-snapshot',
          lines: parseAnsiText(
            '\x1b[33m⚡ Doom Term v0.2.0 (Architectural Baseline)\x1b[0m\n\x1b[32m[+] 20 Architectural Improvements from nodeterm & VelaTerm Active\x1b[0m\n\x1b[36m[+] Hierarchical Project / Worktree Tree & Split Grid Compositor Active\x1b[0m\n\x1b[35m[+] Inter-Node Context Links & Queued Inter-Agent Messaging Bus Ready\x1b[0m\n\x1b[34m[+] Multi-Lens Verification Panel & Live Markdown Scratchpad Armed\x1b[0m\nPress Ctrl+P for Command Palette, Ctrl+Shift+T for New Terminal, Alt+Arrow for Split Panes.'
          ),
          exitCode: 0,
          durationMs: 50,
          completedAt: Date.now() - 1950,
          totalLines: 6,
        },
      },
    ],
    tuiLines: [],
    commandHistory: ['doom-term --version', 'cargo check', 'git status'],
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
    name: 'Doom Term Workspace',
    rootPath: '~/Projects/Doom Term',
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
  const nodeId = `node-${Date.now()}`;
  const groupId = `group-${Date.now()}`;

  const initialNode: SessionNode = {
    id: nodeId,
    groupId: groupId,
    title: 'Terminal 1',
    kind: 'terminal',
    cwd: folderPath,
    gitBranch: 'main',
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
    projectId: `project-${Date.now()}`,
    name: 'Main Workstream',
    layout: 'single',
    activeNodeId: nodeId,
    nodeIds: [nodeId],
    createdAt: Date.now(),
  };

  return {
    id: `project-${Date.now()}`,
    name,
    rootPath: folderPath,
    groups: [initialGroup],
    nodes: {
      [nodeId]: initialNode,
    },
    activeGroupId: groupId,
  };
}

export class SessionStore {
  private static saveTimeout: number | null = null;

  public static loadWorkspace(): ProjectWorkspace {
    if (typeof window === 'undefined' || !window.localStorage) {
      return createDefaultWorkspace();
    }

    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (!saved) return createDefaultWorkspace();
      const parsed = JSON.parse(saved) as ProjectWorkspace;
      if (!parsed.groups || !parsed.nodes || Object.keys(parsed.nodes).length === 0) {
        return createDefaultWorkspace();
      }
      return parsed;
    } catch (e) {
      console.warn('⚡ Failed to restore Doom Term workspace from storage, using default:', e);
      return createDefaultWorkspace();
    }
  }

  public static saveWorkspace(workspace: ProjectWorkspace) {
    if (typeof window === 'undefined' || !window.localStorage) return;

    if (this.saveTimeout) {
      window.clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
        this.addRecentWorkspace(workspace.rootPath, workspace.name);
      } catch (e) {
        console.warn('⚡ Error saving workspace to storage:', e);
      }
    }, 400);
  }

  public static loadRecentWorkspaces(): { name: string; path: string }[] {
    if (typeof window === 'undefined' || !window.localStorage) {
      return [
        { name: 'DOOM TERM', path: '~/Projects/Doom Term' },
      ];
    }
    try {
      const saved = window.localStorage.getItem(RECENT_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return [
      { name: 'DOOM TERM', path: '~/Projects/Doom Term' },
    ];
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
