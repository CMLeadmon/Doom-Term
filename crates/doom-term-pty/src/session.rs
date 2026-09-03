use anyhow::{Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

use crate::demuxer::{DemuxEvent, StreamDemuxer};
use crate::shell_integration::{apply_shell_integration, shell_launch};
use crate::tmux::{self, TmuxHandle};

pub fn expand_path(path_str: &str) -> std::path::PathBuf {
    if path_str == "~" {
        if let Ok(home) = std::env::var("HOME") {
            return std::path::PathBuf::from(home);
        }
    } else if let Some(rest) = path_str.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return std::path::PathBuf::from(home).join(rest);
        }
    }
    std::path::PathBuf::from(path_str)
}

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

/// Where a session's events go, behind one lock so the reader thread, the
/// alternate-screen poll and a reconnecting client all address the same slot.
type EventSink = Arc<parking_lot::Mutex<Box<dyn FnMut(DemuxEvent) + Send>>>;

#[allow(dead_code)]
pub struct PtySession {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
    master: Arc<parking_lot::Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<parking_lot::Mutex<Box<dyn Write + Send>>>,
    running: Arc<AtomicBool>,
    child_pid: Option<u32>,
    /// The pid of the shell this session owns, when we spawned it directly.
    /// Under tmux the shell is not our child at all; see `shell_pid`.
    shell_pid_direct: Option<u32>,
    scrollback_ring: Arc<parking_lot::Mutex<VecDeque<DemuxEvent>>>,
    /// Where this session's events go. Swappable — see `rebind`.
    sink: EventSink,
    /// The tmux session backing this pane, when there is one. Its presence is
    /// what makes the shell outlive us.
    tmux: Option<TmuxHandle>,
    /// Why this session is not durable, when it is not. Reported to the UI:
    /// a persistence guarantee that silently is not one is worse than none.
    durability_detail: Option<String>,
}

/// The directory a session should start in, falling back the way the previous
/// inline version did: requested, then home, then wherever the daemon runs.
fn resolve_cwd(requested: Option<&str>) -> std::path::PathBuf {
    if let Some(dir) = requested {
        let expanded = expand_path(dir);
        if expanded.exists() {
            return expanded;
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        return std::path::PathBuf::from(home);
    }
    std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/"))
}

/// Build the tmux client command, or say why we cannot.
///
/// The error is a sentence for a human, not a code: it is shown in the UI, and
/// "tmux not found" is the difference between a user installing tmux and a user
/// assuming their sessions are durable when they are not.
type TmuxCommand = (CommandBuilder, Option<TmuxHandle>, Option<String>);

fn build_tmux_command(
    id: &str,
    cols: u16,
    rows: u16,
    shell: &str,
) -> std::result::Result<TmuxCommand, String> {
    if std::env::var("DOOM_TERM_NO_TMUX").is_ok() {
        return Err("disabled by DOOM_TERM_NO_TMUX".to_string());
    }
    let exe = tmux::resolve_tmux(sidecar_dir().as_deref())
        .ok_or_else(|| "tmux not found on PATH".to_string())?;

    let version = std::process::Command::new(&exe)
        .arg("-V")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    if !tmux::version_supported(&version) {
        return Err(format!(
            "tmux {} is too old; {}.{} or newer is required",
            version.trim().trim_start_matches("tmux ").trim(),
            tmux::MIN_MAJOR,
            tmux::MIN_MINOR
        ));
    }

    let conf = tmux::write_config().ok_or_else(|| "could not write the tmux config".to_string())?;
    let name = tmux::session_name(id);
    let mut launch = shell_launch(shell);

    // Name ourselves to everything that runs in this pane.
    //
    // An agent's hook fires in the AGENT's process, which knows its own cwd and
    // its own vendor session id but nothing about ours — so hook events were
    // correlated by directory, and two agents in one repository were
    // indistinguishable. This is the missing half of that identity: it is
    // inherited by the shell, by the agent, and by the hook script the agent
    // runs, so the hook can name the exact pane it belongs to.
    //
    // Through `-e` rather than the client's own environment: the pane's shell
    // is a child of the tmux SERVER, not of the client we spawn here.
    launch
        .env
        .push((SESSION_ID_ENV.to_string(), id.to_string()));

    let mut cmd = CommandBuilder::new(&exe);
    for arg in tmux::new_session_args(&conf, &name, cols, rows, &launch.env, shell, &launch.args) {
        cmd.arg(arg);
    }
    // The daemon may itself have been launched from inside someone's tmux, and
    // it hands its whole environment to this client. An inherited $TMUX makes
    // tmux treat the client as a nested session, and — worse — leaves the value
    // visible to the pane's shell, whose integration script decides whether to
    // wrap its escape sequences by testing exactly that variable. It would then
    // wrap for a server that is not ours. tmux sets both correctly for the pane
    // it creates; ours must not pre-empt it.
    cmd.env_remove("TMUX");
    cmd.env_remove("TMUX_PANE");
    // No -c here, deliberately: it would have to precede `--`, and everything
    // after `--` belongs to the shell. `new-session` without -c takes the
    // client's own working directory, and the caller sets that with cmd.cwd()
    // immediately below — so the directory arrives the same way it does on the
    // direct-spawn path. An already-existing session keeps the directory it was
    // created in regardless, which is right: the user's `cd` history lives there.

    Ok((cmd, Some(TmuxHandle { exe, name }), None))
}

/// How a pane names itself to the programs running inside it.
///
/// Read back by `tools/agent-hooks/doom-term-hook.sh`, which forwards it so an
/// agent's hook event can be attributed to the exact pane that started it
/// rather than to whichever session happens to share its directory.
pub const SESSION_ID_ENV: &str = "DOOM_TERM_SESSION_ID";

/// Where a bundled tmux would live: beside the daemon executable, which is how
/// Tauri lays sidecars out.
fn sidecar_dir() -> Option<std::path::PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
}

impl PtySession {
    pub fn spawn<F, C>(
        id: String,
        cols: u16,
        rows: u16,
        cwd: Option<String>,
        shell_cmd: Option<String>,
        event_callback: F,
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

        let working_dir = resolve_cwd(cwd.as_deref());

        // Prefer tmux. The shell then belongs to the tmux server rather than to
        // us, so restarting or crashing the daemon detaches instead of killing —
        // which is the entire reason this stage exists. Everything about the
        // fallback path below is what shipped before, so a machine without tmux
        // is no worse off than yesterday, only less durable.
        let (mut cmd, tmux_handle, durability_detail) =
            match build_tmux_command(&id, cols, rows, &shell) {
                Ok(built) => built,
                Err(reason) => {
                    log::info!("session {}: direct spawn ({})", id, reason);
                    let mut cmd = CommandBuilder::new(&shell);
                    apply_shell_integration(&mut cmd, &shell);
                    (cmd, None, Some(reason))
                }
            };

        // Ask before attaching: the client repaints the visible screen as soon
        // as it connects, and history is only distinguishable from it while the
        // client is not there yet.
        let replay_history = tmux_handle
            .as_ref()
            .filter(|handle| handle.has_session())
            .and_then(|handle| handle.capture_history(tmux::REPLAY_LINES));

        cmd.cwd(&working_dir);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("DOOM_TERM", "1");
        // On the direct path `cmd` IS the shell, so this reaches it and
        // everything it spawns. The tmux path cannot use this — see the `-e`
        // arguments in build_tmux_command — because there `cmd` is the client.
        cmd.env(SESSION_ID_ENV, &id);

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .context("Failed to spawn command in PTY")?;

        let child_pid = child.process_id();
        let shell_pid_direct = child.process_id();
        // Under tmux our child is the tmux CLIENT, so its status describes a
        // detach, not the user's shell. Only a directly spawned shell can be
        // reported on honestly; see the reader thread's close arm.
        let child_status_is_meaningful = tmux_handle.is_none();
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

        // The reader answers the terminal's own mail. A program that asks what
        // colour we are, or where the cursor sits, blocks on a timeout until it
        // hears back — so the reply has to go out on this thread, before the
        // events are forwarded to the UI.
        let responder = writer.clone();

        // Two threads emit events now — the reader and the alternate-screen
        // poll — so the callback is shared rather than moved into one of them.
        //
        // Boxed rather than generic so it can be REPLACED later: a page reload
        // opens a new WebSocket, and the session it is reconnecting to is still
        // emitting into the previous connection's closed channel. See `rebind`.
        let shared_callback: EventSink =
            Arc::new(parking_lot::Mutex::new(Box::new(event_callback)));

        if let Some(history) = replay_history {
            // Above the live screen rather than through it: capture-pane was
            // asked for history only (-E -1), so this precedes the attach's
            // first bytes and nothing here is repainted by it.
            (shared_callback.lock())(DemuxEvent::Output { data: history });
        }

        // The alternate-screen poll. Emits only on change: the frontend treats
        // TuiMode as a state report, and a repeated one would re-render the
        // pane twice a second for no reason.
        if let Some(handle) = tmux_handle.clone() {
            let running_poll = running.clone();
            let poll_callback = shared_callback.clone();
            thread::spawn(move || {
                let mut last: Option<bool> = None;
                while running_poll.load(Ordering::Relaxed) {
                    if let Some(active) = handle.alternate_on() {
                        if last != Some(active) {
                            last = Some(active);
                            (poll_callback.lock())(DemuxEvent::TuiMode { active });
                        }
                    }
                    thread::sleep(tmux::ALT_POLL);
                }
            });
        }

        let reader_callback = shared_callback.clone();
        thread::spawn(move || {
            let mut demuxer = StreamDemuxer::new();
            let mut buffer = [0u8; 8192];

            while running_clone.load(Ordering::Relaxed) {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => {
                        let events = demuxer.process_bytes(&buffer[..n]);

                        let replies = demuxer.take_responses();
                        if !replies.is_empty() {
                            let mut w = responder.lock();
                            if w.write_all(&replies).and_then(|_| w.flush()).is_err() {
                                log::warn!("Failed to answer terminal query");
                            }
                        }

                        for event in events {
                            {
                                let mut ring = ring_clone.lock();
                                if ring.len() >= 500 {
                                    ring.pop_front();
                                }
                                ring.push_back(event.clone());
                            }
                            (reader_callback.lock())(event);
                        }
                    }
                    Err(e) => {
                        log::error!("PTY read error: {:?}", e);
                        break;
                    }
                }
            }

            running_clone.store(false, Ordering::Relaxed);

            // Ask the kernel what happened rather than asserting it went well.
            //
            // This used to be an unconditional `Some(0)`. EOF on the pty says
            // the session ended, and nothing whatsoever about how: a shell that
            // died on a signal, a command that exited 1, and a clean logout all
            // arrived at the UI as a green PASS. `--` is the honest answer when
            // we cannot know, per the never-invent-telemetry rule.
            let exit_code = if child_status_is_meaningful {
                match child.wait() {
                    Ok(status) => Some(status.exit_code() as i32),
                    Err(e) => {
                        log::warn!("could not reap session child: {:?}", e);
                        None
                    }
                }
            } else {
                None
            };

            let end_event = DemuxEvent::ExecutionEnd { exit_code };
            {
                let mut ring = ring_clone.lock();
                ring.push_back(end_event.clone());
            }
            (reader_callback.lock())(end_event);
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
            shell_pid_direct,
            scrollback_ring,
            sink: shared_callback,
            tmux: tmux_handle,
            durability_detail,
        })
    }

    /// Point this session's output at a different consumer.
    ///
    /// A session outlives the WebSocket that created it: reloading the page
    /// opens a new connection, and without this the reader thread keeps sending
    /// every byte into the previous connection's dropped channel. The shell is
    /// alive, the keystrokes arrive, and NOTHING is drawn — which is exactly how
    /// it failed. Reattaching a second tmux client instead of rebinding is what
    /// made it worse: `new-session -A` attaches rather than creates, so each
    /// reload added another client to one session, and tmux stalls the whole
    /// server when it cannot write to a client nobody is reading.
    pub fn rebind<F>(&self, callback: F)
    where
        F: FnMut(DemuxEvent) + Send + 'static,
    {
        *self.sink.lock() = Box::new(callback);
    }

    /// The pid whose /proc entry names the foreground command.
    ///
    /// Under tmux this is the pane's shell, not the client we spawned: the
    /// client is what sits in the foreground of OUR pty, so asking about it
    /// reports tmux forever and the agent well never lights up. The name and
    /// signature are unchanged so callers do not have to know which case holds.
    pub fn shell_pid(&self) -> Option<u32> {
        match &self.tmux {
            Some(handle) => handle.pane_pid(),
            None => self.shell_pid_direct,
        }
    }

    /// What is actually running in this session's terminal, by name.
    ///
    /// The kernel first: `/proc/<pid>/stat` field 8 is the foreground process
    /// group of the controlling terminal, which is the precise answer and the
    /// one this app has always used. It is also Linux-only.
    ///
    /// tmux second, and only when the kernel route yields nothing. On macOS
    /// there is no /proc at all, so without this fallback the agent well,
    /// CONTEXT %, USAGE % and keyboard pass-through would all stay dark on a
    /// machine where every other part of the terminal works. Ordering it second
    /// rather than first is deliberate: Linux behaviour stays byte-identical to
    /// what shipped, and the new path only runs where the old one cannot.
    pub fn foreground_command(&self) -> Option<String> {
        if let Some(comm) = self.shell_pid().and_then(crate::foreground::foreground_command) {
            return Some(comm);
        }
        self.tmux.as_ref().and_then(|handle| handle.pane_current_command())
    }

    /// Where this session actually is, per the kernel.
    ///
    /// Under tmux the pane's own record is the fallback: it tracks `cd` even
    /// when /proc is unreadable, and it is what `list-panes` reports.
    pub fn current_cwd(&self) -> Option<String> {
        if let Some(dir) = self.shell_pid().and_then(crate::foreground::foreground_cwd) {
            return Some(dir);
        }
        self.tmux.as_ref().and_then(|handle| handle.pane_current_path())
    }

    pub fn is_durable(&self) -> bool {
        self.tmux.is_some()
    }

    pub fn durability_detail(&self) -> Option<String> {
        self.durability_detail.clone()
    }

    /// The pid to signal: the pane's shell under tmux, ours otherwise.
    fn signal_target(&self) -> Option<u32> {
        match &self.tmux {
            Some(handle) => handle.pane_pid(),
            None => self.child_pid,
        }
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
                if let Some(pid) = self.signal_target() {
                    use nix::sys::signal::{killpg, Signal};
                    use nix::unistd::Pid;
                    let _ = killpg(Pid::from_raw(pid as i32), Signal::SIGINT);
                }
            }
            "SIGTSTP" | "TSTP" | "ctrl+z" => {
                self.write(&[0x1a])?;
                #[cfg(unix)]
                if let Some(pid) = self.signal_target() {
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
                if let Some(pid) = self.signal_target() {
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

    /// Whether the reader thread is still attached to a live process.
    ///
    /// Consulted by the daemon before rebinding or listing a session: both of
    /// those used to treat a map entry as proof of life.
    pub fn is_alive(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    pub fn kill(&self) -> Result<()> {
        self.running.store(false, Ordering::Relaxed);
        // Under tmux, killing our own child only detaches the client and the
        // shell keeps running with nothing attached to it — a leak the user
        // cannot see or reach. Closing a tab has to close the session.
        if let Some(handle) = &self.tmux {
            handle.kill_session();
        }
        let _ = self.send_signal("SIGKILL");
        Ok(())
    }
}

