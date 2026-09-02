import { useEffect } from 'react';
import type { PaneTree } from '../types/sessionTree';
import { paneLabels, paneRects } from '../core/paneTree';

interface PaneSelectOverlayProps {
  tree: PaneTree;
  onSelect: (sessionId: string) => void;
  onClose: () => void;
}

/** tmux-style display-panes mode: labels exist only while making a choice. */
export function PaneSelectOverlay({ tree, onSelect, onClose }: PaneSelectOverlayProps) {
  const rects = paneRects(tree);
  const labels = paneLabels(tree);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      const hit = Object.entries(labels).find(([, label]) => label === event.key.toLowerCase());
      if (!hit) return;
      event.preventDefault();
      onSelect(hit[0]);
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [labels, onSelect, onClose]);

  return (
    <div className="absolute inset-0 z-30 bg-black/30" aria-label="Select pane">
      {Object.entries(rects).map(([sessionId, rect]) => (
        <button
          key={sessionId}
          onClick={() => { onSelect(sessionId); onClose(); }}
          className="absolute flex items-center justify-center"
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
          }}
        >
          <span className="plate px-3 py-1 text-lg font-bold" style={{ color: 'var(--ink-plate)' }}>
            {labels[sessionId].toUpperCase()}
          </span>
        </button>
      ))}
    </div>
  );
}
