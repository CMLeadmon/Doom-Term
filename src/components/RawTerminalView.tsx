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
      className="flex-1 flex flex-col bg-[#0d0d0d] overflow-hidden focus:outline-none relative border border-[#2a2a2a]"
    >
      {/* MODE B HEADER BAR */}
      <div className="bg-[#1a140a] border-b border-doom-gold/30 px-3 py-1.5 flex items-center justify-between text-xs font-mono select-none z-10 shrink-0">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-doom-gold animate-ping" />
          <span className="font-bold text-doom-gold flex items-center gap-1">
            <span>[TUI]</span>
            {isTuiSession ? 'INTERACTIVE TUI RUNNING (DECSET 1049)' : 'RAW PASS-THROUGH MODE'}
          </span>
          <span className="text-doom-dim hidden sm:inline">
            - Direct PTY Line Discipline Active
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => onSendSignal('ctrl+c')}
            title="Send SIGINT (Ctrl+C)"
            className="px-2 py-0.5 bg-doom-bloodBg text-doom-blood border border-doom-blood/40 text-[10px] font-bold hover:bg-doom-blood hover:text-black"
          >
            CTRL+C
          </button>

          {onExitRawMode && (
            <button
              onClick={onExitRawMode}
              title="Return to Command Editor"
              className="px-1.5 py-0.5 text-xs text-doom-dim hover:text-doom-white hover:bg-[#2a2a2a]"
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
