import React, { useState, useEffect } from 'react';
import { SessionNode } from './types/sessionTree';
import { ptyClient } from './core/ptyClient';
import { audioEngine } from './core/audioEngine';
import { TabBar } from './components/TabBar';
import { RawTerminalView } from './components/RawTerminalView';
import { StatusPlate } from './components/StatusPlate';
import { SessionTree } from './components/SessionTree';
import { SplitPaneGrid } from './components/SplitPaneGrid';
import { SessionModeNotice } from './components/SessionModeNotice';
import { CommandPalette } from './components/CommandPalette';
import { Scratchpad } from './components/Scratchpad';
import { WorkspaceModal } from './components/WorkspaceModal';
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

  /*
    Is the agent working? The mark pulses on this, so the answer has to be
    observed rather than asserted, and it has to be able to say no.

    `isWorking` asks whether output has been arriving CONTINUOUSLY, not merely
    recently — an agent parked at its prompt still repaints its own footer every
    second or so, and a recency test flagged that as work forever.

    There is no longer an `agentState === 'running'` arm here: that only ever
    applied to a block command, and there is no block editor to launch one from.
  */
  useEffect(() => {
    const apply = () =>
      setTelemetry((prev) => {
        const next = activeNode ? isWorking(activeNode.id) : false;
        return prev.agentBusy === next ? prev : { ...prev, agentBusy: next };
      });

    apply();
    // The stream going quiet is not an event, so it has to be noticed on a
    // timer. Cheap: it only ever flips a boolean that is already correct.
    const id = window.setInterval(apply, 150);
    return () => window.clearInterval(id);
  }, [activeNode?.id]);

  useGlobalKeys({
    onNewTerminal: () => handleCreateNode(activeGroup.id, 'terminal'),
    onCloseSession: () => handleCloseNode(activeGroup.activeNodeId),
    onToggleSidebar: () => setShowTree((prev) => !prev),
    onOpenPalette: () => setIsPaletteOpen(true),
    onToggleAudio: () => setIsMuted(audioEngine.toggleMute()),
    onOpenWorkspace: () => setIsWorkspaceModalOpen(true),
    // A number with no session behind it does nothing, rather than guessing at
    // a neighbour. Ctrl+4 with three sessions open is a no-op on purpose.
    onJumpToNumber: (n) => {
      const target = activeGroup.nodeIds
        .map((id) => workspace.nodes[id])
        .find((node) => node && node.number === n);
      if (target) handleSelectNode(target.id);
    },
    onSnapToBottom: null,
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

  /**
   * One view.
   *
   * A shell is just another process that owns the keyboard, so there is no
   * mode to choose between and no `ownsKeyboard` test to get wrong. That test
   * existed only to decide between this and the block editor, and it was the
   * source of the worst class of bug in the app: an inline agent that never
   * set DECSET 1049 got the block editor, which buffered a whole line and
   * submitted it as a new command, losing characters to the agent's own redraw.
   */
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

    return (
      <RawTerminalView
        lines={node.tuiLines}
        sessionId={node.id}
        isActive={isActive}
        isTuiSession={node.isTuiActive}
        agentName={node.foregroundAgent ? (telemetry.agentName ?? node.foregroundAgent.toUpperCase()) : null}
        onWrite={(data: string) => ptyClient.writeToSession(node.id, data)}
        onSendSignal={(sig: 'ctrl+c' | 'ctrl+d' | 'ctrl+z') => ptyClient.sendSignalToSession(node.id, sig)}
      />
    );
  };

  const groupNodes = activeGroup.nodeIds.map((id) => workspace.nodes[id]).filter(Boolean);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden select-none font-mono" style={{ background: 'var(--ground)' }}>
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
    </div>
  );
};
