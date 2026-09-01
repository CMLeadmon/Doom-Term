import { describe, it, expect } from 'vitest';
import { turnStarts } from './turnMarks';
import type { AnsiLine } from '../types/terminal';

const lines = (...texts: string[]): AnsiLine[] =>
  texts.map((t, i) => ({ id: String(i), spans: [{ text: t }], isError: false, timestamp: 0 }));

describe('turnStarts', () => {
  it('marks a claude turn at its prompt marker', () => {
    const ls = lines('  reading file', '> fix the resize path', '  edit ptyClient.ts');
    expect(turnStarts(ls, 'claude')).toEqual(new Set([1]));
  });

  it('marks nothing for a bare shell — there are no turns to mark', () => {
    expect(turnStarts(lines('$ ls', 'a  b  c', '$ pwd'), null).size).toBe(0);
  });

  it('does not mark a marker that appears mid-line', () => {
    // A diff line containing "> " is not the start of a turn. An unanchored
    // match finds several of these per screen, and a gutter mark in the wrong
    // place is worse than none — it is a boundary you navigate to and find
    // nothing at.
    expect(turnStarts(lines('  -  if (x) { return > y; }'), 'claude').size).toBe(0);
  });

  it('is empty rather than throwing for an unknown agent', () => {
    expect(turnStarts(lines('> hello'), 'some-new-agent').size).toBe(0);
  });

  it('joins spans before matching, because a line is coloured in pieces', () => {
    const split: AnsiLine[] = [{
      id: '0', isError: false, timestamp: 0,
      spans: [{ text: '> ' }, { text: 'fix the thing' }],
    }];
    expect(turnStarts(split, 'claude')).toEqual(new Set([0]));
  });

  it('treats agy and antigravity as the same product', () => {
    const ls = lines('> do the thing');
    expect(turnStarts(ls, 'agy')).toEqual(turnStarts(ls, 'antigravity'));
    expect(turnStarts(ls, 'agy').size).toBe(1);
  });
});
