import React, { useEffect, useRef } from 'react';
import { mountPlate } from '../hud/canvas';
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
export const StatusPlate: React.FC<{ telemetry: AppTelemetry }> = ({ telemetry }) => {
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
    // Letterbox the remainder rather than stretching to fill.
    <div ref={host} className="shrink-0 flex justify-center bg-black">
      <canvas
        ref={canvas}
        aria-label="Status plate: context, usage, agent, path, branch, sandbox tier, credentials, token table"
        data-agent-busy={busy ? 'true' : 'false'}
      />
    </div>
  );
};
