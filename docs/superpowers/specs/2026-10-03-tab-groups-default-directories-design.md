# Persistent tab groups and default directories

## Intended outcome

Doom Term's desktop terminal restores Warp-style tab groups and installed-shell selection
through the `+` menu. A group remains visible and usable after its last terminal closes and
after Doom Term restarts. Each group can specify a local or SSH working directory, applied
to both new tabs and split terminal panes rather than inheriting a pane's current directory.

Success is a verified implementation, a pull request against `CMLeadmon/Doom-Term:main`,
and an `evidence.html` report served at `http://localhost:8085/evidence.html`, with real
application screenshots, recordings where feasible, and test/build results.

The user confirmed installed shells and WSL distributions, persistence across restarts,
directory precedence for tabs and splits, and separate SSH connection fields. They supplied
a host for interactive verification. Credentials and identifying test connection details are
not part of the committed specification, report, or PR.

## Approach

Extend the existing Warp implementations: `TabGroup`, group actions and renderers,
`AvailableShells`, session snapshots, SQLite persistence, and terminal launch options.
Enable the existing local `GroupedTabs` and `ShellSelector` features for Doom Term.

A separate group subsystem would duplicate existing actions and persistence. Implementing
SSH as a local directory string would blur local and remote filesystems and make validation
and shell quoting unreliable. Use a typed group-directory configuration instead.

Preserve Warp's current behavior where the fork-specific change can be scoped to Doom Term;
keep shared persisted fields backward-compatible and absent by default in existing sessions.
Hosted services remain compile-excluded from the Doom Term binary.

## User interface

The `+` menu provides the default terminal, available supported installed shells, and
`New Tab Group`. Discover shells through the existing platform model, including WSL
distributions on Windows. Selecting a shell launches that shell in Doom Term.

Retain the existing group name, color, collapse/expand, and tab membership controls. Add
a group context-menu action for editing its default directory. The editor supports:

- No default: existing session-directory behavior.
- Local: a filesystem directory.
- SSH: host, optional username, optional port, and remote directory.

The editor can save, clear, or cancel. Show validation errors without closing the editor.
Changes affect subsequently created terminal panes, leaving running panes intact.
Reuse WarpUI input and modal conventions and existing theme colors.

An empty group still has a header, its existing context menu, and a way to create a terminal
inside it. Creating a pane explicitly in an empty group uses that group's configuration
even if another group or an ungrouped terminal is active. Group deletion is explicit.

## Group lifecycle and persistence

Closing, moving, or ungrouping the last member does not delete the group in Doom Term.
Save empty groups rather than filtering them out of the window snapshot. Restore them
before restoring per-tab membership. Preserve their names, colors, collapse state, and
directory configuration.

Render empty groups in both vertical and horizontal tab presentations, using deterministic
group placement. Retain a display anchor for an empty group rather than deriving all group
positions solely from live member tabs. Preserve existing contiguous membership rules for
nonempty groups. Empty groups remain operable when there are no grouped terminal tabs.
The existing last-terminal/window-close behavior may close a window, but saved empty groups
must survive the application's normal session restoration.

Persist directory configuration and empty-group placement through an additive SQLite
migration and the session snapshot model. Existing databases restore with no group default.
Carry these optional fields through existing launch-configuration export/import so saving
a session does not silently discard its groups or defaults. Hand-authored older launch
configurations continue to work.

## Directory precedence and pane creation

Resolve the destination group before starting the terminal. A configured group default
overrides inherited working-directory and global startup-directory settings for new
terminal tabs and splits created inside that group. An unconfigured or ungrouped terminal
keeps existing behavior. Respect explicit group targeting rather than reading only the
currently active tab after insertion.

For local defaults, launch the chosen shell with that directory as its working directory.
Support normal platform-native absolute paths and user-home notation. Reject invalid
local directories in the editor with a useful message. A directory removed after saving
must produce an understandable failure rather than silently launching elsewhere.

For SSH defaults, launch a local terminal and execute a safely constructed `ssh` command
in its PTY. Request a remote terminal, change to the configured remote directory, and
start an interactive remote shell. Keep SSH host-key confirmation and password/key
authentication interactive. Respect the user's OpenSSH configuration and aliases.

Store only connection and directory configuration. Do not provide a password field or
persist passwords. Quote both local-shell and remote-shell command arguments, including
paths with spaces and quotes, and validate host/user/port input so it cannot introduce
options or executable command text. Treat remote paths as remote paths; do not check
their existence on the local computer.

Connection or remote-directory failures remain visible in the new terminal. A failed
remote `cd` must not quietly open a shell in an unintended directory. Disconnecting returns
control to the local terminal and does not remove the group.

## Verification and evidence

Use focused tests for group retention after closing/moving/ungrouping the last member,
empty-group rendering and restore, explicit deletion, and destination-group resolution.
Test SQLite and launch-config round trips with empty groups and both directory types.
Test local-directory precedence for tabs and splits and safely generated SSH commands,
including special characters, invalid inputs, and port handling.

Build the actual Doom Term feature configuration in its supported Linux build container.
Run relevant tests, targeted lint/build checks, policy checks affected by the allowlist,
and format in the repository's prescribed order. Use available cross-platform runners or
CI for Windows shell discovery/WSL and macOS compatibility; report unverified platforms.

Capture real UI evidence for the `+` menu, available-shell launch, group creation and
editing, keeping an empty group, restart restoration, local `pwd` in both a new tab and
a split, and SSH authentication followed by remote `pwd` in both cases. Use an isolated
application profile and temporary test directories. Remote verification is limited to
non-destructive commands and temporary fixtures needed for the checks.

The report includes the tested revision, commands/results, screenshots, recordings,
and any limitations. Do not present mockups as implementation evidence. Redact credentials
and private test-host details from publishable captures and logs. Serve the report on
loopback port 8085 and include its artifact path and verification summary in the PR.

## Scope

This is a desktop GUI change, using the shared core where required. Separate terminal
applications, SSH credential management, remote file browsing, and changes to Warp's
headless TUI are outside the requested behavior.
