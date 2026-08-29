import { SystemTelemetryData } from '../types/terminal';

export interface DirectoryEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_git_repo: boolean;
}

export interface DirectoryListing {
  /** Echoed back so a reply can be matched to the request that asked for it. */
  request_id: string;
  current_path: string;
  parent_path?: string;
  entries: DirectoryEntry[];
}

export type DemuxEventHandler = {
  // The session id is passed through so a global handler can route each chunk
  // to that session's emulator rather than assuming it belongs to the active one.
  onOutput: (data: string, sessionId: string) => void;
  onCwd?: (cwd: string, sessionId: string) => void;
  onPromptStart?: () => void;
  onCommandStart?: () => void;
  onExecutionStart?: (sessionId?: string) => void;
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
  private directoryListingResolvers = new Map<
    string,
    { resolve: (l: DirectoryListing) => void; reject: (e: Error) => void; timer: number }
  >();
  private nextRequestId = 0;
  private spawnedSessions = new Set<string>();
  private activeSessionCwd: string | undefined;
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

  /**
   * Bind a UI session to a daemon session, spawning it the first time.
   *
   * Without this, a restored or default workspace showed a terminal that was
   * never connected to anything: the client spawned its own placeholder id on
   * connect while the UI submitted commands under the node's id, so a freshly
   * launched app could not run anything until a tab was created by hand.
   */
  public ensureSession(id: string, cwd?: string) {
    this.activeSessionId = id;
    this.activeSessionCwd = cwd;

    if (this.spawnedSessions.has(id)) {
      // Already ours — ask for what we missed rather than starting a second shell.
      this.reattachSession(id);
      return;
    }

    this.spawnedSessions.add(id);
    this.spawnSession(id, 120, 30, cwd);
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

  public connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    // Inside the desktop shell the daemon is a bundled sidecar bound to
    // 127.0.0.1, so address it numerically: the page origin is tauri://localhost
    // and 'localhost' can resolve to ::1, which nothing is listening on.
    const host = this.isTauri ? '127.0.0.1' : window.location.hostname || '127.0.0.1';
    const wsUrl = `ws://${host}:1421`;
    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        console.log('⚡ Connected to Doom Term PTY daemon');
        if (this.reconnectTimer) {
          window.clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }

        // A reconnect may mean the daemon restarted, in which case nothing it
        // held survives. Forget what we spawned and re-establish the session
        // the UI is actually showing.
        this.spawnedSessions.clear();
        if (this.activeSessionId) {
          this.ensureSession(this.activeSessionId, this.activeSessionCwd);
        }
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
    } else if (msg.event === 'DirectoryListing') {
      const listing = msg.data as DirectoryListing;
      const pending = listing.request_id
        ? this.directoryListingResolvers.get(listing.request_id)
        : undefined;
      if (pending && listing.request_id) {
        window.clearTimeout(pending.timer);
        this.directoryListingResolvers.delete(listing.request_id);
        pending.resolve(listing);
      }
    } else if (msg.event === 'SessionClosed') {
      const target = (msg.data as { session_id?: string })?.session_id;
      if (target && this.sessionHandlers.has(target)) {
        this.sessionHandlers.get(target)?.forEach((h) => h.onSessionClosed?.());
      } else {
        this.globalHandlers.forEach((h) => h.onSessionClosed?.());
      }
    }
  }

  public async browseDirectory(path?: string): Promise<DirectoryListing> {
    if (this.isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const listing = await invoke<Omit<DirectoryListing, 'request_id'>>('browse_directory', {
          path: path || null,
        });
        // A direct invoke is already correlated by the call itself.
        return { ...listing, request_id: 'tauri' };
      } catch (e) {
        console.warn('Tauri browse_directory failed, fallback to WS:', e);
      }
    }

    return new Promise<DirectoryListing>((resolve, reject) => {
      const requestId = `dir-${this.nextRequestId++}`;

      // A send() on a closed socket is dropped. Without a timeout its resolver
      // would sit in the map forever; with the old FIFO matching it also
      // offset every later reply by one.
      const timer = window.setTimeout(() => {
        this.directoryListingResolvers.delete(requestId);
        reject(new Error(`browseDirectory timed out for ${path ?? '~'}`));
      }, 5000);

      this.directoryListingResolvers.set(requestId, { resolve, reject, timer });
      this.send({
        action: 'BrowseDirectory',
        payload: { request_id: requestId, path: path || null },
      });
    });
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

  /**
   * Ask the daemon about the session that is on screen.
   *
   * The session id is not a parameter: `activeSessionId` is already the one
   * writes, resizes and signals go to, so it is by definition the visible tab.
   * Passing it here is what stops telemetry describing a different session —
   * the foreground process, and so the agent and its rate limit, differ per tab.
   */
  public requestTelemetry(cwd?: string) {
    this.send({
      action: 'GetTelemetry',
      payload: { cwd: cwd ?? null, session_id: this.activeSessionId ?? null },
    });
  }

  private send(msg: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

/**
 * A typed workspace path, as opposed to a substring filter.
 *
 * The picker's input serves both purposes, so it has to decide which one the
 * user meant. Anything rooted at / or ~ is a path; anything else filters.
 */
export function looksLikeAbsolutePath(value: string): boolean {
  const v = value.trim();
  return v.startsWith('/') || v === '~' || v.startsWith('~/');
}

export const ptyClient = PtyClient.getInstance();
