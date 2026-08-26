import React, { useEffect, useRef } from 'react';
import { mountPlate } from '../hud/canvas';
import { toPlateState, type AppTelemetry } from '../hud/state';

export const StatusPlate: React.FC<{ telemetry: AppTelemetry }> = ({ telemetry }) => {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const draw = () => {
      if (!host.current || !canvas.current) return;
      mountPlate(canvas.current, toPlateState(telemetry), host.current.clientWidth);
    };
    draw();
    const ro = new ResizeObserver(draw);
    if (host.current) ro.observe(host.current);
    return () => ro.disconnect();
  }, [telemetry]);

  return (
    // Letterbox the remainder rather than stretching to fill.
    <div ref={host} className="shrink-0 flex justify-center bg-black">
      <canvas ref={canvas} aria-label="Status plate: context, usage, agent, path, branch, sandbox tier, credentials, token table" />
    </div>
  );
};
