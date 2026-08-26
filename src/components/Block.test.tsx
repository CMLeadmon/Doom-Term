import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Block } from './Block';

const base = { id: 'b1', command: 'cargo build --release', startedAt: 0, liveLines: [] };

describe('Block', () => {
  it('caps the rail with the state colour', () => {
    const { container } = render(<Block block={{ ...base, status: 'error', exitCode: 101 }} />);
    expect(container.querySelector('[data-cap]')?.getAttribute('data-cap')).toBe('fail');
  });

  it('shows exit code and duration on the command line', () => {
    render(<Block block={{ ...base, status: 'error', exitCode: 101, durationMs: 3104 }} />);
    expect(screen.getByText(/EXIT 101/)).toBeTruthy();
    expect(screen.getByText(/3\.10S/)).toBeTruthy();
  });

  it('draws no border around output — the rail is the only structure', () => {
    const { container } = render(<Block block={{ ...base, status: 'completed', exitCode: 0 }} />);
    const body = container.querySelector('[data-body]') as HTMLElement;
    expect(body.className).not.toMatch(/border|rounded/);
  });
});
