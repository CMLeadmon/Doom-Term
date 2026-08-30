import { TerminalEmulator } from './terminalEmulator';

/**
 * One long-lived emulator per PTY session.
 *
 * These are mutable and non-serialisable, so they deliberately live outside
 * React state — the workspace is persisted to storage, and a screen buffer has
 * no business in there. Keying by session id is what keeps a chunk of output
 * from one tab out of another's grid.
 */
const emulators = new Map<string, TerminalEmulator>();

/**
 * The grid a session starts on, for the frame between mount and the pane
 * reporting its real size. `resizeEmulator` corrects it immediately; nothing
 * should ever render at these numbers.
 *
 * Exported because the PTY must be spawned at the same numbers the emulator
 * assumes — the two disagreeing is a shell wrapping at one width against a grid
 * of another.
 */
export const BOOTSTRAP_COLS = 120;
export const BOOTSTRAP_ROWS = 30;

export function getEmulator(sessionId: string): TerminalEmulator {
  let emu = emulators.get(sessionId);
  if (!emu) {
    emu = new TerminalEmulator({ cols: BOOTSTRAP_COLS, rows: BOOTSTRAP_ROWS });
    emulators.set(sessionId, emu);
  }
  return emu;
}

export function disposeEmulator(sessionId: string): void {
  emulators.delete(sessionId);
}

/**
 * Resize one session's grid.
 *
 * Per session, not global: two panes in a split are different sizes, and the
 * previous global form resized every emulator to whichever pane reported last.
 */
export function resizeEmulator(sessionId: string, cols: number, rows: number): void {
  getEmulator(sessionId).resize(cols, rows);
}

/** Test hook — drops every session's buffer. */
export function resetAllEmulators(): void {
  emulators.clear();
}
