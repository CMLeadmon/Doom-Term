import { render, screen } from '@testing-library/react';
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
    render(
      <PermissionModeModal
        isOpen
        currentMode="auto"
        onSelectMode={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: /select permission execution mode/i });
    const group = screen.getByRole('radiogroup', { name: /permission execution mode/i });
    const current = screen.getByRole('radio', { name: /semi-autonomous mode/i });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(group).toBeTruthy();
    expect(current.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(current);
  });

  it('focuses the safe action in the live-session alert dialog', () => {
    render(
      <CloseSessionPrompt
        title="INDEXER"
        durable
        onPark={vi.fn()}
        onKill={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('alertdialog', { name: /session still live/i });
    const park = screen.getByRole('button', { name: /park/i });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(park);
  });
});
