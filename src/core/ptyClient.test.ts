import { describe, it, expect } from 'vitest';
import { looksLikeAbsolutePath, ptyClient } from './ptyClient';

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
