import React, { useState, useEffect, useMemo } from 'react';
import { SessionNode } from './types/sessionTree';
import { ptyClient } from './core/ptyClient';
import { audioEngine } from './core/audioEngine';
import { RawTerminalView } from './components/RawTerminalView';
import { StatusPlate } from './components/StatusPlate';
import { SplitPaneGrid } from './components/SplitPaneGrid';
import { SessionModeNotice } from './components/SessionModeNotice';
import { CommandPalette, type CommandPaletteAction } from './components/CommandPalette';
import { Scratchpad } from './components/Scratchpad';
import { WorkspaceModal } from './components/WorkspaceModal';
import { isWorking, lastOutputAt } from './core/activityMonitor';
import { buildWaitingList } from './core/waitingList';
import { attentionQueue } from './core/attentionQueue';
import { stateOf as scrollbackOf } from './core/scrollback';
import { usePtyEvents } from './hooks/usePtyEvents';
import { useWorkspaceSet } from './hooks/useWorkspaceSet';
import { useGlobalKeys } from './hooks/useGlobalKeys';
import { buildPaletteActions } from './core/paletteActions';
import { useSessionNotifications } from './hooks/useSessionNotifications';
import { type AppTelemetry } from './hud/state';
import { adjacentPane } from './core/paneTree';
import { PaneSelectOverlay } from './components/PaneSelectOverlay';
import { closeDisposition } from './core/sessionClose';
import { CloseSessionPrompt } from './components/CloseSessionPrompt';
import { SessionSnapshotNotice } from './components/SessionSnapshotNotice';
import { AgentQueueIndicator } from './components/AgentQueueIndicator';
import { PermissionModeModal, type PermissionMode } from './components/PermissionModeModal';
import { RenameSessionModal } from './components/RenameSessionModal';

/** A stable empty list, so a closed palette does not hand out a new array. */
const EMPTY_ACTIONS: CommandPaletteAction[] = [];

export const App: React.FC = () => {
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState<boolean>(false);

  // Nothing here is claimed until the daemon reports it. contextUsed, rateUsed
  // and tokens stay absent because no agent CLI reports them to the terminal.
  const [telemetry, setTelemetry] = useState<AppTelemetry>({
    isolation: 'host',
    agent: 'shell',
    credentials: [false, false, false],
  });

  const {
    workspace,
    setWorkspace,
    activeGroup,
    activeNode,
    recoveryState,
    bindingFor,
    handleReviveNode,
    handleCreateNode,
    handleRenameNode,
    handleOpenWorkspaceFolder,
    needsWorkspaceChoice,
    chooseStartupWorkspace,
    dismissStartupChoice,
    handleSelectNode,
    handleSetGroupLayout,
    handleSetPaneTree,
    handleEqualizePanes,
    handleTogglePaneZoom,
    handleParkNode,
    handleKillNode,
    handleRecoverSession,
  } = useWorkspaceSet(telemetry);
  const workspaceNodes = useMemo(() => Object.values(workspace.nodes), [workspace.nodes]);

  // Modals & Panels
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isPaneSelectorOpen, setIsPaneSelectorOpen] = useState(false);
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const [, setIsMuted] = useState(audioEngine.isMuted());
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => {
    try {
      return (localStorage.getItem('doom-term-permission-mode') as PermissionMode) || 'manual';
    } catch {
      return 'manual';
    }
  });
  const [isPermissionModalOpen, setIsPermissionModalOpen] = useState(false);
  const [renameModalState, setRenameModalState] = useState<{
    isOpen: boolean;
    nodeId: string;
    title: string;
    sessionNumber?: number | null;
  }>({ isOpen: false, nodeId: '', title: '' });

  const handleSetPermissionMode = (mode: PermissionMode) => {
    setPermissionMode(mode);
    try {
      localStorage.setItem('doom-term-permission-mode', mode);
    } catch {}
  };

  usePtyEvents(setWorkspace, setTelemetry);

  // Bind whichever session is on screen to a daemon session. A restored or
  // default workspace never did this, so its terminal was connected to nothing.
  useEffect(() => {
    if (!activeNode) return;
    if (activeNode.kind === 'scratchpad') return;
    // Nobody has said where the first terminal opens yet. Spawning HOME behind
    // the picker would leave a shell running in a folder no one chose, and the
    // chosen folder would then be the second session rather than the first.
    if (needsWorkspaceChoice) return;
    // Spawn is attach-or-create, so a restored id must not reach it until the
    // daemon has said whether it still holds that session. It did before, and
    // a cold start against an empty daemon created a fresh shell under the
    // stored id — cached scrollback with a brand new process behind it.
    if (bindingFor(activeNode.id) !== 'ready') return;
    ptyClient.ensureSession(activeNode.id, activeNode.cwd);
  }, [activeNode?.id, activeNode?.kind, activeNode?.cwd, bindingFor, needsWorkspaceChoice]);

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
        const busy = activeNode ? isWorking(activeNode.id) : false;
        // Reading back is a mode, and the plate is the only place a mode's
        // controls can live now.
        const sb = activeNode ? scrollbackOf(activeNode.id) : null;
        const mode: 'waiting' | 'transport' =
          sb && (sb.detached || sb.query) ? 'transport' : 'waiting';
        const waiting = buildWaitingList(
          workspaceNodes,
          activeNode?.id ?? '',
          { isBusy: isWorking, lastOutputAt },
          Date.now(),
          attentionQueue,
        );
        // The elapsed times tick, so a fresh array every 150ms would hand the
        // plate a new object forever and redraw it at 6.7fps for no reason.
        // Compare what is actually drawn instead.
        const unchanged =
          prev.agentBusy === busy &&
          prev.mode === mode &&
          prev.transport?.line === sb?.line &&
          prev.transport?.total === sb?.total &&
          prev.transport?.query === sb?.query &&
          prev.transport?.hit === sb?.hit &&
          prev.waiting?.length === waiting.length &&
          waiting.every((r, i) => {
            const p = prev.waiting?.[i];
            return p && p.sessionId === r.sessionId && p.n === r.n && p.name === r.name && p.tail === r.tail && p.failed === r.failed;
          });
        // SANDBOX reads WAIT while anything is blocked on you. The plate has
        // rendered pendingApproval that way since the gate existed; only the
        // source of the signal changed, from our own guess to the agent's word.
        const blocked = workspaceNodes.some((node) => node.blockedOnUser);
        if (unchanged && prev.pendingApproval === blocked) return prev;
        return { ...prev, agentBusy: busy, waiting, mode, transport: sb, pendingApproval: blocked };
      });

    apply();
    // The stream going quiet is not an event, so it has to be noticed on a
    // timer. Cheap: it only ever flips a boolean that is already correct.
    const id = window.setInterval(apply, 150);
    return () => window.clearInterval(id);
  }, [activeNode?.id, activeGroup.nodeIds, workspaceNodes]);

  const requestClose = (nodeId: string) => {
    const node = workspace.nodes[nodeId];
    if (!node) return;
    const mode = ptyClient.getSessionMode(nodeId);
    if (closeDisposition(node, mode?.durable ?? true) === 'kill') {
      handleKillNode(nodeId);
      return;
    }
    setPendingCloseId(nodeId);
  };

  useGlobalKeys({
    onNewTerminal: () => handleCreateNode(activeGroup.id, 'terminal'),
    onCloseSession: () => requestClose(activeGroup.activeNodeId),
    onOpenPalette: () => setIsPaletteOpen(true),
    onToggleAudio: () => setIsMuted(audioEngine.toggleMute()),
    onNextAttention: () => {
      const target = attentionQueue.next(telemetry.waiting ?? [], activeNode?.id ?? null);
      if (!target) return;
      attentionQueue.acknowledge(target);
      handleSelectNode(target);
    },
    onFocusPane: (direction) => {
      if (!activeGroup.paneTree) return;
      const target = adjacentPane(activeGroup.paneTree, activeGroup.activeNodeId, direction);
      if (target) handleSelectNode(target);
    },
    onSelectPane: () => {
      if (activeGroup.paneTree) setIsPaneSelectorOpen(true);
    },
    onTogglePaneZoom: () => {
      if (activeGroup.paneTree) {
        handleTogglePaneZoom(activeGroup.id, activeGroup.activeNodeId);
      }
    },
    onOpenWorkspace: () => setIsWorkspaceModalOpen(true),
    // A number with no session behind it does nothing, rather than guessing at
    // a neighbour. Ctrl+4 with three sessions open is a no-op on purpose.
    onJumpToNumber: (n) => {
      const target = workspaceNodes.find((node) => node.number === n);
      if (target) handleSelectNode(target.id);
    },
    onSnapToBottom: null,
  });

  /*
    Command palette actions — built only while the palette is on screen.

    This ran on EVERY App render, open or closed. Each build maps every
    session's whole rendered scrollback into a search corpus and joins it, so
    the most expensive thing in the app was being recomputed continuously for a
    surface nobody was looking at. It also handed the palette a brand new array
    every time, which used to reset the keyboard selection — see CommandPalette.
  */
  const paletteActions = useMemo(
    () => (isPaletteOpen ? buildPaletteActions({
    activeGroup,
    activeNode,
    workspaceName: workspace.name,
    nodes: workspaceNodes,
    recoverableSessions: recoveryState.recoverable,
    setIsWorkspaceModalOpen,
    onCreateNode: handleCreateNode,
    onRenameNode: handleRenameNode,
    onSetGroupLayout: handleSetGroupLayout,
    onEqualizePanes: handleEqualizePanes,
    onSelectNode: handleSelectNode,
    onRecoverSession: handleRecoverSession,
    onCloseSession: (nodeId) => setPendingCloseId(nodeId),
    onTogglePaneZoom: () => {
      if (activeGroup.paneTree) {
        handleTogglePaneZoom(activeGroup.id, activeGroup.activeNodeId);
      }
    },
    onFocusPane: (direction) => {
      if (!activeGroup.paneTree) return;
      const targetId = adjacentPane(activeGroup.paneTree, activeGroup.activeNodeId, direction);
      if (targetId) handleSelectNode(targetId);
    },
    onSelectPane: () => {
      if (activeGroup.paneTree && activeGroup.paneTree.type === 'split') {
        setIsPaneSelectorOpen(true);
      }
    },
    onNextAttention: () => {
      const nextId = attentionQueue.next(
        telemetry.waiting ?? [],
        activeGroup.activeNodeId,
      );
      if (nextId) handleSelectNode(nextId);
    },
    onOpenPermissionsModal: () => setIsPermissionModalOpen(true),
    onOpenRenameModal: (nodeId, currentTitle) => {
      const node = workspace.nodes[nodeId];
      setRenameModalState({
        isOpen: true,
        nodeId,
        title: currentTitle,
        sessionNumber: node?.number,
      });
    },
    onSendSignal: (sig) => {
      if (!activeNode) return;
      ptyClient.sendSignalToSession(activeNode.id, sig);
    },
    // The same acknowledgement state the plate reads, so the palette and the
    // waiting rows agree about what is asking for you.
    attention: attentionQueue,
    }) : EMPTY_ACTIONS),
    // Deliberately coarse: while the palette is closed this never runs, and
    // while it is open the selection is tracked by id rather than by position,
    // so a rebuild no longer moves the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isPaletteOpen, workspaceNodes, activeGroup, activeNode, recoveryState.recoverable],
  );

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

    // A restored session with no process behind it is not a terminal, and
    // drawing one over its cached lines is what made a silently-respawned
    // shell indistinguishable from a recovered one.
    const binding = bindingFor(node.id);
    if (binding !== 'ready') {
      return (
        <SessionSnapshotNotice
          title={node.title}
          cwd={node.cwd}
          pending={binding === 'waiting'}
          onStart={() => handleReviveNode(node.id)}
        />
      );
    }

    return (
      <RawTerminalView
        lines={node.tuiLines}
        sessionId={node.id}
        isActive={isActive}
        agentKey={node.foregroundAgent ?? null}
        cursor={node.cursor ?? null}
        onWrite={(data: string) => ptyClient.writeToSession(node.id, data)}
        onSendSignal={(sig: 'ctrl+c' | 'ctrl+d' | 'ctrl+z') => ptyClient.sendSignalToSession(node.id, sig)}
      />
    );
  };

  const groupNodes = activeGroup.nodeIds.map((id) => workspace.nodes[id]).filter(Boolean);
  useSessionNotifications(workspaceNodes, activeGroup.activeNodeId, handleSelectNode);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden select-none font-mono" style={{ background: 'var(--ground)' }}>
      <SessionModeNotice sessionId={activeNode?.id ?? null} />

      {/* The terminal reaches all four window edges. The plate is the only
          chrome, and Ctrl+1-9 plus the plate's waiting rows are how you move
          between sessions now that the strip and the sidebar are gone. */}
      <div className="flex-1 flex relative min-h-0 min-w-0">
        <AgentQueueIndicator
          nodes={workspaceNodes}
          activeSessionId={activeGroup.activeNodeId}
          onSelectNode={handleSelectNode}
        />
        <SplitPaneGrid
          layout={activeGroup.layout}
          nodes={groupNodes}
          activeNodeId={activeGroup.activeNodeId}
          paneTree={activeGroup.paneTree}
          zoomedSessionId={activeGroup.zoomedSessionId}
          onPaneTreeChange={(tree) => handleSetPaneTree(activeGroup.id, tree)}
          onSelectNode={handleSelectNode}
          renderPane={renderSessionPane}
        />
        {isPaneSelectorOpen && activeGroup.paneTree && (
          <PaneSelectOverlay
            tree={activeGroup.paneTree}
            onSelect={handleSelectNode}
            onClose={() => setIsPaneSelectorOpen(false)}
          />
        )}
      </div>

      {/* Bottom Doom 1993 Status Plate (STBAR) */}
      <div className="shrink-0">
        <StatusPlate
          telemetry={{ ...telemetry, permissionMode }}
          onSelectWaiting={(sessionId) => {
            attentionQueue.acknowledge(sessionId);
            handleSelectNode(sessionId);
          }}
          onOpenPermissionsModal={() => setIsPermissionModalOpen(true)}
        />
      </div>

      {/* Universal Command Palette Modal */}
      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        actions={paletteActions}
        onRenameSession={(nodeId, currentTitle) => {
          const node = workspace.nodes[nodeId];
          setRenameModalState({
            isOpen: true,
            nodeId,
            title: currentTitle,
            sessionNumber: node?.number,
          });
        }}
      />

      {/* Workspace Folder Picker Modal. On a run with nothing to restore this
          opens itself: the first terminal belongs in a folder someone chose,
          and Esc still means HOME. */}
      <WorkspaceModal
        isOpen={isWorkspaceModalOpen || needsWorkspaceChoice}
        onClose={() => {
          if (needsWorkspaceChoice) dismissStartupChoice();
          setIsWorkspaceModalOpen(false);
        }}
        onSelectWorkspace={(path, name) => {
          if (needsWorkspaceChoice) chooseStartupWorkspace(path, name);
          else handleOpenWorkspaceFolder(path, name);
        }}
      />

      {/* In-App Rename Session Modal */}
      <RenameSessionModal
        isOpen={renameModalState.isOpen}
        initialTitle={renameModalState.title}
        sessionNumber={renameModalState.sessionNumber}
        onRename={(newTitle) => handleRenameNode(renameModalState.nodeId, newTitle)}
        onClose={() => setRenameModalState((prev) => ({ ...prev, isOpen: false }))}
      />

      {/* Execution Permission Mode Modal */}
      <PermissionModeModal
        isOpen={isPermissionModalOpen}
        currentMode={permissionMode}
        onSelectMode={handleSetPermissionMode}
        onClose={() => setIsPermissionModalOpen(false)}
      />

      {pendingCloseId && workspace.nodes[pendingCloseId] && (
        <CloseSessionPrompt
          title={workspace.nodes[pendingCloseId].title}
          // Null is "the daemon has not said yet", which `?? false` turned into
          // a confident warning that parking would not survive. Pass it through.
          durable={ptyClient.getSessionMode(pendingCloseId)?.durable ?? null}
          onPark={() => {
            handleParkNode(pendingCloseId);
            setPendingCloseId(null);
          }}
          onKill={() => {
            handleKillNode(pendingCloseId);
            setPendingCloseId(null);
          }}
          onCancel={() => setPendingCloseId(null)}
        />
      )}
    </div>
  );
};
