import { describe, expect, it } from 'vitest';
import type { AnsiLine } from '../types/terminal';
import { bracketPaste, commandRegion } from './terminalSelection';

const lines = (...text: string[]): AnsiLine[] =>
  text.map((value, index) => ({ id: String(index), spans: [{ text: value }], timestamp: 0 }));

describe('commandRegion', () => {
  it('selects from the preceding prompt through the line before the next prompt', () => {
    expect(commandRegion(lines('old', '> build', 'output', 'done', '> test', 'green'), 2, new Set([1, 4])))
      .toEqual({ start: 1, end: 3 });
  });

  it('selects one line when no trustworthy boundaries exist', () => {
    expect(commandRegion(lines('one', 'two'), 1, new Set())).toEqual({ start: 1, end: 1 });
  });
});

describe('bracketPaste', () => {
  it('brackets multiline input but leaves a single line untouched', () => {
    expect(bracketPaste('one')).toBe('one');
    expect(bracketPaste('one\ntwo')).toBe('\x1b[200~one\ntwo\x1b[201~');
  });
  it('treats CR and CRLF as pasted line breaks rather than unbracketed Enter keys', () => {
    expect(bracketPaste('one\rtwo\r\nthree')).toBe('\x1b[200~one\ntwo\nthree\x1b[201~');
  });
  it('does not allow clipboard control bytes to terminate a paste or send keyboard signals', () => {
    expect(bracketPaste('one\x1b[201~\n\x03two\x1a\x04\x7f')).toBe('\x1b[200~one[201~\ntwo\x1b[201~');
    expect(bracketPaste('中文\t🚀\x00')).toBe('中文\t🚀');
  });
});
