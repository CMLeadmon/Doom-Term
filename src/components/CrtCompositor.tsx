import React, { useEffect, useRef } from 'react';

interface CrtCompositorProps {
  enabled?: boolean;
  scanlineIntensity?: number;
  bloomIntensity?: number;
  paletteFlash?: 'none' | 'red' | 'gold' | 'green';
}

export const CrtCompositor: React.FC<CrtCompositorProps> = ({
  enabled = true,
  scanlineIntensity = 0.25,
  bloomIntensity = 0.15,
  paletteFlash = 'none',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!enabled || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const w = (canvas.width = window.innerWidth);
      const h = (canvas.height = window.innerHeight);

      ctx.clearRect(0, 0, w, h);

      // 1. Scanlines
      if (scanlineIntensity > 0) {
        ctx.fillStyle = `rgba(0, 0, 0, ${scanlineIntensity * 0.4})`;
        for (let y = 0; y < h; y += 3) {
          ctx.fillRect(0, y, w, 1);
        }
      }

      // 2. Subtle Vignette / CRT Curvature Shadow
      const gradient = ctx.createRadialGradient(w / 2, h / 2, h * 0.4, w / 2, h / 2, h * 0.85);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);

      // 3. Dynamic Palette Flash (Doom Radiation / Damage Flash)
      if (paletteFlash === 'red') {
        ctx.fillStyle = 'rgba(255, 68, 68, 0.18)';
        ctx.fillRect(0, 0, w, h);
      } else if (paletteFlash === 'gold') {
        ctx.fillStyle = 'rgba(212, 155, 0, 0.16)';
        ctx.fillRect(0, 0, w, h);
      } else if (paletteFlash === 'green') {
        ctx.fillStyle = 'rgba(0, 255, 65, 0.14)';
        ctx.fillRect(0, 0, w, h);
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animId);
  }, [enabled, scanlineIntensity, bloomIntensity, paletteFlash]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-50 mix-blend-overlay w-full h-full"
    />
  );
};
