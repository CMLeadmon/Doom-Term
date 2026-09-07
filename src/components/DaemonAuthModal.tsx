import { useRef, useState } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useModalKeys } from '../core/modalKeyboard';

export function DaemonAuthModal({ message, onAuthenticate }: {
  message: string;
  onAuthenticate: (token: string) => void;
}) {
  const [token, setToken] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const dialog = useDialogFocus<HTMLDivElement>(true, input);
  useModalKeys(() => {}, dialog);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4">
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="daemon-auth-title" className="plate p-4 w-full max-w-md" tabIndex={-1}>
        <h2 id="daemon-auth-title" className="font-bold text-[13px]" style={{ color: 'var(--ink-plate)' }}>CONNECT TO TERMINAL DAEMON</h2>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!token) return;
          onAuthenticate(token);
          setToken('');
        }} className="recess p-3 mt-3">
          <p role="status" className="text-[12px] mb-3" style={{ color: 'var(--st-wait)' }}>{message}</p>
          <label className="block text-[12px]" htmlFor="daemon-token">Daemon access token</label>
          <input ref={input} id="daemon-token" type="password" autoComplete="off" value={token}
            onChange={(event) => setToken(event.target.value)} className="recess dt-focus-ring w-full p-2 my-2" />
          <p className="text-[11px] mb-3">Use the daemon’s DOOM_AUTH_TOKEN. It stays in memory for this window and is never saved to browser storage.</p>
          <button type="submit" disabled={!token} className="plate dt-focus-ring px-3 py-1" style={{ color: 'var(--ink-plate)' }}>CONNECT</button>
        </form>
      </div>
    </div>
  );
}
