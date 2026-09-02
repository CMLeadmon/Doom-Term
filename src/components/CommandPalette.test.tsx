import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CommandPalette } from './CommandPalette';

describe('CommandPalette session context', () => {
  const actions = [
    { id: 'a', category: 'Session', title: 'INDEXER', searchText: 'hidden needle', preview: 'last\nthree\nlines', run: () => undefined },
    { id: 'b', category: 'Session', title: 'BUILDER', run: () => undefined },
  ];

  it('shows the selected action preview without changing sessions', () => {
    render(<CommandPalette isOpen onClose={() => undefined} actions={actions} />);
    expect(screen.getByLabelText('Session preview').textContent).toBe('last\nthree\nlines');
  });

  it('matches the hidden search corpus as well as the row title', () => {
    render(<CommandPalette isOpen onClose={() => undefined} actions={actions} />);
    fireEvent.change(screen.getByPlaceholderText('Type a command or search action...'), {
      target: { value: 'needle' },
    });
    expect(screen.getByText('INDEXER')).toBeTruthy();
    expect(screen.queryByText('BUILDER')).toBeNull();
  });
});
