import type { AnsiLine } from '../types/terminal';

/**
 * What the app needs from a terminal screen, independent of who parses.
 *
 * Extracted so `@xterm/headless` can be dropped in behind the existing
 * consumers rather than rewriting them, and so both implementations can be run
 * against the same tests while the swap is proven.
 */
export interface TerminalScreen {
  /**
   * Feed bytes. Parsing is ASYNCHRONOUS — the buffer is not updated when this
   * returns. Read only after `onParsed` fires.
   */
  write(data: string): void;

  /**
   * Fires after a batch of writes has been parsed, coalesced to at most one
   * call per frame. Returns an unsubscribe.
   */
  onParsed(cb: () => void): () => void;

  isAltScreen(): boolean;

  /**
   * An opaque handle to the cursor's current row, for `linesSince`. A plain
   * number because it is persisted on the block (`TerminalBlock.outputMark`).
   */
  mark(): number;

  getLines(): AnsiLine[];

  /** Rows from `mark` to the end. Falls back to everything if the mark is gone. */
  linesSince(mark: number): AnsiLine[];

  resize(cols: number, rows: number): void;
  reset(): void;
  dispose(): void;
}
