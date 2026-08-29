#!/usr/bin/env node
/**
 * Renders the application icon and hands it to `tauri icon` for the platform
 * formats.
 *
 * The icon is drawn from the same four materials as the plate — plate, recess,
 * 1px bevel pair, ink — at a 64x64 logical size and integer-scaled to 1024, so
 * it stays pixel-exact rather than resampled. The mark is the prompt chevron
 * the agent well falls back to, which is what Doom Term is: a terminal.
 *
 *   node tools/icon/build-icon.mjs          # writes the source PNG
 *   npx tauri icon <source>                 # generates icons/ from it
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from '../hud/png.js';
import { Surface, px, striate, well, upscale, COLORS as C } from '../../src/hud/plate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const SIZE = 64;
const SCALE = 16; // 64 * 16 = 1024, the source size `tauri icon` wants

const s = Surface(SIZE, SIZE);

// The plate face, bevelled like every other surface in the app.
striate(s, 0, 0, SIZE, SIZE, true);

// A recessed screen holding the mark.
const inset = 8;
well(s, inset, inset, SIZE - inset * 2, SIZE - inset * 2, C.markFloor);

// Prompt chevron, drawn thick enough to survive a 32px favicon.
const cx = 27;
const cy = 32;
for (let i = 0; i < 9; i++) {
  px(s, cx - 9 + i, cy - 9 + i, 3, 3, C.mark);
  px(s, cx - 9 + i, cy + 9 - i, 3, 3, C.mark);
}

// The caret that follows it.
px(s, cx + 6, cy + 7, 13, 3, C.markDim);

const out = upscale(s, SCALE);
const dest = path.join(root, '.artifacts/app-icon-source.png');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, encodePNG(out.data, out.w, out.h));

console.log(`icon source written: ${path.relative(root, dest)} (${out.w}x${out.h})`);
console.log('now run: npx tauri icon .artifacts/app-icon-source.png');
