import { describe, it, expect } from 'vitest';
import { Terminal } from '@xterm/headless';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { linesFrom } from './xtermLines';
import { DOOM_PALETTE } from './palette';

/** xterm parses on a scheduled callback, so every read must follow the write. */
const feed = (term: Terminal, data: string) =>
  new Promise<void>((resolve) => term.write(data, resolve));

const makeTerm = (cols = 40, rows = 10) => {
  const term = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 100 });
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = '11';
  return term;
};

// Trailing whitespace is trimmed the way the sibling suites do: a blank row
// deliberately carries a single space so its div does not collapse to no height.
const plain = (lines: { spans: { text: string }[] }[]) =>
  lines.map((l) => l.spans.map((s) => s.text).join('').replace(/\s+$/, ''));

describe('linesFrom', () => {
  it('renders plain text as a single span', async () => {
    const term = makeTerm();
    await feed(term, 'hello world');
    expect(plain(linesFrom(term.buffer.active, 0))[0]).toBe('hello world');
  });

  it('splits a run at each attribute change and maps the Doom palette', async () => {
    const term = makeTerm();
    await feed(term, 'plain \x1b[32mgreen\x1b[0m');
    const spans = linesFrom(term.buffer.active, 0)[0].spans;
    expect(spans[0].text).toBe('plain ');
    expect(spans[0].fg).toBeUndefined();
    expect(spans[1].text).toBe('green');
    expect(spans[1].fg).toBe(DOOM_PALETTE.green);
  });

  it('carries every attribute the span model has', async () => {
    const term = makeTerm();
    await feed(term, '\x1b[1;3;4;7;9;2mx');
    const s = linesFrom(term.buffer.active, 0)[0].spans[0];
    expect(s.bold).toBe(true);
    expect(s.italic).toBe(true);
    expect(s.underline).toBe(true);
    expect(s.invert).toBe(true);
    expect(s.strikethrough).toBe(true);
    expect(s.dim).toBe(true);
  });

  it('reads a 24-bit colour as rgb()', async () => {
    const term = makeTerm();
    await feed(term, '\x1b[38;2;10;20;30mx');
    expect(linesFrom(term.buffer.active, 0)[0].spans[0].fg).toBe('rgb(10, 20, 30)');
  });

  it('emits a wide character once, not twice', async () => {
    // The live defect: with no width model a two-cell glyph advanced one cell
    // and every column after it sheared.
    const term = makeTerm();
    await feed(term, '\u{1f389}A');
    expect(plain(linesFrom(term.buffer.active, 0))[0]).toBe('\u{1f389}A');
  });

  it('trims trailing blanks so a row is not full-width whitespace', async () => {
    const term = makeTerm();
    await feed(term, 'short');
    expect(plain(linesFrom(term.buffer.active, 0))[0]).toBe('short');
  });

  it('flags a line that announces a failure', async () => {
    const term = makeTerm();
    await feed(term, 'error: something broke');
    expect(linesFrom(term.buffer.active, 0)[0].isError).toBe(true);
  });

  it('does not flag an ordinary line that merely contains the word', async () => {
    const term = makeTerm();
    await feed(term, 'grep -rn error src/');
    expect(linesFrom(term.buffer.active, 0)[0].isError).toBe(false);
  });

  it('starts where it is told, for a block reading from its mark', async () => {
    const term = makeTerm();
    await feed(term, 'one\r\ntwo\r\nthree\r\n');
    expect(plain(linesFrom(term.buffer.active, 1))).toEqual(['two', 'three', '']);
  });

  it('gives every row a stable id for React to key on', async () => {
    const term = makeTerm();
    await feed(term, 'a\r\nb\r\n');
    const ids = linesFrom(term.buffer.active, 0).map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marks wrapped continuation lines with isWrapped', async () => {
    const term = makeTerm(10, 5);
    await feed(term, '1234567890ABCDE');
    const lines = linesFrom(term.buffer.active, 0);
    expect(lines.length).toBe(2);
    expect(lines[0].isWrapped).toBe(false);
    expect(lines[1].isWrapped).toBe(true);
  });
});
