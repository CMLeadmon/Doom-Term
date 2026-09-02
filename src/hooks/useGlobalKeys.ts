import { useEffect } from 'react';
import { matchAction, type AppAction } from '../core/keymap';
import type { PaneFocusDirection } from '../core/paneTree';

export interface GlobalKeyBindings {
  onNewTerminal: () => void;
  onCloseSession: () => void;
  onOpenPalette: () => void;
  onToggleAudio: () => void;
  onNextAttention: () => void;
  onFocusPane: (direction: PaneFocusDirection) => void;
  onSelectPane: () => void;
  onTogglePaneZoom: () => void;
  onOpenWorkspace: () => void;
  /**
   * Ctrl+1..9 — the only direct route to a session once the tab strip is gone.
   * The plate's waiting rows carry the same numbers, so the list is also the
   * switcher.
   */
  onJumpToNumber: (n: number) => void;
  /** Only fires while the viewport is scrolled away from the bottom. */
  onSnapToBottom: (() => void) | null;
}

const isTypingTarget = () => {
  const tag = document.activeElement?.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT';
};

/**
 * The window-level shortcuts.
 *
 * Which chords these are is NOT decided here — `src/core/keymap.ts` owns that,
 * and `RawTerminalView` consults the same table to decide what to let bubble up
 * to this listener. They used to be two hand-maintained lists that disagreed,
 * and the disagreement silently cost the app every one of its chords.
 */
export function useGlobalKeys(bindings: GlobalKeyBindings) {
  const {
    onNewTerminal,
    onCloseSession,
    onOpenPalette,
    onToggleAudio,
    onNextAttention,
    onFocusPane,
    onSelectPane,
    onTogglePaneZoom,
    onOpenWorkspace,
    onJumpToNumber,
    onSnapToBottom,
  } = bindings;

  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      // A chord typed into the palette's own search box is text, not a command.
      const hit = isTypingTarget() ? null : matchAction(e);
      if (hit) {
        const run: Record<AppAction, () => void> = {
          palette: onOpenPalette,
          newSession: onNewTerminal,
          closeSession: onCloseSession,
          openWorkspace: onOpenWorkspace,
          toggleAudio: onToggleAudio,
          nextAttention: onNextAttention,
          focusPaneLeft: () => onFocusPane('left'),
          focusPaneRight: () => onFocusPane('right'),
          focusPaneUp: () => onFocusPane('up'),
          focusPaneDown: () => onFocusPane('down'),
          selectPane: onSelectPane,
          togglePaneZoom: onTogglePaneZoom,
          // A number with no session behind it does nothing, rather than
          // guessing at a neighbour. Ctrl+4 with three sessions open is a no-op
          // on purpose.
          jumpToSession: () => hit.digit && onJumpToNumber(hit.digit),
        };
        e.preventDefault();
        run[hit.action]();
        return;
      }

      // Space snaps the viewport back to the bottom, but only when it is
      // detached and the user is not typing into a field.
      if (e.key === ' ' && onSnapToBottom && !isTypingTarget()) {
        e.preventDefault();
        onSnapToBottom();
      }
    };

    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [
    onNewTerminal,
    onCloseSession,
    onOpenPalette,
    onToggleAudio,
    onNextAttention,
    onFocusPane,
    onSelectPane,
    onTogglePaneZoom,
    onOpenWorkspace,
    onJumpToNumber,
    onSnapToBottom,
  ]);
}
