/**
 * Two-act delivery of a command into a shell that may not be listening yet.
 *
 * Writing line-plus-Enter in one shot races shell init: zsh's rc and ZLE setup
 * reset the tty with a flush that can swallow part of a queued line, and a
 * mangled line submitted anyway strands the shell at `quote>`. Nothing reports
 * it — you believe you dispatched work and did not.
 *
 * So: write the line WITHOUT Enter, wait for the shell to echo its tail back,
 * and only then submit. A verify timeout clears the pending line and rewrites
 * it. The last attempt submits unverified on purpose — a terminal whose echo we
 * cannot recognise must never block a launch, and that worst case is exactly
 * the behaviour this replaces.
 *
 * Pure apart from the injected io, so every branch tests without a PTY.
 */

/**
 * Local PTY echo comes back in well under 100ms. This is generous enough to
 * cover a shell still running its rc files, and short enough that the fail-open
 * path (three of these) does not feel like a hang.
 */
export const VERIFY_TIMEOUT_MS = 1200;

export const DELIVERY_ATTEMPTS = 3;

/**
 * Match on the tail rather than the whole line: the head arrives fused to the
 * prompt. Long enough to be unambiguous, short enough that a line-wrap redraw
 * interleaved mid-echo rarely lands inside the window.
 */
export const ECHO_TAIL_CHARS = 32;

/** Ctrl-U — clear the pending input line before rewriting it. */
export const KILL_LINE = '\x15';

// CSI, OSC and single-character ESC sequences.
// eslint-disable-next-line no-control-regex
const ESCAPE_SEQUENCE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;

/**
 * Echo stream to comparable text: drop escape sequences and line breaks. A
 * shell re-wraps a long line with its own CR/LF at the terminal width, which
 * would otherwise break the match in the middle.
 */
export function stripControl(chunk: string): string {
  return chunk.replace(ESCAPE_SEQUENCE, '').replace(/[\r\n]/g, '');
}

/** Has the shell echoed the whole line back? */
export function echoComplete(seen: string, command: string): boolean {
  return seen.includes(command.slice(-ECHO_TAIL_CHARS));
}

export type DeliveryOutcome = 'verified' | 'unverified' | 'cancelled';

export interface DeliveryIo {
  write(data: string): void;
  /** Subscribe to this session's output; returns an unsubscribe. */
  onData(cb: (chunk: string) => void): () => void;
}

/**
 * Deliver `command` plus Enter, echo-verified with bounded retries.
 *
 * Returns a cancel function; call it on teardown or when a newer command
 * supersedes this one. `onSettled` fires exactly once, when the line has left
 * the pane or the delivery was abandoned — callers need to know when the LINE
 * is gone, not merely when it was started, because the retries run for up to
 * DELIVERY_ATTEMPTS x VERIFY_TIMEOUT_MS and anything typed inside that window
 * would land in the un-submitted line.
 */
export function deliverCommand(
  io: DeliveryIo,
  command: string,
  onSettled?: (outcome: DeliveryOutcome) => void
): () => void {
  let settled = false;
  let attempt = 0;
  let seen = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;

  /**
   * End the delivery exactly once.
   *
   * The order inside here is load-bearing in both directions. The guard and the
   * unsubscribe come FIRST, so an io that echoes writes back synchronously
   * cannot re-enter the listener below while the tail still matches and submit
   * again. `onSettled` comes LAST, after the Enter has gone out — the caller
   * releases held keystrokes from it, and those must land after the command
   * line was submitted, never inside it.
   */
  const finish = (outcome: DeliveryOutcome, sendEnter: boolean): void => {
    if (settled) return; // a cancel after the submit must not re-announce it
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    unsubscribe?.();
    if (sendEnter) io.write('\r');
    onSettled?.(outcome);
  };

  const submit = (outcome: DeliveryOutcome): void => finish(outcome, true);

  const onTimeout = (): void => {
    if (settled) return;
    if (attempt >= DELIVERY_ATTEMPTS) {
      submit('unverified');
      return;
    }
    io.write(KILL_LINE);
    attemptOnce();
  };

  const attemptOnce = (): void => {
    if (settled) return;
    attempt += 1;
    seen = '';
    // Arm before writing, for the same synchronous-echo case: a timer armed
    // after a write that already settled the delivery would outlive it.
    timer = setTimeout(onTimeout, VERIFY_TIMEOUT_MS);
    io.write(command);
  };

  unsubscribe = io.onData((chunk) => {
    if (settled) return;
    seen += stripControl(chunk);
    if (echoComplete(seen, command)) submit('verified');
  });

  attemptOnce();

  return () => finish('cancelled', false);
}
