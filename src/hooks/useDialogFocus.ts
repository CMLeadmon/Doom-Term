import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Move focus into a transient surface, contain it there, and restore it. */
export function useDialogFocus<T extends HTMLElement>(
  isOpen: boolean,
  initialFocusRef?: RefObject<HTMLElement | null>,
): RefObject<T | null> {
  const dialogRef = useRef<T>(null);

  // A terminal mounted in the same commit takes focus in a passive effect.
  // Reassert the dialog after sibling effects so a newly opened surface is
  // still the final keyboard owner, not just the first one to request focus.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog || dialog.contains(document.activeElement)) return;
    const first = dialog.querySelector<HTMLElement>(FOCUSABLE);
    (initialFocusRef?.current ?? first ?? dialog).focus({ preventScroll: true });
  }, [isOpen, initialFocusRef]);

  useLayoutEffect(() => {
    if (!isOpen || !dialogRef.current) return;

    const dialog = dialogRef.current;
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((item) => !item.hidden && item.tabIndex >= 0);

    (initialFocusRef?.current ?? focusable()[0] ?? dialog).focus({ preventScroll: true });

    const containFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', containFocus, true);
    return () => {
      document.removeEventListener('keydown', containFocus, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [isOpen, initialFocusRef]);

  return dialogRef;
}
