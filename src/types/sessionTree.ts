import { TerminalBlock, AnsiLine } from './terminal';

export type SessionKind = 'terminal' | 'agent' | 'tui' | 'verify' | 'scratchpad';

export type AgentLifecycleState = 'idle' | 'running' | 'waiting_input' | 'verifying' | 'errored';

export type SplitLayoutMode = 'single' | 'split-h' | 'split-v' | 'grid-2x2';

export interface ContextLink {
  fromNodeId: string;
  toNodeId: string;
  createdAt: number;
}

export interface InterAgentMessage {
  id: string;
  nonce: string;
  senderId: string;
  targetId: string;
  text: string;
  createdAt: number;
  delivered: boolean;
  replyToId?: string;
}

export interface ChainedTask {
  nodeId: string;
  afterNodeIds: string[];
  command: string;
  status: 'pending' | 'ready' | 'running' | 'completed' | 'failed';
}

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
  worktreePath?: string;
  worktreeBranch?: string;
  layout: SplitLayoutMode;
  activeNodeId: string;
  nodeIds: string[];
  createdAt: number;
}

export interface ProjectWorkspace {
  id: string;
  name: string;
  rootPath: string;
  gitRemote?: string;
  groups: SessionGroup[];
  nodes: Record<string, SessionNode>;
  links: ContextLink[];
  tasks: ChainedTask[];
  messages: InterAgentMessage[];
  activeGroupId: string;
}
