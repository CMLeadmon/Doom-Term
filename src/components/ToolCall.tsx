import React from 'react';
import type { ToolCall as Call } from '../types/terminal';

export const ToolCall: React.FC<{ call: Call }> = ({ call }) => {
  const live = call.live === true;
  const tone = live ? 'var(--st-live)' : 'var(--ink-tan)';
  return (
    <div className="flex gap-3 items-baseline text-[13px] py-px">
      <span data-verb data-live={String(live)} style={{ color: tone }}>▸</span>
      <span className="w-14 shrink-0 tracking-wider" style={{ color: tone }}>{call.verb}</span>
      <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--ink)' }}>{call.target}</span>
      <span className="shrink-0 text-[11px] tabular-nums" style={{ color: 'var(--ink-dim)' }}>
        {call.added != null && <span data-add style={{ color: 'var(--st-pass)' }}>+{call.added}</span>}
        {call.added != null && call.removed != null && ' '}
        {call.removed != null && <span data-del style={{ color: 'var(--st-fail)' }}>−{call.removed}</span>}
        {call.added == null && call.removed == null && call.result}
      </span>
    </div>
  );
};
