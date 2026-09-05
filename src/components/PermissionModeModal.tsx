import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useModalKeys } from '../core/modalKeyboard';
import { useDialogFocus } from '../hooks/useDialogFocus';

export type PermissionMode = 'manual' | 'auto' | 'yolo';

export interface PermissionModeModalProps {
  isOpen: boolean;
  currentMode: PermissionMode;
  onSelectMode: (mode: PermissionMode) => void;
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
    title: 'Manual Approvals (Safe)',
    description: 'Requires explicit user confirmation before executing any tool or command.',
    badge: 'SAFE',
    badgeColor: 'var(--st-pass)',
  },
  {
    id: 'auto',
    label: 'AUTO',
    title: 'Semi-Autonomous Mode',
    description: 'Auto-approves read and workspace inspection tools; halts on system mutations.',
    badge: 'SEMI',
    badgeColor: 'var(--st-live)',
  },
  {
    id: 'yolo',
    label: 'YOLO',
    title: 'Force YOLO / Full Autonomy',
    description: 'Bypasses all permission gates (--dangerously-skip-permissions). Executes uninhibited.',
    badge: 'DANGER',
    badgeColor: 'var(--st-fail)',
  },
];

export const PermissionModeModal: React.FC<PermissionModeModalProps> = ({
  isOpen,
  currentMode,
  onSelectMode,
  onClose,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const idx = MODES.findIndex((m) => m.id === currentMode);
    return idx >= 0 ? idx : 0;
  });
  const currentModeRef = useRef<HTMLButtonElement>(null);
  const modeRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const dialogRef = useDialogFocus<HTMLDivElement>(isOpen, currentModeRef);

  useLayoutEffect(() => {
    const idx = MODES.findIndex((m) => m.id === currentMode);
    setSelectedIndex(idx >= 0 ? idx : 0);
  }, [isOpen, currentMode]);

  useEffect(() => {
    if (isOpen) modeRefs.current[selectedIndex]?.focus({ preventScroll: true });
  }, [isOpen, selectedIndex]);

  useModalKeys((event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.dataset.modalDismiss && event.key !== 'Escape') return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((prev) => (prev < MODES.length - 1 ? prev + 1 : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : MODES.length - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onSelectMode(MODES[selectedIndex].id);
      onClose();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }, dialogRef, isOpen);

  if (!isOpen) return null;

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
        style={{ width: 'min(36rem, 92vw)', boxShadow: 'var(--bevel-up)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center px-1 pb-2 text-[12px] font-bold tracking-wider" style={{ color: 'var(--ink-plate)' }}>
          <span id="permission-mode-title">SELECT PERMISSION EXECUTION MODE</span>
          <span className="text-[10px] opacity-75">ESC TO CLOSE</span>
        </div>

        <div
          role="radiogroup"
          aria-labelledby="permission-mode-title"
          className="flex flex-col gap-2 my-2"
        >
          {MODES.map((mode, idx) => {
            const isSelected = idx === selectedIndex;
            const isCurrent = mode.id === currentMode;

            return (
              <button
                type="button"
                role="radio"
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

        <div className="flex justify-between items-center pt-2 text-[11px]" style={{ color: 'var(--ink-dim)' }}>
          <span>USE ↑/↓ TO NAVIGATE · ENTER TO APPLY</span>
          <button
            type="button"
            data-modal-dismiss="true"
            onClick={onClose}
            className="dt-focus-ring px-3 py-1 text-[11px] font-bold plate hover:bg-[#322f28]"
          >
            DISMISS
          </button>
        </div>
      </div>
    </div>
  );
};
