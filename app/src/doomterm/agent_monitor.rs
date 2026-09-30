//! Watches every terminal pane for the program in its foreground and what that program reports.
//!
//! The status plate and both tab bars read one [`PaneAgentState`] per terminal from here instead
//! of guessing at render time. Process and file inspection runs on a background thread once a
//! second; what it sees is passed through a [`Stabilizer`], so the state views read changes only
//! when something real has. Views animate an agent's mark themselves while they paint.

use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use doomterm_agents::agent_sessions::{self, AgentKind, AgentProcess, AgentReport};
use doomterm_agents::claude_usage::ClaudeUsageError;
use doomterm_agents::foreground::{self, Foreground};
use doomterm_agents::output_activity::OutputActivity;
use doomterm_agents::stabilize::{Observation, Stabilizer, USAGE_WINDOW};
use doomterm_agents::{claude_usage, git_diff, remote_status, trace};
use doomterm_plate::DiffStats;
use instant::Instant;
use parking_lot::FairMutex;
use serde_json::json;
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

/// How often output activity is sampled and the published state refreshed.
const TICK: Duration = Duration::from_millis(100);
/// Ticks between foreground/record probes.
const PROBE_EVERY: u64 = 10;
/// Ticks between repository diff refreshes.
const REPOSITORY_EVERY: u64 = 30;
/// The first repository refresh, which waits for the first probe to learn each pane's directory.
const FIRST_REPOSITORY_TICK: u64 = 2 * PROBE_EVERY;
/// Longest a repository refresh is waited for.
const REPOSITORY_TIMEOUT: Duration = Duration::from_secs(3);
/// Refreshes in a row that must find nothing before a pane's last diff and branch are dropped.
const REPOSITORY_MISS_LIMIT: u8 = 3;
/// Probes in a row that may reject a stored in-band report before it is dropped.
const IN_BAND_MISS_LIMIT: u8 = 3;
/// Minimum interval between Claude usage requests.
const CLAUDE_USAGE_INTERVAL: Duration = Duration::from_secs(60);
/// Wait before asking again once the usage endpoint has asked to be left alone.
const CLAUDE_USAGE_BACKOFF: Duration = Duration::from_secs(5 * 60);
/// Probes between polls of a remote agent over the SSH control connection.
const REMOTE_EVERY: u64 = 3;

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
    /// Whether the agent is at work: its own turn state where it reports one, otherwise
    /// continuous output, with pauses between bursts of output not counted as waiting.
    pub working: bool,
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

    pub fn local_agent_working(&self) -> bool {
        self.local_agent().is_some() && self.working
    }
}

struct Pane {
    model: Weak<FairMutex<TerminalModel>>,
    sessions: ModelHandle<Sessions>,
    activity: Arc<OutputActivity>,
    /// What the latest probes say, which is not steady from one second to the next.
    raw: PaneAgentState,
    /// What views read: `raw` passed through the stabilizer.
    state: PaneAgentState,
    stabilizer: Stabilizer<CLIAgent>,
    /// The directory of the agent, or of the shell when no agent runs.
    cwd: Option<PathBuf>,
    remote_key: Option<RemoteKey>,
    in_band: Option<InBandReport>,
    in_band_misses: u8,
    repository_misses: u8,
}

impl Pane {
    /// Folds the probes' current view into the state views read. Returns whether that changed.
    fn publish(&mut self, now: Instant, claude_usage_enabled: bool) -> bool {
        let epoch_s = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since| since.as_secs());
        let observation = Observation {
            foreground: self.raw.foreground.clone(),
            agent: self.raw.agent,
            remote_agent: self.raw.remote_agent,
            report: self.raw.report.clone(),
            output_continuous: self.raw.output_continuous,
            session: self.session_key(),
            report_time: self
                .in_band
                .as_ref()
                .filter(|_| self.raw.in_band)
                .map(|status| status.received_at),
        };
        let status = self.stabilizer.update(&observation, now, epoch_s);
        let hides_usage = !claude_usage_enabled
            && !self.raw.in_band
            && status.remote_agent == Some(CLIAgent::Claude);
        let mut next = self.raw.clone();
        next.foreground = status.foreground;
        next.agent = status.agent;
        next.remote_agent = status.remote_agent;
        next.report = AgentReport {
            context: status.context,
            usage: status.usage.filter(|_| !hides_usage),
            usage_resets_at: status.usage_resets_at,
            working: self.raw.report.working,
            session: self.raw.report.session,
        };
        next.working = status.working;
        if next == self.state {
            return false;
        }
        self.state = next;
        true
    }

    /// Identifies the process or command whose records `raw` holds, so that a new one starts
    /// afresh. Only an observed agent names a process; a child that briefly holds the terminal
    /// says nothing about which agent is running.
    fn session_key(&self) -> Option<u64> {
        let mut hasher = DefaultHasher::new();
        if self.raw.in_band {
            self.in_band.as_ref()?.block_id.hash(&mut hasher);
        } else if let Some((session, block_id, cwd, _)) = &self.remote_key {
            (session.as_u64(), block_id, cwd).hash(&mut hasher);
        } else if let (Some(_), Some(Foreground::Program { pid, .. })) =
            (self.raw.agent, &self.raw.foreground)
        {
            pid.hash(&mut hasher);
        } else {
            return None;
        }
        Some(hasher.finish())
    }
}

struct InBandReport {
    block_id: String,
    agent: CLIAgent,
    report: AgentReport,
    diff: Option<DiffStats>,
    received_at: Instant,
}

/// Puts an in-band report into the pane's state. A local agent keeps its own diff and needs no
/// remote identity; only a pane running an SSH client takes both from the report.
fn apply_in_band(next: &mut PaneAgentState, status: &InBandReport, on_ssh: bool) {
    next.in_band = true;
    next.report = AgentReport {
        working: remote_status::in_band_working(
            status.report.working,
            status.received_at.elapsed(),
        ),
        ..status.report.clone()
    };
    if on_ssh {
        next.remote_agent = Some(status.agent);
        next.diff = status.diff.or(next.diff);
    }
}

type RemoteKey = (warp_core::SessionId, String, String, AgentKind);

pub enum DoomTermAgentMonitorEvent {
    /// Some pane's state changed.
    Changed,
}

/// Clears a busy flag when dropped, so a panicking task cannot leave it set.
struct ClearOnDrop(Arc<AtomicBool>);

impl Drop for ClearOnDrop {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

pub struct DoomTermAgentMonitor {
    panes: HashMap<EntityId, Pane>,
    tick: Option<SpawnedFutureHandle>,
    ticks: u64,
    probes: u64,
    probe_in_flight: bool,
    repository_busy: Arc<AtomicBool>,
    system: Arc<Mutex<System>>,
    claude_usage: Option<f32>,
    claude_usage_confirmed: Option<Instant>,
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
    /// The agent the running command names, which is how a remote agent shows up in a session
    /// whose shell reports each command it runs.
    command_agent: Option<CLIAgent>,
    remote: Option<RemoteProbe>,
}

struct ProbeOutput {
    id: EntityId,
    block_id: String,
    foreground: Option<Foreground>,
    agent: Option<CLIAgent>,
    report: AgentReport,
    cwd: Option<PathBuf>,
    command_agent: Option<CLIAgent>,
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
        CLIAgent::Antigravity => AgentKind::Antigravity,
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
            ticks: 0,
            probes: 0,
            probe_in_flight: false,
            repository_busy: Arc::new(AtomicBool::new(false)),
            system: Arc::new(Mutex::new(System::new())),
            claude_usage: None,
            claude_usage_confirmed: None,
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
                raw: PaneAgentState::default(),
                state: PaneAgentState::default(),
                stabilizer: Stabilizer::new(),
                cwd: None,
                remote_key: None,
                in_band: None,
                in_band_misses: 0,
                repository_misses: 0,
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
        let claude_usage_enabled = *DoomTermUsageSettings::as_ref(ctx).claude_usage_lookup_enabled;
        let Some(pane) = self.panes.get_mut(&id) else {
            return;
        };
        let on_ssh = pane.raw.remote_host().is_some();
        // Antigravity can report before the first probe has noticed it is running; the next probe
        // drops the report again if the foreground program is not Antigravity after all.
        let not_yet_noticed =
            kind == AgentKind::Antigravity && !on_ssh && pane.raw.agent.is_none();
        if !not_yet_noticed
            && !remote_status::accepts_in_band(kind, on_ssh, pane.raw.agent.map(agent_kind))
        {
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
            AgentKind::Antigravity => CLIAgent::Antigravity,
            AgentKind::Other => return,
        };
        let status = InBandReport {
            block_id,
            agent,
            report,
            diff,
            received_at: Instant::now(),
        };
        let mut next = pane.raw.clone();
        apply_in_band(&mut next, &status, on_ssh);
        pane.in_band = Some(status);
        pane.in_band_misses = 0;
        pane.raw = next;
        if pane.publish(Instant::now(), claude_usage_enabled) {
            ctx.emit(DoomTermAgentMonitorEvent::Changed);
        }
    }

    /// Account-wide Claude rate-limit use, when the user enabled the lookup and it succeeded.
    pub fn claude_usage(&self) -> Option<f32> {
        let confirmed = self.claude_usage_confirmed?;
        (confirmed.elapsed() < USAGE_WINDOW)
            .then_some(self.claude_usage)
            .flatten()
    }

    fn schedule(&mut self, ctx: &mut ModelContext<Self>) {
        self.tick = Some(ctx.spawn_abortable(
            Timer::after(TICK),
            |me, _, ctx| me.on_tick(ctx),
            |_, _| {},
        ));
    }

    fn trace_panes(&self) {
        trace::emit_changed("panes", || {
            let mut panes: Vec<_> = self.panes.iter().collect();
            panes.sort_by_key(|(id, _)| **id);
            let panes: Vec<_> = panes
                .into_iter()
                .map(|(id, pane)| {
                    let (raw, state) = (&pane.raw, &pane.state);
                    json!({
                        "id": format!("{id:?}"),
                        "foreground": format!("{:?}", state.foreground),
                        "agent": state.agent.map(|agent| format!("{agent:?}")),
                        "remote_agent": state.remote_agent.map(|agent| format!("{agent:?}")),
                        "in_band": state.in_band,
                        "working": state.working,
                        "context_pct": state.report.context.map(|value| (value * 100.0).round() as i32),
                        "usage_pct": state.report.usage.map(|value| (value * 100.0).round() as i32),
                        "raw_agent": raw.agent.map(|agent| format!("{agent:?}")),
                        "raw_working": raw.report.working.unwrap_or(raw.output_continuous),
                        "raw_context_pct": raw.report.context.map(|value| (value * 100.0).round() as i32),
                        "raw_usage_pct": raw.report.usage.map(|value| (value * 100.0).round() as i32),
                    })
                })
                .collect();
            json!({ "panes": panes })
        });
    }

    fn on_tick(&mut self, ctx: &mut ModelContext<Self>) {
        self.ticks += 1;
        trace::emit("tick", || json!({}));
        self.panes.retain(|_, pane| pane.model.strong_count() > 0);
        if self.panes.is_empty() {
            self.tick = None;
            return;
        }

        let now = Instant::now();
        let claude_usage_enabled = *DoomTermUsageSettings::as_ref(ctx).claude_usage_lookup_enabled;
        self.remote_claude_usage_enabled
            .store(claude_usage_enabled, Ordering::Release);
        let mut changed = false;
        for pane in self.panes.values_mut() {
            pane.raw.output_continuous = pane.activity.is_continuous();
            changed |= pane.publish(now, claude_usage_enabled);
        }
        if changed {
            ctx.emit(DoomTermAgentMonitorEvent::Changed);
        }

        if self.ticks.is_multiple_of(PROBE_EVERY) {
            self.start_probe(ctx);
            self.maybe_fetch_claude_usage(ctx);
        }
        if self.ticks.is_multiple_of(REPOSITORY_EVERY) || self.ticks == FIRST_REPOSITORY_TICK {
            self.start_repository_probe(ctx);
        }
        self.trace_panes();
        self.schedule(ctx);
    }

    fn start_probe(&mut self, ctx: &mut ModelContext<Self>) {
        if self.probe_in_flight {
            return;
        }
        let mut lock_wait = Duration::ZERO;
        let inputs: Vec<ProbeInput> = self
            .panes
            .iter()
            .filter_map(|(id, pane)| {
                let model = pane.model.upgrade()?;
                let (shell, command, session_id, cwd, block_id) = {
                    let locking = Instant::now();
                    let model = model.lock();
                    lock_wait += locking.elapsed();
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
                let session = session_id.and_then(|id| pane.sessions.as_ref(ctx).get(id));
                let command_agent = command.as_deref().and_then(|command| {
                    CLIAgent::detect(
                        command,
                        session.as_ref().map(|s| s.shell_family().escape_char()),
                        session.as_ref().map(|s| s.aliases()),
                        ctx,
                    )
                });
                let remote = match (command_agent, session, cwd) {
                    (Some(agent), Some(session), Some(cwd))
                        if session.ssh_control_socket().is_some()
                            && agent_kind(agent) != AgentKind::Other =>
                    {
                        Some(RemoteProbe {
                            session,
                            block_id: block_id.clone(),
                            cwd,
                            agent,
                            kind: agent_kind(agent),
                        })
                    }
                    _ => None,
                };
                Some(ProbeInput {
                    id: *id,
                    block_id,
                    shell,
                    command_agent,
                    remote,
                })
            })
            .collect();
        if inputs.is_empty() {
            return;
        }
        trace::emit("probe_start", || {
            json!({ "lock_ms": lock_wait.as_secs_f64() * 1000.0, "panes": inputs.len() })
        });
        self.probes += 1;
        let with_remote = self.probes.is_multiple_of(REMOTE_EVERY) || self.probes == 1;
        let system = self.system.clone();
        let home = dirs::home_dir();
        self.probe_in_flight = true;
        ctx.spawn(
            async move {
                tokio::task::spawn_blocking(move || {
                    let started = Instant::now();
                    let outputs = probe_all(inputs, &system, home);
                    trace::emit("probe", || {
                        json!({ "ms": started.elapsed().as_secs_f64() * 1000.0 })
                    });
                    outputs
                })
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
        let now = Instant::now();
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
                    pane.raw.remote_agent = None;
                    pane.raw.report = AgentReport::default();
                }
                changed |= pane.publish(now, claude_usage_enabled);
                continue;
            }
            let mut next = pane.raw.clone();
            next.foreground = output.foreground;
            next.agent = output.agent;
            next.report = output.report;
            let on_ssh = matches!(next.foreground, Some(Foreground::Remote { .. }));
            let local_agent = next.agent.map(agent_kind);
            pane.in_band = match pane.in_band.take() {
                Some(status)
                    if status.block_id == output.block_id
                        && status.received_at.elapsed() <= remote_status::in_band_max_age() =>
                {
                    if remote_status::accepts_in_band(agent_kind(status.agent), on_ssh, local_agent)
                    {
                        pane.in_band_misses = 0;
                        Some(status)
                    } else {
                        pane.in_band_misses += 1;
                        (pane.in_band_misses < IN_BAND_MISS_LIMIT).then_some(status)
                    }
                }
                _ => None,
            };
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
                .and_then(|_| output.remote.as_ref().map(|remote| remote.agent))
                .or(output.command_agent.filter(|_| on_ssh));
            next.in_band = false;
            if same_remote_key {
                next.report = pane.raw.report.clone();
            }
            if let Some(status) = pane.in_band.as_ref() {
                apply_in_band(&mut next, status, on_ssh);
            }
            if next.remote_agent == Some(CLIAgent::Claude) && !claude_usage_enabled && !next.in_band
            {
                next.report.usage = None;
            }
            if pane.raw.remote_host().is_some() && next.remote_host().is_none() {
                next.diff = None;
                next.branch = None;
            }
            if next.remote_host().is_some() {
                let previous = pane.raw.remote_host().and(pane.raw.diff);
                next.diff = if let Some(status) = pane.in_band.as_ref() {
                    status.diff.or(previous)
                } else if same_remote_key {
                    pane.raw.diff
                } else {
                    None
                };
                next.branch = None;
            }
            pane.remote_key = remote_key.clone();
            pane.cwd = output.cwd;
            pane.raw = next;
            changed |= pane.publish(now, claude_usage_enabled);
            if with_remote
                && pane.in_band.is_none()
                && let (Some(remote), Some(key)) = (output.remote, remote_key)
                && matches!(remote.kind, AgentKind::Claude | AgentKind::Codex)
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
                        let report = run_remote_probe(&remote, &usage_enabled).await;
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
        reports: Vec<(EntityId, RemoteKey, Option<(AgentReport, Option<DiffStats>)>)>,
        ctx: &mut ModelContext<Self>,
    ) {
        let now = Instant::now();
        let claude_usage_enabled = *DoomTermUsageSettings::as_ref(ctx).claude_usage_lookup_enabled;
        let mut changed = false;
        for (id, key, result) in reports {
            // A poll that failed says nothing, so the last report stays.
            let Some((mut report, diff)) = result else {
                continue;
            };
            let Some(pane) = self.panes.get_mut(&id) else {
                continue;
            };
            if pane.remote_key.as_ref() != Some(&key) || !remote_key_is_current(pane, &key) {
                continue;
            }
            if pane.raw.in_band {
                continue;
            }
            if key.3 == AgentKind::Claude && !claude_usage_enabled {
                report.usage = None;
            }
            pane.raw.report = report;
            pane.raw.diff = diff.or(pane.raw.diff);
            changed |= pane.publish(now, claude_usage_enabled);
        }
        if changed {
            ctx.emit(DoomTermAgentMonitorEvent::Changed);
        }
    }

    /// Reads the repository diff and branch on a task of its own, so a slow or hung repository
    /// cannot hold up agent detection.
    fn start_repository_probe(&mut self, ctx: &mut ModelContext<Self>) {
        if self.repository_busy.load(Ordering::Acquire) {
            return;
        }
        let mut dirs: Vec<PathBuf> = self
            .panes
            .values()
            .filter(|pane| pane.raw.remote_host().is_none())
            .filter_map(|pane| pane.cwd.clone())
            .collect();
        dirs.sort();
        dirs.dedup();
        if dirs.is_empty() {
            return;
        }
        let busy = self.repository_busy.clone();
        busy.store(true, Ordering::Release);
        ctx.spawn(
            async move {
                let task = tokio::task::spawn_blocking(move || {
                    let _clear = ClearOnDrop(busy);
                    dirs.into_iter()
                        .map(|dir| {
                            let diff = git_diff::diff_stats(&dir);
                            let branch = git_diff::branch(&dir);
                            (dir, diff, branch)
                        })
                        .collect::<Vec<_>>()
                });
                tokio::time::timeout(REPOSITORY_TIMEOUT, task)
                    .await
                    .ok()
                    .and_then(Result::ok)
                    .unwrap_or_default()
            },
            |me, results, ctx| me.apply_repository(results, ctx),
        );
    }

    fn apply_repository(
        &mut self,
        results: Vec<(PathBuf, Option<DiffStats>, Option<String>)>,
        ctx: &mut ModelContext<Self>,
    ) {
        let now = Instant::now();
        let claude_usage_enabled = *DoomTermUsageSettings::as_ref(ctx).claude_usage_lookup_enabled;
        let mut changed = false;
        for pane in self.panes.values_mut() {
            let Some(cwd) = pane.cwd.as_ref() else {
                continue;
            };
            if pane.raw.remote_host().is_some() {
                continue;
            }
            let Some((_, diff, branch)) = results.iter().find(|(dir, ..)| dir == cwd) else {
                continue;
            };
            if diff.is_some() || branch.is_some() {
                pane.repository_misses = 0;
                pane.raw.diff = *diff;
                pane.raw.branch = branch.clone();
            } else {
                pane.repository_misses = pane.repository_misses.saturating_add(1);
                if pane.repository_misses >= REPOSITORY_MISS_LIMIT {
                    pane.raw.diff = None;
                    pane.raw.branch = None;
                }
            }
            changed |= pane.publish(now, claude_usage_enabled);
        }
        if changed {
            ctx.emit(DoomTermAgentMonitorEvent::Changed);
        }
    }

    fn maybe_fetch_claude_usage(&mut self, ctx: &mut ModelContext<Self>) {
        let enabled = *DoomTermUsageSettings::as_ref(ctx).claude_usage_lookup_enabled;
        if !enabled {
            self.claude_usage_checked = None;
            self.claude_usage_confirmed = None;
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
                match result {
                    Ok(usage) => {
                        me.claude_usage_confirmed = Some(Instant::now());
                        if me.claude_usage != Some(usage) {
                            me.claude_usage = Some(usage);
                            ctx.emit(DoomTermAgentMonitorEvent::Changed);
                        }
                    }
                    // A failed request says nothing about what the last one found.
                    Err(err) => {
                        log::info!("Claude usage lookup failed: {err}");
                        if matches!(err, ClaudeUsageError::Status(429)) {
                            me.claude_usage_checked =
                                Some(Instant::now() + CLAUDE_USAGE_BACKOFF - CLAUDE_USAGE_INTERVAL);
                        }
                    }
                }
            },
        );
    }
}

fn probe_all(
    inputs: Vec<ProbeInput>,
    system: &Mutex<System>,
    home: Option<PathBuf>,
) -> Vec<ProbeOutput> {
    // A panic elsewhere while this lock was held leaves the process table itself intact.
    let mut system = system.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
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
            ProbeOutput {
                id: input.id,
                block_id: input.block_id,
                foreground,
                agent: agent_pid.map(|(agent, _)| agent),
                report,
                cwd,
                command_agent: input.command_agent,
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
        AgentKind::Antigravity | AgentKind::Other => return None,
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
