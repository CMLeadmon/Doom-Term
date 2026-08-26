import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ToolCall } from './ToolCall';

describe('ToolCall', () => {
  it('names the verb, not the function that ran', () => {
    render(<ToolCall call={{ verb: 'EDIT', target: 'src/pty/demux.rs', added: 42, removed: 18 }} />);
    expect(screen.getByText('EDIT')).toBeTruthy();
  });

  it('colours added and removed counts separately', () => {
    const { container } = render(<ToolCall call={{ verb: 'EDIT', target: 'x.rs', added: 42, removed: 18 }} />);
    expect(container.querySelector('[data-add]')?.textContent).toBe('+42');
    expect(container.querySelector('[data-del]')?.textContent).toBe('−18');
  });

  it('only a live row is gold', () => {
    const { container: live } = render(<ToolCall call={{ verb: 'SHELL', target: 'cargo test', live: true }} />);
    const { container: done } = render(<ToolCall call={{ verb: 'SHELL', target: 'cargo test' }} />);
    expect(live.querySelector('[data-verb]')?.getAttribute('data-live')).toBe('true');
    expect(done.querySelector('[data-verb]')?.getAttribute('data-live')).toBe('false');
  });
});
