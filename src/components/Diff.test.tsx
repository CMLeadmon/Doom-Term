import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Diff } from './Diff';

const lines = [
  { n: 117, sign: ' ' as const, text: '  if self.in_osc {' },
  { n: 118, sign: '-' as const, text: '    self.osc_buf.push(byte);' },
  { n: 118, sign: '+' as const, text: '    if self.osc_buf.len() < OSC_MAX {' },
];

describe('Diff', () => {
  it('Enter applies and Escape rejects', () => {
    const onApply = vi.fn(), onReject = vi.fn();
    render(<Diff file="src/pty/demux.rs" lines={lines} added={42} removed={18} onApply={onApply} onReject={onReject} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onApply).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onReject).toHaveBeenCalledOnce();
  });

  it('tints changed rows rather than bordering them', () => {
    const { container } = render(<Diff file="x.rs" lines={lines} added={42} removed={18} onApply={()=>{}} onReject={()=>{}} />);
    const del = container.querySelector('[data-sign="-"]') as HTMLElement;
    expect(del.className).not.toMatch(/border/);
    expect(del.getAttribute('data-sign')).toBe('-');
  });

  it('line numbers are not selectable, so copying yields clean code', () => {
    const { container } = render(<Diff file="x.rs" lines={lines} added={42} removed={18} onApply={()=>{}} onReject={()=>{}} />);
    expect((container.querySelector('[data-ln]') as HTMLElement).className).toMatch(/select-none/);
  });
});
