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
});
