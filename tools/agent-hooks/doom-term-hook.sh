#!/bin/sh
# Doom Term agent hook.
#
# The vendor runs this in the agent's critical path and hands it the event
# payload on stdin. Everything here is shaped by one rule: NEVER STALL THE
# AGENT. A hook that hangs is a paused agent, and no telemetry is worth that.
#
#   - hard 2s timeout on the request
#   - all output discarded
#   - exit 0 unconditionally, including when the daemon is not running
#
# The agent name comes from the URL rather than being spliced into the JSON,
# because rewriting arbitrary JSON in POSIX shell is a bug farm and the payload
# must reach the daemon exactly as the vendor wrote it.
#
# Installed by tools/agent-hooks/install.sh, which appends to the vendor's hook
# config rather than replacing it — see that script for why.

AGENT="${1:-unknown}"
PORT="${DOOM_PORT:-1421}"

payload=$(cat)
[ -z "$payload" ] && exit 0

printf '%s' "$payload" | curl \
  --silent \
  --max-time 2 \
  --request POST \
  --header 'Content-Type: application/json' \
  --data-binary @- \
  "http://127.0.0.1:${PORT}/hook/${AGENT}" >/dev/null 2>&1

exit 0
