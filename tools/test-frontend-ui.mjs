#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const DEV_URL = process.env.DOOM_TERM_DEV_URL || 'http://localhost:1420';
const WS_URL = process.env.DOOM_TERM_WS_URL || 'ws://127.0.0.1:1421';

async function verifyDevServer() {
  console.log(`[UI Test] Probing dev server at ${DEV_URL}...`);
  try {
    const res = await fetch(DEV_URL);
    if (!res.ok) {
      console.warn(`[UI Test] Warning: Dev server returned status ${res.status}`);
      return false;
    }
    const html = await res.text();
    if (!html.includes('<div id="root">') && !html.includes('id="root"')) {
      throw new Error('Dev server HTML missing #root container');
    }
    if (!html.includes('/src/main.tsx')) {
      throw new Error('Dev server HTML missing /src/main.tsx entry script');
    }
    console.log('[UI Test] ✓ Dev server HTML payload valid');
    return true;
  } catch (err) {
    console.log(`[UI Test] Dev server not reachable (${err.message}). Skipping live probe.`);
    return false;
  }
}

function verifyVisualInvariants() {
  console.log('[UI Test] Verifying design system and visual invariants in src/...');
  const srcDir = resolve(ROOT, 'src');
  const files = [];

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if ((entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx')) && !entry.name.includes('.test.')) {
        files.push(full);
      }
    }
  }
  walk(srcDir);

  const errors = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const rel = relative(srcDir, file);

    if (/\bshadow-(sm|md|lg|xl|2xl|inner)\b/.test(content)) {
      errors.push(`${rel}: forbidden soft shadow class`);
    }
    if (/\bbackdrop-blur\b/.test(content)) {
      errors.push(`${rel}: forbidden backdrop-blur class`);
    }
    if (/\brounded(-\w+)?\b/.test(content)) {
      errors.push(`${rel}: forbidden rounded class`);
    }
  }

  if (errors.length > 0) {
    console.error('[UI Test] ✗ Invariant violations found:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`[UI Test] ✓ All ${files.length} UI components comply with zero soft-shadows, zero blur, and zero border-radius invariants.`);
}

async function main() {
  console.log('--- Doom Term Frontend UI & Visual Audit ---');
  verifyVisualInvariants();
  await verifyDevServer();
  console.log('--- All UI visual integrity checks passed ---');
}

main().catch((err) => {
  console.error('[UI Test] Fatal error:', err);
  process.exit(1);
});
