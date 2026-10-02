# Remote agent status

Doom Term v1.1.5 accepts context, session usage, and repository diff reports from Claude Code, Codex, and Antigravity (`agy`) running over SSH. Antigravity reports are also accepted from a local `agy` pane. The report travels through the same terminal pane as the agent, so the SSH client can be OpenSSH from Bash, zsh, or Windows PowerShell. Warpify and a shared SSH ControlMaster are not required for this path. The existing Linux/Warpify helper remains a fallback when no in-band report is available.

The status message is `OSC 777;notify;DoomTerm Agent Status;<JSON>BEL`. Its JSON object contains `agent` (`claude`, `codex`, or `agy`), `context` and `usage` (fractions from 0 to 1 or `null`), `working` (boolean or `null`), and `diff` (`added`, `removed`, and `files` counts, or `null`). Two optional fields let the plate stay accurate without expiring readings: `usage_resets_at` (the Unix time at which the usage window resets) and `session` (a number that identifies the agent's conversation, so `/clear` or a new thread starts afresh). Doom Term accepts it only while that pane runs an SSH client and a long-running command, or while that pane's foreground program is `agy`. A report stays on the plate until the SSH command ends, the pane reports a different agent or conversation, or, for usage, the window it describes resets; a report that nothing has refreshed for six hours is dropped. Its turn state (working or idle) is trusted for 60 seconds after the update, then the plate falls back to whether the pane's output is continuous. An unknown or unavailable number displays a dash.

## Install the in-band script on the SSH host

The remote host needs Python 3.6 or newer. On Linux or macOS, copy the script from this release to the remote account:

```sh
ssh my-host 'mkdir -p "$HOME/.local/bin" && umask 077 && cat > "$HOME/.local/bin/doomterm-agent-status-in-band" && chmod 700 "$HOME/.local/bin/doomterm-agent-status-in-band"' < script/doomterm/in_band_agent_status.py
```

If you do not have a checkout, download `doomterm-agent-status-in-band.py` and `SHA256SUMS.txt` from the [v1.1.5 release](https://github.com/CMLeadmon/Doom-Term/releases/tag/v1.1.5), verify its SHA-256 entry, and install it as `~/.local/bin/doomterm-agent-status-in-band` on the SSH host. Install the script for each remote account that runs an agent. It sends only the status and diff counts through its own terminal; it makes no network request.

For a Windows SSH host with Python installed, place the downloaded script at a stable path such as `%USERPROFILE%\doomterm-agent-status-in-band.py` and use `python` in the commands below. The script writes to `CONOUT$` on Windows. On Unix it uses `/dev/tty`, or the nearest ancestor's terminal if the status command runs in a detached session. A host without an attached console or TTY cannot send an in-band message. The terminal must also be writable by the account running the agent. The helper never uses an inherited `SSH_TTY` to guess a destination: a shared daemon can retain another client's old terminal, which would break pane isolation.

### Claude Code

Add a `statusLine` command in the remote account's Claude Code `settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "python3 /home/YOU/.local/bin/doomterm-agent-status-in-band claude"
  }
}
```

Use the actual absolute path. On a Windows SSH host, use `python` and a path with forward slashes, for example `python C:/Users/YOU/doomterm-agent-status-in-band.py claude`: Claude Code runs status lines through Git Bash when it is installed, and Git Bash drops unquoted backslashes. Merge this entry with existing settings. The script prints nothing for Claude's own status bar, so Context and Session usage appear only on the Doom Term plate. [Claude Code's statusLine input](https://code.claude.com/docs/en/statusline) supplies `context_window.used_percentage`, `workspace.current_dir`, and, for claude.ai Pro and Max subscribers once the session's first response has arrived, `rate_limits.five_hour.used_percentage` with its `resets_at`. Claude Code drops a window from the input once it resets. When usage is unavailable, Doom Term shows unknown usage. The seven-day percentage is never substituted.

Restart Claude after adding or changing the status line so the running process loads it. An existing process may predate the setup even when the file is correct.

Claude Code runs the status line when a message arrives, when a rate-limit window resets, and on a few other events, and it goes quiet while a session is idle; Doom Term keeps the last report for exactly that reason. Setting `"refreshInterval": 60` (seconds, minimum 1) in the `statusLine` entry makes Claude Code re-run the command on a timer as well. That is optional.

### Codex

In the remote account's user-level `~/.codex/config.toml`, add:

```toml
notify = ["python3", "/home/YOU/.local/bin/doomterm-agent-status-in-band", "codex"]
```

Use the actual absolute path. On a Windows SSH host, use a Windows path and `python`. The notification gives the Codex thread ID and working directory; the script reads that thread's rollout and sends the latest context and the rate-limit entry whose window is 300 minutes to the terminal. [Codex currently invokes `notify` only at turn completion](https://learn.chatgpt.com/docs/config-file/config-advanced), so values update after turns, not every three seconds, and stay on the plate while the session is idle. Keep any existing `notify` integration by wrapping both commands in your own script; Codex accepts one command array.

#### Codex 0.160.0 shared-daemon limitation

On the Linux setup investigated in [Issue #9](https://github.com/CMLeadmon/Doom-Term/issues/9), the interactive Codex UI had an SSH terminal, but the notification process ran beneath the detached shared app-server. Neither it nor its ancestors had a terminal. The rollout still contained valid context and five-hour usage. Installing the hook, seeing parsed values, or getting exit code zero did not establish delivery.

Use an attached session on the SSH host:

```sh
codex --no-daemon
```

Save work and record which conversation you intend to recover before restarting. To select the intended saved conversation, use the picker with `codex resume --no-daemon`; do not assume `resume --last` chooses it when multiple conversations exist. If Codex requires a fork, use `codex fork --no-daemon` and select that conversation. A fork preserves the original history and creates a new thread; the helper reads the new thread's own rollout and reports a different session identity. An exact resume is not guaranteed. Verify delivery again after recovery and a completed turn.

The helper refuses delivery when it detects Linux shared-daemon ancestry (`shared_daemon`), even if a terminal is still inherited from the first client: that terminal cannot reliably identify the active client pane. A daemon with no terminal ancestry cannot report through this route either. A future relay would need to bind each conversation to its active client pane across forks, multiple clients and reconnects. Pointing it at a daemon's inherited `SSH_TTY`, or an arbitrary writable terminal, does not provide that binding. No relay is installed by this helper.

The helper runs `git diff --shortstat HEAD` in the agent's current directory to populate the plate's ADD, DEL, and FILES counts. A clean repository reports zero; outside a repository the counts are unavailable. As with local diff counts, untracked files are excluded.

### Antigravity (agy)

Antigravity has its own status line, which runs a command of your choice and passes it a JSON object on stdin. In `agy`, run once on the machine that runs the agent (the SSH host, or your own machine for a local pane):

```
/statusline python3 /home/YOU/.local/bin/doomterm-agent-status-in-band agy
```

Use the actual absolute path; on a Windows host use `python` and a Windows path. `/statusline delete` removes it. The script reads `context_window.used_percentage` for context, `agent_state` for whether a turn is running (`thinking`, `tool_use`, and `working` count as working, `idle` as idle, and `initializing` as unknown), and the workspace directory for ADD, DEL, and FILES. For usage it takes `1 − remaining_fraction` of the **five-hour** quota bucket for the model in use: `gemini-5h` for Gemini models and `3p-5h` for third-party models such as Claude and GPT-OSS. The weekly buckets are never substituted; when the five-hour bucket is absent, usage shows a dash. The script also prints a short `Context … 5h …` line for agy's own footer.

After changing the command, explicitly reload it with `/statusline` in the current session or restart agy. If a saved command is disabled, use `/statusline enable`. For agy 1.2.14, the persisted command and `enabled` flag live in `~/.gemini/antigravity-cli/settings.json`; the setup check reads that file by default. A printed agy footer confirms the status command ran, but does not prove an OSC reached Doom Term. The same detached-process and SSH-terminal permission limits apply to agy and Claude. A malformed or nonfinite quota reset remains unknown without discarding valid usage. A model object containing only an effort setting cannot select a quota bucket; the helper uses the model ID/display name.

Antigravity runs the status line when its state changes, not on a timer. Its context and usage therefore stay on the plate until the conversation changes or the quota window resets, while its working state is trusted for 60 seconds and then falls back to whether the pane's output is continuous. A local `agy` pane takes its diff from the local repository, as other local panes do.

## Verify setup and actual delivery

The following commands require the updated helper from this checkout (helper version `3`), rather than the older v1.1.5/v1.1.6 download. Install the current script using the copy command above. It remains a single, dependency-free Python 3.6+ file; TOML configuration inspection additionally requires Python 3.11+. On older Python, the Codex configuration check is explicitly unverified and `--diagnose` still works.

Run the read-only check **inside the intended SSH session**, as the same account that runs the agent:

```sh
python3 ~/.local/bin/doomterm-agent-status-in-band check codex
python3 ~/.local/bin/doomterm-agent-status-in-band check claude
python3 ~/.local/bin/doomterm-agent-status-in-band check agy
```

The check prints JSON describing the Python version, helper version and SHA-256, configuration, this process's Codex daemon ancestry, terminal open, optional payload parsing, reload requirements and client receipt. It returns `1` when any check fails and `0` when the inspected checks have no failure. `status: "incomplete"` and `unverified` entries mean that runtime loading or receipt still needs confirmation; zero is not an end-to-end success claim. A shell check observes the shell's route, which may differ from a daemon's hook route. Non-Linux daemon ancestry is marked unverified. The check makes no network request, writes no OSC, and never runs or overwrites configured commands.

Options:

```sh
# Select a non-default configuration file, without modifying it.
python3 ~/.local/bin/doomterm-agent-status-in-band check agy --config /absolute/path/settings.json

# Check a captured status-line payload from the intended agent/session.
python3 ~/.local/bin/doomterm-agent-status-in-band check agy --payload /absolute/path/statusline.json

# Verify the installed helper against the SHA-256 of the script you copied.
python3 ~/.local/bin/doomterm-agent-status-in-band check claude --expected-sha256 YOUR_VERIFIED_SHA256
```

For Codex, `--payload` takes a captured `agent-turn-complete` notification object and reads only its selected thread's rollout under `CODEX_HOME` (default `~/.codex`). A JSON file containing no available measurements remains unverified, rather than inventing context or quota. Unknown values stay `null`; weekly quota is never substituted. A direct command found on disk does not establish that its interpreter/path works or its running process loaded it. Wrapped/custom hooks are marked unverified: preserve the wrapper and verify it explicitly.

To test **the actual hook process**, temporarily add `--diagnose` to the configured helper invocation, preserving any existing wrapper. Examples of the command portion:

```sh
python3 /home/YOU/.local/bin/doomterm-agent-status-in-band claude --diagnose
python3 /home/YOU/.local/bin/doomterm-agent-status-in-band agy --diagnose
```

For Codex, include `"--diagnose"` after `"codex"` in the `notify` array; Codex appends the notification argument. Restart/reload the agent after configuring it. Capture the helper's stderr in a private local file if the agent hides it, complete a turn, and inspect the diagnostic JSON. Keep captured agent input private; it can contain conversation content. Remove `--diagnose` after troubleshooting.

Diagnostic mode sends the same pane-bound report and retains agy's stdout footer (Claude's status bar stays empty), but prints parsed values, each failed terminal attempt and its errno, the final delivery reason, and actionable advice to stderr. It returns `1` for failed delivery or an unmatched Codex notification, and `0` only after a complete terminal write. Normal hooks deliberately remain quiet and return zero for unavailable telemetry so a reporting failure does not interfere with the agent; agy's footer and every normal hook's exit code are not verification. Invalid Codex notifications are ignored in normal mode and explained by diagnostic mode.

Delivery reasons include `no_controlling_terminal` for a failed `/dev/tty` attempt, `no_ancestor_terminal` when no fallback exists, `permission_denied`, `open_failed`, `not_terminal` for a rejected candidate, `write_failed`, and `shared_daemon` when a shared Codex server cannot safely select the client pane. On Linux, when a terminal is refused by name but an ancestor of the helper already holds it open, the helper writes through that ancestor's descriptor (`pidfd_getfd`) and the result carries `"via": "ancestor_descriptor"`; it uses the descriptor only if it is the same device, and a refusal is recorded as a `borrow_failed` attempt that leaves the reason `permission_denied`. After identifying a terminal, an open failure stops the route rather than searching farther ancestors that may belong to another pane. Short writes are completed on the selected terminal; a write failure is never retried on another terminal after a possible partial OSC.

### Check SSH-terminal ownership

In the affected SSH session:

```sh
status_tty=$(tty) || exit 1
id
ls -l "$status_tty"
if test -w "$status_tty"; then
  printf 'TTY is writable by this account\n'
else
  printf 'TTY is not writable by this account\n'
fi
```

If the login user's terminal is owned by root with mode `0600`, the agent cannot reopen it by name; Tailscale SSH sessions on one Linux host were observed this way. On Linux the helper still reaches such a terminal through its ancestor's open descriptor, which needs kernel 5.6 or newer and `kernel.yama.ptrace_scope` set to `0` (check with `cat /proc/sys/kernel/yama/ptrace_scope`; `1` or higher refuses it). Where that is refused, or on another platform, ask the host administrator to investigate that session's SSH/PAM and terminal-device setup, restore the expected ownership/access for that particular session, and reconnect. This is a host/session configuration condition; these findings do not establish that Doom Term created it. Do not run status hooks under sudo, make every terminal writable, or apply blanket ownership/permission changes. The open result from `check`/`--diagnose` is stronger evidence than `test -w` alone.

### Confirm the intended pane receives the report

Keep the intended agent running in its SSH pane and complete a turn (Codex reports at turn completion). Compare Context and five-hour Usage on the Doom Term plate with the diagnostic report from that turn; unavailable usage should show a dash. Switch to another pane to check that it does not acquire this report, then return. Start or fork another conversation and confirm its own session/measurements appear. After disconnect/reconnect, repeat verification in the new pane.

A writable terminal and `delivery.delivered: true` establish sending only. There is no client acknowledgement protocol in this helper: `client_receipt` remains `unverified` until the plate is directly observed or captured in client trace evidence. A fixture PTY test cannot establish the deployed SSH session's permissions or live client rendering. Test daemon and `--no-daemon` Codex modes separately, and distinguish fixture reports from actual Claude/agy hook input.

## Linux/Warpify fallback

The existing `doomterm-agent-status.py` remains available in the release for a Linux SSH host. Install the v1.1.5 script as `~/.local/bin/doomterm-agent-status` using the [v1.1.2 instructions](https://github.com/CMLeadmon/Doom-Term/blob/v1.1.2/docs/doom-term/remote-agent-status.md). Doom Term polls it every three seconds through Warpify's ControlMaster when there is no recent in-band report. The helper requires `/proc` and the Warpified session ID. It reports the remote repository's ADD, DEL, and FILES counts alongside context and five-hour usage. Claude's fallback usage still requires the opt-in **Claude usage lookup** setting; the in-band Claude statusLine does not.

## Limits and removal

An in-band status update occurs only when the agent runs its statusLine or notification command; the plate keeps the last report between updates. If an agent exits inside an SSH session that stays open, its last numbers stay until that session ends or another report arrives. The status message is bound to the receiving pane and never uses a host/session ID lookup. Remote software and settings are installed manually; Doom Term does not change them automatically.

To remove the integration, remove the `statusLine` or `notify` entry and delete the script from the remote host.
