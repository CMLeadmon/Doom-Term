import React, { useState, useEffect, useMemo } from 'react';

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
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  actions,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredActions = useMemo(() => {
    if (!query.trim()) return actions;
    const lower = query.toLowerCase();
    return actions.filter(
      (a) =>
        a.title.toLowerCase().includes(lower) ||
        a.category.toLowerCase().includes(lower) ||
        a.searchText?.toLowerCase().includes(lower)
    );
  }, [actions, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredActions]);

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
        if (filteredActions[selectedIndex]) {
          filteredActions[selectedIndex].run();
          onClose();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredActions, selectedIndex, onClose]);

  if (!isOpen) return null;

  const selectedAction = filteredActions[selectedIndex];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24"
      style={{ background: 'rgba(0, 0, 0, 0.75)' }}
      onClick={onClose}
    >
      <div
        className="plate p-2 flex flex-col font-mono"
        style={{ width: 'min(40rem, 92vw)', boxShadow: 'var(--bevel-up)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center px-1 pb-1 text-[12px] font-bold tracking-wider" style={{ color: 'var(--ink-plate)' }}>
          <span>COMMAND PALETTE</span>
          <span>ESC TO CLOSE</span>
        </div>

        <div className="recess p-1.5 mb-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search action..."
            autoFocus
            className="w-full bg-transparent text-[13px] text-[#d8cbb0] focus:outline-none placeholder-[#8f8672]"
          />
        </div>

        <div className="recess max-h-80 overflow-y-auto flex flex-col p-1">
          {filteredActions.length === 0 ? (
            <div className="p-3 text-center text-[12px]" style={{ color: 'var(--ink-dim)' }}>
              NO MATCHING COMMANDS FOUND
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
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 text-left text-[12px] ${
                    isSelected ? 'plate font-bold' : 'hover:bg-[#1f1d19]'
                  }`}
                  style={{
                    color: isSelected ? 'var(--ink-plate)' : 'var(--ink)',
                  }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="text-[10px] tracking-wider uppercase w-20 shrink-0 truncate"
                      style={{ color: isSelected ? '#3d3830' : 'var(--ink-dim)' }}
                    >
                      {action.category}
                    </span>
                    <span className="truncate">{action.title}</span>
                    {action.attention && (
                      <span className="text-[9px] font-bold tracking-wider">ASKS</span>
                    )}
                  </div>
                  {action.shortcut && (
                    <span
                      className="text-[10px] uppercase shrink-0 font-bold ml-2"
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

        {selectedAction?.preview && (
          <pre
            className="recess mt-2 max-h-28 overflow-hidden whitespace-pre-wrap px-2 py-1.5 text-[11px] leading-4"
            style={{ color: 'var(--ink-dim)' }}
            aria-label="Session preview"
          >
            {selectedAction.preview}
          </pre>
        )}
      </div>
    </div>
  );
};
