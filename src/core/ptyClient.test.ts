import { describe, it, expect } from 'vitest';
import { looksLikeAbsolutePath, ptyClient } from './ptyClient';

/**
 * Drive the singleton through a stub socket and hand back what it sent.
 * `readyState: 1` is WebSocket.OPEN, which is what `send()` gates on.
 */
function captureSends(run: () => void): unknown[] {
  const sent: string[] = [];
  const internals = ptyClient as unknown as { ws: unknown; activeSessionId: string };
  const priorWs = internals.ws;
  const priorId = internals.activeSessionId;
  internals.ws = { readyState: 1, send: (raw: string) => sent.push(raw) };
  try {
    run();
  } finally {
    internals.ws = priorWs;
    internals.activeSessionId = priorId;
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
