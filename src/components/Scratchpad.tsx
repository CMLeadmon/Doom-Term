import React, { useState } from 'react';
import { audioEngine } from '../core/audioEngine';

export interface ScratchpadProps {
  title: string;
  initialContent?: string;
  onSave: (content: string) => void;
  onClose?: () => void;
}

export const Scratchpad: React.FC<ScratchpadProps> = ({
  title,
  initialContent = '',
  onSave,
  onClose,
}) => {
  const [content, setContent] = useState(initialContent);
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    audioEngine.playSound('click', 3);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleContentChange = (val: string) => {
    setContent(val);
    onSave(val);
  };

  return (
    <div className="flex flex-col h-full font-mono p-2 recess select-none overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center px-2 py-1 mb-2 plate font-bold" style={{ color: 'var(--ink-plate)' }}>
        <div className="flex items-center gap-2 truncate">
          <span>✎</span>
          <span className="truncate">SCRATCHPAD: {title}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="px-1.5 py-0.5 text-[10px] recess hover:bg-[#1f1d19]"
            style={{ color: 'var(--ink)' }}
          >
            {isEditing ? 'VIEW' : 'EDIT'}
          </button>
          <button
            onClick={handleCopy}
            className="px-1.5 py-0.5 text-[10px] recess hover:bg-[#1f1d19]"
            style={{ color: 'var(--ink)' }}
          >
            {copied ? 'COPIED!' : 'COPY'}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="text-[12px] hover:text-[var(--st-fail)]"
              style={{ color: 'var(--ink-plate)' }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Editor / Markdown Render Area */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 bev-dn p-2" style={{ background: 'var(--ground-2)' }}>
        {isEditing ? (
          <textarea
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            placeholder="Write persistent notes, architecture tasks, or agent memories..."
            className="w-full h-full bg-transparent text-[12px] leading-relaxed text-[#d8cbb0] focus:outline-none resize-none font-mono"
          />
        ) : (
          <div className="flex-1 overflow-y-auto text-[12px] leading-relaxed whitespace-pre-wrap text-[#d8cbb0]">
            {content ? (
              content
            ) : (
              <span className="italic" style={{ color: 'var(--ink-dim)' }}>
                [Empty scratchpad. Click EDIT above or write via agent sticky command]
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
