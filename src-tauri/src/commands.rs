use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::Arc;
use tauri::State;

use crate::session_manager::SessionManager;
use doom_term_pty::{expand_path, DemuxEvent, SessionInfo};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_git_repo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryListing {
    pub current_path: String,
    pub parent_path: Option<String>,
    pub entries: Vec<DirectoryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemTelemetry {
    pub username: String,
    pub hostname: String,
    pub current_dir: String,
    pub git_branch: Option<String>,
    pub sandbox_level: u32, // 100 = OS sandbox, 50 = worktree, 0 = host
    pub credentials: Option<[bool; 3]>,
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

/// Replays what a session emitted while the UI was disconnected. The daemon has
/// answered `Reattach` since the scrollback ring landed; the desktop app had no
/// equivalent, so `ptyClient.reattachSession()` silently did nothing here.
#[tauri::command]
pub async fn reattach_session(
    id: String,
    manager: State<'_, Arc<SessionManager>>,
) -> Result<Vec<DemuxEvent>, String> {
    manager.replay(&id).map_err(|e| e.to_string())
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
pub async fn browse_directory(path: Option<String>) -> Result<DirectoryListing, String> {
    let target_str = path.unwrap_or_else(|| "~".to_string());
    let target_path = expand_path(&target_str);
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

    Ok(DirectoryListing {
        current_path,
        parent_path,
        entries,
    })
}
