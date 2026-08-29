import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPlateState, plateScale } from './state.ts';

test('sandbox renders a tier name, never a percentage', () => {
  assert.equal(toPlateState({ isolation: 'sandbox' }).sandbox, 'FULL');
  assert.equal(toPlateState({ isolation: 'worktree' }).sandbox, 'TREE');
  assert.equal(toPlateState({ isolation: 'host' }).sandbox, 'OFF');
});

test('percentages clamp and round to a 3-character field', () => {
  assert.equal(toPlateState({ contextUsed: 0.613 }).context, '61%');
  assert.equal(toPlateState({ contextUsed: 1.5 }).context, '99%');
  assert.equal(toPlateState({ contextUsed: -1 }).context, '0%');
});

test('branch truncates from the left so the leaf survives', () => {
  const s = toPlateState({ branch: 'feature/webgl-compositor-rewrite-phase-two' });
  assert.equal(s.branch.length, 24);
  assert.match(s.branch, /PHASE-TWO$/);
  assert.match(s.branch, /^··/);
});

test('an unknown percentage renders as dashes, never as a number', () => {
  const s = toPlateState({ agent: 'claude', agentName: 'CLAUDE CODE' });
  assert.equal(s.context, '--');
  assert.equal(s.usage, '--');
});

test('no counter table is drawn when nothing has been counted', () => {
  const s = toPlateState({ agent: 'claude' });
  assert.deepEqual(s.table, []);
});

test('a plain shell reports no agent name at all', () => {
  const s = toPlateState({ agent: 'shell', agentName: undefined });
  assert.equal(s.agentName, '');
});

test('isolation renders as a tier name, never invented as FULL', () => {
  assert.equal(toPlateState({ isolation: 'host' }).sandbox, 'OFF');
  assert.equal(toPlateState({ isolation: 'sandbox' }).sandbox, 'FULL');
  assert.equal(toPlateState({}).sandbox, 'OFF');
});

test('scale is always a positive integer', () => {
  assert.equal(plateScale(1920), 4);
  assert.equal(plateScale(1000), 2);
  assert.equal(plateScale(479), 1, 'never returns 0 — a 0-scale canvas is invisible');
  assert.equal(Number.isInteger(plateScale(1337)), true);
});
