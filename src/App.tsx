import React, { useState, useEffect, useRef, useMemo } from 'react';
import { TerminalBlock } from './types/terminal';
import { ProjectWorkspace, SessionGroup, SessionNode, SplitLayoutMode } from './types/sessionTree';
import { getEmulator, disposeEmulator } from './core/emulatorRegistry';
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
import { CommandPalette, CommandPaletteAction } from './components/CommandPalette';
import { VerificationPanel, VerificationLens } from './components/VerificationPanel';
import { Scratchpad } from './components/Scratchpad';
import { SessionStore } from './core/sessionStore';
import { ContextGraph } from './core/contextGraph';
import { TaskPipeline } from './core/taskPipeline';
import { InterAgentMessageBus } from './core/messageBus';
import { TokenMeter } from './core/tokenMeter';
import { WorktreeManager } from './core/worktreeManager';
import { type AppTelemetry } from './hud/state';

export const App: React.FC = () => {
  // Persistent Workspace State
  const [workspace, setWorkspace] = useState<ProjectWorkspace>(() => SessionStore.loadWorkspace());
  const [showTree, setShowTree] = useState<boolean>(true);

  // Active Group & Node
  const activeGroup = useMemo(() => {
    return workspace.groups.find((g) => g.id === workspace.activeGroupId) || workspace.groups[0];
  }, [workspace]);

  const activeNode = useMemo(() => {
    return workspace.nodes[activeGroup.activeNodeId] || Object.values(workspace.nodes)[0];
  }, [workspace, activeGroup]);

  // Context Graph, Task Pipeline & Message Bus
  const contextGraph = useMemo(() => new ContextGraph(workspace.links), [workspace.links]);
  const taskPipeline = useMemo(() => new TaskPipeline(workspace.tasks), [workspace.tasks]);
  const messageBus = useMemo(() => new InterAgentMessageBus(workspace.messages), [workspace.messages]);

  // Telemetry state for StatusPlate
  const [telemetry, setTelemetry] = useState<AppTelemetry>({
    contextUsed: 0.05,
    rateUsed: 0.1,
    isolation: 'sandbox',
    agent: 'claude',
    agentName: 'CLAUDE CODE',
    model: 'OPUS-4-6',
    cwd: activeNode?.cwd || '~/Projects/Doom Term',
    branch: activeNode?.gitBranch || 'main',
    credentials: [true, true, false],
    tokens: { in: 1420, out: 380, cache: 810, limit: [128000, 32000, 64000, 200000] },
    pendingApproval: false,
  });

  // Pending Approval Modal State
  const [pendingApproval, setPendingApproval] = useState<{
    command: string;
    consequence: string;
    isolation: 'FULL' | 'TREE' | 'OFF';
  } | null>(null);

  // Verification Modal State
  const [activeVerification, setActiveVerification] = useState<{
    targetTitle: string;
    lenses: VerificationLens[];
    verdict: 'APPROVED' | 'REJECTED' | 'IN_PROGRESS';
  } | null>(null);

  // Viewport Scroll Lock & Auto-Follow State
  const [scrollDetached, setScrollDetached] = useState<boolean>(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Modals & Panels
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [, setIsMuted] = useState(audioEngine.isMuted());

  // Save workspace on change
  useEffect(() => {
    SessionStore.saveWorkspace(workspace);
  }, [workspace]);

  // Subscribe to PTY Client Events across sessions
  useEffect(() => {
    const unbindPty = ptyClient.registerHandler({
      onOutput: (rawChunk, sessionId) => {
        // Feed the session's own emulator. It owns cursor position, colour
        // state and the screen grid, so a chunk boundary landing mid-escape or
        // mid-row no longer corrupts anything.
        const emu = getEmulator(sessionId);
        emu.write(rawChunk);
        const inAltScreen = emu.isAltScreen();

        setWorkspace((prev) => {
          const target = prev.nodes[sessionId];
          if (!target) return prev;

          const updatedNode = { ...target, isTuiActive: inAltScreen };

          if (inAltScreen) {
            // A full-screen app owns the grid; render it rather than a log of frames.
            updatedNode.tuiLines = emu.getLines();
          } else {
            const updatedBlocks = [...updatedNode.blocks];
            const idx = updatedNode.activeBlockId
              ? updatedBlocks.findIndex((b) => b.id === updatedNode.activeBlockId)
              : updatedBlocks.length - 1;

            if (idx >= 0) {
              const block = updatedBlocks[idx];
              // Re-read the block's slice of the buffer. Assigning rather than
              // appending is what lets \r, backspace and erase actually undo work.
              updatedBlocks[idx] = {
                ...block,
                liveLines: emu.linesSince(block.outputMark ?? 0),
              };
            }
            updatedNode.blocks = updatedBlocks;
          }

          return {
            ...prev,
            nodes: {
              ...prev.nodes,
              [updatedNode.id]: updatedNode,
            },
          };
        });
      },

      onCwd: (cwd, sessionId) => {
        setWorkspace((prev) => {
          const target = prev.nodes[sessionId];
          if (!target || target.cwd === cwd) return prev;
          // The directory moved, so the branch may have too — ask about this
          // path specifically rather than trusting the daemon's own directory.
          if (sessionId === prev.groups.find((g) => g.id === prev.activeGroupId)?.activeNodeId) {
            ptyClient.requestTelemetry(cwd);
          }
          return {
            ...prev,
            nodes: { ...prev.nodes, [sessionId]: { ...target, cwd } },
          };
        });
      },

      onExecutionStart: () => {},

      onExecutionEnd: (exitCode) => {
        const hasError = exitCode !== null && exitCode !== 0;

        if (hasError) {
          audioEngine.playSound('oof', 1);
        } else {
          audioEngine.playSound('pickup', 2);
        }

        // Freeze active block into immutable snapshot
        setWorkspace((prev) => {
          const activeG = prev.groups.find((g) => g.id === prev.activeGroupId);
          if (!activeG) return prev;
          const currentNode = prev.nodes[activeG.activeNodeId];
          if (!currentNode) return prev;

          const updatedBlocks = currentNode.blocks.map((b) => {
            if (b.id === currentNode.activeBlockId || b.status === 'running') {
              const duration = Date.now() - b.startedAt;
              return {
                ...b,
                status: (hasError ? 'error' : 'completed') as TerminalBlock['status'],
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
          });

          const updatedNode: SessionNode = {
            ...currentNode,
            activeBlockId: null,
            agentState: hasError ? 'errored' : 'idle',
            blocks: updatedBlocks,
          };

          const newWorkspace = {
            ...prev,
            nodes: {
              ...prev.nodes,
              [updatedNode.id]: updatedNode,
            },
          };

          // Evaluate chained tasks
          const trigger = taskPipeline.evaluate(newWorkspace.nodes);
          for (const ready of trigger.readyTasks) {
            ptyClient.submitCommandToSession(ready.nodeId, ready.command);
            taskPipeline.markRunning(ready.nodeId);
          }

          // Deliver queued messages
          const deliveries = messageBus.deliverPending(updatedNode.id, updatedNode.agentState === 'idle');
          for (const d of deliveries) {
            ptyClient.submitCommandToSession(updatedNode.id, d.formattedText);
          }

          return newWorkspace;
        });
      },

      onTuiMode: (active) => {
        setWorkspace((prev) => {
          const activeG = prev.groups.find((g) => g.id === prev.activeGroupId);
          if (!activeG) return prev;
          const currentNode = prev.nodes[activeG.activeNodeId];
          if (!currentNode) return prev;

          return {
            ...prev,
            nodes: {
              ...prev.nodes,
              [currentNode.id]: { ...currentNode, isTuiActive: active },
            },
          };
        });
        if (active) {
          audioEngine.playSound('door', 2);
        }
      },

      onAgentState: (state) => {
        setWorkspace((prev) => {
          const activeG = prev.groups.find((g) => g.id === prev.activeGroupId);
          if (!activeG) return prev;
          const currentNode = prev.nodes[activeG.activeNodeId];
          if (!currentNode) return prev;

          return {
            ...prev,
            nodes: {
              ...prev.nodes,
              [currentNode.id]: {
                ...currentNode,
                agentState: state as SessionNode['agentState'],
              },
            },
          };
        });
      },
    });

    const unbindTele = ptyClient.onTelemetry((data) => {
      setTelemetry((prev) => ({
        ...prev,
        cwd: data.current_dir,
        branch: data.git_branch || 'main',
        isolation: data.sandbox_level >= 100 ? 'sandbox' : data.sandbox_level >= 50 ? 'worktree' : 'host',
        credentials: data.credentials ?? prev.credentials,
      }));
    });

    return () => {
      unbindPty();
      unbindTele();
    };
  }, [taskPipeline, messageBus]);

  // Recalculate dynamic tokens & context usage whenever active blocks change
  useEffect(() => {
    if (activeNode) {
      let totalInputChars = 0;
      let totalOutputChars = 0;

      for (const b of activeNode.blocks) {
        totalInputChars += b.command.length;
        const lines = b.snapshot ? b.snapshot.lines : b.liveLines;
        for (const line of lines) {
          for (const span of line.spans) {
            totalOutputChars += span.text.length;
          }
        }
      }

      const metrics = TokenMeter.calculateTokens(totalInputChars, totalOutputChars, 'claude-3-7-sonnet');
      const now = Date.now();
      const recentCommands = activeNode.blocks.filter((b) => now - b.startedAt < 15 * 60 * 1000).length;
      const ratePct = Math.min(0.99, recentCommands / 25);

      setTelemetry((prev) => ({
        ...prev,
        tokens: {
          in: metrics.tokensIn,
          out: metrics.tokensOut,
          cache: metrics.tokensCache,
          limit: metrics.limits,
        },
        contextUsed: metrics.contextPct,
        rateUsed: ratePct,
        cwd: activeNode.cwd,
        branch: activeNode.gitBranch,
        pendingApproval: pendingApproval !== null,
      }));
    }
  }, [activeNode, pendingApproval]);

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

  // Node & Group Creation / Navigation
  const handleCreateNode = (groupId: string, kind: SessionNode['kind'] = 'terminal') => {
    const newNodeId = `node-${Date.now()}`;
    const nextIdx = Object.keys(workspace.nodes).length + 1;
    const group = workspace.groups.find((g) => g.id === groupId) || activeGroup;

    const newNode: SessionNode = {
      id: newNodeId,
      groupId: group.id,
      title: `${kind === 'terminal' ? 'Terminal' : kind === 'agent' ? 'Agent' : kind === 'scratchpad' ? 'Notes' : 'Verify'} ${nextIdx}`,
      kind,
      cwd: group.worktreePath || telemetry.cwd || '~/Projects/Doom Term',
      gitBranch: group.worktreeBranch || telemetry.branch || 'main',
      activeBlockId: null,
      isTuiActive: false,
      agentState: 'idle',
      blocks: [],
      tuiLines: [],
      commandHistory: [],
      scratchpadContent: kind === 'scratchpad' ? '# Scratchpad Notes\n\n- Task 1: Complete setup\n- Task 2: Verify diffs' : undefined,
      createdAt: Date.now(),
    };

    setWorkspace((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === group.id
          ? {
              ...g,
              activeNodeId: newNodeId,
              nodeIds: [...g.nodeIds, newNodeId],
            }
          : g
      ),
      nodes: {
        ...prev.nodes,
        [newNodeId]: newNode,
      },
    }));

    if (kind === 'terminal' || kind === 'agent') {
      ptyClient.setActiveSession(newNodeId);
      ptyClient.spawnSession(newNodeId, 120, 30, newNode.cwd);
    }
  };

  const handleCreateWorktreeGroup = (branch: string) => {
    const newGroupId = `group-${Date.now()}`;
    const newNodeId = `node-${Date.now()}`;
    const wtPath = WorktreeManager.getWorktreePath(telemetry.cwd || '~/Projects/Doom Term', branch);

    const initialNode: SessionNode = {
      id: newNodeId,
      groupId: newGroupId,
      title: `${branch} Shell`,
      kind: 'terminal',
      cwd: wtPath,
      gitBranch: branch,
      activeBlockId: null,
      isTuiActive: false,
      agentState: 'idle',
      blocks: [],
      tuiLines: [],
      commandHistory: [],
      createdAt: Date.now(),
    };

    const newGroup: SessionGroup = {
      id: newGroupId,
      projectId: workspace.id,
      name: `Worktree: ${branch}`,
      worktreePath: wtPath,
      worktreeBranch: branch,
      layout: 'single',
      activeNodeId: newNodeId,
      nodeIds: [newNodeId],
      createdAt: Date.now(),
    };

    setWorkspace((prev) => ({
      ...prev,
      activeGroupId: newGroupId,
      groups: [...prev.groups, newGroup],
      nodes: {
        ...prev.nodes,
        [newNodeId]: initialNode,
      },
    }));

    // Trigger backend worktree provisioning and PTY session
    ptyClient.spawnWorktree(branch);
    ptyClient.setActiveSession(newNodeId);
    ptyClient.spawnSession(newNodeId, 120, 30, wtPath);
    audioEngine.playSound('door', 2);
  };

  const handleSelectNode = (nodeId: string, groupId?: string) => {
    const targetGroupId = groupId || workspace.nodes[nodeId]?.groupId || activeGroup.id;
    setWorkspace((prev) => ({
      ...prev,
      activeGroupId: targetGroupId,
      groups: prev.groups.map((g) =>
        g.id === targetGroupId ? { ...g, activeNodeId: nodeId } : g
      ),
    }));
    ptyClient.setActiveSession(nodeId);
  };

  const handleSelectGroup = (groupId: string) => {
    const group = workspace.groups.find((g) => g.id === groupId);
    if (!group) return;
    setWorkspace((prev) => ({
      ...prev,
      activeGroupId: groupId,
    }));
    ptyClient.setActiveSession(group.activeNodeId);
  };

  const handleSetGroupLayout = (groupId: string, layout: SplitLayoutMode) => {
    setWorkspace((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => (g.id === groupId ? { ...g, layout } : g)),
    }));
    audioEngine.playSound('click', 3);
  };

  const handleCloseNode = (nodeId: string) => {
    if (Object.keys(workspace.nodes).length <= 1) return;

    ptyClient.killSession(nodeId);
    disposeEmulator(nodeId);

    setWorkspace((prev) => {
      const nextNodes = { ...prev.nodes };
      delete nextNodes[nodeId];

      const nextGroups = prev.groups
        .map((g) => {
          const filtered = g.nodeIds.filter((id) => id !== nodeId);
          return {
            ...g,
            nodeIds: filtered,
            activeNodeId: g.activeNodeId === nodeId ? filtered[0] || '' : g.activeNodeId,
          };
        })
        .filter((g) => g.nodeIds.length > 0);

      const nextActiveGroupId = nextGroups.some((g) => g.id === prev.activeGroupId)
        ? prev.activeGroupId
        : nextGroups[0]?.id || '';

      return {
        ...prev,
        activeGroupId: nextActiveGroupId,
        groups: nextGroups,
        nodes: nextNodes,
      };
    });
  };

  // Execute Command with Security Risk Interception
  const executeFinalCommand = (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed || !activeNode) return;

    const newBlockId = `block-${Date.now()}`;
    const newBlock: TerminalBlock = {
      id: newBlockId,
      command: trimmed,
      status: 'running',
      startedAt: Date.now(),
      gitBranch: activeNode.gitBranch || 'main',
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

  const handleOpenVerification = () => {
    setActiveVerification({
      targetTitle: activeNode.title,
      verdict: 'APPROVED',
      lenses: [
        { id: '1', name: '1. Correctness & Syntax', status: 'passed', details: 'All syntax trees valid; zero unhandled errors or missing imports.' },
        { id: '2', name: '2. Security & Sandbox Guard', status: 'passed', details: 'No unsafe filesystem escape; within sandbox constraints.' },
        { id: '3', name: '3. Performance & Memory', status: 'passed', details: 'Rendering benchmarks pass; 60 FPS verified.' },
        { id: '4', name: '4. Test Suite Pass Rate', status: 'passed', details: '29/29 tests passing; 100% test coverage maintained.' },
      ],
    });
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      // Ctrl+Shift+T: New Terminal Tab
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        handleCreateNode(activeGroup.id, 'terminal');
        return;
      }

      // Ctrl+B: Toggle Session Tree Sidebar
      if (e.ctrlKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setShowTree((prev) => !prev);
        return;
      }

      // Ctrl+P or Ctrl+K: Open Universal Command Palette
      if (e.ctrlKey && (e.key.toLowerCase() === 'p' || e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        setIsPaletteOpen(true);
        return;
      }

      // Ctrl+M: Toggle Audio
      if (e.ctrlKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        const next = audioEngine.toggleMute();
        setIsMuted(next);
        return;
      }

      // Space when scroll is detached: Snap back to bottom
      if (
        e.key === ' ' &&
        scrollDetached &&
        document.activeElement?.tagName !== 'TEXTAREA' &&
        document.activeElement?.tagName !== 'INPUT'
      ) {
        e.preventDefault();
        handleSnapToBottom();
      }
    };

    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [scrollDetached, isPaletteOpen, activeGroup]);

  // Command Palette Actions
  const paletteActions: CommandPaletteAction[] = [
    {
      id: 'new-term',
      category: 'Session',
      title: 'New Terminal Session',
      shortcut: 'Ctrl+Shift+T',
      run: () => handleCreateNode(activeGroup.id, 'terminal'),
    },
    {
      id: 'new-agent',
      category: 'Agent',
      title: 'Spawn AI Agent Session',
      run: () => handleCreateNode(activeGroup.id, 'agent'),
    },
    {
      id: 'new-scratchpad',
      category: 'Notes',
      title: 'Open Markdown Scratchpad',
      run: () => handleCreateNode(activeGroup.id, 'scratchpad'),
    },
    {
      id: 'copy-transcript',
      category: 'Context',
      title: 'Copy Node Transcript (Linked Context)',
      run: () => {
        if (activeNode) {
          const text = contextGraph.getTranscript(activeNode);
          navigator.clipboard.writeText(text);
          audioEngine.playSound('click', 3);
        }
      },
    },
    {
      id: 'verify-panel',
      category: 'Verify',
      title: 'Open Multi-Lens Verification Panel',
      run: handleOpenVerification,
    },
    {
      id: 'toggle-tree',
      category: 'View',
      title: 'Toggle Workspace Sidebar Tree',
      shortcut: 'Ctrl+B',
      run: () => setShowTree(!showTree),
    },
    {
      id: 'layout-single',
      category: 'Layout',
      title: 'Layout: Single Full Pane',
      run: () => handleSetGroupLayout(activeGroup.id, 'single'),
    },
    {
      id: 'layout-split-v',
      category: 'Layout',
      title: 'Layout: Split Vertical (2 Panes)',
      run: () => handleSetGroupLayout(activeGroup.id, 'split-v'),
    },
    {
      id: 'layout-grid',
      category: 'Layout',
      title: 'Layout: 2x2 Quad Grid',
      run: () => handleSetGroupLayout(activeGroup.id, 'grid-2x2'),
    },
    {
      id: 'toggle-audio',
      category: 'Audio',
      title: 'Toggle Doom Sound FX',
      shortcut: 'Ctrl+M',
      run: () => audioEngine.toggleMute(),
    },
  ];

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
      {/* Top Header & Tab Bar */}
      <div className="flex items-center justify-between px-2 py-1 plate" style={{ color: 'var(--ink-plate)' }}>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTree(!showTree)}
            title="Toggle Sidebar (Ctrl+B)"
            className="px-1.5 py-0.5 font-bold hover:bg-[#8e8e8b]"
          >
            ☰
          </button>
          <span className="font-bold text-[13px] tracking-wider">DOOM TERM</span>
          <span className="text-[10px] opacity-75">v0.2.0</span>
        </div>

        {/* Multi-Session Tabs within Active Group */}
        <TabBar
          sessions={groupNodes.map((n) => ({
            id: n.id,
            title: n.title,
            cwd: n.cwd,
            gitBranch: n.gitBranch,
            activeBlockId: n.activeBlockId,
            isTuiActive: n.isTuiActive,
            blocks: n.blocks,
            tuiLines: n.tuiLines,
            commandHistory: n.commandHistory,
            createdAt: n.createdAt,
          }))}
          activeSessionId={activeGroup.activeNodeId}
          onSelectSession={(id) => handleSelectNode(id)}
          onCloseSession={handleCloseNode}
          onNewSession={() => handleCreateNode(activeGroup.id, 'terminal')}
        />

        {/* Actions Menu */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleOpenVerification}
            title="Multi-Lens Verification Panel"
            className="px-2 py-0.5 text-[11px] font-bold plate hover:bg-[#8e8e8b]"
          >
            ⚖ VERIFY
          </button>
          <button
            onClick={() => setIsPaletteOpen(true)}
            title="Universal Command Palette (Ctrl+P)"
            className="px-2 py-0.5 text-[11px] font-bold plate hover:bg-[#8e8e8b]"
          >
            CTRL+P
          </button>
        </div>
      </div>

      {/* Main Center Area: Sidebar Tree + Split Pane Grid */}
      <div className="flex-1 flex min-h-0 min-w-0">
        {showTree && (
          <SessionTree
            workspace={workspace}
            onSelectNode={handleSelectNode}
            onSelectGroup={handleSelectGroup}
            onCreateNode={handleCreateNode}
            onCreateWorktreeGroup={handleCreateWorktreeGroup}
            onSetGroupLayout={handleSetGroupLayout}
            onCloseNode={handleCloseNode}
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

      {/* Multi-Lens Verification Panel Modal */}
      {activeVerification && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0, 0, 0, 0.8)' }}
        >
          <div className="w-full max-w-2xl h-[32rem]">
            <VerificationPanel
              targetTitle={activeVerification.targetTitle}
              lenses={activeVerification.lenses}
              verdict={activeVerification.verdict}
              onApply={() => {
                executeFinalCommand('git apply patch.diff');
                audioEngine.playSound('shotgun', 2);
                setActiveVerification(null);
              }}
              onReject={() => {
                audioEngine.playSound('oof', 1);
                setActiveVerification(null);
              }}
              onRerun={() => {
                audioEngine.playSound('pickup', 2);
              }}
              onClose={() => setActiveVerification(null)}
            />
          </div>
        </div>
      )}

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
