import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { TerminalBlock } from './types/terminal';
import { SessionNode } from './types/sessionTree';
import { getEmulator } from './core/emulatorRegistry';
import { ptyClient } from './core/ptyClient';
import { audioEngine } from './core/audioEngine';
import { analyzeCommandRisk } from './core/securityAnalyzer';
import { TabBar } from './components/TabBar';
import { BlockPane } from './components/BlockPane';
import { RawTerminalView } from './components/RawTerminalView';
import { StatusPlate } from './components/StatusPlate';
import { Approval } from './components/Approval';
import { SessionTree } from './components/SessionTree';
import { SplitPaneGrid } from './components/SplitPaneGrid';
import { SessionModeNotice } from './components/SessionModeNotice';
import { CommandPalette } from './components/CommandPalette';
import { Scratchpad } from './components/Scratchpad';
import { WorkspaceModal } from './components/WorkspaceModal';
import { uniqueId } from './core/ids';
import { isWorking } from './core/activityMonitor';
import { usePtyEvents } from './hooks/usePtyEvents';
import { useWorkspaceSet } from './hooks/useWorkspaceSet';
import { useGlobalKeys } from './hooks/useGlobalKeys';
import { buildPaletteActions } from './core/paletteActions';
import { type AppTelemetry } from './hud/state';

export const App: React.FC = () => {
  const [showTree, setShowTree] = useState<boolean>(true);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState<boolean>(false);

  // Nothing here is claimed until the daemon reports it. contextUsed, rateUsed
  // and tokens stay absent because no agent CLI reports them to the terminal.
  const [telemetry, setTelemetry] = useState<AppTelemetry>({
    isolation: 'host',
    agent: 'shell',
    credentials: [false, false, false],
    pendingApproval: false,
  });

  const {
    workspaceSet,
    workspace,
    setWorkspace,
    activeGroup,
    activeNode,
    handleCreateNode,
    handleRenameNode,
    handleOpenWorkspaceFolder,
    handleSelectWorkspace,
    handleCloseWorkspace,
    handleSelectNode,
    handleSetGroupLayout,
    handleCloseNode,
  } = useWorkspaceSet(telemetry);

  // Pending Approval Modal State
  const [pendingApproval, setPendingApproval] = useState<{
    command: string;
    consequence: string;
    isolation: 'FULL' | 'TREE' | 'OFF';
  } | null>(null);

  // Viewport Scroll Lock & Auto-Follow State
  const [scrollDetached, setScrollDetached] = useState<boolean>(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Where each session was left, so switching back does not dump you at the
  // bottom of somebody else's scrollback.
  const scrollMemory = useRef<Map<string, number>>(new Map());
  const shownSession = useRef<string | null>(null);

  // Modals & Panels
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [, setIsMuted] = useState(audioEngine.isMuted());
  // Sessions where the user chose the block editor back even though an agent
  // still holds the foreground. Cleared when that agent exits.
  const [forcedBlockMode, setForcedBlockMode] = useState<Set<string>>(new Set());

  /**
   * Does the process in this session own the keyboard?
   *
   * Alt-screen alone was the old test, and it is not sufficient: Antigravity,
   * Claude Code and Codex draw their prompt inline and never set DECSET 1049,
   * so they failed it and got the block editor — which buffers a whole line and
   * submits it as a new command, losing characters to the agent's own redraw.
   * The kernel's foreground process is the honest answer, and the daemon
   * already reports it per session.
   */
  const ownsKeyboard = (node: SessionNode): boolean => {
    if (node.isTuiActive) return true;
    return !!node.foregroundAgent && !forcedBlockMode.has(node.id);
  };

  usePtyEvents(setWorkspace, setTelemetry);

  // Bind whichever session is on screen to a daemon session. A restored or
  // default workspace never did this, so its terminal was connected to nothing.
  useEffect(() => {
    if (!activeNode) return;
    if (activeNode.kind === 'scratchpad') return;
    ptyClient.ensureSession(activeNode.id, activeNode.cwd);
  }, [activeNode?.id, activeNode?.kind, activeNode?.cwd]);

  // The foreground process changes without any PTY event, so ask the daemon.
  useEffect(() => {
    const tick = () => ptyClient.requestTelemetry(activeNode?.cwd);
    tick();
    const id = window.setInterval(tick, 2000);
    return () => window.clearInterval(id);
  }, [activeNode?.cwd, activeNode?.id]);

  // The approval gate is local state — the daemon cannot observe it.
  useEffect(() => {
    setTelemetry((prev) => ({ ...prev, pendingApproval: pendingApproval !== null }));
  }, [pendingApproval]);

  // An agent that has exited no longer holds the keyboard, so a session the
  // user had pushed back to the block editor is free to follow the normal rule
  // again the next time one starts.
  useEffect(() => {
    if (!activeNode || activeNode.foregroundAgent) return;
    setForcedBlockMode((prev) => {
      if (!prev.has(activeNode.id)) return prev;
      const next = new Set(prev);
      next.delete(activeNode.id);
      return next;
    });
  }, [activeNode?.id, activeNode?.foregroundAgent]);

  /*
    Is the agent working? The mark pulses on this, so the answer has to be
    observed rather than asserted, and it has to be able to say no.

    `isWorking` asks whether output has been arriving CONTINUOUSLY, not merely
    recently — an agent parked at its prompt still repaints its own footer every
    second or so, and a recency test flagged that as work forever.
    `agentState === 'running'` is only trusted for a block command: a launched
    agent sets it once and never clears it, because it does not exit.
  */
  useEffect(() => {
    const evaluate = () => {
      if (!activeNode) return false;
      const streaming = isWorking(activeNode.id);
      if (ownsKeyboard(activeNode)) return streaming;
      return streaming || activeNode.agentState === 'running';
    };
    const apply = () =>
      setTelemetry((prev) => {
        const next = evaluate();
        return prev.agentBusy === next ? prev : { ...prev, agentBusy: next };
      });

    apply();
    // The stream going quiet is not an event, so it has to be noticed on a
    // timer. Cheap: it only ever flips a boolean that is already correct.
    const id = window.setInterval(apply, 150);
    return () => window.clearInterval(id);
  }, [activeNode?.id, activeNode?.agentState, activeNode?.isTuiActive, activeNode?.foregroundAgent]);

  /*
    Viewport auto-follow, and why this is a layout effect.

    As a passive effect this ran AFTER paint: the browser had already drawn the
    new session's content at the previous session's scroll offset, and the jump
    to the bottom landed a frame later. That one-frame mismatch is the flash you
    see when switching tabs. useLayoutEffect runs before the browser paints, so
    the first frame the user sees is already at the right offset.
  */
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || !activeNode) return;

    const switched = shownSession.current !== activeNode.id;
    if (switched) {
      const remembered = scrollMemory.current.get(activeNode.id);
      shownSession.current = activeNode.id;
      // A session you had scrolled up in comes back where you left it; one you
      // were following comes back at the tail.
      el.scrollTop = remembered ?? el.scrollHeight;
      return;
    }

    if (!scrollDetached) el.scrollTop = el.scrollHeight;
  }, [activeNode?.id, activeNode?.blocks, scrollDetached]);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - (scrollTop + clientHeight) < 40;
    if (activeNode) {
      // Following the tail is not a position worth remembering — it is a mode.
      if (isAtBottom) scrollMemory.current.delete(activeNode.id);
      else scrollMemory.current.set(activeNode.id, scrollTop);
    }
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

  // Execute Command with Security Risk Interception
  const executeFinalCommand = (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed || !activeNode) return;

    const newBlockId = uniqueId('block');
    const newBlock: TerminalBlock = {
      id: newBlockId,
      command: trimmed,
      status: 'running',
      startedAt: Date.now(),
      gitBranch: activeNode.gitBranch,
      currentDir: activeNode.cwd,
      liveLines: [],
      // Where this block's output starts in the session's scrollback.
      outputMark: getEmulator(activeNode.id).mark(),
    };

    setWorkspace((prev) => {
      const currentNode = prev.nodes[activeNode.id];
      if (!currentNode) return prev;

      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [currentNode.id]: {
            ...currentNode,
            activeBlockId: newBlockId,
            agentState: 'running',
            commandHistory: [...currentNode.commandHistory.filter((c) => c !== trimmed), trimmed],
            blocks: [...currentNode.blocks, newBlock],
          },
        },
      };
    });

    setScrollDetached(false);
    ptyClient.submitCommandToSession(activeNode.id, trimmed);
  };

  const handleExecuteCommand = (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    const risk = analyzeCommandRisk(trimmed);
    if (risk.isHighRisk) {
      audioEngine.playSound('oof', 1);
      const iso = telemetry.isolation === 'sandbox' ? 'FULL' : telemetry.isolation === 'worktree' ? 'TREE' : 'OFF';
      setPendingApproval({
        command: trimmed,
        consequence: risk.consequence || 'Potential high-impact filesystem/system modification',
        isolation: iso,
      });
      return;
    }

    executeFinalCommand(trimmed);
  };

  useGlobalKeys({
    onNewTerminal: () => handleCreateNode(activeGroup.id, 'terminal'),
    onCloseSession: () => handleCloseNode(activeGroup.activeNodeId),
    onToggleSidebar: () => setShowTree((prev) => !prev),
    onOpenPalette: () => setIsPaletteOpen(true),
    onToggleAudio: () => setIsMuted(audioEngine.toggleMute()),
    onOpenWorkspace: () => setIsWorkspaceModalOpen(true),
    onSnapToBottom: scrollDetached ? handleSnapToBottom : null,
  });

  // Command Palette Actions
  const paletteActions = buildPaletteActions({
    activeGroup,
    activeNode,
    showTree,
    setShowTree,
    setIsWorkspaceModalOpen,
    onCreateNode: handleCreateNode,
    onRenameNode: handleRenameNode,
    onSetGroupLayout: handleSetGroupLayout,
  });

  // Render individual session pane
  const renderSessionPane = (node: SessionNode, isActive: boolean) => {
    if (node.kind === 'scratchpad') {
      return (
        <Scratchpad
          title={node.title}
          initialContent={node.scratchpadContent}
          onSave={(content) => {
            setWorkspace((prev) => ({
              ...prev,
              nodes: {
                ...prev.nodes,
                [node.id]: { ...node, scratchpadContent: content },
              },
            }));
          }}
        />
      );
    }

    if (ownsKeyboard(node)) {
      return (
        <RawTerminalView
          lines={node.tuiLines}
          sessionId={node.id}
          isActive={isActive}
          isTuiSession={node.isTuiActive}
          agentName={node.foregroundAgent ? (telemetry.agentName ?? node.foregroundAgent.toUpperCase()) : null}
          onWrite={(data: string) => ptyClient.writeToSession(node.id, data)}
          onSendSignal={(sig: 'ctrl+c' | 'ctrl+d' | 'ctrl+z') => ptyClient.sendSignalToSession(node.id, sig)}
          // Leaving pass-through does not kill the process — it hands the pane
          // back to the block editor while the agent keeps running. Only offered
          // for an inline agent; a real alt-screen app would draw over the
          // editor, so there is nothing to go back to.
          onExitRawMode={
            node.isTuiActive
              ? undefined
              : () => {
                  setForcedBlockMode((prev) => new Set(prev).add(node.id));
                }
          }
        />
      );
    }

    return (
      <BlockPane
        node={node}
        isActive={isActive}
        scrollContainerRef={scrollContainerRef}
        scrollDetached={scrollDetached}
        onScroll={handleScroll}
        onSnapToBottom={handleSnapToBottom}
        onExecute={handleExecuteCommand}
        onApplyDiff={(file) => executeFinalCommand(`git apply ${file}`)}
        onOpenHistory={() => setIsPaletteOpen(true)}
      />
    );
  };

  const groupNodes = activeGroup.nodeIds.map((id) => workspace.nodes[id]).filter(Boolean);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden select-none font-mono" style={{ background: 'var(--ground)' }}>
      {/*
        The whole top edge is the tab strip. The design system has no header
        row: the wordmark, the hamburger and the CTRL+P button were chrome for
        things the keyboard already does (Ctrl+B, Ctrl+P).
      */}
      <TabBar
        sessions={groupNodes.map((n) => ({
          id: n.id,
          title: n.title,
          cwd: n.cwd,
          gitBranch: n.gitBranch,
          activeBlockId: n.activeBlockId,
          isTuiActive: n.isTuiActive,
          agentState: n.agentState,
          lastExitCode: n.blocks[n.blocks.length - 1]?.exitCode ?? null,
          blocks: n.blocks,
          tuiLines: n.tuiLines,
          commandHistory: n.commandHistory,
          createdAt: n.createdAt,
        }))}
        activeSessionId={activeGroup.activeNodeId}
        cwd={telemetry.cwd ?? '~'}
        branch={telemetry.branch ?? ''}
        onSelectSession={handleSelectNode}
        onCloseSession={handleCloseNode}
        onNewSession={() => handleCreateNode(activeGroup.id, 'terminal')}
        onRenameSession={handleRenameNode}
        onOpenPalette={() => setIsPaletteOpen(true)}
      />

      <SessionModeNotice sessionId={activeNode?.id ?? null} />

      {/* Sidebar owns folders; the tab strip owns sessions. */}
      <div className="flex-1 flex min-h-0 min-w-0">
        {showTree && (
          <SessionTree
            set={workspaceSet}
            onSelectWorkspace={handleSelectWorkspace}
            onCloseWorkspace={handleCloseWorkspace}
            onOpenWorkspace={() => setIsWorkspaceModalOpen(true)}
          />
        )}

        <div className="flex-1 flex flex-col min-h-0 min-w-0 p-1.5">
          <SplitPaneGrid
            layout={activeGroup.layout}
            nodes={groupNodes}
            activeNodeId={activeGroup.activeNodeId}
            onSelectNode={handleSelectNode}
            renderPane={renderSessionPane}
          />
        </div>
      </div>

      {/* Bottom Doom 1993 Status Plate (STBAR) */}
      <div className="shrink-0">
        <StatusPlate telemetry={telemetry} />
      </div>

      {/* Universal Command Palette Modal */}
      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        actions={paletteActions}
      />

      {/* Workspace Folder Picker Modal */}
      <WorkspaceModal
        isOpen={isWorkspaceModalOpen}
        onClose={() => setIsWorkspaceModalOpen(false)}
        onSelectWorkspace={handleOpenWorkspaceFolder}
      />

      {/* Security Approval Gate Modal */}
      {pendingApproval && (
        <Approval
          command={pendingApproval.command}
          agent="CLAUDE CODE"
          cwd={telemetry.cwd || '~'}
          isolation={pendingApproval.isolation}
          consequence={pendingApproval.consequence}
          onRunOnce={() => {
            const cmd = pendingApproval.command;
            setPendingApproval(null);
            executeFinalCommand(cmd);
          }}
          onAlways={() => {
            const cmd = pendingApproval.command;
            setPendingApproval(null);
            executeFinalCommand(cmd);
          }}
          onDeny={() => {
            setPendingApproval(null);
            audioEngine.playSound('oof', 1);
          }}
        />
      )}
    </div>
  );
};
