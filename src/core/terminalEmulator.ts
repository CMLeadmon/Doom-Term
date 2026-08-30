import type { AnsiLine, AnsiSpan } from '../types/terminal';
import type { TerminalScreen } from './terminalScreen';
import { BRIGHT_COLORS, STANDARD_COLORS, looksLikeError, parse256Color } from './palette';

export { DOOM_PALETTE, parse256Color, looksLikeError } from './palette';

export interface Attr {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  invert?: boolean;
}

const BLANK_ATTR: Attr = {};

function sameAttr(a: Attr, b: Attr): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    !!a.bold === !!b.bold &&
    !!a.dim === !!b.dim &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline &&
    !!a.strikethrough === !!b.strikethrough &&
    !!a.invert === !!b.invert
  );
}

interface Cell {
  ch: string;
  attr: Attr;
}

interface Row {
  id: number;
  cells: Cell[];
}

export interface TerminalEmulatorOptions {
  cols?: number;
  rows?: number;
  scrollbackLimit?: number;
  /** Treat LF as CRLF. PTYs deliver CRLF anyway; this keeps bare-LF streams from staircasing. */
  convertEol?: boolean;
}

type State = 'ground' | 'esc' | 'csi' | 'osc' | 'string' | 'charset';

let rowSeq = 0;

class Buffer {
  rows: Row[] = [];
  cursorX = 0;
  cursorY = 0;
  savedX = 0;
  savedY = 0;
  savedAttr: Attr = BLANK_ATTR;
  scrollTop = 0;
  scrollBottom: number;

  cols: number;
  height: number;

  constructor(cols: number, height: number) {
    this.cols = cols;
    this.height = height;
    this.scrollBottom = height - 1;
    for (let i = 0; i < height; i++) this.rows.push({ id: rowSeq++, cells: [] });
  }
}

export class TerminalEmulator implements TerminalScreen {
  private cols: number;
  private rowCount: number;
  private scrollbackLimit: number;
  private convertEol: boolean;
  private parsedListeners = new Set<() => void>();

  private normal: Buffer;
  private alt: Buffer;
  private active: Buffer;
  private altActive = false;

  private scrollback: Row[] = [];
  /** Rows that have ever left the screen, including those trimmed from scrollback. */
  private totalScrolled = 0;

  private attr: Attr = BLANK_ATTR;
  private state: State = 'ground';
  private params = '';
  private intermediates = '';
  private privatePrefix = '';
  private stringBuf = '';
  private pendingEsc = false; // saw ESC while inside a string, waiting for '\'

  constructor(opts: TerminalEmulatorOptions = {}) {
    this.cols = opts.cols ?? 120;
    this.rowCount = opts.rows ?? 30;
    this.scrollbackLimit = opts.scrollbackLimit ?? 5000;
    this.convertEol = opts.convertEol ?? true;
    this.normal = new Buffer(this.cols, this.rowCount);
    this.alt = new Buffer(this.cols, this.rowCount);
    this.active = this.normal;
  }

  // ---------------------------------------------------------------- public

  write(data: string): void {
    for (const ch of data) {
      switch (this.state) {
        case 'ground':
          this.ground(ch);
          break;
        case 'esc':
          this.escape(ch);
          break;
        case 'csi':
          this.csi(ch);
          break;
        case 'osc':
        case 'string':
          this.stringState(ch);
          break;
        case 'charset':
          this.state = 'ground';
          break;
      }
    }
    for (const cb of this.parsedListeners) cb();
  }

  /** Synchronous parser: the bytes are on screen before write() returns. */
  onParsed(cb: () => void): () => void {
    this.parsedListeners.add(cb);
    return () => this.parsedListeners.delete(cb);
  }

  dispose(): void {
    this.parsedListeners.clear();
  }

  isAltScreen(): boolean {
    return this.altActive;
  }

  /** Logical index of the row the cursor is on; pass to linesSince() later. */
  mark(): number {
    return this.altActive ? 0 : this.totalScrolled + this.active.cursorY;
  }

  getLines(): AnsiLine[] {
    if (this.altActive) return this.renderRows(this.usedRows(this.alt));
    return this.renderRows([...this.scrollback, ...this.usedRows(this.normal)]);
  }

  linesSince(mark: number): AnsiLine[] {
    if (this.altActive) return this.getLines();
    const firstLogical = this.totalScrolled - this.scrollback.length;
    const all = [...this.scrollback, ...this.usedRows(this.normal)];
    const from = Math.max(0, mark - firstLogical);
    return this.renderRows(all.slice(from));
  }

  resize(cols: number, rows: number): void {
    this.cols = Math.max(1, cols);
    const next = Math.max(1, rows);
    for (const buf of [this.normal, this.alt]) {
      buf.cols = this.cols;
      while (buf.rows.length < next) buf.rows.push({ id: rowSeq++, cells: [] });
      while (buf.rows.length > next) buf.rows.pop();
      buf.height = next;
      buf.scrollTop = Math.min(buf.scrollTop, next - 1);
      buf.scrollBottom = next - 1;
      buf.cursorY = Math.min(buf.cursorY, next - 1);
      buf.cursorX = Math.min(buf.cursorX, this.cols - 1);
    }
    this.rowCount = next;
  }

  reset(): void {
    this.normal = new Buffer(this.cols, this.rowCount);
    this.alt = new Buffer(this.cols, this.rowCount);
    this.active = this.normal;
    this.altActive = false;
    this.scrollback = [];
    this.totalScrolled = 0;
    this.attr = BLANK_ATTR;
    this.state = 'ground';
  }

  // --------------------------------------------------------------- render

  private usedRows(buf: Buffer): Row[] {
    let last = buf.cursorY;
    for (let i = buf.rows.length - 1; i > last; i--) {
      if (buf.rows[i].cells.length > 0) {
        last = i;
        break;
      }
    }
    return buf.rows.slice(0, last + 1);
  }

  private renderRows(rows: Row[]): AnsiLine[] {
    return rows.map((row) => this.renderRow(row));
  }

  private renderRow(row: Row): AnsiLine {
    const spans: AnsiSpan[] = [];
    let text = '';
    let run: Attr | null = null;

    const flush = () => {
      if (text.length === 0) return;
      const a = run ?? BLANK_ATTR;
      spans.push({
        text,
        fg: a.fg,
        bg: a.bg,
        bold: a.bold,
        dim: a.dim,
        italic: a.italic,
        underline: a.underline,
        strikethrough: a.strikethrough,
        invert: a.invert,
      });
      text = '';
    };

    // Trailing blank cells carry no information; drop them so rows do not
    // render as full-width whitespace.
    let end = row.cells.length;
    while (end > 0) {
      const c = row.cells[end - 1];
      if (c && c.ch !== ' ') break;
      if (c && c.attr.bg) break;
      end--;
    }

    for (let i = 0; i < end; i++) {
      const cell = row.cells[i] ?? { ch: ' ', attr: BLANK_ATTR };
      if (run === null || !sameAttr(run, cell.attr)) {
        flush();
        run = cell.attr;
      }
      text += cell.ch;
    }
    flush();

    const plain = spans.map((s) => s.text).join('');
    if (spans.length === 0) spans.push({ text: ' ' });

    return {
      id: `row-${row.id}`,
      spans,
      isError: looksLikeError(plain),
      timestamp: Date.now(),
    };
  }

  // ---------------------------------------------------------------- ground

  private ground(ch: string): void {
    const code = ch.codePointAt(0)!;

    if (code === 0x1b) {
      this.state = 'esc';
      return;
    }
    if (code === 0x07) {
      return; // BEL places no glyph
    }
    if (code === 0x0d) {
      this.active.cursorX = 0;
      return;
    }
    if (code === 0x0a || code === 0x0b || code === 0x0c) {
      if (this.convertEol) this.active.cursorX = 0;
      this.lineFeed();
      return;
    }
    if (code === 0x08) {
      this.active.cursorX = Math.max(0, this.active.cursorX - 1);
      return;
    }
    if (code === 0x09) {
      const next = Math.min(this.cols - 1, (Math.floor(this.active.cursorX / 8) + 1) * 8);
      this.active.cursorX = next;
      return;
    }
    if (code < 0x20 || code === 0x7f) return; // other C0 controls are not printable

    this.putChar(ch);
  }

  private putChar(ch: string): void {
    const buf = this.active;
    if (buf.cursorX >= this.cols) {
      buf.cursorX = 0;
      this.lineFeed();
    }
    const row = buf.rows[buf.cursorY];
    while (row.cells.length < buf.cursorX) row.cells.push({ ch: ' ', attr: BLANK_ATTR });
    row.cells[buf.cursorX] = { ch, attr: this.attr };
    buf.cursorX++;
  }

  private lineFeed(): void {
    const buf = this.active;
    if (buf.cursorY === buf.scrollBottom) this.scrollUp(1);
    else if (buf.cursorY < buf.height - 1) buf.cursorY++;
  }

  private scrollUp(n: number): void {
    const buf = this.active;
    for (let i = 0; i < n; i++) {
      const removed = buf.rows.splice(buf.scrollTop, 1)[0];
      if (buf === this.normal && buf.scrollTop === 0) {
        this.scrollback.push(removed);
        this.totalScrolled++;
        if (this.scrollback.length > this.scrollbackLimit) this.scrollback.shift();
      }
      buf.rows.splice(buf.scrollBottom, 0, { id: rowSeq++, cells: [] });
    }
  }

  private scrollDown(n: number): void {
    const buf = this.active;
    for (let i = 0; i < n; i++) {
      buf.rows.splice(buf.scrollBottom, 1);
      buf.rows.splice(buf.scrollTop, 0, { id: rowSeq++, cells: [] });
    }
  }

  // ---------------------------------------------------------------- escape

  private escape(ch: string): void {
    switch (ch) {
      case '[':
        this.state = 'csi';
        this.params = '';
        this.intermediates = '';
        this.privatePrefix = '';
        return;
      case ']':
        this.state = 'osc';
        this.stringBuf = '';
        this.pendingEsc = false;
        return;
      case 'P': // DCS
      case '^': // PM
      case '_': // APC
      case 'X': // SOS
        this.state = 'string';
        this.stringBuf = '';
        this.pendingEsc = false;
        return;
      case '(':
      case ')':
      case '*':
      case '+':
      case '-':
      case '.':
      case '/':
      case '%':
        this.state = 'charset';
        return;
      case '7':
        this.active.savedX = this.active.cursorX;
        this.active.savedY = this.active.cursorY;
        this.active.savedAttr = this.attr;
        this.state = 'ground';
        return;
      case '8':
        this.active.cursorX = this.active.savedX;
        this.active.cursorY = this.active.savedY;
        this.attr = this.active.savedAttr;
        this.state = 'ground';
        return;
      case 'D': // IND
        this.lineFeed();
        this.state = 'ground';
        return;
      case 'E': // NEL
        this.active.cursorX = 0;
        this.lineFeed();
        this.state = 'ground';
        return;
      case 'M': // RI
        if (this.active.cursorY === this.active.scrollTop) this.scrollDown(1);
        else if (this.active.cursorY > 0) this.active.cursorY--;
        this.state = 'ground';
        return;
      case 'c': // RIS
        this.reset();
        return;
      default:
        // ESC =, ESC >, ESC #x and friends carry no text
        this.state = 'ground';
        return;
    }
  }

  // ------------------------------------------------------------------- CSI

  private csi(ch: string): void {
    const code = ch.codePointAt(0)!;

    if (this.params === '' && this.intermediates === '' && '<=>?'.includes(ch)) {
      this.privatePrefix = ch;
      return;
    }
    if ((code >= 0x30 && code <= 0x39) || ch === ';' || ch === ':') {
      this.params += ch;
      return;
    }
    if (code >= 0x20 && code <= 0x2f) {
      this.intermediates += ch;
      return;
    }
    if (code >= 0x40 && code <= 0x7e) {
      this.dispatchCsi(ch);
      this.state = 'ground';
      return;
    }
    // Anything else aborts the sequence without printing it.
    this.state = 'ground';
  }

  private numericParams(): number[] {
    if (this.params === '') return [];
    return this.params.split(';').map((p) => {
      const n = parseInt(p.split(':')[0], 10);
      return Number.isNaN(n) ? 0 : n;
    });
  }

  private dispatchCsi(final: string): void {
    const buf = this.active;
    const p = this.numericParams();
    const arg = (i: number, dflt: number) => {
      const v = p[i];
      return v === undefined || v === 0 ? dflt : v;
    };

    // Private / non-standard sequences: modes we care about, everything else dropped.
    if (this.privatePrefix === '?') {
      if (final === 'h' || final === 'l') this.setModes(p, final === 'h');
      return;
    }
    if (this.privatePrefix !== '') return; // '>' XTMODKEYS, '=' kitty, '<' — no text
    if (this.intermediates !== '') return; // DECSCUSR (ESC[0 q) and relatives

    switch (final) {
      case 'm':
        this.applySgr(p);
        return;
      case 'A':
        buf.cursorY = Math.max(0, buf.cursorY - arg(0, 1));
        return;
      case 'B':
      case 'e':
        buf.cursorY = Math.min(buf.height - 1, buf.cursorY + arg(0, 1));
        return;
      case 'C':
      case 'a':
        buf.cursorX = Math.min(this.cols - 1, buf.cursorX + arg(0, 1));
        return;
      case 'D':
        buf.cursorX = Math.max(0, buf.cursorX - arg(0, 1));
        return;
      case 'E':
        buf.cursorY = Math.min(buf.height - 1, buf.cursorY + arg(0, 1));
        buf.cursorX = 0;
        return;
      case 'F':
        buf.cursorY = Math.max(0, buf.cursorY - arg(0, 1));
        buf.cursorX = 0;
        return;
      case 'G':
      case '`':
        buf.cursorX = Math.min(this.cols - 1, arg(0, 1) - 1);
        return;
      case 'd':
        buf.cursorY = Math.min(buf.height - 1, arg(0, 1) - 1);
        return;
      case 'H':
      case 'f':
        buf.cursorY = Math.min(buf.height - 1, arg(0, 1) - 1);
        buf.cursorX = Math.min(this.cols - 1, arg(1, 1) - 1);
        return;
      case 'J':
        this.eraseInDisplay(p[0] ?? 0);
        return;
      case 'K':
        this.eraseInLine(p[0] ?? 0);
        return;
      case 'L':
        this.insertLines(arg(0, 1));
        return;
      case 'M':
        this.deleteLines(arg(0, 1));
        return;
      case '@':
        this.insertChars(arg(0, 1));
        return;
      case 'P':
        this.deleteChars(arg(0, 1));
        return;
      case 'X':
        this.eraseChars(arg(0, 1));
        return;
      case 'S':
        this.scrollUp(arg(0, 1));
        return;
      case 'T':
        this.scrollDown(arg(0, 1));
        return;
      case 'r':
        buf.scrollTop = Math.max(0, arg(0, 1) - 1);
        buf.scrollBottom = Math.min(buf.height - 1, p[1] ? p[1] - 1 : buf.height - 1);
        buf.cursorX = 0;
        buf.cursorY = buf.scrollTop;
        return;
      case 's':
        buf.savedX = buf.cursorX;
        buf.savedY = buf.cursorY;
        return;
      case 'u':
        buf.cursorX = buf.savedX;
        buf.cursorY = buf.savedY;
        return;
      default:
        return; // c, n, t, p … device reports and window ops produce no text
    }
  }

  private setModes(params: number[], set: boolean): void {
    for (const mode of params) {
      if (mode === 1049 || mode === 47 || mode === 1047) {
        this.setAltScreen(set);
      }
      // 25 cursor, 2004 bracketed paste, 2026 sync, 1000-1006 mouse, 1004 focus,
      // 7 autowrap … none of these place glyphs on the screen.
    }
  }

  private setAltScreen(active: boolean): void {
    if (active === this.altActive) return;
    if (active) {
      this.alt = new Buffer(this.cols, this.rowCount);
      this.alt.savedX = this.normal.cursorX;
      this.alt.savedY = this.normal.cursorY;
      this.active = this.alt;
      this.altActive = true;
    } else {
      this.active = this.normal;
      this.altActive = false;
    }
  }

  private rowAt(y: number): Row {
    return this.active.rows[y];
  }

  private eraseInLine(mode: number): void {
    const buf = this.active;
    const row = this.rowAt(buf.cursorY);
    if (mode === 0) {
      row.cells.length = Math.min(row.cells.length, buf.cursorX);
    } else if (mode === 1) {
      for (let i = 0; i <= buf.cursorX && i < row.cells.length; i++) {
        row.cells[i] = { ch: ' ', attr: BLANK_ATTR };
      }
    } else if (mode === 2) {
      row.cells.length = 0;
    }
  }

  private eraseInDisplay(mode: number): void {
    const buf = this.active;
    if (mode === 0) {
      this.eraseInLine(0);
      for (let y = buf.cursorY + 1; y < buf.height; y++) buf.rows[y].cells.length = 0;
    } else if (mode === 1) {
      for (let y = 0; y < buf.cursorY; y++) buf.rows[y].cells.length = 0;
      this.eraseInLine(1);
    } else if (mode === 2) {
      for (let y = 0; y < buf.height; y++) buf.rows[y].cells.length = 0;
    } else if (mode === 3) {
      this.scrollback = [];
    }
  }

  private insertLines(n: number): void {
    const buf = this.active;
    if (buf.cursorY < buf.scrollTop || buf.cursorY > buf.scrollBottom) return;
    for (let i = 0; i < n; i++) {
      buf.rows.splice(buf.scrollBottom, 1);
      buf.rows.splice(buf.cursorY, 0, { id: rowSeq++, cells: [] });
    }
  }

  private deleteLines(n: number): void {
    const buf = this.active;
    if (buf.cursorY < buf.scrollTop || buf.cursorY > buf.scrollBottom) return;
    for (let i = 0; i < n; i++) {
      buf.rows.splice(buf.cursorY, 1);
      buf.rows.splice(buf.scrollBottom, 0, { id: rowSeq++, cells: [] });
    }
  }

  private insertChars(n: number): void {
    const buf = this.active;
    const row = this.rowAt(buf.cursorY);
    while (row.cells.length < buf.cursorX) row.cells.push({ ch: ' ', attr: BLANK_ATTR });
    for (let i = 0; i < n; i++) row.cells.splice(buf.cursorX, 0, { ch: ' ', attr: this.attr });
    row.cells.length = Math.min(row.cells.length, this.cols);
  }

  private deleteChars(n: number): void {
    const row = this.rowAt(this.active.cursorY);
    row.cells.splice(this.active.cursorX, n);
  }

  private eraseChars(n: number): void {
    const buf = this.active;
    const row = this.rowAt(buf.cursorY);
    for (let i = buf.cursorX; i < buf.cursorX + n && i < row.cells.length; i++) {
      row.cells[i] = { ch: ' ', attr: BLANK_ATTR };
    }
  }

  // ------------------------------------------------------------------- SGR

  private applySgr(codes: number[]): void {
    if (codes.length === 0) {
      this.attr = BLANK_ATTR;
      return;
    }
    const next: Attr = { ...this.attr };
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) {
        for (const k of Object.keys(next)) delete (next as Record<string, unknown>)[k];
      } else if (code === 1) next.bold = true;
      else if (code === 2) next.dim = true;
      else if (code === 3) next.italic = true;
      else if (code === 4) next.underline = true;
      else if (code === 7) next.invert = true;
      else if (code === 9) next.strikethrough = true;
      else if (code === 21 || code === 22) {
        next.bold = false;
        next.dim = false;
      } else if (code === 23) next.italic = false;
      else if (code === 24) next.underline = false;
      else if (code === 27) next.invert = false;
      else if (code === 29) next.strikethrough = false;
      else if (code >= 30 && code <= 37) next.fg = STANDARD_COLORS[code - 30];
      else if (code === 39) delete next.fg;
      else if (code >= 40 && code <= 47) next.bg = STANDARD_COLORS[code - 40];
      else if (code === 49) delete next.bg;
      else if (code >= 90 && code <= 97) next.fg = BRIGHT_COLORS[code - 90];
      else if (code >= 100 && code <= 107) next.bg = BRIGHT_COLORS[code - 100];
      else if (code === 38 || code === 48) {
        const target = code === 38 ? 'fg' : 'bg';
        if (codes[i + 1] === 5 && codes.length > i + 2) {
          next[target] = parse256Color(codes[i + 2]);
          i += 2;
        } else if (codes[i + 1] === 2 && codes.length > i + 4) {
          next[target] = `rgb(${codes[i + 2]}, ${codes[i + 3]}, ${codes[i + 4]})`;
          i += 4;
        }
      }
    }
    this.attr = next;
  }

  // ---------------------------------------------------------- OSC and DCS

  private stringState(ch: string): void {
    const code = ch.codePointAt(0)!;

    if (this.pendingEsc) {
      this.pendingEsc = false;
      if (ch === '\\') {
        this.endString();
        return;
      }
      // A lone ESC inside the string terminates it; re-handle this char.
      this.endString();
      this.state = 'ground';
      this.ground('\x1b');
      this.write(ch);
      return;
    }
    if (code === 0x1b) {
      this.pendingEsc = true;
      return;
    }
    if (code === 0x07) {
      this.endString();
      return;
    }
    this.stringBuf += ch;
  }

  /**
   * OSC and DCS records are control traffic, never text. They are consumed and
   * discarded: the Rust demuxer parses the ones that carry meaning (OSC 7, 133,
   * 1337, 3008) and delivers them as typed events, so nothing here needs them.
   */
  private endString(): void {
    this.stringBuf = '';
    this.state = 'ground';
  }

}
