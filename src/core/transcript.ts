import { SessionNode } from '../types/sessionTree';

/**
 * Renders a session's finished and in-flight blocks as plain text, newest last.
 * Extracted from the deleted ContextGraph, which wrapped it in a link graph that
 * never had any edges — the formatting itself is real and still used by the palette.
 */
export function formatNodeTranscript(node: SessionNode, maxLines: number = 100): string {
  const lines: string[] = [];

  for (const block of node.blocks) {
    lines.push(`>>> [${new Date(block.startedAt).toISOString()}] $ ${block.command}`);

    const outputLines = block.snapshot ? block.snapshot.lines : block.liveLines;
    for (const line of outputLines) {
      lines.push(line.spans.map((s) => s.text).join(''));
    }

    if (block.exitCode !== undefined && block.exitCode !== null) {
      lines.push(`<<< [Exit Code: ${block.exitCode}, Duration: ${block.durationMs ?? 0}ms]`);
    }
  }

  return lines.slice(-maxLines).join('\n');
}
