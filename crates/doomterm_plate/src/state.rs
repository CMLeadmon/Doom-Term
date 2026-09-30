//! Presentation state observed and displayed by the status plate.

use serde::{Deserialize, Serialize};

/// What the active pane is running, as far as it can be verified.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlateKind {
    /// A shell, or a pane whose foreground program is not a known agent.
    #[default]
    Shell,
    /// A known agent CLI is the pane's foreground program.
    Agent,
    /// The pane's foreground program is a remote client (ssh, mosh, …).
    Remote,
}

impl PlateKind {
    /// The label printed beside the name in the middle panel.
    pub fn label(self) -> &'static str {
        match self {
            PlateKind::Shell => "SHELL",
            PlateKind::Agent => "AGENT",
            PlateKind::Remote => "REMOTE",
        }
    }
}

/// Why another session is listed in the waiting well.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum WaitStatus {
    /// The agent is producing work right now.
    Working,
    /// The agent finished its turn and is waiting for the user.
    NeedsInput,
    /// The agent's last command exited with a failure.
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WaitingSession {
    /// One-based position in the visible agent queue.
    pub n: String,
    /// The waiting pane's name, as returned by [`pane_name`].
    pub name: String,
    pub status: WaitStatus,
}

/// Uncommitted line changes in the active pane's repository.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffStats {
    pub added: u32,
    pub removed: u32,
    pub files: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PlateState {
    /// Fraction of the agent's context window in use, when the agent reports it.
    pub context: Option<f32>,
    /// Fraction of the provider's five-hour session rate-limit window consumed, when known.
    pub usage: Option<f32>,
    /// Key selecting the agent mark (`claude`, `codex`, `shell`, …).
    pub agent: String,
    pub kind: PlateKind,
    /// The pane's name: the user's tab title, else the agent's name, else the shell title.
    pub name: Option<String>,
    pub path: Option<String>,
    pub branch: Option<String>,
    pub diff: Option<DiffStats>,
    pub waiting: Vec<WaitingSession>,
    /// Position in the working pulse cycle, in `0.0..1.0`.
    pub phase: f32,
    pub working: bool,
}

impl Default for PlateState {
    fn default() -> Self {
        Self {
            context: None,
            usage: None,
            agent: "shell".into(),
            kind: PlateKind::Shell,
            name: None,
            path: None,
            branch: None,
            diff: None,
            waiting: Vec::new(),
            phase: 0.0,
            working: false,
        }
    }
}

/// The name shown for a pane: the name its user gave it, else the title its terminal set.
pub fn pane_name(custom: Option<&str>, title: &str) -> Option<String> {
    [custom.unwrap_or_default(), title]
        .into_iter()
        .map(str::trim)
        .find(|name| !name.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
#[path = "state_tests.rs"]
mod tests;
