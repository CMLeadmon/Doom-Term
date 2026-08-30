/**
 * Keystrokes held while a command line is written but not yet submitted.
 *
 * Echo-verified delivery leaves the line sitting in the shell's editor for up
 * to three verify timeouts. Anything typed in that window would be spliced into
 * the command — a stray character in a `git push`, or a bare Enter that submits
 * a half-written line. Hold them, then release them in order once the line has
 * gone, or drop them if it never did.
 *
 * Bounded, and the refusal is explicit: a silent drop is indistinguishable from
 * a terminal that has stopped responding.
 */

/** Roughly a screenful of typing. Past this the window is not the problem. */
export const HOLD_LIMIT_CHARS = 4096;

export type OfferResult = 'send' | 'held' | 'full';

export class HoldBuffer {
  private queue: string[] = [];
  private size = 0;
  private holding = false;

  get isHolding(): boolean {
    return this.holding;
  }

  /** Begin holding. Called when a delivery starts. */
  hold(): void {
    this.holding = true;
  }

  /** Offer input. `send` means the caller should write it through as usual. */
  offer(data: string): OfferResult {
    if (!this.holding) return 'send';
    if (this.size + data.length > HOLD_LIMIT_CHARS) return 'full';
    this.queue.push(data);
    this.size += data.length;
    return 'held';
  }

  /** Release everything held, in arrival order, and resume passing through. */
  flush(): string[] {
    const released = this.queue;
    this.queue = [];
    this.size = 0;
    this.holding = false;
    return released;
  }

  /** The delivery was abandoned; what was held must never reach the shell. */
  discard(): void {
    this.queue = [];
    this.size = 0;
    this.holding = false;
  }
}
