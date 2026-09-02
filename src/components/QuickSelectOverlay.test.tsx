import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuickSelectOverlay } from './QuickSelectOverlay';

describe('QuickSelectOverlay', () => {
  it('selects by label and uses Enter/Shift+Enter as copy/insert', () => {
    const onSelect = vi.fn();
    render(<QuickSelectOverlay targets={[
      { label: 'a', type: 'issue', value: '#12', line: 0, start: 0, end: 3 },
      { label: 's', type: 'url', value: 'https://x.test', line: 1, start: 0, end: 14 },
    ]} onSelect={onSelect} onClose={() => undefined} />);
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyDown(window, { key: 'Enter', shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 'https://x.test' }), true);
    expect(screen.getByText(/SHIFT\+ENTER INSERT/)).toBeTruthy();
  });
});
