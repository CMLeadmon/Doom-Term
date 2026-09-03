import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { RawTerminalView } from './RawTerminalView';
import { CloseSessionPrompt } from './CloseSessionPrompt';
import { PaneSelectOverlay } from './PaneSelectOverlay';
import { paneLeaf, splitLeaf } from '../core/paneTree';

/**
 * The defect these cover is one of event OWNERSHIP, so they have to start where
 * the user's keystroke actually starts: at the focused terminal, with the
 * overlay mounted above it.
 *
 * The suites for these two overlays fired at `window` directly, which is the
 * one place the bug could not appear — it skipped the terminal that was
 * swallowing the event and stopping it before `window` ever saw it. Both
 * passed while neither overlay could be operated by hand.
 */

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});

const terminal = {
  lines: [],
  onSendSignal: vi.fn(),
};

describe('PARK/KILL gate over a focused terminal', () => {
  it('takes Enter for the safe default instead of sending it to the process', () => {
    // The unsafe version of this: the user sees a destructive-action prompt,
    // presses Enter expecting PARK, and Enter is written to the live process
    // underneath as \r. Nothing parks, and the shell runs whatever was on its
    // command line.
    const onWrite = vi.fn();
    const onPark = vi.fn();
    const onKill = vi.fn();
    render(
      <>
        <RawTerminalView {...terminal} onWrite={onWrite} isActive />
        <CloseSessionPrompt
          title="INDEXER"
          durable
          onPark={onPark}
          onKill={onKill}
          onCancel={() => undefined}
        />
      </>,
    );

    const term = screen.getByTestId('raw-terminal');
    expect(document.activeElement).toBe(term);

    fireEvent.keyDown(term, { key: 'Enter' });

    expect(onPark).toHaveBeenCalledOnce();
    expect(onKill).not.toHaveBeenCalled();
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('moves the choice to KILL on its own key without typing it into the shell', () => {
    const onWrite = vi.fn();
    const onPark = vi.fn();
    const onKill = vi.fn();
    render(
      <>
        <RawTerminalView {...terminal} onWrite={onWrite} isActive />
        <CloseSessionPrompt
          title="INDEXER"
          durable
          onPark={onPark}
          onKill={onKill}
          onCancel={() => undefined}
        />
      </>,
    );

    const term = screen.getByTestId('raw-terminal');
    fireEvent.keyDown(term, { key: 'k' });
    fireEvent.keyDown(term, { key: 'Enter' });

    expect(onKill).toHaveBeenCalledOnce();
    expect(onPark).not.toHaveBeenCalled();
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('cancels on Escape rather than sending ESC to the process', () => {
    const onWrite = vi.fn();
    const onCancel = vi.fn();
    render(
      <>
        <RawTerminalView {...terminal} onWrite={onWrite} isActive />
        <CloseSessionPrompt
          title="INDEXER"
          durable
          onPark={() => undefined}
          onKill={() => undefined}
          onCancel={onCancel}
        />
      </>,
    );

    fireEvent.keyDown(screen.getByTestId('raw-terminal'), { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onWrite).not.toHaveBeenCalled();
  });
});

describe('direct pane labels over a focused terminal', () => {
  const tree = splitLeaf(paneLeaf('alpha'), 'alpha', 'beta', 'row');

  it('selects the labelled pane instead of typing its letter', () => {
    const onWrite = vi.fn();
    const onSelect = vi.fn();
    render(
      <>
        <RawTerminalView {...terminal} onWrite={onWrite} isActive />
        <PaneSelectOverlay tree={tree} onSelect={onSelect} onClose={() => undefined} />
      </>,
    );

    // Labels run along the home row, so the second leaf is 's'.
    fireEvent.keyDown(screen.getByTestId('raw-terminal'), { key: 's' });

    expect(onSelect).toHaveBeenCalledWith('beta');
    expect(onWrite).not.toHaveBeenCalled();
  });

  it('leaves the process alone for a key that labels nothing', () => {
    // Half-swallowing is its own bug: a stray key during a transient mode is
    // not input for the shell either.
    const onWrite = vi.fn();
    const onSelect = vi.fn();
    render(
      <>
        <RawTerminalView {...terminal} onWrite={onWrite} isActive />
        <PaneSelectOverlay tree={tree} onSelect={onSelect} onClose={() => undefined} />
      </>,
    );

    fireEvent.keyDown(screen.getByTestId('raw-terminal'), { key: 'z' });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onWrite).not.toHaveBeenCalled();
  });
});

describe('after the surface closes', () => {
  it('hands the keyboard back to the process', () => {
    const onWrite = vi.fn();
    const { rerender } = render(
      <>
        <RawTerminalView {...terminal} onWrite={onWrite} isActive />
        <CloseSessionPrompt
          title="INDEXER"
          durable
          onPark={() => undefined}
          onKill={() => undefined}
          onCancel={() => undefined}
        />
      </>,
    );

    const term = screen.getByTestId('raw-terminal');
    fireEvent.keyDown(term, { key: 'h' });
    expect(onWrite).not.toHaveBeenCalled();

    rerender(<RawTerminalView {...terminal} onWrite={onWrite} isActive />);

    fireEvent.keyDown(screen.getByTestId('raw-terminal'), { key: 'h' });
    expect(onWrite).toHaveBeenCalledWith('h');
  });
});
