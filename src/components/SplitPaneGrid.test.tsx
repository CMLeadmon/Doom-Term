import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SplitPaneGrid } from './SplitPaneGrid';
import { SessionNode } from '../types/sessionTree';
import { treeFromLayout } from '../core/paneTree';

const node = (id: string, title: string, number: number | null = 1): SessionNode => ({
  id,
  groupId: 'g1',
  title,
  number,
  kind: 'terminal',
  cwd: '/test',
  gitBranch: 'main',
  activeBlockId: null,
  isTuiActive: false,
  agentState: 'idle',
  tuiLines: [],
  commandHistory: [],
  createdAt: 1000,
});

const nodes = [node('n1', 'One'), node('n2', 'Two')];

const renderGrid = (activeNodeId: string) =>
  render(
    <SplitPaneGrid
      layout="single"
      nodes={nodes}
      activeNodeId={activeNodeId}
      onSelectNode={vi.fn()}
      renderPane={(n) => <div>Pane: {n.title}</div>}
    />
  );

/** The visibility-toggling wrapper this pane is rendered inside. */
const paneBox = (title: string): HTMLElement =>
  screen.getByText(`Pane: ${title}`).closest('[data-pane]') as HTMLElement;

describe('SplitPaneGrid single layout', () => {
  it('mounts every pane, not only the active one', () => {
    // A tab switch used to unmount the inactive pane and rebuild the other from
    // state, throwing away its DOM, scroll position and focus.
    renderGrid('n1');
    expect(screen.getByText('Pane: One')).toBeDefined();
    expect(screen.getByText('Pane: Two')).toBeDefined();
  });

  it('shows only the active pane', () => {
    renderGrid('n1');
    expect(paneBox('One').style.visibility).toBe('visible');
    expect(paneBox('Two').style.visibility).toBe('hidden');
  });

  it('does not let a hidden pane take the mouse', () => {
    renderGrid('n1');
    expect(paneBox('Two').style.pointerEvents).toBe('none');
  });

  it('falls back to the first pane when the active id matches nothing', () => {
    renderGrid('gone');
    expect(paneBox('One').style.visibility).toBe('visible');
  });
});

describe('SplitPaneGrid persistent tree', () => {
  it('renders the recursive leaf order from a persisted tree', () => {
    render(
      <SplitPaneGrid
        layout="single"
        paneTree={treeFromLayout('split-v', ['n2', 'n1'])!}
        nodes={nodes}
        activeNodeId="n2"
        onSelectNode={vi.fn()}
        renderPane={(n) => <div>Tree: {n.title}</div>}
      />,
    );
    expect(screen.getAllByTestId('pane-leaf').map((leaf) => leaf.getAttribute('data-pane')))
      .toEqual(['n2', 'n1']);
  });
});
