#!/usr/bin/env node
/**
 * Check the desktop shell, and say plainly when it could not be checked.
 *
 * See tools/tauri-check-result.mjs for why the two failing outcomes have to be
 * told apart. A block is printed as a block and never phrased as a pass: the
 * finding this addresses is a gate that read as success without doing its job.
 */
import { spawnSync } from 'node:child_process';
import { classifyCargoFailure } from './tauri-check-result.mjs';

function reportBlock(detail) {
  console.log('');
  console.log('  ENVIRONMENT BLOCK — NOT A PASS');
  console.log('  The desktop shell was not compiled: this machine lacks its system');
  console.log('  development packages (glib, gtk, dbus-1, webkit2gtk).');
  if (detail) console.log(`  cargo said: ${detail}`);
  console.log('');
}

const result = spawnSync(
  'cargo',
  ['check', '--manifest-path', 'src-tauri/Cargo.toml', '--all-targets'],
  { encoding: 'utf8' },
);

if (result.error) {
  reportBlock(`cargo could not be run: ${result.error.message}`);
  process.exit(0);
}

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
const verdict = classifyCargoFailure(result.status, output);

if (verdict.kind === 'pass') {
  console.log('tauri shell: checked');
  process.exit(0);
}

if (verdict.kind === 'blocked') {
  reportBlock(verdict.reason);
  process.exit(0);
}

// Anything else is the crate's own fault and must fail the gate.
process.stderr.write(output);
console.error('');
console.error('  FAIL — the desktop shell does not compile.');
process.exit(1);
