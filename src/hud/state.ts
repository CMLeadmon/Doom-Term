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

/** An unknown percentage is '--'. Never round `undefined` down to 0%. */
function pct(v: number | undefined): string {
  if (v === undefined || Number.isNaN(v)) return '--';
  const n = Math.round(Math.min(1, Math.max(0, v)) * 100);
  return `${Math.min(99, n)}%`;
}

const k = (n: number) => String(Math.round(n / 1000));

export function toPlateState(app: AppTelemetry) {
  const t = app.tokens;

  const state: Record<string, unknown> = {
    context: pct(app.contextUsed),
    usage: pct(app.rateUsed),
    sandbox: app.pendingApproval ? 'WAIT' : TIER[app.isolation ?? 'host'],
    agent: app.agent ?? 'shell',
    agentName: [app.agentName, app.model].filter(Boolean).join(' · ').toUpperCase(),
    path: (app.cwd ?? '~').toUpperCase(),
    branch: truncateLeft((app.branch ?? '').toUpperCase(), PLATE_480.valueChars),
    credentials: app.credentials ?? [false, false, false],
    // An absent table must be explicit: drawPlate merges DEFAULT_STATE under
    // this object, so omitting the key would render the demo table instead.
    table: [] as string[][],
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
    ];
  }

  return state;
}

/** Integer scale only — fractional scaling destroys the striation. */
export function plateScale(availableWidth: number): number {
  return Math.max(1, Math.floor(availableWidth / PLATE_480.width));
}
