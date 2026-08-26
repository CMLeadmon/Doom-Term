import React from 'react';
import { STBARState } from '../types/terminal';
import { DoomguyFace } from './DoomguyFace';
import { Volume2, VolumeX, Settings, History, Terminal, Edit3, Shield, Key } from 'lucide-react';
import { audioEngine } from '../core/audioEngine';

interface StatusBarProps {
  state: STBARState;
  inputMode: 'editor' | 'raw';
  onToggleInputMode: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  state,
  inputMode,
  onToggleInputMode,
  onOpenHistory,
  onOpenSettings,
  isMuted,
  onToggleMute,
}) => {
  const formatTokens = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toString();
  };

  const toolNames = ['Shell', 'Editor', 'Web', 'Git', 'AST', 'Tests', 'Agent'];

  return (
    <footer className="h-16 bg-doom-hud border-t-2 border-[#4a4a4a] flex items-center justify-between px-3 select-none shrink-0 shadow-doom-bevel relative z-20">
      {/* AMMO SECTION (Token Budget) */}
      <div className="flex items-center space-x-3">
        <div className="bg-doom-hudDark border border-[#333333] px-3 py-1 rounded flex flex-col items-center min-w-[72px] shadow-doom-inset">
          <span className="text-[10px] uppercase tracking-wider text-doom-dim font-bold">
            AMMO
          </span>
          <span className="text-sm font-bold text-doom-gold tracking-tight">
            {formatTokens(state.ammo)}
          </span>
          <span className="text-[9px] text-[#666666]">
            MAX {formatTokens(state.maxAmmo)}
          </span>
        </div>

        {/* HEALTH SECTION (Test / Build Health) */}
        <div className="bg-doom-hudDark border border-[#333333] px-3 py-1 rounded flex flex-col items-center min-w-[72px] shadow-doom-inset">
          <span className="text-[10px] uppercase tracking-wider text-doom-dim font-bold">
            HEALTH
          </span>
          <span
            className={`text-sm font-bold tracking-tight ${
              state.health >= 80
                ? 'text-doom-slime'
                : state.health >= 50
                ? 'text-doom-gold'
                : 'text-doom-blood'
            }`}
          >
            {state.health}%
          </span>
          <span className="text-[9px] text-[#666666]">PASS RATE</span>
        </div>

        {/* ARMS SECTION (Active Tools 1-7) */}
        <div className="bg-doom-hudDark border border-[#333333] px-2 py-1 rounded hidden md:flex flex-col items-center shadow-doom-inset">
          <span className="text-[10px] uppercase tracking-wider text-doom-dim font-bold mb-0.5">
            ARMS
          </span>
          <div className="grid grid-cols-4 gap-x-1.5 gap-y-0.5 text-[10px] font-bold">
            {state.arms.map((active, idx) => (
              <span
                key={idx}
                title={`Tool ${idx + 1}: ${toolNames[idx] || 'Active'}`}
                className={`transition-colors ${
                  active ? 'text-doom-gold' : 'text-[#444444]'
                }`}
              >
                {idx + 1}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* CENTER: DOOMGUY FACE & LEVEL/BRANCH */}
      <div className="flex items-center space-x-3">
        <DoomguyFace
          faceState={state.faceState}
          health={state.health}
          godMode={state.godMode}
        />

        <div className="flex flex-col">
          <div className="flex items-center space-x-1.5">
            <span className="text-[10px] font-bold text-doom-gold uppercase bg-[#111111] px-1.5 py-0.5 rounded border border-[#333333]">
              {state.level.split(':')[0] || 'E1M1'}
            </span>
            <span className="text-xs font-semibold text-doom-white tracking-wide truncate max-w-[140px] md:max-w-[200px]">
              {state.level.split(':')[1]?.trim() || 'main'}
            </span>
          </div>
          <span className="text-[9px] text-doom-dim mt-0.5">
            {state.godMode ? '⚡ GOD MODE ACTIVE' : 'PHOBOS LAB COMPUTE'}
          </span>
        </div>
      </div>

      {/* RIGHT: ARMOR, KEYS & ACTIONS */}
      <div className="flex items-center space-x-3">
        {/* ARMOR SECTION (Sandbox Tier) */}
        <div className="bg-doom-hudDark border border-[#333333] px-3 py-1 rounded flex flex-col items-center min-w-[72px] shadow-doom-inset">
          <span className="text-[10px] uppercase tracking-wider text-doom-dim font-bold flex items-center gap-1">
            <Shield className="w-2.5 h-2.5 text-doom-cyan" />
            ARMOR
          </span>
          <span
            className={`text-sm font-bold tracking-tight ${
              state.armor === 100
                ? 'text-doom-cyan'
                : state.armor >= 50
                ? 'text-doom-gold'
                : 'text-doom-dim'
            }`}
          >
            {state.armor}%
          </span>
          <span className="text-[9px] text-[#666666]">
            {state.armor === 100 ? 'SANDBOX' : state.armor >= 50 ? 'WORKTREE' : 'HOST'}
          </span>
        </div>

        {/* KEYS SECTION (Auth Credentials) */}
        <div className="bg-doom-hudDark border border-[#333333] px-2 py-1 rounded hidden sm:flex flex-col items-center shadow-doom-inset">
          <span className="text-[10px] uppercase tracking-wider text-doom-dim font-bold mb-0.5 flex items-center gap-0.5">
            <Key className="w-2.5 h-2.5 text-doom-gold" />
            KEYS
          </span>
          <div className="flex space-x-1.5 text-xs font-black">
            <span
              title="Blue Keycard: SSH Authentication"
              className={state.keys.blue ? 'text-[#3b82f6]' : 'text-[#333333]'}
            >
              B
            </span>
            <span
              title="Yellow Keycard: Cloud Credentials (AWS/GCP)"
              className={state.keys.yellow ? 'text-doom-gold' : 'text-[#333333]'}
            >
              Y
            </span>
            <span
              title="Red Keycard: Git / GPG Signing"
              className={state.keys.red ? 'text-doom-blood' : 'text-[#333333]'}
            >
              R
            </span>
          </div>
        </div>

        {/* CONTROLS & MODALS */}
        <div className="flex items-center space-x-1 border-l border-[#3a3a3a] pl-2">
          {/* Dual-mode Input Toggle */}
          <button
            onClick={() => {
              audioEngine.playSound('click', 3);
              onToggleInputMode();
            }}
            title={`Toggle Input Mode (Current: ${
              inputMode === 'editor' ? 'Mode A: Command Editor' : 'Mode B: Raw Terminal'
            })`}
            className={`p-1.5 rounded text-xs flex items-center gap-1 border transition-colors ${
              inputMode === 'editor'
                ? 'bg-[#2a2a2a] text-doom-gold border-doom-gold/40 hover:bg-[#333333]'
                : 'bg-[#1e293b] text-doom-cyan border-doom-cyan/40 hover:bg-[#283548]'
            }`}
          >
            {inputMode === 'editor' ? (
              <>
                <Edit3 className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold hidden lg:inline">EDITOR</span>
              </>
            ) : (
              <>
                <Terminal className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold hidden lg:inline">RAW</span>
              </>
            )}
          </button>

          {/* History Search */}
          <button
            onClick={() => {
              audioEngine.playSound('click', 3);
              onOpenHistory();
            }}
            title="Command History (Ctrl+R)"
            className="p-1.5 text-doom-dim hover:text-doom-white hover:bg-[#2a2a2a] rounded transition-colors"
          >
            <History className="w-3.5 h-3.5" />
          </button>

          {/* Audio Mute Toggle */}
          <button
            onClick={() => {
              onToggleMute();
            }}
            title={`Toggle Audio (${isMuted ? 'Muted' : 'Enabled'}) [Ctrl+M]`}
            className={`p-1.5 rounded transition-colors ${
              isMuted
                ? 'text-doom-blood hover:bg-[#2a2a2a]'
                : 'text-doom-slime hover:bg-[#2a2a2a]'
            }`}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          {/* Settings */}
          <button
            onClick={() => {
              audioEngine.playSound('click', 3);
              onOpenSettings();
            }}
            title="Settings & WAD Loader"
            className="p-1.5 text-doom-dim hover:text-doom-white hover:bg-[#2a2a2a] rounded transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </footer>
  );
};
