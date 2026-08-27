import React from 'react';
import { ProjectWorkspace, SessionGroup, SessionNode, SplitLayoutMode } from '../types/sessionTree';

export interface SessionTreeProps {
  workspace: ProjectWorkspace;
  onSelectNode: (nodeId: string, groupId: string) => void;
  onSelectGroup: (groupId: string) => void;
  onCreateNode: (groupId: string, kind: SessionNode['kind']) => void;
  onCreateWorktreeGroup: (branch: string) => void;
  onSetGroupLayout: (groupId: string, layout: SplitLayoutMode) => void;
  onCloseNode: (nodeId: string) => void;
}

export const SessionTree: React.FC<SessionTreeProps> = ({
  workspace,
  onSelectNode,
  onSelectGroup,
  onCreateNode,
  onCreateWorktreeGroup,
  onSetGroupLayout,
  onCloseNode,
}) => {
  const [newBranchInput, setNewBranchInput] = React.useState('');
  const [showWorktreeInput, setShowWorktreeInput] = React.useState(false);

  const getAgentStateColor = (state: SessionNode['agentState']) => {
    switch (state) {
      case 'running':
        return 'var(--st-live)';
      case 'waiting_input':
        return 'var(--st-wait)';
      case 'errored':
        return 'var(--st-fail)';
      case 'verifying':
        return 'var(--st-live)';
      default:
        return 'var(--st-idle)';
    }
  };

  const handleAddWorktree = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newBranchInput.trim();
    if (trimmed) {
      onCreateWorktreeGroup(trimmed);
      setNewBranchInput('');
      setShowWorktreeInput(false);
    }
  };

  return (
    <div
      className="flex flex-col h-full select-none text-[12px] font-mono recess p-1.5 overflow-y-auto"
      style={{ width: '16rem', borderRight: '1px solid #2f2f2e' }}
    >
      {/* Workspace Header */}
      <div className="flex items-center justify-between px-1.5 py-1 mb-1.5 plate font-bold tracking-wider" style={{ color: 'var(--ink-plate)' }}>
        <div className="flex items-center gap-1.5 truncate">
          <span>❖</span>
          <span className="truncate">{workspace.name}</span>
        </div>
        <button
          onClick={() => setShowWorktreeInput(!showWorktreeInput)}
          title="New Git Worktree Stream"
          className="px-1 text-[11px] font-bold hover:opacity-80"
        >
          +WT
        </button>
      </div>

      {/* New Worktree Input Form */}
      {showWorktreeInput && (
        <form onSubmit={handleAddWorktree} className="mb-2 p-1.5 bev-dn flex flex-col gap-1" style={{ background: 'var(--ground-2)' }}>
          <span className="text-[10px] tracking-wider" style={{ color: 'var(--ink-dim)' }}>NEW WORKTREE BRANCH:</span>
          <input
            type="text"
            value={newBranchInput}
            onChange={(e) => setNewBranchInput(e.target.value)}
            placeholder="e.g. feat/auth"
            autoFocus
            className="w-full px-1.5 py-0.5 text-[11px] bg-black text-[#d8cbb0] border border-[#2f2f2e] focus:outline-none"
          />
          <div className="flex justify-end gap-1 mt-1">
            <button
              type="button"
              onClick={() => setShowWorktreeInput(false)}
              className="px-1.5 py-0.5 text-[10px] text-[#8f8672] hover:text-white"
            >
              CANCEL
            </button>
            <button
              type="submit"
              className="px-2 py-0.5 text-[10px] plate font-bold"
              style={{ color: 'var(--ink-plate)' }}
            >
              CREATE
            </button>
          </div>
        </form>
      )}

      {/* Groups & Sessions Tree */}
      <div className="flex flex-col gap-2">
        {workspace.groups.map((group: SessionGroup) => {
          const isGroupActive = workspace.activeGroupId === group.id;

          return (
            <div key={group.id} className="flex flex-col">
              {/* Group Header */}
              <div
                onClick={() => onSelectGroup(group.id)}
                className={`flex items-center justify-between px-1.5 py-1 cursor-pointer transition-colors ${
                  isGroupActive ? 'plate' : 'hover:bg-[#1f1d19]'
                }`}
                style={{ color: isGroupActive ? 'var(--ink-plate)' : 'var(--ink-tan)' }}
              >
                <div className="flex items-center gap-1 truncate font-bold">
                  <span>{group.worktreeBranch ? '⑂' : '☵'}</span>
                  <span className="truncate">{group.name}</span>
                </div>

                {/* Layout Selector & Actions */}
                <div className="flex items-center gap-1 text-[10px]" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => onSetGroupLayout(group.id, 'single')}
                    title="Single Pane"
                    className={`px-1 ${group.layout === 'single' ? 'font-bold underline' : 'opacity-60'}`}
                  >
                    1
                  </button>
                  <button
                    onClick={() => onSetGroupLayout(group.id, 'split-v')}
                    title="Vertical Split"
                    className={`px-1 ${group.layout === 'split-v' ? 'font-bold underline' : 'opacity-60'}`}
                  >
                    2V
                  </button>
                  <button
                    onClick={() => onSetGroupLayout(group.id, 'grid-2x2')}
                    title="2x2 Quad Grid"
                    className={`px-1 ${group.layout === 'grid-2x2' ? 'font-bold underline' : 'opacity-60'}`}
                  >
                    4
                  </button>
                  <button
                    onClick={() => onCreateNode(group.id, 'terminal')}
                    title="Add Terminal"
                    className="px-1 font-bold hover:text-[#e0a92c]"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Group Nodes */}
              <div className="flex flex-col pl-2 mt-0.5 border-l border-[#2a2824]">
                {group.nodeIds.map((nodeId) => {
                  const node = workspace.nodes[nodeId];
                  if (!node) return null;
                  const isNodeActive = group.activeNodeId === nodeId && isGroupActive;
                  const stateColor = getAgentStateColor(node.agentState);

                  return (
                    <div
                      key={node.id}
                      onClick={() => onSelectNode(node.id, group.id)}
                      className={`flex items-center justify-between px-1.5 py-0.5 my-0.5 cursor-pointer text-[11px] ${
                        isNodeActive ? 'bev-dn' : 'hover:bg-[#1a1815]'
                      }`}
                      style={{
                        background: isNodeActive ? 'var(--ground-2)' : 'transparent',
                        color: isNodeActive ? 'var(--ink)' : 'var(--ink-dim)',
                      }}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span style={{ color: stateColor, fontSize: '8px' }}>●</span>
                        <span className="truncate">{node.title}</span>
                        {node.kind !== 'terminal' && (
                          <span className="text-[9px] uppercase px-1 py-0.2 bg-[#2a251e] text-[#c8bb9c]">
                            {node.kind}
                          </span>
                        )}
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onCloseNode(node.id);
                        }}
                        className="text-[10px] text-[#6b645a] hover:text-[#d40b06] px-1"
                        title="Close Node"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
