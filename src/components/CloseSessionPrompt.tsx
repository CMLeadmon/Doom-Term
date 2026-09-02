import { useEffect, useState } from 'react';

interface CloseSessionPromptProps {
  title: string;
  durable: boolean;
  onPark: () => void;
  onKill: () => void;
  onCancel: () => void;
}

/** A terse destructive-action gate with the recoverable choice selected. */
export function CloseSessionPrompt({
  title, durable, onPark, onKill, onCancel,
}: CloseSessionPromptProps) {
  const [choice, setChoice] = useState<'park' | 'kill'>('park');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      } else if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'd') {
        event.preventDefault();
        setChoice('park');
      } else if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setChoice('kill');
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (choice === 'park') onPark();
        else onKill();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choice, onPark, onKill, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onCancel}>
      <div className="plate w-[min(32rem,90vw)] p-2 font-mono" onClick={(event) => event.stopPropagation()}>
        <div className="px-1 text-[12px] font-bold tracking-wider" style={{ color: 'var(--ink-plate)' }}>
          SESSION STILL LIVE · {title}
        </div>
        <div className="recess my-2 p-2 text-[11px]" style={{ color: 'var(--ink)' }}>
          PARK keeps running and removes the pane. KILL terminates the process.
          {!durable && <div className="mt-1" style={{ color: 'var(--rail-warn)' }}>PARK SURVIVES ONLY WHILE THIS DAEMON RUNS.</div>}
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] font-bold">
          <button className={choice === 'park' ? 'recess p-2' : 'p-2'} onClick={onPark}>
            D · PARK
          </button>
          <button className={choice === 'kill' ? 'recess p-2' : 'p-2'} onClick={onKill}>
            K · KILL
          </button>
        </div>
        <div className="pt-2 text-center text-[10px]" style={{ color: 'var(--ink-dim)' }}>
          ENTER CONFIRMS · ESC CANCELS
        </div>
      </div>
    </div>
  );
}
