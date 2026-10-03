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
validation, local-path resolution, and `startup_command(&self) -> Result<Option<String>, String>`.
SSH fields are host, optional username/port, and directory. No password field.

- [ ] Write tests for local/home paths, invalid host/user/port inputs, SSH quoting, and remote `cd` failure behavior.
- [ ] Run the smallest executable tests and observe the missing implementation failure.
- [ ] Implement the typed configuration and quote local and remote command arguments for supported shells.
- [ ] Run the tests and confirm passing results; checkpoint the changes.

### Task 2: Empty-group lifecycle, rendering, and storage

**Files:** Modify `app/src/workspace/tab_group.rs`, `app/src/workspace/view.rs`,
`app/src/workspace/view/vertical_tabs.rs`, `app/src/app_state.rs`,
`app/src/persistence/sqlite.rs`, `crates/persistence/src/{model,schema}.rs`,
`app/src/launch_configs/launch_config.rs`; add an additive migration under
`crates/persistence/migrations/2026-10-03-000000_tab_group_defaults/`.

**Interfaces:** Add optional `default_directory: Option<GroupDirectory>` and a stored
empty-group display anchor to group/snapshot/template/database forms. Produce group
slots with `run_len == 0` for retained empty groups. Keep ordinary tab indices valid.

- [ ] Add regression tests for last-member close/move/ungroup, empty slots, explicit deletion, and local/SSH snapshot round trips.
- [ ] Observe failures on the old pruning/rendering/storage behavior.
- [ ] Retain groups in Doom Term, render empty headers, and save/restore configuration and placement.
- [ ] Preserve empty groups/defaults through launch-config import/export and old databases.
- [ ] Run affected lifecycle, migration, and serialization tests; checkpoint the changes.

### Task 3: Default application to new terminal tabs and splits

**Files:** Modify `app/src/workspace/view/startup_directory.rs`,
`app/src/workspace/view.rs`, `app/src/pane_group/mod.rs`; extend relevant
`view_tests.rs`/`mod_tests.rs` regression coverage.

**Interfaces:** Extend `NewTerminalOptions` with group startup configuration where needed.
Resolve the group before terminal creation, including `new_tab_in_group`; pass the
group directory to split creation. Queue SSH startup through
`TerminalView::set_pending_command_queue` after creating the local terminal.

- [ ] Add precedence tests for active and explicitly targeted groups, selected-shell tabs, splits, cleared defaults, and removed local directories.
- [ ] Observe the inherited-directory behavior failing these tests.
- [ ] Apply local defaults at shell creation and SSH commands in the new terminal's PTY.
- [ ] Keep password and host-key handling interactive; propagate failure text without an unintended remote shell.
- [ ] Run the focused tests and build the Doom Term binary; checkpoint the changes.

### Task 4: Shell menu and group directory editor

**Files:** Modify `app/src/features.rs`, `app/src/workspace/view.rs`,
`app/src/workspace/action.rs` (locate the existing action declaration),
`script/doomterm/test_runtime_flags.py`; create
`app/src/workspace/view/group_directory_editor.rs` using existing modal/input widgets.

**Interfaces:** Enable `GroupedTabs` and `ShellSelector`; list available supported shells
on every desktop OS in the `+` menu. Add a group editor action and a typed save event
carrying `Option<GroupDirectory>` back to the workspace.

- [ ] Add acceptance checks for both enabled flags and installed-shell menu actions.
- [ ] Observe the disabled feature/menu checks failing before implementation.
- [ ] Restore the menu entries and provide None/Local/SSH editing, validation, Save/Clear/Cancel, and an empty-group new-terminal action.
- [ ] Verify existing panes remain unchanged after editing and later panes use the new value.
- [ ] Run focused policy/UI checks; checkpoint the changes.

### Task 5: Real application verification, evidence, and PR

**Files:** Create `evidence.html`, `evidence/tab-groups/` artifacts, and reproducible
verification tooling under `script/doomterm/` where needed. Update affected policy
inventory entries and user-facing documentation.

**Interfaces:** Serve the worktree's report via a loopback HTTP server on port 8085;
link publishable report/artifacts and validation results from the PR.

- [ ] Build with `--no-default-features --features doomterm,gui` in the supported container, using cached dependencies.
- [ ] Drive the real GUI in an isolated profile; capture shell choice, group creation/settings, last-member close, empty-group restart, local tab/split `pwd`, and SSH tab/split authentication and `pwd`.
- [ ] Capture screenshots and recordings; redact private connection details and exclude credentials.
- [ ] Run affected tests and Clippy/build/policy checks, fixing failures before formatting.
- [ ] Use available cross-platform verification/CI and document platform limitations.
- [ ] Review the whole branch, fix material findings, run applicable formatters, and commit.
- [ ] Start the evidence server, verify the report/assets load, push the feature branch, and open the PR against `main` with the repository template.
