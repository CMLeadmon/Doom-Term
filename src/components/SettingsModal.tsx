import React, { useState } from 'react';
// TODO(task-7): replaced by Panel.tsx
const X = (_: { className?: string }) => <span>✕</span>;
const Volume2 = (_: { className?: string }) => <span>[VOL]</span>;
const Monitor = (_: { className?: string }) => <span>[MON]</span>;
const Disc = (_: { className?: string }) => <span>[WAD]</span>;
const Play = (_: { className?: string }) => <span>▶</span>;
import { audioEngine } from '../core/audioEngine';
import { WadParser } from '../core/wadParser';
import { SoundEffectType } from '../types/wad';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  crtEnabled: boolean;
  onToggleCrt: (enabled: boolean) => void;
  scanlineIntensity: number;
  onChangeScanlineIntensity: (val: number) => void;
  onWadLoaded?: (wadName: string, lumpCount: number) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  crtEnabled,
  onToggleCrt,
  scanlineIntensity,
  onChangeScanlineIntensity,
  onWadLoaded,
}) => {
  const [volume, setVolume] = useState(audioEngine.getVolume());
  const [wadStatus, setWadStatus] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    audioEngine.setVolume(val);
  };

  const testSounds: { label: string; type: SoundEffectType }[] = [
    { label: 'Shotgun (DSSHOTGN)', type: 'shotgun' },
    { label: 'Item Pickup (DSPICKUP)', type: 'pickup' },
    { label: 'Damage Grunt (DSOOF)', type: 'oof' },
    { label: 'Door Slide (DSDOROPN)', type: 'door' },
    { label: 'Teleport / God Mode (DSTELEPT)', type: 'teleport' },
  ];

  const handleWadDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processWadFile(files[0]);
    }
  };

  const handleWadSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processWadFile(e.target.files[0]);
    }
  };

  const processWadFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const buffer = event.target?.result as ArrayBuffer;
        const wad = new WadParser(buffer);
        setWadStatus(`Loaded: ${file.name} (${wad.header.num_lumps} lumps, type: ${wad.header.wad_type})`);
        audioEngine.playSound('pickup', 1);

        // Attempt to load sounds if available
        const soundLumps = ['DSSHOTGN', 'DSPICKUP', 'DSOOF', 'DSDOROPN', 'DSTELEPT', 'DSPISTOL'];
        soundLumps.forEach((name) => {
          try {
            const sound = wad.extractDmxSound(name);
            audioEngine.registerDmxSound(sound);
          } catch {
            // Non-critical if missing
          }
        });

        onWadLoaded?.(file.name, wad.header.num_lumps);
      } catch (err) {
        setWadStatus(`Error parsing WAD: ${err instanceof Error ? err.message : String(err)}`);
        audioEngine.playSound('oof', 1);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#181818] border-2 border-[#4a4a4a] rounded-lg shadow-doom-bevel overflow-hidden font-mono"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER */}
        <div className="bg-[#242424] px-4 py-3 border-b border-[#3c3c3c] flex items-center justify-between">
          <span className="text-sm font-bold text-doom-gold tracking-wide">
            DOOM TERM CONFIGURATION
          </span>
          <button
            onClick={onClose}
            className="text-doom-dim hover:text-doom-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-5 text-xs text-doom-white max-h-[80vh] overflow-y-auto">
          {/* AUDIO SETTINGS */}
          <div className="space-y-2 bg-[#121212] p-3 rounded border border-[#2e2e2e]">
            <div className="flex items-center space-x-2 font-bold text-doom-gold">
              <Volume2 className="w-4 h-4" />
              <span>8-CHANNEL AUDIO ENGINE</span>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-doom-dim">Master Volume:</span>
              <span className="text-doom-gold font-bold">{Math.round(volume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={handleVolumeChange}
              className="w-full accent-doom-gold cursor-pointer"
            />

            {/* Test Sound triggers */}
            <div className="pt-2">
              <span className="text-[11px] text-doom-dim block mb-1.5 font-semibold">
                Test DMX Sound Synthesis:
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {testSounds.map((snd) => (
                  <button
                    key={snd.type}
                    onClick={() => audioEngine.playSound(snd.type, 1)}
                    className="px-2 py-1 bg-[#222222] hover:bg-[#2e2e2e] text-doom-white text-[11px] rounded border border-[#3a3a3a] flex items-center justify-between transition-colors"
                  >
                    <span className="truncate">{snd.label}</span>
                    <Play className="w-2.5 h-2.5 text-doom-slime" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* DISPLAY / CRT SHADER */}
          <div className="space-y-2 bg-[#121212] p-3 rounded border border-[#2e2e2e]">
            <div className="flex items-center space-x-2 font-bold text-doom-gold">
              <Monitor className="w-4 h-4" />
              <span>VGA & CRT POST-PROCESSING</span>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-doom-dim">Enable CRT Scanlines & Bloom:</span>
              <input
                type="checkbox"
                checked={crtEnabled}
                onChange={(e) => onToggleCrt(e.target.checked)}
                className="accent-doom-gold cursor-pointer w-4 h-4"
              />
            </div>

            {crtEnabled && (
              <div className="pt-2 space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-doom-dim">Scanline Intensity:</span>
                  <span className="text-doom-gold font-bold">
                    {Math.round(scanlineIntensity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.8"
                  step="0.05"
                  value={scanlineIntensity}
                  onChange={(e) => onChangeScanlineIntensity(parseFloat(e.target.value))}
                  className="w-full accent-doom-gold cursor-pointer"
                />
              </div>
            )}
          </div>

          {/* WAD LOADER */}
          <div className="space-y-2 bg-[#121212] p-3 rounded border border-[#2e2e2e]">
            <div className="flex items-center space-x-2 font-bold text-doom-gold">
              <Disc className="w-4 h-4" />
              <span>CUSTOM WAD FILE IMPORTER</span>
            </div>
            <p className="text-[11px] text-doom-dim leading-normal">
              Drop DOOM.WAD, DOOM2.WAD, or Freedoom WAD here to load original 1993 sprites, sounds, and PLAYPAL color palettes.
            </p>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleWadDrop}
              className="border-2 border-dashed border-[#444444] hover:border-doom-gold p-4 rounded text-center cursor-pointer transition-colors bg-[#181818]"
            >
              <input
                type="file"
                accept=".wad"
                onChange={handleWadSelect}
                className="hidden"
                id="wad-upload"
              />
              <label htmlFor="wad-upload" className="cursor-pointer block">
                <Disc className="w-6 h-6 text-doom-gold mx-auto mb-1 opacity-80" />
                <span className="text-xs font-semibold text-doom-white block">
                  Click or drag .WAD file here
                </span>
                <span className="text-[10px] text-doom-dim">Supports IWAD & PWAD</span>
              </label>
            </div>

            {wadStatus && (
              <div className="p-2 bg-[#1b2218] border border-doom-slime/40 text-doom-slime text-[11px] rounded">
                {wadStatus}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
