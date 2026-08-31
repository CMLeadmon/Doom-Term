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
  /**
   * The agent key the kernel reports holding this terminal's foreground, or
   * null for a bare shell.
   *
   * Alt-screen (`isTuiActive`) is not enough to decide who owns the keyboard:
   * Antigravity, Claude Code and Codex all draw their prompt INLINE, never
   * entering alt-screen, so a terminal that trusts DECSET 1049 alone leaves
   * them wired to the block editor — which buffers a whole line, submits it as
   * a new command, and slices the scrollback at a mark the agent has already
   * drawn over. See `ownsKeyboard` in App.tsx.
   */
  foregroundAgent?: string | null;
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
