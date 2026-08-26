import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Panel } from './Panel';

const rows = [
  { kind: 'RECENT', label: 'cargo test --workspace', right: 'EXIT 101', selected: true },
  { kind: 'FILE', label: 'src/pty/demux.rs', right: '412 LINES' },
];

describe('Panel', () => {
  it('selection is a raised plate button, not a highlight bar', () => {
    const { container } = render(<Panel title="RUN" hint="ESC CLOSE" rows={rows} onPick={()=>{}} />);
    const sel = container.querySelector('[data-selected="true"]') as HTMLElement;
    expect(sel.className).toMatch(/plate/);
  });

  it('kind is a column, not a badge', () => {
    render(<Panel title="RUN" hint="ESC CLOSE" rows={rows} onPick={()=>{}} />);
    expect(screen.getByText('RECENT')).toBeTruthy();
    expect(screen.getByText('FILE')).toBeTruthy();
  });
});
