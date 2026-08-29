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

  it('puts no close button on any tab', () => {
    render(<TabBar {...baseProps} />);
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull();
    expect(screen.queryByText('×')).toBeNull();
  });

  it('closes on middle-click instead', () => {
    const onClose = vi.fn();
    render(<TabBar {...baseProps} onCloseSession={onClose} />);
    // fireEvent has no auxClick helper, so dispatch the event React listens for.
    fireEvent(
      screen.getByRole('tab', { name: /Terminal 1/ }),
      new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true })
    );
    expect(onClose).toHaveBeenCalledWith('s1');
  });

  it('keeps every tab reachable from the keyboard', () => {
    render(<TabBar {...baseProps} />);
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.tagName).toBe('BUTTON');
    }
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
