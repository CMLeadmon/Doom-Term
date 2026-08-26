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
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", content = "payload")]
pub enum ClientMessage {
    Spawn {
        id: String,
        cols: u16,
        rows: u16,
        cwd: Option<String>,
        shell: Option<String>,
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
    GetTelemetry,
    Ping,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", content = "data")]
pub enum ServerMessage {
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
    let addr = format!("127.0.0.1:{}", port);
    let listener = TcpListener::bind(&addr).await?;
    log::info!("⚡ Doom Term PTY WebSocket Server listening on ws://{}", addr);

    let sessions: SessionsMap = Arc::new(RwLock::new(HashMap::new()));

    while let Ok((stream, client_addr)) = listener.accept().await {
        let sessions = sessions.clone();
        tokio::spawn(handle_connection(stream, client_addr, sessions));
    }

    Ok(())
}

async fn handle_connection(stream: TcpStream, client_addr: SocketAddr, sessions: SessionsMap) {
    log::info!("Client connected from {}", client_addr);
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
        ClientMessage::GetTelemetry => {
            let current_dir = std::env::current_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let username = std::env::var("USER")
                .or_else(|_| std::env::var("USERNAME"))
                .unwrap_or_else(|_| "marine".to_string());
            let hostname = std::env::var("HOSTNAME")
                .unwrap_or_else(|_| "phobos-base".to_string());

            let git_branch = std::process::Command::new("git")
                .args(["rev-parse", "--abbrev-ref", "HEAD"])
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

            let _ = tx.send(ServerMessage::Telemetry {
                username,
                hostname,
                current_dir,
                git_branch,
                sandbox_level: 100,
            });
        }
        ClientMessage::Ping => {
            let _ = tx.send(ServerMessage::Pong);
        }
    }
}
