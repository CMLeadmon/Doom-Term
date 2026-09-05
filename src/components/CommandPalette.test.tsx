import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from './CommandPalette';

beforeAll(() => {
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  }
});

describe('CommandPalette session context', () => {
  const actions = [
    { id: 'a', category: 'Session', title: 'INDEXER', searchText: 'hidden needle', preview: 'last\nthree\nlines', run: () => undefined },
    { id: 'b', category: 'Session', title: 'BUILDER', run: () => undefined },
  ];

  it('shows the selected action preview without changing sessions', () => {
    render(<CommandPalette isOpen onClose={() => undefined} actions={actions} />);
    expect(screen.getByLabelText('Session preview').textContent).toBe('last\nthree\nlines');
  });

  it('matches the hidden search corpus as well as the row title', () => {
    render(<CommandPalette isOpen onClose={() => undefined} actions={actions} />);
    fireEvent.change(screen.getByPlaceholderText('Type a command or search action...'), {
      target: { value: 'needle' },
    });
    expect(screen.getByText('INDEXER')).toBeTruthy();
    expect(screen.queryByText('BUILDER')).toBeNull();
  });
});

describe('accessible command search contract', () => {
  const actions = [
    { id: 'session', category: 'Session', title: 'ALPHA', run: () => undefined },
    { id: 'recovery', category: 'Recovery', title: 'RECOVER BETA', run: () => undefined },
    { id: 'navigation', category: 'Navigation', title: 'NEXT ATTENTION', run: () => undefined },
    { id: 'agent', category: 'Agent', title: 'NEW AGENT', run: () => undefined },
    { id: 'notes', category: 'Notes', title: 'NEW NOTE', run: () => undefined },
    { id: 'audio', category: 'Audio', title: 'TOGGLE AUDIO', run: () => undefined },
  ];

  it('names the dialog and connects its combobox to the active option', () => {
    render(<CommandPalette isOpen onClose={() => undefined} actions={actions} />);

    const dialog = screen.getByRole('dialog', { name: /command palette/i });
    const search = screen.getByRole('combobox', { name: 'Search commands and sessions' });
    const list = screen.getByRole('listbox', { name: 'Commands and sessions' });
    const first = screen.getAllByRole('option')[0];

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(search.getAttribute('aria-controls')).toBe(list.id);
    expect(search.getAttribute('aria-activedescendant')).toBe(first.id);
    expect(first.getAttribute('aria-selected')).toBe('true');
  });

  it('derives filter choices from the commands that actually exist', () => {
    render(<CommandPalette isOpen onClose={() => undefined} actions={actions} />);

    for (const category of ['RECOVERY', 'NAVIGATION', 'AGENT', 'NOTES', 'AUDIO']) {
      expect(screen.getByRole('button', { name: category })).toBeTruthy();
    }
  });

  it('supports absolute first and last navigation', () => {
    render(<CommandPalette isOpen onClose={() => undefined} actions={actions} />);

    fireEvent.keyDown(window, { key: 'End' });
    expect(screen.getAllByRole('option').at(-1)?.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(window, { key: 'Home' });
    expect(screen.getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
  });

  it('clears a query before a later Escape closes the palette', () => {
    const onClose = vi.fn();
    render(<CommandPalette isOpen onClose={onClose} actions={actions} />);
    const search = screen.getByPlaceholderText('Type a command or search action...');
    fireEvent.change(search, { target: { value: 'alpha' } });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect((search as HTMLInputElement).value).toBe('');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('announces the filtered result count', () => {
    render(<CommandPalette isOpen onClose={() => undefined} actions={actions} />);
    fireEvent.change(screen.getByPlaceholderText('Type a command or search action...'), {
      target: { value: 'recover' },
    });

    expect(screen.getByRole('status').textContent).toBe('1 RESULT');
  });

  it('lets a focused close button handle Enter instead of running the selected row', () => {
    const run = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        isOpen
        onClose={onClose}
        actions={[{ id: 'a', category: 'Session', title: 'ALPHA', run }]}
      />,
    );
    const close = screen.getByRole('button', { name: /close command palette/i });

    fireEvent.keyDown(close, { key: 'Enter' });
    expect(run).not.toHaveBeenCalled();

    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('keyboard selection under live updates', () => {
  const rows = [
    { id: 'a', category: 'Session', title: 'ALPHA', run: () => undefined },
    { id: 'b', category: 'Session', title: 'BRAVO', run: () => undefined },
    { id: 'c', category: 'Session', title: 'CHARLIE', run: () => undefined },
  ];

  /** Which row is drawn as selected, by its bold/raised treatment. */
  const selectedTitle = (): string | null => {
    const row = document.querySelector('[role="option"][aria-selected="true"]');
    return row?.textContent?.match(/ALPHA|BRAVO|CHARLIE/)?.[0] ?? null;
  };

  it('keeps the cursor where the operator put it when the actions rebuild', () => {
    // The defect: `useEffect(() => setSelectedIndex(0), [filteredActions])`
    // fired on the array's IDENTITY. The actions were rebuilt on every App
    // render, so live PTY output and the two-second telemetry poll dragged the
    // selection back to the first row mid-navigation — on the one surface whose
    // entire job is choosing a session deliberately.
    const { rerender } = render(
      <CommandPalette isOpen onClose={() => undefined} actions={rows} />,
    );

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(selectedTitle()).toBe('CHARLIE');

    // An equivalent but freshly-built array, exactly as a re-render produces.
    rerender(
      <CommandPalette
        isOpen
        onClose={() => undefined}
        actions={rows.map((row) => ({ ...row }))}
      />,
    );

    expect(selectedTitle()).toBe('CHARLIE');
  });

  it('runs the row the operator is looking at, not the first one', () => {
    let ran = '';
    const withRun = rows.map((row) => ({ ...row, run: () => { ran = row.id; } }));
    const { rerender } = render(
      <CommandPalette isOpen onClose={() => undefined} actions={withRun} />,
    );

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    rerender(
      <CommandPalette
        isOpen
        onClose={() => undefined}
        actions={withRun.map((row) => ({ ...row }))}
      />,
    );
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(ran).toBe('b');
  });

  it('does reset when the query changes, because that IS a new list', () => {
    render(<CommandPalette isOpen onClose={() => undefined} actions={rows} />);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(selectedTitle()).toBe('BRAVO');

    fireEvent.change(screen.getByPlaceholderText('Type a command or search action...'), {
      target: { value: 'a' },
    });
    expect(selectedTitle()).toBe('ALPHA');
  });

  it('falls back to the first row when the selected one disappears', () => {
    const { rerender } = render(
      <CommandPalette isOpen onClose={() => undefined} actions={rows} />,
    );
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(selectedTitle()).toBe('CHARLIE');

    rerender(
      <CommandPalette
        isOpen
        onClose={() => undefined}
        actions={rows.filter((row) => row.id !== 'c')}
      />,
    );
    expect(selectedTitle()).toBe('ALPHA');
  });
});

describe('fuzzy row matching', () => {
  it('finds a session by an initialism, as documented', () => {
    const actions = [
      { id: 'a', category: 'Session', title: 'doom term server', run: () => undefined },
      { id: 'b', category: 'Session', title: 'unrelated', run: () => undefined },
    ];
    render(<CommandPalette isOpen onClose={() => undefined} actions={actions} />);
    fireEvent.change(screen.getByPlaceholderText('Type a command or search action...'), {
      target: { value: 'dts' },
    });
    expect(screen.getByText('doom term server')).toBeTruthy();
    expect(screen.queryByText('unrelated')).toBeNull();
  });
});
