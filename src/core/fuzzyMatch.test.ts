import { describe, expect, it } from 'vitest';
import { fuzzyScore, fuzzyMatches } from './fuzzyMatch';

describe('fuzzy switcher search', () => {
  it('matches an initialism the way the README says it does', () => {
    // The palette filtered with `includes`, which is a substring search. The
    // README called it fuzzy, so the documented way to reach a session simply
    // did not work.
    expect(fuzzyMatches('doom-term-server', 'dtsrv')).toBe(true);
    expect(fuzzyMatches('src/core/paneTree.ts', 'scpt')).toBe(true);
  });

  it('still refuses a query whose characters are not all there', () => {
    expect(fuzzyScore('doom-term-server', 'dtxyz')).toBeNull();
    expect(fuzzyScore('', 'a')).toBeNull();
  });

  it('ranks a literal substring above a scattered subsequence', () => {
    const literal = fuzzyScore('deploy indexer', 'index')!;
    const scattered = fuzzyScore('i need an example of dexterity', 'index')!;
    expect(literal).toBeGreaterThan(scattered);
  });

  it('prefers a match at a word boundary over one buried mid-word', () => {
    const boundary = fuzzyScore('run tests', 'tests')!;
    const buried = fuzzyScore('contests', 'tests')!;
    expect(boundary).toBeGreaterThan(buried);
  });

  it('is case-insensitive in both directions', () => {
    expect(fuzzyMatches('INDEXER', 'index')).toBe(true);
    expect(fuzzyMatches('indexer', 'INDEX')).toBe(true);
  });

  it('treats an empty query as matching everything, neutrally', () => {
    expect(fuzzyScore('anything', '')).toBe(0);
    expect(fuzzyScore('anything', '   ')).toBe(0);
  });
});
