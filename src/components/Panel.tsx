import React, { useState, useEffect } from 'react';

export interface PanelRow { kind: string; label: string; right?: string; selected?: boolean }

export const Panel: React.FC<{
  title: string; hint: string; rows: PanelRow[]; onPick: (i: number) => void;
}> = ({ title, hint, rows, onPick }) => {
  const initialIndex = rows.findIndex((r) => r.selected);
  const [selectedIdx, setSelectedIdx] = useState(initialIndex >= 0 ? initialIndex : 0);

  useEffect(() => {
    const idx = rows.findIndex((r) => r.selected);
    if (idx >= 0) setSelectedIdx(idx);
  }, [rows]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((prev) => (prev > 0 ? prev - 1 : Math.max(0, rows.length - 1)));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((prev) => (prev < rows.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows.length > 0 && selectedIdx >= 0 && selectedIdx < rows.length) {
        onPick(selectedIdx);
      }
    }
  };

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="plate p-1.5 focus:outline-none"
      style={{ width: 'min(36rem, 92vw)' }}
    >
      <div className="flex justify-between px-1 pb-1 text-[12px] font-bold tracking-widest"
           style={{ color: 'var(--ink-plate)' }}>
        <span>{title}</span><span>{hint}</span>
      </div>
      <div className="recess p-1">
        {rows.map((r, i) => {
          const isSelected = i === selectedIdx;
          return (
            <button
              key={i}
              onClick={() => onPick(i)}
              data-selected={String(isSelected)}
              className={`w-full flex gap-3 items-baseline px-2 py-0.5 text-[13px] text-left ${isSelected ? 'plate' : ''}`}
              style={{ color: isSelected ? '#3a2a04' : 'var(--ink)' }}
            >
              <span className="w-20 shrink-0 tracking-wider"
                    style={{ color: isSelected ? '#3d3830' : 'var(--ink-dim)' }}>{r.kind}</span>
              <span className="flex-1 min-w-0 truncate" style={{ fontWeight: isSelected ? 700 : 400 }}>{r.label}</span>
              <span className="shrink-0 text-[11px]"
                    style={{ color: isSelected ? '#3d3830' : 'var(--ink-dim)' }}>{r.right}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
