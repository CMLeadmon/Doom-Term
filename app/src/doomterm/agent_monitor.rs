//! Watches every terminal pane for the program in its foreground and what that program reports.
//!
//! The status plate and both tab bars read one [`PaneAgentState`] per terminal from here instead
//! of guessing at render time. Process and file inspection runs on a background thread once a
//! second; the only per-frame work is reading an atomic activity counter. While any agent is
//! working the monitor emits [`DoomTermAgentMonitorEvent::Frame`] so views animate its mark.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, SystemTime};

use doomterm_agents::agent_sessions::{self, AgentKind, AgentProcess, AgentReport};
use doomterm_agents::foreground::{self, Foreground};
use doomterm_agents::output_activity::OutputActivity;
use doomterm_agents::{claude_usage, git_diff};
use doomterm_plate::DiffStats;
use instant::Instant;
use parking_lot::FairMutex;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use warpui::r#async::{SpawnedFutureHandle, Timer};
use warpui::{Entity, EntityId, ModelContext, SingletonEntity};

use crate::settings::DoomTermUsageSettings;
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

/// Everything known about the program running in one terminal pane.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PaneAgentState {
    /// The pane's foreground program; `None` until probed, or when the OS gave no answer.
    pub foreground: Option<Foreground>,
    /// The agent CLI the foreground program is, if it is one.
    pub agent: Option<CLIAgent>,
    /// What a local agent's own session records report.
    pub report: AgentReport,
    /// Whether the pane's output has been continuous for the last second.
    pub output_continuous: bool,
    /// Uncommitted changes of the repository the pane is working in, when local.
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
    activity: Arc<OutputActivity>,
    state: PaneAgentState,
}

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
}

impl Entity for DoomTermAgentMonitor {
    type Event = DoomTermAgentMonitorEvent;
}

impl SingletonEntity for DoomTermAgentMonitor {}

struct ProbeInput {
    id: EntityId,
    shell: ShellProcessInfo,
}

struct ProbeOutput {
    id: EntityId,
    foreground: Option<Foreground>,
    agent: Option<CLIAgent>,
    report: AgentReport,
    repository: Option<(Option<DiffStats>, Option<String>)>,
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
        }
    }

    /// Starts watching a terminal pane. Panes are forgotten once their model is dropped.
    pub fn track(
        &mut self,
        id: EntityId,
        model: &Arc<FairMutex<TerminalModel>>,
        ctx: &mut ModelContext<Self>,
    ) {
        let activity = model.lock().output_activity().clone();
        self.panes.insert(
            id,
            Pane {
                model: Arc::downgrade(model),
                activity,
                state: PaneAgentState::default(),
            },
        );
        if self.tick.is_none() {
            self.schedule(ctx);
        }
    }

    pub fn state(&self, id: EntityId) -> Option<&PaneAgentState> {
        self.panes.get(&id).map(|pane| &pane.state)
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
        for pane in self.panes.values_mut() {
            let continuous = pane.activity.is_continuous();
            if pane.state.output_continuous != continuous {
                pane.state.output_continuous = continuous;
                changed = true;
            }
        }
        if changed {
            ctx.emit(DoomTermAgentMonitorEvent::Changed);
        }
        if self.panes.values().any(|pane| {
            pane.state.local_agent_working()
                || (pane.state.remote_host().is_some() && pane.state.output_continuous)
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
                let shell = *model.lock().shell_process_info()?;
                Some(ProbeInput { id: *id, shell })
            })
            .collect();
        if inputs.is_empty() {
            return;
        }
        self.probes += 1;
        let with_diff = self.probes.is_multiple_of(DIFF_EVERY) || self.probes == 1;
        let system = self.system.clone();
        let home = dirs::home_dir();
        self.probe_in_flight = true;
        ctx.spawn(
            async move {
                tokio::task::spawn_blocking(move || probe_all(inputs, &system, home, with_diff))
                    .await
                    .unwrap_or_default()
            },
            |me, outputs, ctx| {
                me.probe_in_flight = false;
                me.apply_probe(outputs, ctx);
            },
        );
    }

    fn apply_probe(&mut self, outputs: Vec<ProbeOutput>, ctx: &mut ModelContext<Self>) {
        let mut changed = false;
        for output in outputs {
            let Some(pane) = self.panes.get_mut(&output.id) else {
                continue;
            };
            let mut next = pane.state.clone();
            next.foreground = output.foreground;
            next.agent = output.agent;
            next.report = output.report;
            if let Some((diff, branch)) = output.repository {
                next.diff = diff;
                next.branch = branch;
            }
            if next.remote_host().is_some() {
                // A remote session's repository is not on this machine.
                next.diff = None;
                next.branch = None;
            }
            if next != pane.state {
                pane.state = next;
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
                foreground,
                agent: agent_pid.map(|(agent, _)| agent),
                report,
                repository,
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
