import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { XtermScreen } from './xtermScreen';

/** Resolve once the screen reports a parse; xterm's write is asynchronous. */
const parsed = (screen: XtermScreen, data: string) =>
  new Promise<void>((resolve) => {
    const off = screen.onParsed(() => {
      off();
      resolve();
    });
    screen.write(data);
  });

const plain = (lines: { spans: { text: string }[] }[]) =>
  lines.map((l) => l.spans.map((s) => s.text).join('').replace(/\s+$/, ''));

beforeEach(() => {
  // Coalescing runs on a frame; fire it straight through in tests.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => vi.unstubAllGlobals());

describe('XtermScreen', () => {
  it('announces a parse and then reads back what was written', async () => {
    const screen = new XtermScreen(40, 10);
    await parsed(screen, 'hello');
    expect(plain(screen.getLines())[0]).toBe('hello');
  });

  it('reports alt-screen', async () => {
    const screen = new XtermScreen(40, 10);
    expect(screen.isAltScreen()).toBe(false);
    await parsed(screen, '\x1b[?1049h');
    expect(screen.isAltScreen()).toBe(true);
    await parsed(screen, '\x1b[?1049l');
    expect(screen.isAltScreen()).toBe(false);
  });

  it('reads a block from its mark, not from the top', async () => {
    const screen = new XtermScreen(40, 10);
    await parsed(screen, 'before\r\n');
    const mark = screen.mark();
    await parsed(screen, 'after one\r\nafter two\r\n');
    expect(plain(screen.linesSince(mark))).toContain('after one');
    expect(plain(screen.linesSince(mark))).not.toContain('before');
  });

  it('falls back to the whole buffer for a mark it does not know', async () => {
    // A mark restored from a persisted session belongs to a screen that no
    // longer exists; showing everything beats showing nothing.
    const screen = new XtermScreen(40, 10);
    await parsed(screen, 'restored\r\n');
    expect(plain(screen.linesSince(9999))[0]).toBe('restored');
  });

  it('gives a wide character its second cell', async () => {
    const screen = new XtermScreen(40, 10);
    await parsed(screen, '\u{1f389}A');
    expect(plain(screen.getLines())[0]).toBe('\u{1f389}A');
  });

  it('coalesces a burst of writes into one notification', async () => {
    // This one needs a DEFERRING frame stub. The synchronous stub the other
    // tests use flushes each frame inside the write that scheduled it, which
    // makes coalescing impossible by construction.
    const queued: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      queued.push(cb);
      return queued.length;
    });

    const screen = new XtermScreen(40, 10);
    const seen = vi.fn();
    screen.onParsed(seen);
    screen.write('a');
    screen.write('b');
    screen.write('c');
    // Let xterm's parser drain; its write callbacks are asynchronous.
    await new Promise((r) => setTimeout(r, 0));

    // Three writes, one queued frame — that is the coalescing.
    expect(queued.length).toBe(1);
    queued.forEach((cb) => cb(0));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('resizes and stops notifying once disposed', async () => {
    const screen = new XtermScreen(40, 10);
    screen.resize(20, 5);
    const seen = vi.fn();
    screen.onParsed(seen);
    screen.dispose();
    screen.write('ignored');
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).not.toHaveBeenCalled();
  });
});
