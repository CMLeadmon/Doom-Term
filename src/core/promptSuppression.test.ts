import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { XtermScreen } from './xtermScreen';

/**
 * GitHub #1: the shell's own `user@host:/path$` prompt appearing inside block
 * output, duplicating Doom Term's own path chrome.
 *
 * shell_integration.rs wraps the user's $PS1 in OSC 133 markers without
 * shortening it, so the prompt is still printed. What keeps it out of the
 * block is the re-mark at OSC 133;C — this pins that behaviour down.
 */

/** xterm parses asynchronously; every read must follow the write. */
const feed = (screen: XtermScreen, data: string) =>
  new Promise<void>((resolve) => {
    const off = screen.onParsed(() => {
      off();
      resolve();
    });
    screen.write(data);
  });

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());

describe('prompt suppression', () => {
  it('excludes the prompt and the echoed command from block output', async () => {
    const screen = new XtermScreen(120, 30);

    // A real prompt cycle: OSC 133;A, the prompt itself, OSC 133;B, the
    // echoed command, OSC 133;C, then the command's actual output.
    await feed(screen, '\x1b]133;A\x07cleadmon@SER6-MAX:/var/home/cleadmon$ \x1b]133;B\x07');
    await feed(screen, 'ls\r\n');

    // The block re-marks here, on OSC 133;C (ExecutionStart).
    await feed(screen, '\x1b]133;C\x07');
    const mark = screen.mark();

    await feed(screen, 'Applications  Desktop  Documents\r\n');
    await feed(screen, '\x1b]133;D;0\x07');

    const rendered = screen
      .linesSince(mark)
      .map((l) => l.spans.map((s) => s.text).join(''))
      .join('\n');

    expect(rendered).toContain('Applications');
    expect(rendered).not.toContain('cleadmon@SER6-MAX');
    expect(rendered).not.toContain('$ ');
  });

  it('keeps a second command clear of the first command output', async () => {
    const screen = new XtermScreen(120, 30);

    await feed(screen, '\x1b]133;A\x07u@h:/tmp$ \x1b]133;B\x07first\r\n\x1b]133;C\x07');
    await feed(screen, 'FIRST-OUTPUT\r\n\x1b]133;D;0\x07');

    await feed(screen, '\x1b]133;A\x07u@h:/tmp$ \x1b]133;B\x07second\r\n\x1b]133;C\x07');
    const mark = screen.mark();
    await feed(screen, 'SECOND-OUTPUT\r\n\x1b]133;D;0\x07');

    const rendered = screen
      .linesSince(mark)
      .map((l) => l.spans.map((s) => s.text).join(''))
      .join('\n');

    expect(rendered).toContain('SECOND-OUTPUT');
    expect(rendered).not.toContain('FIRST-OUTPUT');
    expect(rendered).not.toContain('u@h:/tmp');
  });
});
