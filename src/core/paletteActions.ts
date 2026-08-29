import { CommandPaletteAction } from '../components/CommandPalette';
import { SessionGroup, SessionNode, SplitLayoutMode } from '../types/sessionTree';
import { audioEngine } from './audioEngine';
import { formatNodeTranscript } from './transcript';

export interface PaletteContext {
  activeGroup: SessionGroup;
  activeNode: SessionNode | undefined;
  showTree: boolean;
  setShowTree: (next: boolean) => void;
  setIsWorkspaceModalOpen: (next: boolean) => void;
  onCreateNode: (groupId: string, kind: SessionNode['kind']) => void;
  onRenameNode: (nodeId: string, title: string) => void;
  onSetGroupLayout: (groupId: string, layout: SplitLayoutMode) => void;
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
    showTree,
    setShowTree,
    setIsWorkspaceModalOpen,
    onCreateNode,
    onRenameNode,
    onSetGroupLayout,
  } = ctx;

  return [
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
        if (!activeNode) return;
        const newName = prompt('Enter new session name:', activeNode.title);
        if (newName && newName.trim()) onRenameNode(activeNode.id, newName.trim());
      },
    },
    {
      id: 'new-term',
      category: 'Session',
      title: 'New Terminal Session',
      shortcut: 'Ctrl+Shift+T',
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
      id: 'toggle-tree',
      category: 'View',
      title: 'Toggle Workspace Sidebar',
      shortcut: 'Ctrl+B',
      run: () => setShowTree(!showTree),
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
      shortcut: 'Ctrl+M',
      run: () => audioEngine.toggleMute(),
    },
  ];
}
