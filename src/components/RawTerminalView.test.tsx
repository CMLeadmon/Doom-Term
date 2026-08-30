import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { RawTerminalView, keyToBytes } from './RawTerminalView';
import { ptyClient } from '../core/ptyClient';

// jsdom has no ResizeObserver, and a pane given a session id constructs one.
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

const key = (over: Partial<Parameters<typeof keyToBytes>[0]>) =>
  keyToBytes({ key: '', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...over });

describe('keyToBytes', () => {
  it('sends plain characters as themselves', () => {
    expect(key({ key: 'a' })).toBe('a');
    expect(key({ key: '?' })).toBe('?');
  });

  it('encodes the named keys a TUI listens for', () => {
    expect(key({ key: 'Enter' })).toBe('\r');
    expect(key({ key: 'Backspace' })).toBe('\x7f');
    expect(key({ key: 'Escape' })).toBe('\x1b');
    expect(key({ key: 'ArrowUp' })).toBe('\x1b[A');
    expect(key({ key: 'Home' })).toBe('\x1b[H');
    expect(key({ key: 'End' })).toBe('\x1b[F');
    expect(key({ key: 'Delete' })).toBe('\x1b[3~');
  });

  it('encodes Ctrl+letter as its control character', () => {
    // Only ctrl+c/d/z used to be handled, so an agent's readline bindings —
    // Ctrl+A, Ctrl+E, Ctrl+U, Ctrl+W — never reached it at all.
    expect(key({ key: 'a', ctrlKey: true })).toBe('\x01');
    expect(key({ key: 'e', ctrlKey: true })).toBe('\x05');
    expect(key({ key: 'u', ctrlKey: true })).toBe('\x15');
    expect(key({ key: 'w', ctrlKey: true })).toBe('\x17');
  });

  it('encodes Shift+Tab as back-tab, not a plain tab', () => {
    expect(key({ key: 'Tab' })).toBe('\t');
    expect(key({ key: 'Tab', shiftKey: true })).toBe('\x1b[Z');
  });

  it('encodes Alt+key with an ESC prefix', () => {
    expect(key({ key: 'b', altKey: true })).toBe('\x1bb');
  });

  it('sends nothing for keys that are not input', () => {
    expect(key({ key: 'Shift' })).toBeNull();
    expect(key({ key: 'F5' })).toBeNull();
    expect(key({ key: 'v', metaKey: true })).toBeNull();
  });
});

describe('RawTerminalView', () => {
  const base = {
    lines: [],
    onWrite: vi.fn(),
    onSendSignal: vi.fn(),
  };

  it('takes the keyboard as soon as it is the active pane', () => {
    // Without this the view mounted unfocused: its keydown handler could not be
    // reached, every keystroke fell through to the window shortcuts, and the
    // terminal looked broken with nothing on screen saying why.
    render(<RawTerminalView {...base} isActive />);
    expect(document.activeElement).toBe(screen.getByTestId('raw-terminal'));
  });

  it('does not steal the keyboard when it is not the active pane', () => {
    render(<RawTerminalView {...base} isActive={false} />);
    expect(document.activeElement).not.toBe(screen.getByTestId('raw-terminal'));
  });

  it('writes typed characters straight through to the PTY', () => {
    const onWrite = vi.fn();
    render(<RawTerminalView {...base} onWrite={onWrite} isActive />);
    const term = screen.getByTestId('raw-terminal');
    fireEvent.keyDown(term, { key: 'h' });
    fireEvent.keyDown(term, { key: 'i' });
    fireEvent.keyDown(term, { key: 'Enter' });
    expect(onWrite.mock.calls.map((c) => c[0])).toEqual(['h', 'i', '\r']);
  });

  it('routes the three signals to the process group, not the byte stream', () => {
    const onWrite = vi.fn();
    const onSendSignal = vi.fn();
    render(<RawTerminalView {...base} onWrite={onWrite} onSendSignal={onSendSignal} isActive />);
    fireEvent.keyDown(screen.getByTestId('raw-terminal'), { key: 'c', ctrlKey: true });
    expect(onSendSignal).toHaveBeenCalledWith('ctrl+c');
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('leaves Ctrl+Shift chords for the app', () => {
    const onWrite = vi.fn();
    render(<RawTerminalView {...base} onWrite={onWrite} isActive />);
    fireEvent.keyDown(screen.getByTestId('raw-terminal'), {
      key: 'P', ctrlKey: true, shiftKey: true,
    });
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('brackets a multi-line paste so it is not executed line by line', () => {
    const onWrite = vi.fn();
    render(<RawTerminalView {...base} onWrite={onWrite} isActive />);
    fireEvent.paste(screen.getByTestId('raw-terminal'), {
      clipboardData: { getData: () => 'one\ntwo' },
    });
    expect(onWrite).toHaveBeenCalledWith('\x1b[200~one\ntwo\x1b[201~');
  });

  it('says who holds the keyboard', () => {
    render(<RawTerminalView {...base} agentName="ANTIGRAVITY" isActive />);
    expect(screen.getByText(/ANTIGRAVITY HOLDS THE KEYBOARD/)).toBeDefined();
  });

  it('reports the keyboard state on screen', () => {
    render(<RawTerminalView {...base} isActive />);
    expect(screen.getByText('KEYBOARD LIVE')).toBeDefined();
  });

  it('reports its grid size for the session it belongs to', () => {
    // Before this, every session ran at a hardcoded 120x30 for its whole life:
    // nothing ever called resizeSession, so SIGWINCH never fired.
    const spy = vi.spyOn(ptyClient, 'resizeSession').mockImplementation(() => {});
    render(<RawTerminalView {...base} sessionId="session-1" isActive />);
    expect(spy).toHaveBeenCalledWith('session-1', expect.any(Number), expect.any(Number));
    spy.mockRestore();
  });
});
