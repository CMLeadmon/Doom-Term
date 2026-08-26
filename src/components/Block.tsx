import React from 'react';
import { Rail, type BlockStatus } from './Rail';
import type { TerminalBlock } from '../types/terminal';

function statusOf(b: TerminalBlock): BlockStatus {
  if (b.status === 'running') return 'live';
  if (b.exitCode == null) return 'idle';
  return b.exitCode === 0 ? 'pass' : 'fail';
}

const dur = (ms?: number) => (ms == null ? '' : ms < 1000 ? `${ms}MS` : `${(ms / 1000).toFixed(2)}S`);

export const Block: React.FC<{ block: TerminalBlock }> = ({ block }) => {
  const status = statusOf(block);
  const lines = block.snapshot ? block.snapshot.lines : block.liveLines;
  const meta = [dur(block.durationMs), block.exitCode != null ? `EXIT ${block.exitCode}` : null]
    .filter(Boolean).join(' · ');

  return (
    <div className="flex gap-3 px-3 pb-3">
      <Rail status={status} pinned={block.pinned} />
      <div data-body className="flex-1 min-w-0">
        <div className="flex gap-4 items-baseline text-[13px]">
          <span style={{ color: 'var(--st-live)' }}>▸</span>
          <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--ink)' }}>{block.command}</span>
          <span className="shrink-0 text-[11px] tracking-widest tabular-nums" style={{ color: 'var(--ink-dim)' }}>{meta}</span>
        </div>
        <div className="mt-0.5 text-[13px] whitespace-pre-wrap select-text" style={{ color: 'var(--ink-dim)' }}>
          {lines.map((l) => (
            <div key={l.id}>
              {l.spans.map((s, i) => (
                <span key={i} style={{ color: l.isError ? 'var(--st-fail)' : s.fg }}>{s.text}</span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
