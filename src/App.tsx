import React, { useState, useEffect, useRef, useMemo } from 'react';
import { TerminalBlock } from './types/terminal';
import { ProjectWorkspace, SessionNode, SplitLayoutMode } from './types/sessionTree';
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
import { Scratchpad } from './components/Scratchpad';
import { WorkspaceModal } from './components/WorkspaceModal';
import { SessionStore, createWorkspaceForFolder } from './core/sessionStore';
import { formatNodeTranscript } from './core/transcript';
import { type AppTelemetry } from './hud/state';

export const App: React.FC = () => {
  // Persistent Workspace State
  const [workspace, setWorkspace] = useState<ProjectWorkspace>(() => SessionStore.loadWorkspace());
  const [showTree, setShowTree] = useState<boolean>(true);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState<boolean>(false);

  // Active Group & Node
  const activeGroup = useMemo(() => {
    return workspace.groups.find((g) => g.id === workspace.activeGroupId) || workspace.groups[0];
  }, [workspace]);

  const activeNode = useMemo(() => {
    return workspace.nodes[activeGroup.activeNodeId] || Object.values(workspace.nodes)[0];
  }, [workspace, activeGroup]);

  // Telemetry state for StatusPlate
  // Nothing here is claimed until the daemon reports it. contextUsed, rateUsed
  // and tokens stay absent because no agent CLI reports them to the terminal.
  const [telemetry, setTelemetry] = useState<AppTelemetry>({
    isolation: 'host',
    agent: 'shell',
    cwd: activeNode?.cwd,
    branch: activeNode?.gitBranch,
    credentials: [false, false, false],
    pendingApproval: false,
  });

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

      onExecutionStart: (sessionId) => {
        setWorkspace((prev) => {
          const targetId = sessionId || prev.groups.find((g) => g.id === prev.activeGroupId)?.activeNodeId;
          if (!targetId) return prev;
          const currentNode = prev.nodes[targetId];
          if (!currentNode || !currentNode.activeBlockId) return prev;

          const emu = getEmulator(targetId);
          const currentMark = emu.mark();

          const updatedBlocks = currentNode.blocks.map((b) => {
            if (b.id === currentNode.activeBlockId) {
              return {
                ...b,
                outputMark: currentMark,
                liveLines: emu.linesSince(currentMark),
              };
            }
            return b;
          });

          return {
            ...prev,
            nodes: {
              ...prev.nodes,
              [currentNode.id]: {
                ...currentNode,
                blocks: updatedBlocks,
              },
            },
          };
        });
      },

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

          return {
            ...prev,
            nodes: {
              ...prev.nodes,
              [updatedNode.id]: updatedNode,
            },
          };
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
        // A directory that is not a repository has no branch. Do not invent one.
        branch: data.git_branch ?? '',
        isolation: data.isolation,
        agent: data.agent_key ?? 'shell',
        agentName: data.agent_name ?? undefined,
        credentials: data.credentials ?? [false, false, false],
      }));
    });

    return () => {
      unbindPty();
      unbindTele();
    };
  }, []);

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

  // Node & Group Creation / Navigation / Renaming
  const handleCreateNode = (groupId: string, kind: SessionNode['kind'] = 'terminal') => {
    const newNodeId = `node-${Date.now()}`;
    const existingNumbers = Object.values(workspace.nodes)
      .filter((n) => n.kind === kind)
      .map((n) => {
        const match = n.title.match(/(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      });
    const maxIdx = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
    const nextIdx = maxIdx + 1;
    const kindLabel =
      kind === 'terminal' ? 'Terminal' : kind === 'agent' ? 'Agent' : kind === 'scratchpad' ? 'Notes' : 'Session';
    const group = workspace.groups.find((g) => g.id === groupId) || activeGroup;

    const newNode: SessionNode = {
      id: newNodeId,
      groupId: group.id,
      title: `${kindLabel} ${nextIdx}`,
      kind,
      cwd: telemetry.cwd || '~/Projects/Doom Term',
      gitBranch: telemetry.branch || 'main',
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

  const handleRenameNode = (nodeId: string, newTitle: string) => {
    setWorkspace((prev) => {
      const node = prev.nodes[nodeId];
      if (!node) return prev;
      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [nodeId]: {
            ...node,
            title: newTitle,
          },
        },
      };
    });
    audioEngine.playSound('click', 3);
  };

  const handleRenameGroup = (groupId: string, newName: string) => {
    setWorkspace((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => (g.id === groupId ? { ...g, name: newName } : g)),
    }));
    audioEngine.playSound('click', 3);
  };

  const handleOpenWorkspaceFolder = (folderPath: string, name?: string) => {
    const newWs = createWorkspaceForFolder(folderPath, name);
    setWorkspace(newWs);
    SessionStore.saveWorkspace(newWs);
    const activeNodeId = Object.keys(newWs.nodes)[0];
    if (activeNodeId) {
      ptyClient.setActiveSession(activeNodeId);
      ptyClient.spawnSession(activeNodeId, 120, 30, folderPath);
      ptyClient.requestTelemetry(folderPath);
    }
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

      // Ctrl+O: Open Workspace Folder
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        setIsWorkspaceModalOpen(true);
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
      id: 'open-workspace',
      category: 'Workspace',
      title: 'Open / Select Workspace Folder…',
      shortcut: 'Ctrl+O',
      run: () => setIsWorkspaceModalOpen(true),
    },
    {
      id: 'rename-session',
      category: 'Session',
      title: 'Rename Active Session',
      run: () => {
        if (activeNode) {
          const newName = prompt('Enter new session name:', activeNode.title);
          if (newName && newName.trim()) {
            handleRenameNode(activeNode.id, newName.trim());
          }
        }
      },
    },
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
      category: 'Session',
      title: 'Copy Session Transcript',
      run: () => {
        if (activeNode) {
          const text = formatNodeTranscript(activeNode);
          navigator.clipboard.writeText(text);
          audioEngine.playSound('click', 3);
        }
      },
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
          onRenameSession={handleRenameNode}
        />

        {/* Actions Menu */}
        <div className="flex items-center gap-1">
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
            onSetGroupLayout={handleSetGroupLayout}
            onCloseNode={handleCloseNode}
            onOpenWorkspace={() => setIsWorkspaceModalOpen(true)}
            onRenameNode={handleRenameNode}
            onRenameGroup={handleRenameGroup}
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
