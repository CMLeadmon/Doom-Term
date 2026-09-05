import type { PaneTree } from '../types/sessionTree';
import { paneLabels, paneRects } from '../core/paneTree';
import { useModalKeys } from '../core/modalKeyboard';

interface PaneSelectOverlayProps {
  tree: PaneTree;
  onSelect: (sessionId: string) => void;
  onClose: () => void;
}

/** tmux-style display-panes mode: labels exist only while making a choice. */
export function PaneSelectOverlay({ tree, onSelect, onClose }: PaneSelectOverlayProps) {
  const rects = paneRects(tree);
  const labels = paneLabels(tree);

  // The labels are the point of this mode, so the label keys have to reach it.
  // At `window` in the bubble phase they never did: the terminal underneath
  // kept focus and wrote `a` into the shell instead of selecting pane A.
  useModalKeys((event) => {
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
  });

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
