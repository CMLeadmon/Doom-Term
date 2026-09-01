import { SessionNode } from '../types/sessionTree';

/**
 * A session's screen as plain text, newest last.
 *
 * This used to walk `node.blocks`, which the block editor populated. That
 * editor is gone and nothing has created a block since, so the palette's "Copy
 * Session Transcript" was silently copying an empty string — a feature that
 * looked present and did nothing.
 *
 * There is one view now, so there is one source: the same lines it renders.
 * Spans are joined and colour discarded, because what lands on a clipboard is
 * text.
 */
export function formatNodeTranscript(node: SessionNode, maxLines: number = 100): string {
  return node.tuiLines
    .map((line) => line.spans.map((s) => s.text).join('').trimEnd())
    .slice(-maxLines)
    .join('\n');
}
