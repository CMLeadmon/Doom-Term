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
