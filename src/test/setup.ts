// Unit tests must never connect to a developer's real terminal daemon.
// Transport tests install their own controllable socket at the network boundary.
class OfflineWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly readyState = OfflineWebSocket.CONNECTING;
  send(): void { throw new Error('Unit test attempted a live WebSocket send'); }
  close(): void {}
}
Object.defineProperty(globalThis, 'WebSocket', { configurable: true, writable: true, value: OfflineWebSocket });
