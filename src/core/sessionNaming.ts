import { SessionKind } from '../types/sessionTree';

const LABEL: Record<SessionKind, string> = {
  terminal: 'Terminal',
  agent: 'Agent',
  tui: 'Terminal',
  scratchpad: 'Notes',
};

/**
 * The next auto-generated title for `kind`.
 *
 * Only titles this function could itself have produced are counted. Scanning
 * every title for a trailing number meant renaming a tab `deploy-2026` made
 * the next one `Terminal 2027`.
 */
export function nextSessionTitle(kind: SessionKind, existingTitles: string[]): string {
  const label = LABEL[kind];
  const auto = new RegExp(`^${label} (\\d+)$`);

  const highest = existingTitles.reduce((max, title) => {
    const match = title.match(auto);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);

  return `${label} ${highest + 1}`;
}
