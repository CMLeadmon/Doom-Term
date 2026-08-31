#!/usr/bin/env node
/**
 * Installs tmux as a second Tauri sidecar.
 *
 * Unlike the daemon, tmux is not ours to build from this repo: it is a C
 * program needing libevent and ncurses, and producing a static binary per
 * target is platform work that does not belong in a Node script. So this takes
 * a path to a binary you have already obtained or built, verifies it runs and
 * is new enough, and installs it under the name Tauri expects.
 *
 * Absent a binary this exits 0 with a message rather than failing the build:
 * a bundle without tmux is a working application, which the UI reports.
 *
 * Bundling is therefore OPT-IN, and `binaries/tmux` is deliberately NOT in
 * tauri.conf.json's externalBin — every entry there must exist at bundle time,
 * so listing it would make the default `tauri build` fail on a missing file it
 * was never told to produce. To ship tmux inside the app, run this with
 * DOOM_TMUX_BINARY set AND add "binaries/tmux" back to externalBin.
 *
 * Without it, resolve_tmux still finds a system tmux on PATH, and on macOS in
 * the Homebrew prefixes a Finder-launched app cannot see through PATH alone.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN = [3, 3];

function hostTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const match = out.match(/^host:\s*(\S+)$/m);
  if (!match) throw new Error('could not read the host triple from `rustc -vV`');
  return match[1];
}

const source = process.env.DOOM_TMUX_BINARY;
if (!source) {
  console.log(
    'sidecar:tmux skipped — set DOOM_TMUX_BINARY to a tmux >= 3.3 executable to bundle one.'
  );
  process.exit(0);
}
if (!fs.existsSync(source)) {
  throw new Error(`DOOM_TMUX_BINARY points at ${source}, which does not exist`);
}

const version = execFileSync(source, ['-V'], { encoding: 'utf8' });
const parsed = version.match(/(\d+)\.(\d+)/);
if (!parsed) {
  throw new Error(`could not read a version from \`${source} -V\`: ${version.trim()}`);
}
const [, major, minor] = parsed.map(Number);
if (major < MIN[0] || (major === MIN[0] && minor < MIN[1])) {
  // Below 3.3 there is no allow-passthrough, so the shell's OSC 133 never
  // reaches the app and command blocks stop working with no error anywhere.
  throw new Error(`${source} is tmux ${major}.${minor}; ${MIN.join('.')} or newer is required`);
}

const triple = hostTriple();
const exe = process.platform === 'win32' ? '.exe' : '';
const destDir = path.join(root, 'src-tauri/binaries');
const dest = path.join(destDir, `tmux-${triple}${exe}`);

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(source, dest);
fs.chmodSync(dest, 0o755);

console.log(`tmux sidecar installed: ${path.relative(root, dest)} (tmux ${major}.${minor})`);
