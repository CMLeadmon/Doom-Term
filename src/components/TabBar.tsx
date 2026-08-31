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
  /** The strip is the whole top edge, so it is the only place a button can go. */
  onOpenPalette?: () => void;
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
  onOpenPalette,
}) => {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  // The last session is not closable — closing it would leave the app with no
  // pane and nothing to click.
  const canClose = sessions.length > 1;

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
          // A div, not a button: the close control below is a real button, and
          // a button inside a button is invalid.
          <div
            key={session.id}
            role="tab"
            tabIndex={0}
            aria-selected={isActive}
            // The bevel inverts on the active tab: a physical control tells you
            // which one is down. No highlight, no underline.
            className={`${isActive ? 'bev-dn' : 'plate bev-up'} group flex items-center gap-2 h-6 pl-3 pr-1.5 mr-1
              cursor-pointer text-[11px] font-bold tracking-wide font-mono`}
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectSession(session.id);
              }
            }}
            onAuxClick={(e) => {
              // Middle-click still closes, as every terminal does.
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

            {/*
              Closing a session had no on-screen control at all — only
              middle-click and Ctrl+W, neither of which is discoverable. This is
              a bevelled plate control rather than a bare glyph, and it holds
              its slot at all times so the tab never changes width on hover.
            */}
            {canClose && (
              <button
                aria-label={`Close ${session.title}`}
                title="Close session (Ctrl+W)"
                className={`shrink-0 w-4 h-4 leading-none text-[10px] font-bold plate bev-up
                  ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
                style={{ color: '#4a0806' }}
                onClick={(e) => {
                  e.stopPropagation();
                  audioEngine.playSound('oof', 2);
                  onCloseSession(session.id);
                }}
              >
                ✕
              </button>
            )}
          </div>
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
        className="ml-auto flex items-center gap-4 pr-1 text-[10px] tracking-widest"
        style={{ color: '#2e2a24' }}
      >
        <span>{cwd.toUpperCase()}</span>
        <b style={{ color: '#14120f' }}>{branch.toUpperCase()}</b>

        {/*
          The palette holds every action with no other control — layout, the
          sidebar, the workspace picker, the transcript — and until now the only
          way in was a keyboard shortcut you had to already know. One labelled
          plate key, at the end of the strip.
        */}
        {onOpenPalette && (
          <button
            onClick={() => {
              audioEngine.playSound('click', 3);
              onOpenPalette();
            }}
            aria-label="Open command palette"
            title="Command palette (Ctrl+P / Ctrl+K)"
            className="plate bev-up h-5 px-2 text-[10px] font-bold tracking-widest leading-none"
            style={{ color: '#3a352d' }}
          >
            CTRL+P
          </button>
        )}
      </span>
    </div>
  );
};
