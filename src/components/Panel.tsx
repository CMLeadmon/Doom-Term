import React from 'react';

export interface PanelRow { kind: string; label: string; right?: string; selected?: boolean }

export const Panel: React.FC<{
  title: string; hint: string; rows: PanelRow[]; onPick: (i: number) => void;
}> = ({ title, hint, rows, onPick }) => (
  <div className="plate p-1.5" style={{ width: 'min(36rem, 92vw)' }}>
    <div className="flex justify-between px-1 pb-1 text-[12px] font-bold tracking-widest"
         style={{ color: 'var(--ink-plate)' }}>
      <span>{title}</span><span>{hint}</span>
    </div>
    <div className="recess p-1">
      {rows.map((r, i) => (
        <button key={i} onClick={() => onPick(i)} data-selected={String(!!r.selected)}
                className={`w-full flex gap-3 items-baseline px-2 py-0.5 text-[13px] text-left ${r.selected ? 'plate' : ''}`}
                style={{ color: r.selected ? '#3a2a04' : 'var(--ink)' }}>
          <span className="w-20 shrink-0 tracking-wider"
                style={{ color: r.selected ? '#3d3830' : 'var(--ink-dim)' }}>{r.kind}</span>
          <span className="flex-1 min-w-0 truncate" style={{ fontWeight: r.selected ? 700 : 400 }}>{r.label}</span>
          <span className="shrink-0 text-[11px]"
                style={{ color: r.selected ? '#3d3830' : 'var(--ink-dim)' }}>{r.right}</span>
        </button>
      ))}
    </div>
  </div>
);
