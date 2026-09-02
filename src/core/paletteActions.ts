import { CommandPaletteAction } from '../components/CommandPalette';
import { SessionGroup, SessionNode, SplitLayoutMode } from '../types/sessionTree';
import { audioEngine } from './audioEngine';
import { BINDINGS, type AppAction } from './keymap';
import { formatNodeTranscript } from './transcript';
import { previewSession, rankSessions, sessionSearchText } from './sessionSwitcher';
import { enableSessionNotifications } from '../hooks/useSessionNotifications';

export interface PaletteContext {
  activeGroup: SessionGroup;
  activeNode: SessionNode | undefined;
  workspaceName: string;
  /** Every session in the active group, so the palette can switch between them. */
  nodes: SessionNode[];
  setIsWorkspaceModalOpen: (next: boolean) => void;
  onCreateNode: (groupId: string, kind: SessionNode['kind']) => void;
  onRenameNode: (nodeId: string, title: string) => void;
  onSetGroupLayout: (groupId: string, layout: SplitLayoutMode) => void;
  onSelectNode: (nodeId: string) => void;
}

/**
 * The chord for an action, as the keymap actually binds it.
 *
 * Read rather than written out, because the two drifted: the palette printed
 * `CTRL+O` and `CTRL+M` for a fortnight after neither opened a folder or muted
 * anything, and Ctrl+M could not have been bound at all — it is the Enter key.
 */
const chordFor = (action: AppAction): string | undefined =>
  BINDINGS.find((b) => b.action === action)?.label;

/**
 * How a session's agent reads in a list.
 *
 * The key, not a display name: the daemon sends the vendor's key and the plate
 * owns the long-form name. Blocked-on-you leads, because it is the one thing
 * that should make you pick that session next.
 */
function agentLabel(node: SessionNode): string {
  const parts = [];
  if (node.foregroundAgent) parts.push(`· ${node.foregroundAgent.toUpperCase()}`);
  if (node.blockedOnUser) parts.push('· ASKS');
  return parts.join(' ');
}

/**
 * Everything the command palette can do.
 *
 * This is the only home for actions that have no on-screen control — the
 * design system has no header row, so the palette and the keyboard are where
 * layout, the sidebar and the workspace picker live.
 */
export function buildPaletteActions(ctx: PaletteContext): CommandPaletteAction[] {
  const {
    activeGroup,
    activeNode,
    nodes,
    workspaceName,
    setIsWorkspaceModalOpen,
    onCreateNode,
    onRenameNode,
    onSetGroupLayout,
    onSelectNode,
  } = ctx;

  /*
    Sessions first, and one row each.

    Ctrl+K is described to a new user as "sessions, and every other command",
    and with no tab strip and no sidebar this list is the only place a session
    can be seen and chosen with the eyes rather than recalled by number. They
    lead because switching is the thing you do most.
  */
  const sessions: CommandPaletteAction[] = rankSessions(nodes)
    .map((node) => ({
      id: `goto-${node.id}`,
      category: 'Session',
      /*
        The number, the name, and WHAT IS RUNNING IN IT.

        Names are derived from the directory leaf, so three sessions opened in
        one place are three rows all reading the same word — which is exactly
        the multi-agent case this list exists to serve, and precisely where it
        was useless. The foreground agent is the thing that actually
        distinguishes them, and the terminal already knows it from the kernel.
      */
      title: [`${node.number ?? '-'}.`, node.title, agentLabel(node)]
        .filter(Boolean)
        .join(' '),
      // The same number Ctrl+N uses, so the list teaches the chord.
      shortcut: node.number ? `CTRL+${node.number}` : undefined,
      searchText: sessionSearchText(node, workspaceName),
      preview: previewSession(node, 4),
      attention: Boolean(node.blockedOnUser),
      run: () => onSelectNode(node.id),
    }));

  return [
    ...sessions,
    {
      id: 'enable-notifications',
      category: 'System',
      title: 'Enable Desktop Notifications',
      run: () => void enableSessionNotifications(),
    },
    {
      id: 'open-workspace',
      category: 'Workspace',
      title: 'Open / Select Workspace Folder…',
      shortcut: chordFor('openWorkspace'),
      run: () => setIsWorkspaceModalOpen(true),
    },
    {
      id: 'rename-session',
      category: 'Session',
      title: 'Rename Active Session',
      run: () => {
        if (!activeNode) return;
        const newName = prompt('Enter new session name:', activeNode.title);
        if (newName && newName.trim()) onRenameNode(activeNode.id, newName.trim());
      },
    },
    {
      id: 'new-term',
      category: 'Session',
      title: 'New Terminal Session',
      shortcut: chordFor('newSession'),
      run: () => onCreateNode(activeGroup.id, 'terminal'),
    },
    {
      id: 'new-agent',
      category: 'Agent',
      title: 'Spawn AI Agent Session',
      run: () => onCreateNode(activeGroup.id, 'agent'),
    },
    {
      id: 'new-scratchpad',
      category: 'Notes',
      title: 'Open Markdown Scratchpad',
      run: () => onCreateNode(activeGroup.id, 'scratchpad'),
    },
    {
      id: 'copy-transcript',
      category: 'Session',
      title: 'Copy Session Transcript',
      run: () => {
        if (!activeNode) return;
        navigator.clipboard.writeText(formatNodeTranscript(activeNode));
        audioEngine.playSound('click', 3);
      },
    },
    {
      id: 'layout-single',
      category: 'Layout',
      title: 'Layout: Single Full Pane',
      run: () => onSetGroupLayout(activeGroup.id, 'single'),
    },
    {
      id: 'layout-split-v',
      category: 'Layout',
      title: 'Layout: Split Vertical (2 Panes)',
      run: () => onSetGroupLayout(activeGroup.id, 'split-v'),
    },
    {
      id: 'layout-grid',
      category: 'Layout',
      title: 'Layout: 2x2 Quad Grid',
      run: () => onSetGroupLayout(activeGroup.id, 'grid-2x2'),
    },
    {
      id: 'toggle-audio',
      category: 'Audio',
      title: 'Toggle Sound Effects',
      shortcut: chordFor('toggleAudio'),
      run: () => audioEngine.toggleMute(),
    },
  ];
}
