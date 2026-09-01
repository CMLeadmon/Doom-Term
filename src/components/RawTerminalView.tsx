import React, { useEffect, useRef, useState } from 'react';
import { AnsiLine } from '../types/terminal';
import { audioEngine } from '../core/audioEngine';
import { spanStyle } from '../core/spanStyle';
import { useTerminalSize } from '../hooks/useTerminalSize';
import { turnStarts } from '../core/turnMarks';
import { noteTotal, detach, reattach, runSearch, stepHit, stateOf } from '../core/scrollback';

interface RawTerminalViewProps {
  lines: AnsiLine[];
  onWrite: (data: string) => void;
  onSendSignal: (sig: 'ctrl+c' | 'ctrl+d' | 'ctrl+z') => void;
  /** Only the focused pane grabs the keyboard; the others must not steal it. */
  isActive?: boolean;
  /** The session whose grid this pane sizes. Null for a view with no PTY. */
  sessionId?: string | null;
  /**
   * The agent key, for turn marks only — NOT a display name. The plate draws
   * who holds the keyboard; this decides where the gutter puts a mark.
   */
  agentKey?: string | null;
}

/** Gutter width. Reserved from the grid so the shell never wraps early. */
export const GUTTER_PX = 16;

/** Set by the first keystroke, ever. The keymap is a first-run thing. */
export const KEYMAP_SEEN_KEY = 'DOOM_TERM_KEYMAP_SEEN_V1';

/**
 * Map a keydown to the bytes a PTY expects.
 *
 * Split out of the component so every branch is testable without a DOM, and so
 * the list is readable as a table rather than twenty early returns.
 * Returns null when the key is not ours to send.
 */
export function keyToBytes(e: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): string | null {
  const NAMED: Record<string, string> = {
    Enter: '\r',
    Backspace: '\x7f',
    Tab: '\t',
    Escape: '\x1b',
    ArrowUp: '\x1b[A',
    ArrowDown: '\x1b[B',
    ArrowRight: '\x1b[C',
    ArrowLeft: '\x1b[D',
    Home: '\x1b[H',
    End: '\x1b[F',
    Delete: '\x1b[3~',
    Insert: '\x1b[2~',
    PageUp: '\x1b[5~',
    PageDown: '\x1b[6~',
  };

  // Ctrl+letter is the control character, which is how an agent CLI receives
  // Ctrl+A/E/K/U/W and every other readline binding. Without this the only
  // chords that reached the process were the three signals.
  if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1) {
    const c = e.key.toLowerCase();
    if (c >= 'a' && c <= 'z') return String.fromCharCode(c.charCodeAt(0) - 96);
    if (c === ' ') return '\x00';
    if (c === '[') return '\x1b';
    if (c === '\\') return '\x1c';
    if (c === ']') return '\x1d';
  }

  if (NAMED[e.key] !== undefined) {
    // Shift+Tab is the back-tab an agent's field navigation listens for.
    if (e.key === 'Tab' && e.shiftKey) return '\x1b[Z';
    return NAMED[e.key];
  }

  // Alt+key is ESC-prefixed, the standard meta encoding.
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1) return `\x1b${e.key}`;

  if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) return e.key;

  return null;
}

/**
 * Pass-through mode: the process owns the keyboard, byte for byte.
 *
 * This view is what an inline agent (Antigravity, Claude Code, Codex) needs and
 * never used to get. Two things were wrong. It only ever mounted on alt-screen,
 * which those agents do not use; and even when it did mount it never took
 * focus, so the div sat there with a keydown handler that nothing could reach
 * and every keystroke fell through to the window shortcuts.
 */
export const RawTerminalView: React.FC<RawTerminalViewProps> = ({
  lines,
  onWrite,
  onSendSignal,
  isActive = true,
  sessionId = null,
  agentKey = null,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hasFocus, setHasFocus] = useState(false);
  const detachedRef = useRef(false);
  /**
   * Search entry is a keyboard MODE, not a text box.
   *
   * The plate is the only chrome, so the query has nowhere else to live — and
   * it is already drawn there, in the transport's FIND row. Putting an input
   * over the terminal would be the one piece of floating chrome this whole
   * direction exists to remove.
   */
  /**
   * Has this user ever typed into a terminal here?
   *
   * The keymap below was first gated on an empty session, which sounded right
   * and was useless in practice: the shell prints a prompt within milliseconds,
   * so the empty state never lasts long enough to read. First run is the moment
   * that actually matters, and one keystroke retires it forever.
   */
  const [keymapSeen, setKeymapSeen] = useState(
    () => typeof localStorage !== 'undefined' && !!localStorage.getItem(KEYMAP_SEEN_KEY),
  );
  const [searching, setSearching] = useState(false);
  const queryRef = useRef('');
  const marks = turnStarts(lines, agentKey);

  // Take the keyboard as soon as this pane is the active one. A pass-through
  // terminal that is not focused is a terminal you cannot type into, and there
  // is nothing on screen to tell you why — which is exactly how it failed.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (isActive) {
      if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
      return;
    }
    // Give the keyboard back on deactivate. Now that every pane stays mounted, a
    // hidden one still holding focus would swallow every keystroke silently.
    if (el.contains(document.activeElement)) {
      (document.activeElement as HTMLElement | null)?.blur();
    }
  }, [isActive]);

  // Follow the tail. useLayoutEffect, not useEffect: after paint the browser has
  // already shown the new lines at the old offset, which is a visible jump.
  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (sessionId) noteTotal(sessionId, lines.length);
    // Only chase the tail while attached. Snapping a reader back to the bottom
    // every time the agent emits is what makes reading back impossible.
    if (!detachedRef.current) el.scrollTop = el.scrollHeight;
  }, [lines, sessionId]);

  /**
   * Leaving the tail is what puts the plate into transport mode. Read from a
   * ref rather than state so the layout effect above sees the current value
   * without re-running on every scroll event.
   */
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || !sessionId) return;
    const atBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 24;
    detachedRef.current = !atBottom;
    if (atBottom) reattach(sessionId);
    else detach(sessionId, Math.round((el.scrollTop / Math.max(1, el.scrollHeight)) * lines.length));
  };

  // Follow the search cursor. A hit you cannot see was found for nobody.
  React.useLayoutEffect(() => {
    if (!searching || !sessionId || !scrollRef.current) return;
    const st = stateOf(sessionId);
    if (!st.hits) return;
    const el = scrollRef.current;
    const row = el.children[st.line] as HTMLElement | undefined;
    if (row) {
      detachedRef.current = true;
      el.scrollTop = Math.max(0, row.offsetTop - el.clientHeight / 2);
    }
  });

  // Size from the grid container rather than the outer box. They are nearly the
  // same now the header is gone, but the grid is the surface the shell actually
  // draws into and the padding is not the shell's to use.
  useTerminalSize(scrollRef, sessionId, GUTTER_PX);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!keymapSeen) {
      try { localStorage.setItem(KEYMAP_SEEN_KEY, '1'); } catch { /* private mode */ }
      setKeymapSeen(true);
    }

    // App chords stay with the app. Only Ctrl+SHIFT combinations are reserved:
    // plain Ctrl+P, Ctrl+K, Ctrl+W and friends are readline bindings the agent
    // is entitled to, and stealing them would break its own editing.
    if (e.ctrlKey && e.shiftKey && ['P', 'T', 'W'].includes(e.key.toUpperCase())) {
      return; // let it bubble to the window handler
    }

    e.stopPropagation();

    // Ctrl+F enters search. Ctrl+G / Ctrl+Shift+G step, which are the readline
    // bindings an agent does not use for editing.
    if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'f' && sessionId) {
      e.preventDefault();
      setSearching(true);
      queryRef.current = '';
      runSearch(sessionId, '', lines);
      return;
    }

    if (searching && sessionId) {
      e.preventDefault();
      if (e.key === 'Escape') {
        setSearching(false);
        queryRef.current = '';
        runSearch(sessionId, '', lines);
        return;
      }
      if (e.key === 'Enter') {
        stepHit(sessionId, e.shiftKey ? -1 : 1);
        return;
      }
      if (e.key === 'Backspace') {
        queryRef.current = queryRef.current.slice(0, -1);
        runSearch(sessionId, queryRef.current, lines);
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        queryRef.current += e.key;
        runSearch(sessionId, queryRef.current, lines);
        return;
      }
      return;   // swallow everything else so a stray key cannot reach the PTY
    }

    if (e.ctrlKey && !e.shiftKey && !e.altKey) {
      const c = e.key.toLowerCase();
      if (c === 'c') {
        e.preventDefault();
        audioEngine.playSound('oof', 1);
        onSendSignal('ctrl+c');
        return;
      }
      if (c === 'd') {
        e.preventDefault();
        onSendSignal('ctrl+d');
        return;
      }
      if (c === 'z') {
        e.preventDefault();
        onSendSignal('ctrl+z');
        return;
      }
    }

    // End returns you to the tail. The old design put this on a pulsing plate
    // button floating in the middle of the pane; it is a key and a readout now.
    if (e.key === 'End' && detachedRef.current && sessionId) {
      e.preventDefault();
      detachedRef.current = false;
      reattach(sessionId);
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      return;
    }

    const bytes = keyToBytes(e);
    if (bytes !== null) {
      e.preventDefault();
      onWrite(bytes);
    }
  };

  // A paste is one write, not a key per character — and bracketed so the agent
  // treats it as pasted text rather than executing each line as it arrives.
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData('text');
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    onWrite(text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text);
  };

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onFocus={() => setHasFocus(true)}
      onBlur={() => setHasFocus(false)}
      // Clicking anywhere in the terminal gives it the keyboard back, the way
      // every other terminal behaves.
      onMouseDown={() => containerRef.current?.focus({ preventScroll: true })}
      ref={containerRef}
      data-testid="raw-terminal"
      data-focused={hasFocus ? 'true' : 'false'}
      // One pixel of recess, and nothing else. "Edge to edge" meant no chrome,
      // not no boundary: the plate is raised, so the content it frames has to
      // be cut into it. The header that used to sit here narrated the line
      // discipline and duplicated the agent name the plate already draws.
      className="flex-1 flex flex-col recess overflow-hidden focus:outline-none relative"
    >
      {/* CONTINUOUS VT LINE GRID */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 p-3 overflow-y-auto font-mono text-[13px] leading-snug select-text"
      >
        {/*
            The only place the keys are written down.
            With no tab strip, no sidebar and no header, a new user has nothing
            to discover the app FROM — the palette is the map and it sits behind
            a chord you have to already know. An empty session is an invitation
            to act, so the keymap lives here and disappears the moment the shell
            says anything. It is content in an empty state, not chrome.
        */}
        {!keymapSeen && (
          <div className="select-none pb-3 mb-3" style={{ color: 'var(--ink-dim)', boxShadow: 'inset 0 -1px 0 #2a2723' }}>
            {[
              ['CTRL+P', 'everything else'],
              ['CTRL+1..9', 'go to session'],
              ['CTRL+SHIFT+T', 'new session'],
              ['CTRL+W', 'close session'],
              ['CTRL+F', 'search this session'],
              ['END', 'back to the newest line'],
            ].map(([k, what]) => (
              <div key={k} className="grid" style={{ gridTemplateColumns: '14ch 1fr' }}>
                <span style={{ color: 'var(--st-live)' }}>{k}</span>
                <span>{what}</span>
              </div>
            ))}
          </div>
        )}

        {lines.map((line, i) => (
          // No break-all: a TUI's box drawing must not be split mid-frame.
          <div key={line.id} className="grid" style={{ gridTemplateColumns: `${GUTTER_PX}px 1fr` }}>
            {/* Four pixels is the whole feature. No card, no border, no header
                — you do not need blocks to have boundaries, you need marks. */}
            <i
              aria-hidden="true"
              className="block w-1 h-[13px] mt-[3px]"
              style={{ background: marks.has(i) ? 'var(--st-live)' : 'transparent' }}
            />
            <span className="whitespace-pre">
              {line.spans.map((span, spanIdx) => (
                <span key={spanIdx} style={spanStyle(span, line.isError)}>
                  {span.text}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
