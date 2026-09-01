import { useEffect } from 'react';

export interface GlobalKeyBindings {
  onNewTerminal: () => void;
  onCloseSession: () => void;
  onOpenPalette: () => void;
  onToggleAudio: () => void;
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
 * These are the only route to several actions now that the design system's
 * single tab strip has replaced the header row — closing a session, the
 * sidebar and the palette all live here or in the palette itself.
 */
export function useGlobalKeys(bindings: GlobalKeyBindings) {
  const {
    onNewTerminal,
    onCloseSession,
    onOpenPalette,
    onToggleAudio,
    onOpenWorkspace,
    onJumpToNumber,
    onSnapToBottom,
  } = bindings;

  useEffect(() => {
    const handleGlobalKeys = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      if (e.ctrlKey && e.shiftKey && key === 't') {
        e.preventDefault();
        onNewTerminal();
        return;
      }

      // The tabs carry no × any more, so this and middle-click are how a
      // session gets closed.
      if (e.ctrlKey && key === 'w') {
        e.preventDefault();
        onCloseSession();
        return;
      }

      // Before the palette branch: Ctrl+K is the palette, but Ctrl+1..9 must
      // never be swallowed by a later, broader test.
      if (e.ctrlKey && !e.shiftKey && !e.altKey && key >= '1' && key <= '9') {
        e.preventDefault();
        onJumpToNumber(Number(key));
        return;
      }

      if (e.ctrlKey && (key === 'p' || key === 'k')) {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      if (e.ctrlKey && key === 'm') {
        e.preventDefault();
        onToggleAudio();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && key === 'o') {
        e.preventDefault();
        onOpenWorkspace();
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
    onOpenWorkspace,
    onJumpToNumber,
    onSnapToBottom,
  ]);
}
