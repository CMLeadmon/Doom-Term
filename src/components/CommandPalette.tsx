import React, { useState, useEffect, useMemo, useRef } from 'react';

export interface CommandPaletteAction {
  id: string;
  category: string;
  title: string;
  shortcut?: string;
  /** Invisible metadata and transcript text used by switcher search. */
  searchText?: string;
  /** Read-only context for the highlighted row. */
  preview?: string;
  attention?: boolean;
  run: () => void;
}

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  actions: CommandPaletteAction[];
  onRenameSession?: (nodeId: string, currentTitle: string) => void;
}

const CATEGORIES = ['ALL', 'SESSION', 'LAYOUT', 'TERMINAL', 'PERMISSIONS', 'WORKSPACE', 'SYSTEM'];

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  actions,
  onRenameSession,
}) => {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedCategory('ALL');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [isOpen]);

  const filteredActions = useMemo(() => {
    let list = actions;
    if (selectedCategory !== 'ALL') {
      const catLower = selectedCategory.toLowerCase();
      list = list.filter((a) => a.category.toLowerCase().includes(catLower));
    }
    if (!query.trim()) return list;
    const lower = query.toLowerCase();
    return list.filter(
      (a) =>
        a.title.toLowerCase().includes(lower) ||
        a.category.toLowerCase().includes(lower) ||
        a.searchText?.toLowerCase().includes(lower)
    );
  }, [actions, query, selectedCategory]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredActions]);

  const selectedAction = filteredActions[selectedIndex];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < filteredActions.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : Math.max(0, filteredActions.length - 1)));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedAction) {
          selectedAction.run();
          onClose();
        }
      } else if (e.key === 'F2') {
        e.preventDefault();
        if (selectedAction && selectedAction.id.startsWith('goto-')) {
          const nodeId = selectedAction.id.replace('goto-', '');
          onClose();
          onRenameSession?.(nodeId, selectedAction.title);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredActions, selectedIndex, selectedAction, onClose, onRenameSession]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.82)' }}
      onClick={onClose}
    >
      <div
        className="plate flex flex-col font-mono"
        style={{
          width: 'min(64rem, 96vw)',
          height: 'min(44rem, 86vh)',
          boxShadow: 'var(--bevel-up)',
          background: '#1a1916',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div
          className="flex justify-between items-center px-3 py-2 text-[12px] font-bold tracking-wider plate border-b border-[#2f2f2e]"
          style={{ color: 'var(--ink-plate)' }}
        >
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--st-live)' }}>❖</span>
            <span>COMMAND PALETTE</span>
            <span className="opacity-60 text-[10px] ml-1 tracking-normal font-normal">· SESSION MANAGER</span>
          </div>
          <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--ink-dim)' }}>
            <span>[F2] RENAME</span>
            <span>[ENTER] SELECT</span>
            <span>[ESC] CLOSE</span>
          </div>
        </div>

        {/* Search Input Bar */}
        <div className="p-3 border-b border-[#2f2f2e] bg-[#14120f]">
          <div className="recess p-2 flex items-center gap-2">
            <span style={{ color: 'var(--ink-dim)' }}>▸</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a command or search action..."
              className="w-full bg-transparent text-[14px] text-[#d8cbb0] focus:outline-none placeholder-[#8f8672]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-[10px] px-1 text-[#8f8672] hover:text-[#d8cbb0]"
              >
                ×
              </button>
            )}
          </div>

          {/* Category Filter Chips */}
          <div className="flex items-center gap-1.5 mt-2 overflow-x-auto text-[10px] font-bold">
            <span className="text-[#8f8672] uppercase mr-1">FILTER:</span>
            {CATEGORIES.map((cat) => {
              const active = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2 py-0.5 uppercase tracking-wider ${
                    active ? 'plate text-[#14120f]' : 'recess text-[#a29882] hover:text-[#d8cbb0]'
                  }`}
                  style={{
                    background: active ? 'var(--st-live)' : undefined,
                    boxShadow: active ? 'var(--bevel-up)' : 'var(--bevel-dn)',
                  }}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

        {/* Master-Detail Body */}
        <div className="flex-1 flex min-h-0 min-w-0">
          {/* Left Column: Action / Session List */}
          <div className="w-3/5 border-r border-[#2f2f2e] flex flex-col min-h-0 overflow-y-auto p-1.5 recess">
            {filteredActions.length === 0 ? (
              <div className="p-6 text-center text-[12px]" style={{ color: 'var(--ink-dim)' }}>
                NO MATCHING ACTIONS OR SESSIONS FOUND
              </div>
            ) : (
              filteredActions.map((action, idx) => {
                const isSelected = idx === selectedIndex;

                return (
                  <button
                    key={action.id}
                    onClick={() => {
                      action.run();
                      onClose();
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left text-[12px] mb-0.5 ${
                      isSelected ? 'plate font-bold' : 'hover:bg-[#1f1d19]'
                    }`}
                    style={{
                      color: isSelected ? 'var(--ink-plate)' : 'var(--ink)',
                      boxShadow: isSelected ? 'var(--bevel-up)' : undefined,
                      border: isSelected ? '1px solid var(--st-live)' : '1px solid transparent',
                    }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="text-[9px] font-bold tracking-wider uppercase px-1.5 py-0.5 shrink-0"
                        style={{
                          background: isSelected ? '#171716' : '#221f1a',
                          color: isSelected ? 'var(--st-live)' : 'var(--ink-dim)',
                        }}
                      >
                        {action.category}
                      </span>
                      <span className="truncate">{action.title}</span>
                      {action.attention && (
                        <span className="text-[9px] px-1 py-0.2 font-black tracking-widest bg-[#ef4136] text-white">
                          ASKS
                        </span>
                      )}
                    </div>
                    {action.shortcut && (
                      <span
                        className="text-[10px] tracking-wide uppercase shrink-0 font-bold ml-2 px-1.5 py-0.5 recess"
                        style={{ color: isSelected ? '#3d3830' : 'var(--ink-dim)' }}
                      >
                        {action.shortcut}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Right Column: Detail & Live Preview Pane */}
          <div className="w-2/5 flex flex-col min-h-0 p-3 bg-[#171613]">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#2f2f2e]">
              <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: 'var(--ink-dim)' }}>
                ACTION DETAILS & PREVIEW
              </span>
              {selectedAction?.category && (
                <span className="text-[10px] uppercase font-bold" style={{ color: 'var(--st-live)' }}>
                  {selectedAction.category}
                </span>
              )}
            </div>

            {selectedAction ? (
              <div className="flex-1 flex flex-col min-h-0 gap-3">
                <div>
                  <div className="text-[13px] font-bold leading-5 mb-1" style={{ color: 'var(--ink)' }}>
                    ACTION // {selectedAction.title}
                  </div>
                  {selectedAction.shortcut && (
                    <div className="text-[11px] font-mono text-[#a29882]">
                      Direct Shortcut: <span className="font-bold text-[#e0a92c]">{selectedAction.shortcut}</span>
                    </div>
                  )}
                </div>

                {selectedAction.preview ? (
                  <div className="flex-1 flex flex-col min-h-0">
                    <span className="text-[10px] font-bold text-[#8f8672] uppercase mb-1">
                      SESSION BUFFER / CONTEXT:
                    </span>
                    <pre
                      className="recess flex-1 p-2 overflow-y-auto text-[11px] leading-4 text-[#c8bb9c] whitespace-pre-wrap select-text"
                      aria-label="Session preview"
                    >
                      {selectedAction.preview}
                    </pre>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-[11px] text-[#8f8672] recess p-4 text-center">
                    No additional terminal output context for this system command.
                  </div>
                )}

                {selectedAction.id.startsWith('goto-') && onRenameSession && (
                  <button
                    type="button"
                    onClick={() => {
                      const nodeId = selectedAction.id.replace('goto-', '');
                      onClose();
                      onRenameSession(nodeId, selectedAction.title);
                    }}
                    className="plate py-1.5 px-3 text-[11px] font-bold text-center hover:bg-[#3d3830]"
                    style={{ color: 'var(--ink-plate)' }}
                  >
                    RENAME THIS SESSION [F2]
                  </button>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[12px] text-[#8f8672]">
                SELECT AN ITEM TO PREVIEW
              </div>
            )}
          </div>
        </div>

        {/* Footer info strip */}
        <div className="px-3 py-1.5 flex items-center justify-between text-[10px] plate border-t border-[#2f2f2e]" style={{ color: 'var(--ink-dim)' }}>
          <span>{filteredActions.length} COMMANDS / SESSIONS AVAILABLE</span>
          <span>DOOM TERM · PROTOCOL REFORMATION</span>
        </div>
      </div>
    </div>
  );
};
