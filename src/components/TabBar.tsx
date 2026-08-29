import React from 'react';
import { SessionTab } from '../types/terminal';
import { audioEngine } from '../core/audioEngine';

interface TabBarProps {
  sessions: SessionTab[];
  activeSessionId: string;
  cwd: string;
  branch: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onCloseSession: (id: string) => void;
  onRenameSession?: (id: string, newTitle: string) => void;
}

/** Session state, one colour each. Never identity — only state. */
function dotColour(session: SessionTab, isActive: boolean): string {
  if (session.agentState === 'running') return 'var(--st-live)';
  if (session.lastExitCode === 0) return 'var(--st-pass)';
  if (typeof session.lastExitCode === 'number') return 'var(--st-fail)';
  return isActive ? 'var(--st-live)' : 'var(--st-idle)';
}

/**
 * The entire top edge of the window. The design system has no header row: the
 * strip carries the tabs on the left and the path and branch on the right, and
 * nothing else.
 */
export const TabBar: React.FC<TabBarProps> = ({
  sessions,
  activeSessionId,
  cwd,
  branch,
  onSelectSession,
  onNewSession,
  onCloseSession,
  onRenameSession,
}) => {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');

  const finishRename = (id: string) => {
    const trimmed = draft.trim();
    if (trimmed && onRenameSession) onRenameSession(id, trimmed);
    setEditingId(null);
  };

  return (
    <div className="plate bev-up flex items-center gap-0 px-1 select-none" role="tablist">
      {sessions.map((session) => {
        const isActive = session.id === activeSessionId;
        const isEditing = editingId === session.id;

        return (
          <button
            key={session.id}
            role="tab"
            aria-selected={isActive}
            // The bevel inverts on the active tab: a physical control tells you
            // which one is down. No highlight, no underline.
            className={`${isActive ? 'bev-dn' : 'plate bev-up'} flex items-center gap-2 h-6 px-3 mr-1
              text-[11px] font-bold tracking-wide font-mono`}
            style={{
              background: isActive ? '#33302b' : undefined,
              color: isActive ? 'var(--st-live)' : '#2a2620',
            }}
            onClick={() => {
              if (session.id !== activeSessionId) {
                audioEngine.playSound('click', 3);
                onSelectSession(session.id);
              }
            }}
            onAuxClick={(e) => {
              // Close is middle-click and Ctrl+W, like every terminal already
              // does. A tiny × on every tab is 2024 chrome.
              if (e.button === 1) {
                e.preventDefault();
                audioEngine.playSound('oof', 2);
                onCloseSession(session.id);
              }
            }}
            onDoubleClick={() => {
              setEditingId(session.id);
              setDraft(session.title);
            }}
          >
            <span
              className="w-1.5 h-1.5 shrink-0"
              style={{
                background: dotColour(session, isActive),
                boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.5)',
              }}
            />
            {isEditing ? (
              <input
                type="text"
                aria-label="Rename session"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => finishRename(session.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') finishRename(session.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-24 px-1 bg-black text-[11px] font-mono"
                style={{ color: 'var(--st-live)', boxShadow: 'var(--bevel-dn)' }}
              />
            ) : (
              <span className="truncate max-w-[14ch]">{session.title}</span>
            )}
          </button>
        );
      })}

      <button
        onClick={() => {
          audioEngine.playSound('door', 2);
          onNewSession();
        }}
        aria-label="New session"
        title="New session (Ctrl+Shift+T)"
        className="plate bev-up h-6 px-2 text-[13px] font-bold leading-none"
        style={{ color: '#3a352d' }}
      >
        +
      </button>

      <span
        className="ml-auto flex gap-4 pr-2 text-[10px] tracking-widest"
        style={{ color: '#2e2a24' }}
      >
        <span>{cwd.toUpperCase()}</span>
        <b style={{ color: '#14120f' }}>{branch.toUpperCase()}</b>
      </span>
    </div>
  );
};
