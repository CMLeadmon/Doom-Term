import React, { useEffect } from 'react';

const SAFE = { boxShadow: 'var(--bevel-up), inset 0 0 0 2px var(--st-live)', color: '#3a2a04' };
const DANGER = { boxShadow: 'var(--bevel-up), inset 0 0 0 2px #c02a22', color: '#4a0806' };
const PLAIN = { boxShadow: 'var(--bevel-up)', color: 'var(--ink-plate)' };

export const Approval: React.FC<{
  command: string; agent: string; cwd: string;
  isolation: 'FULL' | 'TREE' | 'OFF'; consequence?: string;
  onRunOnce: () => void; onAlways: () => void; onDeny: () => void;
}> = ({ command, agent, cwd, isolation, consequence, onRunOnce, onAlways, onDeny }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onDeny(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDeny]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Run shell command?"
         className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: '#0b0a08e6' }}>
      <div className="plate p-1.5" style={{ width: 'min(34rem, 92vw)' }}>
        <div className="flex justify-between px-1 pb-1 text-[12px] font-bold tracking-widest"
             style={{ color: 'var(--ink-plate)' }}>
          <span>RUN SHELL COMMAND?</span>
          <span style={{ color: isolation === 'OFF' ? '#4a0806' : 'var(--ink-plate)' }}>
            SANDBOX {isolation} {isolation === 'OFF' ? '· YOUR HOST' : ''}
          </span>
        </div>
        <div className="recess px-2 py-1.5">
          <div className="text-[13px] whitespace-pre-wrap select-text" style={{ color: 'var(--ink)' }}>{command}</div>
          <div className="mt-1.5 text-[11px] tracking-wider" style={{ color: 'var(--ink-dim)' }}>
            {agent} · WORKING DIRECTORY {cwd.toUpperCase()}
            {consequence && <><br />{consequence}</>}
          </div>
        </div>
        <div className="plate flex items-center gap-2 px-1.5 py-1 mt-1">
          <button onClick={onRunOnce} className="plate px-3 text-[12px] font-bold tracking-wider" style={DANGER}>RUN ONCE</button>
          <button onClick={onAlways} className="plate px-3 text-[12px] font-bold tracking-wider" style={PLAIN}>ALWAYS ALLOW</button>
          <button onClick={onDeny} autoFocus className="plate px-3 text-[12px] font-bold tracking-wider" style={SAFE}>DENY</button>
          <span className="ml-auto text-[11px] tracking-widest pr-1" style={{ color: '#2e2a24' }}>ESC DENIES</span>
        </div>
      </div>
    </div>
  );
};
