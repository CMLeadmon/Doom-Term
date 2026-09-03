import type { SessionNode } from '../types/sessionTree';

const renderedLines = (node: SessionNode): string[] =>
  node.tuiLines.map((line) => line.spans.map((span) => span.text).join('').trimEnd());

/** What the plate's waiting rows can tell the operator, in the same order. */
export interface SwitcherAttention {
  /** Has the operator already seen this session's latest output? */
  isAcknowledged(id: string, blockedOnUser: boolean): boolean;
}

/**
 * How loudly a session is asking for the operator. Lower leads.
 *
 * The switcher used to rank on `blockedOnUser` alone while calling itself
 * attention-first. That is one of the three states the plate's waiting rows
 * show: a session that FAILED and one that has unread output are both in the
 * attention queue, and neither was promoted here — so the palette disagreed
 * with the plate about what needed looking at.
 *
 * The order matches the plate: an agent that has SAID it needs you outranks a
 * command that failed, which outranks output nobody has read.
 */
export function attentionRank(node: SessionNode, attention?: SwitcherAttention): number {
  if (node.blockedOnUser) return 0;
  if (typeof node.lastExitCode === 'number' && node.lastExitCode !== 0) return 1;
  if (attention && !attention.isAcknowledged(node.id, false)) return 2;
  return 3;
}

/**
 * Order sessions for deliberate switching: a pane asking for the operator
 * always leads, then recently used work, then the stable Ctrl+number address.
 * A copy is sorted so opening the palette never rewrites workspace order.
 */
export function rankSessions(
  nodes: SessionNode[],
  attention?: SwitcherAttention,
): SessionNode[] {
  return [...nodes].sort((a, b) => {
    const urgency = attentionRank(a, attention) - attentionRank(b, attention);
    if (urgency) return urgency;
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
