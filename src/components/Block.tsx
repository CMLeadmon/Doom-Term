import React, { useState } from 'react';
import { Rail, type BlockStatus } from './Rail';
import { ToolCall } from './ToolCall';
import { Diff } from './Diff';
import type { TerminalBlock } from '../types/terminal';
import { audioEngine } from '../core/audioEngine';
import { spanStyle } from '../core/spanStyle';

function statusOf(b: TerminalBlock): BlockStatus {
  if (b.status === 'running') return 'live';
  if (b.status === 'error' || (b.exitCode != null && b.exitCode !== 0)) return 'fail';
  if (b.status === 'completed' || b.exitCode === 0) return 'pass';
  return 'idle';
}

const dur = (ms?: number) => (ms == null ? '' : ms < 1000 ? `${ms}MS` : `${(ms / 1000).toFixed(2)}S`);

interface BlockProps {
  block: TerminalBlock;
  onApplyDiff?: (file: string) => void;
  onRejectDiff?: (file: string) => void;
  onTogglePin?: (id: string) => void;
  onToggleCollapse?: (id: string) => void;
}

export const Block: React.FC<BlockProps> = ({
  block,
  onApplyDiff,
  onRejectDiff,
  onTogglePin,
  onToggleCollapse,
}) => {
  const [copied, setCopied] = useState<string | null>(null);
  const status = statusOf(block);
  const lines = block.snapshot ? block.snapshot.lines : block.liveLines;
  const meta = [dur(block.durationMs), block.exitCode != null ? `EXIT ${block.exitCode}` : null]
    .filter(Boolean)
    .join(' · ');

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(block.command);
    audioEngine.playSound('click', 3);
    setCopied('cmd');
    setTimeout(() => setCopied(null), 1500);
  };

  const handleCopyOutput = () => {
    const rawText = lines
      .map((l) => l.spans.map((s) => s.text).join(''))
      .join('\n');
    navigator.clipboard.writeText(rawText);
    audioEngine.playSound('click', 3);
    setCopied('out');
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="group flex gap-3 px-3 pb-3 relative">
      <Rail status={status} pinned={block.pinned} />
      <div data-body className="flex-1 min-w-0">
        {/* HEADER BAR */}
        <div className="flex gap-4 items-baseline text-[13px] relative">
          <span style={{ color: 'var(--st-live)' }}>▸</span>
          <span className="flex-1 min-w-0 truncate font-mono" style={{ color: 'var(--ink)' }}>
            {block.command}
          </span>
          <span className="shrink-0 text-[11px] tracking-widest tabular-nums font-mono" style={{ color: 'var(--ink-dim)' }}>
            {meta}
          </span>

          {/* ACTION BUTTONS (HOVER / FOCUS) */}
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-1.5 ml-2">
            <button
              onClick={handleCopyCommand}
              title="Copy Command"
              className="text-[10px] px-1.5 py-0.5 plate font-mono"
              style={{ color: copied === 'cmd' ? 'var(--st-pass)' : 'var(--ink-dim)' }}
            >
              {copied === 'cmd' ? 'COPIED' : 'CMD'}
            </button>

            <button
              onClick={handleCopyOutput}
              title="Copy Output"
              className="text-[10px] px-1.5 py-0.5 plate font-mono"
              style={{ color: copied === 'out' ? 'var(--st-pass)' : 'var(--ink-dim)' }}
            >
              {copied === 'out' ? 'COPIED' : 'OUT'}
            </button>

            {onTogglePin && (
              <button
                onClick={() => onTogglePin(block.id)}
                title={block.pinned ? 'Unpin Block' : 'Pin Block'}
                className="text-[10px] px-1.5 py-0.5 plate font-mono"
                style={{ color: block.pinned ? 'var(--st-live)' : 'var(--ink-dim)' }}
              >
                {block.pinned ? '★' : '☆'}
              </button>
            )}

            {onToggleCollapse && (
              <button
                onClick={() => onToggleCollapse(block.id)}
                title={block.collapsed ? 'Expand Output' : 'Collapse Output'}
                className="text-[10px] px-1.5 py-0.5 plate font-mono"
                style={{ color: 'var(--ink-dim)' }}
              >
                {block.collapsed ? '▾' : '▴'}
              </button>
            )}
          </div>
        </div>

        {/* TOOL CALLS */}
        {block.toolCalls?.map((c, i) => (
          <ToolCall key={i} call={c} />
        ))}

        {/* INLINE DIFF IF PRESENT */}
        {block.diffContent && (
          <Diff
            file={block.diffContent.file}
            lines={block.diffContent.lines}
            added={block.diffContent.added}
            removed={block.diffContent.removed}
            onApply={() => {
              audioEngine.playSound('shotgun', 2);
              onApplyDiff?.(block.diffContent!.file);
            }}
            onReject={() => {
              audioEngine.playSound('oof', 2);
              onRejectDiff?.(block.diffContent!.file);
            }}
          />
        )}

        {/* BLOCK OUTPUT — --ink-tan, not --ink-dim: output is primary content,
            and SGR 2 then has somewhere to dim to without dropping under 4.5:1. */}
        {!block.collapsed && (
          <div className="mt-0.5 text-[13px] whitespace-pre-wrap select-text font-mono" style={{ color: 'var(--ink-tan)' }}>
            {lines.map((l) => (
              <div key={l.id} data-error={l.isError ? '' : undefined}>
                {l.spans.map((s, i) => (
                  <span key={i} style={spanStyle(s, l.isError)}>
                    {s.text}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
