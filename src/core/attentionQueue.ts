/**
 * Ephemeral acknowledgement state for the plate's waiting queue.
 *
 * This deliberately is not workspace state. Acknowledgement means "I have
 * looked at the latest output in this process", not a durable property of the
 * project. New PTY output advances the observed sequence and makes the session
 * eligible again. Explicit vendor questions cannot be acknowledged locally;
 * only the vendor's Stop hook clears those.
 */
export class AttentionQueue {
  private outputSequence = new Map<string, number>();
  private acknowledgedSequence = new Map<string, number>();

  noteOutput(sessionId: string, sequence: number = Date.now()): void {
    const previous = this.outputSequence.get(sessionId) ?? Number.NEGATIVE_INFINITY;
    this.outputSequence.set(sessionId, Math.max(previous + 1, sequence));
  }

  acknowledge(sessionId: string): void {
    const sequence = this.outputSequence.get(sessionId);
    if (sequence !== undefined) this.acknowledgedSequence.set(sessionId, sequence);
  }

  isAcknowledged(sessionId: string, blockedOnUser: boolean): boolean {
    if (blockedOnUser) return false;
    const output = this.outputSequence.get(sessionId);
    return output !== undefined && this.acknowledgedSequence.get(sessionId) === output;
  }

  next(rows: ReadonlyArray<{ sessionId: string }>, currentId: string | null): string | null {
    if (!rows.length) return null;
    const current = rows.findIndex((row) => row.sessionId === currentId);
    return rows[(current + 1) % rows.length].sessionId;
  }

  dispose(sessionId: string): void {
    this.outputSequence.delete(sessionId);
    this.acknowledgedSequence.delete(sessionId);
  }
}

/** One process-wide queue, matching the process-wide activity monitor. */
export const attentionQueue = new AttentionQueue();
