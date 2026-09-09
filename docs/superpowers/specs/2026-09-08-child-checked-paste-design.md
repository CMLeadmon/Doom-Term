# Child-checked clipboard paste

Status: approved by the user and implemented inline on 2026-09-08. Verification
and remaining broader audit findings are recorded in `docs/BETA_READINESS.md`.

## Evidence and scope

The beta audit reproduced pasted CR executing a shell command before Enter.
Commit 13e5e11 normalizes line endings and removes embedded control bytes. A
subsequent Chromium probe, using an isolated real tmux daemon and Bash with
bracketed paste explicitly disabled, still executed the first pasted command.
The frontend sees tmux's outer mode, not the inner application's mode. Merely
checking `@xterm/headless` mode 2004 is insufficient.

This repair covers clipboard input from terminal keyboard actions and native
paste events, including clipboard access failures and stale asynchronous reads.
It does not redesign reconnect history, promise atomic command execution, change
agent permissions, or turn ordinary keyboard writes into paste requests.

## Decision

Add a dedicated authenticated WebSocket Paste operation and correlated result.
The child-side transport owns multiline-paste admission and framing. Keep plain
Write for keystrokes. Do not infer child support from tmux's outer terminal or a
periodic telemetry poll.

Alternatives considered:

- Frontend mode checks alone: disproven by the real tmux test.
- Polling tmux's child mode into the UI: can be stale at the exact safety decision.
- Blanket blocking of tmux multiline paste: would disable the intended workflow
  even for supported shells and agents.

## Protocol and lifecycle

Client Paste carries request_id, session id, and clipboard text. Server PasteResult
echoes request_id and session id and carries either success or an explicit error.
Unknown/dead sessions and unsupported multiline input are refused. An absent
response is an unknown delivery outcome, not a reason to retry automatically.

The frontend requires an authenticated, connected socket. It never places paste
requests in pendingWrites and never replays them after reconnect. Pending paste
promises fail on disconnect or session close and have a finite response timeout.
Old daemons that do not support Paste therefore fail visibly without falling
back to unsafe Write. Ordinary single-line typing remains unchanged.

The view invalidates outstanding clipboard reads on pane changes, unmount,
keyboard/focus changes, and newly received terminal output/reset/resize. Clipboard
permission failures and paste refusals use a transient, accessible status notice.
These checks are conservative and may require retrying a clipboard read during
heavy output. They do not establish transactional identity across an unobserved
process replacement; the broader reconnect/generation work remains separate.

## Transport behavior

All clipboard text is normalized from CRLF/CR to LF. C0 controls except tab/LF,
and DEL, are removed before framing. Printable Unicode is preserved. ESC cannot
end a paste early. Reject inputs larger than 1 MiB before buffering or spawning
helper processes. An empty sanitized paste is a no-op success.

Direct PTY: track mode 2004 from the child's parsed stream. Check the latest
observed mode at delivery. Refuse multiline input when false/unknown; otherwise
frame in bracketed-paste markers. Single-line input may pass unframed when the
child has not enabled the mode. Serialize admission and writes against mode
updates as far as the PTY adapter allows; do not claim control over a child's
future mode changes.

Tmux: use its `bracket_paste_flag` for the exact target pane. Load sanitized text
into a uniquely named private paste buffer through stdin, never shell expansion,
an argv payload, or a world-readable temporary file. For multiline text, evaluate
the flag and execute the bracketed paste in tmux's command queue, with no separate
frontend or daemon query/write race. Preserve LF and tabs exactly. Delete the
temporary buffer on success, refusal, and helper failure where tmux remains
reachable. Do not touch any other buffer or the user's default tmux server.

The tmux adapter must prove its conditional command syntax, exact target quoting,
framing, and cleanup through real integration tests. Unavailable/unsupported tmux
commands fail closed. Helper I/O and waiting must be bounded and must not block a
Tokio executor thread. Do not log clipboard contents in errors.

## Verification gates

- Existing real-browser CR paste waits for Enter when Bash enables bracketed paste.
- The same browser/daemon with Bash mode disabled refuses both LF and CR multiline
  paste without executing a command or inserting text; a transient reason appears.
- Clipboard escape/control bytes cannot inject a paste terminator or control key.
- Direct PTY mode enable/disable, split escape sequences, single-line input,
  unsupported multiline input, empty input, and size-limit boundaries are tested.
- Real tmux integration tests cover enabled/disabled child mode, payloads containing
  quotes/Unicode, exact pane targeting, and buffer cleanup on both outcomes.
- Frontend protocol tests cover matching request/session ids, daemon refusal,
  timeout, disconnect, closed sessions, and no retry/queued delivery.
- Delayed clipboard reads do not write after view/output changes or unmount.
- Typecheck, Node/Vitest, production build, HUD comparison, Rust checks/tests,
  native compilation where available, and production-CSP Chromium smoke are run.

## Remaining limits

This is a terminal input-safety contract, not an authorization boundary against
a malicious child or an already authorized local client. Shells may execute pasted
commands when the user submits them. Bracketed-paste implementations are owned by
the child application. Clipboard forwarding through nested multiplexers needs its
own evidence and must not be advertised as universally safe.
