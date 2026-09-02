/**
 * The one definition of the app's own keyboard chords.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * There were two lists and they disagreed, which cost the app its entire
 * keyboard. `useGlobalKeys` listened on the window for Ctrl+P, Ctrl+K, Ctrl+W,
 * Ctrl+M and Ctrl+1..9. `RawTerminalView` called `e.stopPropagation()` on every
 * key except Ctrl+Shift+{P,T,W}, and React dispatches from the root container —
 * so stopping there stops the event before `window` ever sees it. The terminal
 * takes focus whenever its pane is active, and the terminal IS the app now, so
 * in practice nothing was ever unfocused: the palette could not be opened and
 * no session could be reached by number. The on-screen keymap advertised all of
 * it anyway.
 *
 * A chord is app-owned or it is the process's, and exactly one table decides.
 * The view consults it to know what to let bubble, the window handler consults
 * it to know what to act on, and the keymap overlay renders FROM it — so the
 * documentation cannot drift from the behaviour again.
 *
 * ── WHY THESE CHORDS ───────────────────────────────────────────────────────
 *
 * A pass-through terminal is a guest in its own window: Claude Code, Codex and
 * Antigravity all use readline bindings, so every plain Ctrl+letter we take is
 * one their line editor loses. Ghostty, kitty and WezTerm all answer this the
 * same way on Linux — `Ctrl+Shift+*` is the terminal's namespace and plain
 * Ctrl belongs to the process — and that is the rule here, with two deliberate
 * exceptions:
 *
 *   - `Ctrl+K`, because it is the switcher and it is asked for by name. It
 *     costs readline's kill-to-end-of-line, which is the price of the one chord
 *     a user should never have to look up.
 *   - `Ctrl+1..9`, because Ctrl with a digit is not a readline binding at all
 *     and on most terminals produces nothing. Taking it costs nobody anything.
 *
 * Deliberately NOT taken, all of which the old table claimed: plain `Ctrl+P`
 * (previous-history), `Ctrl+W` (kill word back), `Ctrl+O` (operate-and-get-next)
 * and above all `Ctrl+M`, which is byte 0x0D — the same key as Enter. Binding
 * mute to it would have made Enter stop working the moment the chord actually
 * reached the window handler.
 */

/** Everything the window-level handler can be asked to do. */
export type AppAction =
  | 'palette'
  | 'newSession'
  | 'closeSession'
  | 'openWorkspace'
  | 'toggleAudio'
  | 'nextAttention'
  | 'jumpToSession';

/** The shape both a real KeyboardEvent and a React synthetic one satisfy. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

interface Chord {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  /** Matches '1'..'9' rather than one literal key. */
  digit?: boolean;
}

export interface Binding {
  action: AppAction;
  /** The first is canonical and is the one the keymap prints. */
  chords: Chord[];
  /** As drawn in the overlay. */
  label: string;
  description: string;
}

/**
 * Order is the order the keymap overlay lists them, so it reads as an
 * introduction: how to find everything, how to move, then how to manage.
 */
export const BINDINGS: Binding[] = [
  {
    action: 'palette',
    chords: [
      { key: 'k', ctrl: true },
      { key: 'k', ctrl: true, shift: true },
      { key: 'p', ctrl: true, shift: true },
    ],
    label: 'CTRL+K',
    description: 'sessions, and every other command',
  },
  {
    action: 'jumpToSession',
    chords: [{ key: '', ctrl: true, digit: true }],
    label: 'CTRL+1..9',
    description: 'go straight to that session',
  },
  {
    action: 'nextAttention',
    chords: [{ key: 'a', ctrl: true, shift: true }],
    label: 'CTRL+SHIFT+A',
    description: 'next session that needs attention',
  },
  {
    action: 'newSession',
    chords: [{ key: 't', ctrl: true, shift: true }],
    label: 'CTRL+SHIFT+T',
    description: 'new session',
  },
  {
    action: 'closeSession',
    chords: [{ key: 'w', ctrl: true, shift: true }],
    label: 'CTRL+SHIFT+W',
    description: 'close this session',
  },
  {
    action: 'openWorkspace',
    chords: [{ key: 'o', ctrl: true, shift: true }],
    label: 'CTRL+SHIFT+O',
    description: 'open a folder',
  },
  {
    action: 'toggleAudio',
    chords: [{ key: 'm', ctrl: true, shift: true }],
    label: 'CTRL+SHIFT+M',
    description: 'mute',
  },
];

/**
 * The two chords the terminal view handles itself.
 *
 * They never reach the window handler and are not in BINDINGS for that reason,
 * but a keymap that omitted them would be describing a different app — search
 * is the whole point of keeping scrollback.
 */
export type ViewAction =
  | 'copySelection'
  | 'pasteClipboard'
  | 'previousTurn'
  | 'nextTurn'
  | 'copyTurn'
  | 'quickSelect';

interface ViewBinding {
  action?: ViewAction;
  chords?: Chord[];
  label: string;
  description: string;
}

export const VIEW_BINDINGS: ViewBinding[] = [
  {
    action: 'copySelection',
    chords: [{ key: 'c', ctrl: true, shift: true }],
    label: 'CTRL+SHIFT+C',
    description: 'copy selection',
  },
  {
    action: 'previousTurn',
    chords: [{ key: '{', ctrl: true, shift: true }],
    label: 'CTRL+SHIFT+[',
    description: 'previous agent turn',
  },
  {
    action: 'nextTurn',
    chords: [{ key: '}', ctrl: true, shift: true }],
    label: 'CTRL+SHIFT+]',
    description: 'next agent turn',
  },
  {
    action: 'copyTurn',
    chords: [{ key: 'y', ctrl: true, shift: true }],
    label: 'CTRL+SHIFT+Y',
    description: 'copy this agent turn',
  },
  {
    action: 'quickSelect',
    chords: [{ key: 'e', ctrl: true, shift: true }],
    label: 'CTRL+SHIFT+E',
    description: 'select a developer reference',
  },
  {
    action: 'pasteClipboard',
    chords: [{ key: 'v', ctrl: true, shift: true }],
    label: 'CTRL+SHIFT+V',
    description: 'paste safely',
  },
  { label: 'CTRL+TRIPLE CLICK', description: 'select this command/turn' },
  { label: 'CTRL+F', description: 'search this session' },
  { label: 'END', description: 'back to the newest line' },
];

function isDigitKey(key: string): boolean {
  return key.length === 1 && key >= '1' && key <= '9';
}

function chordMatches(chord: Chord, e: KeyLike): boolean {
  // Alt and Meta are never part of an app chord; a chord that ignored them
  // would fire on Alt+Ctrl+K, which the process may well want.
  if (e.altKey || e.metaKey) return false;
  if (!!chord.ctrl !== e.ctrlKey) return false;
  if (!!chord.shift !== e.shiftKey) return false;
  if (chord.digit) return isDigitKey(e.key);
  return e.key.toLowerCase() === chord.key;
}

/**
 * Which app action this key press is, or null when it belongs to the process.
 *
 * `digit` is set only for jumpToSession, and is the session number pressed.
 */
export function matchAction(e: KeyLike): { action: AppAction; digit?: number } | null {
  for (const binding of BINDINGS) {
    for (const chord of binding.chords) {
      if (!chordMatches(chord, e)) continue;
      return chord.digit
        ? { action: binding.action, digit: Number(e.key) }
        : { action: binding.action };
    }
  }
  return null;
}

/**
 * Should the terminal let this key through to the window handler?
 *
 * The single question `RawTerminalView` has to answer, and the reason the two
 * lists can no longer disagree.
 */
export function isAppChord(e: KeyLike): boolean {
  return matchAction(e) !== null;
}

/** View-local chords never bubble because they need the pane's selection/PTY. */
export function matchViewAction(e: KeyLike): ViewAction | null {
  for (const binding of VIEW_BINDINGS) {
    if (!binding.action) continue;
    if (binding.chords?.some((chord) => chordMatches(chord, e))) return binding.action;
  }
  return null;
}
