import { useEffect } from 'react';
import { ProjectWorkspace, SessionNode } from '../types/sessionTree';
import { TerminalBlock } from '../types/terminal';
import { getEmulator } from '../core/emulatorRegistry';
import { ptyClient } from '../core/ptyClient';
import { audioEngine } from '../core/audioEngine';
import { type AppTelemetry } from '../hud/state';

type WorkspaceUpdater = (updater: (prev: ProjectWorkspace) => ProjectWorkspace) => void;
type TelemetryUpdater = (updater: (prev: AppTelemetry) => AppTelemetry) => void;

/**
 * Every subscription to the PTY daemon: terminal output, working directory,
 * command boundaries, full-screen mode and agent state, plus telemetry.
 *
 * Registered once for the lifetime of the app — the handlers reach the right
 * session through the id the daemon sends, not through anything captured here.
 */
export function usePtyEvents(setWorkspace: WorkspaceUpdater, setTelemetry: TelemetryUpdater) {
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
        // Sample the mark HERE, when OSC 133;C actually arrives — not inside
        // the updater below. React may run an updater late or more than once,
        // and by then output has landed, so the mark pointed past it and the
        // block rendered empty.
        const targetId = sessionId || ptyClient.getSessionId();
        const currentMark = getEmulator(targetId).mark();

        setWorkspace((prev) => {
          const currentNode = prev.nodes[targetId];
          if (!currentNode || !currentNode.activeBlockId) return prev;

          const emu = getEmulator(targetId);

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

}
