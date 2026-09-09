#!/usr/bin/env node
/** Real browser/PTY smoke tests. Never connect to the user's daemon or tmux. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { build, preview } from 'vite';
import { chromium, expect } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const artifacts = mkdtempSync(join(tmpdir(), 'doom-ui-'));
const testEnv = {
  ...process.env, DOOM_HOST: '127.0.0.1', DOOM_PORT: '0', DOOM_AUTH_TOKEN: '',
  TMUX_TMPDIR: artifacts, XDG_RUNTIME_DIR: artifacts,
  // An interactive POSIX shell with no user's startup commands. The shell
  // integration itself is covered by the Rust and event-routing suites.
  SHELL: '/bin/sh', RUST_LOG: 'info',
};
delete testEnv.ENV;
delete testEnv.BASH_ENV;
delete testEnv.DOOM_TERM_NO_TMUX;
let browser;
let page;
let vite;
let daemon;
let daemonLog = '';

async function startDaemon() {
  const build = spawnSync('cargo', ['build', '--locked', '-p', 'doom-term-server'], {
    cwd: root, stdio: 'inherit', timeout: 300000,
  });
  assert.equal(build.status, 0, 'test daemon must compile');
  const target = resolve(root, process.env.CARGO_TARGET_DIR || 'target');
  daemon = spawn(join(target, 'debug', 'doom-term-server'), [], { cwd: root, env: testEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error(`Daemon did not start: ${daemonLog}`)), 15000);
    const receive = chunk => {
      daemonLog = (daemonLog + chunk.toString()).slice(-32768);
      const match = daemonLog.match(/listening on ws:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { clearTimeout(timer); resolvePort(Number(match[1])); }
    };
    daemon.stdout.on('data', receive);
    daemon.stderr.on('data', receive);
    daemon.once('error', error => { clearTimeout(timer); reject(error); });
    daemon.once('exit', code => { clearTimeout(timer); reject(new Error(`Daemon exited ${code}: ${daemonLog}`)); });
  });
}

async function palette(page, search) {
  await page.keyboard.press('Control+Shift+p');
  await page.getByRole('combobox').fill(search);
  await page.keyboard.press('Enter');
}

async function command(page, text, expectedLine) {
  const terminal = page.getByTestId('raw-terminal').filter({ visible: true }).last();
  await terminal.click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  // A terminal echo of the input is NOT proof the process ran the command.
  await expect.poll(async () => (await terminal.innerText()).split('\n').map(s => s.trim()).includes(expectedLine)).toBe(true);
}

async function terminalGrid(page, marker) {
  const terminal = page.getByTestId('raw-terminal').filter({ visible: true }).last();
  await terminal.click();
  await page.keyboard.type(`printf '${marker}='; stty size`);
  await page.keyboard.press('Enter');
  const pattern = new RegExp(`^${marker}=(\\d+) (\\d+)$`);
  const read = async () => (await terminal.innerText()).split('\n').map(line => line.trim().match(pattern)).find(Boolean);
  await expect.poll(read).toBeTruthy();
  const match = await read();
  return { rows: Number(match[1]), cols: Number(match[2]) };
}

async function main() {
  const probeFailures = [];
  console.log(`[UI Test] Real Chromium + isolated daemon; screenshots: ${artifacts}`);
  browser = await chromium.launch({ executablePath: process.env.DOOM_TERM_BROWSER_EXECUTABLE || undefined });
  // 1420 is the daemon's trusted development origin. Refuse a busy port; do
  // not silently test somebody else's app or broaden the production allowlist.
  await build({ root });
  const port = await startDaemon();
  // Exercise the production bundle with the desktop's actual CSP. Only the
  // daemon port changes in the test policy to reach this run's private daemon.
  const policy = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8')).app.security.csp;
  assert.ok(policy && typeof policy === 'object', 'desktop CSP must be configured');
  const csp = Object.entries(policy).map(([directive, value]) => `${directive} ${value}`).join('; ')
    .replace('ws://127.0.0.1:1421', `ws://127.0.0.1:${port}`);
  vite = await preview({ root, preview: { host: '127.0.0.1', port: 1420, strictPort: true, headers: { 'Content-Security-Policy': csp } } });
  const context = await browser.newContext({ viewport: { width: 1280, height: 840 } });
  await context.addInitScript(({ port }) => {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url, protocols) {
        const target = new URL(url);
        if (target.hostname === '127.0.0.1' && target.port === '1421') target.port = String(port);
        super(target.toString(), protocols);
      }
    };
  }, { port });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:1420');
  await expect(page).toHaveTitle(/Doom/i);
  await expect(page.getByRole('dialog', { name: /OPEN WORKSPACE/ })).toBeVisible();
  await page.getByRole('combobox').fill(artifacts);
  await page.getByRole('combobox').press('Enter');
  await expect(page.getByTestId('raw-terminal')).toContainText(/[$#]/);
  await command(page, "printf 'SHELL_OK\\n'", 'SHELL_OK');
  await command(page, "printf '\\344\\270\\255\\346\\226\\207 \\360\\237\\232\\200\\n'", '中文 🚀');
  console.log('[UI Test] PASS: startup, real shell I/O, Unicode');

  // Use an isolated interactive Bash with bracketed paste explicitly enabled,
  // even on CI hosts whose /bin/sh is dash. No user startup files are sourced.
  await page.keyboard.type('/bin/bash --noprofile --norc');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('raw-terminal')).toContainText(/bash-[\d.]+[$#]/);
  await command(page, "bind 'set enable-bracketed-paste off'; printf 'BRACKET_OFF\\n'", 'BRACKET_OFF');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  for (const newline of ['\r', '\n']) {
    const blockedPaste = `printf 'BLOCKED_PASTE_ONE\\n'${newline}printf 'BLOCKED_PASTE_TWO\\n'`;
    await page.evaluate(text => navigator.clipboard.writeText(text), blockedPaste);
    await page.keyboard.press('Control+Shift+v');
    try {
      await expect(page.getByRole('status')).toContainText(/Multiline paste blocked/);
      await expect(page.getByTestId('raw-terminal')).not.toContainText("printf 'BLOCKED_PASTE_ONE");
      await page.screenshot({ path: join(artifacts, 'paste-blocked.png') });
    } catch (error) {
      // Keep testing independent MVP flows, but fail the overall run at the end.
      probeFailures.push(`unsupported-child paste (${JSON.stringify(newline)}): ${error.message}`);
      await page.screenshot({ path: join(artifacts, 'paste-unsafe.png') });
    }
  }
  await page.keyboard.press('Control+c');
  await command(page, "bind 'set enable-bracketed-paste on'; printf 'BRACKET_ON\\n'", 'BRACKET_ON');
  const paste = "printf 'PASTE_ONE\\n'\rprintf 'PASTE_TWO\\n'";
  await page.evaluate(text => navigator.clipboard.writeText(text), paste);
  await page.keyboard.press('Control+Shift+v');
  const terminal = page.getByTestId('raw-terminal');
  await expect(terminal).toContainText("printf 'PASTE_TWO");
  await expect(page.getByRole('status')).toHaveCount(0);
  assert.ok(!(await terminal.innerText()).split('\n').map(line => line.trim()).includes('PASTE_ONE'), 'pasting must not execute the first line before Enter');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await terminal.innerText()).split('\n').map(line => line.trim()).includes('PASTE_TWO')).toBe(true);

  await command(page, "printf 'JOB_STARTED\\n'; sleep 30", 'JOB_STARTED');
  await page.keyboard.press('Control+z');
  await expect(terminal).toContainText(/Stopped[^\n]*sleep 30/);
  await page.keyboard.type('fg');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await terminal.innerText()).split('\n').map(line => line.trim()).includes('sleep 30')).toBe(true);
  await page.keyboard.press('Control+c');
  await command(page, "printf 'AFTER_JOB_CONTROL\\n'", 'AFTER_JOB_CONTROL');
  await page.keyboard.press('Control+d');
  await command(page, "printf 'AFTER_EOF\\n'", 'AFTER_EOF');
  console.log('[UI Test] PASS: real clipboard CR paste waits for Enter; Ctrl+Z/fg/Ctrl+C job control and Ctrl+D shell exit');

  await page.keyboard.type('sleep 30');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+c');
  await command(page, "printf 'AFTER_INTERRUPT\\n'", 'AFTER_INTERRUPT');
  console.log('[UI Test] PASS: Ctrl+C reaches the process');

  const quickUrl = 'https://example.test/doom-probe';
  await command(page, `printf '${quickUrl}\\n'`, quickUrl);
  await page.keyboard.press('Control+Shift+e');
  const quickTarget = page.getByRole('button').filter({ has: page.getByText(quickUrl, { exact: true }) });
  await expect(quickTarget).toHaveCount(1);
  await quickTarget.click();
  await page.keyboard.press('Enter');
  await expect(quickTarget).toHaveCount(0);
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), quickUrl, 'quick-select copies the selected target');
  await terminal.click();
  await page.keyboard.type("printf 'INSERTED=%s\\n' ");
  await page.keyboard.press('Control+Shift+e');
  await quickTarget.click();
  await page.keyboard.press('Shift+Enter');
  await expect(quickTarget).toHaveCount(0);
  assert.ok(!(await terminal.innerText()).split('\n').map(line => line.trim()).includes(`INSERTED=${quickUrl}`), 'quick-select insertion must not submit the shell command');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await terminal.innerText()).split('\n').map(line => line.trim()).includes(`INSERTED=${quickUrl}`)).toBe(true);
  console.log('[UI Test] PASS: quick-select copies to the real clipboard and inserts without submitting');

  // Vim/vi with no user configuration, persistent history, or swap files.
  // Saving a disposable file proves editor input reached a real TUI process.
  await page.keyboard.type('vi -Nu NONE -i NONE -n editor-probe.txt');
  await page.keyboard.press('Enter');
  await expect(terminal).toContainText(/editor-probe\.txt.*New/);
  await expect(terminal).not.toContainText('SHELL_OK');
  await page.keyboard.type('iTUI_EDITOR_OK');
  await expect(terminal).toContainText('TUI_EDITOR_OK');
  await page.keyboard.press('Escape');
  await expect(terminal).toContainText('TUI_EDITOR_OK');
  await page.screenshot({ path: join(artifacts, 'editor.png') });
  await page.keyboard.type(':wq');
  await page.keyboard.press('Enter');
  await expect(terminal).toContainText('SHELL_OK');
  await command(page, 'cat editor-probe.txt', 'TUI_EDITOR_OK');
  assert.equal(readFileSync(join(artifacts, 'editor-probe.txt'), 'utf8'), 'TUI_EDITOR_OK\n');
  console.log('[UI Test] PASS: real alternate-screen editor input, file save, and shell screen restoration');

  await palette(page, 'Permission Review');
  await expect(page.getByRole('radio', { name: /Automatic approval unavailable/ })).toBeDisabled();
  await page.screenshot({ path: join(artifacts, 'settings.png') });
  await page.keyboard.press('Escape');
  await palette(page, 'Split Right');
  await expect(page.getByTestId('raw-terminal').filter({ visible: true })).toHaveCount(2);
  await expect(page.getByTestId('raw-terminal').last()).toContainText(/[$#]/);
  await command(page, "printf 'SECOND_PANE\\n'", 'SECOND_PANE');
  const beforeGrid = await terminalGrid(page, 'GRID_BEFORE');
  const divider = page.getByRole('separator', { name: '' });
  const dividerBox = await divider.boundingBox();
  assert.ok(dividerBox, 'split divider must be visible');
  assert.equal(await page.evaluate(({ x, y, width, height }) => document.elementFromPoint(x + width / 2, y + height / 2)?.getAttribute('role'), dividerBox), 'separator', 'the divider must have a pointer hit target');
  await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + dividerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(420, dividerBox.y + dividerBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await page.getByTestId('pane-leaf').first().boundingBox()).width).toBeLessThan(450);
  const afterGrid = await terminalGrid(page, 'GRID_AFTER');
  assert.ok(afterGrid.cols > beforeGrid.cols, 'dragging the divider must resize the actual child PTY');
  assert.equal(afterGrid.rows, beforeGrid.rows, 'horizontal resize must preserve the PTY row count');
  const leaves = await page.getByTestId('pane-leaf').count();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('pane-leaf')).toHaveCount(leaves);
  await expect(page.getByTestId('raw-terminal').filter({ visible: true })).toHaveCount(1);
  await page.screenshot({ path: join(artifacts, 'zoom.png') });
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('raw-terminal').filter({ visible: true })).toHaveCount(2);
  await page.keyboard.press('Control+Shift+t');
  await expect(page.getByTestId('raw-terminal').filter({ visible: true })).toHaveCount(2);
  await expect(page.getByTestId('raw-terminal').filter({ visible: true }).last()).toContainText(/[$#]/);
  await command(page, 'pwd', artifacts);
  await page.screenshot({ path: join(artifacts, 'split.png') });
  console.log('[UI Test] PASS: palette, settings, live split, mounted siblings through zoom and new-session selection');

  for (const width of [1280, 960, 800]) {
    await page.setViewportSize({ width, height: 600 });
    if (width === 800) {
      const plate = page.locator('canvas').locator('..');
      await plate.focus();
      await expect(plate).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => plate.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    }
    await page.screenshot({ path: join(artifacts, `terminal-${width}.png`) });
  }

  await page.setViewportSize({ width: 1280, height: 840 });
  const secondWorkspace = join(artifacts, 'second-workspace');
  mkdirSync(secondWorkspace);
  await page.keyboard.press('Control+Shift+o');
  await page.getByRole('combobox').fill(secondWorkspace);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('raw-terminal').filter({ visible: true })).toHaveCount(1);
  await expect(page.getByTestId('raw-terminal').filter({ visible: true })).toContainText(/[$#]/);
  await page.keyboard.press('Control+Shift+t');
  await expect(page.getByTestId('raw-terminal').filter({ visible: true })).toContainText(/[$#]/);
  await command(page, 'pwd', secondWorkspace);
  const remotePane = await page.getByTestId('pane-leaf').filter({ visible: true }).getAttribute('data-pane');
  assert.ok(remotePane, 'background hook must name a real pane');
  await page.keyboard.press('Control+1');
  await expect(page.locator(`[data-pane="${remotePane}"]`)).not.toBeVisible();
  const response = await fetch(`http://127.0.0.1:${port}/hook/claude`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Doom-Term-Session': remotePane },
    body: JSON.stringify({ event: 'PermissionRequest', cwd: secondWorkspace }),
  });
  assert.equal(response.status, 204);
  // The palette must not treat appearing under a stationary mouse as input.
  await page.mouse.move(400, 375);
  await page.keyboard.press('Control+k');
  const remoteAsk = page.getByRole('option').filter({ hasText: 'second-workspace' }).filter({ hasText: 'ASKS' });
  await expect(remoteAsk).toHaveCount(1);
  await expect(remoteAsk).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: join(artifacts, 'background-attention.png') });
  await remoteAsk.click();
  await expect(page.locator(`[data-pane="${remotePane}"]`)).toBeVisible();
  await command(page, "printf 'BACKGROUND_RETURN\\n'", 'BACKGROUND_RETURN');
  console.log('[UI Test] PASS: multi-workspace directory selection and background hook activation');
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  assert.deepEqual(errors, [], 'no browser runtime errors');
  assert.deepEqual(probeFailures, [], 'all MVP probes must pass; recorded failures are never skipped successes');
  console.log('[UI Test] PASS: browser smoke complete (screenshots are evidence, not pixel assertions)');
}

try {
  await main();
} catch (error) {
  console.error(`[UI Test] FAIL: ${error.stack || error.message}`);
  if (page && !page.isClosed()) {
    console.error(`[UI Test] terminal evidence: ${(await page.getByTestId('raw-terminal').allInnerTexts()).join('\n').slice(-6000)}`);
    await page.screenshot({ path: join(artifacts, 'failure.png') });
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (vite) await new Promise((resolveClose, reject) => vite.httpServer.close(error => error ? reject(error) : resolveClose()));
  if (daemon && daemon.exitCode === null) {
    const exited = once(daemon, 'exit');
    daemon.kill('SIGTERM');
    await exited;
  }
  // Only this run's disposable private socket. Never target the user's tmux.
  if (daemon) spawnSync('tmux', ['-L', 'doom-term', 'kill-server'], { env: testEnv, timeout: 3000 });
}
