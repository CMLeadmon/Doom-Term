import { describe, it, expect } from 'vitest';
import { TerminalEmulator } from './terminalEmulator';

/** Visible text of each rendered row, trailing blanks trimmed. */
function rows(emu: TerminalEmulator): string[] {
  return emu.getLines().map((l) => l.spans.map((s) => s.text).join('').replace(/\s+$/, ''));
}

describe('escape sequences never reach the screen', () => {
  it('swallows bracketed paste mode', () => {
    const emu = new TerminalEmulator();
    emu.write('\x1b[?2004hhello\x1b[?2004l');
    expect(rows(emu)).toEqual(['hello']);
  });

  it('swallows cursor visibility, synchronised output and cursor style', () => {
    const emu = new TerminalEmulator();
    emu.write('\x1b[?25l\x1b[?2026hframe\x1b[?2026l\x1b[0 q\x1b[?25h');
    expect(rows(emu)).toEqual(['frame']);
  });

  it('swallows XTMODKEYS and kitty keyboard sequences', () => {
    const emu = new TerminalEmulator();
    emu.write('\x1b[>4;0m\x1b[>5u\x1b[=1;1u\x1b[?utext');
    expect(rows(emu)).toEqual(['text']);
  });

  it('swallows OSC title and shell integration records', () => {
    const emu = new TerminalEmulator();
    emu.write('\x1b]0;user@host:~/dir\x07\x1b]133;D;0\x1b\\ready');
    expect(rows(emu)).toEqual(['ready']);
  });

  it('swallows the ptyxis OSC 3008 record that dominates real prompts', () => {
    const emu = new TerminalEmulator();
    emu.write('\x1b]3008;start=abc;machineid=def;cwd=/tmp\x1b\\backend  index.html');
    expect(rows(emu)).toEqual(['backend  index.html']);
  });

  it('renders an OSC 8 hyperlink as its label, not its URL', () => {
    const emu = new TerminalEmulator();
    emu.write('\x1b]8;;https://example.dev\x07/rc\x1b]8;;\x07');
    expect(rows(emu)).toEqual(['/rc']);
  });

  it('swallows save and restore cursor without emitting stray digits', () => {
    const emu = new TerminalEmulator();
    emu.write('\x1b7text\x1b8');
    expect(rows(emu)).toEqual(['text']);
  });
});

describe('in-line cursor control', () => {
  it('returns to column zero on carriage return instead of starting a new row', () => {
    const emu = new TerminalEmulator();
    emu.write('Downloading  10%\rDownloading  55%\rDownloading 100%');
    expect(rows(emu)).toEqual(['Downloading 100%']);
  });

  it('keeps a spinner on a single row', () => {
    const emu = new TerminalEmulator();
    for (const f of ['⠋', '⠙', '⠹', '⠸', '⠼']) emu.write(`\r${f} Building...`);
    expect(rows(emu)).toEqual(['⠼ Building...']);
  });

  it('moves the cursor back on backspace so following text overwrites', () => {
    const emu = new TerminalEmulator();
    emu.write('abcXX\b\bYY');
    expect(rows(emu)).toEqual(['abcYY']);
  });

  it('advances to the next eight column stop on tab', () => {
    const emu = new TerminalEmulator();
    emu.write('a\tb');
    expect(rows(emu)).toEqual(['a       b']);
  });

  it('erases to end of line on EL', () => {
    const emu = new TerminalEmulator();
    emu.write('STALE TEXT HERE\r\x1b[Kfresh');
    expect(rows(emu)).toEqual(['fresh']);
  });

  it('pads columns on cursor-forward so words do not fuse', () => {
    const emu = new TerminalEmulator();
    emu.write('Run\x1b[3C/init\x1b[3Cto create');
    expect(rows(emu)).toEqual(['Run   /init   to create']);
  });
});

describe('parser state survives chunk boundaries', () => {
  it('keeps the active colour across separate writes', () => {
    const emu = new TerminalEmulator();
    emu.write('\x1b[32mline one\nline t');
    emu.write('wo\nline three\x1b[0m\n');
    const lines = emu.getLines();
    expect(rows(emu).slice(0, 3)).toEqual(['line one', 'line two', 'line three']);
    for (const l of lines.slice(0, 3)) {
      expect(l.spans[0].fg).toBe('#00ff41');
    }
  });

  it('reassembles an escape sequence split across two writes', () => {
    const emu = new TerminalEmulator();
    emu.write('red then \x1b[3');
    emu.write('1mRED');
    const line = emu.getLines()[0];
    expect(line.spans.map((s) => s.text).join('')).toBe('red then RED');
    expect(line.spans[line.spans.length - 1].fg).toBe('#ff4444');
  });

  it('reassembles an OSC split across two writes', () => {
    const emu = new TerminalEmulator();
    emu.write('\x1b]0;some ti');
    emu.write('tle\x07visible');
    expect(rows(emu)).toEqual(['visible']);
  });
});

describe('cursor addressing', () => {
  it('places text by absolute position instead of appending it', () => {
    const emu = new TerminalEmulator({ cols: 40, rows: 6 });
    emu.write('\x1b[1;1H┌────────┐');
    emu.write('\x1b[2;1H│ Codex  │');
    emu.write('\x1b[3;1H└────────┘');
    expect(rows(emu)).toEqual(['┌────────┐', '│ Codex  │', '└────────┘']);
  });

  it('overwrites in place when the cursor is moved back up', () => {
    const emu = new TerminalEmulator({ cols: 40, rows: 6 });
    emu.write('first\r\nsecond\r\n');
    emu.write('\x1b[2A\x1b[0Kredrawn');
    expect(rows(emu)).toEqual(['redrawn', 'second']);
  });

  it('clears the screen on ED 2', () => {
    const emu = new TerminalEmulator({ cols: 40, rows: 6 });
    emu.write('junk one\r\njunk two\r\n');
    emu.write('\x1b[2J\x1b[Hclean');
    expect(rows(emu)).toEqual(['clean']);
  });

  it('erases characters under the cursor on ECH', () => {
    const emu = new TerminalEmulator({ cols: 40, rows: 4 });
    emu.write('abcdefgh\r\x1b[3C\x1b[3X');
    expect(rows(emu)).toEqual(['abc   gh']);
  });
});

describe('alternate screen', () => {
  it('keeps its content separate from the shell buffer', () => {
    const emu = new TerminalEmulator({ cols: 40, rows: 5 });
    emu.write('shell line\r\n');
    emu.write('\x1b[?1049h\x1b[Hfullscreen app');
    expect(emu.isAltScreen()).toBe(true);
    expect(rows(emu)).toEqual(['fullscreen app']);

    emu.write('\x1b[?1049l');
    expect(emu.isAltScreen()).toBe(false);
    expect(rows(emu)).toEqual(['shell line', '']);
  });
});

// The `shell integration and working directory` suite that stood here asserted
// on onPromptStart/onCommandStart/onExecutionStart/onExecutionEnd/onCwd. That
// interface is gone: `configureEmulators` never had a caller, so none of those
// callbacks ever fired in the running app, and the Rust demuxer supplies every
// one of them as a typed DemuxEvent. Coverage moved rather than disappeared —
// see demuxer.rs: test_osc_133_demuxing, osc_3008_reports_the_working_directory,
// osc_7_reports_the_working_directory. That these records never reach the
// screen is still covered above, in `escape sequences never reach the screen`.

describe('block scoping via marks', () => {
  it('returns only the rows produced after the mark', () => {
    const emu = new TerminalEmulator({ cols: 40, rows: 4 });
    emu.write('old one\r\nold two\r\n');
    const mark = emu.mark();
    emu.write('new one\r\nnew two\r\n');
    const text = emu.linesSince(mark).map((l) => l.spans.map((s) => s.text).join('').replace(/\s+$/, ''));
    expect(text).toEqual(['new one', 'new two', '']);
  });

  it('still scopes correctly after rows have scrolled into scrollback', () => {
    const emu = new TerminalEmulator({ cols: 40, rows: 3 });
    for (let i = 1; i <= 8; i++) emu.write(`line ${i}\r\n`);
    const mark = emu.mark();
    for (let i = 9; i <= 12; i++) emu.write(`line ${i}\r\n`);
    const text = emu.linesSince(mark).map((l) => l.spans.map((s) => s.text).join('').replace(/\s+$/, ''));
    expect(text).toEqual(['line 9', 'line 10', 'line 11', 'line 12', '']);
  });
});

describe('error detection is anchored, not keyword soup', () => {
  const flag = (s: string) => {
    const emu = new TerminalEmulator();
    emu.write(s);
    return emu.getLines()[0].isError === true;
  };

  it('flags real failure announcements', () => {
    expect(flag("error: pathspec 'nope' did not match any file(s) known to git")).toBe(true);
    expect(flag('fatal: not a git repository')).toBe(true);
    expect(flag('npm ERR! code ELIFECYCLE')).toBe(true);
    expect(flag('src/main.rs:12:5: error[E0433]: failed to resolve')).toBe(true);
    expect(flag('Traceback (most recent call last):')).toBe(true);
  });

  it('does not flag ordinary lines that merely contain the word', () => {
    expect(flag('src/errorHandler.go')).toBe(false);
    expect(flag('commit 1a2b3c fix error handling')).toBe(false);
    expect(flag('69:      /\\b(error|panic|fatal|exception)\\b/i.test(rawLine) ||')).toBe(false);
    expect(flag('grep -rn --color=always error src/core/ansiParser.ts')).toBe(false);
    expect(flag('all tests passed')).toBe(false);
  });
});

describe('regression: bytes captured from the live PTY daemon', () => {
  it('renders a real prompt with no escape debris', () => {
    const emu = new TerminalEmulator({ cols: 120, rows: 30 });
    emu.write(
      '\x1b[?2004l\r\r\n\x1b]0;cleadmon@SER6-MAX:~/Projects/Doom Term\x07' +
        '\x1b]3008;end=495defbd;exit=success\x1b\\' +
        '\x1b]3008;start=5037d730;machineid=2ad0ceaf;user=cleadmon;hostname=SER6-MAX;cwd=/home/cleadmon/Projects/Doom Term\x1b\\' +
        '\x1b[?2004h\x1b[01;32mcleadmon@SER6-MAX\x1b[00m:\x1b[01;34m~/Projects/Doom Term\x1b[00m$ '
    );
    const text = rows(emu);
    expect(text.join('\n')).not.toMatch(/\?2004|]0;|]3008|machineid/);
    expect(text[text.length - 1]).toBe('cleadmon@SER6-MAX:~/Projects/Doom Term$');
  });

  it('renders a real ls row without the OSC blob glued to its front', () => {
    const emu = new TerminalEmulator({ cols: 120, rows: 30 });
    emu.write(
      '\x1b]3008;start=55e4f8ff;machineid=2ad0ceaf;type=command;cwd=/home/cleadmon/Projects/Doom Term\x1b\\' +
        'backend                 index.html         postcss.config.js\r\n' +
        'dist                    node_modules       public\r\n'
    );
    expect(rows(emu)[0]).toBe('backend                 index.html         postcss.config.js');
  });
});
