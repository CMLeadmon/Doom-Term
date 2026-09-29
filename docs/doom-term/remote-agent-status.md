# Remote agent status over SSH

Doom Term v1.1.2 can show context and usage for Claude Code and Codex running on a **Linux SSH host**. The SSH session must be Warpified so Doom Term has the existing SSH ControlMaster socket. Doom Term uses that socket to run a small helper on the same remote account. It does not install or update software on the host automatically.

## Install on a remote host

On the computer running Doom Term, from a checkout of this repository at the release tag:

```sh
git checkout v1.1.2
ssh -T my-host 'mkdir -p "$HOME/.local/bin" && umask 077 && cat > "$HOME/.local/bin/doomterm-agent-status" && chmod 700 "$HOME/.local/bin/doomterm-agent-status"' < script/doomterm/remote_agent_status.py
```

If you installed Doom Term from a release package and do not have a checkout, run this **on the Linux SSH host** instead:

```sh
mkdir -p "$HOME/.cache/doomterm-install-1.1.2" "$HOME/.local/bin"
cd "$HOME/.cache/doomterm-install-1.1.2"
curl -fL -o doomterm-agent-status.py https://github.com/CMLeadmon/Doom-Term/releases/download/v1.1.2/doomterm-agent-status.py
curl -fL -o SHA256SUMS.txt https://github.com/CMLeadmon/Doom-Term/releases/download/v1.1.2/SHA256SUMS.txt
grep ' doomterm-agent-status.py$' SHA256SUMS.txt | sha256sum -c -
install -m 700 doomterm-agent-status.py "$HOME/.local/bin/doomterm-agent-status"
```

Stop if the checksum check fails. The [v1.1.2 release](https://github.com/CMLeadmon/Doom-Term/releases/tag/v1.1.2) contains both files.

Replace `my-host` with the same SSH alias, user, port, and key configuration you use in Doom Term. The remote account needs Python 3, `/proc`, and permission to read its own agent records. The helper is self-contained and uses only Python's standard library. Repeat the command after installing a newer Doom Term release so the helper stays in sync.

To verify the install and JSON response:

```sh
ssh my-host 'python3 "$HOME/.local/bin/doomterm-agent-status" --kind codex --cwd "$PWD" --session-id 0'
```

The command should print one JSON object with `context`, `usage`, and `working` keys. `null` values are expected because session ID `0` does not identify a live Warpified shell. For a live check, run `printf '%s\n' "$DOOMTERM_SESSION_ID"` in the Warpified remote pane before starting Codex. Then start Codex and leave it open. From another terminal, run the helper with that ID and the agent's directory:

```sh
ssh my-host 'python3 "$HOME/.local/bin/doomterm-agent-status" --kind codex --cwd /path/to/project --session-id 123456789'
```

Replace the path and number with the actual values from the Warpified pane. Use `--kind claude` for Claude Code. If `DOOMTERM_SESSION_ID` is empty, start a new Warpified SSH session with Doom Term v1.1.2; existing remote shells do not receive the new variable.

## Use in Doom Term

1. Open **Settings → Features → Warpify** and leave **Warpify SSH Sessions** enabled (the default).
2. Start an interactive `ssh my-host` session from a Doom Term pane and Warpify it if prompted. Run Claude Code or Codex in that remote shell.
3. The status plate and tab details update from the remote agent's own records. A dash means a field is unknown; it is never copied from a different host or pane.

Doom Term polls the helper every three seconds while a supported agent command is active. It uses the SSH ControlMaster already opened by Warpify, so SSH aliases, jump hosts, keys, and ports follow the active session. A plain SSH session without the wrapper retains its remote label but cannot provide remote context or usage.

Codex context and rate-limit usage come from the rollout file held open by the matching process. Claude context comes from its session record and transcript. Claude Code does not keep its account rate-limit usage in that transcript. To include Claude usage, turn on **Claude usage lookup** in Doom Term's Privacy settings or Command Palette. The remote helper then reads the remote account's existing Claude Code login and asks `api.anthropic.com` for usage at most once per minute. The token stays on the remote host and is not included in the SSH response or cache. This lookup is off by default.

The helper reports unknown values if there is no live process with the matching Warpified session ID, agent kind, and directory; if multiple processes match; if its records cannot be read; or if the SSH socket is unavailable. Linux is the supported remote platform for v1.1.2 because the helper uses `/proc` to bind records to the exact running process. Doom Term itself can run on Linux, macOS, or Windows, including an SSH session launched from WSL.

## Remove

```sh
ssh my-host 'rm -f "$HOME/.local/bin/doomterm-agent-status" "$HOME/.cache/doomterm/claude-usage.json"'
```
