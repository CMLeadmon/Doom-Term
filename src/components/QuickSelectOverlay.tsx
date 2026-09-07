import { useEffect, useState } from 'react';
import type { LabeledQuickTarget } from '../core/quickSelect';

interface QuickSelectOverlayProps {
  targets: LabeledQuickTarget[];
  onSelect: (target: LabeledQuickTarget, insert: boolean) => void;
  onClose: () => void;
}

/** A temporary keyboard surface; it leaves no permanent pane chrome behind. */
export function QuickSelectOverlay({ targets, onSelect, onClose }: QuickSelectOverlayProps) {
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setSelected((current) => (current + delta + targets.length) % Math.max(1, targets.length));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const target = targets[selected];
        if (target) onSelect(target, event.shiftKey);
        return;
      }
      const byLabel = targets.findIndex((target) => target.label === event.key.toLowerCase());
      if (byLabel >= 0) {
        event.preventDefault();
        setSelected(byLabel);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [targets, selected, onSelect, onClose]);

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-end p-3 bg-black/40">
      <div className="plate w-[min(34rem,90%)] p-1.5 font-mono text-[11px]">
        <div className="flex justify-between px-1 pb-1 font-bold tracking-wider" style={{ color: 'var(--ink-plate)' }}>
          <span>QUICK SELECT</span>
          <span>ENTER COPY · SHIFT+ENTER INSERT</span>
        </div>
        <div className="recess max-h-64 overflow-y-auto p-1">
          {targets.length ? targets.map((target, index) => (
            <button
              key={`${target.line}:${target.start}:${target.value}`}
              onClick={() => setSelected(index)}
              className={`grid w-full grid-cols-[3ch_8ch_1fr] gap-2 px-2 py-1 text-left ${index === selected ? 'plate font-bold' : ''}`}
              style={{ color: index === selected ? 'var(--ink-plate)' : 'var(--ink)' }}
            >
              <span>{target.label.toUpperCase()}</span>
              <span className="uppercase opacity-70">{target.type}</span>
              <span className="truncate">{target.value}</span>
            </button>
          )) : (
            <div className="p-2" style={{ color: 'var(--ink-dim)' }}>NO TARGETS</div>
          )}
        </div>
      </div>
    </div>
  );
}
