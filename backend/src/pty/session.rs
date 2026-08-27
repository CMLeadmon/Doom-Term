use anyhow::{Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

use super::demuxer::{DemuxEvent, StreamDemuxer};
use super::shell_integration::apply_shell_integration;

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
    pub working_dir: String,
    pub shell: String,
    pub is_alive: bool,
}

#[allow(dead_code)]
pub struct PtySession {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
    master: Arc<parking_lot::Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<parking_lot::Mutex<Box<dyn Write + Send>>>,
    running: Arc<AtomicBool>,
    child_pid: Option<u32>,
    scrollback_ring: Arc<parking_lot::Mutex<VecDeque<DemuxEvent>>>,
}

impl PtySession {
    pub fn spawn<F, C>(
        id: String,
        cols: u16,
        rows: u16,
        cwd: Option<String>,
        shell_cmd: Option<String>,
        mut event_callback: F,
        mut close_callback: C,
    ) -> Result<Self>
    where
        F: FnMut(DemuxEvent) + Send + 'static,
        C: FnMut() + Send + 'static,
    {
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

        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("DOOM_TERM", "1");
        apply_shell_integration(&mut cmd, &shell);

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
        let master = Arc::new(parking_lot::Mutex::new(pair.master));

        let running = Arc::new(AtomicBool::new(true));
        let running_clone = running.clone();

        let scrollback_ring = Arc::new(parking_lot::Mutex::new(VecDeque::with_capacity(500)));
        let ring_clone = scrollback_ring.clone();

        thread::spawn(move || {
            let mut demuxer = StreamDemuxer::new();
            let mut buffer = [0u8; 8192];

            while running_clone.load(Ordering::Relaxed) {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => {
                        let events = demuxer.process_bytes(&buffer[..n]);
                        for event in events {
                            {
                                let mut ring = ring_clone.lock();
                                if ring.len() >= 500 {
                                    ring.pop_front();
                                }
                                ring.push_back(event.clone());
                            }
                            event_callback(event);
                        }
                    }
                    Err(e) => {
                        log::error!("PTY read error: {:?}", e);
                        break;
                    }
                }
            }

            running_clone.store(false, Ordering::Relaxed);
            let end_event = DemuxEvent::ExecutionEnd { exit_code: Some(0) };
            {
                let mut ring = ring_clone.lock();
                ring.push_back(end_event.clone());
            }
            event_callback(end_event);
            close_callback();
        });

        Ok(Self {
            id,
            cols,
            rows,
            master,
            writer,
            running,
            child_pid,
            scrollback_ring,
        })
    }

    pub fn get_replay_events(&self) -> Vec<DemuxEvent> {
        let ring = self.scrollback_ring.lock();
        ring.iter().cloned().collect()
    }

    pub fn write(&self, data: &[u8]) -> Result<()> {
        let mut writer = self.writer.lock();
        writer.write_all(data).context("Failed to write to PTY")?;
        writer.flush().context("Failed to flush PTY writer")?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        let master = self.master.lock();
        master
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
                self.write(&[0x03])?;
                #[cfg(unix)]
                if let Some(pid) = self.child_pid {
                    use nix::sys::signal::{killpg, Signal};
                    use nix::unistd::Pid;
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

    #[allow(dead_code)]
    pub fn is_alive(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    pub fn kill(&self) -> Result<()> {
        self.running.store(false, Ordering::Relaxed);
        let _ = self.send_signal("SIGKILL");
        Ok(())
    }
}

