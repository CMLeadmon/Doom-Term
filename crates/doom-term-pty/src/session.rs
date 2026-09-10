use anyhow::{Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

use crate::demuxer::{DemuxEvent, StreamDemuxer};
use crate::shell_integration::{apply_shell_integration, shell_launch};
use crate::stream::{
    Identity, JournalHub, StreamError, StreamFault, StreamJournal, StreamMetadata, StreamPayload,
};
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
type CloseSink = Arc<parking_lot::Mutex<Box<dyn FnMut() + Send>>>;
type OwnedChild = Arc<parking_lot::Mutex<Option<Box<dyn portable_pty::Child + Send + Sync>>>>;

#[allow(dead_code)]
pub struct PtySession {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
    master: Arc<parking_lot::Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<parking_lot::Mutex<Box<dyn Write + Send>>>,
    /// Serializes direct-child mode observations with paste admission/delivery.
    paste_mode: Arc<parking_lot::Mutex<bool>>,
    running: Arc<AtomicBool>,
    retired: Arc<AtomicBool>,
    child: OwnedChild,
    threads: parking_lot::Mutex<Vec<thread::JoinHandle<()>>>,
    child_pid: Option<u32>,
    /// The pid of the shell this session owns, when we spawned it directly.
    /// Under tmux the shell is not our child at all; see `shell_pid`.
    shell_pid_direct: Option<u32>,
    journal: StreamJournal,
    /// Serializes adapter observations (not blocking reads or callbacks).
    observations: Arc<parking_lot::Mutex<()>>,
    /// Where this session's events go. Swappable — see `rebind`.
    sink: EventSink,
    close_sink: CloseSink,
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

    let version =
        crate::process_io::run(&exe, &["-V".into()], &[], std::time::Duration::from_secs(2))
            .ok()
            .map(|o| String::from_utf8_lossy(&o).to_string())
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

    Ok((cmd, Some(TmuxHandle::named(exe, name)), None))
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

fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(windows) {
            "powershell.exe".into()
        } else {
            "/bin/bash".into()
        }
    })
}

fn prepare_command(cmd: &mut CommandBuilder, id: &str) {
    cmd.env_remove("TMUX");
    cmd.env_remove("TMUX_PANE");
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("DOOM_TERM", "1");
    cmd.env(SESSION_ID_ENV, id);
}

fn available_tmux() -> std::result::Result<std::path::PathBuf, String> {
    let exe = tmux::resolve_tmux(sidecar_dir().as_deref())
        .ok_or_else(|| "tmux unavailable or disabled".to_string())?;
    let version =
        crate::process_io::run(&exe, &["-V".into()], &[], std::time::Duration::from_secs(2))
            .map_err(|_| "tmux version check failed".to_string())?;
    if !tmux::version_supported(&String::from_utf8_lossy(&version)) {
        return Err("tmux 3.7 or newer is required".into());
    }
    Ok(exe)
}

impl PtySession {
    /// V2 creation opens a journal-owned display stream, without callbacks.
    /// Durable creation conflicts are errors, never an attach or direct fallback.
    pub fn create(
        id: String,
        cols: u16,
        rows: u16,
        cwd: Option<String>,
        shell_cmd: Option<String>,
    ) -> Result<Self> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        anyhow::ensure!(cols > 0 && rows > 0, "Terminal dimensions must be positive");
        let shell = shell_cmd.unwrap_or_else(default_shell);
        let working_dir = resolve_cwd(cwd.as_deref());
        let built = match available_tmux() {
            Ok(exe) => {
                let mut launch = shell_launch(&shell);
                launch.env.push((SESSION_ID_ENV.into(), id.clone()));
                launch.env.push(("TERM".into(), "xterm-256color".into()));
                launch.env.push(("COLORTERM".into(), "truecolor".into()));
                launch.env.push(("DOOM_TERM".into(), "1".into()));
                let handle = TmuxHandle::create_owned(
                    exe,
                    &id,
                    cols,
                    rows,
                    &working_dir,
                    &launch.env,
                    &shell,
                    &launch.args,
                    deadline,
                )?;
                return Self::open_durable_adapter(id, cols, rows, handle, deadline);
            }
            Err(reason) => {
                let mut cmd = CommandBuilder::new(&shell);
                apply_shell_integration(&mut cmd, &shell);
                prepare_command(&mut cmd, &id);
                cmd.cwd(working_dir);
                (cmd, None, Some(reason))
            }
        };
        Self::start_adapter(
            id,
            cols,
            rows,
            built,
            Identity::random()?,
            None,
            |_| {},
            || {},
        )
    }

    /// No shell, cwd, create-or-attach, or fallback may enter this path.
    pub fn attach_durable(
        id: String,
        incarnation: &Identity,
        cols: u16,
        rows: u16,
    ) -> Result<Self> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let exe = available_tmux().map_err(anyhow::Error::msg)?;
        let handle = TmuxHandle::resolve_owned_before(exe, &id, incarnation, deadline)?;
        Self::open_durable_adapter(id, cols, rows, handle, deadline)
    }

    fn open_durable_adapter(
        id: String,
        cols: u16,
        rows: u16,
        handle: TmuxHandle,
        deadline: std::time::Instant,
    ) -> Result<Self> {
        // Reserve the final three seconds for owned-client/thread retirement.
        let display_deadline = deadline - std::time::Duration::from_secs(3);
        anyhow::ensure!(
            std::time::Instant::now() < display_deadline,
            "Durable bootstrap timed out before display creation"
        );
        let incarnation = handle
            .incarnation()
            .context("Unidentified durable pane")?
            .clone();
        let mut cmd = CommandBuilder::new(&handle.exe);
        cmd.args(handle.attach_args()?);
        prepare_command(&mut cmd, &id);
        let session = Self::start_adapter(
            id,
            cols,
            rows,
            (cmd, Some(handle.clone()), None),
            incarnation,
            None,
            |_| {},
            || {},
        )?;
        while session.is_alive() && std::time::Instant::now() < display_deadline {
            match session
                .child_pid
                .map(|pid| handle.has_display_client(pid, display_deadline))
            {
                Some(Ok(true)) => return Ok(session),
                Some(Ok(false)) => {}
                _ => break,
            }
            thread::sleep(std::time::Duration::from_millis(10));
        }
        session.retire_adapter()?;
        anyhow::bail!("Durable display attachment failed; the pane was not replaced or restarted")
    }

    pub fn capture_archive(&self) -> Result<tmux::CapturedArchive> {
        self.tmux
            .as_ref()
            .context("Direct PTY has no durable history archive")?
            .capture_archive()
    }

    pub fn paste(&self, text: &str) -> Result<()> {
        let clean = crate::paste::prepare_paste(text)?;
        anyhow::ensure!(self.is_alive(), "Session is closed; paste was not sent");
        anyhow::ensure!(
            !self.journal.snapshot().ended,
            "Rendering stream has ended; paste was not sent"
        );
        if clean.is_empty() {
            return Ok(());
        }
        if let Some(handle) = &self.tmux {
            return handle.paste(&clean);
        }
        let enabled = self.paste_mode.lock();
        anyhow::ensure!(
            *enabled || !clean.contains('\n'),
            "Multiline paste blocked: child has not enabled bracketed paste"
        );
        let mut writer = self.writer.lock();
        let result = (|| -> std::io::Result<()> {
            if *enabled {
                writer.write_all(b"\x1b[200~")?;
            }
            writer.write_all(clean.as_bytes())?;
            if *enabled {
                writer.write_all(b"\x1b[201~")?;
            }
            writer.flush()
        })();
        result.map_err(|_| anyhow::anyhow!("Paste delivery failed; delivery may be incomplete"))
    }

    pub fn spawn<F, C>(
        id: String,
        cols: u16,
        rows: u16,
        cwd: Option<String>,
        shell_cmd: Option<String>,
        event_callback: F,
        close_callback: C,
    ) -> Result<Self>
    where
        F: FnMut(DemuxEvent) + Send + 'static,
        C: FnMut() + Send + 'static,
    {
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

        Self::start_adapter(
            id,
            cols,
            rows,
            (cmd, tmux_handle, durability_detail),
            Identity::random()?,
            replay_history,
            event_callback,
            close_callback,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn start_adapter<F, C>(
        id: String,
        cols: u16,
        rows: u16,
        built: TmuxCommand,
        incarnation: Identity,
        replay_history: Option<String>,
        event_callback: F,
        close_callback: C,
    ) -> Result<Self>
    where
        F: FnMut(DemuxEvent) + Send + 'static,
        C: FnMut() + Send + 'static,
    {
        let (cmd, tmux_handle, durability_detail) = built;
        let pair = native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("Failed to open PTY pair")?;
        // Establish identity/retention before launching a process. Validation
        // failure must not leave an untracked child behind.
        let journal = JournalHub::shared().open(StreamMetadata::new(
            id.clone(),
            incarnation,
            cols,
            rows,
            tmux_handle.is_some(),
        )?)?;
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
        // Complete all fallible descriptor setup before starting the process.
        let child = pair
            .slave
            .spawn_command(cmd)
            .context("Failed to spawn command in PTY")?;
        let child_pid = child.process_id();
        let shell_pid_direct = child_pid;
        let child: OwnedChild = Arc::new(parking_lot::Mutex::new(Some(child)));
        let reader_child = child.clone();
        let master = Arc::new(parking_lot::Mutex::new(pair.master));
        let paste_mode = Arc::new(parking_lot::Mutex::new(false));
        let reader_paste_mode = paste_mode.clone();

        let running = Arc::new(AtomicBool::new(true));
        let running_clone = running.clone();
        let retired = Arc::new(AtomicBool::new(false));
        let reader_retired = retired.clone();
        let mut threads = Vec::new();

        let reader_journal = journal.clone();
        let observations = Arc::new(parking_lot::Mutex::new(()));
        let reader_observations = observations.clone();

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
        let close_sink: CloseSink = Arc::new(parking_lot::Mutex::new(Box::new(close_callback)));
        let reader_close = close_sink.clone();

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
            let poll_journal = journal.clone();
            let poll_observations = observations.clone();
            threads.push(thread::spawn(move || {
                let mut last: Option<bool> = None;
                while running_poll.load(Ordering::Relaxed) {
                    if let Some(active) = handle.alternate_on() {
                        if !running_poll.load(Ordering::Relaxed) {
                            break;
                        }
                        if last != Some(active) {
                            last = Some(active);
                            {
                                let _order = poll_observations.lock();
                                if poll_journal
                                    .append(StreamPayload::Event(DemuxEvent::TuiMode { active }))
                                    .is_err()
                                {
                                    break;
                                }
                            }
                            (poll_callback.lock())(DemuxEvent::TuiMode { active });
                        }
                    }
                    thread::sleep(tmux::ALT_POLL);
                }
            }));
        }

        let reader_callback = shared_callback.clone();
        threads.push(thread::spawn(move || {
            let mut demuxer = StreamDemuxer::new();
            let mut buffer = [0u8; 8192];

            while running_clone.load(Ordering::Relaxed) {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => {
                        let order = reader_observations.lock();
                        // A fault invalidates rendering, not the user's process.
                        // Continue draining the PTY without accumulating a tail.
                        if reader_journal.snapshot().ended {
                            continue;
                        }
                        let events = demuxer.process_bytes(&buffer[..n]);
                        // Apply the last mode in this read before callbacks can
                        // trigger input, and without holding locks over callbacks.
                        if let Some(enabled) = events.iter().rev().find_map(|event| match event {
                            DemuxEvent::BracketedPasteMode { enabled } => Some(*enabled),
                            _ => None,
                        }) {
                            *reader_paste_mode.lock() = enabled;
                        }

                        let mut accepted = Vec::new();
                        for event in events {
                            let payload = match &event {
                                DemuxEvent::StreamFault { reason } => {
                                    StreamPayload::Fault { reason: *reason }
                                }
                                _ => StreamPayload::Event(event.clone()),
                            };
                            match reader_journal.append(payload) {
                                Ok(_) => accepted.push(event),
                                Err(error) => {
                                    let reason = match error {
                                        StreamError::RecordTooLarge => {
                                            Some(StreamFault::RecordTooLarge)
                                        }
                                        StreamError::SequenceExhausted => {
                                            Some(StreamFault::SequenceExhausted)
                                        }
                                        _ => None,
                                    };
                                    if let Some(reason) = reason {
                                        accepted.push(DemuxEvent::StreamFault { reason });
                                    }
                                    break;
                                }
                            }
                        }
                        let replies = demuxer.take_responses();
                        drop(order);
                        if !replies.is_empty() {
                            let mut w = responder.lock();
                            if w.write_all(&replies).and_then(|_| w.flush()).is_err() {
                                log::warn!("Failed to answer terminal query");
                            }
                        }

                        for event in accepted {
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
            // Reap display clients too. Keeping the owned Child under this
            // lock prevents retirement from signalling a recycled process id.
            let status = loop {
                let mut slot = reader_child.lock();
                let Some(child) = slot.as_mut() else {
                    break None;
                };
                match child.try_wait() {
                    Ok(Some(status)) => {
                        slot.take();
                        break Some(status);
                    }
                    Err(error) => {
                        log::warn!("Could not reap PTY child: {error}");
                        break None;
                    }
                    Ok(None) => {}
                }
                drop(slot);
                thread::sleep(std::time::Duration::from_millis(5));
            };
            // Retiring our display stream says nothing about the shell exit.
            if reader_retired.load(Ordering::Relaxed) {
                return;
            }
            let exit_code = if child_status_is_meaningful {
                status.map(|s| s.exit_code() as i32)
            } else {
                None
            };

            let end_event = DemuxEvent::ExecutionEnd { exit_code };
            {
                let _order = reader_observations.lock();
                let _ = reader_journal.append(StreamPayload::Event(end_event.clone()));
                let _ = reader_journal.append(StreamPayload::Closed { exit_code });
            }
            (reader_callback.lock())(end_event);
            (reader_close.lock())();
        }));

        Ok(Self {
            id,
            cols,
            rows,
            master,
            writer,
            paste_mode,
            running,
            retired,
            child,
            threads: parking_lot::Mutex::new(threads),
            child_pid,
            shell_pid_direct,
            journal,
            observations,
            sink: shared_callback,
            close_sink,
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
    pub fn rebind<F, C>(&self, callback: F, close_callback: C)
    where
        F: FnMut(DemuxEvent) + Send + 'static,
        C: FnMut() + Send + 'static,
    {
        *self.close_sink.lock() = Box::new(close_callback);
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
        if let Some(comm) = self
            .shell_pid()
            .and_then(crate::foreground::foreground_command)
        {
            return Some(comm);
        }
        self.tmux
            .as_ref()
            .and_then(|handle| handle.pane_current_command())
    }

    /// Where this session actually is, per the kernel.
    ///
    /// Under tmux the pane's own record is the fallback: it tracks `cd` even
    /// when /proc is unreadable, and it is what `list-panes` reports.
    pub fn current_cwd(&self) -> Option<String> {
        if let Some(dir) = self.shell_pid().and_then(crate::foreground::foreground_cwd) {
            return Some(dir);
        }
        self.tmux
            .as_ref()
            .and_then(|handle| handle.pane_current_path())
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
        // Legacy callback transport only, removed by the v2 transport cutover.
        // Keep its previous 500-event delivery cap: copying the enlarged
        // journal to that unbounded socket queue would amplify its old bug.
        let snapshot = self.journal.snapshot();
        let mut cursor = snapshot
            .first_retained
            .map(|seq| seq.get() - 1)
            .unwrap_or(snapshot.high_water.get());
        cursor = cursor.max(snapshot.high_water.get().saturating_sub(500));
        let mut events = Vec::new();
        while cursor < snapshot.high_water.get() {
            let Ok(Some(record)) = self
                .journal
                .read_after(crate::stream::Sequence::new(cursor))
            else {
                break;
            };
            cursor = record.sequence.get();
            match record.payload {
                StreamPayload::Event(event) => events.push(event),
                StreamPayload::Fault { reason } => events.push(DemuxEvent::StreamFault { reason }),
                _ => {}
            }
        }
        events
    }

    pub fn stream(&self) -> StreamJournal {
        self.journal.clone()
    }

    pub fn write(&self, data: &[u8]) -> Result<()> {
        anyhow::ensure!(
            !self.journal.snapshot().ended,
            "Rendering stream has ended; input was not sent"
        );
        let mut writer = self.writer.lock();
        writer.write_all(data).context("Failed to write to PTY")?;
        writer.flush().context("Failed to flush PTY writer")?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        anyhow::ensure!(cols > 0 && rows > 0, "Terminal dimensions must be positive");
        let _order = self.observations.lock();
        anyhow::ensure!(!self.journal.snapshot().ended, "Rendering stream has ended");
        let master = self.master.lock();
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("Failed to resize PTY")?;
        self.journal.append(StreamPayload::Resize { cols, rows })?;
        Ok(())
    }

    pub fn send_signal(&self, sig: &str) -> Result<()> {
        match sig {
            "SIGINT" | "INT" | "ctrl+c" => {
                // The terminal line discipline owns ISIG and foreground-group
                // delivery. A raw-mode agent must receive the byte without an
                // extra killpg interrupting the application or its parent shell.
                self.write(&[0x03])?;
            }
            "SIGTSTP" | "TSTP" | "ctrl+z" => {
                self.write(&[0x1a])?;
            }
            "EOF" | "ctrl+d" => {
                self.write(&[0x04])?;
            }
            "SIGKILL" | "KILL" =>
            {
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
        // Under tmux, killing our own child only detaches the client and the
        // shell keeps running with nothing attached to it — a leak the user
        // cannot see or reach. Closing a tab has to close the session.
        if let Some(handle) = &self.tmux {
            anyhow::ensure!(
                handle.kill_session(),
                "Durable pane is missing or replaced; kill refused"
            );
            if handle.incarnation().is_some() {
                {
                    let _order = self.observations.lock();
                    let _ = self
                        .journal
                        .append(StreamPayload::Closed { exit_code: None });
                }
                return self.retire_adapter();
            }
            // Legacy callers may hold their session-map lock while killing;
            // preserve asynchronous closure until the v2 lifecycle cutover.
            // Waiting here could deadlock against their close callback.
            self.running.store(false, Ordering::Relaxed);
            return Ok(());
        }
        self.running.store(false, Ordering::Relaxed);
        let _ = self.send_signal("SIGKILL");
        Ok(())
    }

    /// Retire/reap only our display client and threads, never the pane/server.
    /// A direct child cannot be retired without killing the user's process.
    pub fn retire_adapter(&self) -> Result<()> {
        anyhow::ensure!(self.is_durable(), "Direct PTY adapter cannot be retired");
        self.retired.store(true, Ordering::Relaxed);
        self.running.store(false, Ordering::Relaxed);
        {
            let _order = self.observations.lock();
            let _ = self.journal.append(StreamPayload::Fault {
                reason: StreamFault::AdapterRetired,
            });
        }
        {
            let mut slot = self.child.lock();
            if let Some(child) = slot.as_mut() {
                if child.try_wait()?.is_some() {
                    slot.take();
                } else {
                    #[cfg(unix)]
                    if let Some(pid) = child.process_id() {
                        nix::sys::signal::kill(
                            nix::unistd::Pid::from_raw(pid as i32),
                            nix::sys::signal::Signal::SIGKILL,
                        )?;
                    }
                    #[cfg(not(unix))]
                    child.kill()?;
                }
            }
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        let mut threads = self.threads.lock();
        while threads.iter().any(|thread| !thread.is_finished()) {
            anyhow::ensure!(
                std::time::Instant::now() < deadline,
                "Display adapter retirement timed out"
            );
            thread::sleep(std::time::Duration::from_millis(5));
        }
        for thread in threads.drain(..) {
            thread
                .join()
                .map_err(|_| anyhow::anyhow!("Display adapter thread failed"))?;
        }
        Ok(())
    }
}
