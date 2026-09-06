import React, { useEffect, useRef } from 'react';
import { mountPlate, waitingRowAtPoint, modeAtPoint } from '../hud/canvas';
import { toPlateState, pulsePhase, type AppTelemetry } from '../hud/state';

/**
 * The plate, and the only animated thing on it.
 *
 * While the agent is working the mark is redrawn on every frame with a fresh
 * phase, so the pulse is rendered by the same code path as the still plate —
 * there is no CSS animation over the top, which would blur the pixel grid the
 * whole design depends on. When the agent halts the loop stops entirely rather
 * than idling at 60fps against an unchanging image.
 */
export interface StatusPlateProps {
  telemetry: AppTelemetry;
  onSelectWaiting?: (sessionId: string) => void;
  onOpenPermissionsModal?: () => void;
}

export const StatusPlate: React.FC<StatusPlateProps> = ({
  telemetry,
  onSelectWaiting,
  onOpenPermissionsModal,
}) => {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // Read inside the frame callback so the loop never restarts on a telemetry
  // change — restarting it would reset the phase and stutter the rhythm.
  const latest = useRef(telemetry);
  latest.current = telemetry;

  // Anything on the plate that moves keeps the loop alive: the focused agent's
  // mark, or a working row's glyph in the waiting well. Gating only on
  // `agentBusy` froze every background row for as long as your own prompt sat
  // idle, which is precisely when those rows are the reason to look at all.
  const busy =
    telemetry.agentBusy === true ||
    (telemetry.waiting ?? []).some((r) => r.status === 'working');

  useEffect(() => {
    let frame = 0;

    const draw = (now: number) => {
      if (!host.current || !canvas.current) return;
      const t = latest.current;
      mountPlate(
        canvas.current,
        // Hand over the clock unconditionally and let toPlateState decide who
        // is entitled to it. The mark and the rows answer different questions,
        // and gating the phase here would force one answer on both.
        toPlateState(t, pulsePhase(now)),
        host.current.clientWidth,
        window.devicePixelRatio || 1,
      );
    };

    // A still plate is one blit. performance.now() keeps the phase on the same
    // clock the rAF callback is handed, so a busy first frame is not offset.
    draw(performance.now());

    if (busy) {
      const tick = (now: number) => {
        draw(now);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }

    const ro = new ResizeObserver(() => draw(performance.now()));
    if (host.current) ro.observe(host.current);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [telemetry, busy]);

  return (
    // Full window width. The plate is the machine's front panel now, not a
    // widget floating on black — and the width is what the waiting column
    // lives in, so letterboxing it away would take the feature with it.
    <div ref={host} className="shrink-0 flex overflow-hidden">
      <canvas
        ref={canvas}
        onClick={(event) => {
          if (!host.current) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const clickX = event.clientX - rect.left;
          const clickY = event.clientY - rect.top;
          const dpr = window.devicePixelRatio || 1;
          const width = host.current.clientWidth;

          if (modeAtPoint(width, dpr, clickX, clickY)) {
            onOpenPermissionsModal?.();
            return;
          }

          if (!onSelectWaiting || telemetry.mode === 'transport') return;
          const row = waitingRowAtPoint(
            width,
            dpr,
            clickX,
            clickY,
            telemetry.waiting ?? [],
          );
          if (row) onSelectWaiting(row.sessionId);
        }}
        aria-label="Status plate: context, usage, agent, path, branch, sessions waiting, execution mode, credentials, token table"
        data-agent-busy={busy ? 'true' : 'false'}
        style={{ cursor: 'pointer' }}
      />
    </div>
  );
};
