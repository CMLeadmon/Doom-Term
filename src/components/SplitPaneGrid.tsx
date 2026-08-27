import React from 'react';
import { SplitLayoutMode, SessionNode } from '../types/sessionTree';

export interface SplitPaneGridProps {
  layout: SplitLayoutMode;
  nodes: SessionNode[];
  activeNodeId: string;
  onSelectNode: (nodeId: string) => void;
  renderPane: (node: SessionNode, isActive: boolean) => React.ReactNode;
}

export const SplitPaneGrid: React.FC<SplitPaneGridProps> = ({
  layout,
  nodes,
  activeNodeId,
  onSelectNode,
  renderPane,
}) => {
  if (nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[13px] tracking-wider" style={{ color: 'var(--ink-dim)' }}>
        [NO ACTIVE SESSIONS - PRESS CTRL+SHIFT+T TO SPAWN]
      </div>
    );
  }

  if (layout === 'single' || nodes.length === 1) {
    const activeNode = nodes.find((n) => n.id === activeNodeId) || nodes[0];
    return (
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {renderPane(activeNode, true)}
      </div>
    );
  }

  let gridClasses = 'flex-1 grid gap-1.5 min-h-0 min-w-0 ';
  if (layout === 'split-v') {
    gridClasses += 'grid-cols-2 grid-rows-1';
  } else if (layout === 'split-h') {
    gridClasses += 'grid-cols-1 grid-rows-2';
  } else if (layout === 'grid-2x2') {
    gridClasses += 'grid-cols-2 grid-rows-2';
  }

  return (
    <div className={gridClasses}>
      {nodes.map((node) => {
        const isActive = node.id === activeNodeId;
        return (
          <div
            key={node.id}
            onClick={() => onSelectNode(node.id)}
            className={`flex flex-col min-h-0 min-w-0 ${isActive ? 'bev-up' : 'bev-dn'}`}
            style={{
              border: isActive ? '1px solid var(--st-live)' : '1px solid transparent',
              background: 'var(--ground)',
            }}
          >
            <div
              className="flex items-center justify-between px-2 py-0.5 text-[11px] font-bold tracking-wider plate"
              style={{ color: isActive ? 'var(--ink-plate)' : 'var(--ink-dim)' }}
            >
              <div className="flex items-center gap-1.5 truncate">
                <span>{isActive ? '▸' : '▪'}</span>
                <span className="truncate">{node.title}</span>
                <span className="text-[10px] opacity-75">({node.kind.toUpperCase()})</span>
              </div>
              <span className="text-[10px] uppercase">{node.agentState}</span>
            </div>
            <div className="flex-1 flex flex-col min-h-0 min-w-0">
              {renderPane(node, isActive)}
            </div>
          </div>
        );
      })}
    </div>
  );
};
