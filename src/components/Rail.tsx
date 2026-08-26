import React from 'react';

export type BlockStatus = 'live' | 'pass' | 'fail' | 'wait' | 'idle';

const CAP: Record<BlockStatus, string> = {
  live: 'var(--st-live)', pass: 'var(--st-pass)', fail: 'var(--st-fail)',
  wait: 'var(--st-wait)', idle: 'var(--st-idle)',
};

/**
 * A strip of plate spanning the block's height, capped with its state.
 * This replaces the card border: block boundaries without boxing output.
 */
export const Rail: React.FC<{ status: BlockStatus; pinned?: boolean }> = ({ status, pinned }) => (
  <div
    className={`${pinned ? 'recess' : 'plate'} w-6 shrink-0 flex flex-col items-center pt-1`}
    aria-hidden="true"
  >
    <span className="recess w-4 h-3 flex items-center justify-center">
      <i data-cap={status} className="block w-1.5 h-1.5" style={{ background: CAP[status] }} />
    </span>
  </div>
);
