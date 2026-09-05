import { useRef, useState } from 'react';
import { useModalKeys } from '../core/modalKeyboard';
import { useDialogFocus } from '../hooks/useDialogFocus';

interface CloseSessionPromptProps {
  title: string;
  /**
   * Whether parking survives the daemon — or null when that is not yet known.
   *
   * Three states, not two. This used to arrive as `mode?.durable ?? false`, so
   * a session the daemon had simply not described yet was presented with
   * "PARK SURVIVES ONLY WHILE THIS DAEMON RUNS" — inventing a warning out of
   * an absence of information, on the one screen where the user is deciding
   * whether it is safe to keep a process.
   */
  durable: boolean | null;
  onPark: () => void;
  onKill: () => void;
  onCancel: () => void;
}

/** A terse destructive-action gate with the recoverable choice selected. */
export function CloseSessionPrompt({
  title, durable, onPark, onKill, onCancel,
}: CloseSessionPromptProps) {
  const [choice, setChoice] = useState<'park' | 'kill'>('park');
  const parkRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocus<HTMLDivElement>(true, parkRef);

  // This gate owns the keyboard outright while it is up. It used to listen at
  // `window` in the bubble phase, which the focused terminal never let the
  // event reach: Enter went to the live process as `\r` while the user was
  // looking at a destructive-action prompt and expecting the safe default.
  useModalKeys((event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    } else if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'd') {
      event.preventDefault();
      setChoice('park');
    } else if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'k') {
      event.preventDefault();
      setChoice('kill');
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (choice === 'park') onPark();
      else onKill();
    }
  }, dialogRef);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onCancel}>
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="close-session-title"
        aria-describedby="close-session-description"
        tabIndex={-1}
        className="plate w-[min(32rem,90vw)] p-2 font-mono"
        onClick={(event) => event.stopPropagation()}
      >
        <div id="close-session-title" className="px-1 text-[12px] font-bold tracking-wider" style={{ color: 'var(--ink-plate)' }}>
          SESSION STILL LIVE · {title}
        </div>
        <div id="close-session-description" className="recess my-2 p-2 text-[11px]" style={{ color: 'var(--ink)' }}>
          PARK keeps running and removes the pane. KILL terminates the process.
          {durable === false && (
            <div className="mt-1" style={{ color: 'var(--rail-warn)' }}>
              PARK SURVIVES ONLY WHILE THIS DAEMON RUNS.
            </div>
          )}
          {durable === null && (
            <div className="mt-1" style={{ color: 'var(--ink-dim)' }}>
              PARK DURABILITY --
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] font-bold">
          <button
            ref={parkRef}
            type="button"
            aria-pressed={choice === 'park'}
            className={choice === 'park' ? 'recess p-2' : 'p-2'}
            onFocus={() => setChoice('park')}
            onClick={onPark}
          >
            D · PARK
          </button>
          <button
            type="button"
            aria-pressed={choice === 'kill'}
            className={choice === 'kill' ? 'recess p-2' : 'p-2'}
            onFocus={() => setChoice('kill')}
            onClick={onKill}
          >
            K · KILL
          </button>
        </div>
        <div className="pt-2 text-center text-[10px]" style={{ color: 'var(--ink-dim)' }}>
          ENTER CONFIRMS · ESC CANCELS
        </div>
      </div>
    </div>
  );
}
