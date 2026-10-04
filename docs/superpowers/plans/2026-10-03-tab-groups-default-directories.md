# Persistent tab groups implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` for inline implementation,
> or `superpowers:subagent-driven-development` if the user selects delegated execution.
> Track each task below and complete the final verification before opening the PR.

**Goal:** Restore shell selection and groups, preserve empty groups across restarts, and
apply group local/SSH directories to new terminal tabs and splits.

**Architecture:** Extend Warp's existing group and shell model. Add a serializable typed
directory configuration, integrate it at terminal creation, and persist empty-group
anchors and defaults through snapshots, SQLite, and launch configurations. Use the
terminal's existing pending-command queue for interactive SSH startup.

**Tech stack:** Rust, WarpUI, Diesel/SQLite, OpenSSH, Python verification tooling,
Ubuntu 24.04 Podman build and GUI verification containers.

**Spec:** `docs/superpowers/specs/2026-10-03-tab-groups-default-directories-design.md`

## Global constraints

- Work in `.worktrees/tab-groups-default-directories`, branch `feat/tab-groups-default-directories`, based on `origin/main`.
- Hosted services remain compile-excluded from the Doom Term binary.
- Existing sessions and launch configurations remain readable with absent defaults.
- Credentials do not enter the repository, evidence report, or PR.
- Run focused tests, targeted lint/build checks, then applicable formatters once.
- Deliver a PR against Doom Term's `main` and evidence at localhost port 8085.

## Review focus

- A new pane in an explicitly targeted group must not inherit another active group's default.
- Removing a group's last member must leave a reachable header before and after restart.
- Remote paths containing spaces, quotes, or shell syntax must remain literal arguments.
- Clearing/changing a default must leave existing panes alone and update later tabs/splits.
- Failed local/remote directory changes must be visible rather than silently use another path.

### Task 1: Directory configuration and safe command construction

**Files:** Create `app/src/workspace/group_directory.rs` and `group_directory_tests.rs`;
register the module in `app/src/workspace/mod.rs`.

**Interfaces:** Produce `GroupDirectory` (`Local` and `Ssh` variants), serialization,
validation, local-path resolution, and `startup_command(&self, shell: CommandShell) -> Result<Option<String>, String>`.
SSH fields are host, optional username/port, and directory. No password field.

- [x] Eight focused Rust tests import the production module and cover local/home validation, SSH parameters, serialization, remote failures and actual sh/Fish parsing.
- [x] Typed configuration and shell-aware command construction are implemented; strict module Clippy passes.

### Task 2: Empty-group lifecycle, rendering, and storage

**Files:** Modify `app/src/workspace/tab_group.rs`, `app/src/workspace/view.rs`,
`app/src/workspace/view/vertical_tabs.rs`, `app/src/app_state.rs`,
`app/src/persistence/sqlite.rs`, `crates/persistence/src/{model,schema}.rs`,
`app/src/launch_configs/launch_config.rs`; add an additive migration under
`crates/persistence/migrations/2026-10-03-000000_tab_group_defaults/`.

**Interfaces:** Add optional `default_directory: Option<GroupDirectory>` and a stored
empty-group display anchor to group/snapshot/template/database forms. Produce group
slots with `run_len == 0` for retained empty groups. Keep ordinary tab indices valid.

- [x] The additive migration passes three old-row/empty-group/up-down checks.
- [x] Doom Term retains empty groups in snapshots and SQLite, including identity, color, directory and display anchor.
- [x] Both tab presentations show operable empty groups; native restart checks verify restoration and explicit deletion.
- [x] Launch configuration fields and existing fixtures are updated with optional/default-compatible fields. Their app test targets are not runnable in the Doom Term feature set.

### Task 3: Default application to new terminal tabs and splits

**Files:** Modify `app/src/workspace/view/startup_directory.rs`,
`app/src/workspace/view.rs`, `app/src/pane_group/mod.rs`; extend relevant
`view_tests.rs`/`mod_tests.rs` regression coverage.

**Interfaces:** Extend `NewTerminalOptions` with group startup configuration where needed.
Resolve the group before terminal creation, including `new_tab_in_group`; pass the
group directory to split creation. Queue SSH startup through
`TerminalView::set_pending_command_queue` after creating the local terminal.

- [x] Destination-group configuration is resolved before new tabs and propagated to split creation and membership changes.
- [x] Native PTY checks verify local precedence for new tabs, existing-pane splits and moved-tab splits.
- [x] Real authorized SSH password authentication and remote pwd are verified in new tabs and splits.
- [x] Startup command generation waits for the actual bootstrapped shell type; failures are visible and credentials remain interactive.

### Task 4: Shell menu and group directory editor

**Files:** Modify `app/src/features.rs`, `app/src/workspace/view.rs`,
`app/src/workspace/action.rs` (locate the existing action declaration),
`script/doomterm/test_runtime_flags.py`; create
`app/src/workspace/view/group_directory_editor.rs` using existing modal/input widgets.

**Interfaces:** Enable `GroupedTabs` and `ShellSelector`; list available supported shells
on every desktop OS in the `+` menu. Add a group editor action and a typed save event
carrying `Option<GroupDirectory>` back to the workspace.

- [x] GroupedTabs and ShellSelector are enabled; all three runtime allowlist tests pass.
- [x] The + menu launches discovered shells; Bash, Zsh and Fish were verified in the real GUI.
- [x] The group editor supports None/Local/SSH, validation, Save/Clear/Cancel, and empty-group actions.
- [x] Manual GUI checks verify invalid/removed directories, clearing defaults and existing-session preservation.

### Task 5: Real application verification, evidence, and PR

**Files:** Create `evidence.html`, `evidence/tab-groups/` artifacts, and reproducible
verification tooling under `script/doomterm/` where needed. Update affected policy
inventory entries and user-facing documentation.

**Interfaces:** Serve the worktree's report via a loopback HTTP server on port 8085;
link publishable report/artifacts and validation results from the PR.

- [x] Production GUI build passes with `--no-default-features --features doomterm,gui` in the supported Ubuntu container.
- [x] Native GUI and remote verification produce real screenshots, recordings and machine-readable results.
- [x] Focused tests, product boundary checks and targeted Clippy pass. Strict app Clippy is compared with main's 60-error baseline.
- [x] Independent review findings are resolved, including pending-shell timing, membership default synchronization, empty anchors and destination menus.
- [x] The repository formatter ran after the final build/lint and native GUI checks; implementation is ready to commit.
- [x] Evidence report is assembled and browser-checked at desktop/mobile sizes; localhost:8085 is serving the report.
- [x] [PR #11](https://github.com/CMLeadmon/Doom-Term/pull/11) is open against main from the feature worktree.

## Execution adjustment

The existing app test target depends on hosted-service modules excluded by Doom Term.
Instead of claiming those unbuildable test targets passed, the production directory module
is imported into a small isolated Rust test crate, the actual SQLite migration is tested
with Python, and a repeatable native GUI runner checks the real app's PTYs and database.
The automated GUI runner covers group creation, tabs/splits, closing all members, restart,
moving into an empty group, removing its final member, reopening it, last-terminal closure,
and explicit deletion. Manual verification expands coverage to the vertical sidebar,
shell choices, editor validation/clear, colors/position, ungrouping and authenticated SSH.

Native Windows/macOS/WSL execution is unavailable locally. Existing PR CI builds on all
three desktop platforms; PowerShell command construction has unit coverage. No full
presubmit or broad workspace test pass is claimed.
