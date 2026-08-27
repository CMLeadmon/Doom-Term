import { SystemTelemetryData } from '../types/terminal';

export type DemuxEventHandler = {
  // The session id is passed through so a global handler can route each chunk
  // to that session's emulator rather than assuming it belongs to the active one.
  onOutput: (data: string, sessionId: string) => void;
  onCwd?: (cwd: string, sessionId: string) => void;
  onPromptStart?: () => void;
  onCommandStart?: () => void;
  onExecutionStart?: () => void;
  onExecutionEnd?: (exitCode: number | null) => void;
  onTuiMode?: (active: boolean) => void;
  onAgentState?: (state: string) => void;
  onSessionClosed?: () => void;
};

export class PtyClient {
  private static instance: PtyClient;
  private ws: WebSocket | null = null;
  private isConnected: boolean = false;
  private activeSessionId: string = `session-1`;
  private globalHandlers: Set<DemuxEventHandler> = new Set();
  private sessionHandlers: Map<string, Set<DemuxEventHandler>> = new Map();
  private telemetryHandlers: Set<(data: SystemTelemetryData) => void> = new Set();
  private worktreeHandlers: Set<(data: { branch: string; path: string; success: boolean }) => void> = new Set();
  private reconnectTimer: number | null = null;
  private pendingWrites: { sessionId: string; data: string }[] = [];
  private isTauri: boolean = false;

  private constructor() {
    this.detectEnvironment();
    this.connect();
  }

  public static getInstance(): PtyClient {
    if (!PtyClient.instance) {
      PtyClient.instance = new PtyClient();
    }
    return PtyClient.instance;
  }

  private detectEnvironment() {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      this.isTauri = true;
      console.log('⚡ Doom Term running inside Tauri desktop shell');
    }
  }

  public getSessionId(): string {
    return this.activeSessionId;
  }

  public getIsTauri(): boolean {
    return this.isTauri;
  }

  public setActiveSession(id: string) {
    this.activeSessionId = id;
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  public registerHandler(handler: DemuxEventHandler): () => void {
    this.globalHandlers.add(handler);
    return () => this.globalHandlers.delete(handler);
  }

  public registerSessionHandler(sessionId: string, handler: DemuxEventHandler): () => void {
    if (!this.sessionHandlers.has(sessionId)) {
      this.sessionHandlers.set(sessionId, new Set());
    }
    this.sessionHandlers.get(sessionId)!.add(handler);
    return () => {
      this.sessionHandlers.get(sessionId)?.delete(handler);
    };
  }

  public onTelemetry(cb: (data: SystemTelemetryData) => void): () => void {
    this.telemetryHandlers.add(cb);
    return () => this.telemetryHandlers.delete(cb);
  }

  public onWorktreeCreated(cb: (data: { branch: string; path: string; success: boolean }) => void): () => void {
    this.worktreeHandlers.add(cb);
    return () => this.worktreeHandlers.delete(cb);
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

        // Spawn active session
        this.spawnSession(this.activeSessionId, 120, 30);
        this.requestTelemetry();

        // Flush pending writes
        while (this.pendingWrites.length > 0) {
          const item = this.pendingWrites.shift();
          if (item) this.writeToSession(item.sessionId, item.data);
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
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.isConnected = false;
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

      const targetSession = ptyData.session_id;
      const event = ptyData.event;
      const sessionSpecific = this.sessionHandlers.get(targetSession);

      const notify = (fn: (h: DemuxEventHandler) => void) => {
        sessionSpecific?.forEach(fn);
        if (targetSession === this.activeSessionId) {
          this.globalHandlers.forEach(fn);
        }
      };

      if (event.type === 'Output') {
        const payload = event.payload as { data: string };
        notify((h) => h.onOutput(payload.data, targetSession));
      } else if (event.type === 'Cwd') {
        const payload = event.payload as { path: string };
        notify((h) => h.onCwd?.(payload.path, targetSession));
      } else if (event.type === 'PromptStart') {
        notify((h) => h.onPromptStart?.());
      } else if (event.type === 'CommandStart') {
        notify((h) => h.onCommandStart?.());
      } else if (event.type === 'ExecutionStart') {
        notify((h) => h.onExecutionStart?.());
      } else if (event.type === 'ExecutionEnd') {
        const payload = event.payload as { exit_code: number | null };
        notify((h) => h.onExecutionEnd?.(payload?.exit_code ?? 0));
      } else if (event.type === 'TuiMode') {
        const payload = event.payload as { active: boolean };
        notify((h) => h.onTuiMode?.(payload.active));
      } else if (event.type === 'AgentState') {
        const payload = event.payload as { state: string };
        notify((h) => h.onAgentState?.(payload.state));
      }
    } else if (msg.event === 'Telemetry') {
      const teleData = msg.data as SystemTelemetryData;
      this.telemetryHandlers.forEach((cb) => cb(teleData));
    } else if (msg.event === 'WorktreeCreated') {
      const wtData = msg.data as { branch: string; path: string; success: boolean };
      this.worktreeHandlers.forEach((cb) => cb(wtData));
    } else if (msg.event === 'SessionClosed') {
      const target = (msg.data as { session_id?: string })?.session_id;
      if (target && this.sessionHandlers.has(target)) {
        this.sessionHandlers.get(target)?.forEach((h) => h.onSessionClosed?.());
      } else {
        this.globalHandlers.forEach((h) => h.onSessionClosed?.());
      }
    }
  }

  public authenticate(token: string) {
    this.send({
      action: 'Auth',
      payload: { token },
    });
  }

  public spawnSession(id: string, cols: number = 120, rows: number = 30, cwd?: string, shell?: string) {
    this.send({
      action: 'Spawn',
      payload: { id, cols, rows, cwd, shell },
    });
  }

  public reattachSession(id: string) {
    this.send({
      action: 'Reattach',
      payload: { id },
    });
  }

  public spawnWorktree(branch: string, baseRef?: string) {
    this.send({
      action: 'SpawnWorktree',
      payload: { branch, base_ref: baseRef },
    });
  }

  public writeToSession(sessionId: string, data: string) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingWrites.push({ sessionId, data });
      return;
    }
    this.send({
      action: 'Write',
      payload: { id: sessionId, data },
    });
  }

  public write(data: string) {
    this.writeToSession(this.activeSessionId, data);
  }

  public submitCommandToSession(sessionId: string, command: string) {
    const isMultiLine = command.includes('\n');
    let payload: string;

    if (isMultiLine) {
      // Wrap in ANSI bracketed paste mode to prevent premature execution of intermediate lines
      payload = `\x1b[200~${command}\x1b[201~\n`;
    } else {
      payload = `${command}\n`;
    }

    this.writeToSession(sessionId, payload);
  }

  public submitCommand(command: string) {
    this.submitCommandToSession(this.activeSessionId, command);
  }

  public resizeSession(sessionId: string, cols: number, rows: number) {
    this.send({
      action: 'Resize',
      payload: { id: sessionId, cols, rows },
    });
  }

  public resize(cols: number, rows: number) {
    this.resizeSession(this.activeSessionId, cols, rows);
  }

  public sendSignalToSession(sessionId: string, signal: 'SIGINT' | 'SIGTSTP' | 'EOF' | 'SIGKILL' | 'ctrl+c' | 'ctrl+z' | 'ctrl+d') {
    this.send({
      action: 'Signal',
      payload: { id: sessionId, signal },
    });
  }

  public sendSignal(signal: 'SIGINT' | 'SIGTSTP' | 'EOF' | 'SIGKILL' | 'ctrl+c' | 'ctrl+z' | 'ctrl+d') {
    this.sendSignalToSession(this.activeSessionId, signal);
  }

  public killSession(sessionId: string) {
    this.send({
      action: 'Kill',
      payload: { id: sessionId },
    });
  }

  public requestTelemetry(cwd?: string) {
    this.send({ action: 'GetTelemetry', payload: { cwd: cwd ?? null } });
  }

  private send(msg: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

export const ptyClient = PtyClient.getInstance();
