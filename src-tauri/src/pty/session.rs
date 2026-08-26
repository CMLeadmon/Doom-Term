use anyhow::{Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter};

use super::demuxer::{DemuxEvent, StreamDemuxer};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
    pub working_dir: String,
    pub shell: String,
    pub is_alive: bool,
}

pub struct PtySession {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
    master: Box<dyn MasterPty + Send>,
    writer: Arc<parking_lot::Mutex<Box<dyn Write + Send>>>,
    running: Arc<AtomicBool>,
    child_pid: Option<u32>,
}

impl PtySession {
    pub fn spawn(
        id: String,
        cols: u16,
        rows: u16,
        cwd: Option<String>,
        shell_cmd: Option<String>,
        app_handle: AppHandle,
    ) -> Result<Self> {
        let pty_system = native_pty_system();
        let pty_size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system
            .openpty(pty_size)
            .context("Failed to open PTY pair")?;

        let shell = shell_cmd.unwrap_or_else(|| {
            std::env::var("SHELL").unwrap_or_else(|_| {
                if cfg!(windows) {
                    "powershell.exe".to_string()
                } else {
                    "/bin/bash".to_string()
                }
            })
        });

        let mut cmd = CommandBuilder::new(&shell);
        if let Some(ref dir) = cwd {
            cmd.cwd(dir);
        } else if let Ok(current_dir) = std::env::current_dir() {
            cmd.cwd(current_dir);
        }

        // Set TERM environment variable
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("DOOM_TERM", "1");

        let child = pair
            .slave
            .spawn_command(cmd)
            .context("Failed to spawn command in PTY")?;

        let child_pid = child.process_id();
        let mut reader = pair
            .master
            .try_clone_reader()
            .context("Failed to clone PTY reader")?;
        let writer = Arc::new(parking_lot::Mutex::new(
            pair.master
                .take_writer()
                .context("Failed to take PTY writer")?,
        ));

        let running = Arc::new(AtomicBool::new(true));
        let running_clone = running.clone();
        let session_id = id.clone();

        // Spawn background reader thread
        thread::spawn(move || {
            let mut demuxer = StreamDemuxer::new();
            let mut buffer = [0u8; 8192];

            while running_clone.load(Ordering::Relaxed) {
                match reader.read(&mut buffer) {
                    Ok(0) => {
                        // EOF reached, process exited
                        break;
                    }
                    Ok(n) => {
                        let events = demuxer.process_bytes(&buffer[..n]);
                        for event in events {
                            let event_name = format!("pty-event-{}", session_id);
                            let _ = app_handle.emit(&event_name, &event);
                            let _ = app_handle.emit("pty-event-all", (&session_id, &event));
                        }
                    }
                    Err(e) => {
                        log::error!("PTY read error for session {}: {:?}", session_id, e);
                        break;
                    }
                }
            }

            running_clone.store(false, Ordering::Relaxed);
            let _ = app_handle.emit(
                &format!("pty-event-{}", session_id),
                DemuxEvent::ExecutionEnd { exit_code: Some(0) },
            );
            let _ = app_handle.emit("pty-session-closed", &session_id);
        });

        Ok(Self {
            id,
            cols,
            rows,
            master: pair.master,
            writer,
            running,
            child_pid,
        })
    }

    pub fn write(&self, data: &[u8]) -> Result<()> {
        let mut writer = self.writer.lock();
        writer.write_all(data).context("Failed to write to PTY")?;
        writer.flush().context("Failed to flush PTY writer")?;
        Ok(())
    }

    pub fn resize(&mut self, cols: u16, rows: u16) -> Result<()> {
        self.cols = cols;
        self.rows = rows;
        self.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("Failed to resize PTY")?;
        Ok(())
    }

    pub fn send_signal(&self, sig: &str) -> Result<()> {
        match sig {
            "SIGINT" | "INT" | "ctrl+c" => {
                // First write ETX (0x03) to master PTY to preserve cooked line discipline
                self.write(&[0x03])?;
                #[cfg(unix)]
                if let Some(pid) = self.child_pid {
                    use nix::sys::signal::{killpg, Signal};
                    use nix::unistd::Pid;
                    // Fallback to process group kill if needed
                    let _ = killpg(Pid::from_raw(pid as i32), Signal::SIGINT);
                }
            }
            "SIGTSTP" | "TSTP" | "ctrl+z" => {
                self.write(&[0x1a])?;
                #[cfg(unix)]
                if let Some(pid) = self.child_pid {
                    use nix::sys::signal::{killpg, Signal};
                    use nix::unistd::Pid;
                    let _ = killpg(Pid::from_raw(pid as i32), Signal::SIGTSTP);
                }
            }
            "EOF" | "ctrl+d" => {
                self.write(&[0x04])?;
            }
            "SIGKILL" | "KILL" => {
                #[cfg(unix)]
                if let Some(pid) = self.child_pid {
                    use nix::sys::signal::{killpg, Signal};
                    use nix::unistd::Pid;
                    let _ = killpg(Pid::from_raw(pid as i32), Signal::SIGKILL);
                }
            }
            _ => {
                log::warn!("Unsupported signal: {}", sig);
            }
        }
        Ok(())
    }

    pub fn is_alive(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    pub fn kill(&self) -> Result<()> {
        self.running.store(false, Ordering::Relaxed);
        let _ = self.send_signal("SIGKILL");
        Ok(())
    }
}
