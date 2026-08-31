import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TabBar } from './TabBar';
import { SessionTab } from '../types/terminal';

const mockSessions: SessionTab[] = [
  {
    id: 's1',
    title: 'Terminal 1',
    cwd: '/home/u/Projects/Doom Term',
    gitBranch: 'main',
    activeBlockId: null,
    isTuiActive: false,
    blocks: [],
    tuiLines: [],
    commandHistory: [],
    createdAt: 1000,
  },
  {
    id: 's2',
    title: 'Terminal 2',
    cwd: '/home/u/Projects/Doom Term/backend',
    gitBranch: 'feature/pty',
    activeBlockId: null,
    isTuiActive: true,
    blocks: [],
    tuiLines: [],
    commandHistory: [],
    createdAt: 2000,
  },
];

const baseProps = {
  sessions: mockSessions,
  activeSessionId: 's1',
  cwd: '~/Projects/Doom Term',
  branch: 'main',
  onSelectSession: vi.fn(),
  onNewSession: vi.fn(),
  onCloseSession: vi.fn(),
  onRenameSession: vi.fn(),
};

describe('TabBar', () => {
  it('presses the active tab in rather than raising it', () => {
    render(<TabBar {...baseProps} activeSessionId="s1" />);
    const active = screen.getByRole('tab', { name: /Terminal 1/ });
    expect(active.getAttribute('aria-selected')).toBe('true');
    expect(active.className).toContain('bev-dn');
    expect(active.className).not.toContain('bev-up');
  });

  // Closing used to be middle-click and Ctrl+W only. Neither is discoverable,
  // so there was no way to close a session from the UI at all.
  it('offers a close control on every tab', () => {
    const onClose = vi.fn();
    render(<TabBar {...baseProps} onCloseSession={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close terminal 2/i }));
    expect(onClose).toHaveBeenCalledWith('s2');
  });

  it('does not offer to close the last remaining session', () => {
    // Closing it would leave no pane and nothing to click.
    render(<TabBar {...baseProps} sessions={[mockSessions[0]]} activeSessionId="s1" />);
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull();
  });

  it('does not select the tab when its close control is clicked', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<TabBar {...baseProps} onSelectSession={onSelect} onCloseSession={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close terminal 2/i }));
    expect(onClose).toHaveBeenCalledWith('s2');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('still closes on middle-click', () => {
    const onClose = vi.fn();
    render(<TabBar {...baseProps} onCloseSession={onClose} />);
    // fireEvent has no auxClick helper, so dispatch the event React listens for.
    fireEvent(
      screen.getByRole('tab', { name: /Terminal 1/ }),
      new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true })
    );
    expect(onClose).toHaveBeenCalledWith('s1');
  });

  // A tab now contains a real close button, so the tab itself cannot be a
  // button — nesting one inside another is invalid. It carries the keyboard
  // contract explicitly instead.
  it('keeps every tab reachable from the keyboard', () => {
    const onSelect = vi.fn();
    render(<TabBar {...baseProps} onSelectSession={onSelect} />);
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.getAttribute('tabindex')).toBe('0');
    }
    fireEvent.keyDown(screen.getByRole('tab', { name: /Terminal 2/ }), { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('s2');
  });

  it('opens the command palette from the strip', () => {
    // The palette is the only route to layout, the sidebar and the workspace
    // picker, and it had no on-screen control of any kind.
    const onOpen = vi.fn();
    render(<TabBar {...baseProps} onOpenPalette={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /command palette/i }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('right-aligns the path and branch on the strip', () => {
    render(<TabBar {...baseProps} cwd="~/Projects/Doom Term" branch="main" />);
    expect(screen.getByText('~/PROJECTS/DOOM TERM')).toBeDefined();
    expect(screen.getByText('MAIN')).toBeDefined();
  });

  it('selects an inactive tab on click', () => {
    const onSelect = vi.fn();
    render(<TabBar {...baseProps} onSelectSession={onSelect} />);
    fireEvent.click(screen.getByRole('tab', { name: /Terminal 2/ }));
    expect(onSelect).toHaveBeenCalledWith('s2');
  });

  it('opens a new session from the strip', () => {
    const onNew = vi.fn();
    render(<TabBar {...baseProps} onNewSession={onNew} />);
    fireEvent.click(screen.getByRole('button', { name: /new session/i }));
    expect(onNew).toHaveBeenCalledOnce();
  });

  it('renames a tab on double click', () => {
    const onRename = vi.fn();
    render(<TabBar {...baseProps} onRenameSession={onRename} />);
    fireEvent.doubleClick(screen.getByRole('tab', { name: /Terminal 2/ }));
    const input = screen.getByLabelText('Rename session');
    fireEvent.change(input, { target: { value: 'deploy' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('s2', 'deploy');
  });
});
