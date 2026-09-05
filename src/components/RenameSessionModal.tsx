import React, { useState, useEffect, useRef } from 'react';

export interface RenameSessionModalProps {
  isOpen: boolean;
  initialTitle: string;
  sessionNumber?: number | null;
  onRename: (newTitle: string) => void;
  onClose: () => void;
}

export const RenameSessionModal: React.FC<RenameSessionModalProps> = ({
  isOpen,
  initialTitle,
  sessionNumber,
  onRename,
  onClose,
}) => {
  const [title, setTitle] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTitle(initialTitle);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 20);
    }
  }, [isOpen, initialTitle]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (trimmed) {
      onRename(trimmed);
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.75)' }}
      onClick={onClose}
    >
      <div
        className="plate p-3 flex flex-col font-mono"
        style={{ width: 'min(28rem, 90vw)', boxShadow: 'var(--bevel-up)' }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex justify-between items-center px-1 pb-2 text-[12px] font-bold tracking-wider" style={{ color: 'var(--ink-plate)' }}>
          <span>RENAME SESSION {sessionNumber ? `[${sessionNumber}]` : ''}</span>
          <span className="text-[10px] opacity-75">ESC TO CANCEL</span>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="recess p-2">
            <input
              ref={inputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Session title..."
              className="w-full bg-transparent text-[13px] text-[#d8cbb0] focus:outline-none placeholder-[#8f8672]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 text-[11px] font-bold recess hover:bg-[#1f1d19]"
              style={{ color: 'var(--ink)' }}
            >
              CANCEL
            </button>
            <button
              type="submit"
              className="px-3 py-1 text-[11px] font-bold bev-up"
              style={{ background: 'var(--st-live)', color: 'var(--ground)' }}
            >
              SAVE [ENTER]
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
