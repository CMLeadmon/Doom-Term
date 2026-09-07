//! The daemon grants terminal access to local clients, not arbitrary websites.
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::{
    handshake::server::{ErrorResponse, Request, Response},
    http::{header, uri::Authority, StatusCode},
};

pub fn loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
}

pub fn trusted_host(value: &str, port: u16) -> bool {
    value.parse::<Authority>().is_ok_and(|authority| {
        loopback_host(authority.host()) && authority.port_u16() == Some(port)
    })
}

fn trusted_origin(origin: &str) -> bool {
    matches!(
        origin,
        "http://localhost:1420"
            | "http://127.0.0.1:1420"
            | "http://[::1]:1420"
            | "tauri://localhost"
            | "http://tauri.localhost"
            | "https://tauri.localhost"
    )
}

pub fn validate_upgrade(
    request: &Request,
    response: Response,
    port: u16,
) -> Result<Response, ErrorResponse> {
    let hosts = request.headers().get_all(header::HOST);
    let origins = request.headers().get_all(header::ORIGIN);
    let host_ok = hosts.iter().count() == 1
        && hosts
            .iter()
            .next()
            .and_then(|h| h.to_str().ok())
            .is_some_and(|h| trusted_host(h, port));
    // Native clients do not send Origin. Browsers always do, including the
    // literal "null" for opaque origins, which must not be treated as absent.
    let origin_ok =
        origins.iter().count() <= 1 && origins.iter().all(|o| o.to_str().is_ok_and(trusted_origin));
    if host_ok && origin_ok {
        return Ok(response);
    }
    Err(Response::builder()
        .status(StatusCode::FORBIDDEN)
        .body(Some("Untrusted Doom Term origin or host".into()))
        .unwrap())
}

/// Peek a complete, bounded header before selecting HTTP versus WebSocket.
/// TCP may split the request line from Upgrade; a single peek misroutes it.
pub async fn request_head(stream: &TcpStream) -> Option<String> {
    tokio::time::timeout(Duration::from_secs(2), async {
        let mut buffer = [0u8; 16 * 1024];
        loop {
            let count = stream.peek(&mut buffer).await.ok()?;
            if count == 0 {
                return None;
            }
            if let Some(end) = buffer[..count].windows(4).position(|w| w == b"\r\n\r\n") {
                return String::from_utf8(buffer[..end + 4].to_vec()).ok();
            }
            if count == buffer.len() {
                return None;
            }
            // Peek leaves bytes readable. Yield until more data can arrive.
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .ok()
    .flatten()
}
