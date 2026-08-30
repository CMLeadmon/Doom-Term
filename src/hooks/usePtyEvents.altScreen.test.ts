import { describe, it, expect } from 'vitest';
import { resolveTuiState } from './usePtyEvents';

describe('resolveTuiState', () => {
  it('trusts the screen when nothing has reported otherwise', () => {
    expect(resolveTuiState(true, undefined)).toBe(true);
    expect(resolveTuiState(false, undefined)).toBe(false);
  });

  it('prefers what the daemon reported over what the screen can see', () => {
    // Under tmux the screen CANNOT see it: the alternate screen is deliberately
    // disabled on the client so scrollback and blocks survive, which means a
    // full-screen program in the pane leaves no trace in our buffer type.
    expect(resolveTuiState(false, true)).toBe(true);
  });

  it('lets the daemon clear it again when the program exits', () => {
    // A latch that only ever sets would leave the pane in grid mode forever
    // after the first vim.
    expect(resolveTuiState(false, false)).toBe(false);
  });
});
