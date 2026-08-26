import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TerminalBlock, InputMode, STBARState, SystemTelemetryData, AnsiLine } from './types/terminal';
import { parseAnsiText } from './core/ansiParser';
import { ptyClient } from './core/ptyClient';
import { audioEngine } from './core/audioEngine';
import { CommandBlock } from './components/CommandBlock';
import { CommandEditor } from './components/CommandEditor';
import { RawTerminalView } from './components/RawTerminalView';
import { StatusBar } from './components/StatusBar';
import { CrtCompositor } from './components/CrtCompositor';
import { HistoryModal } from './components/HistoryModal';
import { SettingsModal } from './components/SettingsModal';
import { ArrowDown, Flame } from 'lucide-react';

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
  const [inputMode, setInputMode] = useState<InputMode>('editor');
  const [isTuiActive, setIsTuiActive] = useState<boolean>(false);
  const [tuiLines, setTuiLines] = useState<AnsiLine[]>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([
    'doom-term --version',
    'cargo check',
    'git status',
  ]);

  // Telemetry & STBAR State
  const [telemetry, setTelemetry] = useState<SystemTelemetryData>({
    username: 'marine',
    hostname: 'phobos-base',
    current_dir: '~/Projects/Doom Term',
    git_branch: 'main',
    sandbox_level: 100,
  });

  const [stbar, setStbar] = useState<STBARState>({
    health: 100,
    ammo: 14200,
    maxAmmo: 128000,
    armor: 100,
    arms: [true, true, true, true, false, false, false],
    keys: { blue: true, yellow: true, red: false },
    level: 'E1M1: main',
    godMode: false,
    faceState: 'alert',
  });

  // Viewport Scroll Lock & Auto-Follow State
  const [scrollDetached, setScrollDetached] = useState<boolean>(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Modals & Graphics
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(audioEngine.isMuted());
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

        // Increment token ammo telemetry
        setStbar((prev) => ({
          ...prev,
          ammo: Math.min(prev.maxAmmo, prev.ammo + Math.round(rawChunk.length / 4)),
        }));
      },

      onExecutionStart: () => {
        setStbar((prev) => ({
          ...prev,
          faceState: 'glance_right',
        }));
      },

      onExecutionEnd: (exitCode) => {
        const hasError = exitCode !== null && exitCode !== 0;

        if (hasError) {
          audioEngine.playSound('oof', 1);
          triggerFlash('red');
          setStbar((prev) => ({
            ...prev,
            health: Math.max(25, prev.health - 25),
            faceState: prev.health <= 50 ? 'bloody' : 'bruised',
          }));
        } else {
          audioEngine.playSound('pickup', 2);
          triggerFlash('gold');
          setStbar((prev) => ({
            ...prev,
            health: Math.min(100, prev.health + 10),
            faceState: 'smile',
          }));
          setTimeout(() => {
            setStbar((prev) => ({ ...prev, faceState: 'alert' }));
          }, 3000);
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
          setInputMode('raw');
        } else {
          setInputMode('editor');
        }
      },
    });

    const unbindTele = ptyClient.onTelemetry((data) => {
      setTelemetry(data);
      setStbar((prev) => ({
        ...prev,
        armor: data.sandbox_level,
        level: `E1M1: ${data.git_branch || 'main'}`,
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
      gitBranch: telemetry.git_branch || 'main',
      currentDir: telemetry.current_dir,
      liveLines: [],
    };

    setBlocks((prev) => [...prev, newBlock]);
    setActiveBlockId(newBlockId);
    setScrollDetached(false);

    // Write to PTY
    ptyClient.submitCommand(trimmed);
  };

  const handleExplainAI = (block: TerminalBlock) => {
    audioEngine.playSound('teleport', 1);
    triggerFlash('gold');
    setStbar((prev) => ({ ...prev, godMode: true, faceState: 'god' }));

    setTimeout(() => {
      const isErr = block.exitCode !== 0;

      const aiText = isErr
        ? `Error analysis: Command '${block.command}' failed with exit code ${block.exitCode}. Key issue appears in runtime logs. Recommended fix: inspect permissions or run build dependencies.`
        : `Execution analysis: Command '${block.command}' completed successfully in ${block.durationMs}ms with exit code 0. Telemetry is nominal.`;

      setBlocks((prev) =>
        prev.map((b) => (b.id === block.id ? { ...b, aiExplanation: aiText } : b))
      );

      setStbar((prev) => ({ ...prev, godMode: false, faceState: 'alert' }));
      audioEngine.playSound('pickup', 2);
    }, 1200);
  };

  const handleTogglePin = (blockId: string) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === blockId ? { ...b, pinned: !b.pinned } : b))
    );
    audioEngine.playSound('click', 3);
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
          <Flame className="w-4 h-4 text-doom-gold animate-bounce" />
          <span className="font-bold text-xs tracking-wider text-doom-gold">
            DOOM TERM
          </span>
          <span className="text-[10px] text-doom-dim bg-[#181818] px-1.5 py-0.5 rounded border border-[#2a2a2a]">
            v0.1.0
          </span>
        </div>

        <div className="flex items-center space-x-3 text-xs text-doom-dim">
          <span className="hidden sm:inline text-[11px]">
            Host: <strong className="text-doom-white">{telemetry.hostname}</strong>
          </span>
          <span className="text-[11px]">
            User: <strong className="text-doom-white">{telemetry.username}</strong>
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
            <CommandBlock
              key={block.id}
              block={block}
              onExplainAI={handleExplainAI}
              onTogglePin={handleTogglePin}
            />
          ))}

          {/* SCROLL DETACHED BADGE & RESUME BUTTON */}
          {scrollDetached && (
            <div className="sticky bottom-3 flex justify-center z-30 pointer-events-none">
              <button
                onClick={handleSnapToBottom}
                className="pointer-events-auto px-3 py-1.5 bg-doom-hud border-2 border-doom-gold text-doom-gold rounded-full text-xs font-bold flex items-center space-x-1.5 shadow-doom-bevel hover:bg-[#2e2e2e] transition-transform active:scale-95 animate-bounce"
              >
                <ArrowDown className="w-3.5 h-3.5" />
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
          currentDir={telemetry.current_dir}
          gitBranch={telemetry.git_branch || 'main'}
          isRunning={activeBlockId !== null}
        />
      )}

      {/* BOTTOM STBAR TELEMETRY HUD */}
      <StatusBar
        state={stbar}
        inputMode={inputMode}
        onToggleInputMode={() => {
          const next = inputMode === 'editor' ? 'raw' : 'editor';
          setInputMode(next);
          if (next === 'raw') setIsTuiActive(true);
        }}
        onOpenHistory={() => setIsHistoryOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        isMuted={isMuted}
        onToggleMute={() => {
          const next = audioEngine.toggleMute();
          setIsMuted(next);
        }}
      />

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
