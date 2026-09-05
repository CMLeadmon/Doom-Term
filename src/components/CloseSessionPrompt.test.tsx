import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CloseSessionPrompt } from './CloseSessionPrompt';

describe('CloseSessionPrompt', () => {
  it('defaults Enter to parking, with kill remaining explicit', () => {
    const onPark = vi.fn();
    const onKill = vi.fn();
    render(<CloseSessionPrompt title="INDEXER" durable onPark={onPark} onKill={onKill} onCancel={() => undefined} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onPark).toHaveBeenCalledOnce();
    expect(onKill).not.toHaveBeenCalled();
    expect(screen.getByText(/keeps running/i)).toBeTruthy();
  });

  it('warns about a session it KNOWS is not durable', () => {
    render(
      <CloseSessionPrompt
        title="INDEXER"
        durable={false}
        onPark={() => undefined}
        onKill={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByText(/SURVIVES ONLY WHILE THIS DAEMON RUNS/i)).toBeTruthy();
  });

  it('renders unknown durability as unknown, not as a warning', () => {
    // `mode?.durable ?? false` used to coerce "the daemon has not said yet"
    // into a confident claim that parking would not survive — on the one
    // screen where the user is deciding whether keeping the process is safe.
    render(
      <CloseSessionPrompt
        title="INDEXER"
        durable={null}
        onPark={() => undefined}
        onKill={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.queryByText(/SURVIVES ONLY WHILE THIS DAEMON RUNS/i)).toBeNull();
    expect(screen.getByText(/PARK DURABILITY --/)).toBeTruthy();
  });
});
