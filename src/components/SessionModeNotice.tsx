import { useEffect, useState } from 'react';
import { ptyClient } from '../core/ptyClient';

/**
 * A one-line notice when the active session will not survive the daemon.
 *
 * Shown rather than assumed, because the user acts on durability: they leave an
 * agent running and close the lid. Silence has to mean "this survives".
 *
 * An explicit opt-out is not reported. Someone who set DOOM_TERM_NO_TMUX has
 * already made the decision, and a permanent banner restating it is nagging.
 */
const OPTED_OUT = 'disabled by DOOM_TERM_NO_TMUX';

export function SessionModeNotice({ sessionId }: { sessionId: string | null }) {
  const [, bump] = useState(0);

  useEffect(() => ptyClient.onSessionMode(() => bump((n) => n + 1)), []);

  if (!sessionId) return null;
  const mode = ptyClient.getSessionMode(sessionId);
  // Not yet described is not the same as not durable: a warning here would
  // flash on every launch before the daemon has answered.
  if (!mode || mode.durable) return null;
  if (mode.detail === OPTED_OUT) return null;

  return (
    <div
      className="shrink-0 px-2 py-0.5 text-[10px] tracking-wide font-mono"
      style={{ background: 'var(--rail-warn, #4a3a12)', color: 'var(--ink, #d8cbb0)' }}
    >
      SESSION NOT DURABLE — {mode.detail ?? 'reason unknown'}. This shell ends with the daemon.
    </div>
  );
}
