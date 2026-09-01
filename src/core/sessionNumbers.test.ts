import { describe, it, expect } from 'vitest';
import { nextSessionNumber, MAX_SESSION_NUMBER } from './sessionNumbers';

describe('nextSessionNumber', () => {
  it('starts at 1 — there is no session zero', () => {
    expect(nextSessionNumber([])).toBe(1);
  });

  it('takes the lowest free slot so a closed session is reused', () => {
    expect(nextSessionNumber([1, 3, 4])).toBe(2);
  });

  it('is order-independent — the argument is a set, not a sequence', () => {
    expect(nextSessionNumber([4, 1, 3])).toBe(2);
  });

  it('returns null past nine rather than inventing an unreachable slot', () => {
    expect(nextSessionNumber([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBeNull();
  });

  it('ignores numbers outside the addressable range', () => {
    expect(nextSessionNumber([1, 2, 99, -1, 0])).toBe(3);
  });

  it('tolerates duplicates without skipping a free slot', () => {
    expect(nextSessionNumber([1, 1, 1])).toBe(2);
  });

  it('addresses exactly the keys Ctrl+1..9 can produce', () => {
    expect(MAX_SESSION_NUMBER).toBe(9);
  });
});
