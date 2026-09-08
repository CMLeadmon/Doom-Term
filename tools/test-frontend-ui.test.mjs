import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

test('UI verification fails without a browser instead of reporting skipped probes as success', () => {
  const result = spawnSync(process.execPath, [resolve('tools/test-frontend-ui.mjs')], {
    env: { ...process.env, DOOM_TERM_BROWSER_EXECUTABLE: '/nonexistent/doom-test-browser', DOOM_TERM_DEV_URL: 'http://127.0.0.1:1' },
    encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.error, undefined, 'verification must fail promptly');
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /browser|executable/i);
});
