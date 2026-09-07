interface SessionSnapshotNoticeProps {
  title: string;
  cwd: string;
  /** True while the daemon has not yet been asked what it holds. */
  pending: boolean;
  onStart: () => void;
}

/**
 * A restored session with no process behind it, said out loud.
 *
 * The application used to hand every restored id straight to the daemon's
 * attach-or-create Spawn, so a session the daemon no longer held became a fresh
 * shell wearing the old session's scrollback — presented as if it had been
 * recovered. `reconcileSessions` had computed the right answer all along;
 * nothing rendered it.
 *
 * Starting a process is a deliberate act here, not a side effect of looking at
 * the pane. The stored command is never re-run: a snapshot records where a
 * session was, not permission to execute it again.
 */
export function SessionSnapshotNotice({
  title, cwd, pending, onStart,
}: SessionSnapshotNoticeProps) {
  return (
    <div
      data-testid="session-snapshot-notice"
      className="flex flex-1 flex-col items-center justify-center gap-2 p-4 font-mono"
      style={{ background: 'var(--ground)' }}
    >
      <div className="text-[12px] font-bold tracking-wider" style={{ color: 'var(--ink)' }}>
        {pending ? 'CHECKING DAEMON' : 'SNAPSHOT'} · {title}
      </div>
      <div className="recess p-2 text-center text-[11px]" style={{ color: 'var(--ink-dim)' }}>
        {pending ? (
          <>ASKING THE DAEMON WHAT IT STILL HOLDS.</>
        ) : (
          <>
            NO PROCESS IS RUNNING FOR THIS SESSION.
            <div className="mt-1">STORED LINES ONLY · {cwd}</div>
          </>
        )}
      </div>
      {!pending && (
        <button
          className="px-3 py-1.5 text-[11px] font-bold bev-up"
          style={{ background: 'var(--st-live)', color: 'var(--ground)' }}
          onClick={onStart}
        >
          START A NEW SHELL HERE
        </button>
      )}
    </div>
  );
}
