import React, { useRef } from 'react';
import { Block } from './Block';
import { CommandEditor } from './CommandEditor';
import { ptyClient } from '../core/ptyClient';
import { SessionNode } from '../types/sessionTree';
import { useTerminalSize } from '../hooks/useTerminalSize';

export interface BlockPaneProps {
  node: SessionNode;
  isActive: boolean;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  scrollDetached: boolean;
  onScroll: () => void;
  onSnapToBottom: () => void;
  onExecute: (cmd: string) => void;
  onApplyDiff: (file: string) => void;
  onOpenHistory: () => void;
}

/**
 * The block view of a session.
 *
 * A real component rather than a branch of `renderSessionPane`, because a pane
 * has to run hooks: `useTerminalSize` cannot be called from a function that
 * runs conditionally and twice over in a split layout.
 */
export const BlockPane: React.FC<BlockPaneProps> = ({
  node,
  isActive,
  scrollContainerRef,
  scrollDetached,
  onScroll,
  onSnapToBottom,
  onExecute,
  onApplyDiff,
  onOpenHistory,
}) => {
  // The shell wraps at $COLUMNS whichever view is showing, so the block pane
  // has to report a size too. Unconditional, unlike scrollContainerRef, which
  // is only bound for the active pane.
  const gridRef = useRef<HTMLDivElement | null>(null);
  useTerminalSize(gridRef, node.id);

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* Blocks Scroll Area */}
      <div
        ref={(el) => {
          gridRef.current = el;
          // Never null the shared ref. With every pane mounted, React detaches
          // the deactivating pane's ref after attaching the activating one's, so
          // an unguarded assignment would clear the ref that was just set and
          // the scroll restore would silently do nothing.
          if (isActive && el) scrollContainerRef.current = el;
        }}
        onScroll={isActive ? onScroll : undefined}
        className="flex-1 overflow-y-auto px-2 py-1 space-y-1.5 min-h-0"
      >
        {node.blocks.length === 0 ? (
          <div className="text-[12px] p-2 select-none" style={{ color: 'var(--ink-dim)' }}>
            Type a command below to execute.
          </div>
        ) : (
          node.blocks.map((block) => (
            <Block key={block.id} block={block} onApplyDiff={onApplyDiff} />
          ))
        )}
      </div>

      {/* Scroll Detached Indicator */}
      {isActive && scrollDetached && (
        <div className="flex justify-center my-1 select-none">
          <button
            onClick={onSnapToBottom}
            className="plate px-3 py-0.5 text-[11px] font-bold tracking-wider animate-pulse"
            style={{ color: 'var(--ink-plate)' }}
          >
            [SCROLL DETACHED — PRESS SPACE TO RESUME]
          </button>
        </div>
      )}

      {/* Bottom Command Editor */}
      <div className="mt-auto px-2 pb-1.5 pt-1">
        <CommandEditor
          onExecute={onExecute}
          onSendSignal={(sig) => ptyClient.sendSignalToSession(node.id, sig)}
          onOpenHistory={onOpenHistory}
          history={node.commandHistory}
          currentDir={node.cwd}
          gitBranch={node.gitBranch}
          isRunning={node.agentState === 'running'}
        />
      </div>
    </div>
  );
};
