import React from 'react';
import { ProjectWorkspace, SessionGroup, SessionNode, SplitLayoutMode } from '../types/sessionTree';

export interface SessionTreeProps {
  workspace: ProjectWorkspace;
  onSelectNode: (nodeId: string, groupId: string) => void;
  onSelectGroup: (groupId: string) => void;
  onCreateNode: (groupId: string, kind: SessionNode['kind']) => void;
  onSetGroupLayout: (groupId: string, layout: SplitLayoutMode) => void;
  onCloseNode: (nodeId: string) => void;
  onOpenWorkspace?: () => void;
  onRenameNode?: (nodeId: string, newTitle: string) => void;
  onRenameGroup?: (groupId: string, newName: string) => void;
}

export const SessionTree: React.FC<SessionTreeProps> = ({
  workspace,
  onSelectNode,
  onSelectGroup,
  onCreateNode,
  onSetGroupLayout,
  onCloseNode,
  onOpenWorkspace,
  onRenameNode,
  onRenameGroup,
}) => {
  const [editingNodeId, setEditingNodeId] = React.useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = React.useState<string | null>(null);
  const [editText, setEditText] = React.useState('');

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

  const handleFinishRenameNode = (id: string) => {
    const trimmed = editText.trim();
    if (trimmed && onRenameNode) {
      onRenameNode(id, trimmed);
    }
    setEditingNodeId(null);
  };

  const handleFinishRenameGroup = (id: string) => {
    const trimmed = editText.trim();
    if (trimmed && onRenameGroup) {
      onRenameGroup(id, trimmed);
    }
    setEditingGroupId(null);
  };

  return (
    <div
      className="flex flex-col h-full select-none text-[12px] font-mono recess p-1.5 overflow-y-auto"
      style={{ width: '16rem', borderRight: '1px solid #2f2f2e' }}
    >
      {/* Workspace Header */}
      <div className="flex items-center justify-between px-1.5 py-1 mb-1.5 plate font-bold tracking-wider" style={{ color: 'var(--ink-plate)' }}>
        <div
          onClick={onOpenWorkspace}
          title="Click to Switch / Open Workspace (Ctrl+O)"
          className="flex items-center gap-1.5 truncate cursor-pointer hover:text-[#3a2a04]"
        >
          <span>❖</span>
          <span className="truncate">{workspace.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onOpenWorkspace}
            title="Open / Select Workspace Folder"
            className="px-1 text-[10px] font-bold hover:opacity-80 border border-[#2f2f2e]/40"
          >
            +WS
          </button>
        </div>
      </div>

      {/* Groups & Sessions Tree */}
      <div className="flex flex-col gap-2">
        {workspace.groups.map((group: SessionGroup) => {
          const isGroupActive = workspace.activeGroupId === group.id;
          const isEditingGroup = editingGroupId === group.id;

          return (
            <div key={group.id} className="flex flex-col">
              {/* Group Header */}
              <div
                onClick={() => onSelectGroup(group.id)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingGroupId(group.id);
                  setEditText(group.name);
                }}
                className={`flex items-center justify-between px-1.5 py-1 cursor-pointer transition-colors ${
                  isGroupActive ? 'plate' : 'hover:bg-[#1f1d19]'
                }`}
                style={{ color: isGroupActive ? 'var(--ink-plate)' : 'var(--ink-tan)' }}
                title="Double click to rename workstream"
              >
                <div className="flex items-center gap-1 truncate font-bold flex-1 mr-1">
                  <span>☵</span>
                  {isEditingGroup ? (
                    <input
                      type="text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      onBlur={() => handleFinishRenameGroup(group.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleFinishRenameGroup(group.id);
                        if (e.key === 'Escape') setEditingGroupId(null);
                      }}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      className="w-full px-1 py-0 text-[10.5px] bg-black text-[#ffd700] border border-[#ffd700] focus:outline-none font-normal"
                    />
                  ) : (
                    <span className="truncate">{group.name}</span>
                  )}
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
                  const isEditingNode = editingNodeId === node.id;
                  const stateColor = getAgentStateColor(node.agentState);

                  return (
                    <div
                      key={node.id}
                      onClick={() => onSelectNode(node.id, group.id)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingNodeId(node.id);
                        setEditText(node.title);
                      }}
                      className={`flex items-center justify-between px-1.5 py-0.5 my-0.5 cursor-pointer text-[11px] ${
                        isNodeActive ? 'bev-dn' : 'hover:bg-[#1a1815]'
                      }`}
                      style={{
                        background: isNodeActive ? 'var(--ground-2)' : 'transparent',
                        color: isNodeActive ? 'var(--ink)' : 'var(--ink-dim)',
                      }}
                      title="Double click to rename session"
                    >
                      <div className="flex items-center gap-1.5 truncate flex-1 mr-1">
                        <span style={{ color: stateColor, fontSize: '8px' }}>●</span>
                        {isEditingNode ? (
                          <input
                            type="text"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onBlur={() => handleFinishRenameNode(node.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleFinishRenameNode(node.id);
                              if (e.key === 'Escape') setEditingNodeId(null);
                            }}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                            className="w-full px-1 py-0 text-[10.5px] bg-black text-[#ffd700] border border-[#ffd700] focus:outline-none"
                          />
                        ) : (
                          <span className="truncate">{node.title}</span>
                        )}
                        {node.kind !== 'terminal' && !isEditingNode && (
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
