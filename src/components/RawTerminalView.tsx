import React, { useEffect, useRef, useState } from 'react';
import { AnsiLine } from '../types/terminal';
import { audioEngine } from '../core/audioEngine';
import { spanStyle } from '../core/spanStyle';
import { useTerminalSize } from '../hooks/useTerminalSize';
import { stepTurn, turnStarts, turnText } from '../core/turnMarks';
import { noteTotal, detach, reattach, runSearch, stepHit, stateOf } from '../core/scrollback';
import { BINDINGS, VIEW_BINDINGS, isAppChord, matchViewAction } from '../core/keymap';
import { bracketPaste, commandRegion } from '../core/terminalSelection';
import { findQuickTargets, labelTargets } from '../core/quickSelect';
import { isModalKeyboardOwned } from '../core/modalKeyboard';
import { QuickSelectOverlay } from './QuickSelectOverlay';

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
  /** Where the caret is, indexing `lines`. Absent before the first frame. */
  cursor?: { row: number; col: number } | null;
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
  cursor = null,
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
  const [quickSelecting, setQuickSelecting] = useState(false);
  const queryRef = useRef('');
  const marks = turnStarts(lines, agentKey);
  const quickTargets = React.useMemo(
    () => labelTargets(findQuickTargets(lines.slice(-200))),
    [lines],
  );

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
    // A transient surface is up and the key belongs to it, not to the process.
    // The capture-phase listener in core/modalKeyboard.ts should already have
    // stopped this event before React dispatched it; this is the same contract
    // stated where it is easy to test, and the difference between a missed
    // keystroke and Enter reaching a live shell through a destructive prompt.
    if (isModalKeyboardOwned()) return;

    if (!keymapSeen) {
      try { localStorage.setItem(KEYMAP_SEEN_KEY, '1'); } catch { /* private mode */ }
      setKeymapSeen(true);
    }

    const viewAction = matchViewAction(e);
    if (viewAction) {
      e.preventDefault();
      e.stopPropagation();
      if (viewAction === 'copySelection') {
        const selected = window.getSelection()?.toString();
        if (selected) void navigator.clipboard?.writeText(selected);
      } else if (viewAction === 'pasteClipboard') {
        void navigator.clipboard?.readText().then((text) => {
          if (text) onWrite(bracketPaste(text));
        });
      } else if (viewAction === 'copyTurn') {
        const current = sessionId && stateOf(sessionId).detached
          ? stateOf(sessionId).line
          : Math.max(0, lines.length - 1);
        const text = turnText(lines, marks, current);
        if (text) void navigator.clipboard?.writeText(text);
      } else if (viewAction === 'quickSelect') {
        setQuickSelecting((open) => !open);
      } else if (sessionId) {
        const current = stateOf(sessionId).detached
          ? stateOf(sessionId).line
          : Math.max(0, lines.length - 1);
        const target = stepTurn(marks, current, viewAction === 'previousTurn' ? -1 : 1);
        const row = target === null
          ? undefined
          : scrollRef.current?.querySelector<HTMLElement>(`[data-terminal-line="${target}"]`);
        if (target !== null && scrollRef.current && row) {
          detachedRef.current = true;
          detach(sessionId, target);
          scrollRef.current.scrollTop = Math.max(0, row.offsetTop - scrollRef.current.clientHeight / 4);
        }
      }
      return;
    }

    // Quick-select owns the following key at window level. Let it bubble, but
    // never also encode the label into the shell running underneath it.
    if (quickSelecting) return;

    // App chords stay with the app; everything else is the process's, byte for
    // byte. The list lives in one place — see `core/keymap.ts` — because this
    // view and the window handler holding their own copies is what silently
    // broke Ctrl+K, Ctrl+P and Ctrl+1..9 while the on-screen keymap went on
    // advertising them.
    //
    // Returning here rather than stopping is the entire mechanism: React
    // dispatches from the root container, so `stopPropagation` at this level
    // stops the event before `window` — and therefore `useGlobalKeys` — can
    // ever see it. The terminal takes focus whenever its pane is active, so in
    // practice nothing else was ever focused to receive them.
    if (isAppChord(e)) return;

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
    onWrite(bracketPaste(text));
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    containerRef.current?.focus({ preventScroll: true });
    if (e.detail !== 3 || (!e.ctrlKey && !e.metaKey)) return;
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-terminal-line]');
    const index = Number(row?.dataset.terminalLine);
    if (!row || !Number.isInteger(index)) return;

    const region = commandRegion(lines, index, marks);
    const start = scrollRef.current?.querySelector<HTMLElement>(`[data-terminal-line="${region.start}"]`);
    const end = scrollRef.current?.querySelector<HTMLElement>(`[data-terminal-line="${region.end}"]`);
    const selection = window.getSelection();
    if (!start || !end || !selection) return;
    e.preventDefault();
    const range = document.createRange();
    range.setStartBefore(start);
    range.setEndAfter(end);
    selection.removeAllRanges();
    selection.addRange(range);
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
      onMouseDown={handleMouseDown}
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
        {lines.map((line, i) => (
          // No break-all: a TUI's box drawing must not be split mid-frame.
          <div
            key={line.id}
            data-terminal-line={i}
            className="grid"
            style={{ gridTemplateColumns: `${GUTTER_PX}px 1fr` }}
          >
            {/* Four pixels is the whole feature. No card, no border, no header
                — you do not need blocks to have boundaries, you need marks. */}
            <i
              aria-hidden="true"
              className="block w-1 h-[13px] mt-[3px]"
              style={{ background: marks.has(i) ? 'var(--st-live)' : 'transparent' }}
            />
            <span className="whitespace-pre relative block">
              {line.spans.map((span, spanIdx) => (
                <span key={spanIdx} style={spanStyle(span, line.isError)}>
                  {span.text}
                </span>
              ))}
              {/*
                  The caret.

                  Positioned in `ch` rather than measured pixels: in a monospace
                  face `1ch` IS the advance width, so the column lands exactly
                  without a canvas measurement that would have to be redone on
                  every font or zoom change. Vertically it is anchored inside
                  its own row, so it cannot drift the way a `row * cellHeight`
                  offset does once the quantised cell height and the real line
                  box disagree.

                  Filled when this pane has the keyboard, hollow when it does
                  not — the convention Ghostty, kitty and WezTerm share, and the
                  only thing on screen that distinguishes the pane you are
                  typing into from the three you are not.
              */}
              {cursor && cursor.row === i && (
                <i
                  aria-hidden="true"
                  data-testid="terminal-cursor"
                  className="absolute top-0 pointer-events-none"
                  style={{
                    left: `${cursor.col}ch`,
                    width: '1ch',
                    height: '100%',
                    background: hasFocus ? 'var(--st-live)' : 'transparent',
                    boxShadow: hasFocus ? 'none' : 'inset 0 0 0 1px var(--st-live)',
                    mixBlendMode: hasFocus ? 'difference' : 'normal',
                  }}
                />
              )}
            </span>
          </div>
        ))}
      </div>

      {/*
          The only place the keys are written down.

          Pinned to the pane rather than laid out at the top of the scrollback,
          which is where it used to be and where it was never once read: the
          view follows the tail, so any session with more than a screenful of
          history scrolled the keymap out of sight in the same frame it
          rendered. First run is still what retires it, and one keystroke does
          that forever — but while it is up it is up where it can be seen.

          The rows come from the keymap table itself, so a chord that stops
          working stops being advertised.
      */}
      {!keymapSeen && (
        <div
          data-testid="keymap"
          className="absolute left-0 right-0 top-0 p-3 select-none text-[13px] leading-snug"
          // Opaque, not a fade: a gradient let the scrollback show through the
          // last rows and the two texts interleaved into an unreadable mess.
          // The rule underneath is the same one the plate uses to cut content
          // into chrome, so it reads as a layer rather than as garbled output.
          style={{
            color: 'var(--ink-dim)',
            background: 'var(--ground)',
            boxShadow: 'inset 0 -1px 0 #2a2723',
          }}
        >
          {[...BINDINGS.map((b) => [b.label, b.description]), ...VIEW_BINDINGS.map((b) => [b.label, b.description])].map(
            ([k, what]) => (
              <div key={k} className="grid" style={{ gridTemplateColumns: '16ch 1fr' }}>
                <span style={{ color: 'var(--st-live)' }}>{k}</span>
                <span>{what}</span>
              </div>
            ),
          )}
          <div className="pt-1" style={{ color: 'var(--ink-dim)', opacity: 0.7 }}>
            any key to dismiss
          </div>
        </div>
      )}
      {quickSelecting && (
        <QuickSelectOverlay
          targets={quickTargets}
          onClose={() => setQuickSelecting(false)}
          onSelect={(target, insert) => {
            if (insert) onWrite(target.value);
            else void navigator.clipboard?.writeText(target.value);
            setQuickSelecting(false);
          }}
        />
      )}
    </div>
  );
};
