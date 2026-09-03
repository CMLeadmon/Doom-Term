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
import { cargoTargetDirectory, sidecarBinaryPath } from './sidecar-paths.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'doom-term-server';

function hostTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const match = out.match(/^host:\s*(\S+)$/m);
  if (!match) throw new Error('could not read the host triple from `rustc -vV`');
  return match[1];
}

// Empty unless we are genuinely cross-compiling. It is the single fact that
// decides both the cargo invocation and where the output lands, so the two
// cannot drift apart.
const crossTriple = process.env.TAURI_ENV_TARGET_TRIPLE || '';
const triple = crossTriple || hostTriple();
const exe = process.platform === 'win32' ? '.exe' : '';
const manifest = path.join(root, 'backend/Cargo.toml');

const cargoArgs = ['build', '--release', '--manifest-path', manifest];
if (crossTriple) {
  cargoArgs.push('--target', crossTriple);
}
execFileSync('cargo', cargoArgs, { stdio: 'inherit' });

// Ask Cargo where it writes, rather than guessing at a list of directories and
// then picking whichever file was newest. That heuristic could not find a
// cross-compiled build at all — `--target` adds a triple directory — and when a
// stale host binary sat in one of the guessed locations it selected THAT and
// copied it out under the requested triple's name. See tools/sidecar-paths.mjs.
const targetDirectory = cargoTargetDirectory(manifest, (cmd, args) =>
  execFileSync(cmd, args, { encoding: 'utf8' })
);
const built = sidecarBinaryPath({
  targetDirectory,
  triple: crossTriple,
  name: NAME,
  exe,
});
if (!fs.existsSync(built)) {
  throw new Error(`cargo reported success but the binary is not where it said it would be:\n  ${built}`);
}

const destDir = path.join(root, 'src-tauri/binaries');
const dest = path.join(destDir, `${NAME}-${triple}${exe}`);

fs.mkdirSync(destDir, { recursive: true });
if (fs.existsSync(dest)) {
  fs.rmSync(dest, { force: true });
}
fs.copyFileSync(built, dest);
fs.chmodSync(dest, 0o755);

console.log(`sidecar installed: ${path.relative(root, dest)}`);
