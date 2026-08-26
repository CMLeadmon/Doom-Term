import React, { useState } from 'react';
import { TerminalBlock } from '../types/terminal';
import { Copy, Check, Pin, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { audioEngine } from '../core/audioEngine';

interface CommandBlockProps {
  block: TerminalBlock;
  onExplainAI?: (block: TerminalBlock) => void;
  onTogglePin?: (id: string) => void;
}

export const CommandBlock: React.FC<CommandBlockProps> = ({
  block,
  onExplainAI,
  onTogglePin,
}) => {
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [copiedOutput, setCopiedOutput] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(block.collapsed || false);

  const isCompleted = block.status === 'completed' || block.status === 'error';
  const isRunning = block.status === 'running';
  const hasFailed = block.exitCode !== undefined && block.exitCode !== null && block.exitCode !== 0;

  // Use frozen lines from snapshot if available, otherwise live lines
  const linesToRender = block.snapshot ? block.snapshot.lines : block.liveLines;

  const handleCopyCommand = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(block.command);
    setCopiedCommand(true);
    audioEngine.playSound('pickup', 3);
    setTimeout(() => setCopiedCommand(false), 1500);
  };

  const handleCopyOutput = (e: React.MouseEvent) => {
    e.stopPropagation();
    const fullText = linesToRender
      .map((l) => l.spans.map((s) => s.text).join(''))
      .join('\n');
    navigator.clipboard.writeText(fullText);
    setCopiedOutput(true);
    audioEngine.playSound('pickup', 3);
    setTimeout(() => setCopiedOutput(false), 1500);
  };

  const formatDuration = (ms?: number) => {
    if (ms === undefined) return '';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div
      className={`rounded-md border my-2 transition-all duration-150 overflow-hidden shadow-doom-bevel ${
        hasFailed
          ? 'bg-[#180e0e] border-doom-blood/50 shadow-doom-glow-red'
          : isRunning
          ? 'bg-doom-card border-doom-gold/50'
          : 'bg-doom-card border-doom-border hover:border-[#555555]'
      } ${block.pinned ? 'ring-1 ring-doom-cyan' : ''}`}
    >
      {/* HEADER */}
      <div
        onClick={() => setIsCollapsed(!isCollapsed)}
        className={`px-3 py-2 flex items-center justify-between cursor-pointer select-none text-xs font-mono border-b ${
          hasFailed
            ? 'bg-[#220a0a] border-doom-blood/30 text-doom-blood'
            : isRunning
            ? 'bg-[#221c0e] border-doom-gold/30 text-doom-gold'
            : 'bg-[#1c1c1c] border-[#2e2e2e] text-doom-dim'
        }`}
      >
        <div className="flex items-center space-x-2 truncate max-w-[70%]">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsCollapsed(!isCollapsed);
            }}
            className="p-0.5 hover:text-doom-white text-doom-dim"
          >
            {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {/* Prompt Marker */}
          <span className="font-bold text-doom-gold">[&gt;]</span>

          {/* Command String */}
          <span className="font-semibold text-doom-white tracking-wide truncate">
            {block.command}
          </span>
        </div>

        {/* METADATA & ACTIONS */}
        <div className="flex items-center space-x-2 shrink-0">
          {block.gitBranch && (
            <span className="hidden sm:inline text-[10px] bg-[#111111] px-1.5 py-0.5 rounded text-doom-cyan border border-[#333333]">
              {block.gitBranch}
            </span>
          )}

          {block.durationMs !== undefined && (
            <span className="text-[11px] text-doom-dim">
              [{formatDuration(block.durationMs)}]
            </span>
          )}

          {/* STATUS BADGE */}
          {isRunning ? (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#332500] text-doom-gold animate-pulse border border-doom-gold/40">
              RUNNING
            </span>
          ) : hasFailed ? (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#3a0d0d] text-doom-blood border border-doom-blood/50">
              ERR {block.exitCode}
            </span>
          ) : isCompleted ? (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#0d2a13] text-doom-slime border border-doom-slime/40">
              DONE
            </span>
          ) : null}

          {/* BLOCK ACTIONS */}
          <div className="flex items-center space-x-1 pl-1 border-l border-[#333333]">
            {/* Explain with AI */}
            {onExplainAI && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onExplainAI(block);
                }}
                title="Explain with AI (Ctrl+E)"
                className="p-1 hover:text-doom-gold text-doom-dim rounded hover:bg-[#2a2a2a] transition-colors"
              >
                <Sparkles className="w-3 h-3" />
              </button>
            )}

            {/* Copy Command */}
            <button
              onClick={handleCopyCommand}
              title="Copy Command"
              className="p-1 hover:text-doom-white text-doom-dim rounded hover:bg-[#2a2a2a] transition-colors"
            >
              {copiedCommand ? <Check className="w-3 h-3 text-doom-slime" /> : <Copy className="w-3 h-3" />}
            </button>

            {/* Pin Block */}
            {onTogglePin && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin(block.id);
                }}
                title={block.pinned ? 'Unpin Block' : 'Pin Block'}
                className={`p-1 rounded hover:bg-[#2a2a2a] transition-colors ${
                  block.pinned ? 'text-doom-cyan' : 'text-doom-dim hover:text-doom-white'
                }`}
              >
                <Pin className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* BODY / OUTPUT LINES */}
      {!isCollapsed && (
        <div className="p-3 font-mono text-[13px] leading-relaxed select-text overflow-x-auto max-h-[500px] overflow-y-auto">
          {linesToRender.length === 0 ? (
            <div className="text-doom-dim text-xs italic py-1">
              {isRunning ? 'Executing...' : 'No output produced.'}
            </div>
          ) : (
            linesToRender.map((line) => (
              <div
                key={line.id}
                className={`py-0.5 px-1 rounded whitespace-pre-wrap break-all ${
                  line.isError
                    ? 'bg-doom-bloodBg/50 text-doom-blood border-l-2 border-doom-blood pl-1.5'
                    : ''
                }`}
              >
                {line.spans.map((span, spanIdx) => (
                  <span
                    key={spanIdx}
                    style={{
                      color: line.isError && !span.fg ? '#ff4444' : span.fg,
                      backgroundColor: span.bg,
                      fontWeight: span.bold ? 'bold' : 'normal',
                      fontStyle: span.italic ? 'italic' : 'normal',
                      textDecoration: [
                        span.underline ? 'underline' : '',
                        span.strikethrough ? 'line-through' : '',
                      ]
                        .filter(Boolean)
                        .join(' ') || undefined,
                      opacity: span.dim ? 0.65 : 1,
                    }}
                  >
                    {span.text}
                  </span>
                ))}
              </div>
            ))
          )}

          {/* AI Explanation Accordion */}
          {block.aiExplanation && (
            <div className="mt-3 p-2.5 rounded bg-[#16202c] border border-doom-cyan/30 text-xs text-doom-white shadow-doom-inset">
              <div className="flex items-center space-x-1.5 font-bold text-doom-cyan mb-1">
                <Sparkles className="w-3.5 h-3.5" />
                <span>DOOM ADVISOR ANALYSIS</span>
              </div>
              <p className="leading-normal text-doom-white/90">{block.aiExplanation}</p>
            </div>
          )}

          {/* Bottom Card Footer with copy output and timestamp */}
          <div className="mt-2 pt-2 border-t border-[#222222] flex items-center justify-between text-[10px] text-doom-dim select-none">
            <span>Started: {formatTimestamp(block.startedAt)}</span>
            <button
              onClick={handleCopyOutput}
              className="flex items-center space-x-1 text-doom-dim hover:text-doom-white transition-colors"
            >
              {copiedOutput ? (
                <>
                  <Check className="w-3 h-3 text-doom-slime" />
                  <span className="text-doom-slime">Copied output</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy output</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
