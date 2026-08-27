import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TabBar } from './TabBar';
import { SessionTab } from '../types/terminal';

const mockSessions: SessionTab[] = [
  {
    id: 's1',
    title: 'Terminal 1',
    cwd: '/home/marine/Projects/Doom Term',
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
    cwd: '/home/marine/Projects/Doom Term/backend',
    gitBranch: 'feature/pty',
    activeBlockId: null,
    isTuiActive: true,
    blocks: [],
    tuiLines: [],
    commandHistory: [],
    createdAt: 2000,
  },
];

describe('TabBar', () => {
  it('renders all terminal tabs with display numbers and branch badges', () => {
    render(
      <TabBar
        sessions={mockSessions}
        activeSessionId="s1"
        onSelectSession={() => {}}
        onNewSession={() => {}}
        onCloseSession={() => {}}
      />
    );

    expect(screen.getByText('1:')).toBeTruthy();
    expect(screen.getByText('2:')).toBeTruthy();
    expect(screen.getByText('Doom Term')).toBeTruthy();
    expect(screen.getByText('backend')).toBeTruthy();
    expect(screen.getByText('feature/pty')).toBeTruthy();
  });

  it('triggers onSelectSession when clicking inactive tab', () => {
    const onSelect = vi.fn();
    render(
      <TabBar
        sessions={mockSessions}
        activeSessionId="s1"
        onSelectSession={onSelect}
        onNewSession={() => {}}
        onCloseSession={() => {}}
      />
    );

    fireEvent.click(screen.getByText('backend'));
    expect(onSelect).toHaveBeenCalledWith('s2');
  });

  it('triggers onNewSession when clicking + button', () => {
    const onNew = vi.fn();
    render(
      <TabBar
        sessions={mockSessions}
        activeSessionId="s1"
        onSelectSession={() => {}}
        onNewSession={onNew}
        onCloseSession={() => {}}
      />
    );

    fireEvent.click(screen.getByText('NEW'));
    expect(onNew).toHaveBeenCalledOnce();
  });

  it('triggers onCloseSession when clicking close button', () => {
    const onClose = vi.fn();
    render(
      <TabBar
        sessions={mockSessions}
        activeSessionId="s1"
        onSelectSession={() => {}}
        onNewSession={() => {}}
        onCloseSession={onClose}
      />
    );

    const closeButtons = screen.getAllByLabelText('Close terminal tab');
    expect(closeButtons.length).toBe(2);
    fireEvent.click(closeButtons[1]);
    expect(onClose).toHaveBeenCalledWith('s2');
  });
});
