import { SystemTelemetryData } from '../types/terminal';

export type DemuxEventHandler = {
  onOutput: (data: string) => void;
  onPromptStart?: () => void;
  onCommandStart?: () => void;
  onExecutionStart?: () => void;
  onExecutionEnd?: (exitCode: number | null) => void;
  onTuiMode?: (active: boolean) => void;
  onSessionClosed?: () => void;
};

export class PtyClient {
  private static instance: PtyClient;
  private ws: WebSocket | null = null;
  private isConnected: boolean = false;
  private sessionId: string = `session-${Date.now()}`;
  private handlers: Set<DemuxEventHandler> = new Set();
  private telemetryHandlers: Set<(data: SystemTelemetryData) => void> = new Set();
  private reconnectTimer: number | null = null;
  private pendingWrites: string[] = [];

  private constructor() {
    this.connect();
  }

  public static getInstance(): PtyClient {
    if (!PtyClient.instance) {
      PtyClient.instance = new PtyClient();
    }
    return PtyClient.instance;
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  public registerHandler(handler: DemuxEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  public onTelemetry(cb: (data: SystemTelemetryData) => void): () => void {
    this.telemetryHandlers.add(cb);
    return () => this.telemetryHandlers.delete(cb);
  }

  public connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const wsUrl = `ws://${window.location.hostname || '127.0.0.1'}:1421`;
    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        console.log('⚡ Connected to Doom Term PTY daemon');
        if (this.reconnectTimer) {
          window.clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }

        // Spawn initial shell session
        this.spawnSession(this.sessionId, 120, 30);
        this.requestTelemetry();

        // Flush pending writes
        while (this.pendingWrites.length > 0) {
          const item = this.pendingWrites.shift();
          if (item) this.write(item);
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleServerMessage(msg);
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        console.warn('Disconnected from Doom Term daemon. Retrying in 2s...');
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.isConnected = false;
        // Trigger simulated fallback if server is not yet running
        this.scheduleReconnect();
      };
    } catch {
      this.isConnected = false;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (!this.reconnectTimer) {
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 2000);
    }
  }

  private handleServerMessage(msg: {
    event: string;
    data: unknown;
  }) {
    if (msg.event === 'PtyEvent') {
      const ptyData = msg.data as {
        session_id: string;
        event: {
          type: string;
          payload?: unknown;
        };
      };

      const event = ptyData.event;
      if (event.type === 'Output') {
        const payload = event.payload as { data: string };
        this.handlers.forEach((h) => h.onOutput(payload.data));
      } else if (event.type === 'PromptStart') {
        this.handlers.forEach((h) => h.onPromptStart?.());
      } else if (event.type === 'CommandStart') {
        this.handlers.forEach((h) => h.onCommandStart?.());
      } else if (event.type === 'ExecutionStart') {
        this.handlers.forEach((h) => h.onExecutionStart?.());
      } else if (event.type === 'ExecutionEnd') {
        const payload = event.payload as { exit_code: number | null };
        this.handlers.forEach((h) => h.onExecutionEnd?.(payload?.exit_code ?? 0));
      } else if (event.type === 'TuiMode') {
        const payload = event.payload as { active: boolean };
        this.handlers.forEach((h) => h.onTuiMode?.(payload.active));
      }
    } else if (msg.event === 'Telemetry') {
      const teleData = msg.data as SystemTelemetryData;
      this.telemetryHandlers.forEach((cb) => cb(teleData));
    } else if (msg.event === 'SessionClosed') {
      this.handlers.forEach((h) => h.onSessionClosed?.());
    }
  }

  public spawnSession(id: string, cols: number = 120, rows: number = 30, cwd?: string, shell?: string) {
    this.send({
      action: 'Spawn',
      payload: { id, cols, rows, cwd, shell },
    });
  }

  public write(data: string) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingWrites.push(data);
      return;
    }
    this.send({
      action: 'Write',
      payload: { id: this.sessionId, data },
    });
  }

  /**
   * Submits a command in Mode A (Rich Editor).
   * Automatically formats multi-line commands with ANSI Bracketed Paste mode:
   * \x1b[200~<content>\x1b[201~\n
   */
  public submitCommand(command: string) {
    const isMultiLine = command.includes('\n');
    let payload: string;

    if (isMultiLine) {
      // Wrap in ANSI bracketed paste mode to prevent premature execution of intermediate lines
      payload = `\x1b[200~${command}\x1b[201~\n`;
    } else {
      payload = `${command}\n`;
    }

    this.write(payload);
  }

  public resize(cols: number, rows: number) {
    this.send({
      action: 'Resize',
      payload: { id: this.sessionId, cols, rows },
    });
  }

  public sendSignal(signal: 'SIGINT' | 'SIGTSTP' | 'EOF' | 'SIGKILL' | 'ctrl+c' | 'ctrl+z' | 'ctrl+d') {
    this.send({
      action: 'Signal',
      payload: { id: this.sessionId, signal },
    });
  }

  public requestTelemetry() {
    this.send({ action: 'GetTelemetry' });
  }

  private send(msg: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

export const ptyClient = PtyClient.getInstance();
