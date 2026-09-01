import { describe, it, expect } from 'vitest';
import { nextSessionTitle, derivedSessionTitle, titleFromInstruction } from './sessionNaming';

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

describe('derivedSessionTitle', () => {
  it('is the folder and the branch', () => {
    expect(derivedSessionTitle('/home/x/Projects/Doom Term', 'clean-slate'))
      .toBe('DOOM-TERM/CLEAN-SLATE');
  });

  it('is the folder alone when there is no branch', () => {
    expect(derivedSessionTitle('/home/x/Projects/Doom Term', '')).toBe('DOOM-TERM');
  });

  it('ignores a trailing slash rather than producing an empty leaf', () => {
    expect(derivedSessionTitle('/home/x/doom-term/', '')).toBe('DOOM-TERM');
  });

  it('falls back to a name rather than an empty string', () => {
    // A nameless session is an invisible one once the waiting list is the only
    // place a session's identity appears.
    expect(derivedSessionTitle('', '')).toBe('SESSION');
    expect(derivedSessionTitle('///', '')).toBe('SESSION');
  });
});

describe('titleFromInstruction', () => {
  it('slugs the instruction to the first few words', () => {
    expect(titleFromInstruction('fix the pty socket resize')).toBe('FIX-THE-PTY-SOCKET');
  });

  it('caps length so it cannot overrun a waiting row', () => {
    expect(titleFromInstruction('a'.repeat(80)).length).toBeLessThanOrEqual(24);
  });

  it('drops punctuation the plate font cannot draw', () => {
    expect(titleFromInstruction('fix "the" (pty) socket!')).toBe('FIX-THE-PTY-SOCKET');
  });

  it('never ends on a dangling separator', () => {
    expect(titleFromInstruction('fix the ')).toBe('FIX-THE');
  });

  it('returns empty when there is nothing nameable, so the caller keeps its title', () => {
    expect(titleFromInstruction('!!! ???')).toBe('');
    expect(titleFromInstruction('')).toBe('');
  });
});
