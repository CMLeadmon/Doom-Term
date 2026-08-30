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
use tokio::io::AsyncWriteExt;
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
    Telemetry {
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
    Pong,
}

type SessionsMap = Arc<RwLock<HashMap<String, Arc<PtySession>>>>;
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
                        .filter_map(|s| s.shell_pid())
                        .filter_map(pty::foreground_command)
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
                tokio::spawn(handle_connection(stream, client_addr, sessions, usage));
            }
            Err(e) => {
                log::warn!("Listener accept error (retrying): {:?}", e);
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            }
        }
    }
}

async fn handle_connection(
    mut stream: TcpStream,
    client_addr: SocketAddr,
    sessions: SessionsMap,
    usage: UsageHandle,
) {
    let mut peek_buf = [0u8; 1024];
    let peek_len = match stream.peek(&mut peek_buf).await {
        Ok(n) => n,
        Err(_) => return,
    };

    let peek_str = String::from_utf8_lossy(&peek_buf[..peek_len]).to_lowercase();
    let is_ws = peek_str.contains("upgrade: websocket");

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
        ClientMessage::GetTelemetry { cwd, session_id } => {
            let current_dir = cwd
                .map(|c| pty::session::expand_path(&c).to_string_lossy().to_string())
                .filter(|c| !c.trim().is_empty())
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
                .and_then(|id| sessions.read().get(&id).cloned())
                .and_then(|s| s.shell_pid())
                .and_then(pty::foreground_command)
                .and_then(|comm| pty::classify_agent(&comm));

            let _ = tx.send(ServerMessage::Telemetry {
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
                    _ => None,
                },
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
