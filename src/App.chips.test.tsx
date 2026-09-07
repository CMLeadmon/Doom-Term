import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * The three status chips, driven through the same handler a canvas click uses.
 *
 * `chipAtPoint()` returns 0 | 1 | 2 and the plate's hover text promises a
 * distinct action for each. That promise had never been tested: the red chip
 * had no branch at all, and the gold chip ran the red one's body as well —
 * toggling notifications AND stealing pane focus, with the second toast
 * overwriting the confirmation of the thing the user actually clicked.
 *
 * These render the real App and stand in for the canvas with three buttons, so
 * what is exercised is App's own dispatch rather than a copy of it.
 */
vi.mock('./components/StatusPlate', () => ({
  StatusPlate: (props: { onSelectChip?: (i: number) => void }) => (
    <div>
      {[0, 1, 2].map((i) => (
        <button key={i} type="button" data-testid={`chip-${i}`} onClick={() => props.onSelectChip?.(i)}>
          CHIP {i}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('./components/RawTerminalView', () => ({
  RawTerminalView: () => <button type="button" data-testid="raw-terminal">TERMINAL</button>,
}));

import { App } from './App';
import { ptyClient } from './core/ptyClient';
import { audioEngine } from './core/audioEngine';

/** See core/sessionStore.test.ts: window.localStorage is undefined by default here. */
let store: Map<string, string>;
let original: PropertyDescriptor | undefined;

beforeEach(() => {
  store = new Map();
  original = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  vi.spyOn(ptyClient, 'ensureSession').mockImplementation(() => {});
  vi.spyOn(audioEngine, 'playSound').mockImplementation(() => {});
});

afterEach(() => {
  if (original) Object.defineProperty(window, 'localStorage', original);
  else delete (window as unknown as Record<string, unknown>).localStorage;
  vi.restoreAllMocks();
});

const workspaceWith = (node: Record<string, unknown>) => JSON.stringify({
  workspaces: [{
    id: 'w', name: 'PROJ', rootPath: '/home/u/proj', activeGroupId: 'g',
    groups: [{
      id: 'g', projectId: 'w', name: 'Main Workstream', layout: 'single',
      activeNodeId: 'n1', nodeIds: ['n1', 'n2'],
      paneTree: { type: 'leaf', sessionId: 'n1' },
      createdAt: 1,
    }],
    nodes: {
      n1: {
        id: 'n1', groupId: 'g', title: 'Terminal 1', number: 1, kind: 'terminal',
        cwd: '/home/u/proj', gitBranch: '', activeBlockId: null, isTuiActive: false,
        agentState: 'idle', tuiLines: [], commandHistory: [], createdAt: 1,
      },
      n2: node,
    },
  }],
  activeWorkspaceId: 'w',
});

const healthyNode = {
  id: 'n2', groupId: 'g', title: 'Terminal 2', number: 2, kind: 'terminal',
  cwd: '/home/u/proj', gitBranch: '', activeBlockId: null, isTuiActive: false,
  agentState: 'idle', tuiLines: [], commandHistory: [], createdAt: 2,
};

const failedNode = { ...healthyNode, agentState: 'errored', lastExitCode: 127 };

// StrictMode, because main.tsx mounts under it: it is what double-invokes a
// state updater, and so what makes an impure one observable here.
/**
 * Which pane carries the focus border. Siblings stay mounted, so presence in
 * the DOM says nothing — the live-coloured 1px border is what the user reads
 * as "this one has the keyboard", and it is what a focus steal moves.
 */
const focusedPane = () =>
  screen.getAllByTestId('pane-leaf')
    .find((pane) => pane.style.border.includes('var(--st-live)'))
    ?.getAttribute('data-pane');

const renderApp = (node: Record<string, unknown> = healthyNode) => {
  store.set('DOOM_TERM_WORKSPACES_V2', workspaceWith(node));
  render(<StrictMode><App /></StrictMode>);
};

describe('status chips', () => {
  it('toggles only sound on the blue chip', () => {
    const toggleMute = vi.spyOn(audioEngine, 'toggleMute').mockReturnValue(true);
    renderApp();

    fireEvent.click(screen.getByTestId('chip-0'));

    expect(toggleMute).toHaveBeenCalledOnce();
    expect(screen.getByText(/SOUND FX: MUTED/)).toBeDefined();
  });

  it('toggles only notifications on the gold chip, without stealing pane focus', async () => {
    // The failing version toggled notifications and then also ran the red
    // chip's body, so asking for desktop alerts yanked the user onto an
    // unrelated errored session.
    renderApp(failedNode);
    expect(focusedPane()).toBe('n1');

    fireEvent.click(screen.getByTestId('chip-1'));

    expect(screen.getByText(/NOTIFICATIONS: DISABLED/)).toBeDefined();
    expect(focusedPane()).toBe('n1');
    await waitFor(() =>
      expect(store.get('doom-term-notifications-enabled')).toBe('false'));
  });

  it('does not open the execution mode modal from the notifications chip', () => {
    // Reachable from inside that modal, too: its own notifications toggle
    // used to route through this handler and re-open the modal it sat in.
    vi.spyOn(ptyClient, 'getIsConnected').mockReturnValue(true);
    renderApp();

    fireEvent.click(screen.getByTestId('chip-1'));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('persists exactly one notification flip per click', () => {
    // setToastMessage and the localStorage write used to live inside the
    // setState updater, which React runs twice under StrictMode.
    renderApp();
    const setItem = vi.spyOn(window.localStorage, 'setItem');

    fireEvent.click(screen.getByTestId('chip-1'));

    const flips = setItem.mock.calls
      .filter(([key]) => key === 'doom-term-notifications-enabled');
    expect(flips).toEqual([['doom-term-notifications-enabled', 'false']]);
  });

  it('jumps to a failed session on the red chip', () => {
    renderApp(failedNode);

    fireEvent.click(screen.getByTestId('chip-2'));

    expect(screen.getByText(/JUMPED TO FAILED SESSION \#2/)).toBeDefined();
    expect(focusedPane()).toBe('n2');
  });

  it('reconnects the daemon on the red chip when nothing has failed', () => {
    vi.spyOn(ptyClient, 'getIsConnected').mockReturnValue(false);
    const connect = vi.spyOn(ptyClient, 'connect').mockImplementation(() => {});
    renderApp();

    fireEvent.click(screen.getByTestId('chip-2'));

    expect(connect).toHaveBeenCalledOnce();
    expect(screen.getByText(/RECONNECTING TO PTY DAEMON\.\.\./)).toBeDefined();
  });

  it('reports health on the red chip without opening an unrelated modal', () => {
    vi.spyOn(ptyClient, 'getIsConnected').mockReturnValue(true);
    renderApp();

    fireEvent.click(screen.getByTestId('chip-2'));

    expect(screen.getByText(/SYSTEM HEALTH: ALL SERVICES OPERATIONAL/)).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
