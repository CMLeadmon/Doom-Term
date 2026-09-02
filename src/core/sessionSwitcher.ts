import type { SessionNode } from '../types/sessionTree';

const renderedLines = (node: SessionNode): string[] =>
  node.tuiLines.map((line) => line.spans.map((span) => span.text).join('').trimEnd());

/**
 * Order sessions for deliberate switching: a pane asking for the operator
 * always leads, then recently used work, then the stable Ctrl+number address.
 * A copy is sorted so opening the palette never rewrites workspace order.
 */
export function rankSessions(nodes: SessionNode[]): SessionNode[] {
  return [...nodes].sort((a, b) => {
    const attention = Number(Boolean(b.blockedOnUser)) - Number(Boolean(a.blockedOnUser));
    if (attention) return attention;
    const recency = (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt);
    if (recency) return recency;
    return (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER);
  });
}

/** A broad, invisible search corpus keeps the visible switcher rows spare. */
export function sessionSearchText(node: SessionNode, workspaceName: string): string {
  return [
    node.title,
    node.cwd,
    node.gitBranch,
    node.foregroundAgent,
    workspaceName,
    node.parked ? 'parked detached' : '',
    ...renderedLines(node),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

/** The tail is enough to identify a pane without temporarily switching to it. */
export function previewSession(node: SessionNode, lineCount = 3): string {
  return renderedLines(node)
    .filter((line) => line.trim().length > 0)
    .slice(-lineCount)
    .join('\n');
}
