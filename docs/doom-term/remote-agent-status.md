# Remote agent status

Doom Term v1.1.4 accepts context, session usage, and repository diff reports from Claude Code, Codex, and Antigravity (`agy`) running over SSH. Antigravity reports are also accepted from a local `agy` pane. The report travels through the same terminal pane as the agent, so the SSH client can be OpenSSH from Bash, zsh, or Windows PowerShell. Warpify and a shared SSH ControlMaster are not required for this path. The existing Linux/Warpify helper remains a fallback when no in-band report is available.

The status message is `OSC 777;notify;DoomTerm Agent Status;<JSON>BEL`. Its JSON object contains `agent` (`claude`, `codex`, or `agy`), `context` and `usage` (fractions from 0 to 1 or `null`), `working` (boolean or `null`), and `diff` (`added`, `removed`, and `files` counts, or `null`). Doom Term accepts it only while that pane runs an SSH client and a long-running command, or while that pane's foreground program is `agy`. Claude Code and Codex reports expire after 60 seconds without an update or when the SSH command ends; Antigravity reports are described in the Antigravity section. An unknown or unavailable number displays a dash.

## Install the in-band script on the SSH host

The remote host needs Python 3. On Linux or macOS, copy the script from this release to the remote account:

```sh
ssh my-host 'mkdir -p "$HOME/.local/bin" && umask 077 && cat > "$HOME/.local/bin/doomterm-agent-status-in-band" && chmod 700 "$HOME/.local/bin/doomterm-agent-status-in-band"' < script/doomterm/in_band_agent_status.py
```

If you do not have a checkout, download `doomterm-agent-status-in-band.py` and `SHA256SUMS.txt` from the [v1.1.3 release](https://github.com/CMLeadmon/Doom-Term/releases/tag/v1.1.3), verify its SHA-256 entry, and install it as `~/.local/bin/doomterm-agent-status-in-band` on the SSH host. Install the script for each remote account that runs an agent. It sends only the status and diff counts through its own terminal; it makes no network request.

For a Windows SSH host with Python installed, place the downloaded script at a stable path such as `%USERPROFILE%\doomterm-agent-status-in-band.py` and use `python` in the commands below. The script writes to `CONOUT$` on Windows. On Unix it uses `/dev/tty`, or the nearest ancestor's terminal if the status command runs in a detached session. A host without an attached console or TTY cannot send an in-band message.

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

Use the actual absolute path. On a Windows SSH host, use a Windows path and `python`, for example `python C:\\Users\\YOU\\doomterm-agent-status-in-band.py claude`. Merge this entry with existing settings. The script also prints a small context/session line for Claude's own footer. [Claude Code's statusLine input](https://code.claude.com/docs/en/statusline) supplies `context_window.used_percentage`, `workspace.current_dir`, and, for eligible subscriptions on Claude Code v2.1.251 or later, `rate_limits.five_hour.used_percentage`. When the latter is unavailable, Doom Term shows unknown usage. The seven-day percentage is never substituted.

### Codex

In the remote account's user-level `~/.codex/config.toml`, add:

```toml
notify = ["python3", "/home/YOU/.local/bin/doomterm-agent-status-in-band", "codex"]
```

Use the actual absolute path. On a Windows SSH host, use a Windows path and `python`. The notification gives the Codex thread ID and working directory; the script reads that thread's rollout and sends the latest context and the rate-limit entry whose window is 300 minutes to the terminal. [Codex currently invokes `notify` only at turn completion](https://learn.chatgpt.com/docs/config-file/config-advanced), so values update after turns, not every three seconds. Keep any existing `notify` integration by wrapping both commands in your own script; Codex accepts one command array.

The helper runs `git diff --shortstat HEAD` in the agent's current directory to populate the plate's ADD, DEL, and FILES counts. A clean repository reports zero; outside a repository the counts are unavailable. As with local diff counts, untracked files are excluded.

### Antigravity (agy)

Antigravity has its own status line, which runs a command of your choice and passes it a JSON object on stdin. In `agy`, run once on the machine that runs the agent (the SSH host, or your own machine for a local pane):

```
/statusline python3 /home/YOU/.local/bin/doomterm-agent-status-in-band agy
```

Use the actual absolute path; on a Windows host use `python` and a Windows path. `/statusline delete` removes it. The script reads `context_window.used_percentage` for context, `agent_state` for whether a turn is running, and the workspace directory for ADD, DEL, and FILES. For usage it takes `1 − remaining_fraction` of the **five-hour** quota bucket for the model in use: `gemini-5h` for Gemini models and `3p-5h` for third-party models such as Claude and GPT-OSS. The weekly buckets are never substituted; when the five-hour bucket is absent, usage shows a dash. The script also prints a short `Context … 5h …` line for agy's own footer.

Antigravity runs the status line when its state changes, not on a timer. Its context and usage therefore stay on the plate for up to 30 minutes without an update, while its working state is trusted for 60 seconds and then falls back to whether the pane's output is continuous. A local `agy` pane takes its diff from the local repository, as other local panes do.

## Linux/Warpify fallback

The existing `doomterm-agent-status.py` remains available in the release for a Linux SSH host. Install the v1.1.3 script as `~/.local/bin/doomterm-agent-status` using the [v1.1.2 instructions](https://github.com/CMLeadmon/Doom-Term/blob/v1.1.2/docs/doom-term/remote-agent-status.md). Doom Term polls it every three seconds through Warpify's ControlMaster when there is no recent in-band report. The helper requires `/proc` and the Warpified session ID. It reports the remote repository's ADD, DEL, and FILES counts alongside context and five-hour usage. Claude's fallback usage still requires the opt-in **Claude usage lookup** setting; the in-band Claude statusLine does not.

## Limits and removal

An in-band status update occurs only when the agent runs its statusLine or notification command. Codex's `notify` supplies an update after a completed turn; an idle agent may show dashes after 60 seconds. The status message is bound to the receiving pane and never uses a host/session ID lookup. Remote software and settings are installed manually; Doom Term does not change them automatically.

To remove the integration, remove the `statusLine` or `notify` entry and delete the script from the remote host.
