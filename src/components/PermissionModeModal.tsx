import React, { useEffect, useState } from 'react';
import type { Isolation } from '../hud/state';

export type PermissionMode = 'manual' | 'auto' | 'yolo';

export interface PermissionModeModalProps {
  isOpen: boolean;
  currentMode: PermissionMode;
  isolation?: Isolation;
  cwd?: string;
  branch?: string;
  isAudioMuted?: boolean;
  notificationsEnabled?: boolean;
  onToggleAudio?: () => void;
  onToggleNotifications?: () => void;
  onSelectMode: (mode: PermissionMode) => void;
  onCreateWorktreeSession?: (branchName: string) => void;
  onToggleZoom?: () => void;
  onClose: () => void;
}

interface ModeOption {
  id: PermissionMode;
  label: string;
  title: string;
  description: string;
  badge: string;
  badgeColor: string;
}

const MODES: ModeOption[] = [
  {
    id: 'manual',
    label: 'MANUAL',
    title: 'Manual Approvals (Safe Pass-Through)',
    description: 'Direct terminal pass-through. Requires explicit keystrokes in the child process for all agent prompts.',
    badge: 'SAFE',
    badgeColor: 'var(--st-pass)',
  },
  {
    id: 'auto',
    label: 'AUTO',
    title: 'Semi-Autonomous Mode',
    description: 'Displays a 1-click [Approve (↵)] HUD banner when an agent requests permission, without losing terminal focus.',
    badge: 'SEMI',
    badgeColor: 'var(--st-live)',
  },
  {
    id: 'yolo',
    label: 'YOLO',
    title: 'Full Autonomy (YOLO Mode)',
    description: 'Automatically injects approval into agent permission prompts after a 1.5s countdown (Esc to cancel).',
    badge: 'DANGER',
    badgeColor: 'var(--st-fail)',
  },
];

export const PermissionModeModal: React.FC<PermissionModeModalProps> = ({
  isOpen,
  currentMode,
  isolation = 'host',
  cwd,
  branch,
  isAudioMuted = false,
  notificationsEnabled = true,
  onToggleAudio,
  onToggleNotifications,
  onSelectMode,
  onCreateWorktreeSession,
  onToggleZoom,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'mode' | 'worktree' | 'system'>('mode');
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const idx = MODES.findIndex((m) => m.id === currentMode);
    return idx >= 0 ? idx : 0;
  });
  const [newWorktreeBranch, setNewWorktreeBranch] = useState('');

  useEffect(() => {
    if (isOpen) {
      const idx = MODES.findIndex((m) => m.id === currentMode);
      setSelectedIndex(idx >= 0 ? idx : 0);
      setNewWorktreeBranch('');
    }
  }, [isOpen, currentMode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (activeTab === 'mode') {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev < MODES.length - 1 ? prev + 1 : 0));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : MODES.length - 1));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          onSelectMode(MODES[selectedIndex].id);
          onClose();
        }
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, activeTab, selectedIndex, onSelectMode, onClose]);

  if (!isOpen) return null;

  const isolationLabels: Record<Isolation, { label: string; desc: string; color: string }> = {
    sandbox: { label: 'FULL SANDBOX', desc: 'Running inside container / bwrap environment', color: 'var(--st-pass)' },
    worktree: { label: 'GIT WORKTREE', desc: 'Isolated Git worktree repository checkout', color: 'var(--st-live)' },
    host: { label: 'HOST UNCONFINED', desc: 'Direct host execution without sandbox isolation', color: 'var(--st-idle)' },
  };

  const handleCreateWorktree = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorktreeBranch.trim()) return;
    onCreateWorktreeSession?.(newWorktreeBranch.trim());
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.75)' }}
      onClick={onClose}
    >
      <div
        className="plate p-3 flex flex-col font-mono"
        style={{ width: 'min(40rem, 94vw)', boxShadow: 'var(--bevel-up)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-1 pb-2 text-[12px] font-bold tracking-wider" style={{ color: 'var(--ink-plate)' }}>
          <span>ENVIRONMENT &amp; EXECUTION CONTROL</span>
          <span className="text-[10px] opacity-75">ESC TO CLOSE</span>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#4e4e4c] pb-2 mb-2 gap-1 text-[11px] font-bold">
          <button
            type="button"
            onClick={() => setActiveTab('mode')}
            className={`px-3 py-1 plate ${activeTab === 'mode' ? 'bg-[#322f28] text-[#e0a92c]' : 'text-neutral-400'}`}
            style={{ boxShadow: activeTab === 'mode' ? 'var(--bevel-dn)' : 'var(--bevel-up)' }}
          >
            ▸ AUTONOMY MODE
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('worktree')}
            className={`px-3 py-1 plate ${activeTab === 'worktree' ? 'bg-[#322f28] text-[#e0a92c]' : 'text-neutral-400'}`}
            style={{ boxShadow: activeTab === 'worktree' ? 'var(--bevel-dn)' : 'var(--bevel-up)' }}
          >
            ⑂ WORKTREE &amp; ISOLATION
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('system')}
            className={`px-3 py-1 plate ${activeTab === 'system' ? 'bg-[#322f28] text-[#e0a92c]' : 'text-neutral-400'}`}
            style={{ boxShadow: activeTab === 'system' ? 'var(--bevel-dn)' : 'var(--bevel-up)' }}
          >
            ❖ SYSTEM QUICK-TOGGLES
          </button>
        </div>

        {/* Tab Content: Autonomy Mode */}
        {activeTab === 'mode' && (
          <div className="flex flex-col gap-2 my-1">
            {MODES.map((mode, idx) => {
              const isSelected = idx === selectedIndex;
              const isCurrent = mode.id === currentMode;

              return (
                <div
                  key={mode.id}
                  onClick={() => {
                    onSelectMode(mode.id);
                    onClose();
                  }}
                  className={`p-2.5 cursor-pointer flex flex-col gap-1 ${
                    isSelected ? 'plate' : 'recess hover:bg-[#1f1d19]'
                  }`}
                  style={{
                    border: isSelected ? '1px solid var(--st-live)' : '1px solid transparent',
                    boxShadow: isSelected ? 'var(--bevel-up)' : 'var(--bevel-dn)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[12px] font-bold"
                        style={{ color: isSelected ? 'var(--ink-plate)' : 'var(--ink)' }}
                      >
                        {mode.title}
                      </span>
                      {isCurrent && (
                        <span className="text-[9px] px-1.5 py-0.2 font-bold tracking-wider plate text-[#3d3830]">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <span
                      className="text-[10px] font-bold tracking-widest px-1.5 py-0.5 uppercase"
                      style={{ color: mode.badgeColor, background: '#171716' }}
                    >
                      {mode.badge}
                    </span>
                  </div>
                  <div
                    className="text-[11px] leading-4"
                    style={{ color: isSelected ? '#3d3830' : 'var(--ink-dim)' }}
                  >
                    {mode.description}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Tab Content: Worktree & Isolation */}
        {activeTab === 'worktree' && (
          <div className="flex flex-col gap-3 my-1">
            {/* Isolation Badge */}
            <div className="recess p-2.5 flex flex-col gap-1" style={{ boxShadow: 'var(--bevel-dn)' }}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-neutral-400">CURRENT ISOLATION TIER</span>
                <span
                  className="text-[10px] font-bold px-2 py-0.5 tracking-wider uppercase"
                  style={{ color: isolationLabels[isolation].color, background: '#171716' }}
                >
                  {isolationLabels[isolation].label}
                </span>
              </div>
              <div className="text-[11px] text-neutral-300">
                {isolationLabels[isolation].desc}
              </div>
              <div className="text-[10px] text-neutral-400 mt-1 border-t border-[#2f2f2e] pt-1 flex justify-between">
                <span>PATH: <span className="text-[#e8dcbc]">{cwd ?? '~'}</span></span>
                <span>BRANCH: <span className="text-[#e8dcbc]">{branch || 'HEAD'}</span></span>
              </div>
            </div>

            {/* Spawn in New Worktree */}
            {onCreateWorktreeSession && (
              <form onSubmit={handleCreateWorktree} className="plate p-2.5 flex flex-col gap-2" style={{ boxShadow: 'var(--bevel-up)' }}>
                <span className="text-[11px] font-bold text-[#e0a92c]">⑂ SPAWN SESSION IN NEW GIT WORKTREE</span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newWorktreeBranch}
                    onChange={(e) => setNewWorktreeBranch(e.target.value)}
                    placeholder="branch-name (e.g. feat/new-worktree)"
                    className="recess flex-1 px-2 py-1 text-[12px] font-mono text-[#e8dcbc] outline-none"
                    style={{ boxShadow: 'var(--bevel-dn)' }}
                  />
                  <button
                    type="submit"
                    disabled={!newWorktreeBranch.trim()}
                    className="px-3 py-1 text-[11px] font-bold plate hover:bg-[#322f28] disabled:opacity-50"
                    style={{ color: 'var(--st-pass)' }}
                  >
                    CREATE WORKTREE
                  </button>
                </div>
                <span className="text-[10px] text-neutral-500">
                  Creates an isolated Git worktree under .worktrees/&lt;branch&gt; and spawns a new terminal session there.
                </span>
              </form>
            )}
          </div>
        )}

        {/* Tab Content: System Quick-Toggles */}
        {activeTab === 'system' && (
          <div className="flex flex-col gap-2 my-1">
            <div className="recess p-2 flex items-center justify-between" style={{ boxShadow: 'var(--bevel-dn)' }}>
              <div>
                <div className="text-[12px] font-bold text-[#e8dcbc]">AUDIO SOUND FX (BLUE CHIP)</div>
                <div className="text-[10px] text-neutral-400">Doom retro acoustic feedback for turns, alerts, and asks</div>
              </div>
              <button
                type="button"
                onClick={onToggleAudio}
                className="px-3 py-1 text-[11px] font-bold plate hover:bg-[#322f28]"
                style={{ color: isAudioMuted ? 'var(--st-fail)' : 'var(--st-pass)' }}
              >
                {isAudioMuted ? 'MUTED' : 'ACTIVE'}
              </button>
            </div>

            <div className="recess p-2 flex items-center justify-between" style={{ boxShadow: 'var(--bevel-dn)' }}>
              <div>
                <div className="text-[12px] font-bold text-[#e8dcbc]">DESKTOP NOTIFICATIONS (GOLD CHIP)</div>
                <div className="text-[10px] text-neutral-400">Native system notifications for background asks and errors</div>
              </div>
              <button
                type="button"
                onClick={onToggleNotifications}
                className="px-3 py-1 text-[11px] font-bold plate hover:bg-[#322f28]"
                style={{ color: notificationsEnabled ? 'var(--st-pass)' : 'var(--st-fail)' }}
              >
                {notificationsEnabled ? 'ENABLED' : 'DISABLED'}
              </button>
            </div>

            {onToggleZoom && (
              <div className="recess p-2 flex items-center justify-between" style={{ boxShadow: 'var(--bevel-dn)' }}>
                <div>
                  <div className="text-[12px] font-bold text-[#e8dcbc]">FOCUSED PANE ZOOM (CTRL+SHIFT+Z)</div>
                  <div className="text-[10px] text-neutral-400">Maximize the active terminal pane over split sibling panes</div>
                </div>
                <button
                  type="button"
                  onClick={onToggleZoom}
                  className="px-3 py-1 text-[11px] font-bold plate hover:bg-[#322f28] text-[#e0a92c]"
                >
                  TOGGLE ZOOM
                </button>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-between items-center pt-2 text-[11px]" style={{ color: 'var(--ink-dim)' }}>
          <span>{activeTab === 'mode' ? 'USE ↑/↓ TO NAVIGATE · ENTER TO APPLY' : 'CLICK TO TOGGLE OR CONFIGURE'}</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-[11px] font-bold plate hover:bg-[#322f28]"
          >
            DISMISS
          </button>
        </div>
      </div>
    </div>
  );
};
