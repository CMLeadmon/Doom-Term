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

    const dialog = screen.getByRole('dialog', { name: /environment & execution control/i });
    const group = screen.getByRole('radiogroup', { name: /permission execution mode/i });
    const current = screen.getByRole('radio', { name: /permission review banner/i });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(group).toBeTruthy();
    expect(current.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(current);

    fireEvent.keyDown(current, { key: 'ArrowDown' });
    const yolo = screen.getByRole('radio', { name: /review in terminal/i });
    expect(yolo.getAttribute('aria-checked')).toBe('true');
    expect(current.getAttribute('aria-checked')).toBe('false');
    expect(document.activeElement).toBe(yolo);

    const dismiss = screen.getByRole('button', { name: /dismiss/i });
    fireEvent.keyDown(dismiss, { key: 'Enter' });
    expect(onSelectMode).not.toHaveBeenCalled();
    fireEvent.click(dismiss);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps worktree errors visible instead of closing on an unconfirmed request', async () => {
    const onClose = vi.fn();
    render(<PermissionModeModal isOpen currentMode="manual" onSelectMode={() => {}}
      onClose={onClose} onCreateWorktreeSession={async () => { throw new Error('branch already exists'); }} />);
    fireEvent.click(screen.getByRole('button', { name: /worktree & isolation/i }));
    fireEvent.change(screen.getByPlaceholderText(/branch-name/), { target: { value: 'feature/test' } });
    fireEvent.click(screen.getByRole('button', { name: 'CREATE WORKTREE' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'branch already exists');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reopens permission selection on the applied mode, not an abandoned preview', () => {
    const props = {
      currentMode: 'manual' as const,
      onSelectMode: vi.fn(),
      onClose: vi.fn(),
    };
    const { rerender } = render(<PermissionModeModal isOpen {...props} />);

    fireEvent.keyDown(screen.getByRole('radio', { name: /review in terminal/i }), { key: 'ArrowDown' });
    expect(screen.getByRole('radio', { name: /permission review banner/i }).getAttribute('aria-checked')).toBe('true');

    rerender(<PermissionModeModal isOpen={false} {...props} />);
    rerender(<PermissionModeModal isOpen {...props} />);

    const applied = screen.getByRole('radio', { name: /review in terminal/i });
    expect(applied.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(applied);
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
