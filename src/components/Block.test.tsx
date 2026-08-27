import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Block } from './Block';
import type { AnsiSpan } from '../types/terminal';

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

const line = (spans: AnsiSpan[], isError = false) => ({
  id: 'l1',
  spans,
  isError,
  timestamp: 0,
});

describe('Block output styling', () => {
  it('keeps a span its own colour even when the row is flagged as an error', () => {
    const { container } = render(
      <Block
        block={{
          ...base,
          status: 'completed',
          liveLines: [line([{ text: 'match', fg: '#00ff41', bold: true }], true)],
        }}
      />
    );
    const span = screen.getByText('match') as HTMLElement;
    expect(span.style.color).toBe('rgb(0, 255, 65)');
    expect(container.textContent).toContain('match');
  });

  it('tints only the uncoloured parts of a flagged row', () => {
    render(
      <Block
        block={{
          ...base,
          status: 'completed',
          liveLines: [line([{ text: 'fatal: bad object' }], true)],
        }}
      />
    );
    expect((screen.getByText('fatal: bad object') as HTMLElement).style.color).toBe('var(--st-fail)');
  });

  it('renders inverse video by swapping foreground and background', () => {
    render(
      <Block
        block={{
          ...base,
          status: 'completed',
          liveLines: [line([{ text: 'selected', fg: '#00e5ff', invert: true }])],
        }}
      />
    );
    const span = screen.getByText('selected') as HTMLElement;
    expect(span.style.backgroundColor).toBe('rgb(0, 229, 255)');
    expect(span.style.color).toBe('var(--ground)');
  });

  it('renders strikethrough', () => {
    render(
      <Block
        block={{
          ...base,
          status: 'completed',
          liveLines: [line([{ text: 'gone', strikethrough: true }])],
        }}
      />
    );
    expect((screen.getByText('gone') as HTMLElement).style.textDecoration).toBe('line-through');
  });
});
