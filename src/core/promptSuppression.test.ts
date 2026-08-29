import { describe, it, expect } from 'vitest';
import { TerminalEmulator } from './terminalEmulator';

/**
 * GitHub #1: the shell's own `user@host:/path$` prompt appearing inside block
 * output, duplicating Doom Term's own path chrome.
 *
 * shell_integration.rs wraps the user's $PS1 in OSC 133 markers without
 * shortening it, so the prompt is still printed. What keeps it out of the
 * block is the re-mark at OSC 133;C — this pins that behaviour down.
 */
describe('prompt suppression', () => {
  it('excludes the prompt and the echoed command from block output', () => {
    const emu = new TerminalEmulator({ cols: 120, rows: 30 });

    // A real prompt cycle: OSC 133;A, the prompt itself, OSC 133;B, the
    // echoed command, OSC 133;C, then the command's actual output.
    emu.write('\x1b]133;A\x07cleadmon@SER6-MAX:/var/home/cleadmon$ \x1b]133;B\x07');
    emu.write('ls\r\n');

    // The block re-marks here, on OSC 133;C (ExecutionStart).
    emu.write('\x1b]133;C\x07');
    const mark = emu.mark();

    emu.write('Applications  Desktop  Documents\r\n');
    emu.write('\x1b]133;D;0\x07');

    const rendered = emu
      .linesSince(mark)
      .map((l) => l.spans.map((s) => s.text).join(''))
      .join('\n');

    expect(rendered).toContain('Applications');
    expect(rendered).not.toContain('cleadmon@SER6-MAX');
    expect(rendered).not.toContain('$ ');
  });

  it('keeps a second command clear of the first command output', () => {
    const emu = new TerminalEmulator({ cols: 120, rows: 30 });

    emu.write('\x1b]133;A\x07u@h:/tmp$ \x1b]133;B\x07first\r\n\x1b]133;C\x07');
    emu.write('FIRST-OUTPUT\r\n\x1b]133;D;0\x07');

    emu.write('\x1b]133;A\x07u@h:/tmp$ \x1b]133;B\x07second\r\n\x1b]133;C\x07');
    const mark = emu.mark();
    emu.write('SECOND-OUTPUT\r\n\x1b]133;D;0\x07');

    const rendered = emu
      .linesSince(mark)
      .map((l) => l.spans.map((s) => s.text).join(''))
      .join('\n');

    expect(rendered).toContain('SECOND-OUTPUT');
    expect(rendered).not.toContain('FIRST-OUTPUT');
    expect(rendered).not.toContain('u@h:/tmp');
  });
});
