import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SplitPaneGrid } from './SplitPaneGrid';
import { CommandPalette } from './CommandPalette';
import { Scratchpad } from './Scratchpad';
import { SessionNode } from '../types/sessionTree';

describe('SplitPaneGrid', () => {
  const mockNodes: SessionNode[] = [
    {
      id: 'n1',
      groupId: 'g1',
      title: 'Terminal 1',
      kind: 'terminal',
      cwd: '/test',
      gitBranch: 'main',
      activeBlockId: null,
      isTuiActive: false,
      agentState: 'idle',
      blocks: [],
      tuiLines: [],
      commandHistory: [],
      createdAt: 1000,
    },
    {
      id: 'n2',
      groupId: 'g1',
      title: 'Agent 2',
      kind: 'agent',
      cwd: '/test',
      gitBranch: 'main',
      activeBlockId: null,
      isTuiActive: false,
      agentState: 'running',
      blocks: [],
      tuiLines: [],
      commandHistory: [],
      createdAt: 1000,
    },
  ];

  it('mounts every pane in single mode and shows the active one', () => {
    const onSelect = vi.fn();
    render(
      <SplitPaneGrid
        layout="single"
        nodes={mockNodes}
        activeNodeId="n1"
        onSelectNode={onSelect}
        renderPane={(node) => <div>Pane: {node.title}</div>}
      />
    );

    expect(screen.getByText('Pane: Terminal 1')).toBeDefined();
    expect(screen.getByText('Pane: Agent 2')).toBeDefined();
  });

  it('renders multiple panes in vertical split', () => {
    const onSelect = vi.fn();
    render(
      <SplitPaneGrid
        layout="split-v"
        nodes={mockNodes}
        activeNodeId="n1"
        onSelectNode={onSelect}
        renderPane={(node) => <div>Pane: {node.title}</div>}
      />
    );

    expect(screen.getByText('Pane: Terminal 1')).toBeDefined();
    expect(screen.getByText('Pane: Agent 2')).toBeDefined();
  });
});

describe('CommandPalette', () => {
  it('filters actions based on query and executes picked action', () => {
    const runAction = vi.fn();
    const onClose = vi.fn();

    render(
      <CommandPalette
        isOpen={true}
        onClose={onClose}
        actions={[
          { id: '1', category: 'Session', title: 'New Terminal', run: runAction },
          { id: '2', category: 'Audio', title: 'Toggle Mute', run: vi.fn() },
        ]}
      />
    );

    expect(screen.getByText('COMMAND PALETTE')).toBeDefined();
    const input = screen.getByPlaceholderText('Type a command or search action...');
    fireEvent.change(input, { target: { value: 'New' } });

    expect(screen.getByText('New Terminal')).toBeDefined();
    expect(screen.queryByText('Toggle Mute')).toBeNull();

    fireEvent.click(screen.getByText('New Terminal'));
    expect(runAction).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Scratchpad', () => {
  it('supports viewing, editing, and copying note content', () => {
    const onSave = vi.fn();
    render(
      <Scratchpad
        title="Todo List"
        initialContent="- [x] Setup architecture"
        onSave={onSave}
      />
    );

    expect(screen.getByText('SCRATCHPAD: Todo List')).toBeDefined();
    expect(screen.getByText('- [x] Setup architecture')).toBeDefined();

    // Toggle edit mode
    const editBtn = screen.getByText('EDIT');
    fireEvent.click(editBtn);

    const textarea = screen.getByPlaceholderText('Write persistent notes, architecture tasks, or agent memories...');
    fireEvent.change(textarea, { target: { value: 'Updated content' } });
    expect(onSave).toHaveBeenCalledWith('Updated content');
  });
});
