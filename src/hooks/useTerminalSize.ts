import { useEffect, useRef } from 'react';
import { gridSize, measureCell, type GridSize } from '../core/cellMetrics';
import { resizeEmulator } from '../core/emulatorRegistry';
import { ptyClient } from '../core/ptyClient';

/**
 * Keep one session's grid matched to the pane that shows it.
 *
 * Until 2026-08-29 nothing called this: sessions were spawned at a hardcoded
 * 120x30 and never resized, so SIGWINCH never fired and every agent CLI wrapped
 * its output and sized its frames for 120 columns whatever the window was
 * actually doing. `resizeEmulators` and `ptyClient.resize` both existed with
 * zero callers.
 *
 * Pass `sessionId: null` for a pane that owns no PTY, such as a scratchpad.
 */
export function useTerminalSize(
  ref: React.RefObject<HTMLElement | null>,
  sessionId: string | null,
): void {
  const last = useRef<GridSize | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !sessionId) return;

    last.current = null;
    let frame = 0;

    const apply = () => {
      frame = 0;
      const next = gridSize(el.clientWidth, el.clientHeight, measureCell(el));
      // A no-op resize is not free: each one is a SIGWINCH, and a running agent
      // answers it by redrawing its whole frame. Only report real changes.
      if (last.current && last.current.cols === next.cols && last.current.rows === next.rows) {
        return;
      }
      last.current = next;
      resizeEmulator(sessionId, next.cols, next.rows);
      ptyClient.resizeSession(sessionId, next.cols, next.rows);
    };

    // A drag emits a resize per frame; coalesce so one gesture is one SIGWINCH.
    const observer = new ResizeObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(apply);
    });
    observer.observe(el);
    apply();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [ref, sessionId]);
}
