import React, { useState, useEffect, useRef } from 'react';
import { TerminalBlock } from './types/terminal';
import { SessionNode } from './types/sessionTree';
import { getEmulator } from './core/emulatorRegistry';
import { ptyClient } from './core/ptyClient';
import { audioEngine } from './core/audioEngine';
import { analyzeCommandRisk } from './core/securityAnalyzer';
import { Block } from './components/Block';
import { TabBar } from './components/TabBar';
import { CommandEditor } from './components/CommandEditor';
import { RawTerminalView } from './components/RawTerminalView';
import { StatusPlate } from './components/StatusPlate';
import { Approval } from './components/Approval';
import { SessionTree } from './components/SessionTree';
import { SplitPaneGrid } from './components/SplitPaneGrid';
import { CommandPalette } from './components/CommandPalette';
import { Scratchpad } from './components/Scratchpad';
import { WorkspaceModal } from './components/WorkspaceModal';
import { uniqueId } from './core/ids';
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

  // Modals & Panels
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [, setIsMuted] = useState(audioEngine.isMuted());

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

  // Viewport Auto-Follow Scroll
  useEffect(() => {
    if (!scrollDetached && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [activeNode?.blocks, scrollDetached]);

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

    if (node.isTuiActive) {
      return (
        <RawTerminalView
          lines={node.tuiLines}
          onWrite={(data: string) => ptyClient.writeToSession(node.id, data)}
          onSendSignal={(sig: 'ctrl+c' | 'ctrl+d' | 'ctrl+z') => ptyClient.sendSignalToSession(node.id, sig)}
        />
      );
    }

    return (
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Blocks Scroll Area */}
        <div
          ref={isActive ? scrollContainerRef : undefined}
          onScroll={isActive ? handleScroll : undefined}
          className="flex-1 overflow-y-auto px-2 py-1 space-y-1.5 min-h-0"
        >
          {node.blocks.length === 0 ? (
            <div className="text-[12px] p-2 select-none" style={{ color: 'var(--ink-dim)' }}>
              Type a command below to execute.
            </div>
          ) : (
            node.blocks.map((block) => (
              <Block
                key={block.id}
                block={block}
                onApplyDiff={(file) => executeFinalCommand(`git apply ${file}`)}
              />
            ))
          )}
        </div>

        {/* Scroll Detached Indicator */}
        {isActive && scrollDetached && (
          <div className="flex justify-center my-1 select-none">
            <button
              onClick={handleSnapToBottom}
              className="plate px-3 py-0.5 text-[11px] font-bold tracking-wider animate-pulse"
              style={{ color: 'var(--ink-plate)' }}
            >
              [SCROLL DETACHED — PRESS SPACE TO RESUME]
            </button>
          </div>
        )}

        {/* Bottom Command Editor */}
        <div className="mt-auto px-2 pb-1.5 pt-1">
          <CommandEditor
            onExecute={handleExecuteCommand}
            onSendSignal={(sig) => ptyClient.sendSignalToSession(node.id, sig)}
            onOpenHistory={() => setIsPaletteOpen(true)}
            history={node.commandHistory}
            currentDir={node.cwd}
            gitBranch={node.gitBranch}
            isRunning={node.agentState === 'running'}
          />
        </div>
      </div>
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
      />

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
