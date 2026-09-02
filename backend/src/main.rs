use doom_term_pty as pty;

mod usage;

use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use parking_lot::RwLock;
use pty::demuxer::DemuxEvent;
use pty::session::PtySession;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_git_repo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoverableSession {
    pub id: String,
    pub cwd: String,
    pub command: String,
    pub durable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", content = "payload")]
pub enum ClientMessage {
    Auth {
        token: String,
    },
    Spawn {
        id: String,
        cols: u16,
        rows: u16,
        cwd: Option<String>,
        shell: Option<String>,
    },
    Reattach {
        id: String,
    },
    Write {
        id: String,
        data: String,
    },
    Resize {
        id: String,
        cols: u16,
        rows: u16,
    },
    Signal {
        id: String,
        signal: String,
    },
    Kill {
        id: String,
    },
    BrowseDirectory {
        /// Echoed back on the reply. Without it the client matched replies to
        /// requests by arrival order, which desynchronised permanently the
        /// first time a request was dropped.
        request_id: String,
        path: Option<String>,
    },
    ListSessions {
        request_id: String,
    },
    GetTelemetry {
        /// Directory to report on. The daemon's own process directory is not a
        /// useful answer: it never changes when a session runs `cd`.
        cwd: Option<String>,
        /// Which session to describe. Telemetry is per-session — the foreground
        /// process, and therefore the agent, differs per tab — so without this
        /// the daemon answered about whichever session happened to be first in
        /// the map, and the plate could describe a tab that is not on screen.
        #[serde(default)]
        session_id: Option<String>,
    },
    Ping,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", content = "data")]
pub enum ServerMessage {
    AuthResult {
        success: bool,
        message: String,
    },
    PtyEvent {
        session_id: String,
        event: DemuxEvent,
    },
    /// An agent CLI told us something through its own hook.
    ///
    /// This is how the terminal learns that an agent is blocked on a human —
    /// the single most valuable thing it can know about a session nobody is
    /// looking at. It arrives from the AGENT's process, which knows its own
    /// cwd and session id but nothing about our node ids, so the frontend
    /// correlates by cwd.
    AgentEvent {
        /// "claude" | "codex" — whichever hook script posted.
        agent: String,
        /// The vendor's event name, verbatim. "PermissionRequest" blocks;
        /// "Stop" clears. Anything else is forwarded and ignored downstream
        /// rather than dropped here, so a new event never needs a daemon change.
        event: String,
        cwd: Option<String>,
        agent_session_id: Option<String>,
    },
    Telemetry {
        /// Which session this describes, echoed from the request.
        ///
        /// A reply is asynchronous, so by the time it lands the user may have
        /// switched tabs. Without this the client can only assume the answer is
        /// about whatever is on screen now, and a foreground agent gets
        /// attributed to the wrong session — the same class of mislabel the
        /// per-session `agent` lookup below exists to prevent.
        session_id: Option<String>,
        username: String,
        hostname: String,
        current_dir: String,
        git_branch: Option<String>,
        isolation: String,
        agent_key: Option<String>,
        agent_name: Option<String>,
        credentials: Option<[bool; 3]>,
        /// Fraction 0..1 of the account's binding rate limit that is used, or
        /// None when unknown. None renders '--' on the plate; it must never be
        /// coerced to 0.0, which would claim a fresh quota we did not observe.
        rate_used: Option<f64>,
        /// Fraction 0..1 of the running agent's context window that is filled,
        /// or None when unknown. A different source entirely from `rate_used`:
        /// that is the account's rate limit over HTTPS, this is one session's
        /// window read from its transcript. They must never be conflated, and
        /// like `rate_used` this must never be coerced to 0.0.
        context_used: Option<f64>,
        /// The model the running agent is actually using, or None.
        ///
        /// Read from the transcript, never inferred. /proc yields only a
        /// binary name, which is why this field did not exist before and why
        /// inventing one was ruled out.
        agent_model: Option<String>,
    },
    DirectoryListing {
        request_id: String,
        current_path: String,
        parent_path: Option<String>,
        entries: Vec<DirectoryEntry>,
    },
    SessionClosed {
        session_id: String,
    },
    Error {
        message: String,
    },
    /// Whether this session survives the daemon, and why not when it does not.
    ///
    /// Reported rather than assumed: a durability guarantee that silently is
    /// not one is worse than no guarantee, because the user acts on it — they
    /// leave an agent running and close the lid.
    SessionMode {
        session_id: String,
        durable: bool,
        detail: Option<String>,
    },
    SessionListing {
        request_id: String,
        sessions: Vec<RecoverableSession>,
    },
    Pong,
}

type SessionsMap = Arc<RwLock<HashMap<String, Arc<PtySession>>>>;
/// Fan-out for agent hook events. One sender, one receiver per WS client.
type HookBus = tokio::sync::broadcast::Sender<ServerMessage>;
type UsageHandle = Arc<usage::service::UsageService>;

/// Where the daemon listens.
///
/// Loopback by default, deliberately: this process spawns shells on request,
/// and the Auth message is advisory — it reports a verdict but nothing gates
/// Spawn on having sent it, so a client can open a shell without ever
/// authenticating. Binding a routable interface would therefore hand a shell to
/// anyone who can reach the port. The desktop app runs this as a bundled
/// sidecar on the same machine, which is all it is meant to serve. Exposing it
/// beyond that has to be asked for explicitly via DOOM_HOST.
fn listen_addr(host: Option<String>, port: Option<String>) -> String {
    format!(
        "{}:{}",
        host.unwrap_or_else(|| "127.0.0.1".to_string()),
        port.unwrap_or_else(|| "1421".to_string())
    )
}

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init_from_env(env_logger::Env::default().default_filter_or("info"));
    let addr = listen_addr(
        std::env::var("DOOM_HOST").ok(),
        std::env::var("DOOM_PORT").ok(),
    );
    let listener = TcpListener::bind(&addr).await?;
    log::info!("⚡ Doom Term PTY WebSocket Server listening on ws://{}", addr);

    let sessions: SessionsMap = Arc::new(RwLock::new(HashMap::new()));
    let usage: UsageHandle = Arc::new(usage::service::UsageService::new());
    // 64 is generous: hook events are human-paced, and a slow client that
    // lags out is better than one that blocks the poster.
    let (hooks, _) = tokio::sync::broadcast::channel::<ServerMessage>(64);

    // Rate-limit usage refreshes on its own timer, never on the request path:
    // GetTelemetry is polled every 2 s and must not wait on an HTTPS round-trip.
    {
        let usage = usage.clone();
        let sessions = sessions.clone();
        tokio::spawn(async move {
            loop {
                // The poll gate has two halves. `due()` is the request rate —
                // at most one read per REFRESH_INTERVAL, counting failures. The
                // foreground check is the reason to ask at all: no Claude in the
                // foreground means nothing to report, and polling a quota
                // endpoint on a timer for an idle shell is rude.
                // ANY session, not the first one: the cache is shared across
                // tabs, so one Claude anywhere is reason enough to refresh it.
                let is_claude = {
                    let map = sessions.read();
                    map.values()
                        .filter_map(|s| s.foreground_command())
                        .filter_map(|comm| pty::classify_agent(&comm))
                        .any(|a| a.key == "claude")
                };

                if is_claude && usage.due() {
                    let usage = usage.clone();
                    // ureq is blocking; keep it off the async runtime's threads.
                    let _ = tokio::task::spawn_blocking(move || usage.refresh_blocking()).await;
                }

                tokio::time::sleep(usage::service::GATE_TICK).await;
            }
        });
    }

    loop {
        match listener.accept().await {
            Ok((stream, client_addr)) => {
                let sessions = sessions.clone();
                let usage = usage.clone();
                let hooks = hooks.clone();
                tokio::spawn(handle_connection(stream, client_addr, sessions, usage, hooks));
            }
            Err(e) => {
                log::warn!("Listener accept error (retrying): {:?}", e);
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            }
        }
    }
}

/// What a hook script POSTs. Everything is optional because the vendors do not
/// agree on field names and a missing field must never drop the event — knowing
/// that SOMETHING is blocked is most of the value.
#[derive(Debug, Deserialize)]
struct HookPost {
    agent: Option<String>,
    #[serde(alias = "hook_event_name", alias = "event_name", alias = "type")]
    event: Option<String>,
    cwd: Option<String>,
    #[serde(alias = "session_id")]
    agent_session_id: Option<String>,
    /// Where the agent is writing its own transcript.
    ///
    /// The only field in the payload that comes from inside the agent's own
    /// process, and therefore the only way to tell two agents in one directory
    /// apart — which is precisely the case both context readers give up on.
    /// See `usage/hint.rs`.
    #[serde(alias = "transcriptPath", alias = "transcript")]
    transcript_path: Option<String>,
}

/// Receive one agent hook event and fan it out to every connected client.
///
/// Deliberately unauthenticated and bound to loopback only: the poster is a
/// shell script the user installed, running as the user, on the same machine.
/// Adding a token would mean writing it somewhere the script can read, which is
/// the same trust boundary with more moving parts.
///
/// Always answers 204, even for a body it could not parse. The caller is a hook
/// in the agent's critical path — a non-2xx or a hang there is a paused agent,
/// and no telemetry is worth that.
async fn serve_hook(mut stream: TcpStream, hooks: &HookBus, path_agent: Option<String>) {
    let mut buf = Vec::with_capacity(4096);
    let mut chunk = [0u8; 2048];

    // Read until the body is complete or the peer stops. Bounded so a wedged
    // client cannot grow this without limit.
    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_millis(500);
    loop {
        if buf.len() > 64 * 1024 {
            break;
        }
        let read = tokio::time::timeout_at(deadline, stream.read(&mut chunk)).await;
        match read {
            Ok(Ok(0)) | Err(_) => break,
            Ok(Ok(n)) => {
                buf.extend_from_slice(&chunk[..n]);
                let text = String::from_utf8_lossy(&buf);
                if let Some(headers_end) = text.find("\r\n\r\n") {
                    let body_len = text[..headers_end]
                        .lines()
                        .find_map(|l| {
                            let (k, v) = l.split_once(':')?;
                            k.trim()
                                .eq_ignore_ascii_case("content-length")
                                .then(|| v.trim().parse::<usize>().ok())?
                        })
                        .unwrap_or(0);
                    if buf.len() >= headers_end + 4 + body_len {
                        break;
                    }
                }
            }
            Ok(Err(_)) => break,
        }
    }

    let text = String::from_utf8_lossy(&buf).into_owned();
    if let Some(body) = text.split("\r\n\r\n").nth(1) {
        if let Ok(post) = serde_json::from_str::<HookPost>(body.trim_end_matches(char::from(0))) {
            // Recorded before the event is fanned out, so a Stop that arrives
            // with a transcript path still teaches us where that agent writes.
            if let (Some(cwd), Some(path)) = (post.cwd.as_deref(), post.transcript_path.as_deref())
            {
                let agent = post.agent.as_deref().or(path_agent.as_deref()).unwrap_or("");
                usage::hint::remember(agent, cwd, path);
                log::info!("hook: transcript for {agent} in {cwd} -> {path}");
            }

            let msg = ServerMessage::AgentEvent {
                // The vendors do not put their own name in the payload, so it
                // comes from the URL the hook script posts to: /hook/claude.
                // Taken from the path rather than injected into the JSON,
                // because rewriting arbitrary JSON in POSIX shell is a bug farm.
                agent: post
                    .agent
                    .or(path_agent)
                    .unwrap_or_else(|| "unknown".into()),
                event: post.event.unwrap_or_else(|| "unknown".into()),
                cwd: post.cwd,
                agent_session_id: post.agent_session_id,
            };
            log::info!("hook: {:?}", msg);
            // Err means nobody is listening yet. That is normal at startup and
            // is not worth logging on every event.
            let _ = hooks.send(msg);
        }
    }

    let _ = stream
        .write_all(b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n")
        .await;
    let _ = stream.flush().await;
}

async fn handle_connection(
    mut stream: TcpStream,
    client_addr: SocketAddr,
    sessions: SessionsMap,
    usage: UsageHandle,
    hooks: HookBus,
) {
    let mut peek_buf = [0u8; 1024];
    let peek_len = match stream.peek(&mut peek_buf).await {
        Ok(n) => n,
        Err(_) => return,
    };

    let peek_str = String::from_utf8_lossy(&peek_buf[..peek_len]).to_lowercase();
    let is_ws = peek_str.contains("upgrade: websocket");

    if peek_str.starts_with("post /hook") {
        // "POST /hook/claude HTTP/1.1" -> Some("claude")
        let agent = peek_str
            .split_whitespace()
            .nth(1)
            .and_then(|p| p.strip_prefix("/hook/"))
            .map(|a| a.trim_end_matches('/').to_string())
            .filter(|a| !a.is_empty());
        serve_hook(stream, &hooks, agent).await;
        return;
    }

    if !is_ws {
        // Standard HTTP GET request: respond with friendly HTML redirect to port 1420
        let html_body = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0; url=http://localhost:1420">
  <title>Doom Term</title>
  <style>
    body { background: #121212; color: #f0f0f0; font-family: monospace; text-align: center; padding-top: 15vh; margin: 0; }
    h1 { color: #d49b00; font-size: 2.2rem; margin-bottom: 10px; }
    p { color: #888888; font-size: 1rem; line-height: 1.6; }
    .card { max-width: 500px; margin: 0 auto; background: #1a1a1a; padding: 30px; border: 2px solid #3c3c3c; border-radius: 8px; box-shadow: inset 2px 2px 0 rgba(255,255,255,0.1), inset -2px -2px 0 rgba(0,0,0,0.8); }
    .btn { display: inline-block; margin-top: 24px; padding: 12px 28px; background: #d49b00; color: #000; text-decoration: none; font-weight: bold; border-radius: 4px; font-size: 1.1rem; box-shadow: 0 4px 6px rgba(0,0,0,0.4); }
    .btn:hover { background: #ffd700; transform: scale(1.02); }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚡ DOOM TERM</h1>
    <p>PTY WebSocket Server is running on port <strong>1421</strong>.</p>
    <p>The interactive Web Terminal UI is hosted on port <strong>1420</strong>.</p>
    <a class="btn" href="http://localhost:1420">👉 CLICK TO OPEN DOOM TERM UI (Port 1420)</a>
  </div>
</body>
</html>"#;

        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            html_body.len(),
            html_body
        );

        let _ = stream.write_all(response.as_bytes()).await;
        let _ = stream.flush().await;
        return;
    }

    log::info!("Client WebSocket connected from {}", client_addr);
    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            log::error!("Error during WebSocket handshake: {:?}", e);
            return;
        }
    };

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<ServerMessage>();

    // Agent hook events arrive on a process-wide bus rather than this
    // connection's channel, because the poster is a separate HTTP request that
    // knows nothing about which clients exist. Forward them into the same
    // channel so there is one path out to the socket.
    {
        let tx = tx.clone();
        let mut sub = hooks.subscribe();
        tokio::spawn(async move {
            loop {
                match sub.recv().await {
                    Ok(msg) => {
                        if tx.send(msg).is_err() {
                            break;
                        }
                    }
                    // Lagged means this client fell behind; keep going rather
                    // than dropping it, since the next event is what matters.
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }
        });
    }

    // Forward outbound messages from channel to WebSocket
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if let Ok(json_str) = serde_json::to_string(&msg) {
                if ws_sender.send(Message::Text(json_str.into())).await.is_err() {
                    break;
                }
            }
        }
    });

    while let Some(msg_result) = ws_receiver.next().await {
        match msg_result {
            Ok(Message::Text(text)) => {
                if let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) {
                    handle_client_msg(client_msg, &sessions, &usage, &tx);
                }
            }
            Ok(Message::Close(_)) => {
                break;
            }
            Ok(Message::Ping(_)) => {
                let _ = tx.send(ServerMessage::Pong);
            }
            _ => {}
        }
    }

    log::info!("Client disconnected from {}", client_addr);
}

fn handle_client_msg(
    msg: ClientMessage,
    sessions: &SessionsMap,
    usage: &UsageHandle,
    tx: &tokio::sync::mpsc::UnboundedSender<ServerMessage>,
) {
    match msg {
        ClientMessage::Auth { token } => {
            let required = std::env::var("DOOM_AUTH_TOKEN").unwrap_or_default();
            let success = required.is_empty() || token == required;
            let _ = tx.send(ServerMessage::AuthResult {
                success,
                message: if success {
                    "Authenticated to Doom Term gateway".to_string()
                } else {
                    "Invalid authentication token".to_string()
                },
            });
        }
        ClientMessage::Spawn {
            id,
            cols,
            rows,
            cwd,
            shell,
        } => {
            // Spawning an id we already hold is a RECONNECT, not a new terminal.
            //
            // The client re-sends Spawn on every page load, because its own
            // record of what it spawned dies with the page. Treating that as a
            // fresh session was the single worst bug in the app: tmux is started
            // with `new-session -A`, which ATTACHES when the session exists, so
            // each reload added another client to the same pane. Three clients
            // in, tmux is blocking on a write to a pty nobody drains and the
            // terminal freezes — the shell still receives every keystroke and
            // echoes it, and not one byte reaches the screen.
            //
            // Rebinding is the whole fix: point the live session at this
            // connection, resize it to this client's grid, and replay what it
            // has. Everything below this branch is for ids we have never seen.
            let existing = sessions.read().get(&id).cloned();
            if let Some(session) = existing {
                let tx_clone = tx.clone();
                let session_id_clone = id.clone();
                session.rebind(move |event| {
                    let _ = tx_clone.send(ServerMessage::PtyEvent {
                        session_id: session_id_clone.clone(),
                        event,
                    });
                });
                let _ = session.resize(cols, rows);
                let _ = tx.send(ServerMessage::SessionMode {
                    session_id: id.clone(),
                    durable: session.is_durable(),
                    detail: session.durability_detail(),
                });
                for event in session.get_replay_events() {
                    let _ = tx.send(ServerMessage::PtyEvent {
                        session_id: id.clone(),
                        event,
                    });
                }
                return;
            }

            let tx_clone = tx.clone();
            let session_id_clone = id.clone();
            match PtySession::spawn(
                id.clone(),
                cols,
                rows,
                cwd,
                shell,
                move |event| {
                    let _ = tx_clone.send(ServerMessage::PtyEvent {
                        session_id: session_id_clone.clone(),
                        event,
                    });
                },
                {
                    let tx_clone = tx.clone();
                    let session_id_clone = id.clone();
                    move || {
                        let _ = tx_clone.send(ServerMessage::SessionClosed {
                            session_id: session_id_clone.clone(),
                        });
                    }
                },
            ) {
                Ok(session) => {
                    let _ = tx.send(ServerMessage::SessionMode {
                        session_id: id.clone(),
                        durable: session.is_durable(),
                        detail: session.durability_detail(),
                    });
                    sessions.write().insert(id, Arc::new(session));
                }
                Err(e) => {
                    let _ = tx.send(ServerMessage::Error {
                        message: format!("Failed to spawn PTY session: {}", e),
                    });
                }
            }
        }
        ClientMessage::Reattach { id } => {
            if let Some(session) = sessions.read().get(&id) {
                let replay = session.get_replay_events();
                for event in replay {
                    let _ = tx.send(ServerMessage::PtyEvent {
                        session_id: id.clone(),
                        event,
                    });
                }
            }
        }
        ClientMessage::Write { id, data } => {
            if let Some(session) = sessions.read().get(&id) {
                if let Err(e) = session.write(data.as_bytes()) {
                    let _ = tx.send(ServerMessage::Error {
                        message: format!("Write error: {}", e),
                    });
                }
            }
        }
        ClientMessage::Resize { id, cols, rows } => {
            if let Some(session) = sessions.read().get(&id) {
                let _ = session.resize(cols, rows);
            }
        }
        ClientMessage::Signal { id, signal } => {
            if let Some(session) = sessions.read().get(&id) {
                let _ = session.send_signal(&signal);
            }
        }
        ClientMessage::Kill { id } => {
            if let Some(session) = sessions.write().remove(&id) {
                let _ = session.kill();
            }
        }
        ClientMessage::BrowseDirectory { request_id, path } => {
            let target_str = path.unwrap_or_else(|| "~".to_string());
            let target_path = pty::session::expand_path(&target_str);
            let dir = if target_path.exists() && target_path.is_dir() {
                target_path
            } else if let Ok(home) = std::env::var("HOME") {
                std::path::PathBuf::from(home)
            } else {
                std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/"))
            };

            let current_path = dir.to_string_lossy().to_string();
            let parent_path = dir.parent().map(|p| p.to_string_lossy().to_string());

            let mut entries = Vec::new();
            if let Ok(read_dir) = std::fs::read_dir(&dir) {
                for entry in read_dir.flatten() {
                    let file_name = entry.file_name().to_string_lossy().to_string();
                    if file_name.starts_with('.') && file_name != ".git" {
                        continue;
                    }
                    let path_buf = entry.path();
                    let is_dir = path_buf.is_dir();
                    let is_git_repo = is_dir && path_buf.join(".git").exists();
                    entries.push(DirectoryEntry {
                        name: file_name,
                        path: path_buf.to_string_lossy().to_string(),
                        is_dir,
                        is_git_repo,
                    });
                }
            }

            entries.sort_by(|a, b| {
                match (a.is_dir, b.is_dir) {
                    (true, false) => std::cmp::Ordering::Less,
                    (false, true) => std::cmp::Ordering::Greater,
                    _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
                }
            });

            let _ = tx.send(ServerMessage::DirectoryListing {
                request_id,
                current_path,
                parent_path,
                entries,
            });
        }
        ClientMessage::ListSessions { request_id } => {
            // In-memory direct PTYs and tmux-backed PTYs are both live. Then
            // enumerate the private socket to find durable sessions left by an
            // earlier daemon. A map de-duplicates the two witnesses by id.
            let mut found: HashMap<String, RecoverableSession> = HashMap::new();
            {
                let map = sessions.read();
                for (id, session) in map.iter() {
                    found.insert(id.clone(), RecoverableSession {
                        id: id.clone(),
                        cwd: session.current_cwd().unwrap_or_default(),
                        command: session.foreground_command().unwrap_or_default(),
                        durable: session.is_durable(),
                    });
                }
            }

            let sidecar_dir = std::env::current_exe()
                .ok()
                .and_then(|path| path.parent().map(|parent| parent.to_path_buf()));
            if let Some(exe) = pty::tmux::resolve_tmux(sidecar_dir.as_deref()) {
                for session in pty::tmux::list_sessions(&exe) {
                    found.entry(session.id.clone()).or_insert(RecoverableSession {
                        id: session.id,
                        cwd: session.cwd,
                        command: session.command,
                        durable: true,
                    });
                }
            }

            let mut listed: Vec<_> = found.into_values().collect();
            listed.sort_by(|a, b| a.id.cmp(&b.id));
            let _ = tx.send(ServerMessage::SessionListing {
                request_id,
                sessions: listed,
            });
        }
        ClientMessage::GetTelemetry { cwd, session_id } => {
            // The kernel first, the client's copy second.
            //
            // The client learns the directory from OSC 7, which the integration
            // script emits once per prompt — so `cd repo && claude` never
            // reports the move and the app describes the wrong directory for as
            // long as the agent runs. CONTEXT % is looked up BY directory, so
            // that showed up as a permanent '--' next to a running agent.
            let observed = session_id
                .as_ref()
                .and_then(|id| sessions.read().get(id).cloned())
                .and_then(|s| s.current_cwd());

            let current_dir = observed
                .or_else(|| {
                    cwd.map(|c| pty::session::expand_path(&c).to_string_lossy().to_string())
                        .filter(|c| !c.trim().is_empty())
                })
                .unwrap_or_else(|| {
                    std::env::current_dir()
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_default()
                });
            // No game vocabulary in anything the UI can render: an unknown user
            // is unknown, not a "marine" on "phobos-base".
            let username = std::env::var("USER")
                .or_else(|_| std::env::var("USERNAME"))
                .unwrap_or_else(|_| "unknown".to_string());
            let hostname = std::env::var("HOSTNAME").unwrap_or_else(|_| "localhost".to_string());

            let git_branch = std::process::Command::new("git")
                .args(["-C", &current_dir, "rev-parse", "--abbrev-ref", "HEAD"])
                .output()
                .ok()
                .and_then(|output| {
                    if output.status.success() {
                        let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
                        if !s.is_empty() {
                            Some(s)
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                });

            let home_dir = std::env::var("HOME").unwrap_or_default();
            let has_ssh = !home_dir.is_empty() && (
                std::path::Path::new(&format!("{}/.ssh/id_rsa", home_dir)).exists()
                || std::path::Path::new(&format!("{}/.ssh/id_ed25519", home_dir)).exists()
                || std::path::Path::new(&format!("{}/.ssh/config", home_dir)).exists()
                || std::env::var("SSH_AUTH_SOCK").is_ok()
            );

            let has_cloud = std::env::var("AWS_ACCESS_KEY_ID").is_ok()
                || std::env::var("GOOGLE_APPLICATION_CREDENTIALS").is_ok()
                || (!home_dir.is_empty() && (
                    std::path::Path::new(&format!("{}/.aws/credentials", home_dir)).exists()
                    || std::path::Path::new(&format!("{}/.config/gcloud", home_dir)).exists()
                ));

            let has_signing = std::process::Command::new("git")
                .args(["-C", &current_dir, "config", "--get", "user.signingkey"])
                .output()
                .map(|o| o.status.success() && !o.stdout.is_empty())
                .unwrap_or(false);

            // Who is actually running in THIS session, per the kernel — not per
            // the tab title, and not per whichever session sorted first. An id
            // the daemon does not know describes nothing, so the agent is
            // unknown rather than borrowed from another tab.
            let agent = session_id
                .as_ref()
                .and_then(|id| sessions.read().get(id).cloned())
                .and_then(|s| s.foreground_command())
                .and_then(|comm| pty::classify_agent(&comm));

            // Only for an agent whose transcripts we can read, and only ever
            // against its OWN vendor's files — reporting Codex's pane against
            // Claude's transcripts would be a straightforward mislabel.
            //
            // Codex additionally carries its rate limit in the same record, so
            // it needs no OAuth call at all; `codex_rate` is that number.
            // Antigravity writes neither, so it is absent here on purpose and
            // the plate draws '--'. See usage/codex.rs for the evidence.
            let (context, codex_rate) = match agent.as_ref().map(|a| a.key) {
                Some("claude") => (usage::context::context_fraction(&current_dir), None),
                Some("codex") => match usage::codex::reading(&current_dir) {
                    Some((reading, rate)) => (Some(reading), rate),
                    None => (None, None),
                },
                _ => (None, None),
            };

            let _ = tx.send(ServerMessage::Telemetry {
                session_id,
                username,
                hostname,
                current_dir,
                git_branch,
                isolation: pty::detect_isolation().to_string(),
                agent_key: agent.as_ref().map(|a| a.key.to_string()),
                agent_name: agent.as_ref().map(|a| a.name.to_string()),
                credentials: Some([has_ssh, has_cloud, has_signing]),
                // Read-only: whatever the refresh loop last managed to learn.
                // Reported only for the agent it belongs to — showing Claude's
                // quota while Codex is in the foreground would be a mislabel.
                rate_used: match agent.as_ref().map(|a| a.key) {
                    Some("claude") => usage.cached(),
                    Some("codex") => codex_rate,
                    _ => None,
                },
                context_used: context.as_ref().map(|c| c.fraction),
                // Empty means the source did not name a model — Codex's token
                // event does not. Absent, not guessed: this field has only ever
                // held what was read.
                agent_model: context.map(|c| c.model).filter(|m| !m.is_empty()),
            });
        }
        ClientMessage::Ping => {
            let _ = tx.send(ServerMessage::Pong);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::listen_addr;

    #[test]
    fn defaults_to_loopback_so_the_bundled_daemon_is_not_a_network_shell() {
        assert_eq!(listen_addr(None, None), "127.0.0.1:1421");
    }

    #[test]
    fn reaching_it_from_the_network_has_to_be_asked_for_explicitly() {
        assert_eq!(
            listen_addr(Some("0.0.0.0".to_string()), Some("9000".to_string())),
            "0.0.0.0:9000"
        );
    }
}
