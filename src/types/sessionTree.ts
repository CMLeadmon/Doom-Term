import { TerminalBlock, AnsiLine } from './terminal';

export type SessionKind = 'terminal' | 'agent' | 'tui' | 'scratchpad';

export type AgentLifecycleState = 'idle' | 'running' | 'waiting_input' | 'verifying' | 'errored';

export type SplitLayoutMode = 'single' | 'split-h' | 'split-v' | 'grid-2x2';

export interface SessionNode {
  id: string;
  groupId: string;
  title: string;
  /**
   * The stable 1-9 slot this session answers to on Ctrl+N.
   *
   * Null when all nine are taken; such a session still works and is reached
   * from the plate's waiting rows instead. This is the whole addressing scheme
   * now that the tab strip is gone, so it is assigned lowest-free and released
   * on close — see core/sessionNumbers.ts.
   */
  number: number | null;
  /**
   * A user rename wins permanently and is never overwritten by derivation.
   * Without this, naming a session yourself would last only until its agent
   * was handed its next instruction.
   */
  titleLocked?: boolean;
  kind: SessionKind;
  cwd: string;
  gitBranch: string;
  activeBlockId: string | null;
  isTuiActive: boolean;
  /**
   * The agent key the kernel reports holding this terminal's foreground, or
   * null for a bare shell.
   *
   * Identity only, now that there is one view. This used to decide who owned
   * the keyboard, because alt-screen (`isTuiActive`) was not enough: Antigravity,
   * Claude Code and Codex all draw their prompt INLINE and never enter
   * alt-screen, so trusting DECSET 1049 alone wired them to the block editor —
   * which buffered a whole line and lost characters to the agent's own redraw.
   * The block editor is gone and every session is pass-through, so the question
   * no longer exists. The field survives because the plate draws this agent's
   * mark.
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
