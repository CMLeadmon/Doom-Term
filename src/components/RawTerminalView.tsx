import React, { useEffect, useRef, useState } from 'react';
import { AnsiLine } from '../types/terminal';
import { audioEngine } from '../core/audioEngine';
import { spanStyle } from '../core/spanStyle';
import { useTerminalSize } from '../hooks/useTerminalSize';

interface RawTerminalViewProps {
  lines: AnsiLine[];
  onWrite: (data: string) => void;
  onSendSignal: (sig: 'ctrl+c' | 'ctrl+d' | 'ctrl+z') => void;
  onExitRawMode?: () => void;
  isTuiSession?: boolean;
  /** The agent holding the keyboard, for the header. Null for a bare TUI. */
  agentName?: string | null;
  /** Only the focused pane grabs the keyboard; the others must not steal it. */
  isActive?: boolean;
  /** The session whose grid this pane sizes. Null for a view with no PTY. */
  sessionId?: string | null;
}

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
  onExitRawMode,
  isTuiSession = false,
  agentName = null,
  isActive = true,
  sessionId = null,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hasFocus, setHasFocus] = useState(false);

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
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines]);

  // Size from the grid container, not the outer box: the header plate above it
  // is chrome, and counting it would hand the shell more rows than it can show.
  useTerminalSize(scrollRef, sessionId);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // App chords stay with the app. Only Ctrl+SHIFT combinations are reserved:
    // plain Ctrl+P, Ctrl+K, Ctrl+W and friends are readline bindings the agent
    // is entitled to, and stealing them would break its own editing.
    if (e.ctrlKey && e.shiftKey && ['P', 'T', 'W'].includes(e.key.toUpperCase())) {
      return; // let it bubble to the window handler
    }

    e.stopPropagation();

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

  const label = agentName
    ? `${agentName} HOLDS THE KEYBOARD`
    : isTuiSession
      ? 'INTERACTIVE TUI RUNNING (DECSET 1049)'
      : 'RAW PASS-THROUGH MODE';

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
      className="flex-1 flex flex-col recess overflow-hidden focus:outline-none relative"
    >
      {/* MODE B HEADER BAR */}
      <div
        className="plate px-3 py-1 flex items-center justify-between text-xs font-mono select-none z-10 shrink-0"
        style={{ color: 'var(--ink-plate)' }}
      >
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2" style={{ background: 'var(--st-live)' }} />
          <span className="font-bold tracking-wider">{label}</span>
          <span className="hidden sm:inline" style={{ color: '#3d3830' }}>
            - Direct PTY Line Discipline Active
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {/* The keyboard state has to be visible. A terminal that silently is
              not focused is indistinguishable from one that is broken. */}
          <span
            className="px-1.5 py-0.5 text-[10px] font-bold tracking-wider"
            style={{
              color: hasFocus ? '#1d3b12' : '#4a3a06',
              boxShadow: 'var(--bevel-dn)',
              background: hasFocus ? 'var(--st-pass)' : 'var(--st-live)',
            }}
          >
            {hasFocus ? 'KEYBOARD LIVE' : 'CLICK TO TYPE'}
          </span>

          <button
            onClick={() => onSendSignal('ctrl+c')}
            title="Send SIGINT (Ctrl+C)"
            className="plate px-2 py-0.5 text-[10px] font-bold"
            style={{ color: '#4a0806', boxShadow: 'var(--bevel-up), inset 0 0 0 1px #c02a22' }}
          >
            CTRL+C
          </button>

          {onExitRawMode && (
            <button
              onClick={onExitRawMode}
              title="Return to the command editor (the process keeps running)"
              className="plate px-1.5 py-0.5 text-xs font-bold"
              style={{ color: 'var(--ink-plate)' }}
            >
              <span>✕</span>
            </button>
          )}
        </div>
      </div>

      {/* CONTINUOUS VT LINE GRID */}
      <div
        ref={scrollRef}
        className="flex-1 p-3 overflow-y-auto font-mono text-[13px] leading-snug select-text"
      >
        {lines.map((line) => (
          // No break-all: a TUI's box drawing must not be split mid-frame.
          <div key={line.id} className="whitespace-pre">
            {line.spans.map((span, spanIdx) => (
              <span key={spanIdx} style={spanStyle(span, line.isError)}>
                {span.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
