import { TerminalBlock, AnsiLine } from './terminal';

export type SessionKind = 'terminal' | 'agent' | 'tui' | 'scratchpad';

export type AgentLifecycleState = 'idle' | 'running' | 'waiting_input' | 'verifying' | 'errored';

export type SplitLayoutMode = 'single' | 'split-h' | 'split-v' | 'grid-2x2';

export interface SessionNode {
  id: string;
  groupId: string;
  title: string;
  kind: SessionKind;
  cwd: string;
  gitBranch: string;
  activeBlockId: string | null;
  isTuiActive: boolean;
  agentState: AgentLifecycleState;
  blocks: TerminalBlock[];
  tuiLines: AnsiLine[];
  commandHistory: string[];
  scratchpadContent?: string;
  createdAt: number;
}

export interface SessionGroup {
  id: string;
  projectId: string;
  name: string;
  layout: SplitLayoutMode;
  activeNodeId: string;
  nodeIds: string[];
  createdAt: number;
}

/** Every project folder currently open, and which one has focus. */
export interface WorkspaceSet {
  workspaces: ProjectWorkspace[];
  activeWorkspaceId: string;
}

export interface ProjectWorkspace {
  id: string;
  name: string;
  rootPath: string;
  gitRemote?: string;
  groups: SessionGroup[];
  nodes: Record<string, SessionNode>;
  activeGroupId: string;
}
