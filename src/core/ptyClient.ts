import { SystemTelemetryData } from '../types/terminal';
import { BOOTSTRAP_COLS, BOOTSTRAP_ROWS } from './emulatorRegistry';
import { deliverCommand } from './commandDelivery';
import { HoldBuffer } from './holdBuffer';
import type { RecoverableSession } from './sessionRecovery';

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

export interface SessionListing {
  request_id: string;
  sessions: RecoverableSession[];
}

export type DemuxEventHandler = {
  // The session id is passed through so a global handler can route each chunk
  // to that session's emulator rather than assuming it belongs to the active one.
  onOutput: (data: string, sessionId: string) => void;
  onCwd?: (cwd: string, sessionId: string) => void;
  onPromptStart?: (sessionId: string) => void;
  onCommandStart?: (sessionId: string) => void;
  onExecutionStart?: (sessionId: string) => void;
  onExecutionEnd?: (exitCode: number | null, sessionId: string) => void;
  onTuiMode?: (active: boolean, sessionId: string) => void;
  onAgentState?: (state: string, sessionId: string) => void;
  /**
   * An agent CLI told us something through its own hook.
   *
   * `event` is the vendor's name verbatim: PermissionRequest means blocked on a
   * human, Stop means done.
   *
   * `doomSessionId` is the exact pane, when the hook could name one — the
   * daemon puts DOOM_TERM_SESSION_ID on every session's environment and the
   * hook script forwards it. `cwd` is the fallback for an agent that was
   * already running before its session carried that variable, and it is only
   * an approximation: two agents in one repository share a directory.
   */
  onAgentEvent?: (e: {
    agent: string;
    event: string;
    cwd?: string | null;
    doomSessionId?: string | null;
  }) => void;
  /**
   * A session's process ended. The id is passed through because a global
   * handler owns every session, not just the visible one — without it the
   * workspace could not tell WHICH pane had just lost its shell.
   */
  onSessionClosed?: (sessionId: string) => void;
};

export class PtyClient {
  private static instance: PtyClient;
  private ws: WebSocket | null = null;
  private isConnected: boolean = false;
  /**
   * The session the keyboard belongs to, or '' before the UI has said.
   *
   * It used to default to the literal id `session-1`, which the connect handler
   * then dutifully spawned — a whole shell, and under tmux a whole durable
   * session, that no pane has ever rendered. `destroy-unattached off` keeps it
   * forever, so one accumulated per machine and sat there for days.
   */
  private activeSessionId: string = '';
  private globalHandlers: Set<DemuxEventHandler> = new Set();
  private sessionHandlers: Map<string, Set<DemuxEventHandler>> = new Map();
  /** Cancel functions for deliveries still in flight, keyed by session. */
  private deliveries: Map<string, () => void> = new Map();
  /** Keystrokes held while a session's command line is unsubmitted. */
  private holds: Map<string, HoldBuffer> = new Map();
  private telemetryHandlers: Set<(data: SystemTelemetryData) => void> = new Set();
  /** The last size each session was told, so a reconnect can restate it. */
  private sessionSizes = new Map<string, { cols: number; rows: number }>();
  private sessionModes = new Map<string, { durable: boolean; detail: string | null }>();
  private sessionModeHandlers = new Set<
    (id: string, durable: boolean, detail: string | null) => void
  >();
  private directoryListingResolvers = new Map<
    string,
    { resolve: (l: DirectoryListing) => void; reject: (e: Error) => void; timer: number }
  >();
  private sessionListingResolvers = new Map<
    string,
    { resolve: (l: SessionListing) => void; reject: (e: Error) => void; timer: number }
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
      // Already bound on THIS socket, so there is nothing to catch up on.
      //
      // This used to send Reattach, and the daemon answers that by replaying its
      // whole 500-event ring. That made sense when only the visible pane was
      // routed; it does not now that global handlers consume every session
      // continuously. Merely selecting a pane replayed events we had already
      // applied — doubling scrollback, re-firing ExecutionStart/End, and
      // re-notifying. `spawnedSessions` is cleared on every open, so membership
      // here means "this connection spawned it", which is exactly the condition
      // under which no interval can have been missed. A genuinely new generation
      // falls through to Spawn below, which the daemon treats as rebind+replay.
      return;
    }

    this.spawnedSessions.add(id);
    // The pane corrects this within a frame of mount via useTerminalSize; these
    // are only what the shell sees for its first prompt.
    this.spawnSession(id, BOOTSTRAP_COLS, BOOTSTRAP_ROWS, cwd);
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

  /**
   * Whether a session survives the daemon, and why not when it does not.
   *
   * Null means the daemon has not described it yet — which is not the same as
   * "not durable" and must not be rendered as a warning.
   */
  public getSessionMode(id: string): { durable: boolean; detail: string | null } | null {
    return this.sessionModes.get(id) ?? null;
  }

  public onSessionMode(
    cb: (id: string, durable: boolean, detail: string | null) => void
  ): () => void {
    this.sessionModeHandlers.add(cb);
    return () => this.sessionModeHandlers.delete(cb);
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
        // Before the writes: a shell that resizes after reading input rewraps
        // what it already echoed.
        this.flushSizes();

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
        // Global means every session. All callbacks carry targetSession and the
        // workspace router updates that node; restricting this to the visible
        // pane made background activity, failures, and asks impossible to know.
        this.globalHandlers.forEach(fn);
      };

      if (event.type === 'Output') {
        const payload = event.payload as { data: string };
        notify((h) => h.onOutput(payload.data, targetSession));
      } else if (event.type === 'Cwd') {
        const payload = event.payload as { path: string };
        notify((h) => h.onCwd?.(payload.path, targetSession));
      } else if (event.type === 'PromptStart') {
        notify((h) => h.onPromptStart?.(targetSession));
      } else if (event.type === 'CommandStart') {
        notify((h) => h.onCommandStart?.(targetSession));
      } else if (event.type === 'ExecutionStart') {
        notify((h) => h.onExecutionStart?.(targetSession));
      } else if (event.type === 'ExecutionEnd') {
        const payload = event.payload as { exit_code: number | null } | undefined;
        // `?? 0` here was a lie with a colour: an exit status the daemon could
        // not determine arrived in the UI as a green PASS. Null is unknown and
        // stays null all the way to the plate, which renders it as `--`.
        const code = payload?.exit_code ?? null;
        notify((h) => h.onExecutionEnd?.(code, targetSession));
      } else if (event.type === 'TuiMode') {
        const payload = event.payload as { active: boolean };
        notify((h) => h.onTuiMode?.(payload.active, targetSession));
      } else if (event.type === 'AgentState') {
        const payload = event.payload as { state: string };
        notify((h) => h.onAgentState?.(payload.state, targetSession));
      }
    } else if (msg.event === 'AgentEvent') {
      const e = msg.data as {
        agent: string;
        event: string;
        cwd?: string | null;
        // snake_case on the wire; the daemon's serde names it.
        doom_session_id?: string | null;
      };
      this.globalHandlers.forEach((h) =>
        h.onAgentEvent?.({
          agent: e.agent,
          event: e.event,
          cwd: e.cwd,
          // Dropping this field is what forced routing through cwd. It was
          // already on the wire and the type simply did not carry it.
          doomSessionId: e.doom_session_id ?? null,
        })
      );
    } else if (msg.event === 'SessionMode') {
      const mode = msg.data as {
        session_id: string;
        durable: boolean;
        detail: string | null;
      };
      this.sessionModes.set(mode.session_id, {
        durable: mode.durable,
        detail: mode.detail ?? null,
      });
      this.sessionModeHandlers.forEach((cb) =>
        cb(mode.session_id, mode.durable, mode.detail ?? null)
      );
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
    } else if (msg.event === 'SessionListing') {
      const listing = msg.data as SessionListing;
      const pending = listing.request_id
        ? this.sessionListingResolvers.get(listing.request_id)
        : undefined;
      if (pending && listing.request_id) {
        window.clearTimeout(pending.timer);
        this.sessionListingResolvers.delete(listing.request_id);
        pending.resolve(listing);
      }
    } else if (msg.event === 'SessionClosed') {
      const target = (msg.data as { session_id?: string })?.session_id;
      if (!target) return;
      // The daemon has dropped this id, so our record of having spawned it is
      // stale too. Leaving it in place meant a later select bound to a session
      // that no longer existed and silently wrote into nothing.
      this.spawnedSessions.delete(target);
      this.deliveries.get(target)?.();
      this.deliveries.delete(target);
      this.holds.delete(target);
      this.sessionModes.delete(target);
      this.sessionHandlers.get(target)?.forEach((h) => h.onSessionClosed?.(target));
      // Global handlers hear about every session, which is how the workspace
      // learns that a background pane died.
      this.globalHandlers.forEach((h) => h.onSessionClosed?.(target));
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

  /** Correlated enumeration used by recovery; it never spawns or replays. */
  public listSessions(): Promise<SessionListing> {
    return new Promise<SessionListing>((resolve, reject) => {
      const requestId = `sessions-${this.nextRequestId++}`;
      const timer = window.setTimeout(() => {
        this.sessionListingResolvers.delete(requestId);
        reject(new Error('listSessions timed out'));
      }, 5000);
      this.sessionListingResolvers.set(requestId, { resolve, reject, timer });
      this.send({ action: 'ListSessions', payload: { request_id: requestId } });
    });
  }

  public authenticate(token: string) {
    this.send({
      action: 'Auth',
      payload: { token },
    });
  }

  public spawnSession(id: string, cols: number, rows: number, cwd?: string, shell?: string) {
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
    const hold = this.holds.get(sessionId);
    if (hold?.isHolding) {
      const result = hold.offer(data);
      if (result === 'held') return;
      if (result === 'full') {
        // Loud rather than silent: a dropped keystroke is indistinguishable
        // from a terminal that has stopped responding.
        console.warn(`[pty] input held for ${sessionId} is full; keystroke refused`);
        return;
      }
    }
    this.sendWrite(sessionId, data);
  }

  /**
   * Write to a session without passing through the hold buffer.
   *
   * The delivery machinery writes the command line itself, so it must not be
   * held by the very buffer it opened.
   */
  private sendWrite(sessionId: string, data: string) {
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
    if (command.includes('\n')) {
      // A multi-line command goes as a bracketed paste, which the shell takes as
      // one unit — there is no partially-typed line to verify.
      this.sendWrite(sessionId, `\x1b[200~${command}\x1b[201~\n`);
      return;
    }

    // A delivery still in flight is superseded: two of them interleaving would
    // splice their lines together in the shell's editor.
    this.deliveries.get(sessionId)?.();

    // const, not let: TypeScript does not narrow a captured `let` inside the
    // closure below, so a conditionally-assigned one reads as possibly undefined.
    const hold = this.holds.get(sessionId) ?? new HoldBuffer();
    this.holds.set(sessionId, hold);
    hold.hold();

    const cancel = deliverCommand(
      {
        write: (data) => this.sendWrite(sessionId, data),
        onData: (cb) =>
          this.registerSessionHandler(sessionId, { onOutput: (chunk) => cb(chunk) }),
      },
      command,
      (outcome) => {
        this.deliveries.delete(sessionId);
        // Keys typed during the window are the user's next input, not part of
        // this command. They go out only once the line has left the pane, and
        // are dropped outright if it never did.
        if (outcome === 'cancelled') {
          hold.discard();
          return;
        }
        for (const data of hold.flush()) this.sendWrite(sessionId, data);
      }
    );
    this.deliveries.set(sessionId, cancel);
  }

  public submitCommand(command: string) {
    this.submitCommandToSession(this.activeSessionId, command);
  }

  public resizeSession(sessionId: string, cols: number, rows: number) {
    // Remembered, not just sent. `send` drops anything that arrives before the
    // socket is open, and a pane measures itself once on mount — so under Tauri,
    // where the daemon starts alongside the webview rather than before it, the
    // only Resize a session ever gets was thrown away and the shell stayed at
    // the 120x30 bootstrap for the rest of its life. Observed on macOS; the same
    // race exists anywhere the daemon is not already running.
    this.sessionSizes.set(sessionId, { cols, rows });
    this.send({
      action: 'Resize',
      payload: { id: sessionId, cols, rows },
    });
  }

  /** Re-send every size we know about. Called once the socket is open. */
  private flushSizes() {
    for (const [id, size] of this.sessionSizes) {
      this.send({ action: 'Resize', payload: { id, cols: size.cols, rows: size.rows } });
    }
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
    // Cancel before the kill: a delivery left in flight would keep its retry
    // timer alive and write into a session that no longer exists.
    this.deliveries.get(sessionId)?.();
    this.deliveries.delete(sessionId);
    this.holds.delete(sessionId);
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
      // Empty means the UI has not bound a session yet, which is not the same
      // as asking about one called "". Send null so the daemon answers about
      // the directory alone rather than looking up an id that cannot exist.
      payload: { cwd: cwd ?? null, session_id: this.activeSessionId || null },
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
