import { PLATE_480, truncateLeft } from './plate.js';

export type Isolation = 'sandbox' | 'worktree' | 'host';

/** One session that has stopped and wants you. */
export interface WaitingRow {
  /** The session's stable 1-9 slot, as text because the plate draws text. */
  n: string;
  name: string;
  /** Time since last output, or an exit code. */
  tail: string;
  failed?: boolean;
}

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
  /**
   * Is the agent in this session doing something right now?
   *
   * Observed, not declared: the session is emitting output, or a command block
   * is open. An agent sitting at its prompt is not busy, and the mark must go
   * still — an indicator that always moves says nothing.
   */
  agentBusy?: boolean;
  /**
   * The sessions that have stopped and want you.
   *
   * Observed, never invented: a session earns a row by having emitted before,
   * not emitting now, and not being the one on screen. An empty list is the
   * good state and the plate draws it as one.
   */
  waiting?: WaitingRow[];
}

const TIER: Record<Isolation, string> = { sandbox: 'FULL', worktree: 'TREE', host: 'OFF' };

/** An unknown percentage is '--'. Never round `undefined` down to 0%. */
function pct(v: number | undefined): string {
  if (v === undefined || Number.isNaN(v)) return '--';
  const n = Math.round(Math.min(1, Math.max(0, v)) * 100);
  return `${Math.min(99, n)}%`;
}

const k = (n: number) => String(Math.round(n / 1000));

/** One full swell of the agent mark, in ms. Two per second, as specified. */
export const PULSE_PERIOD_MS = 500;

/**
 * Phase 0..1 within the current pulse cycle, from a monotonic clock.
 *
 * Derived from the timestamp rather than counted per frame so the rhythm stays
 * 2 Hz whatever the frame rate, and a dropped frame shows up as a skip rather
 * than a slowdown.
 */
export function pulsePhase(nowMs: number): number {
  return (nowMs % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
}

export function toPlateState(app: AppTelemetry, phase?: number) {
  const t = app.tokens;

  const state: Record<string, unknown> = {
    context: pct(app.contextUsed),
    usage: pct(app.rateUsed),
    sandbox: app.pendingApproval ? 'WAIT' : TIER[app.isolation ?? 'host'],
    agent: app.agent ?? 'shell',
    // undefined is meaningful: the plate draws a still mark for a halted agent.
    pulse: app.agentBusy ? (phase ?? 0) : undefined,
    agentName: [app.agentName, app.model].filter(Boolean).join(' · ').toUpperCase(),
    path: (app.cwd ?? '~').toUpperCase(),
    branch: truncateLeft((app.branch ?? '').toUpperCase(), PLATE_480.valueChars),
    credentials: app.credentials ?? [false, false, false],
    // An absent table must be explicit: drawPlate merges DEFAULT_STATE under
    // this object, so omitting the key would render the demo table instead.
    table: [] as string[][],
    // Same reason, and the empty case is the one that matters most here: an
    // absent key would fall through to DEFAULT_STATE rather than drawing the
    // all-clear well.
    waiting: app.waiting ?? [],
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

/**
 * Integer scale only — fractional scaling destroys the striation.
 *
 * This deliberately does NOT take the largest scale that fits. The old rule,
 * floor(width / 480), meant a 1920px window rendered at 4x and gained no
 * logical width whatsoever, so the elastic centre could never grow and the
 * waiting column had nowhere to live. Pick a legibility scale instead and
 * spend the remaining width on the centre.
 */
export function plateScale(devicePixelRatio: number = 1): number {
  return devicePixelRatio >= 2 ? 3 : 2;
}

/**
 * Logical plate width for the space available, at that scale.
 *
 * Floored because the geometry is integer pixels, and never below the
 * reference width — under 480 the right group would collide with the panel.
 */
export function plateWidth(availableWidth: number, scale: number): number {
  return Math.max(PLATE_480.width, Math.floor(availableWidth / scale));
}
