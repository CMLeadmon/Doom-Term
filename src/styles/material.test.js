import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./material.css', import.meta.url), 'utf8');

test('declares every material token exactly once', () => {
  const required = [
    '--plate', '--ground', '--bevel-up', '--bevel-dn',
    '--ink', '--ink-tan', '--ink-dim', '--ink-plate',
    '--st-live', '--st-pass', '--st-fail', '--st-wait', '--st-idle',
  ];
  for (const token of required) {
    const hits = css.split(`${token}:`).length - 1;
    assert.equal(hits, 1, `${token} should be declared once, found ${hits}`);
  }
});

test('no border radius survives anywhere', () => {
  assert.match(css, /\*\s*\{[^}]*border-radius:\s*0/, 'needs a global radius reset');
  assert.equal(/border-radius:\s*(?!0)/.test(css), false, 'a non-zero radius crept in');
});

test('no blurred shadows — depth is the bevel pair only', () => {
  // A hard bevel is `inset Npx Npx 0 <colour>`. Any third length is a blur.
  const shadows = css.match(/box-shadow:[^;]+;/g) || [];
  for (const s of shadows) {
    assert.equal(/\d+px\s+-?\d+px\s+[1-9]/.test(s), false, `blurred shadow: ${s}`);
  }
});
