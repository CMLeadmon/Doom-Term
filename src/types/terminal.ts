export type CommandStatus = 'idle' | 'running' | 'completed' | 'error';

export interface AnsiSpan {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  invert?: boolean;
}

export interface AnsiLine {
  id: string;
  spans: AnsiSpan[];
  isError?: boolean;
  timestamp: number;
}

export interface ImmutableSnapshot {
  id: string;
  lines: AnsiLine[];
  exitCode: number | null;
  durationMs: number;
  completedAt: number;
  totalLines: number;
}

export interface ToolCall {
  verb: 'READ' | 'EDIT' | 'GREP' | 'SHELL' | 'WEB';
  target: string;
  result?: string;
  added?: number;
  removed?: number;
  live?: boolean;
}

export interface DiffLine {
  n: number;
  sign: ' ' | '+' | '-';
  text: string;
}

export interface DiffContent {
  file: string;
  lines: DiffLine[];
  added: number;
  removed: number;
}

export interface TerminalBlock {
  id: string;
  command: string;
  status: CommandStatus;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  exitCode?: number | null;
  gitBranch?: string;
  currentDir?: string;
  liveLines: AnsiLine[];
  /** Index into the session emulator's scrollback where this block's output begins. */
  outputMark?: number;
  snapshot?: ImmutableSnapshot;
  isTuiSession?: boolean;
  pinned?: boolean;
  collapsed?: boolean;
  aiExplanation?: string;
  toolCalls?: ToolCall[];
  diffContent?: DiffContent;
}

export interface SessionTab {
  id: string;
  title: string;
  cwd: string;
  gitBranch: string;
  activeBlockId: string | null;
  isTuiActive: boolean;
  blocks: TerminalBlock[];
  tuiLines: AnsiLine[];
  commandHistory: string[];
  createdAt: number;
}

export type InputMode = 'editor' | 'raw';

export interface STBARState {
  health: number; // 0 to 100
  ammo: number; // Current token count (e.g. 14200)
  maxAmmo: number; // Max token budget (e.g. 128000)
  armor: number; // Sandbox level (100% OS Sandbox, 50% Worktree, 0% Host)
  arms: boolean[]; // Active tools 1-7
  keys: {
    blue: boolean; // SSH Key active
    yellow: boolean; // Cloud credentials active
    red: boolean; // GPG/Git key active
  };
  level: string; // E1M1: git_branch
  godMode: boolean; // AI generating / God Mode active
  faceState: 'alert' | 'smile' | 'glance_left' | 'glance_right' | 'neutral' | 'bruised' | 'bloody' | 'god' | 'ouch';
}

export interface SystemTelemetryData {
  username: string;
  hostname: string;
  current_dir: string;
  git_branch: string | null;
  sandbox_level: number;
  credentials?: [boolean, boolean, boolean];
}
