import React from 'react';
import { WorkspaceSet } from '../types/sessionTree';
import { audioEngine } from '../core/audioEngine';

interface SessionTreeProps {
  set: WorkspaceSet;
  onSelectWorkspace: (id: string) => void;
  onCloseWorkspace: (id: string) => void;
  onOpenWorkspace: () => void;
}

/**
 * The open project folders. Sessions belong to the tab strip; listing them
 * here as well was the sidebar's only other job and duplicated it exactly.
 */
export const SessionTree: React.FC<SessionTreeProps> = ({
  set,
  onSelectWorkspace,
  onCloseWorkspace,
  onOpenWorkspace,
}) => (
  <div className="w-60 shrink-0 flex flex-col" style={{ background: 'var(--ground-2)' }}>
    <div
      className="plate bev-up flex items-center justify-between px-2 py-1 text-[11px] font-bold tracking-widest"
      style={{ color: 'var(--ink-plate)' }}
    >
      <span>WORKSPACES</span>
      <button
        onClick={() => {
          audioEngine.playSound('click', 3);
          onOpenWorkspace();
        }}
        title="Open a project folder"
        aria-label="Open a project folder"
        className="plate bev-up px-1.5"
        style={{ color: 'var(--ink-plate)' }}
      >
        +
      </button>
    </div>

    <div className="flex flex-col gap-px p-1 overflow-y-auto">
      {set.workspaces.map((ws) => {
        const isActive = ws.id === set.activeWorkspaceId;
        return (
          <div
            key={ws.id}
            className={`flex items-center gap-2 px-2 py-1 text-[11px] font-mono ${
              isActive ? 'plate bev-up' : ''
            }`}
            style={{ color: isActive ? 'var(--ink-plate)' : 'var(--ink-dim)' }}
          >
            <button
              onClick={() => onSelectWorkspace(ws.id)}
              className="flex-1 text-left truncate"
              style={{ color: 'inherit' }}
              title={ws.rootPath}
            >
              {ws.name}
            </button>
            {/* The last workspace has no close control: there must be
                somewhere left to type. */}
            {set.workspaces.length > 1 && (
              <button
                onClick={() => onCloseWorkspace(ws.id)}
                aria-label={`Close workspace ${ws.name}`}
                style={{ color: 'inherit' }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  </div>
);
