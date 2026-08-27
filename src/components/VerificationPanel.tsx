import React from 'react';

export interface VerificationLens {
  id: string;
  name: string;
  status: 'passed' | 'failed' | 'warning' | 'running';
  details: string;
}

export interface VerificationPanelProps {
  targetTitle: string;
  lenses: VerificationLens[];
  verdict: 'APPROVED' | 'REJECTED' | 'IN_PROGRESS';
  onApply: () => void;
  onReject: () => void;
  onRerun: () => void;
  onClose: () => void;
}

export const VerificationPanel: React.FC<VerificationPanelProps> = ({
  targetTitle,
  lenses,
  verdict,
  onApply,
  onReject,
  onRerun,
  onClose,
}) => {
  const getStatusBadge = (status: VerificationLens['status']) => {
    switch (status) {
      case 'passed':
        return <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#14280f] text-[#5c9c3a]">PASS</span>;
      case 'failed':
        return <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#320a0a] text-[#d40b06]">FAIL</span>;
      case 'warning':
        return <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#2d240c] text-[#e0a92c]">WARN</span>;
      case 'running':
        return <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#0f1f38] text-[#3a6fd8]">CHECKING</span>;
    }
  };

  const getVerdictStyle = () => {
    if (verdict === 'APPROVED') return { bg: '#14280f', fg: '#5c9c3a', text: 'VERDICT: VERIFIED & SAFE TO APPLY' };
    if (verdict === 'REJECTED') return { bg: '#320a0a', fg: '#d40b06', text: 'VERDICT: ISSUES FOUND - DO NOT APPLY' };
    return { bg: '#2d240c', fg: '#e0a92c', text: 'VERDICT: MULTI-LENS REVIEW IN PROGRESS' };
  };

  const vInfo = getVerdictStyle();

  return (
    <div className="flex flex-col h-full font-mono p-2 recess select-none overflow-y-auto">
      {/* Header */}
      <div className="flex justify-between items-center px-2 py-1 mb-2 plate font-bold" style={{ color: 'var(--ink-plate)' }}>
        <div className="flex items-center gap-2">
          <span>⚖</span>
          <span>MULTI-LENS VERIFICATION: {targetTitle}</span>
        </div>
        <button onClick={onClose} className="text-[12px] hover:text-[#d40b06]">×</button>
      </div>

      {/* Synthesis Verdict Banner */}
      <div
        className="p-2 mb-2 flex items-center justify-between bev-dn"
        style={{ background: vInfo.bg, color: vInfo.fg }}
      >
        <span className="text-[12px] font-bold tracking-wider">{vInfo.text}</span>
        <button
          onClick={onRerun}
          className="px-2 py-0.5 text-[11px] font-bold plate"
          style={{ color: 'var(--ink-plate)' }}
        >
          RE-RUN ALL
        </button>
      </div>

      {/* 4 Parallel Reviewer Lenses */}
      <div className="flex flex-col gap-1.5 mb-3">
        {lenses.map((lens) => (
          <div key={lens.id} className="p-2 bev-dn flex flex-col gap-1" style={{ background: 'var(--ground-2)' }}>
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold" style={{ color: 'var(--ink-tan)' }}>{lens.name}</span>
              {getStatusBadge(lens.status)}
            </div>
            <div className="text-[11px] leading-relaxed" style={{ color: 'var(--ink)' }}>
              {lens.details}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom Action Affordance */}
      <div className="flex justify-end gap-2 mt-auto pt-2 border-t border-[#2a2824]">
        <button
          onClick={onReject}
          className="px-3 py-1 text-[11px] font-bold bev-up"
          style={{ background: '#320a0a', color: '#f01a12' }}
        >
          DISCARD / REJECT
        </button>
        <button
          onClick={onApply}
          disabled={verdict !== 'APPROVED'}
          className={`px-4 py-1 text-[11px] font-bold ${
            verdict === 'APPROVED' ? 'plate' : 'opacity-40 cursor-not-allowed'
          }`}
          style={{ color: 'var(--ink-plate)' }}
        >
          APPLY VERIFIED PATCH
        </button>
      </div>
    </div>
  );
};
