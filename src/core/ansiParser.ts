import type { AnsiLine } from '../types/terminal';
import { renderAnsiText } from './terminalEmulator';

export { DOOM_PALETTE } from './terminalEmulator';

/**
 * Render a complete string of terminal output.
 *
 * This is the one-shot path, for callers that already hold the whole text
 * (restoring a persisted session, tests, fixtures). Live PTY output must not
 * come through here: a stream arrives in arbitrary chunks, and parsing each
 * chunk independently resets colour state and splits rows at the boundary.
 * Hold a long-lived TerminalEmulator per session instead.
 */
export function parseAnsiText(rawText: string): AnsiLine[] {
  return renderAnsiText(rawText);
}
