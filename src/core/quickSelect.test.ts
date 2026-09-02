import { describe, expect, it } from 'vitest';
import type { AnsiLine } from '../types/terminal';
import { findQuickTargets, labelTargets } from './quickSelect';

const lines = (...text: string[]): AnsiLine[] =>
  text.map((value, index) => ({ id: String(index), spans: [{ text: value }], timestamp: 0 }));

describe('findQuickTargets', () => {
  it('extracts developer references with file-line taking precedence over path', () => {
    const targets = findQuickTargets(lines(
      'see src/App.tsx:42 and https://example.com/pr/12',
      'commit deadbeef closes #312 in ./src/core/keymap.ts',
    ));
    expect(targets.map(({ type, value }) => [type, value])).toEqual([
      ['fileLine', 'src/App.tsx:42'],
      ['url', 'https://example.com/pr/12'],
      ['sha', 'deadbeef'],
      ['issue', '#312'],
      ['path', './src/core/keymap.ts'],
    ]);
  });

  it('deduplicates repeated values while preserving first-seen order', () => {
    expect(findQuickTargets(lines('#12 #12')).map((target) => target.value)).toEqual(['#12']);
  });
});

describe('labelTargets', () => {
  it('assigns stable home-row labels without changing target data', () => {
    const targets = findQuickTargets(lines('#1 #2 #3'));
    expect(labelTargets(targets).map((target) => target.label)).toEqual(['a', 's', 'd']);
  });
});
