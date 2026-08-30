import React from 'react';
import { Block } from './Block';
import { CommandEditor } from './CommandEditor';
import { ptyClient } from '../core/ptyClient';
import { SessionNode } from '../types/sessionTree';

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
  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* Blocks Scroll Area */}
      <div
        ref={isActive ? scrollContainerRef : undefined}
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
