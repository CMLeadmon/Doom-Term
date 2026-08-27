import { TerminalEmulator, type TerminalEvents } from './terminalEmulator';

/**
 * One long-lived emulator per PTY session.
 *
 * These are mutable and non-serialisable, so they deliberately live outside
 * React state — the workspace is persisted to storage, and a screen buffer has
 * no business in there. Keying by session id is what keeps a chunk of output
 * from one tab out of another's grid.
 */
const emulators = new Map<string, TerminalEmulator>();

let defaultCols = 120;
let defaultRows = 30;
let sharedEvents: TerminalEvents = {};

/** Events applied to every emulator created from here on. */
export function configureEmulators(events: TerminalEvents): void {
  sharedEvents = events;
}

export function getEmulator(sessionId: string): TerminalEmulator {
  let emu = emulators.get(sessionId);
  if (!emu) {
    emu = new TerminalEmulator({ cols: defaultCols, rows: defaultRows, events: sharedEvents });
    emulators.set(sessionId, emu);
  }
  return emu;
}

export function disposeEmulator(sessionId: string): void {
  emulators.delete(sessionId);
}

export function resizeEmulators(cols: number, rows: number): void {
  defaultCols = cols;
  defaultRows = rows;
  for (const emu of emulators.values()) emu.resize(cols, rows);
}

/** Test hook — drops every session's buffer. */
export function resetAllEmulators(): void {
  emulators.clear();
}
