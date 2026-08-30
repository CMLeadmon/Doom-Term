import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTerminalSize } from './useTerminalSize';
import { ptyClient } from '../core/ptyClient';
import { resizeEmulator } from '../core/emulatorRegistry';

vi.mock('../core/ptyClient', () => ({
  ptyClient: { resizeSession: vi.fn() },
}));
vi.mock('../core/emulatorRegistry', () => ({
  resizeEmulator: vi.fn(),
}));
// jsdom has no canvas, so pin the cell instead of measuring one.
vi.mock('../core/cellMetrics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../core/cellMetrics')>()),
  measureCell: () => ({ width: 7, height: 15 }),
}));

let fire: (() => void) | null = null;

class StubResizeObserver {
  constructor(cb: () => void) {
    fire = cb;
  }
  observe() {}
  disconnect() {}
}

function paneOf(width: number, height: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
  return el;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
  // The hook coalesces on a frame; run the callback immediately in tests.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.clearAllMocks();
  fire = null;
});

afterEach(() => vi.unstubAllGlobals());

describe('useTerminalSize', () => {
  it('reports the measured grid to both the PTY and the emulator on mount', () => {
    const ref = { current: paneOf(700, 450) };
    renderHook(() => useTerminalSize(ref, 'session-1'));

    expect(ptyClient.resizeSession).toHaveBeenCalledWith('session-1', 100, 30);
    expect(resizeEmulator).toHaveBeenCalledWith('session-1', 100, 30);
  });

  it('does not resend an unchanged size', () => {
    const ref = { current: paneOf(700, 450) };
    renderHook(() => useTerminalSize(ref, 'session-1'));
    expect(ptyClient.resizeSession).toHaveBeenCalledTimes(1);

    // A repaint that does not change the grid must not cost a SIGWINCH: every
    // one of those makes a running agent redraw itself.
    fire?.();
    expect(ptyClient.resizeSession).toHaveBeenCalledTimes(1);
  });

  it('reports again when the grid actually changes', () => {
    const el = paneOf(700, 450);
    const ref = { current: el };
    renderHook(() => useTerminalSize(ref, 'session-1'));

    Object.defineProperty(el, 'clientWidth', { value: 350, configurable: true });
    fire?.();

    expect(ptyClient.resizeSession).toHaveBeenLastCalledWith('session-1', 50, 30);
  });

  it('does nothing for a pane with no session, such as a scratchpad', () => {
    const ref = { current: paneOf(700, 450) };
    renderHook(() => useTerminalSize(ref, null));

    expect(ptyClient.resizeSession).not.toHaveBeenCalled();
    expect(resizeEmulator).not.toHaveBeenCalled();
  });

  it('ignores a pane with no layout box', () => {
    // A hidden or not-yet-laid-out pane measures 0x0. Sizing from that clamps to
    // the 20x4 floor and hands that session a 20-column terminal.
    const ref = { current: paneOf(0, 0) };
    renderHook(() => useTerminalSize(ref, 'session-1'));

    expect(ptyClient.resizeSession).not.toHaveBeenCalled();
    expect(resizeEmulator).not.toHaveBeenCalled();
  });

  it('reports once a hidden pane is given a box', () => {
    const el = paneOf(0, 0);
    const ref = { current: el };
    renderHook(() => useTerminalSize(ref, 'session-1'));
    expect(ptyClient.resizeSession).not.toHaveBeenCalled();

    Object.defineProperty(el, 'clientWidth', { value: 700, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 450, configurable: true });
    fire?.();

    expect(ptyClient.resizeSession).toHaveBeenCalledWith('session-1', 100, 30);
  });

  it('keeps reporting after a frame that ran synchronously', () => {
    // The guard must not latch. Testing the frame handle rather than a flag set
    // before scheduling leaves it non-zero forever the first time a callback
    // runs inside requestAnimationFrame().
    const el = paneOf(700, 450);
    const ref = { current: el };
    renderHook(() => useTerminalSize(ref, 'session-1'));

    Object.defineProperty(el, 'clientWidth', { value: 350, configurable: true });
    fire?.();
    Object.defineProperty(el, 'clientWidth', { value: 210, configurable: true });
    fire?.();

    expect(ptyClient.resizeSession).toHaveBeenLastCalledWith('session-1', 30, 30);
  });
});
