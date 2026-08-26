import React, { useState, useEffect, useRef } from 'react';
// TODO(task-7): replaced by Panel.tsx
const Search = (_: { className?: string }) => <span>[?]</span>;
const X = (_: { className?: string }) => <span>✕</span>;
const CornerDownLeft = (_: { className?: string }) => <span>↵</span>;
const Clock = (_: { className?: string }) => <span>[T]</span>;
import { audioEngine } from '../core/audioEngine';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCommand: (cmd: string) => void;
  history: string[];
}

export const HistoryModal: React.FC<HistoryModalProps> = ({
  isOpen,
  onClose,
  onSelectCommand,
  history,
}) => {
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filtered = history
    .filter((cmd) => cmd.toLowerCase().includes(search.toLowerCase()))
    .slice(-30)
    .reverse();

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(filtered.length - 1, prev + 1));
      audioEngine.playSound('click', 3);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      audioEngine.playSound('click', 3);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        audioEngine.playSound('pickup', 2);
        onSelectCommand(filtered[selectedIndex]);
        onClose();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-[#181818] border-2 border-doom-gold rounded-lg shadow-doom-bevel overflow-hidden font-mono"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* HEADER */}
        <div className="bg-[#242424] px-4 py-3 border-b border-[#3c3c3c] flex items-center justify-between">
          <div className="flex items-center space-x-2 text-doom-gold font-bold text-sm">
            <Clock className="w-4 h-4" />
            <span>COMMAND HISTORY SEARCH (CTRL+R)</span>
          </div>
          <button
            onClick={onClose}
            className="text-doom-dim hover:text-doom-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* SEARCH INPUT */}
        <div className="p-3 border-b border-[#2e2e2e] bg-[#121212] flex items-center space-x-2">
          <Search className="w-4 h-4 text-doom-gold shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search recent commands..."
            className="w-full bg-transparent text-doom-white text-sm focus:outline-none placeholder:text-doom-dim"
          />
        </div>

        {/* LIST */}
        <div className="max-h-72 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="text-center py-6 text-doom-dim text-xs">
              No matching commands found.
            </div>
          ) : (
            filtered.map((cmd, idx) => (
              <div
                key={idx}
                onClick={() => {
                  audioEngine.playSound('pickup', 2);
                  onSelectCommand(cmd);
                  onClose();
                }}
                className={`px-3 py-2 rounded text-xs cursor-pointer flex items-center justify-between transition-colors ${
                  idx === selectedIndex
                    ? 'bg-doom-gold text-black font-bold'
                    : 'text-doom-white hover:bg-[#252525]'
                }`}
              >
                <span className="truncate">{cmd}</span>
                {idx === selectedIndex && (
                  <CornerDownLeft className="w-3.5 h-3.5 shrink-0 opacity-80" />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
