mod pty;
mod wad;

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
    SpawnWorktree {
        branch: String,
        base_ref: Option<String>,
    },
    GetTelemetry {
        /// Directory to report on. The daemon's own process directory is not a
        /// useful answer: it never changes when a session runs `cd`.
        cwd: Option<String>,
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
        sandbox_level: u32,
        credentials: Option<[bool; 3]>,
    },
    WorktreeCreated {
        branch: String,
        path: String,
        success: bool,
    },
    SessionClosed {
        session_id: String,
    },
    Error {
        message: String,
    },
    Pong,
}

type SessionsMap = Arc<RwLock<HashMap<String, Arc<PtySession>>>>;

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::init_from_env(env_logger::Env::default().default_filter_or("info"));
    let port = std::env::var("DOOM_PORT").unwrap_or_else(|_| "1421".to_string());
    let addr = format!("0.0.0.0:{}", port);
    let listener = TcpListener::bind(&addr).await?;
    log::info!("⚡ Doom Term PTY WebSocket Server listening on ws://{}", addr);

    let sessions: SessionsMap = Arc::new(RwLock::new(HashMap::new()));

    loop {
        match listener.accept().await {
            Ok((stream, client_addr)) => {
                let sessions = sessions.clone();
                tokio::spawn(handle_connection(stream, client_addr, sessions));
            }
            Err(e) => {
                log::warn!("Listener accept error (retrying): {:?}", e);
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
            }
        }
    }
}

async fn handle_connection(mut stream: TcpStream, client_addr: SocketAddr, sessions: SessionsMap) {
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
                    handle_client_msg(client_msg, &sessions, &tx);
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
        ClientMessage::SpawnWorktree { branch, base_ref } => {
            let safe_branch: String = branch.chars().filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == '.').collect();
            let base = base_ref.unwrap_or_else(|| "HEAD".to_string());
            let path = format!(".worktrees/{}", safe_branch);
            let _ = std::fs::create_dir_all(".worktrees");
            
            let output = std::process::Command::new("git")
                .args(["worktree", "add", "-b", &safe_branch, &path, &base])
                .output();

            let success = match output {
                Ok(out) => out.status.success() || std::path::Path::new(&path).exists(),
                Err(_) => false,
            };

            let _ = tx.send(ServerMessage::WorktreeCreated {
                branch: safe_branch,
                path,
                success,
            });
        }
        ClientMessage::GetTelemetry { cwd } => {
            let current_dir = cwd
                .filter(|c| !c.trim().is_empty())
                .unwrap_or_else(|| {
                    std::env::current_dir()
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_default()
                });
            let username = std::env::var("USER")
                .or_else(|_| std::env::var("USERNAME"))
                .unwrap_or_else(|_| "marine".to_string());
            let hostname = std::env::var("HOSTNAME")
                .unwrap_or_else(|_| "phobos-base".to_string());

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

            let _ = tx.send(ServerMessage::Telemetry {
                username,
                hostname,
                current_dir,
                git_branch,
                sandbox_level: 100,
                credentials: Some([has_ssh, has_cloud, has_signing]),
            });
        }
        ClientMessage::Ping => {
            let _ = tx.send(ServerMessage::Pong);
        }
    }
}
