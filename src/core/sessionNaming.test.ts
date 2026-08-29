import { describe, it, expect } from 'vitest';
import { nextSessionTitle } from './sessionNaming';

describe('nextSessionTitle', () => {
  it('numbers sequentially from the auto-generated names', () => {
    expect(nextSessionTitle('terminal', [])).toBe('Terminal 1');
    expect(nextSessionTitle('terminal', ['Terminal 1'])).toBe('Terminal 2');
    expect(nextSessionTitle('terminal', ['Terminal 1', 'Terminal 2'])).toBe('Terminal 3');
  });

  it('ignores digits in renamed tabs', () => {
    // The bug: a tab renamed 'deploy-2026' produced 'Terminal 2027'.
    expect(nextSessionTitle('terminal', ['deploy-2026'])).toBe('Terminal 1');
    expect(nextSessionTitle('terminal', ['Terminal 1', 'deploy-2026'])).toBe('Terminal 2');
    expect(nextSessionTitle('terminal', ['v2 rollout', 'Terminal 3'])).toBe('Terminal 4');
  });

  it('numbers each kind independently', () => {
    expect(nextSessionTitle('agent', ['Terminal 1', 'Terminal 2'])).toBe('Agent 1');
    expect(nextSessionTitle('scratchpad', ['Agent 1'])).toBe('Notes 1');
  });

  it('fills nothing in — a gap stays a gap', () => {
    expect(nextSessionTitle('terminal', ['Terminal 1', 'Terminal 5'])).toBe('Terminal 6');
  });

  it('is not fooled by a title that merely starts with the label', () => {
    expect(nextSessionTitle('terminal', ['Terminal 3 (staging)'])).toBe('Terminal 1');
    expect(nextSessionTitle('terminal', ['My Terminal 9'])).toBe('Terminal 1');
  });
});
