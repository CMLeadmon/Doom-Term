'use strict';
/* A key script for the capture shim: a timeline of key presses and mouse movements counted in frames drawn,
   written as the lines "FRAME down|up KEY" and "FRAME mouse DX DY" the shim reads. The game turns held keys and
   mouse movement into motion the way it does for a person at a keyboard, so the script plays the level as a player would. */
const NAMED = ['up', 'down', 'left', 'right', 'ctrl', 'shift', 'alt', 'space', 'enter', 'esc', 'tab', 'comma', 'period'];

const isKey = (key) => NAMED.includes(key) || /^[a-z0-9]$/.test(key);

class KeyScript {
  constructor() {
    this.events = [];
  }

  down(frame, key) { return this.add(frame, 'down', key); }

  up(frame, key) { return this.add(frame, 'up', key); }

  /* Press and release after `frames` frames */
  tap(frame, key, frames = 2) { return this.down(frame, key).up(frame + frames, key); }

  /* Hold from frame `from` until frame `to` */
  hold(from, to, key) {
    if (to <= from) throw new Error(`hold of ${key} from ${from} to ${to} is empty`);
    return this.down(from, key).up(to, key);
  }

  /* Type a word one letter at a time, as a cheat code is typed */
  type(frame, text, gap = 3) {
    [...text].forEach((ch, i) => this.tap(frame + i * gap, ch, 1));
    return this;
  }

  /* Move the mouse by (dx, dy) on the game tic that draws `frame`. A positive dx turns to the right. */
  mouse(frame, dx, dy) {
    if (!Number.isInteger(frame) || frame < 0) throw new Error(`frame ${frame} is not a whole number of frames`);
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) throw new Error(`mouse movement ${dx},${dy} is not whole`);
    this.events.push({ frame, action: 'mouse', dx, dy, order: this.events.length });
    return this;
  }

  add(frame, action, key) {
    if (!Number.isInteger(frame) || frame < 0) throw new Error(`frame ${frame} is not a whole number of frames`);
    if (!isKey(key)) throw new Error(`unknown key ${JSON.stringify(key)}`);
    this.events.push({ frame, action, key, order: this.events.length });
    return this;
  }

  /* In time order. At one frame, releases come before presses so a key tapped twice in a row registers twice. */
  sorted() {
    return [...this.events].sort((a, b) => a.frame - b.frame || (a.action === 'up' ? -1 : 1) - (b.action === 'up' ? -1 : 1) || a.order - b.order);
  }

  /* Every key goes down before it comes up, never goes down twice, and is up at the end */
  validate() {
    const held = new Set();
    for (const e of this.sorted()) {
      if (e.action === 'mouse') continue;
      if (e.action === 'down') {
        if (held.has(e.key)) throw new Error(`${e.key} goes down at ${e.frame} while already held`);
        held.add(e.key);
      } else {
        if (!held.has(e.key)) throw new Error(`${e.key} comes up at ${e.frame} without being held`);
        held.delete(e.key);
      }
    }
    if (held.size) throw new Error(`still held at the end: ${[...held].join(', ')}`);
    return this;
  }

  text() {
    this.validate();
    return `${this.sorted().map((e) => (e.action === 'mouse' ? `${e.frame} mouse ${e.dx} ${e.dy}` : `${e.frame} ${e.action} ${e.key}`)).join('\n')}\n`;
  }

  /* The script a text file holds, in the order it lists the lines */
  static parse(text) {
    const script = new KeyScript();
    text.split('\n').forEach((line, i) => {
      if (!line.trim() || line.startsWith('#')) return;
      const [frame, action, a, b] = line.trim().split(/\s+/);
      const at = Number(frame);
      if (action === 'mouse') script.mouse(at, Number(a), Number(b));
      else if (action === 'down' || action === 'up') script.add(at, action, a);
      else throw new Error(`line ${i + 1} is not a key script line: ${line}`);
    });
    return script;
  }
}

/* How many game tics a held turn key needs to turn `degrees`. The first six tics of a turn are slow
   (1.76 degrees a tic); then a turn is 3.52 a tic, or 7.03 with shift held. */
function turnTics(degrees, fast = false) {
  const slow = 6 * 1.758;
  if (degrees <= slow) return Math.round(degrees / 1.758);
  return Math.round(6 + (degrees - slow) / (fast ? 7.031 : 3.516));
}

module.exports = { KeyScript, turnTics, NAMED, isKey };
