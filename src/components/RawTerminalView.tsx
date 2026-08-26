import React, { useEffect, useRef } from 'react';
import { AnsiLine } from '../types/terminal';
import { audioEngine } from '../core/audioEngine';

interface RawTerminalViewProps {
  lines: AnsiLine[];
  onWrite: (data: string) => void;
  onSendSignal: (sig: 'ctrl+c' | 'ctrl+d' | 'ctrl+z') => void;
  onExitRawMode?: () => void;
  isTuiSession?: boolean;
}

export const RawTerminalView: React.FC<RawTerminalViewProps> = ({
  lines,
  onWrite,
  onSendSignal,
  onExitRawMode,
  isTuiSession = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  // Intercept global keyboard input when Raw Mode is focused
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();

    // Signal shortcuts
    if (e.ctrlKey && e.key === 'c') {
      e.preventDefault();
      audioEngine.playSound('oof', 1);
      onSendSignal('ctrl+c');
      return;
    }
    if (e.ctrlKey && e.key === 'd') {
      e.preventDefault();
      onSendSignal('ctrl+d');
      return;
    }
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      onSendSignal('ctrl+z');
      return;
    }

    // Escape
    if (e.key === 'Escape') {
      e.preventDefault();
      onWrite('\x1b');
      return;
    }

    // Backspace
    if (e.key === 'Backspace') {
      e.preventDefault();
      onWrite('\x7f');
      return;
    }

    // Tab
    if (e.key === 'Tab') {
      e.preventDefault();
      onWrite('\t');
      return;
    }

    // Enter
    if (e.key === 'Enter') {
      e.preventDefault();
      onWrite('\r');
      return;
    }

    // Arrow keys (ANSI Cursor keys)
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      onWrite('\x1b[A');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onWrite('\x1b[B');
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onWrite('\x1b[C');
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onWrite('\x1b[D');
      return;
    }

    // PageUp / PageDown
    if (e.key === 'PageUp') {
      e.preventDefault();
      onWrite('\x1b[5~');
      return;
    }
    if (e.key === 'PageDown') {
      e.preventDefault();
      onWrite('\x1b[6~');
      return;
    }

    // Normal typing
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      onWrite(e.key);
      return;
    }
  };

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      ref={containerRef}
      className="flex-1 flex flex-col recess overflow-hidden focus:outline-none relative"
    >
      {/* MODE B HEADER BAR */}
      <div className="plate px-3 py-1 flex items-center justify-between text-xs font-mono select-none z-10 shrink-0" style={{ color: 'var(--ink-plate)' }}>
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2" style={{ background: 'var(--st-live)' }} />
          <span className="font-bold tracking-wider">
            {isTuiSession ? 'INTERACTIVE TUI RUNNING (DECSET 1049)' : 'RAW PASS-THROUGH MODE'}
          </span>
          <span className="hidden sm:inline" style={{ color: '#3d3830' }}>
            - Direct PTY Line Discipline Active
          </span>
        </div>

        <div className="flex items-center space-x-2">
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
              title="Return to Command Editor"
              className="plate px-1.5 py-0.5 text-xs font-bold"
              style={{ color: 'var(--ink-plate)' }}
            >
              <span>✕</span>
            </button>
          )}
        </div>
      </div>

      {/* CONTINUOUS VT LINE GRID */}
      <div className="flex-1 p-3 overflow-y-auto font-mono text-[13px] leading-snug select-text">
        {lines.map((line) => (
          <div key={line.id} className="whitespace-pre-wrap break-all">
            {line.spans.map((span, spanIdx) => (
              <span
                key={spanIdx}
                style={{
                  color: span.fg,
                  backgroundColor: span.bg,
                  fontWeight: span.bold ? 'bold' : 'normal',
                  fontStyle: span.italic ? 'italic' : 'normal',
                  textDecoration: span.underline ? 'underline' : undefined,
                  opacity: span.dim ? 0.6 : 1,
                }}
              >
                {span.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
