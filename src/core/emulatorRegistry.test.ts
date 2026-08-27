import { describe, it, expect, beforeEach } from 'vitest';
import { getEmulator, disposeEmulator, resetAllEmulators } from './emulatorRegistry';

const text = (lines: { spans: { text: string }[] }[]) =>
  lines.map((l) => l.spans.map((s) => s.text).join('').replace(/\s+$/, ''));

describe('emulator registry', () => {
  beforeEach(() => resetAllEmulators());

  it('hands back the same emulator for a session so state survives chunks', () => {
    getEmulator('s1').write('\x1b[32mgreen start');
    getEmulator('s1').write(' and still green');
    const line = getEmulator('s1').getLines()[0];
    expect(line.spans.every((s) => s.fg === '#00ff41')).toBe(true);
    expect(text([line])).toEqual(['green start and still green']);
  });

  it('keeps sessions isolated from one another', () => {
    getEmulator('a').write('output for a\r\n');
    getEmulator('b').write('output for b\r\n');
    expect(text(getEmulator('a').getLines())[0]).toBe('output for a');
    expect(text(getEmulator('b').getLines())[0]).toBe('output for b');
  });

  it('produces the same rows whether bytes arrive in one chunk or many', () => {
    const stream =
      '\x1b]3008;start=x;cwd=/tmp\x1b\\\x1b[?2004l' +
      '\x1b[31mError count: 3\x1b[0m\r\nplain row\r\nDownloading  10%\rDownloading 100%\r\n';

    getEmulator('whole').write(stream);
    for (let i = 0; i < stream.length; i += 7) getEmulator('split').write(stream.slice(i, i + 7));

    expect(text(getEmulator('split').getLines())).toEqual(text(getEmulator('whole').getLines()));
  });

  it('forgets a session when it is disposed', () => {
    getEmulator('gone').write('stale content\r\n');
    disposeEmulator('gone');
    expect(text(getEmulator('gone').getLines())).toEqual(['']);
  });
});
