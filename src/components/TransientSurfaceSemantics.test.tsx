import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CloseSessionPrompt } from './CloseSessionPrompt';
import { PermissionModeModal } from './PermissionModeModal';
import { RenameSessionModal } from './RenameSessionModal';

describe('transient surface semantics', () => {
  it('names the rename dialog and focuses its text field', () => {
    render(
      <RenameSessionModal
        isOpen
        initialTitle="INDEXER"
        sessionNumber={2}
        onRename={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: /rename session/i });
    const input = screen.getByRole('textbox', { name: /session title/i });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(input);
  });

  it('exposes permission modes as a labelled single-choice group', () => {
    const onSelectMode = vi.fn();
    const onClose = vi.fn();
    render(
      <PermissionModeModal
        isOpen
        currentMode="auto"
        onSelectMode={onSelectMode}
        onClose={onClose}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: /select permission execution mode/i });
    const group = screen.getByRole('radiogroup', { name: /permission execution mode/i });
    const current = screen.getByRole('radio', { name: /semi-autonomous mode/i });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(group).toBeTruthy();
    expect(current.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(current);

    const dismiss = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.keyDown(dismiss, { key: 'Enter' });
    expect(onSelectMode).not.toHaveBeenCalled();
    fireEvent.click(dismiss);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('focuses the safe action in the live-session alert dialog', () => {
    const onPark = vi.fn();
    const onCancel = vi.fn();
    render(
      <CloseSessionPrompt
        title="INDEXER"
        durable
        onPark={onPark}
        onKill={vi.fn()}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole('alertdialog', { name: /session still live/i });
    const park = screen.getByRole('button', { name: /park/i });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(park);
    const cancel = screen.getByRole('button', { name: /cancel/i });
    fireEvent.keyDown(cancel, { key: 'Enter' });
    expect(onPark).not.toHaveBeenCalled();
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
