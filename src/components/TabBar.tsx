import React from 'react';
import { SessionTab } from '../types/terminal';
import { audioEngine } from '../core/audioEngine';

interface TabBarProps {
  sessions: SessionTab[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onCloseSession: (id: string) => void;
  onRenameSession?: (id: string, newTitle: string) => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onCloseSession,
  onRenameSession,
}) => {
  const [editingSessionId, setEditingSessionId] = React.useState<string | null>(null);
  const [editTitle, setEditTitle] = React.useState<string>('');

  const handleSelect = (id: string) => {
    if (id !== activeSessionId) {
      audioEngine.playSound('click', 3);
      onSelectSession(id);
    }
  };

  const handleStartRename = (e: React.MouseEvent, session: SessionTab) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditTitle(session.title || `Terminal`);
  };

  const handleFinishRename = (id: string) => {
    const trimmed = editTitle.trim();
    if (trimmed && onRenameSession) {
      onRenameSession(id, trimmed);
    }
    setEditingSessionId(null);
  };

  const handleNew = () => {
    audioEngine.playSound('door', 2);
    onNewSession();
  };

  const handleClose = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    audioEngine.playSound('oof', 2);
    onCloseSession(id);
  };

  return (
    <div className="flex items-center bg-[#181614] border-b border-[#2e2a24] px-2 py-1 space-x-1.5 overflow-x-auto select-none z-10">
      {/* TABS LIST */}
      <div className="flex items-center space-x-1 flex-1 overflow-x-auto">
        {sessions.map((session, idx) => {
          const isActive = session.id === activeSessionId;
          const isEditing = editingSessionId === session.id;
          const displayNum = idx + 1;
          const displayTitle = session.title || `Terminal ${displayNum}`;
          const shortCwd = session.cwd.split('/').filter(Boolean).pop() || session.cwd || '~';

          return (
            <div
              key={session.id}
              onClick={() => handleSelect(session.id)}
              onDoubleClick={(e) => handleStartRename(e, session)}
              className={`flex items-center space-x-2 px-2.5 py-1 text-xs font-mono transition-all relative cursor-pointer ${
                isActive
                  ? 'plate text-[#ffd700] font-bold'
                  : 'bg-[#1e1c18] text-[#8f8672] hover:bg-[#282520] hover:text-[#c8bb9c]'
              }`}
              style={{
                boxShadow: isActive ? 'var(--bevel-up), inset 0 0 0 1px var(--st-live)' : 'none',
                minWidth: '120px',
                maxWidth: '240px',
              }}
              title={`${displayTitle} (${shortCwd}) - Double-click to rename`}
            >
              {/* Tab Status LED */}
              <span
                className="w-1.5 h-1.5 shrink-0 rounded-full"
                style={{
                  background: isActive
                    ? 'var(--st-live)'
                    : session.isTuiActive
                    ? 'var(--st-pass)'
                    : '#5b5346',
                }}
              />

              {/* Tab Index */}
              <span className="shrink-0 text-[10px] opacity-70">
                {displayNum}:
              </span>

              {/* Tab Title (Inline Editing or Label) */}
              {isEditing ? (
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => handleFinishRename(session.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFinishRename(session.id);
                    if (e.key === 'Escape') setEditingSessionId(null);
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  className="w-full px-1 py-0 text-[11px] bg-black text-[#ffd700] border border-[#ffd700] focus:outline-none"
                />
              ) : (
                <span className="truncate flex-1 text-left text-[11px] tracking-wide">
                  {displayTitle}
                </span>
              )}

              {/* Branch indicator */}
              {session.gitBranch && (
                <span className="hidden sm:inline text-[9px] text-[#8f8672] px-1 bg-[#12110e] rounded">
                  {session.gitBranch}
                </span>
              )}

              {/* Close Button (only if > 1 tab) */}
              {sessions.length > 1 && (
                <span
                  role="button"
                  aria-label="Close terminal tab"
                  onClick={(e) => handleClose(e, session.id)}
                  className="hover:text-[#ff4444] text-[12px] px-1 opacity-60 hover:opacity-100 transition-opacity ml-1"
                >
                  ×
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* NEW TAB BUTTON [+] */}
      <button
        onClick={handleNew}
        title="Open New Terminal Tab (Ctrl+Shift+T)"
        className="plate px-2 py-0.5 text-xs font-bold flex items-center space-x-1 shrink-0 text-[#c8bb9c] hover:text-[#ffd700]"
        style={{ boxShadow: 'var(--bevel-up)' }}
      >
        <span className="text-[13px] leading-none">+</span>
        <span className="hidden md:inline text-[10px] tracking-wider">NEW</span>
      </button>
    </div>
  );
};
