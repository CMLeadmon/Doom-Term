use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::Arc;
use tauri::State;

use crate::pty::session::SessionInfo;
use crate::pty::SessionManager;
use crate::wad::{DmxSoundData, WadHeader, WadLumpInfo, WadReader};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemTelemetry {
    pub username: String,
    pub hostname: String,
    pub current_dir: String,
    pub git_branch: Option<String>,
    pub sandbox_level: u32, // 100 = OS sandbox, 50 = worktree, 0 = host
    pub credentials: Option<[bool; 3]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WadParsedSummary {
    pub header: WadHeader,
    pub lumps: Vec<WadLumpInfo>,
    pub has_playpal: bool,
    pub has_stbar: bool,
    pub available_sounds: Vec<String>,
}

#[tauri::command]
pub async fn spawn_session(
    id: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    shell: Option<String>,
    manager: State<'_, Arc<SessionManager>>,
) -> Result<String, String> {
    manager
        .spawn(id, cols, rows, cwd, shell)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_session(
    id: String,
    data: String,
    manager: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    manager
        .write(&id, data.as_bytes())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn resize_session(
    id: String,
    cols: u16,
    rows: u16,
    manager: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    manager.resize(&id, cols, rows).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_signal(
    id: String,
    signal: String,
    manager: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    manager
        .send_signal(&id, &signal)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kill_session(
    id: String,
    manager: State<'_, Arc<SessionManager>>,
) -> Result<(), String> {
    manager.kill(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_sessions(
    manager: State<'_, Arc<SessionManager>>,
) -> Result<Vec<SessionInfo>, String> {
    Ok(manager.list_sessions())
}

#[tauri::command]
pub async fn get_system_telemetry() -> Result<SystemTelemetry, String> {
    let current_dir = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let username = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "marine".to_string());

    let hostname = std::env::var("HOSTNAME")
        .unwrap_or_else(|_| "phobos-base".to_string());

    // Query git branch if available
    let git_branch = Command::new("git")
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

    // Check real credential indicators
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

    let has_signing = Command::new("git")
        .args(["config", "--get", "user.signingkey"])
        .output()
        .map(|o| o.status.success() && !o.stdout.is_empty())
        .unwrap_or(false);

    Ok(SystemTelemetry {
        username,
        hostname,
        current_dir,
        git_branch,
        sandbox_level: 100, // Default sandbox tier
        credentials: Some([has_ssh, has_cloud, has_signing]),
    })
}

#[tauri::command]
pub async fn parse_wad_file(path: String) -> Result<WadParsedSummary, String> {
    let reader = WadReader::from_file(&path).map_err(|e| e.to_string())?;

    let has_playpal = reader.find_lump("PLAYPAL").is_some();
    let has_stbar = reader.find_lump("STBAR").is_some();

    let available_sounds: Vec<String> = reader
        .directory
        .iter()
        .filter(|l| l.name.starts_with("DS"))
        .map(|l| l.name.clone())
        .collect();

    Ok(WadParsedSummary {
        header: reader.header,
        lumps: reader.directory,
        has_playpal,
        has_stbar,
        available_sounds,
    })
}

#[tauri::command]
pub async fn extract_playpal_rgba(path: String) -> Result<Vec<u8>, String> {
    let reader = WadReader::from_file(&path).map_err(|e| e.to_string())?;
    reader.extract_playpal_rgba().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn extract_sound_lump(path: String, sound_name: String) -> Result<DmxSoundData, String> {
    let reader = WadReader::from_file(&path).map_err(|e| e.to_string())?;
    reader.extract_dmx_sound(&sound_name).map_err(|e| e.to_string())
}
