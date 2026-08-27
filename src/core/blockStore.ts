import { TerminalBlock, ImmutableSnapshot, AnsiLine } from '../types/terminal';

export interface BlockStoreConfig {
  maxBlocksInDom: number;
}

export class BlockStore {
  private config: BlockStoreConfig;
  private evictedSnapshots: Map<string, ImmutableSnapshot> = new Map();

  constructor(config: BlockStoreConfig = { maxBlocksInDom: 50 }) {
    this.config = config;
  }

  /**
   * Freezes a running block into an immutable snapshot.
   */
  public freezeBlock(
    block: TerminalBlock,
    exitCode: number | null,
    liveLines: AnsiLine[]
  ): TerminalBlock {
    const duration = Date.now() - block.startedAt;
    const snapshot: ImmutableSnapshot = {
      id: `snap-${block.id}`,
      lines: [...liveLines],
      exitCode,
      durationMs: duration,
      completedAt: Date.now(),
      totalLines: liveLines.length,
    };

    return {
      ...block,
      status: (exitCode !== null && exitCode !== 0 ? 'error' : 'completed') as TerminalBlock['status'],
      completedAt: Date.now(),
      durationMs: duration,
      exitCode,
      snapshot,
    };
  }

  /**
   * Performs LRU eviction when total completed blocks exceed the DOM limit.
   * Evicted snapshots are stored in memory/storage cache.
   */
  public pruneBlocks(blocks: TerminalBlock[]): TerminalBlock[] {
    if (blocks.length <= this.config.maxBlocksInDom) {
      return blocks;
    }

    const pinned = blocks.filter((b) => b.pinned || b.status === 'running');
    const unpinned = blocks.filter((b) => !b.pinned && b.status !== 'running');

    const keepCount = Math.max(10, this.config.maxBlocksInDom - pinned.length);
    const toEvict = unpinned.slice(0, Math.max(0, unpinned.length - keepCount));
    const toKeep = unpinned.slice(Math.max(0, unpinned.length - keepCount));

    for (const b of toEvict) {
      if (b.snapshot) {
        this.evictedSnapshots.set(b.id, b.snapshot);
      }
    }

    const combined = [...toEvict.map((b) => ({ ...b, collapsed: true })), ...toKeep, ...pinned];
    return combined.sort((a, b) => a.startedAt - b.startedAt);
  }

  public getEvictedSnapshot(blockId: string): ImmutableSnapshot | undefined {
    return this.evictedSnapshots.get(blockId);
  }
}
