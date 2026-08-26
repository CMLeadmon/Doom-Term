import React, { useState, useRef, useEffect } from 'react';
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
        Math.max(34, textareaRef.current.scrollHeight)
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
    <div className="p-2.5 bg-[var(--ground-2)] border-t border-[#2a2824] relative">
      {/* PROMPT LINE & PATH HEADER */}
      <div className="flex items-center justify-between text-xs mb-1 font-mono select-none" style={{ color: 'var(--ink-dim)' }}>
        <div className="flex items-center space-x-2 truncate">
          <span className="font-bold tracking-wider" style={{ color: 'var(--st-live)' }}>
            DOOM
          </span>
          <span className="font-semibold truncate max-w-[240px]" style={{ color: 'var(--ink)' }}>
            {currentDir}
          </span>
          <span className="recess px-1.5 py-0.5 text-[11px] tracking-wider" style={{ color: 'var(--ink-tan)' }}>
            {gitBranch}
          </span>
        </div>

        <div className="flex items-center space-x-2 text-[10px] tracking-wider">
          {suggestionSuffix && (
            <span className="hidden sm:inline" style={{ color: 'var(--st-live)' }}>
              [TAB: {suggestionMatch}]
            </span>
          )}
          <span className="hidden md:inline" style={{ color: 'var(--ink-dim)' }}>
            [SHIFT+ENTER: NEWLINE] [ENTER: RUN]
          </span>
        </div>
      </div>

      {/* INPUT RECESS */}
      <div className="recess flex items-center px-1 py-0.5">
        {/* Doom Prompt Marker */}
        <div className="pl-2 pr-1.5 text-sm font-bold select-none flex items-center" style={{ color: 'var(--st-live)' }}>
          <span>▸</span>
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
            placeholder="Type command or instruction..."
            className="w-full bg-transparent font-mono text-[13px] py-1.5 px-1 focus:outline-none resize-none overflow-y-auto max-h-[140px] leading-snug"
            style={{ color: 'var(--ink)' }}
            autoFocus
          />

          {/* Ghost text suggestion suffix */}
          {suggestionSuffix && value.indexOf('\n') === -1 && (
            <div
              className="absolute left-1 pointer-events-none text-[13px] font-mono select-none"
              style={{ paddingLeft: `${value.length}ch`, color: 'var(--ink-dim)', opacity: 0.6 }}
            >
              {suggestionSuffix}
            </div>
          )}
        </div>

        {/* SUBMIT & ACTION BUTTONS */}
        <div className="flex items-center space-x-1.5 px-1">
          {isRunning && (
            <button
              onClick={() => onSendSignal('ctrl+c')}
              title="Interrupt Process (Ctrl+C)"
              className="plate px-2 py-0.5 text-[11px] font-bold tracking-wider"
              style={{ color: '#4a0806', boxShadow: 'var(--bevel-up), inset 0 0 0 1px #c02a22' }}
            >
              SIGINT
            </button>
          )}

          <button
            onClick={handleSubmit}
            title="Execute Command (Enter)"
            className="plate px-2.5 py-0.5 text-xs font-bold flex items-center justify-center"
            style={{ color: '#3a2a04', boxShadow: 'var(--bevel-up), inset 0 0 0 2px var(--st-live)' }}
          >
            <span>RUN</span>
          </button>
        </div>
      </div>
    </div>
  );
};
