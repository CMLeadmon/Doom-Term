import React, { useEffect } from 'react';

export interface DiffLine { n: number; sign: ' ' | '+' | '-'; text: string }

const BG: Record<string, string> = { '+': '#101c0c', '-': '#1e0c0a', ' ': 'transparent' };
const FG: Record<string, string> = { '+': '#9fd07f', '-': '#e0938a', ' ': 'var(--ink-dim)' };
const SG: Record<string, string> = { '+': 'var(--st-pass)', '-': 'var(--st-fail)', ' ': '#5b5346' };

export const Diff: React.FC<{
  file: string; lines: DiffLine[]; added: number; removed: number;
  onApply: () => void; onReject: () => void;
}> = ({ file, lines, added, removed, onApply, onReject }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); onApply(); }
      if (e.key === 'Escape') { e.preventDefault(); onReject(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onApply, onReject]);

  return (
    <div className="mt-2">
      <div className="plate flex justify-between px-2 py-0.5 text-[11px] font-bold tracking-wider"
           style={{ color: 'var(--ink-plate)' }}>
        <span>{file.toUpperCase()}</span>
        <span className="flex gap-2 tabular-nums">
          <span style={{ color: '#14380c' }}>+{added}</span>
          <span style={{ color: '#4a0806' }}>−{removed}</span>
        </span>
      </div>
      <div className="recess">
        {lines.map((l, i) => (
          <div key={i} data-sign={l.sign} className="flex text-[13px] tabular-nums"
               style={{ background: BG[l.sign] }}>
            <span data-ln className="w-10 text-right pr-2 select-none shrink-0" style={{ color: '#5b5346' }}>{l.n}</span>
            <span className="w-4 select-none shrink-0" style={{ color: SG[l.sign] }}>{l.sign}</span>
            <span className="flex-1 min-w-0 whitespace-pre overflow-hidden" style={{ color: FG[l.sign] }}>{l.text}</span>
          </div>
        ))}
      </div>
      <div className="plate flex items-center gap-2 px-1.5 py-1 mt-1">
        {/* The gold ring marks the safe default and holds Enter. */}
        <button onClick={onApply} className="plate px-3 text-[12px] font-bold tracking-wider"
                style={{ color: '#3a2a04', boxShadow: 'var(--bevel-up), inset 0 0 0 2px var(--st-live)' }}>
          APPLY PATCH
        </button>
        <button onClick={onReject} className="plate px-3 text-[12px] font-bold tracking-wider"
                style={{ color: '#4a0806', boxShadow: 'var(--bevel-up), inset 0 0 0 2px #c02a22' }}>
          REJECT
        </button>
        <span className="ml-auto text-[11px] tracking-widest pr-1" style={{ color: '#2e2a24' }}>
          ENTER APPLY · ESC REJECT
        </span>
      </div>
    </div>
  );
};
