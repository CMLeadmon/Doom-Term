import React, { useEffect, useRef } from 'react';
import { mountPlate, waitingRowAtPoint, modeAtPoint, chipAtPoint } from '../hud/canvas';
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
  onSelectChip?: (chipIndex: number) => void;
}

export const StatusPlate: React.FC<StatusPlateProps> = ({
  telemetry,
  onSelectWaiting,
  onOpenPermissionsModal,
  onSelectChip,
}) => {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // Read inside the frame callback so the loop never restarts on a telemetry
  // change — restarting it would reset the phase and stutter the rhythm.
  const latest = useRef(telemetry);
  latest.current = telemetry;

  const busy = telemetry.agentBusy === true;

  useEffect(() => {
    let frame = 0;

    const draw = (now: number) => {
      if (!host.current || !canvas.current) return;
      const t = latest.current;
      mountPlate(
        canvas.current,
        toPlateState(t, t.agentBusy ? pulsePhase(now) : undefined),
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

          // 1. Interactive status chips (KEYS)
          const chip = chipAtPoint(width, dpr, clickX, clickY);
          if (chip !== null) {
            onSelectChip?.(chip);
            return;
          }

          // 2. Mode / Isolation cell
          if (modeAtPoint(width, dpr, clickX, clickY)) {
            onOpenPermissionsModal?.();
            return;
          }

          // 3. Attention waiting queue
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
        onMouseMove={(event) => {
          if (!host.current || !canvas.current) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const clickX = event.clientX - rect.left;
          const clickY = event.clientY - rect.top;
          const dpr = window.devicePixelRatio || 1;
          const width = host.current.clientWidth;

          const chip = chipAtPoint(width, dpr, clickX, clickY);
          if (chip === 0) {
            canvas.current.title = "Blue Chip (Sound FX): Click to Toggle Mute (Ctrl+Shift+M)";
            return;
          }
          if (chip === 1) {
            canvas.current.title = "Gold Chip (Notifications): Click to Toggle Desktop Alerts";
            return;
          }
          if (chip === 2) {
            canvas.current.title = "Red Chip (System Alert): Click to Jump to Failed Sessions / Inspect";
            return;
          }
          if (modeAtPoint(width, dpr, clickX, clickY)) {
            canvas.current.title = "Environment & Execution Mode: Click to Configure Worktree / Autonomy";
            return;
          }
          canvas.current.title = "Doom Term Status Plate: Context, Usage, Agent, Path, Branch, Sessions, Mode, System Chips, Telemetry";
        }}
        aria-label="Status plate: context, usage, agent, path, branch, sessions waiting, execution mode, credentials, token table"
        data-agent-busy={busy ? 'true' : 'false'}
        style={{ cursor: 'pointer' }}
      />
    </div>
  );
};
