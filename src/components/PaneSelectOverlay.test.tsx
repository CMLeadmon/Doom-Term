import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { treeFromLayout } from '../core/paneTree';
import { PaneSelectOverlay } from './PaneSelectOverlay';

describe('PaneSelectOverlay', () => {
  it('selects a pane by its transient tree label', () => {
    const onSelect = vi.fn();
    render(<PaneSelectOverlay tree={treeFromLayout('split-v', ['one', 'two'])!} onSelect={onSelect} onClose={() => undefined} />);
    expect(screen.getAllByText(/[AS]/)).toHaveLength(2);
    fireEvent.keyDown(window, { key: 's' });
    expect(onSelect).toHaveBeenCalledWith('two');
  });
});
