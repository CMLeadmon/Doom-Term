import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TerminalBlock, AnsiLine } from './types/terminal';
import { parseAnsiText } from './core/ansiParser';
import { ptyClient } from './core/ptyClient';
import { audioEngine } from './core/audioEngine';
import { Block } from './components/Block';
import { CommandEditor } from './components/CommandEditor';
import { RawTerminalView } from './components/RawTerminalView';
import { StatusPlate } from './components/StatusPlate';
import { type AppTelemetry } from './hud/state';
import { CrtCompositor } from './components/CrtCompositor';
import { HistoryModal } from './components/HistoryModal';
import { SettingsModal } from './components/SettingsModal';

export const App: React.FC = () => {
  // State: Blocks & Snapshots
  const [blocks, setBlocks] = useState<TerminalBlock[]>([
    {
      id: 'welcome-block',
      command: 'doom-term --version',
      status: 'completed',
      startedAt: Date.now() - 2000,
      completedAt: Date.now() - 1950,
      durationMs: 50,
      exitCode: 0,
      gitBranch: 'main',
      liveLines: parseAnsiText(
        '\x1b[33m⚡ Doom Term v0.1.0 (Phase 1 Baseline)\x1b[0m\n\x1b[32m[+] PTY Multiplexer & Demuxer Initialized (OSC 133 / DECSET 1049)\x1b[0m\n\x1b[36m[+] Calibrated WCAG 2.1 AA Doom Palette Active\x1b[0m\n\x1b[35m[+] 8-Channel Voice Allocation Engine Ready (Web Audio API direct PCM)\x1b[0m\nType any command below or press Tab for suggestions.'
      ),
      snapshot: {
        id: 'welcome-snapshot',
        lines: parseAnsiText(
          '\x1b[33m⚡ Doom Term v0.1.0 (Phase 1 Baseline)\x1b[0m\n\x1b[32m[+] PTY Multiplexer & Demuxer Initialized (OSC 133 / DECSET 1049)\x1b[0m\n\x1b[36m[+] Calibrated WCAG 2.1 AA Doom Palette Active\x1b[0m\n\x1b[35m[+] 8-Channel Voice Allocation Engine Ready (Web Audio API direct PCM)\x1b[0m\nType any command below or press Tab for suggestions.'
        ),
        exitCode: 0,
        durationMs: 50,
        completedAt: Date.now() - 1950,
        totalLines: 5,
      },
    },
  ]);

  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [isTuiActive, setIsTuiActive] = useState<boolean>(false);
  const [tuiLines, setTuiLines] = useState<AnsiLine[]>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([
    'doom-term --version',
    'cargo check',
    'git status',
  ]);

  // Telemetry state for StatusPlate
  const [telemetry, setTelemetry] = useState<AppTelemetry>({
    contextUsed: 0.61,
    rateUsed: 0.22,
    isolation: 'sandbox',
    agent: 'claude',
    agentName: 'CLAUDE CODE',
    model: 'OPUS-4-6',
    cwd: '~/Projects/Doom Term',
    branch: 'main',
    credentials: [true, true, false],
    tokens: { in: 14200, out: 3800, cache: 8100, limit: [128000, 32000, 64000, 200000] },
  });

  // Viewport Scroll Lock & Auto-Follow State
  const [scrollDetached, setScrollDetached] = useState<boolean>(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Modals & Graphics
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [, setIsMuted] = useState(audioEngine.isMuted());
  const [crtEnabled, setCrtEnabled] = useState(true);
  const [scanlineIntensity, setScanlineIntensity] = useState(0.25);
  const [paletteFlash, setPaletteFlash] = useState<'none' | 'red' | 'gold' | 'green'>('none');

  // Trigger temporary palette flash
  const triggerFlash = useCallback((type: 'red' | 'gold' | 'green') => {
    setPaletteFlash(type);
    setTimeout(() => setPaletteFlash('none'), 350);
  }, []);

  // Subscribe to PTY Client Events
  useEffect(() => {
    const unbindPty = ptyClient.registerHandler({
      onOutput: (rawChunk) => {
        const parsed = parseAnsiText(rawChunk);

        if (isTuiActive) {
          setTuiLines((prev) => [...prev.slice(-300), ...parsed]);
          return;
        }

        setBlocks((prev) => {
          if (!activeBlockId) {
            // Append to last block if any
            if (prev.length === 0) return prev;
            const last = { ...prev[prev.length - 1] };
            last.liveLines = [...last.liveLines, ...parsed];
            return [...prev.slice(0, -1), last];
          }

          return prev.map((b) => {
            if (b.id === activeBlockId) {
              return {
                ...b,
                liveLines: [...b.liveLines, ...parsed],
              };
            }
            return b;
          });
        });

        // Nominal token ammo tracking
      },

      onExecutionStart: () => {},

      onExecutionEnd: (exitCode) => {
        const hasError = exitCode !== null && exitCode !== 0;

        if (hasError) {
          audioEngine.playSound('oof', 1);
          triggerFlash('red');
        } else {
          audioEngine.playSound('pickup', 2);
          triggerFlash('gold');
        }

        // Freeze active block into immutable snapshot
        setBlocks((prev) =>
          prev.map((b) => {
            if (b.id === activeBlockId || b.status === 'running') {
              const duration = Date.now() - b.startedAt;
              return {
                ...b,
                status: hasError ? 'error' : 'completed',
                completedAt: Date.now(),
                durationMs: duration,
                exitCode: exitCode ?? 0,
                snapshot: {
                  id: `snap-${b.id}`,
                  lines: [...b.liveLines],
                  exitCode: exitCode ?? 0,
                  durationMs: duration,
                  completedAt: Date.now(),
                  totalLines: b.liveLines.length,
                },
              };
            }
            return b;
          })
        );

        setActiveBlockId(null);
      },

      onTuiMode: (active) => {
        setIsTuiActive(active);
        if (active) {
          audioEngine.playSound('door', 2);
        }
      },
    });

    const unbindTele = ptyClient.onTelemetry((data) => {
      setTelemetry((prev) => ({
        ...prev,
        cwd: data.current_dir,
        branch: data.git_branch || 'main',
        isolation: data.sandbox_level >= 100 ? 'sandbox' : data.sandbox_level >= 50 ? 'worktree' : 'host',
      }));
    });

    return () => {
      unbindPty();
      unbindTele();
    };
  }, [activeBlockId, isTuiActive, triggerFlash]);

  // Viewport Auto-Follow Scroll
  useEffect(() => {
    if (!scrollDetached && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [blocks, scrollDetached]);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - (scrollTop + clientHeight) < 40;
    if (isAtBottom && scrollDetached) {
      setScrollDetached(false);
    } else if (!isAtBottom && !scrollDetached) {
      setScrollDetached(true);
    }
  };

  const handleSnapToBottom = () => {
    setScrollDetached(false);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
    audioEngine.playSound('click', 3);
  };

  // Keyboard Shortcuts (Global)
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      // Ctrl+M: Toggle Audio
      if (e.ctrlKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        const next = audioEngine.toggleMute();
        setIsMuted(next);
        return;
      }

      // Space when scroll is detached: Snap back to bottom
      if (e.key === ' ' && scrollDetached && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        handleSnapToBottom();
      }
    };

    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [scrollDetached]);

  const handleExecuteCommand = (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    setCommandHistory((prev) => [...prev.filter((c) => c !== trimmed), trimmed]);

    const newBlockId = `block-${Date.now()}`;
    const newBlock: TerminalBlock = {
      id: newBlockId,
      command: trimmed,
      status: 'running',
      startedAt: Date.now(),
      gitBranch: telemetry.branch || 'main',
      currentDir: telemetry.cwd,
      liveLines: [],
    };

    setBlocks((prev) => [...prev, newBlock]);
    setActiveBlockId(newBlockId);
    setScrollDetached(false);

    // Write to PTY
    ptyClient.submitCommand(trimmed);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-doom-bg text-doom-white font-mono select-none overflow-hidden relative">
      {/* CRT Compositor & Post-Processing */}
      <CrtCompositor
        enabled={crtEnabled}
        scanlineIntensity={scanlineIntensity}
        paletteFlash={paletteFlash}
      />

      {/* TOP HEADER BAR */}
      <header className="h-10 bg-doom-hudDark border-b border-doom-border flex items-center justify-between px-3 shrink-0 select-none z-20">
        <div className="flex items-center space-x-2">
          <span className="text-doom-gold font-bold">▸</span>
          <span className="font-bold text-xs tracking-wider text-doom-gold">
            DOOM TERM
          </span>
          <span className="text-[10px] text-doom-dim bg-[#181818] px-1.5 py-0.5 rounded border border-[#2a2a2a]">
            v0.1.0
          </span>
        </div>

        <div className="flex items-center space-x-3 text-xs text-doom-dim">
          <span className="hidden sm:inline text-[11px]">
            Agent: <strong className="text-doom-white">{telemetry.agentName || 'CLAUDE CODE'}</strong>
          </span>
          <span className="text-[11px]">
            Branch: <strong className="text-doom-white">{telemetry.branch || 'main'}</strong>
          </span>
        </div>
      </header>

      {/* MAIN VIEWPORT */}
      {isTuiActive ? (
        // Mode B: Full-window TUI alternate buffer surface (DECSET 1049)
        <RawTerminalView
          lines={tuiLines}
          onWrite={(data) => ptyClient.write(data)}
          onSendSignal={(sig) => ptyClient.sendSignal(sig)}
          isTuiSession={true}
        />
      ) : (
        // Mode A: Semantic Block-Based Terminal Cards
        <main
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-3 space-y-2 relative"
        >
          {blocks.map((block) => (
            <Block key={block.id} block={block} />
          ))}

          {/* SCROLL DETACHED BADGE & RESUME BUTTON */}
          {scrollDetached && (
            <div className="sticky bottom-3 flex justify-center z-30 pointer-events-none">
              <button
                onClick={handleSnapToBottom}
                className="pointer-events-auto px-3 py-1.5 bg-doom-hud border-2 border-doom-gold text-doom-gold text-xs font-bold flex items-center space-x-1.5 shadow-doom-bevel hover:bg-[#2e2e2e] transition-transform active:scale-95 animate-bounce"
              >
                <span>↓</span>
                <span>SCROLL DETACHED - SPACE TO RESUME</span>
              </button>
            </div>
          )}
        </main>
      )}

      {/* INPUT AREA (Mode A Command Editor) */}
      {!isTuiActive && (
        <CommandEditor
          onExecute={handleExecuteCommand}
          onSendSignal={(sig) => ptyClient.sendSignal(sig)}
          onOpenHistory={() => setIsHistoryOpen(true)}
          history={commandHistory}
          currentDir={telemetry.cwd}
          gitBranch={telemetry.branch || 'main'}
          isRunning={activeBlockId !== null}
        />
      )}

      {/* BOTTOM STATUS PLATE HUD */}
      <StatusPlate telemetry={telemetry} />

      {/* MODALS */}
      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        onSelectCommand={handleExecuteCommand}
        history={commandHistory}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        crtEnabled={crtEnabled}
        onToggleCrt={setCrtEnabled}
        scanlineIntensity={scanlineIntensity}
        onChangeScanlineIntensity={setScanlineIntensity}
        onWadLoaded={(wadName, count) => {
          setBlocks((prev) => [
            ...prev,
            {
              id: `wad-loaded-${Date.now()}`,
              command: `wad --import ${wadName}`,
              status: 'completed',
              startedAt: Date.now(),
              durationMs: 15,
              exitCode: 0,
              liveLines: parseAnsiText(
                `\x1b[32m[+] Loaded WAD '${wadName}' with ${count} lumps.\x1b[0m\n\x1b[33m[+] DMX Sound effects and PLAYPAL 14-palette array active.\x1b[0m`
              ),
            },
          ]);
        }}
      />
    </div>
  );
};
