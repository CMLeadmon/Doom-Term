import { useEffect, useRef } from 'react';

/**
 * The single owner of the keyboard while a transient surface is up.
 *
 * The status plate is the only persistent chrome, so every gate, picker and
 * prompt in this app is a transient overlay drawn OVER a focused terminal. That
 * terminal does not give up focus when one appears, and `RawTerminalView`
 * encodes anything that is not an app chord straight into the PTY — so an
 * overlay that listened at `window` in the bubble phase never heard a single
 * key. React dispatches from its root container, which is a descendant of
 * `window`, and the view calls `stopPropagation` before the event can climb
 * back out.
 *
 * The consequence was worst exactly where it mattered most: the PARK/KILL gate
 * showed a destructive choice, and Enter — which the user pressed expecting the
 * safe default — was written to the live process underneath as `\r`.
 *
 * Capture at `window` is the first thing on the event's path, ahead of React's
 * root listener, so stopping there is what keeps the key out of the terminal.
 * Overlays that already own a focused input (the palette, the rename modal) do
 * not need this; overlays with nothing focusable do.
 *
 * A stack rather than a single slot: a prompt opened from another overlay must
 * take the keyboard and hand it back on close, and only the topmost surface
 * may act.
 */
type ModalKeyHandler = (event: KeyboardEvent) => void;

const owners: ModalKeyHandler[] = [];

function onCaptureKeyDown(event: KeyboardEvent): void {
  const owner = owners[owners.length - 1];
  if (!owner) return;
  // Unconditional: a key the topmost surface chooses not to act on is still not
  // the shell's. Half-swallowing is how Escape reached the PTY.
  event.stopPropagation();
  owner(event);
}

/**
 * Take the keyboard until the returned function is called.
 *
 * Exported separately from the hook so non-React callers and tests can drive
 * the stack directly.
 */
export function pushModalKeyboardOwner(handler: ModalKeyHandler): () => void {
  if (owners.length === 0) {
    window.addEventListener('keydown', onCaptureKeyDown, true);
  }
  owners.push(handler);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const at = owners.lastIndexOf(handler);
    if (at !== -1) owners.splice(at, 1);
    if (owners.length === 0) {
      window.removeEventListener('keydown', onCaptureKeyDown, true);
    }
  };
}

/**
 * Whether a transient surface currently owns the keyboard.
 *
 * Read by the terminal view as a second line of defence. The capture listener
 * above is what actually stops the key, but a view that can be asked "is this
 * mine?" is a view whose contract can be tested.
 */
export function isModalKeyboardOwned(): boolean {
  return owners.length > 0;
}

/** Own the keyboard for as long as this component is mounted. */
export function useModalKeys(handler: ModalKeyHandler): void {
  // A ref so the subscription is made once. Re-subscribing on every change of
  // an inline handler would reorder the stack under a nested surface.
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => pushModalKeyboardOwner((event) => latest.current(event)), []);
}
