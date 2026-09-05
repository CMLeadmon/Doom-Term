import { describe, it, expect } from 'vitest';
import { looksLikeAbsolutePath, ptyClient } from './ptyClient';
import { BOOTSTRAP_COLS, BOOTSTRAP_ROWS, getEmulator } from './emulatorRegistry';

/**
 * Drive the singleton through a stub socket and hand back what it sent.
 * `readyState: 1` is WebSocket.OPEN, which is what `send()` gates on.
 */
function captureSends(run: () => void): unknown[] {
  const sent: string[] = [];
  const internals = ptyClient as unknown as {
    ws: unknown;
    activeSessionId: string;
    isConnected: boolean;
  };
  const priorWs = internals.ws;
  const priorId = internals.activeSessionId;
  const priorConnected = internals.isConnected;
  internals.ws = { readyState: 1, send: (raw: string) => sent.push(raw) };
  // writeToSession queues instead of sending unless the client believes it is
  // connected, so a socket stub alone captures nothing from that path.
  internals.isConnected = true;
  try {
    run();
  } finally {
    internals.ws = priorWs;
    internals.activeSessionId = priorId;
    internals.isConnected = priorConnected;
  }
  return sent.map((raw) => JSON.parse(raw));
}

describe('telemetry requests', () => {
  it('names the session on screen', () => {
    // Telemetry is per-session: the foreground process, and so the agent and
    // its rate limit, differ per tab. Without the id the daemon answered about
    // whichever session sorted first and the plate described the wrong tab.
    const sent = captureSends(() => {
      (ptyClient as unknown as { activeSessionId: string }).activeSessionId = 'node-7';
      ptyClient.requestTelemetry('/tmp/project');
    });
    expect(sent).toEqual([
      { action: 'GetTelemetry', payload: { cwd: '/tmp/project', session_id: 'node-7' } },
    ]);
  });

  it('still names the session when no directory is given', () => {
    const sent = captureSends(() => {
      (ptyClient as unknown as { activeSessionId: string }).activeSessionId = 'node-2';
      ptyClient.requestTelemetry();
    });
    expect(sent).toEqual([
      { action: 'GetTelemetry', payload: { cwd: null, session_id: 'node-2' } },
    ]);
  });
});

describe('global PTY routing', () => {
  it('delivers a background execution result with its session id', () => {
    const seen: Array<[number | null, string]> = [];
    const remove = ptyClient.registerHandler({
      onOutput: () => undefined,
      onExecutionEnd: (code, sessionId) => seen.push([code, sessionId]),
    });
    const internals = ptyClient as unknown as {
      activeSessionId: string;
      handleServerMessage: (message: unknown) => void;
    };
    const prior = internals.activeSessionId;
    internals.activeSessionId = 'visible';

    internals.handleServerMessage({
      event: 'PtyEvent',
      data: { session_id: 'background', event: { type: 'ExecutionEnd', payload: { exit_code: 9 } } },
    });

    remove();
    internals.activeSessionId = prior;
    expect(seen).toEqual([[9, 'background']]);
  });
});

describe('selecting an already-bound session', () => {
  /** Forget what the singleton thinks it spawned, so ids start clean. */
  function resetSpawned(): void {
    (ptyClient as unknown as { spawnedSessions: Set<string> }).spawnedSessions.clear();
  }

  it('spawns each session once and replays neither on the way back', () => {
    // A -> B -> A. The daemon answers Reattach by replaying its entire 500-event
    // ring, so sending one merely because a pane became visible re-applied
    // Output, ExecutionStart and ExecutionEnd that had already been consumed:
    // doubled scrollback, doubled execution serials, doubled notifications.
    resetSpawned();
    const sent = captureSends(() => {
      ptyClient.ensureSession('A', '/repo/a');
      ptyClient.ensureSession('B', '/repo/b');
      ptyClient.ensureSession('A', '/repo/a');
    });

    const actions = (sent as { action: string; payload: { id: string } }[]).map(
      (m) => [m.action, m.payload.id] as const
    );
    expect(actions).toEqual([
      ['Spawn', 'A'],
      ['Spawn', 'B'],
    ]);
    expect(actions.some(([action]) => action === 'Reattach')).toBe(false);
    resetSpawned();
  });

  it('still binds the session the keyboard belongs to', () => {
    // Returning early must not skip the part that makes writes go to A.
    resetSpawned();
    // Read inside the window: captureSends restores activeSessionId on the way out.
    let bound = '';
    captureSends(() => {
      ptyClient.ensureSession('A', '/repo/a');
      ptyClient.ensureSession('B', '/repo/b');
      ptyClient.ensureSession('A', '/repo/a');
      bound = ptyClient.getSessionId();
    });
    expect(bound).toBe('A');
    resetSpawned();
  });

  it('re-establishes every id after the socket opens again', () => {
    // A new socket generation IS a real gap: the daemon has been emitting into
    // a channel nobody was reading. Spawn is the daemon's rebind-and-replay
    // path, so the catch-up survives — it is only the same-generation replay
    // that was wrong.
    resetSpawned();
    captureSends(() => ptyClient.ensureSession('A', '/repo/a'));
    resetSpawned(); // what ws.onopen does

    const sent = captureSends(() => ptyClient.ensureSession('A', '/repo/a'));
    expect(sent).toEqual([
      {
        action: 'Spawn',
        payload: { id: 'A', cols: BOOTSTRAP_COLS, rows: BOOTSTRAP_ROWS, cwd: '/repo/a' },
      },
    ]);
    resetSpawned();
  });
});

describe('session recovery protocol', () => {
  it('correlates a listing reply by request id', async () => {
    let pending!: ReturnType<typeof ptyClient.listSessions>;
    const sent = captureSends(() => { pending = ptyClient.listSessions(); });
    const request = sent[0] as { action: string; payload: { request_id: string } };
    expect(request.action).toBe('ListSessions');

    (ptyClient as unknown as { handleServerMessage: (message: unknown) => void }).handleServerMessage({
      event: 'SessionListing',
      data: {
        request_id: request.payload.request_id,
        sessions: [{ id: 'orphan', cwd: '/repo', command: 'codex', durable: true }],
      },
    });

    await expect(pending).resolves.toMatchObject({
      request_id: request.payload.request_id,
      sessions: [{ id: 'orphan' }],
    });
  });
});

/** Feed a chunk to whatever handlers a delivery registered for a session. */
function echoTo(sessionId: string, chunk: string): void {
  const handlers = (
    ptyClient as unknown as {
      sessionHandlers: Map<string, Set<{ onOutput: (d: string, s: string) => void }>>;
    }
  ).sessionHandlers.get(sessionId);
  handlers?.forEach((h) => h.onOutput(chunk, sessionId));
}

const payloads = (sent: unknown[]): string[] =>
  sent
    .filter((m): m is { action: string; payload: { data: string } } => {
      return (m as { action?: string }).action === 'Write';
    })
    .map((m) => m.payload.data);

describe('command delivery', () => {
  it('writes the line first and submits only once the shell echoes it', () => {
    const sent = captureSends(() => {
      ptyClient.submitCommandToSession('d1', 'echo hi');
      echoTo('d1', 'user@host:~$ echo hi');
    });
    expect(payloads(sent)).toEqual(['echo hi', '\r']);
  });

  it('holds what is typed during the window and releases it after the line', () => {
    // Typed inside the delivery window, these used to land INSIDE the command.
    const sent = captureSends(() => {
      ptyClient.submitCommandToSession('d2', 'ls');
      ptyClient.writeToSession('d2', 'x');
      ptyClient.writeToSession('d2', 'y');
      echoTo('d2', '$ ls');
    });
    expect(payloads(sent)).toEqual(['ls', '\r', 'x', 'y']);
  });

  it('passes typing straight through when no delivery is in flight', () => {
    const sent = captureSends(() => {
      ptyClient.writeToSession('d3', 'plain');
    });
    expect(payloads(sent)).toEqual(['plain']);
  });

  it('sends a multi-line command as one bracketed paste, unverified', () => {
    const sent = captureSends(() => {
      ptyClient.submitCommandToSession('d4', 'one\ntwo');
    });
    expect(payloads(sent)).toEqual(['\x1b[200~one\ntwo\x1b[201~\n']);
  });
});

describe('looksLikeAbsolutePath', () => {
  it('recognises the paths a user actually types', () => {
    expect(looksLikeAbsolutePath('/var/home/cleadmon/Projects/Doom Term')).toBe(true);
    expect(looksLikeAbsolutePath('~/Projects')).toBe(true);
    expect(looksLikeAbsolutePath('~')).toBe(true);
  });

  it('treats a bare word as a filter, not a path', () => {
    expect(looksLikeAbsolutePath('doom')).toBe(false);
    expect(looksLikeAbsolutePath('')).toBe(false);
    expect(looksLikeAbsolutePath('Doom Term')).toBe(false);
  });

  it('tolerates the whitespace typing leaves behind', () => {
    expect(looksLikeAbsolutePath('  /etc  ')).toBe(true);
    expect(looksLikeAbsolutePath('   ')).toBe(false);
  });
});

describe('resize across a connection that is not open yet', () => {
  it('restates the size once the socket opens', () => {
    // The pane measures itself once on mount. Under Tauri the daemon starts
    // alongside the webview, so that single Resize is sent into a socket that
    // is still connecting — and `send` drops it. Without a replay the shell
    // keeps the 120x30 bootstrap for its whole life: observed on macOS as a
    // pane stuck at 120x30 while Linux, where the daemon was already up,
    // negotiated 114x50 from the same code.
    const internals = ptyClient as unknown as {
      ws: unknown;
      isConnected: boolean;
      flushSizes: () => void;
    };
    const priorWs = internals.ws;
    const priorConnected = internals.isConnected;

    // Socket still CONNECTING: the Resize goes nowhere.
    const dropped: string[] = [];
    internals.ws = { readyState: 0, send: (raw: string) => dropped.push(raw) };
    ptyClient.resizeSession('r1', 114, 50);
    expect(dropped).toEqual([]);

    // Now it opens, as ws.onopen does.
    const sent: string[] = [];
    internals.ws = { readyState: 1, send: (raw: string) => sent.push(raw) };
    internals.flushSizes();

    expect(sent.map((r) => JSON.parse(r))).toEqual([
      { action: 'Resize', payload: { id: 'r1', cols: 114, rows: 50 } },
    ]);

    internals.ws = priorWs;
    internals.isConnected = priorConnected;
  });

  it('resets the emulator on SessionMode before replayed events arrive', () => {
    const internals = ptyClient as unknown as {
      handleServerMessage: (msg: unknown) => void;
    };
    const emu = getEmulator('rebound-session');
    emu.write('stale line before replay\r\n');

    internals.handleServerMessage({
      event: 'SessionMode',
      data: { session_id: 'rebound-session', durable: true, detail: null },
    });

    const lines = emu.getLines().map((l) => l.spans.map((s) => s.text).join('').trim());
    expect(lines).toEqual(['']);
  });
});
