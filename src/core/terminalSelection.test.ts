import { describe, expect, it } from 'vitest';
import type { AnsiLine } from '../types/terminal';
import { prepareClipboardText, commandRegion } from './terminalSelection';

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

describe('prepareClipboardText', () => {
  it('leaves framing to the daemon and refuses multiline input with no observed support', () => {
    expect(prepareClipboardText('one', false)).toBe('one');
    expect(prepareClipboardText('one', true)).toBe('one');
    expect(prepareClipboardText('one\ntwo', true)).toBe('one\ntwo');
    expect(prepareClipboardText('one\ntwo', false)).toBeNull();
  });
  it('treats CR and CRLF as pasted line breaks rather than unbracketed Enter keys', () => {
    expect(prepareClipboardText('one\rtwo\r\nthree', true)).toBe('one\ntwo\nthree');
    expect(prepareClipboardText('one\rtwo', false)).toBeNull();
  });
  it('does not allow clipboard control bytes to terminate a paste or send keyboard signals', () => {
    expect(prepareClipboardText('one\x1b[201~\n\x03two\x1a\x04\x7f', true)).toBe('one[201~\ntwo');
    expect(prepareClipboardText('中文\t🚀\x00', false)).toBe('中文\t🚀');
  });
  it('rejects oversized input before normalization can hide its size', () => {
    expect(() => prepareClipboardText('\x00'.repeat(1024 * 1024 + 1), true)).toThrow(/1 MiB/);
    expect(() => prepareClipboardText('三'.repeat(350000), true)).toThrow(/1 MiB/);
  });
});
