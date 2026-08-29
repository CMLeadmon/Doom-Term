import { PLATE_480, truncateLeft } from './plate.js';

export type Isolation = 'sandbox' | 'worktree' | 'host';

export interface AppTelemetry {
  contextUsed?: number;   // 0..1
  rateUsed?: number;      // 0..1
  isolation?: Isolation;
  agent?: string;
  agentName?: string;
  model?: string;
  cwd?: string;
  branch?: string;
  credentials?: [boolean, boolean, boolean];
  tokens?: { in: number; out: number; cache: number; limit: [number, number, number, number] };
  shellMetrics?: { lines: number; commands: number; errors: number; active: number };
  pendingApproval?: boolean;
}

const TIER: Record<Isolation, string> = { sandbox: 'FULL', worktree: 'TREE', host: 'OFF' };

function pct(v: number | undefined): string {
  const n = Math.round(Math.min(1, Math.max(0, v ?? 0)) * 100);
  return `${Math.min(99, n)}%`;
}

const k = (n: number) => String(Math.round(n / 1000));

export function toPlateState(app: AppTelemetry) {
  const t = app.tokens;
  const isAgent = Boolean(app.agent && !['terminal', 'doom', 'marine', 'none', 'shell', 'bash'].includes(app.agent.toLowerCase()));
  const agentKey = isAgent ? app.agent! : (app.agent ?? 'doom');
  const defaultAgentName = isAgent ? 'CLAUDE CODE' : 'BASH · SHELL';

  const state: Record<string, unknown> = {
    context: pct(app.contextUsed),
    usage: pct(app.rateUsed),
    sandbox: app.pendingApproval ? 'WAIT' : TIER[app.isolation ?? 'host'],
    agent: agentKey,
    agentName: [app.agentName ?? defaultAgentName, app.model].filter(Boolean).join(' · ').toUpperCase(),
    path: (app.cwd ?? '~').toUpperCase(),
    branch: truncateLeft((app.branch ?? 'main').toUpperCase(), PLATE_480.valueChars),
    credentials: app.credentials ?? [false, false, false],
  };

  if (t) {
    state.table = [
      ['IN', k(t.in), k(t.limit[0])],
      ['OUT', k(t.out), k(t.limit[1])],
      ['CAC', k(t.cache), k(t.limit[2])],
      ['TOT', k(t.in + t.out + t.cache), k(t.limit[3])],
    ];
  } else if (app.shellMetrics) {
    const sm = app.shellMetrics;
    const linesStr = sm.lines > 999 ? `${(sm.lines / 1000).toFixed(1)}k` : String(sm.lines);
    state.table = [
      ['LIN', linesStr, '10K'],
      ['CMD', String(sm.commands), '100'],
      ['ERR', String(sm.errors), '10'],
      ['SES', String(sm.active), '8'],
    ];
  }

  return state;
}

/** Integer scale only — fractional scaling destroys the striation. */
export function plateScale(availableWidth: number): number {
  return Math.max(1, Math.floor(availableWidth / PLATE_480.width));
}

export interface BlockTokenData {
  command: string;
  startedAt: number;
  snapshot?: { lines: { spans: { text: string }[] }[] };
  liveLines: { spans: { text: string }[] }[];
}

/**
 * Dynamically computes estimated token counts from session terminal blocks.
 */
export function estimateTokensFromBlocks(blocks: BlockTokenData[]) {
  let totalInputChars = 0;
  let totalOutputChars = 0;

  for (const b of blocks) {
    totalInputChars += b.command.length;
    const lines = b.snapshot ? b.snapshot.lines : b.liveLines;
    for (const line of lines) {
      for (const span of line.spans) {
        totalOutputChars += span.text.length;
      }
    }
  }

  const tokensIn = Math.max(1200, Math.round(totalInputChars / 3.8) + 1200);
  const tokensOut = Math.round(totalOutputChars / 3.8);
  const tokensCache = Math.round(tokensIn * 0.6);
  const totalTokens = tokensIn + tokensOut + tokensCache;
  const contextLimit = 128000;
  const contextPct = Math.min(0.99, totalTokens / contextLimit);

  // Command velocity over recent blocks
  const now = Date.now();
  const recentCommands = blocks.filter((b) => now - b.startedAt < 15 * 60 * 1000).length;
  const ratePct = Math.min(0.99, recentCommands / 25);

  return {
    tokens: {
      in: tokensIn,
      out: tokensOut,
      cache: tokensCache,
      limit: [128000, 32000, 64000, 200000] as [number, number, number, number],
    },
    contextUsed: contextPct,
    rateUsed: ratePct,
  };
}
