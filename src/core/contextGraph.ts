import { ContextLink, SessionNode } from '../types/sessionTree';

export interface LinkedContextSummary {
  nodeId: string;
  title: string;
  kind: string;
  agentState: string;
  lastCommand?: string;
  lastExitCode?: number | null;
  totalBlocks: number;
}

export class ContextGraph {
  private links: ContextLink[] = [];

  constructor(initialLinks: ContextLink[] = []) {
    this.links = [...initialLinks];
  }

  public getLinks(): ContextLink[] {
    return [...this.links];
  }

  public setLinks(links: ContextLink[]) {
    this.links = [...links];
  }

  public addLink(fromNodeId: string, toNodeId: string): ContextLink | null {
    if (fromNodeId === toNodeId) return null;
    const exists = this.links.some(
      (l) => l.fromNodeId === fromNodeId && l.toNodeId === toNodeId
    );
    if (exists) return null;

    const link: ContextLink = {
      fromNodeId,
      toNodeId,
      createdAt: Date.now(),
    };
    this.links.push(link);
    return link;
  }

  public removeLink(fromNodeId: string, toNodeId: string) {
    this.links = this.links.filter(
      (l) => !(l.fromNodeId === fromNodeId && l.toNodeId === toNodeId)
    );
  }

  public getLinkedUpstreamIds(nodeId: string): string[] {
    // Return all nodes that link TO this node
    return this.links.filter((l) => l.toNodeId === nodeId).map((l) => l.fromNodeId);
  }

  public getLinkedDownstreamIds(nodeId: string): string[] {
    // Return all nodes that this node links TO
    return this.links.filter((l) => l.fromNodeId === nodeId).map((l) => l.toNodeId);
  }

  public getSummary(targetNode: SessionNode): LinkedContextSummary {
    const lastBlock = targetNode.blocks[targetNode.blocks.length - 1];
    return {
      nodeId: targetNode.id,
      title: targetNode.title,
      kind: targetNode.kind,
      agentState: targetNode.agentState,
      lastCommand: lastBlock?.command,
      lastExitCode: lastBlock?.exitCode,
      totalBlocks: targetNode.blocks.length,
    };
  }

  public getTranscript(targetNode: SessionNode, maxLines: number = 100): string {
    const lines: string[] = [];
    for (const block of targetNode.blocks) {
      lines.push(`>>> [${new Date(block.startedAt).toISOString()}] $ ${block.command}`);
      const outputLines = block.snapshot ? block.snapshot.lines : block.liveLines;
      for (const line of outputLines) {
        const text = line.spans.map((s) => s.text).join('');
        lines.push(text);
      }
      if (block.exitCode !== undefined && block.exitCode !== null) {
        lines.push(`<<< [Exit Code: ${block.exitCode}, Duration: ${block.durationMs ?? 0}ms]`);
      }
    }
    return lines.slice(-maxLines).join('\n');
  }

  public getTerminalBuffer(targetNode: SessionNode, maxLines: number = 50): string {
    if (targetNode.isTuiActive && targetNode.tuiLines.length > 0) {
      return targetNode.tuiLines
        .slice(-maxLines)
        .map((line) => line.spans.map((s) => s.text).join(''))
        .join('\n');
    }
    const lastBlock = targetNode.blocks[targetNode.blocks.length - 1];
    if (!lastBlock) return '';
    const lines = lastBlock.snapshot ? lastBlock.snapshot.lines : lastBlock.liveLines;
    return lines
      .slice(-maxLines)
      .map((line) => line.spans.map((s) => s.text).join(''))
      .join('\n');
  }
}
