import type { SessionNode } from '../types/sessionTree';
import type { WaitingRow } from '../hud/state';

/**
 * mm/ss, in the characters the plate's small font actually has.
 *
 * Seconds are padded so the right-aligned column does not jitter as the value
 * crosses ten — the rows sit under each other and a shifting width reads as
 * movement, which on this plate means something.
 */
export function formatWait(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}S`;
  return `${Math.floor(s / 60)}M${String(s % 60).padStart(2, '0')}S`;
}

export interface ActivityProbe {
  /** Is output arriving continuously enough to call this work? */
  isBusy(id: string): boolean;
  /** When this session last emitted, or undefined if it never has. */
  lastOutputAt(id: string): number | undefined;
}

export interface AttentionProbe {
  isAcknowledged(id: string, blockedOnUser: boolean): boolean;
}

/**
 * The sessions that have stopped and want you.
 *
 * Four exclusions, each load-bearing:
 *
 *  - the session on screen, because you are already looking at it;
 *  - anything still working, because a running agent needs nothing from you;
 *  - anything that has never emitted, because it has not started — which is
 *    not the same as having stopped, and claiming otherwise would put every
 *    freshly opened terminal into the list;
 *  - scratchpads, which have no process to be waiting on.
 *
 * Nothing else is excluded. A session that merely went quiet IS the signal:
 * from a terminal, an agent waiting on its provider and an agent waiting on
 * you are indistinguishable, and guessing between them would be inventing
 * state. The honest report is that it stopped.
 *
 * Longest wait first, because only three rows fit and that is the one going
 * stale.
 */
export function buildWaitingList(
  nodes: SessionNode[],
  activeId: string,
  probe: ActivityProbe,
  now: number,
  attention?: AttentionProbe,
): WaitingRow[] {
  return nodes
    .filter((n) => n.id !== activeId)
    .filter((n) => n.kind !== 'scratchpad')
    .filter((n) => probe.lastOutputAt(n.id) !== undefined)
    .filter((n) => !probe.isBusy(n.id))
    // A vendor question is cleared only by the vendor's Stop hook. Even an
    // over-broad/custom acknowledgement probe must not hide it.
    .filter((n) => !!n.blockedOnUser || !attention?.isAcknowledged(n.id, false))
    // Blocked first, then longest wait. An agent that has SAID it needs you
    // outranks one we merely observed going quiet, however long ago.
    .sort((a, b) => {
      if (!!a.blockedOnUser !== !!b.blockedOnUser) return a.blockedOnUser ? -1 : 1;
      return (probe.lastOutputAt(a.id) ?? 0) - (probe.lastOutputAt(b.id) ?? 0);
    })
    .map((n) => {
      const failed = typeof n.lastExitCode === 'number' && n.lastExitCode !== 0;
      // A session that told us it is blocked says so, rather than showing a
      // duration you would have to interpret.
      if (n.blockedOnUser) {
        return {
          sessionId: n.id,
          n: n.number === null ? '-' : String(n.number),
          name: n.title,
          tail: 'ASKS',
          failed: false,
        };
      }
      return {
        sessionId: n.id,
        // A session past the ninth slot has no key of its own; a dash says so
        // rather than printing "null" at you.
        n: n.number === null ? '-' : String(n.number),
        name: n.title,
        tail: failed ? `EXIT ${n.lastExitCode}` : formatWait(now - (probe.lastOutputAt(n.id) ?? now)),
        failed,
      };
    });
}
