#!/usr/bin/env node
/**
 * Builds the PTY daemon and installs it as the Tauri sidecar binary.
 *
 * Tauri resolves sidecars by target triple, so the file has to be named
 * `<name>-<triple>` next to the path listed in `bundle.externalBin`. Getting
 * that name wrong fails at bundle time with a confusing "file not found", so
 * the triple is read from the toolchain rather than hardcoded.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'doom-term-server';

function hostTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const match = out.match(/^host:\s*(\S+)$/m);
  if (!match) throw new Error('could not read the host triple from `rustc -vV`');
  return match[1];
}

const triple = hostTriple();
const exe = process.platform === 'win32' ? '.exe' : '';

execFileSync(
  'cargo',
  ['build', '--release', '--manifest-path', path.join(root, 'backend/Cargo.toml')],
  { stdio: 'inherit' }
);

const built = path.join(root, 'backend/target/release', `${NAME}${exe}`);
if (!fs.existsSync(built)) {
  throw new Error(`cargo reported success but ${built} does not exist`);
}

const destDir = path.join(root, 'src-tauri/binaries');
const dest = path.join(destDir, `${NAME}-${triple}${exe}`);

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(built, dest);
fs.chmodSync(dest, 0o755);

console.log(`sidecar installed: ${path.relative(root, dest)}`);
