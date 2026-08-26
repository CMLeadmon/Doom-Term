import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Approval } from './Approval';

const props = {
  command: 'rm -rf target/', agent: 'CLAUDE CODE', cwd: '~/Projects/Doom Term',
  isolation: 'OFF' as const, consequence: 'DELETES 2 DIRECTORIES · NOT REVERSIBLE',
};

describe('Approval', () => {
  it('Escape denies — never runs', () => {
    const onDeny = vi.fn(), onRunOnce = vi.fn();
    render(<Approval {...props} onRunOnce={onRunOnce} onAlways={()=>{}} onDeny={onDeny} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDeny).toHaveBeenCalledOnce();
    expect(onRunOnce).not.toHaveBeenCalled();
  });

  it('Deny holds the safe ring, Run Once holds the red one', () => {
    render(<Approval {...props} onRunOnce={()=>{}} onAlways={()=>{}} onDeny={()=>{}} />);
    expect(screen.getByText('DENY').getAttribute('style')).toMatch(/--st-live/);
    expect(screen.getByText('RUN ONCE').getAttribute('style')).toMatch(/#c02a22/);
  });

  it('shows the command verbatim and states the consequence', () => {
    render(<Approval {...props} onRunOnce={()=>{}} onAlways={()=>{}} onDeny={()=>{}} />);
    expect(screen.getByText('rm -rf target/')).toBeTruthy();
    expect(screen.getByText(/NOT REVERSIBLE/)).toBeTruthy();
  });
});
