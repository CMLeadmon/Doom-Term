import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PtyClient } from './ptyClient';

type Wire = { action: string; payload: { request_id: string; id: string; text: string } };
let sockets: FakeSocket[];
class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = 0;
  onopen = () => {};
  onclose = () => {};
  onerror = () => {};
  onmessage = (_event: { data: string }) => {};
  sent: Wire[] = [];
  constructor() { sockets.push(this); }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  receive(event: string, data: unknown) { this.onmessage({ data: JSON.stringify({ event, data }) }); }
  open() { this.readyState = 1; this.onopen(); }
  authorize() { this.receive('AuthResult', { success: true, message: 'Authenticated' }); }
  reply(request: Wire, error: string | null = null, session = request.payload.id) {
    this.receive('PasteResult', { request_id: request.payload.request_id, session_id: session, error });
  }
}
let client: PtyClient;
beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  client = new (PtyClient as unknown as { new(): PtyClient })();
  client.ensureSession('pane', '/tmp/paste-fixture');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function connect() { sockets[0].open(); sockets[0].authorize(); sockets[0].sent = []; return sockets[0]; }

it('refuses paste while offline or awaiting authentication without queueing it', async () => {
  await expect(client.pasteToSession('pane', 'offline')).rejects.toThrow(/connect|auth/i);
  sockets[0].open();
  await expect(client.pasteToSession('pane', 'unauthorized')).rejects.toThrow(/connect|auth/i);
  sockets[0].authorize();
  expect(sockets[0].sent.some(m => m.action === 'Paste' || m.action === 'Write')).toBe(false);
});

it('sends plain clipboard text and resolves only the matching request AND session', async () => {
  const socket = connect();
  const promise = client.pasteToSession('pane', "'三\rnext");
  const seen = vi.fn();
  void promise.then(seen, () => {});
  const request = socket.sent[0];
  expect(request).toEqual({ action: 'Paste', payload: { request_id: expect.any(String), id: 'pane', text: "'三\rnext" } });
  socket.reply(request, null, 'other-pane');
  socket.receive('PasteResult', { request_id: 'unknown', session_id: 'pane', error: null });
  await Promise.resolve();
  expect(seen).not.toHaveBeenCalled();
  socket.reply(request);
  await expect(promise).resolves.toBeUndefined();
});

it('reports daemon refusal without a fallback Write', async () => {
  const socket = connect();
  const promise = client.pasteToSession('pane', 'one\ntwo');
  const check = expect(promise).rejects.toThrow(/Multiline paste blocked/);
  socket.reply(socket.sent[0], 'Multiline paste blocked: child mode disabled');
  await check;
  expect(socket.sent.map(m => m.action)).toEqual(['Paste']);
});

it('expires an unsupported/old-daemon request as unknown delivery and never retries', async () => {
  const socket = connect();
  const promise = client.pasteToSession('pane', 'text');
  const check = expect(promise).rejects.toThrow(/timed out.*(unknown|uncertain)/i);
  await vi.advanceTimersByTimeAsync(10000);
  await check;
  socket.reply(socket.sent[0]); // A late response cannot cause another delivery.
  expect(socket.sent.map(m => m.action)).toEqual(['Paste']);
});

it.each(['onclose', 'onerror'] as const)('rejects pending paste on %s and does not replay after reconnect', async event => {
  const socket = connect();
  const promise = client.pasteToSession('pane', 'text');
  const check = expect(promise).rejects.toThrow(/disconnect|connection/i);
  socket.readyState = 3;
  socket[event]();
  await check;
  await vi.advanceTimersByTimeAsync(2000);
  sockets[1].open(); sockets[1].authorize();
  expect(sockets[1].sent.some(m => m.action === 'Paste' || m.action === 'Write')).toBe(false);
});

it.each(['daemon', 'local'])('rejects pending paste when the %s closes its session', async owner => {
  const socket = connect();
  const promise = client.pasteToSession('pane', 'text');
  const check = expect(promise).rejects.toThrow(/closed/i);
  if (owner === 'daemon') socket.receive('SessionClosed', { session_id: 'pane' });
  else client.killSession('pane');
  await check;
  await expect(client.pasteToSession('pane', 'again')).rejects.toThrow(/closed|bound/i);
  expect(socket.sent.filter(m => m.action === 'Paste')).toHaveLength(1);
});

it('rejects input exceeding 1 MiB in UTF-8 before sending', async () => {
  const socket = connect();
  await expect(client.pasteToSession('pane', '三'.repeat(350000))).rejects.toThrow(/1 MiB/);
  expect(socket.sent).toEqual([]);
});
