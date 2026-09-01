import { describe, it, expect, beforeEach } from 'vitest';
import {
  attach, detach, reattach, runSearch, stepHit, stateOf, resetScrollback, findHits,
} from './scrollback';
import type { AnsiLine } from '../types/terminal';

const lines = (...texts: string[]): AnsiLine[] =>
  texts.map((t, i) => ({ id: String(i), spans: [{ text: t }], isError: false, timestamp: 0 }));

describe('findHits', () => {
  /*
   * @xterm/addon-search cannot do this job. It loads against @xterm/headless
   * but findNext() throws — it reaches for getSelectionPosition(), which is a
   * renderer concern headless does not have. Verified 2026-08-31. So the search
   * runs over the AnsiLines we already render, which needs no new dependency.
   */
  it('finds a match regardless of case', () => {
    expect(findHits(lines('the RESIZE path', 'nothing', 'resize again'), 'resize')).toEqual([0, 2]);
  });

  it('matches across spans, because a line is coloured in pieces', () => {
    const split: AnsiLine[] = [{
      id: '0', isError: false, timestamp: 0,
      spans: [{ text: 'the re' }, { text: 'size path' }],
    }];
    expect(findHits(split, 'resize')).toEqual([0]);
  });

  it('is empty for an empty query rather than matching every line', () => {
    expect(findHits(lines('a', 'b'), '')).toEqual([]);
    expect(findHits(lines('a', 'b'), '   ')).toEqual([]);
  });

  it('treats the query as text, not a pattern', () => {
    // A user searching for a regex character must not get a regex.
    expect(findHits(lines('cost is $5.00', 'cost is $500'), '$5.00')).toEqual([0]);
  });
});

describe('scrollback', () => {
  beforeEach(() => resetScrollback());

  it('follows the tail until you scroll away from it', () => {
    attach('s1', 100);
    expect(stateOf('s1').detached).toBe(false);
    detach('s1', 40);
    expect(stateOf('s1')).toMatchObject({ detached: true, line: 40, total: 100 });
  });

  it('reattaching returns you to the tail', () => {
    attach('s1', 100);
    detach('s1', 40);
    reattach('s1');
    expect(stateOf('s1')).toMatchObject({ detached: false, line: 100 });
  });

  it('reports hit position one-based so it reads as "1 of 3"', () => {
    attach('s1', 100);
    runSearch('s1', 'resize', lines('resize', 'no', 'resize', 'resize'));
    expect(stateOf('s1')).toMatchObject({ query: 'RESIZE', hit: 1, hits: 3 });
  });

  it('stepping wraps rather than stopping at the end', () => {
    attach('s1', 100);
    runSearch('s1', 'x', lines('x', 'x'));
    stepHit('s1', 1);
    expect(stateOf('s1').hit).toBe(2);
    stepHit('s1', 1);
    expect(stateOf('s1').hit).toBe(1);
    stepHit('s1', -1);
    expect(stateOf('s1').hit).toBe(2);
  });

  it('stepping with no hits does not divide by zero', () => {
    attach('s1', 100);
    runSearch('s1', 'nope', lines('a'));
    stepHit('s1', 1);
    expect(stateOf('s1')).toMatchObject({ hit: 0, hits: 0 });
  });

  it('a search moves you to the hit, which means detaching from the tail', () => {
    attach('s1', 100);
    runSearch('s1', 'x', lines('a', 'b', 'x'));
    expect(stateOf('s1')).toMatchObject({ detached: true, line: 2 });
  });

  it('clearing the query returns you to the tail', () => {
    attach('s1', 100);
    runSearch('s1', 'x', lines('a', 'x'));
    runSearch('s1', '', lines('a', 'x'));
    expect(stateOf('s1')).toMatchObject({ query: '', hits: 0, detached: false });
  });

  it('a session never seen reports attached, not undefined', () => {
    expect(stateOf('never-seen')).toMatchObject({ detached: false, hits: 0, query: '' });
  });

  it('forgets a session when it closes', () => {
    attach('s1', 100);
    detach('s1', 40);
    resetScrollback('s1');
    expect(stateOf('s1').detached).toBe(false);
  });
});
