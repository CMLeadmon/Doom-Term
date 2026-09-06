import { PLATE_480, truncateLeft } from './plate.js';
import type { ScrollbackState } from '../core/scrollback';

export type Isolation = 'sandbox' | 'worktree' | 'host';

/**
 * What a row is telling you, in the plate's own state vocabulary.
 *
 * One status, one canonical colour, one glyph. Every value here is OBSERVED —
 * the agent's own hook (`asks`), the process's exit code (`failed`), continuous
 * output (`working`), or the absence of all three (`quiet`). None is inferred
 * from how long something has been silent, which is why there is no 'stale'.
 */
export type WaitingStatus = 'asks' | 'failed' | 'quiet' | 'working';

/** One session in the waiting well: what it is, and what it wants. */
export interface WaitingRow {
  /** Internal target. The renderer ignores it; interaction and routing do not. */
  sessionId: string;
  /** The session's stable 1-9 slot, as text because the plate draws text. */
  n: string;
  name: string;
  /** Drawn as a glyph beside the name, in that status's canonical colour. */
  status: WaitingStatus;
  /** Four characters of vendor, right-aligned where the timer used to be. */
  tag: string;
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
  /**
   * Is something blocked on you right now?
   *
   * This outlived the approval gate that introduced it, and deliberately. The
   * gate did two jobs: it DECIDED whether a command could run, and it TOLD you
   * something needed attention. Only the first is gone — in pass-through the
   * app never sees the command, so it has no standing to decide, and the agents
   * prompt for their own risky calls anyway.
   *
   * Noticing that an agent is blocked on YOU is the other job, it is the most
   * valuable thing the terminal can know about a session you are not looking
   * at, and the plate already renders it as SANDBOX WAIT. Only the source of
   * the signal changes.
   */
  pendingApproval?: boolean;
  /**
   * Permissions execution mode for agents: 'manual' (default/safe), 'auto' (semi-autonomous), or 'yolo' (uninhibited).
   */
  permissionMode?: 'manual' | 'auto' | 'yolo';
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
  /**
   * What the centre is doing.
   *
   * The plate is the only chrome, so a mode's controls have nowhere else to
   * live. 'waiting' is the resting state; 'transport' is reading back.
   */
  mode?: 'waiting' | 'transport';
  transport?: ScrollbackState | null;
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

  const modeNames: Record<string, string> = { manual: 'MANUAL', auto: 'AUTO', yolo: 'YOLO' };
  const modeText = app.pendingApproval
    ? 'WAIT'
    : (app.permissionMode ? modeNames[app.permissionMode] : TIER[app.isolation ?? 'host']);

  const state: Record<string, unknown> = {
    context: pct(app.contextUsed),
    usage: pct(app.rateUsed),
    sandbox: modeText,
    modeIndicator: modeText,
    agent: app.agent ?? 'shell',
    // undefined is meaningful: the plate draws a still mark for a halted agent.
    pulse: app.agentBusy ? (phase ?? 0) : undefined,
    // The rows' own clock, deliberately NOT `pulse`.
    //
    // `pulse` answers "is the session you are looking at working", because it
    // drives the agent mark and animating that for someone else's session would
    // claim activity where there is none. A working ROW is its own evidence —
    // it earned that status by emitting — so it may animate whatever your own
    // prompt is doing. Withheld when no row is working, so a settled plate is
    // one blit rather than a 60fps loop over an unchanging image.
    phase: (app.waiting ?? []).some((r) => r.status === 'working') ? (phase ?? 0) : undefined,
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
    // Explicit for the same reason: an absent key would fall through to
    // DEFAULT_STATE rather than resting on the waiting column.
    mode: app.mode ?? 'waiting',
    transport: app.transport ?? null,
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
