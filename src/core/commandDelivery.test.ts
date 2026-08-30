import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  deliverCommand,
  stripControl,
  echoComplete,
  KILL_LINE,
  VERIFY_TIMEOUT_MS,
  DELIVERY_ATTEMPTS,
  type DeliveryOutcome,
} from './commandDelivery';

/** A fake terminal: records what was written, lets a test feed the echo back. */
function fakeIo() {
  const written: string[] = [];
  const listeners = new Set<(chunk: string) => void>();
  return {
    written,
    echo: (chunk: string) => listeners.forEach((cb) => cb(chunk)),
    io: {
      write: (data: string) => written.push(data),
      onData: (cb: (chunk: string) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('stripControl', () => {
  it('drops escape sequences and line breaks so the echo can be compared', () => {
    expect(stripControl('\x1b[32mls -la\x1b[0m\r\n')).toBe('ls -la');
    expect(stripControl('\x1b]0;title\x07ls')).toBe('ls');
  });
});

describe('echoComplete', () => {
  it('matches on the tail, because the head is polluted by the prompt', () => {
    expect(echoComplete('user@host:~$ deploy --now', 'deploy --now')).toBe(true);
    expect(echoComplete('user@host:~$ deploy --n', 'deploy --now')).toBe(false);
  });
});

describe('deliverCommand', () => {
  it('writes the line without Enter and waits', () => {
    const f = fakeIo();
    deliverCommand(f.io, 'echo hi');
    expect(f.written).toEqual(['echo hi']);
  });

  it('submits once the shell echoes the line back', () => {
    const f = fakeIo();
    const settled = vi.fn();
    deliverCommand(f.io, 'echo hi', settled);
    f.echo('user@host:~$ echo hi');
    expect(f.written).toEqual(['echo hi', '\r']);
    expect(settled).toHaveBeenCalledWith('verified');
  });

  it('ignores escape sequences in the echo', () => {
    const f = fakeIo();
    deliverCommand(f.io, 'echo hi');
    f.echo('\x1b[32muser@host\x1b[0m:~$ echo \x1b[1mhi\x1b[0m\r\n');
    expect(f.written).toEqual(['echo hi', '\r']);
  });

  it('reassembles an echo that arrives in pieces', () => {
    const f = fakeIo();
    deliverCommand(f.io, 'echo hi');
    f.echo('user@host:~$ ec');
    expect(f.written).toEqual(['echo hi']);
    f.echo('ho hi');
    expect(f.written).toEqual(['echo hi', '\r']);
  });

  it('clears the pending line and rewrites when the echo never comes', () => {
    const f = fakeIo();
    deliverCommand(f.io, 'echo hi');
    vi.advanceTimersByTime(VERIFY_TIMEOUT_MS);
    expect(f.written).toEqual(['echo hi', KILL_LINE, 'echo hi']);
  });

  it('fails open on the last attempt rather than blocking the launch', () => {
    const f = fakeIo();
    const settled = vi.fn();
    deliverCommand(f.io, 'echo hi', settled);
    for (let i = 0; i < DELIVERY_ATTEMPTS; i++) vi.advanceTimersByTime(VERIFY_TIMEOUT_MS);
    expect(f.written[f.written.length - 1]).toBe('\r');
    expect(settled).toHaveBeenCalledWith('unverified');
  });

  it('settles exactly once', () => {
    const f = fakeIo();
    const settled = vi.fn();
    deliverCommand(f.io, 'echo hi', settled);
    f.echo('$ echo hi');
    f.echo('$ echo hi');
    vi.advanceTimersByTime(VERIFY_TIMEOUT_MS * DELIVERY_ATTEMPTS);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('does not submit twice when the io echoes synchronously', () => {
    // An io whose write feeds straight back into onData would otherwise
    // re-enter the listener while the tail still matches.
    const listeners = new Set<(chunk: string) => void>();
    const written: string[] = [];
    const io = {
      write: (data: string) => {
        written.push(data);
        listeners.forEach((cb) => cb(data));
      },
      onData: (cb: (chunk: string) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    };
    deliverCommand(io, 'echo hi');
    expect(written).toEqual(['echo hi', '\r']);
  });

  it('reports settled only after the Enter has gone out', () => {
    // The caller releases held keystrokes from onSettled. If it fired before
    // the Enter, those keys would land inside the command line.
    const f = fakeIo();
    let writtenAtSettle: string[] = [];
    deliverCommand(f.io, 'echo hi', () => {
      writtenAtSettle = [...f.written];
    });
    f.echo('$ echo hi');
    expect(writtenAtSettle).toEqual(['echo hi', '\r']);
  });

  it('stops and unsubscribes when cancelled', () => {
    const f = fakeIo();
    const settled = vi.fn();
    const cancel = deliverCommand(f.io, 'echo hi', settled);
    cancel();
    expect(settled).toHaveBeenCalledWith('cancelled' as DeliveryOutcome);
    expect(f.listenerCount).toBe(0);

    vi.advanceTimersByTime(VERIFY_TIMEOUT_MS * DELIVERY_ATTEMPTS);
    expect(f.written).toEqual(['echo hi']);
  });

  it('does not re-announce when cancelled after it already submitted', () => {
    const f = fakeIo();
    const settled = vi.fn();
    const cancel = deliverCommand(f.io, 'echo hi', settled);
    f.echo('$ echo hi');
    cancel();
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith('verified');
  });
});
