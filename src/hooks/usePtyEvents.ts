import { useEffect } from 'react';
import { ProjectWorkspace, SessionNode } from '../types/sessionTree';
import { TerminalBlock, AnsiLine } from '../types/terminal';
import { getEmulator, onScreenParsed } from '../core/emulatorRegistry';
import { noteOutput } from '../core/activityMonitor';
import { ptyClient } from '../core/ptyClient';
import { audioEngine } from '../core/audioEngine';
import { type AppTelemetry } from '../hud/state';

type WorkspaceUpdater = (updater: (prev: ProjectWorkspace) => ProjectWorkspace) => void;
type TelemetryUpdater = (updater: (prev: AppTelemetry) => AppTelemetry) => void;

/**
 * Which source decides whether the pane is full-screen.
 *
 * The screen model is the default and is right without tmux. Under tmux it is
 * structurally blind: the client is kept out of the alternate buffer on purpose
 * so scrollback and command blocks keep working, so a full-screen program in
 * the pane never touches our buffer type. When the daemon has reported a state,
 * it is the only one that saw the truth.
 */
export function resolveTuiState(
  screenSaysAlt: boolean,
  daemonReported: boolean | undefined
): boolean {
  return daemonReported ?? screenSaysAlt;
}

/**
 * The last full-screen state the daemon reported, per session.
 *
 * Module scope rather than hook state: the value is read inside the parsed-frame
 * handler, which must not re-subscribe every time it changes.
 */
const reportedTuiState = new Map<string, boolean>();

/**
 * Put the session's screen where the one view will read it.
 *
 * There used to be a fork here. An alt-screen program or an inline agent got
 * the screen's own grid; ANYTHING ELSE got a re-read slice of scrollback from
 * a mark, because "anything else" was drawn by the block editor.
 *
 * Deleting the block editor left that second branch feeding a view that no
 * longer exists, and a plain shell rendered a completely blank terminal. There
 * is one view now, so there is one destination: whatever the screen says.
 *
 * Pure and exported so the routing is testable without a registry, a socket or
 * a DOM — the fork above was inline, which is exactly why nothing caught it.
 */
export function applyScreenToNode(
  node: SessionNode,
  lines: AnsiLine[],
  inAltScreen: boolean,
): SessionNode {
  return { ...node, isTuiActive: inAltScreen, tuiLines: lines };
}

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
        // Feed the session's own screen. It owns cursor position, colour state
        // and the grid, so a chunk boundary landing mid-escape or mid-row no
        // longer corrupts anything.
        //
        // Parsing is ASYNCHRONOUS, so the render happens in the onScreenParsed
        // handler below rather than here — reading the buffer on the next line
        // would read the previous frame's content.
        getEmulator(sessionId).write(rawChunk);

        // Recorded here, not in the updater: React may run an updater late or
        // more than once, and the mark's pulse is timed off this. It lives
        // outside React state because a PTY chunk must not write to storage.
        noteOutput(sessionId);
      },

      /**
       * An agent told us it is blocked on a human, through its own hook.
       *
       * This is the OTHER half of the approval gate we deleted. The gate both
       * decided whether a command could run and told you something needed
       * attention; only the deciding is gone. In pass-through the app never
       * sees the command, but the vendor will happily tell us it has stopped —
       * and that is the single most valuable thing the terminal can know about
       * a session nobody is looking at.
       *
       * Correlated by cwd because the hook fires in the AGENT's process, which
       * knows its own directory and nothing about our node ids. Two sessions in
       * one directory are indistinguishable here; that is a known limit and is
       * why the daemon forwards the agent's own session id for a later, exact
       * correlation.
       */
      onAgentEvent: ({ event, cwd }) => {
        const blocked = event === 'PermissionRequest';
        const cleared = event === 'Stop';
        if (!blocked && !cleared) return;
        setWorkspace((prev) => {
          const match = Object.values(prev.nodes).find((n) => cwd && n.cwd === cwd);
          if (!match) return prev;
          if (!!match.blockedOnUser === blocked) return prev;
          return {
            ...prev,
            nodes: { ...prev.nodes, [match.id]: { ...match, blockedOnUser: blocked } },
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

      onTuiMode: (active, sessionId) => {
        // Recorded per session, because under tmux this arrives from a poll
        // that runs for background panes too — attributing it to whichever tab
        // is on screen would flip the wrong pane into grid mode.
        reportedTuiState.set(sessionId, active);
        setWorkspace((prev) => {
          const target = prev.nodes[sessionId];
          if (!target) return prev;

          return {
            ...prev,
            nodes: {
              ...prev.nodes,
              [sessionId]: { ...target, isTuiActive: active },
            },
          };
        });
        // Only for the pane on screen. The tmux poll reports background panes
        // too, and a sound for something the user cannot see is noise.
        if (active && sessionId === ptyClient.getSessionId()) {
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

    // One render per frame per session, however many chunks arrived in it. The
    // previous shape ran a full React update over the whole scrollback for
    // every 8KB chunk the daemon delivered.
    const unbindParsed = onScreenParsed((sessionId) => {
      const emu = getEmulator(sessionId);
      const inAltScreen = resolveTuiState(emu.isAltScreen(), reportedTuiState.get(sessionId));

      setWorkspace((prev) => {
        const target = prev.nodes[sessionId];
        if (!target) return prev;

        const updatedNode = applyScreenToNode(target, emu.getLines(), inAltScreen);

        return {
          ...prev,
          nodes: {
            ...prev.nodes,
            [updatedNode.id]: updatedNode,
          },
        };
      });
    });

    const unbindTele = ptyClient.onTelemetry((data) => {
      // The kernel's answer about who holds this session's keyboard, pinned to
      // the session that asked. Without the echoed id a reply that lands after
      // a tab switch would put the previous tab's agent on this one, and with
      // it the pass-through mode that agent needs.
      if (data.session_id) {
        const sessionId = data.session_id;
        const agentKey = data.agent_key ?? null;
        setWorkspace((prev) => {
          const target = prev.nodes[sessionId];
          if (!target || (target.foregroundAgent ?? null) === agentKey) return prev;
          return {
            ...prev,
            nodes: { ...prev.nodes, [sessionId]: { ...target, foregroundAgent: agentKey } },
          };
        });
      }

      setTelemetry((prev) => ({
        ...prev,
        cwd: data.current_dir,
        // A directory that is not a repository has no branch. Do not invent one.
        branch: data.git_branch ?? '',
        isolation: data.isolation,
        agent: data.agent_key ?? 'shell',
        agentName: data.agent_name ?? undefined,
        credentials: data.credentials ?? [false, false, false],
        // null means the daemon could not observe it. Leave it undefined so
        // pct() renders '--'; `?? 0` here would invent a fresh quota.
        rateUsed: data.rate_used ?? undefined,
        contextUsed: data.context_used ?? undefined,
        model: data.agent_model ?? undefined,
      }));
    });

    return () => {
      unbindPty();
      unbindParsed();
      unbindTele();
    };
  }, []);

}
