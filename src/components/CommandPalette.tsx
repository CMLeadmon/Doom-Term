import React, { useState, useEffect, useMemo, useRef } from 'react';
import { fuzzyScore } from '../core/fuzzyMatch';
import { useDialogFocus } from '../hooks/useDialogFocus';

export interface CommandPaletteAction {
  id: string;
  category: string;
  title: string;
  /** Unformatted raw entity title (e.g. node.title without slot or agent decorations). */
  rawTitle?: string;
  shortcut?: string;
  /** Invisible metadata and transcript text used by switcher search. */
  searchText?: string;
  /** Read-only context for the highlighted row. */
  preview?: string;
  attention?: boolean;
  attentionType?: 'asks' | 'fail' | 'unread';
  run: () => void;
}

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  actions: CommandPaletteAction[];
  onRenameSession?: (nodeId: string, currentTitle: string) => void;
}

const RESULTS_ID = 'command-palette-results';
const optionId = (index: number) => `command-palette-option-${index}`;

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  actions,
  onRenameSession,
}) => {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  /** The row under the cursor, by id. See the derivation below. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogFocus<HTMLDivElement>(isOpen, inputRef);
  const selectedOptionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedCategory('ALL');
      setSelectedId(null);
    }
  }, [isOpen]);

  const categories = useMemo(
    () => ['ALL', ...new Set(actions.map((action) => action.category.toUpperCase()))],
    [actions],
  );

  useEffect(() => {
    if (!categories.includes(selectedCategory)) setSelectedCategory('ALL');
  }, [categories, selectedCategory]);

  const filteredActions = useMemo(() => {
    let list = actions;
    if (selectedCategory !== 'ALL') {
      list = list.filter((action) => action.category.toUpperCase() === selectedCategory);
    }
    const needle = query.trim();
    if (!needle) return list;

    // Subsequence, not substring — see core/fuzzyMatch.ts. The title scores
    // separately from the corpus so that typing a session's name outranks a
    // stray match somewhere in another session's scrollback.
    return list
      .map((action, order) => {
        const title = fuzzyScore(`${action.title} ${action.category}`, needle);
        const corpus = action.searchText ? fuzzyScore(action.searchText, needle) : null;
        if (title === null && corpus === null) return null;
        const score = Math.max(title ?? -Infinity, (corpus ?? -Infinity) - 500);
        return { action, score, order };
      })
      .filter((row): row is { action: CommandPaletteAction; score: number; order: number } =>
        row !== null)
      // Ties keep the incoming order, which is the attention-first ranking.
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .map((row) => row.action);
  }, [actions, query, selectedCategory]);

  /**
   * The row under the cursor, tracked by id rather than by position.
   *
   * `useEffect(() => setSelectedIndex(0), [filteredActions])` reset the cursor
   * whenever that array's IDENTITY changed — and it changed on every App
   * render, because the actions were rebuilt from scratch each time. Live PTY
   * output and the two-second telemetry poll therefore yanked the selection
   * back to the first row while the operator was arrowing down it.
   */
  const selectedIndex = useMemo(() => {
    if (!selectedId) return 0;
    const at = filteredActions.findIndex((action) => action.id === selectedId);
    // The selected row can genuinely disappear — a filter narrowed, a session
    // closed. Falling back to the first row is right THEN, and only then.
    return at === -1 ? 0 : at;
  }, [filteredActions, selectedId]);

  const selectedAction = filteredActions[selectedIndex];
  const resultLabel = `${filteredActions.length} ${filteredActions.length === 1 ? 'RESULT' : 'RESULTS'}`;

  const moveSelection = (delta: number) => {
    if (filteredActions.length === 0) return;
    const next = (selectedIndex + delta + filteredActions.length) % filteredActions.length;
    setSelectedId(filteredActions[next]?.id ?? null);
  };

  // Reset on the things that MEAN a new list: opening, typing, changing
  // category. Not on a fresh array carrying the same rows.
  useEffect(() => {
    setSelectedId(null);
  }, [query, selectedCategory]);

  useEffect(() => {
    selectedOptionRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedAction?.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      const target = e.target;
      if (target instanceof HTMLElement && target.closest('button') && e.key !== 'Escape') return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveSelection(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveSelection(-1);
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
          onRenameSession?.(nodeId, selectedAction.rawTitle ?? selectedAction.title);
        }
      } else if (e.key === 'Home') {
        e.preventDefault();
        setSelectedId(filteredActions[0]?.id ?? null);
      } else if (e.key === 'End') {
        e.preventDefault();
        setSelectedId(filteredActions.at(-1)?.id ?? null);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (query) setQuery('');
        else onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredActions, selectedIndex, selectedAction, onClose, onRenameSession, query]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.82)' }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        tabIndex={-1}
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
            <span id="command-palette-title">COMMAND PALETTE</span>
            <span className="opacity-60 text-[10px] ml-1 tracking-normal font-normal">· SESSION MANAGER</span>
          </div>
          <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--ink-dim)' }}>
            <span>[F2] RENAME</span>
            <span>[ENTER] SELECT</span>
            <button
              type="button"
              aria-label="Close command palette"
              onClick={onClose}
              className="dt-focus-ring text-[10px] font-bold"
            >
              × [ESC] CLOSE
            </button>
          </div>
        </div>

        {/* Search Input Bar */}
        <div className="p-3 border-b border-[#2f2f2e] bg-[#14120f]">
          <div className="recess p-2 flex items-center gap-2">
            <span style={{ color: 'var(--ink-dim)' }}>▸</span>
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label="Search commands and sessions"
              aria-controls={RESULTS_ID}
              aria-expanded="true"
              aria-autocomplete="list"
              aria-activedescendant={selectedAction ? optionId(selectedIndex) : undefined}
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a command or search action..."
              className="dt-focus-ring w-full bg-transparent text-[14px] text-[#d8cbb0] placeholder-[#8f8672]"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery('')}
                className="dt-focus-ring text-[10px] px-1 text-[#8f8672] hover:text-[#d8cbb0]"
              >
                ×
              </button>
            )}
          </div>

          {/* Category Filter Chips */}
          <div className="flex items-center gap-1.5 mt-2 overflow-x-auto text-[10px] font-bold">
            <span className="text-[#8f8672] uppercase mr-1">FILTER:</span>
            {categories.map((cat) => {
              const active = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedCategory(cat)}
                  className={`dt-focus-ring px-2 py-0.5 uppercase tracking-wider ${
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
          <div
            id={RESULTS_ID}
            role="listbox"
            aria-label="Commands and sessions"
            className="w-3/5 border-r border-[#2f2f2e] flex flex-col min-h-0 overflow-y-auto p-1.5 recess"
          >
            {filteredActions.length === 0 ? (
              <div className="p-6 text-center text-[12px]" style={{ color: 'var(--ink-dim)' }}>
                NO MATCHING ACTIONS OR SESSIONS FOUND
              </div>
            ) : (
              filteredActions.map((action, idx) => {
                const isSelected = idx === selectedIndex;

                return (
                  <div
                    key={action.id}
                    id={optionId(idx)}
                    ref={isSelected ? selectedOptionRef : undefined}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={-1}
                    onClick={() => {
                      action.run();
                      onClose();
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    // Opening under a stationary pointer is not a selection.
                    // Real pointer motion may take over from keyboard input.
                    onMouseMove={() => setSelectedId(action.id)}
                    className={`dt-focus-ring w-full flex items-center justify-between px-3 py-2 text-left text-[12px] mb-0.5 cursor-pointer ${
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
                        <span
                          className={`text-[9px] px-1 py-0.2 font-black tracking-widest ${
                            action.attentionType === 'fail'
                              ? 'bg-[#ef4136] text-white'
                              : action.attentionType === 'unread'
                              ? 'bg-[#e0a92c] text-[#14120f]'
                              : 'bg-[#ef4136] text-white'
                          }`}
                        >
                          {action.attentionType === 'fail'
                            ? 'FAIL'
                            : action.attentionType === 'unread'
                            ? 'UNREAD'
                            : 'ASKS'}
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
                  </div>
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
                    className="dt-focus-ring plate py-1.5 px-3 text-[11px] font-bold text-center hover:bg-[#3d3830]"
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
          <span role="status" aria-live="polite">{resultLabel}</span>
          <span>DOOM TERM · PROTOCOL REFORMATION</span>
        </div>
      </div>
    </div>
  );
};
