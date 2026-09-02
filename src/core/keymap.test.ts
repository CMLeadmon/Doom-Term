import { describe, it, expect } from 'vitest';
import { BINDINGS, isAppChord, matchAction, matchViewAction, type KeyLike } from './keymap';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe('matchAction', () => {
  it('reserves Ctrl+Shift+A for the next session that needs attention', () => {
    expect(matchAction(key('a', { ctrlKey: true, shiftKey: true }))).toEqual({
      action: 'nextAttention',
    });
  });

  it('opens the palette on Ctrl+K', () => {
    // The one chord a user should never have to look up, and the one the whole
    // keyboard regression was reported against.
    expect(matchAction(key('k', { ctrlKey: true }))).toEqual({ action: 'palette' });
  });

  it('accepts the shifted aliases for the palette', () => {
    // Ctrl+Shift+K and Ctrl+Shift+P exist so a user coming from Ghostty, kitty
    // or WezTerm — where Ctrl+Shift is the terminal's whole namespace — finds it
    // without being told.
    expect(matchAction(key('K', { ctrlKey: true, shiftKey: true }))).toEqual({ action: 'palette' });
    expect(matchAction(key('P', { ctrlKey: true, shiftKey: true }))).toEqual({ action: 'palette' });
  });

  it('reports the session number for Ctrl+1..9', () => {
    expect(matchAction(key('3', { ctrlKey: true }))).toEqual({ action: 'jumpToSession', digit: 3 });
    expect(matchAction(key('9', { ctrlKey: true }))).toEqual({ action: 'jumpToSession', digit: 9 });
  });

  it('leaves Ctrl+0 to the process — there is no session zero', () => {
    expect(matchAction(key('0', { ctrlKey: true }))).toBeNull();
  });

  it('does not take the plain readline chords an agent needs', () => {
    // Every one of these was claimed by the old window handler. Claude Code,
    // Codex and Antigravity all edit their prompt with them, and the terminal
    // is a guest in its own window.
    expect(matchAction(key('p', { ctrlKey: true }))).toBeNull(); // previous-history
    expect(matchAction(key('w', { ctrlKey: true }))).toBeNull(); // kill word back
    expect(matchAction(key('o', { ctrlKey: true }))).toBeNull(); // operate-and-get-next
    expect(matchAction(key('a', { ctrlKey: true }))).toBeNull(); // start of line
    expect(matchAction(key('e', { ctrlKey: true }))).toBeNull(); // end of line
    expect(matchAction(key('u', { ctrlKey: true }))).toBeNull(); // kill to start
  });

  it('never takes Ctrl+M, which is the Enter key', () => {
    // Ctrl+M is byte 0x0D. Binding mute to it — as the old table did — means
    // Enter stops submitting the moment the chord actually reaches the window.
    expect(matchAction(key('m', { ctrlKey: true }))).toBeNull();
    expect(matchAction(key('m', { ctrlKey: true, shiftKey: true }))).toEqual({
      action: 'toggleAudio',
    });
  });

  it('ignores a bare key, and one carrying Alt or Meta', () => {
    // Alt+Ctrl+K is a distinct chord and may well be the process's.
    expect(matchAction(key('k'))).toBeNull();
    expect(matchAction(key('k', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(matchAction(key('k', { ctrlKey: true, metaKey: true }))).toBeNull();
    expect(matchAction(key('1'))).toBeNull();
  });

  it('distinguishes shifted from unshifted rather than ignoring shift', () => {
    // Ctrl+Shift+T is a new session; plain Ctrl+T is readline's transpose-chars.
    expect(matchAction(key('t', { ctrlKey: true, shiftKey: true }))).toEqual({
      action: 'newSession',
    });
    expect(matchAction(key('t', { ctrlKey: true }))).toBeNull();
  });
});

describe('isAppChord', () => {
  it('agrees with matchAction on every documented chord', () => {
    // The invariant the whole file exists for: the view asks isAppChord to
    // decide what to let bubble, the window handler asks matchAction what to
    // do, and a chord one of them recognises and the other does not is a key
    // that either does nothing or does two things.
    for (const binding of BINDINGS) {
      for (const chord of binding.chords) {
        const e = key(chord.digit ? '5' : chord.key, {
          ctrlKey: !!chord.ctrl,
          shiftKey: !!chord.shift,
        });
        expect(isAppChord(e), `${binding.label} must bubble`).toBe(true);
        expect(matchAction(e)?.action).toBe(binding.action);
      }
    }
  });

  it('is false for ordinary typing, which must reach the PTY', () => {
    for (const k of ['a', 'Z', '4', ' ', 'Enter', 'Backspace', 'ArrowUp', 'Tab']) {
      expect(isAppChord(key(k)), `${k} must go to the process`).toBe(false);
    }
  });
});

describe('terminal-owned clipboard chords', () => {
  it('keeps Ctrl+Shift+C/V in the view while plain Ctrl+C stays SIGINT', () => {
    expect(matchViewAction(key('C', { ctrlKey: true, shiftKey: true }))).toBe('copySelection');
    expect(matchViewAction(key('V', { ctrlKey: true, shiftKey: true }))).toBe('pasteClipboard');
    expect(matchViewAction(key('c', { ctrlKey: true }))).toBeNull();
  });
});

describe('the printed keymap', () => {
  it('labels every binding with a chord that actually matches', () => {
    // The overlay renders these strings. A label that no key press satisfies is
    // exactly the failure being fixed — six documented chords, three of which
    // did nothing at all.
    for (const binding of BINDINGS) {
      const parts = binding.label.split('+');
      const last = parts[parts.length - 1];
      const e = key(last === '1..9' ? '1' : last.toLowerCase(), {
        ctrlKey: parts.includes('CTRL'),
        shiftKey: parts.includes('SHIFT'),
      });
      expect(matchAction(e)?.action, `${binding.label} is a lie`).toBe(binding.action);
    }
  });
});
