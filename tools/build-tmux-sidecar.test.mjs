import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('sidecar builder refuses tmux without child-paste observation before installing it', { skip: process.platform === 'win32' }, () => {
  const fixture = mkdtempSync(join(tmpdir(), 'doom-sidecar-floor-'));
  try {
    const tools = join(fixture, 'tools');
    mkdirSync(tools);
    const builder = join(tools, 'build-tmux-sidecar.mjs');
    copyFileSync(new URL('./build-tmux-sidecar.mjs', import.meta.url), builder);
    const oldTmux = join(fixture, 'old-tmux');
    writeFileSync(oldTmux, '#!/bin/sh\nprintf "tmux 3.6b\\n"\n', { mode: 0o700 });
    const result = spawnSync(process.execPath, [builder], {
      env: { ...process.env, DOOM_TMUX_BINARY: oldTmux }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /3\.7 or newer is required/);
    assert.equal(existsSync(join(fixture, 'src-tauri')), false, 'unsupported binary must not be installed');
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
