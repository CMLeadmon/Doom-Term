export interface RecoverableSession {
  id: string;
  cwd: string;
  command: string;
  durable: boolean;
}

export interface RecoveryState {
  matched: string[];
  recoverable: RecoverableSession[];
  snapshots: string[];
}

/**
 * What may be done with a node's id, right now.
 *
 * - `ready`   — bind it to the daemon; either it is live there or this session
 *               created the id and no stored state can be lost by spawning.
 * - `waiting` — a restored id the daemon has not yet been asked about.
 * - `snapshot`— a restored id with no live process: cached lines and nothing
 *               behind them.
 */
export type SessionBinding = 'ready' | 'waiting' | 'snapshot';

/**
 * Decide whether a node may be bound to a process.
 *
 * `reconcileSessions` computed `snapshots` correctly and the application never
 * consulted it. The active restored id went straight to the daemon's
 * attach-or-create Spawn, so on a cold start against an empty daemon a FRESH
 * shell was created under the stored id before reconciliation could run. The
 * stored command was never re-run — which is right — but cached transcript
 * lines followed by a new shell's prompt is not a recovered session, and
 * nothing on screen said so.
 *
 * Pure so cold startup can be tested without a daemon or a socket.
 */
export function sessionBinding(
  nodeId: string,
  wasRestored: boolean,
  reconciled: boolean,
  state: RecoveryState,
): SessionBinding {
  // Created in this session: there is no earlier state to preserve, and making
  // a new terminal wait on a recovery round-trip would be a visible stall.
  if (!wasRestored) return 'ready';
  if (!reconciled) return 'waiting';
  return state.snapshots.includes(nodeId) ? 'snapshot' : 'ready';
}

/**
 * Reconcile local presentation state with the daemon's process truth.
 * Nothing here starts a process: daemon-only ids become explicit recovery
 * choices, while stored-only ids remain cached snapshots.
 */
export function reconcileSessions(
  storedIds: string[],
  liveSessions: RecoverableSession[],
): RecoveryState {
  const stored = new Set(storedIds);
  const uniqueLive = new Map<string, RecoverableSession>();
  for (const session of liveSessions) {
    if (!uniqueLive.has(session.id)) uniqueLive.set(session.id, session);
  }
  const matched = [...uniqueLive.keys()].filter((id) => stored.has(id));
  const recoverable = [...uniqueLive.values()].filter((session) => !stored.has(session.id));
  const snapshots = [...new Set(storedIds)].filter((id) => !uniqueLive.has(id));
  return { matched, recoverable, snapshots };
}
