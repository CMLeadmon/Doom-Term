pub mod demuxer;
pub mod session;
pub mod shell_integration;

use anyhow::{anyhow, Result};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::AppHandle;

use self::session::{PtySession, SessionInfo};

pub struct SessionManager {
    sessions: Arc<RwLock<HashMap<String, PtySession>>>,
    app_handle: AppHandle,
}

impl SessionManager {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            app_handle,
        }
    }

    pub fn spawn(
        &self,
        id: String,
        cols: u16,
        rows: u16,
        cwd: Option<String>,
        shell: Option<String>,
    ) -> Result<String> {
        let session = PtySession::spawn(
            id.clone(),
            cols,
            rows,
            cwd,
            shell,
            self.app_handle.clone(),
        )?;

        let mut lock = self.sessions.write();
        lock.insert(id.clone(), session);
        Ok(id)
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<()> {
        let lock = self.sessions.read();
        let session = lock
            .get(id)
            .ok_or_else(|| anyhow!("Session '{}' not found", id))?;
        session.write(data)
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        let mut lock = self.sessions.write();
        let session = lock
            .get_mut(id)
            .ok_or_else(|| anyhow!("Session '{}' not found", id))?;
        session.resize(cols, rows)
    }

    pub fn send_signal(&self, id: &str, sig: &str) -> Result<()> {
        let lock = self.sessions.read();
        let session = lock
            .get(id)
            .ok_or_else(|| anyhow!("Session '{}' not found", id))?;
        session.send_signal(sig)
    }

    pub fn kill(&self, id: &str) -> Result<()> {
        let mut lock = self.sessions.write();
        if let Some(session) = lock.remove(id) {
            session.kill()?;
        }
        Ok(())
    }

    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        let lock = self.sessions.read();
        lock.values()
            .map(|s| SessionInfo {
                id: s.id.clone(),
                cols: s.cols,
                rows: s.rows,
                working_dir: std::env::current_dir()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default(),
                shell: std::env::var("SHELL").unwrap_or_else(|_| "sh".to_string()),
                is_alive: s.is_alive(),
            })
            .collect()
    }
}
