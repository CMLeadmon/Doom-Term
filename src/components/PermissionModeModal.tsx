import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useModalKeys } from '../core/modalKeyboard';
import { useDialogFocus } from '../hooks/useDialogFocus';
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
  onCreateWorktreeSession?: (branchName: string) => void | Promise<void>;
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
    title: 'Review in Terminal',
    description: 'Answer permission prompts in the agent terminal. The agent controls its own permissions and sandbox.',
    badge: 'MANUAL',
    badgeColor: 'var(--st-pass)',
  },
  {
    id: 'auto',
    label: 'AUTO',
    title: 'Permission Review Banner',
    description: 'Show a banner linking to the waiting agent. Review and answer there; Doom Term sends no approval keystrokes.',
    badge: 'REVIEW',
    badgeColor: 'var(--st-live)',
  },
  {
    id: 'yolo',
    label: 'YOLO',
    title: 'Automatic approval unavailable',
    description: 'Agent hooks do not identify a verifiable prompt or approval response. Sending Enter could approve the wrong action or execute a shell command.',
    badge: 'UNAVAILABLE',
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
  const [creatingWorktree, setCreatingWorktree] = useState(false);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);
  const currentModeRef = useRef<HTMLButtonElement>(null);
  const modeRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const dialogRef = useDialogFocus<HTMLDivElement>(isOpen, currentModeRef);

  useLayoutEffect(() => {
    const idx = MODES.findIndex((m) => m.id === currentMode);
    setSelectedIndex(idx >= 0 ? idx : 0);
    setActiveTab('mode');
    setNewWorktreeBranch('');
    setWorktreeError(null);
  }, [isOpen, currentMode]);

  useEffect(() => {
    if (isOpen) modeRefs.current[selectedIndex]?.focus({ preventScroll: true });
  }, [isOpen, selectedIndex]);

  useModalKeys((event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    // Mode navigation is the radiogroup's, not the modal's. A key aimed at the
    // branch input, a tab button or DISMISS keeps its native behavior — the
    // unsafe version of this applied a permission mode when the user pressed
    // Enter to submit a worktree name.
    const target = event.target;
    const ownedByControl = target instanceof HTMLElement && (
      target.dataset.modalDismiss !== undefined
      || target.tagName === 'INPUT'
      || target.tagName === 'TEXTAREA'
      || (target.tagName === 'BUTTON' && target.getAttribute('role') !== 'radio')
    );
    if (ownedByControl || activeTab !== 'mode') return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((prev) => (prev === 0 ? 1 : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((prev) => (prev === 0 ? 1 : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (MODES[selectedIndex].id === 'yolo') return;
      onSelectMode(MODES[selectedIndex].id);
      onClose();
    }
  }, dialogRef, isOpen);

  if (!isOpen) return null;

  const isolationLabels: Record<Isolation, { label: string; desc: string; color: string }> = {
    sandbox: { label: 'CONTAINER DETECTED', desc: 'The daemon sees a container marker. Child process sandbox permissions are unmeasured.', color: 'var(--st-wait)' },
    worktree: { label: 'GIT WORKTREE', desc: 'Separate checkout sharing Git history. A worktree is not a security sandbox.', color: 'var(--st-live)' },
    host: { label: 'HOST', desc: 'No daemon container marker detected. Child process confinement is unmeasured.', color: 'var(--st-idle)' },
  };

  const handleCreateWorktree = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorktreeBranch.trim() || creatingWorktree) return;
    setCreatingWorktree(true);
    setWorktreeError(null);
    try {
      await onCreateWorktreeSession?.(newWorktreeBranch.trim());
      onClose();
    } catch (error) {
      setWorktreeError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingWorktree(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.75)' }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-mode-title"
        tabIndex={-1}
        className="plate p-3 flex flex-col font-mono"
        style={{ width: 'min(40rem, 94vw)', boxShadow: 'var(--bevel-up)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-1 pb-2 text-[12px] font-bold tracking-wider" style={{ color: 'var(--ink-plate)' }}>
          <span id="permission-mode-title">ENVIRONMENT &amp; EXECUTION CONTROL</span>
          <span className="text-[10px] opacity-75">ESC TO CLOSE</span>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#4e4e4c] pb-2 mb-2 gap-1 text-[11px] font-bold">
          <button
            type="button"
            onClick={() => setActiveTab('mode')}
            className={`dt-focus-ring px-3 py-1 plate ${activeTab === 'mode' ? 'bg-[#322f28] text-[#e0a92c]' : 'text-neutral-400'}`}
            style={{ boxShadow: activeTab === 'mode' ? 'var(--bevel-dn)' : 'var(--bevel-up)' }}
          >
            ▸ AUTONOMY MODE
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('worktree')}
            className={`dt-focus-ring px-3 py-1 plate ${activeTab === 'worktree' ? 'bg-[#322f28] text-[#e0a92c]' : 'text-neutral-400'}`}
            style={{ boxShadow: activeTab === 'worktree' ? 'var(--bevel-dn)' : 'var(--bevel-up)' }}
          >
            ⑂ WORKTREE &amp; ISOLATION
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('system')}
            className={`dt-focus-ring px-3 py-1 plate ${activeTab === 'system' ? 'bg-[#322f28] text-[#e0a92c]' : 'text-neutral-400'}`}
            style={{ boxShadow: activeTab === 'system' ? 'var(--bevel-dn)' : 'var(--bevel-up)' }}
          >
            ❖ SYSTEM QUICK-TOGGLES
          </button>
        </div>

        {/* Tab Content: Autonomy Mode */}
        {activeTab === 'mode' && (
          <div
            role="radiogroup"
            aria-label="Permission execution mode"
            className="flex flex-col gap-2 my-1"
          >
            {MODES.map((mode, idx) => {
              const isSelected = idx === selectedIndex;
              const isCurrent = mode.id === currentMode;

              return (
                <button
                  type="button"
                  role="radio"
                  disabled={mode.id === 'yolo'}
                  aria-checked={isSelected}
                  tabIndex={isSelected ? 0 : -1}
                  ref={(element) => {
                    modeRefs.current[idx] = element;
                    if (isCurrent) currentModeRef.current = element;
                  }}
                  key={mode.id}
                  onFocus={() => setSelectedIndex(idx)}
                  onClick={() => {
                    onSelectMode(mode.id);
                    onClose();
                  }}
                  className={`dt-focus-ring p-2.5 w-full cursor-pointer flex flex-col gap-1 text-left ${
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
                          CURRENT
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
                </button>
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
                    disabled={!newWorktreeBranch.trim() || creatingWorktree}
                    className="px-3 py-1 text-[11px] font-bold plate hover:bg-[#322f28] disabled:opacity-50"
                    style={{ color: 'var(--st-pass)' }}
                  >
                    {creatingWorktree ? 'CREATING…' : 'CREATE WORKTREE'}
                  </button>
                </div>
                <span className="text-[10px] text-neutral-500">
                  Creates a sibling checkout from the current HEAD and opens a terminal there after Git confirms success.
                </span>
                {worktreeError && <p role="alert" className="text-[12px] recess p-2" style={{ color: 'var(--st-fail)' }}>{worktreeError}</p>}
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
        <div className="flex justify-between items-center pt-2 text-[11px]" style={{ color: 'var(--ink-plate)' }}>
          <span className="font-bold tracking-wider">
            {activeTab === 'mode' ? 'USE ↑/↓ TO NAVIGATE · ENTER TO APPLY' : 'CLICK TO TOGGLE OR CONFIGURE'}
          </span>
          <button
            type="button"
            data-modal-dismiss="true"
            onClick={onClose}
            className="dt-focus-ring px-3 py-1 text-[11px] font-bold recess hover:bg-[#1f1d19]"
            style={{ color: 'var(--ink)' }}
          >
            DISMISS
          </button>
        </div>
      </div>
    </div>
  );
};
