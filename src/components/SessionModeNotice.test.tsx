import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SessionModeNotice } from './SessionModeNotice';
import { ptyClient } from '../core/ptyClient';

afterEach(cleanup);

function report(id: string, durable: boolean, detail: string | null) {
  (ptyClient as unknown as {
    handleServerMessage: (m: { event: string; data: unknown }) => void;
  }).handleServerMessage({
    event: 'SessionMode',
    data: { session_id: id, durable, detail },
  });
}

describe('SessionModeNotice', () => {
  it('says nothing when the session survives the daemon', () => {
    report('s1', true, null);
    const { container } = render(<SessionModeNotice sessionId="s1" />);
    expect(container.textContent).toBe('');
  });

  it('names the reason when durability was wanted and not available', () => {
    // Silence here is the failure mode that matters: a user who believes a
    // session is durable leaves an agent running and closes the lid.
    //
    // Asserted on textContent rather than getByText: the notice interpolates
    // the reason, so the text spans several nodes inside one div and every
    // ancestor matches the same query.
    report('s2', false, 'tmux not found on PATH');
    const { container } = render(<SessionModeNotice sessionId="s2" />);
    expect(container.textContent).toContain('SESSION NOT DURABLE');
    expect(container.textContent).toContain('tmux not found on PATH');
  });

  it('does not nag when durability was switched off on purpose', () => {
    // An explicit opt-out is a decision already made, not a problem to report.
    report('s3', false, 'disabled by DOOM_TERM_NO_TMUX');
    const { container } = render(<SessionModeNotice sessionId="s3" />);
    expect(container.textContent).toBe('');
  });

  it('says nothing about a session the daemon has not described', () => {
    const { container } = render(<SessionModeNotice sessionId="unknown" />);
    expect(container.textContent).toBe('');
  });
});
