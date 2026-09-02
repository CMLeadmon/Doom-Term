import type { AnsiLine } from '../types/terminal';

export type QuickTargetType = 'url' | 'fileLine' | 'path' | 'sha' | 'issue';

export interface QuickTarget {
  type: QuickTargetType;
  value: string;
  line: number;
  start: number;
  end: number;
}

export interface LabeledQuickTarget extends QuickTarget {
  label: string;
}

const PATTERNS: Array<[QuickTargetType, RegExp]> = [
  ['fileLine', /(?<![\w./])(?:\.{0,2}\/|\/)?(?:[\w@+-]+\/)*[\w@.+-]+\.[A-Za-z0-9]+:\d+(?::\d+)?/g],
  ['url', /https?:\/\/[^\s<>"']+/g],
  ['path', /(?:\.{1,2}\/|\/)(?:[^\s:;,()]+)|(?:[\w@.+-]+\/)+[\w@.+-]+/g],
  ['sha', /\b[0-9a-f]{7,40}\b/gi],
  ['issue', /#\d+\b/g],
];

const trimClosingPunctuation = (value: string): string => value.replace(/[.,;)}\]]+$/, '');

/**
 * Extract actionable developer references without parsing terminal prose.
 * Higher-priority matches reserve their range, so `src/App.tsx:42` is one
 * file-line target rather than a path plus a stray number.
 */
export function findQuickTargets(lines: AnsiLine[]): QuickTarget[] {
  const seen = new Set<string>();
  const targets: QuickTarget[] = [];

  lines.forEach((line, lineIndex) => {
    const text = line.spans.map((span) => span.text).join('');
    const occupied: Array<[number, number]> = [];
    const lineTargets: QuickTarget[] = [];

    for (const [type, source] of PATTERNS) {
      const pattern = new RegExp(source.source, source.flags);
      for (const match of text.matchAll(pattern)) {
        if (match.index === undefined) continue;
        const value = trimClosingPunctuation(match[0]);
        const start = match.index;
        const end = start + value.length;
        if (!value || occupied.some(([a, b]) => start < b && end > a)) continue;
        occupied.push([start, end]);
        if (seen.has(value)) continue;
        seen.add(value);
        lineTargets.push({ type, value, line: lineIndex, start, end });
      }
    }

    targets.push(...lineTargets.sort((a, b) => a.start - b.start));
  });

  return targets;
}

const HOME_ROW = 'asdfghjklqwertyuiopzxcvbnm';

function labelAt(index: number): string {
  if (index < HOME_ROW.length) return HOME_ROW[index];
  const first = Math.floor(index / HOME_ROW.length) - 1;
  return `${HOME_ROW[first % HOME_ROW.length]}${HOME_ROW[index % HOME_ROW.length]}`;
}

export function labelTargets(targets: QuickTarget[]): LabeledQuickTarget[] {
  return targets.map((target, index) => ({ ...target, label: labelAt(index) }));
}
