import { describe, it, expect } from 'vitest';
import {
  forgetMarkingAgent, markingAgent, stepTurn, turnStarts, turnText,
} from './turnMarks';
import type { AnsiLine } from '../types/terminal';

const lines = (...texts: string[]): AnsiLine[] =>
  texts.map((t, i) => ({ id: String(i), spans: [{ text: t }], isError: false, timestamp: 0 }));

describe('turnStarts', () => {
  it('marks a claude turn at its prompt marker', () => {
    const ls = lines('  reading file', '> fix the resize path', '  edit ptyClient.ts');
    expect(turnStarts(ls, 'claude')).toEqual(new Set([1]));
  });

  it('marks nothing for a bare shell — there are no turns to mark', () => {
    expect(turnStarts(lines('$ ls', 'a  b  c', '$ pwd'), null).size).toBe(0);
  });

  it('does not mark a marker that appears mid-line', () => {
    // A diff line containing "> " is not the start of a turn. An unanchored
    // match finds several of these per screen, and a gutter mark in the wrong
    // place is worse than none — it is a boundary you navigate to and find
    // nothing at.
    expect(turnStarts(lines('  -  if (x) { return > y; }'), 'claude').size).toBe(0);
  });

  it('is empty rather than throwing for an unknown agent', () => {
    expect(turnStarts(lines('> hello'), 'some-new-agent').size).toBe(0);
  });

  it('joins spans before matching, because a line is coloured in pieces', () => {
    const split: AnsiLine[] = [{
      id: '0', isError: false, timestamp: 0,
      spans: [{ text: '> ' }, { text: 'fix the thing' }],
    }];
    expect(turnStarts(split, 'claude')).toEqual(new Set([0]));
  });

  it('treats agy and antigravity as the same product', () => {
    const ls = lines('> do the thing');
    expect(turnStarts(ls, 'agy')).toEqual(turnStarts(ls, 'antigravity'));
    expect(turnStarts(ls, 'agy').size).toBe(1);
  });

  it('does not mark a wrapped continuation line that happens to match the pattern', () => {
    const wrapped: AnsiLine[] = [
      { id: '0', spans: [{ text: 'some long command' }], isError: false, timestamp: 0, isWrapped: false },
      { id: '1', spans: [{ text: '> continuation line' }], isError: false, timestamp: 0, isWrapped: true },
    ];
    expect(turnStarts(wrapped, 'claude').size).toBe(0);
  });
});

describe('turn navigation', () => {
  const marks = new Set([1, 4, 8]);

  it('steps in either direction and wraps at the ends', () => {
    expect(stepTurn(marks, 4, 1)).toBe(8);
    expect(stepTurn(marks, 8, 1)).toBe(1);
    expect(stepTurn(marks, 4, -1)).toBe(1);
    expect(stepTurn(marks, 1, -1)).toBe(8);
  });

  it('returns null when no trusted turn marks exist', () => {
    expect(stepTurn(new Set(), 10, 1)).toBeNull();
  });

  it('copies the surrounding turn through the line before the next mark', () => {
    expect(turnText(lines('old', '> build', 'one', 'two', '> test', 'green'), marks, 2))
      .toBe('> build\none\ntwo');
  });
});

describe('marks outliving the process that made them', () => {
  // Marks were derived from the CURRENTLY reported foreground agent. The moment
  // that agent exited and the shell returned to the foreground, agentKey went
  // null and every historical mark vanished — so the turns you most want to
  // read back, from the session that just finished, became unnavigable and
  // uncopyable exactly when it ended. The lines did not change; nor should the
  // boundaries drawn on them.
  const transcript = lines('  reading file', '> fix the resize path', '  done');

  it('keeps marking with the agent that was there when the shell comes back', () => {
    forgetMarkingAgent('s1');
    expect(markingAgent('s1', 'claude')).toBe('claude');
    expect(markingAgent('s1', null)).toBe('claude');
    expect(turnStarts(transcript, markingAgent('s1', null))).toEqual(new Set([1]));
  });

  it('keeps each session history to itself', () => {
    forgetMarkingAgent('a');
    forgetMarkingAgent('b');
    markingAgent('a', 'claude');
    expect(markingAgent('b', null)).toBeNull();
  });

  it('follows a new agent taking over the same session', () => {
    forgetMarkingAgent('s2');
    markingAgent('s2', 'claude');
    expect(markingAgent('s2', 'codex')).toBe('codex');
    expect(markingAgent('s2', null)).toBe('codex');
  });

  it('does not remember an agent whose prompt shape is unknown', () => {
    // An unrecognized agent gets no marks, and must not become the remembered
    // one either — that would replace a working pattern with nothing.
    forgetMarkingAgent('s3');
    markingAgent('s3', 'claude');
    expect(markingAgent('s3', 'somethingelse')).toBe('claude');
  });

  it('forgets a session that closed', () => {
    forgetMarkingAgent('s4');
    markingAgent('s4', 'claude');
    forgetMarkingAgent('s4');
    expect(markingAgent('s4', null)).toBeNull();
  });

  it('marks nothing for a bare shell that never hosted a known agent', () => {
    forgetMarkingAgent('s5');
    expect(turnStarts(transcript, markingAgent('s5', null))).toEqual(new Set());
  });
});
