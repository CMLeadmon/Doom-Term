import React, { useState, useRef, useEffect } from 'react';
import { Send, Terminal as TerminalIcon } from 'lucide-react';
import { audioEngine } from '../core/audioEngine';

interface CommandEditorProps {
  onExecute: (cmd: string) => void;
  onSendSignal: (sig: 'ctrl+c' | 'ctrl+d' | 'ctrl+z') => void;
  onOpenHistory: () => void;
  history: string[];
  currentDir?: string;
  gitBranch?: string;
  isRunning?: boolean;
}

const COMMON_SUGGESTIONS = [
  'cargo build --release',
  'cargo test',
  'cargo check',
  'git status',
  'git log --oneline -n 10',
  'git diff',
  'npm run dev',
  'npm test',
  'ls -la',
  'docker ps',
  'pytest',
  'python3',
  'htop',
  'vim',
];

export const CommandEditor: React.FC<CommandEditorProps> = ({
  onExecute,
  onSendSignal,
  onOpenHistory,
  history,
  currentDir = '~',
  gitBranch = 'main',
  isRunning = false,
}) => {
  const [value, setValue] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedDraft, setSavedDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(
        140,
        Math.max(38, textareaRef.current.scrollHeight)
      )}px`;
    }
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+C: Send SIGINT
    if (e.ctrlKey && e.key === 'c') {
      e.preventDefault();
      audioEngine.playSound('oof', 1);
      onSendSignal('ctrl+c');
      return;
    }

    // Ctrl+D: Send EOF
    if (e.ctrlKey && e.key === 'd') {
      e.preventDefault();
      onSendSignal('ctrl+d');
      return;
    }

    // Ctrl+R: Open History
    if (e.ctrlKey && e.key === 'r') {
      e.preventDefault();
      onOpenHistory();
      return;
    }

    // Enter without Shift: Run command
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
      return;
    }

    // Up Arrow: History Navigation
    if (e.key === 'ArrowUp') {
      if (value.includes('\n') && textareaRef.current && textareaRef.current.selectionStart > 0) {
        // Allow normal multi-line cursor navigation
        return;
      }
      if (history.length > 0) {
        e.preventDefault();
        const nextIdx = historyIndex + 1;
        if (nextIdx < history.length) {
          if (historyIndex === -1) {
            setSavedDraft(value);
          }
          setHistoryIndex(nextIdx);
          setValue(history[history.length - 1 - nextIdx]);
          audioEngine.playSound('click', 3);
        }
      }
      return;
    }

    // Down Arrow: History Navigation
    if (e.key === 'ArrowDown') {
      if (value.includes('\n') && textareaRef.current && textareaRef.current.selectionStart < value.length) {
        return;
      }
      if (historyIndex >= 0) {
        e.preventDefault();
        const nextIdx = historyIndex - 1;
        setHistoryIndex(nextIdx);
        if (nextIdx === -1) {
          setValue(savedDraft);
        } else {
          setValue(history[history.length - 1 - nextIdx]);
        }
        audioEngine.playSound('click', 3);
      }
      return;
    }

    // Tab: Auto-complete suggestion
    if (e.key === 'Tab' && value.trim().length > 0) {
      const match = COMMON_SUGGESTIONS.find((s) => s.startsWith(value.trim()));
      if (match) {
        e.preventDefault();
        setValue(match);
        audioEngine.playSound('pickup', 3);
      }
    }
  };

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed && !isRunning) return;

    audioEngine.playSound('shotgun', 2);
    onExecute(value);
    setValue('');
    setHistoryIndex(-1);
    setSavedDraft('');
  };

  // Suggestion hint calculation
  const trimmedVal = value.trim();
  const suggestionMatch =
    trimmedVal.length >= 2
      ? COMMON_SUGGESTIONS.find((s) => s.startsWith(trimmedVal) && s !== trimmedVal)
      : null;
  const suggestionSuffix = suggestionMatch ? suggestionMatch.slice(trimmedVal.length) : null;

  return (
    <div className="p-3 bg-doom-hudDark/90 border-t border-doom-border relative shadow-doom-bevel">
      {/* PROMPT LINE & PATH HEADER */}
      <div className="flex items-center justify-between text-xs text-doom-dim mb-1 font-mono select-none">
        <div className="flex items-center space-x-2 truncate">
          <span className="text-doom-slime font-bold flex items-center gap-1">
            <TerminalIcon className="w-3 h-3 text-doom-slime" />
            DOOM
          </span>
          <span className="text-doom-white font-semibold truncate max-w-[240px]">
            {currentDir}
          </span>
          <span className="text-doom-cyan bg-[#181818] px-1.5 py-0.2 rounded border border-[#333333]">
            ({gitBranch})
          </span>
        </div>

        <div className="flex items-center space-x-2 text-[10px]">
          {suggestionSuffix && (
            <span className="text-doom-gold hidden sm:inline animate-pulse">
              [Tab: {suggestionMatch}]
            </span>
          )}
          <span className="text-doom-dim hidden md:inline">
            [Shift+Enter: newline] [Enter: run]
          </span>
        </div>
      </div>

      {/* INPUT CARD */}
      <div className="relative flex items-center bg-[#151515] border-2 border-[#3c3c3c] focus-within:border-doom-gold rounded shadow-doom-inset transition-colors">
        {/* Doom Prompt Bracket */}
        <div className="pl-3 pr-2 py-2 text-doom-gold font-bold select-none text-sm font-mono flex items-center">
          <span>[&gt;]</span>
        </div>

        {/* Textarea Input */}
        <div className="relative flex-1 flex items-center">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setHistoryIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type terminal command or agent instructions..."
            className="w-full bg-transparent text-doom-white font-mono text-sm py-2 px-1 focus:outline-none resize-none overflow-y-auto max-h-[140px] leading-snug placeholder:text-doom-dim/60"
            autoFocus
          />

          {/* Ghost text suggestion suffix */}
          {suggestionSuffix && value.indexOf('\n') === -1 && (
            <div
              className="absolute left-1 pointer-events-none text-sm font-mono text-doom-gold/40 select-none"
              style={{ paddingLeft: `${value.length}ch` }}
            >
              {suggestionSuffix}
            </div>
          )}
        </div>

        {/* SUBMIT & QUICK BUTTONS */}
        <div className="flex items-center space-x-1.5 px-2">
          {isRunning && (
            <button
              onClick={() => onSendSignal('ctrl+c')}
              title="Interrupt Process (Ctrl+C)"
              className="px-2 py-1 bg-doom-bloodBg text-doom-blood border border-doom-blood/40 rounded text-xs font-bold hover:bg-doom-blood hover:text-black transition-colors"
            >
              SIGINT
            </button>
          )}

          <button
            onClick={handleSubmit}
            title="Execute Command (Enter) - Plays DSSHOTGN"
            className="p-1.5 bg-doom-gold hover:bg-doom-goldBright text-black font-bold rounded flex items-center justify-center transition-transform active:scale-95 shadow-doom-bevel"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
