import { describe, it, expect } from 'vitest';
import { HoldBuffer, HOLD_LIMIT_CHARS } from './holdBuffer';

describe('HoldBuffer', () => {
  it('passes input straight through when it is not holding', () => {
    const buf = new HoldBuffer();
    expect(buf.isHolding).toBe(false);
    expect(buf.offer('a')).toBe('send');
  });

  it('holds input while a command line is in flight', () => {
    const buf = new HoldBuffer();
    buf.hold();
    expect(buf.offer('a')).toBe('held');
    expect(buf.isHolding).toBe(true);
  });

  it('releases what it held, in the order it arrived', () => {
    const buf = new HoldBuffer();
    buf.hold();
    buf.offer('one');
    buf.offer('two');
    buf.offer('three');
    expect(buf.flush()).toEqual(['one', 'two', 'three']);
  });

  it('goes back to passing through after a flush', () => {
    const buf = new HoldBuffer();
    buf.hold();
    buf.offer('a');
    buf.flush();
    expect(buf.isHolding).toBe(false);
    expect(buf.offer('b')).toBe('send');
  });

  it('drops what it held when the delivery failed', () => {
    // Held keys belong to the user's next input, never to a command that was
    // abandoned — splicing them in is the failure this exists to prevent.
    const buf = new HoldBuffer();
    buf.hold();
    buf.offer('a');
    buf.discard();
    expect(buf.isHolding).toBe(false);
    expect(buf.flush()).toEqual([]);
  });

  it('refuses loudly past its limit rather than dropping silently', () => {
    const buf = new HoldBuffer();
    buf.hold();
    expect(buf.offer('x'.repeat(HOLD_LIMIT_CHARS))).toBe('held');
    expect(buf.offer('one more')).toBe('full');
  });

  it('keeps what it already held when a later offer is refused', () => {
    const buf = new HoldBuffer();
    buf.hold();
    buf.offer('keep me');
    buf.offer('x'.repeat(HOLD_LIMIT_CHARS));
    expect(buf.flush()).toEqual(['keep me']);
  });

  it('is reusable across commands', () => {
    const buf = new HoldBuffer();
    buf.hold();
    buf.offer('first');
    expect(buf.flush()).toEqual(['first']);
    buf.hold();
    buf.offer('second');
    expect(buf.flush()).toEqual(['second']);
  });
});
