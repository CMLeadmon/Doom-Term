use warpui::AppContext;

use crate::context_chips::ContextChipKind;
use crate::context_chips::display_chip::GitLineChanges;
#[cfg(feature = "warp_services")]
use crate::context_chips::git_line_changes_from_chips;
use crate::terminal::TerminalView;

impl TerminalView {
    fn prompt_chip_value(&self, chip_kind: &ContextChipKind, ctx: &AppContext) -> Option<String> {
        self.current_prompt
            .as_ref(ctx)
            .latest_chip_value(chip_kind, ctx)
            .map(|v| v.to_string())
            .filter(|value| !value.trim().is_empty())
    }

    pub fn display_working_directory(&self, ctx: &AppContext) -> Option<String> {
        let raw = self
            .prompt_chip_value(&ContextChipKind::WorkingDirectory, ctx)
            .or_else(|| self.pwd())?;
        let home_dir = self
            .active_block_session_id()
            .and_then(|session_id| self.sessions.as_ref(ctx).get(session_id))
            .and_then(|session| session.home_dir().map(str::to_owned));
        Some(warp_util::path::user_friendly_path(&raw, home_dir.as_deref()).to_string())
    }

    pub fn terminal_title_from_shell(&self) -> String {
        let model = self.model.lock();
        let fallback_title = model.shell_launch_state().display_name().to_owned();
        model
            .terminal_title()
            .filter(|title| !title.trim().is_empty())
            .unwrap_or(fallback_title)
    }

    #[cfg(feature = "warp_services")]
    pub fn current_git_branch(&self, ctx: &AppContext) -> Option<String> {
        self.prompt_chip_value(&ContextChipKind::ShellGitBranch, ctx)
            .or_else(|| {
                self.git_status_metadata(ctx)
                    .map(|metadata| metadata.current_branch_name.clone())
                    .filter(|branch| !branch.trim().is_empty())
            })
    }

    /// The prompt's git chip, else the branch Doom Term's agent monitor read from the pane's
    /// working directory (a command started before any prompt leaves the chip empty).
    #[cfg(not(feature = "warp_services"))]
    pub fn current_git_branch(&self, ctx: &AppContext) -> Option<String> {
        self.prompt_chip_value(&ContextChipKind::ShellGitBranch, ctx)
            .or_else(|| self.doomterm_pane_state(ctx)?.branch.clone())
    }

    pub fn last_completed_command_text(&self) -> Option<String> {
        let model = self.model.lock();
        model.block_list().blocks().iter().rev().find_map(|block| {
            if block.finished()
                && !block.is_background()
                && !block.is_static()
                && !block.is_hidden()
                && !block.is_in_band_command_block()
                && (block.bootstrap_stage().is_done() || block.is_restored())
            {
                let cmd = block.command_to_string();
                if cmd.trim().is_empty() {
                    None
                } else {
                    Some(cmd)
                }
            } else {
                None
            }
        })
    }

    pub fn terminal_title_text(&self) -> String {
        if !self.terminal_title.trim().is_empty() {
            return self.terminal_title.clone();
        }
        self.terminal_title_from_shell()
    }

    pub fn current_pull_request_url(&self, ctx: &AppContext) -> Option<String> {
        self.current_prompt
            .as_ref(ctx)
            .latest_chip_value(&ContextChipKind::GithubPullRequest, ctx)
            .map(|v| v.to_string())
            .filter(|value| !value.trim().is_empty())
    }

    #[cfg(feature = "warp_services")]
    pub fn current_diff_line_changes(&self, ctx: &AppContext) -> Option<GitLineChanges> {
        // Prefer the externally-updated GitRepoStatusModel (local filesystem
        // watcher or remote daemon push receiver) over parsing the raw shell
        // chip output. This matches the preference order used by the prompt
        // chip display (display.rs) and agent footer (chips.rs).
        let from_model = self
            .git_status_metadata(ctx)
            .map(|metadata| GitLineChanges::from_diff_stats(&metadata.stats_against_head));

        from_model
            .or_else(|| {
                git_line_changes_from_chips(&self.current_prompt.as_ref(ctx).agent_view_chips(ctx))
            })
            .filter(|line_changes| {
                line_changes.files_changed > 0
                    || line_changes.lines_added > 0
                    || line_changes.lines_removed > 0
            })
    }

    /// Uncommitted changes of the pane's repository: sampled locally by Doom Term's agent
    /// monitor, or read from the prompt's diff chip in a remote session.
    #[cfg(not(feature = "warp_services"))]
    pub fn current_diff_line_changes(&self, ctx: &AppContext) -> Option<GitLineChanges> {
        let state = self.doomterm_pane_state(ctx);
        let local = state
            .and_then(|state| state.diff)
            .map(|diff| GitLineChanges {
                files_changed: diff.files,
                lines_added: diff.added,
                lines_removed: diff.removed,
            });
        let remote = state.is_some_and(|state| state.remote_host().is_some());
        let from_chip = || {
            self.current_prompt
                .as_ref(ctx)
                .latest_chip_value(&ContextChipKind::GitDiffStats, ctx)
                .and_then(|value| match value {
                    crate::context_chips::ChipValue::GitDiffStats(changes) => Some(changes),
                    crate::context_chips::ChipValue::Text(raw) => {
                        GitLineChanges::parse_from_git_output(&raw)
                    }
                    crate::context_chips::ChipValue::GitBranchStatus(_) => None,
                })
        };
        if remote { from_chip() } else { local }
    }

    /// Context-window fill and rate-limit use from the active local or remote agent's records.
    #[cfg(not(feature = "warp_services"))]
    pub fn doomterm_context_usage(&self, ctx: &AppContext) -> (Option<f32>, Option<f32>) {
        use warpui::SingletonEntity as _;

        use crate::doomterm::agent_monitor::DoomTermAgentMonitor;
        use crate::settings::DoomTermUsageSettings;

        let Some(state) = self.doomterm_pane_state(ctx) else {
            return (None, None);
        };
        let Some(agent) = state.local_agent().or(state.remote_agent) else {
            return (None, None);
        };
        let remote_claude_opted_out = !state.in_band
            && state.remote_agent == Some(crate::terminal::CLIAgent::Claude)
            && !*DoomTermUsageSettings::as_ref(ctx).claude_usage_lookup_enabled;
        let usage = state
            .report
            .usage
            .filter(|_| !remote_claude_opted_out)
            .or_else(|| {
                (state.remote_agent.is_none() && agent == crate::terminal::CLIAgent::Claude)
                    .then(|| DoomTermAgentMonitor::as_ref(ctx).claude_usage())
                    .flatten()
            });
        (state.report.context, usage)
    }
}
