import React from 'react';
import { SessionNode } from '../types/sessionTree';
import { isWorking } from '../core/activityMonitor';

export interface AgentQueueIndicatorProps {
  nodes: SessionNode[];
  activeSessionId: string | null;
  onSelectNode: (nodeId: string) => void;
}

/** Pixel glyphs representing each supported agent vendor */
const renderAgentIcon = (agent: string, color: string) => {
  const norm = agent.toLowerCase();
  if (norm === 'claude') {
    // 12-point sunburst
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="2.5" fill={color} />
        <path
          d="M9 1v3M9 14v3M1 9h3M14 9h3M3.3 3.3l2.2 2.2M12.5 12.5l2.2 2.2M3.3 14.7l2.2-2.2M12.5 5.5l2.2-2.2"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="square"
        />
      </svg>
    );
  }
  if (norm === 'gemini') {
    // 4-pointed diamond star
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path
          d="M9 1C9 5.5 5.5 9 1 9C5.5 9 9 12.5 9 17C9 12.5 12.5 9 17 9C12.5 9 9 5.5 9 1Z"
          fill={color}
        />
      </svg>
    );
  }
  if (norm === 'antigravity' || norm === 'agy') {
    // Rising prism chevrons
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 2L5 6H13L9 2Z" fill={color} />
        <path d="M9 8L4 12H14L9 8Z" fill={color} fillOpacity="0.8" />
        <path d="M9 13L3 17H15L9 13Z" fill={color} fillOpacity="0.6" />
      </svg>
    );
  }
  if (norm === 'codex') {
    // Square chip
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="2" y="2" width="14" height="14" stroke={color} strokeWidth="2" />
        <rect x="6" y="6" width="6" height="6" fill={color} />
      </svg>
    );
  }
  // Generic / terminal
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M4 4L9 9L4 14" stroke={color} strokeWidth="2" strokeLinecap="square" />
      <path d="M10 14H15" stroke={color} strokeWidth="2" />
    </svg>
  );
};

const AGENT_COLORS: Record<string, string> = {
  claude: '#e08a63',
  codex: '#e6e6e6',
  gemini: '#8ab6ff',
  antigravity: '#d8ecff',
  agy: '#d8ecff',
  aider: '#d8b45f',
  opencode: '#8fd4a0',
  grok: '#e6e6e6',
  copilot: '#c8b4ff',
  shell: '#c8bb9c',
};

export const AgentQueueIndicator: React.FC<AgentQueueIndicatorProps> = ({
  nodes,
  activeSessionId,
  onSelectNode,
}) => {
  // Find all active agent sessions or sessions that have an agent foreground process
  const agentNodes = nodes.filter((node) => {
    if (node.parked) return false;
    if (node.foregroundAgent) return true;
    if (node.kind === 'agent') return true;
    return false;
  });

  if (agentNodes.length === 0) return null;

  return (
    <div
      className="absolute top-2 right-4 z-40 flex items-center gap-1.5 plate px-2 py-1 select-none font-mono"
      style={{
        boxShadow: 'var(--bevel-up)',
        background: '#1a1916',
        border: '1px solid #2f2f2e',
      }}
      aria-label="Agent queue indicator"
    >
      <span className="text-[10px] font-bold tracking-wider px-1" style={{ color: 'var(--ink-dim)' }}>
        AGENTS:
      </span>

      {agentNodes.map((node) => {
        const agentKey = (node.foregroundAgent || (node.kind === 'agent' ? 'agy' : 'shell')).toLowerCase();
        const isActive = node.id === activeSessionId;
        const busy = isWorking(node.id);
        const stalled = Boolean(node.blockedOnUser);
        const color = AGENT_COLORS[agentKey] || '#d8cbb0';

        let statusClass = '';
        let borderStyle = '1px solid transparent';
        let bgStyle = '#14120f';

        if (stalled) {
          // High priority motionless alert
          statusClass = 'ring-2 ring-[#ef4136]';
          borderStyle = '1px solid var(--st-fail)';
          bgStyle = '#2a1110';
        } else if (busy) {
          // Working: pulsing animation
          statusClass = 'animate-pulse';
          borderStyle = '1px solid var(--st-live)';
          bgStyle = '#261f0e';
        } else if (isActive) {
          borderStyle = '1px solid var(--st-pass)';
        }

        const tooltip = `${node.number ? `[${node.number}] ` : ''}${node.title} (${agentKey.toUpperCase()}) - ${
          stalled ? 'STALLED / ASKS PERMISSION' : busy ? 'WORKING...' : 'IDLE'
        }`;

        return (
          <button
            key={node.id}
            type="button"
            title={tooltip}
            onClick={() => onSelectNode(node.id)}
            className={`relative p-1 flex items-center justify-center transition-all cursor-pointer ${statusClass}`}
            style={{
              background: bgStyle,
              border: borderStyle,
              boxShadow: 'var(--bevel-dn)',
              width: '28px',
              height: '28px',
            }}
          >
            {renderAgentIcon(agentKey, stalled ? 'var(--st-fail)' : busy ? 'var(--st-live)' : color)}

            {stalled && (
              <span
                className="absolute -top-1 -right-1 w-2.5 h-2.5 text-[8px] font-black flex items-center justify-center text-white bg-[#ef4136]"
                style={{ lineHeight: 1 }}
              >
                !
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
