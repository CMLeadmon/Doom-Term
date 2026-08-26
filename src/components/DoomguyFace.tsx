import React, { useEffect, useState } from 'react';
import { audioEngine } from '../core/audioEngine';

interface DoomguyFaceProps {
  faceState?: 'alert' | 'smile' | 'glance_left' | 'glance_right' | 'neutral' | 'bruised' | 'bloody' | 'god' | 'ouch';
  health?: number;
  godMode?: boolean;
}

export const DoomguyFace: React.FC<DoomguyFaceProps> = ({
  faceState = 'alert',
  health = 100,
  godMode = false,
}) => {
  const [currentLook, setCurrentLook] = useState<'left' | 'center' | 'right'>('center');

  // Subtle wandering eye glance animation when idle/alert
  useEffect(() => {
    if (godMode || faceState === 'ouch' || faceState === 'bloody') return;

    const interval = setInterval(() => {
      const rand = Math.random();
      if (rand < 0.3) {
        setCurrentLook('left');
      } else if (rand < 0.6) {
        setCurrentLook('right');
      } else {
        setCurrentLook('center');
      }
    }, 2800);

    return () => clearInterval(interval);
  }, [faceState, godMode]);

  const handleClick = () => {
    if (godMode) {
      audioEngine.playSound('teleport', 1);
    } else if (health < 50) {
      audioEngine.playSound('oof', 1);
    } else {
      audioEngine.playSound('click', 3);
    }
  };

  // Determine eye offset
  let pupilOffset = 0;
  if (faceState === 'glance_left' || currentLook === 'left') pupilOffset = -1;
  if (faceState === 'glance_right' || currentLook === 'right') pupilOffset = 1;

  // Eye color: Glowing Gold in God Mode, bloodshot red if health low
  const eyePupilColor = godMode ? '#ffd700' : health < 30 ? '#ff4444' : '#111111';
  const eyeScleraColor = godMode ? '#fff3a8' : '#e0e0e0';

  const isBruised = health < 70 || faceState === 'bruised';
  const isBloody = health < 40 || faceState === 'bloody';
  const isOuch = faceState === 'ouch';
  const isSmile = faceState === 'smile' || health === 100;

  return (
    <div
      onClick={handleClick}
      className={`relative w-12 h-14 bg-[#181818] border-2 border-[#3c3c3c] rounded p-0.5 flex flex-col items-center justify-center cursor-pointer select-none transition-transform active:scale-95 shadow-doom-bevel ${
        godMode ? 'ring-2 ring-doom-gold shadow-doom-glow' : ''
      }`}
      title={`Doomguy Status: ${godMode ? 'GOD MODE (AI Stream)' : `Health: ${health}%`}`}
    >
      <svg
        viewBox="0 0 24 28"
        className="w-full h-full filter drop-shadow"
        style={{ imageRendering: 'pixelated' }}
      >
        {/* Helmet / Hair */}
        <rect x="5" y="1" width="14" height="4" fill="#6d4c41" />
        <rect x="4" y="3" width="16" height="3" fill="#5d4037" />
        <rect x="3" y="5" width="3" height="6" fill="#4e342e" />
        <rect x="18" y="5" width="3" height="6" fill="#4e342e" />

        {/* Face Base */}
        <rect x="5" y="5" width="14" height="16" fill={isBloody ? '#d7a898' : '#eec590'} />

        {/* Bruises & Blood */}
        {isBruised && (
          <>
            <rect x="6" y="7" width="3" height="3" fill="#8d4b68" opacity="0.75" />
            <rect x="15" y="13" width="3" height="2" fill="#7a344a" opacity="0.8" />
          </>
        )}
        {isBloody && (
          <>
            <rect x="8" y="6" width="2" height="4" fill="#ff4444" />
            <rect x="13" y="15" width="4" height="3" fill="#ff4444" />
            <rect x="15" y="18" width="1" height="3" fill="#cc0000" />
            <rect x="6" y="12" width="2" height="2" fill="#ff4444" />
          </>
        )}

        {/* Eyebrows */}
        {isOuch ? (
          <>
            <path d="M6,8 L9,10" stroke="#3e2723" strokeWidth="1.2" />
            <path d="M18,8 L15,10" stroke="#3e2723" strokeWidth="1.2" />
          </>
        ) : isSmile ? (
          <>
            <rect x="6" y="9" width="4" height="1" fill="#3e2723" />
            <rect x="14" y="9" width="4" height="1" fill="#3e2723" />
          </>
        ) : (
          <>
            <rect x="6" y="9" width="4" height="1.5" fill="#3e2723" />
            <rect x="14" y="9" width="4" height="1.5" fill="#3e2723" />
          </>
        )}

        {/* Eyes (Sclera) */}
        <rect x="6" y="10" width="4" height="3" fill={eyeScleraColor} />
        <rect x="14" y="10" width="4" height="3" fill={eyeScleraColor} />

        {/* Eye Pupils */}
        <rect x={7 + pupilOffset} y="11" width="2" height="2" fill={eyePupilColor} />
        <rect x={15 + pupilOffset} y="11" width="2" height="2" fill={eyePupilColor} />

        {/* God Mode Eye Glow Stars */}
        {godMode && (
          <>
            <circle cx="8" cy="12" r="2.5" fill="#ffe066" opacity="0.6" />
            <circle cx="16" cy="12" r="2.5" fill="#ffe066" opacity="0.6" />
          </>
        )}

        {/* Nose */}
        <rect x="11" y="13" width="2" height="3" fill="#c28b5e" />

        {/* Mouth */}
        {isOuch ? (
          <ellipse cx="12" cy="18" rx="3" ry="2.5" fill="#4a1515" />
        ) : isSmile ? (
          <path
            d="M 8,17 Q 12,21 16,17"
            stroke="#4a1515"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />
        ) : isBloody ? (
          <rect x="9" y="18" width="6" height="2" fill="#501b1b" />
        ) : (
          <rect x="9" y="17" width="6" height="1.5" fill="#4a1515" />
        )}

        {/* Jaw / Chin */}
        <rect x="8" y="21" width="8" height="2" fill="#d29b68" />
      </svg>
    </div>
  );
};
