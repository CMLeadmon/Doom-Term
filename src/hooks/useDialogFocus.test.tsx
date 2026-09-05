import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { useDialogFocus } from './useDialogFocus';

function Fixture({ open }: { open: boolean }) {
  const firstRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocus<HTMLDivElement>(open, firstRef);

  return (
    <>
      <button type="button">OPEN DIALOG</button>
      {open && (
        <div ref={dialogRef} role="dialog" aria-label="Test dialog" tabIndex={-1}>
          <button ref={firstRef} type="button">FIRST</button>
          <button type="button">LAST</button>
        </div>
      )}
    </>
  );
}

describe('useDialogFocus', () => {
  it('moves focus inside before interaction and restores the invoker on close', () => {
    const { rerender } = render(<Fixture open={false} />);
    const trigger = screen.getByRole('button', { name: 'OPEN DIALOG' });
    trigger.focus();

    rerender(<Fixture open />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'FIRST' }));

    rerender(<Fixture open={false} />);
    expect(document.activeElement).toBe(trigger);
  });

  it('wraps Tab from the final control to the first control', () => {
    render(<Fixture open />);
    const first = screen.getByRole('button', { name: 'FIRST' });
    const last = screen.getByRole('button', { name: 'LAST' });
    last.focus();

    fireEvent.keyDown(last, { key: 'Tab' });

    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first control to the final control', () => {
    render(<Fixture open />);
    const first = screen.getByRole('button', { name: 'FIRST' });
    const last = screen.getByRole('button', { name: 'LAST' });

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(last);
  });
});
