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
}

const TIER: Record<Isolation, string> = { sandbox: 'FULL', worktree: 'TREE', host: 'OFF' };

function pct(v: number | undefined): string {
  const n = Math.round(Math.min(1, Math.max(0, v ?? 0)) * 100);
  return `${Math.min(99, n)}%`;
}

const k = (n: number) => String(Math.round(n / 1000));

export function toPlateState(app: AppTelemetry) {
  const t = app.tokens;
  return {
    context: pct(app.contextUsed),
    usage: pct(app.rateUsed),
    sandbox: TIER[app.isolation ?? 'host'],
    agent: app.agent ?? 'claude',
    agentName: [app.agentName ?? 'CLAUDE CODE', app.model].filter(Boolean).join(' · ').toUpperCase(),
    path: (app.cwd ?? '~').toUpperCase(),
    branch: truncateLeft((app.branch ?? 'main').toUpperCase(), PLATE_480.valueChars),
    credentials: app.credentials ?? [false, false, false],
    table: t
      ? [
          ['IN', k(t.in), k(t.limit[0])],
          ['OUT', k(t.out), k(t.limit[1])],
          ['CAC', k(t.cache), k(t.limit[2])],
          ['TOT', k(t.in + t.out + t.cache), k(t.limit[3])],
        ]
      : undefined,
  };
}

/** Integer scale only — fractional scaling destroys the striation. */
export function plateScale(availableWidth: number): number {
  return Math.max(1, Math.floor(availableWidth / PLATE_480.width));
}
