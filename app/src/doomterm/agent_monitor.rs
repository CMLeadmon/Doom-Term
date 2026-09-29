//! Watches every terminal pane for the program in its foreground and what that program reports.
//!
//! The status plate and both tab bars read one [`PaneAgentState`] per terminal from here instead
//! of guessing at render time. Process and file inspection runs on a background thread once a
//! second; the only per-frame work is reading an atomic activity counter. While any agent is
//! working the monitor emits [`DoomTermAgentMonitorEvent::Frame`] so views animate its mark.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, SystemTime};

use doomterm_agents::agent_sessions::{self, AgentKind, AgentProcess, AgentReport};
use doomterm_agents::foreground::{self, Foreground};
use doomterm_agents::output_activity::OutputActivity;
use doomterm_agents::{claude_usage, git_diff, remote_status};
use doomterm_plate::DiffStats;
use instant::Instant;
use parking_lot::FairMutex;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use warpui::r#async::{SpawnedFutureHandle, Timer};
use warpui::{Entity, EntityId, ModelContext, ModelHandle, SingletonEntity};

use crate::settings::DoomTermUsageSettings;
use crate::terminal::model::session::command_executor::{
    CommandExecutor as _, ExecuteCommandOptions, RemoteCommandExecutor,
};
use crate::terminal::model::session::{Session, Sessions};
use crate::terminal::model::terminal_model::ShellProcessInfo;
use crate::terminal::{CLIAgent, TerminalModel};

/// Animation and activity sampling period.
const FRAME: Duration = Duration::from_millis(100);
/// Frames between foreground/record probes.
const PROBE_EVERY: u64 = 10;
/// Probes between repository diff refreshes.
const DIFF_EVERY: u64 = 3;
/// Minimum interval between Claude usage requests.
const CLAUDE_USAGE_INTERVAL: Duration = Duration::from_secs(60);
const REMOTE_EVERY: u64 = 3;
const IN_BAND_MAX_AGE: Duration = Duration::from_secs(60);

/// Everything known about the program running in one terminal pane.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PaneAgentState {
    /// The pane's foreground program; `None` until probed, or when the OS gave no answer.
    pub foreground: Option<Foreground>,
    /// The agent CLI the foreground program is, if it is one.
    pub agent: Option<CLIAgent>,
    /// A remote agent reported in-band or through the SSH wrapper.
    pub remote_agent: Option<CLIAgent>,
    /// Whether the remote report arrived in this pane's terminal stream.
    pub in_band: bool,
    /// What the agent's own session records or status message report.
    pub report: AgentReport,
    /// Whether the pane's output has been continuous for the last second.
    pub output_continuous: bool,
    /// Uncommitted changes of the repository the pane is working in.
    pub diff: Option<DiffStats>,
    /// Branch of that repository, when local.
    pub branch: Option<String>,
}

impl PaneAgentState {
    pub fn local_agent(&self) -> Option<CLIAgent> {
        self.agent
    }

    pub fn remote_host(&self) -> Option<&str> {
        match &self.foreground {
            Some(Foreground::Remote { host }) => Some(host),
            _ => None,
        }
    }

    /// Whether a local agent is working: its own turn state where it records one, otherwise
    /// continuous output.
    pub fn local_agent_working(&self) -> bool {
        self.local_agent().is_some() && self.report.working.unwrap_or(self.output_continuous)
    }
}

struct Pane {
    model: Weak<FairMutex<TerminalModel>>,
    sessions: ModelHandle<Sessions>,
    activity: Arc<OutputActivity>,
    state: PaneAgentState,
    remote_key: Option<RemoteKey>,
    in_band: Option<InBandReport>,
}

struct InBandReport {
    block_id: String,
    agent: CLIAgent,
    report: AgentReport,
    diff: Option<DiffStats>,
    received_at: Instant,
}

type RemoteKey = (warp_core::SessionId, String, String, AgentKind);

pub enum DoomTermAgentMonitorEvent {
    /// Some pane's state changed.
    Changed,
    /// An animation frame while at least one agent is working.
    Frame,
}

pub struct DoomTermAgentMonitor {
    panes: HashMap<EntityId, Pane>,
    tick: Option<SpawnedFutureHandle>,
    frames: u64,
    probes: u64,
    probe_in_flight: bool,
    system: Arc<Mutex<System>>,
    claude_usage: Option<f32>,
    claude_usage_checked: Option<Instant>,
    claude_usage_in_flight: bool,
    remote_in_flight: HashSet<PathBuf>,
    remote_claude_usage_enabled: Arc<AtomicBool>,
}

impl Entity for DoomTermAgentMonitor {
    type Event = DoomTermAgentMonitorEvent;
}

impl SingletonEntity for DoomTermAgentMonitor {}

struct ProbeInput {
    id: EntityId,
    block_id: String,
    shell: ShellProcessInfo,
    remote: Option<RemoteProbe>,
}

struct ProbeOutput {
    id: EntityId,
    block_id: String,
    foreground: Option<Foreground>,
    agent: Option<CLIAgent>,
    report: AgentReport,
    repository: Option<(Option<DiffStats>, Option<String>)>,
    remote: Option<RemoteProbe>,
}

struct RemoteProbe {
    session: Arc<Session>,
    block_id: String,
    cwd: String,
    agent: CLIAgent,
    kind: AgentKind,
}

/// The agent CLI a program name belongs to, by the command names each agent installs.
fn agent_for_program(name: &str) -> Option<CLIAgent> {
    enum_iterator::all::<CLIAgent>()
        .filter(|agent| !matches!(agent, CLIAgent::Unknown | CLIAgent::WarpTui))
        .find(|agent| agent.command_prefixes().contains(&name))
}

fn agent_kind(agent: CLIAgent) -> AgentKind {
    match agent {
        CLIAgent::Claude => AgentKind::Claude,
        CLIAgent::Codex => AgentKind::Codex,
        CLIAgent::Gemini
        | CLIAgent::Amp
        | CLIAgent::Droid
        | CLIAgent::OpenCode
        | CLIAgent::Copilot
        | CLIAgent::Pi
        | CLIAgent::OhMyPi
        | CLIAgent::Auggie
        | CLIAgent::CursorCli
        | CLIAgent::Goose
        | CLIAgent::Hermes
        | CLIAgent::Vibe
        | CLIAgent::Antigravity
        | CLIAgent::Grok
        | CLIAgent::WarpTui
        | CLIAgent::Unknown => AgentKind::Other,
    }
}

fn pty_leader_fd(shell: &ShellProcessInfo) -> Option<i32> {
    #[cfg(unix)]
    {
        shell.pty_leader_fd
    }
    #[cfg(not(unix))]
    {
        let _ = shell;
        None
    }
}

impl DoomTermAgentMonitor {
    pub fn new() -> Self {
        Self {
            panes: HashMap::new(),
            tick: None,
            frames: 0,
            probes: 0,
            probe_in_flight: false,
            system: Arc::new(Mutex::new(System::new())),
            claude_usage: None,
            claude_usage_checked: None,
            claude_usage_in_flight: false,
            remote_in_flight: HashSet::new(),
            remote_claude_usage_enabled: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Starts watching a terminal pane. Panes are forgotten once their model is dropped.
    pub fn track(
        &mut self,
        id: EntityId,
        model: &Arc<FairMutex<TerminalModel>>,
        sessions: ModelHandle<Sessions>,
        ctx: &mut ModelContext<Self>,
    ) {
        let activity = model.lock().output_activity().clone();
        self.panes.insert(
            id,
            Pane {
                model: Arc::downgrade(model),
                sessions,
                activity,
                state: PaneAgentState::default(),
                remote_key: None,
                in_band: None,
            },
        );
        if self.tick.is_none() {
            self.schedule(ctx);
        }
    }

    pub fn state(&self, id: EntityId) -> Option<&PaneAgentState> {
        self.panes.get(&id).map(|pane| &pane.state)
    }

    pub fn accept_in_band(&mut self, id: EntityId, body: &str, ctx: &mut ModelContext<Self>) {
        let Some((kind, report, diff)) = remote_status::parse_in_band(body.as_bytes()) else {
            return;
        };
        let Some(pane) = self.panes.get_mut(&id) else {
            return;
        };
        if pane.state.remote_host().is_none() {
            return;
        }
        let Some(model) = pane.model.upgrade() else {
            return;
        };
        let block_id = {
            let model = model.lock();
            let block = model.block_list().active_block();
            if !block.is_active_and_long_running() {
                return;
            }
            block.id().to_string()
        };
        let agent = match kind {
            AgentKind::Claude => CLIAgent::Claude,
            AgentKind::Codex => CLIAgent::Codex,
            AgentKind::Other => return,
        };
        pane.in_band = Some(InBandReport {
            block_id,
            agent,
            report: report.clone(),
            diff,
            received_at: Instant::now(),
        });
        let mut next = pane.state.clone();
        next.remote_agent = Some(agent);
        next.in_band = true;
        next.report = report;
        next.diff = diff;
        if next != pane.state {
            pane.state = next;
            ctx.emit(DoomTermAgentMonitorEvent::Changed);
        }
    }

    /// Account-wide Claude rate-limit use, when the user enabled the lookup and it succeeded.
    pub fn claude_usage(&self) -> Option<f32> {
        self.claude_usage
    }

    fn schedule(&mut self, ctx: &mut ModelContext<Self>) {
        self.tick = Some(ctx.spawn_abortable(
            Timer::after(FRAME),
            |me, _, ctx| me.on_frame(ctx),
            |_, _| {},
        ));
    }

    fn on_frame(&mut self, ctx: &mut ModelContext<Self>) {
        self.frames += 1;
        self.panes.retain(|_, pane| pane.model.strong_count() > 0);
        if self.panes.is_empty() {
            self.tick = None;
            return;
        }

        let mut changed = false;
        let claude_usage_enabled = *DoomTermUsageSettings::as_ref(ctx).claude_usage_lookup_enabled;
        self.remote_claude_usage_enabled
            .store(claude_usage_enabled, Ordering::Release);
        for pane in self.panes.values_mut() {
            let continuous = pane.activity.is_continuous();
            if pane.state.output_continuous != continuous {
                pane.state.output_continuous = continuous;
                changed = true;
            }
            if !claude_usage_enabled
                && !pane.state.in_band
                && pane.state.remote_agent == Some(CLIAgent::Claude)
                && pane.state.report.usage.take().is_some()
            {
                changed = true;
            }
        }
        if changed {
            ctx.emit(DoomTermAgentMonitorEvent::Changed);
        }
        if self.panes.values().any(|pane| {
            pane.state.local_agent_working()
                || (pane.state.remote_agent.is_some()
                    && pane
                        .state
                        .report
                        .working
                        .unwrap_or(pane.state.output_continuous))
        }) {
            ctx.emit(DoomTermAgentMonitorEvent::Frame);
        }

        if self.frames.is_multiple_of(PROBE_EVERY) {
            self.start_probe(ctx);
            self.maybe_fetch_claude_usage(ctx);
        }
        self.schedule(ctx);
    }

    fn start_probe(&mut self, ctx: &mut ModelContext<Self>) {
        if self.probe_in_flight {
            return;
        }
        let inputs: Vec<ProbeInput> = self
            .panes
            .iter()
            .filter_map(|(id, pane)| {
                let model = pane.model.upgrade()?;
                let (shell, command, session_id, cwd, block_id) = {
                    let model = model.lock();
                    let shell = *model.shell_process_info()?;
                    let block = model.block_list().active_block();
                    let command = block
                        .is_active_and_long_running()
                        .then(|| block.command_to_string());
                    let cwd = block
                        .metadata()
                        .current_working_directory()
                        .map(str::to_owned);
                    (
                        shell,
                        command,
                        block.session_id(),
                        cwd,
                        block.id().to_string(),
                    )
                };
                let remote = match (command, session_id, cwd) {
                    (Some(command), Some(session_id), Some(cwd)) => pane
                        .sessions
                        .as_ref(ctx)
                        .get(session_id)
                        .filter(|session| session.ssh_control_socket().is_some())
                        .and_then(|session| {
                            let agent = CLIAgent::detect(
                                &command,
                                Some(session.shell_family().escape_char()),
                                Some(session.aliases()),
                                ctx,
                            )?;
                            let kind = agent_kind(agent);
                            (kind != AgentKind::Other).then_some(RemoteProbe {
                                session,
                                block_id: block_id.clone(),
                                cwd,
                                agent,
                                kind,
                            })
                        }),
                    _ => None,
                };
                Some(ProbeInput {
                    id: *id,
                    block_id,
                    shell,
                    remote,
                })
            })
            .collect();
        if inputs.is_empty() {
            return;
        }
        self.probes += 1;
        let with_diff = self.probes.is_multiple_of(DIFF_EVERY) || self.probes == 1;
        let with_remote = self.probes.is_multiple_of(REMOTE_EVERY) || self.probes == 1;
        let system = self.system.clone();
        let home = dirs::home_dir();
        self.probe_in_flight = true;
        ctx.spawn(
            async move {
                tokio::task::spawn_blocking(move || probe_all(inputs, &system, home, with_diff))
                    .await
                    .unwrap_or_default()
            },
            move |me, outputs, ctx| {
                me.probe_in_flight = false;
                me.apply_probe(outputs, with_remote, ctx);
            },
        );
    }

    fn apply_probe(
        &mut self,
        outputs: Vec<ProbeOutput>,
        with_remote: bool,
        ctx: &mut ModelContext<Self>,
    ) {
        let mut changed = false;
        let claude_usage_enabled = *DoomTermUsageSettings::as_ref(ctx).claude_usage_lookup_enabled;
        let mut remote_requests: HashMap<PathBuf, Vec<(EntityId, RemoteKey, RemoteProbe)>> =
            HashMap::new();
        for output in outputs {
            let Some(pane) = self.panes.get_mut(&output.id) else {
                continue;
            };
            if output
                .remote
                .as_ref()
                .is_some_and(|remote| !remote_is_current(pane, remote))
            {
                if pane.remote_key.take().is_some() && pane.in_band.is_none() {
                    pane.state.remote_agent = None;
                    pane.state.report = AgentReport::default();
                    changed = true;
                }
                continue;
            }
            let mut next = pane.state.clone();
            next.foreground = output.foreground;
            next.agent = output.agent;
            next.report = output.report;
            if !matches!(next.foreground, Some(Foreground::Remote { .. }))
                || pane
                    .in_band
                    .as_ref()
                    .is_some_and(|status| status.block_id != output.block_id)
                || pane
                    .in_band
                    .as_ref()
                    .is_some_and(|status| status.received_at.elapsed() > IN_BAND_MAX_AGE)
            {
                pane.in_band = None;
            }
            let remote_key = output.remote.as_ref().and_then(|remote| {
                next.remote_host().map(|_| {
                    (
                        remote.session.id(),
                        remote.block_id.clone(),
                        remote.cwd.clone(),
                        remote.kind,
                    )
                })
            });
            let same_remote_key = remote_key.is_some() && pane.remote_key == remote_key;
            if remote_key.is_some() && !same_remote_key {
                next.report = AgentReport::default();
            }
            next.remote_agent = remote_key
                .as_ref()
                .and_then(|_| output.remote.as_ref().map(|remote| remote.agent));
            next.in_band = false;
            if same_remote_key {
                next.report = pane.state.report.clone();
            }
            if let Some(status) = pane.in_band.as_ref() {
                next.remote_agent = Some(status.agent);
                next.in_band = true;
                next.report = status.report.clone();
            }
            if next.remote_agent == Some(CLIAgent::Claude) && !claude_usage_enabled && !next.in_band
            {
                next.report.usage = None;
            }
            if pane.state.remote_host().is_some() && next.remote_host().is_none() {
                next.diff = None;
                next.branch = None;
            }
            if let Some((diff, branch)) = output.repository {
                next.diff = diff;
                next.branch = branch;
            }
            if next.remote_host().is_some() {
                next.diff = if let Some(status) = pane.in_band.as_ref() {
                    status.diff
                } else if same_remote_key {
                    pane.state.diff
                } else {
                    None
                };
                next.branch = None;
            }
            pane.remote_key = remote_key.clone();
            if next != pane.state {
                pane.state = next;
                changed = true;
            }
            if with_remote
                && pane.in_band.is_none()
                && let (Some(remote), Some(key)) = (output.remote, remote_key)
                && let Some(socket) = remote.session.ssh_control_socket()
            {
                remote_requests
                    .entry(socket.to_path_buf())
                    .or_default()
                    .push((output.id, key, remote));
            }
        }
        if changed {
            ctx.emit(DoomTermAgentMonitorEvent::Changed);
        }
        for (socket, requests) in remote_requests {
            if !self.remote_in_flight.insert(socket.clone()) {
                continue;
            }
            let usage_enabled = self.remote_claude_usage_enabled.clone();
            ctx.spawn(
                async move {
                    let mut reports = Vec::with_capacity(requests.len());
                    for (id, key, remote) in requests {
                        let report = run_remote_probe(&remote, &usage_enabled)
                            .await
                            .unwrap_or_default();
                        reports.push((id, key, report));
                    }
                    (socket, reports)
                },
                |me, (socket, reports), ctx| {
                    me.remote_in_flight.remove(&socket);
                    me.apply_remote_reports(reports, ctx);
                },
            );
        }
    }

    fn apply_remote_reports(
        &mut self,
        reports: Vec<(EntityId, RemoteKey, (AgentReport, Option<DiffStats>))>,
        ctx: &mut ModelContext<Self>,
    ) {
        let claude_usage_enabled = *DoomTermUsageSettings::as_ref(ctx).claude_usage_lookup_enabled;
        let mut changed = false;
        for (id, key, (mut report, diff)) in reports {
            let Some(pane) = self.panes.get_mut(&id) else {
                continue;
            };
            if pane.remote_key.as_ref() != Some(&key) || !remote_key_is_current(pane, &key) {
                continue;
            }
            if pane.state.in_band {
                continue;
            }
            if key.3 == AgentKind::Claude && !claude_usage_enabled {
                report.usage = None;
            }
            if pane.state.report != report || pane.state.diff != diff {
                pane.state.report = report;
                pane.state.diff = diff;
                changed = true;
            }
        }
        if changed {
            ctx.emit(DoomTermAgentMonitorEvent::Changed);
        }
    }

    fn maybe_fetch_claude_usage(&mut self, ctx: &mut ModelContext<Self>) {
        let enabled = *DoomTermUsageSettings::as_ref(ctx).claude_usage_lookup_enabled;
        if !enabled {
            self.claude_usage_checked = None;
            if self.claude_usage.take().is_some() {
                ctx.emit(DoomTermAgentMonitorEvent::Changed);
            }
            return;
        }
        let claude_running = self
            .panes
            .values()
            .any(|pane| pane.state.local_agent() == Some(CLIAgent::Claude));
        let due = self
            .claude_usage_checked
            .is_none_or(|at| at.elapsed() >= CLAUDE_USAGE_INTERVAL);
        if !claude_running || !due || self.claude_usage_in_flight {
            return;
        }
        let Some(home) = dirs::home_dir() else {
            return;
        };
        self.claude_usage_in_flight = true;
        self.claude_usage_checked = Some(Instant::now());
        let claude_home = agent_sessions::claude_home(&home);
        ctx.spawn(
            async move { claude_usage::fetch(&claude_home).await },
            |me, result, ctx| {
                me.claude_usage_in_flight = false;
                if !*DoomTermUsageSettings::as_ref(ctx).claude_usage_lookup_enabled {
                    return;
                }
                let usage = match result {
                    Ok(usage) => Some(usage),
                    Err(err) => {
                        log::info!("Claude usage lookup failed: {err}");
                        None
                    }
                };
                if me.claude_usage != usage {
                    me.claude_usage = usage;
                    ctx.emit(DoomTermAgentMonitorEvent::Changed);
                }
            },
        );
    }
}

fn probe_all(
    inputs: Vec<ProbeInput>,
    system: &Mutex<System>,
    home: Option<PathBuf>,
    with_diff: bool,
) -> Vec<ProbeOutput> {
    let Ok(mut system) = system.lock() else {
        return Vec::new();
    };
    inputs
        .into_iter()
        .map(|input| {
            let foreground =
                foreground::probe(input.shell.pid, pty_leader_fd(&input.shell), &mut system);
            let agent_pid = match &foreground {
                Some(Foreground::Program { name, pid }) => {
                    agent_for_program(name).map(|agent| (agent, *pid))
                }
                Some(Foreground::Shell | Foreground::Remote { .. }) | None => None,
            };
            let working_dir_pid = agent_pid.map_or(input.shell.pid, |(_, pid)| pid);
            let (cwd, started) = process_cwd_and_start(&mut system, working_dir_pid);
            let report = match (agent_pid, &home) {
                (Some((agent, pid)), Some(home)) => agent_sessions::read_report(
                    &AgentProcess {
                        kind: agent_kind(agent),
                        pid,
                        cwd: cwd.clone(),
                        started,
                    },
                    home,
                ),
                _ => AgentReport::default(),
            };
            let remote = matches!(foreground, Some(Foreground::Remote { .. }));
            let repository = (with_diff && !remote).then(|| {
                let dir = cwd.as_deref();
                (
                    dir.and_then(git_diff::diff_stats),
                    dir.and_then(git_diff::branch),
                )
            });
            ProbeOutput {
                id: input.id,
                block_id: input.block_id,
                foreground,
                agent: agent_pid.map(|(agent, _)| agent),
                report,
                repository,
                remote: input.remote,
            }
        })
        .collect()
}

fn process_cwd_and_start(system: &mut System, pid: u32) -> (Option<PathBuf>, Option<SystemTime>) {
    let pid = Pid::from_u32(pid);
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::nothing().with_cwd(UpdateKind::Always),
    );
    let Some(process) = system.process(pid) else {
        return (None, None);
    };
    let started = SystemTime::UNIX_EPOCH.checked_add(Duration::from_secs(process.start_time()));
    (process.cwd().map(PathBuf::from), started)
}

fn remote_is_current(pane: &Pane, remote: &RemoteProbe) -> bool {
    let Some(model) = pane.model.upgrade() else {
        return false;
    };
    let model = model.lock();
    let block = model.block_list().active_block();
    block.is_active_and_long_running()
        && block.id().as_str() == remote.block_id
        && block.session_id() == Some(remote.session.id())
        && block.metadata().current_working_directory() == Some(remote.cwd.as_str())
}

fn remote_key_is_current(pane: &Pane, key: &RemoteKey) -> bool {
    let Some(model) = pane.model.upgrade() else {
        return false;
    };
    let model = model.lock();
    let block = model.block_list().active_block();
    block.is_active_and_long_running()
        && block.id().as_str() == key.1
        && block.session_id() == Some(key.0)
        && block.metadata().current_working_directory() == Some(key.2.as_str())
}

async fn run_remote_probe(
    remote: &RemoteProbe,
    usage_enabled: &AtomicBool,
) -> Option<(AgentReport, Option<DiffStats>)> {
    let socket = remote.session.ssh_control_socket()?.to_path_buf();
    let kind = match remote.kind {
        AgentKind::Claude => "claude",
        AgentKind::Codex => "codex",
        AgentKind::Other => return None,
    };
    let cwd_hex = remote_status::encode_cwd(&remote.cwd);
    let usage_option = if usage_enabled.load(Ordering::Acquire) && remote.kind == AgentKind::Claude
    {
        " --claude-usage"
    } else {
        ""
    };
    let command = format!(
        "\"$HOME/.local/bin/doomterm-agent-status\" --kind {kind} --cwd-hex {cwd_hex} --session-id {}{usage_option}",
        remote.session.id().as_u64()
    );
    let executor =
        RemoteCommandExecutor::new(socket, remote.session.wsl_distro_name().map(str::to_owned));
    let output = tokio::time::timeout(
        Duration::from_secs(8),
        executor.execute_command(
            &command,
            remote.session.shell(),
            None,
            None,
            ExecuteCommandOptions::default(),
        ),
    )
    .await
    .ok()?
    .ok()?;
    output
        .success()
        .then(|| remote_status::parse_report_with_diff(&output.stdout))
        .flatten()
}
