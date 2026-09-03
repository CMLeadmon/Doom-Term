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

# Which pane this agent is running in, if it is running in one at all.
#
# Set by the daemon on the session's environment and inherited all the way down
# to here. It travels as a HEADER for the same reason the agent name travels in
# the URL: the payload must reach the daemon exactly as the vendor wrote it, and
# splicing a field into arbitrary JSON in POSIX shell is a bug farm.
#
# Without it the daemon can only correlate by working directory, so two agents
# in one repository are indistinguishable and the wrong pane is marked as
# waiting on you. Absent is fine — the daemon falls back to the old behaviour.
if [ -n "${DOOM_TERM_SESSION_ID}" ]; then
  set -- --header "X-Doom-Term-Session: ${DOOM_TERM_SESSION_ID}"
else
  set --
fi

printf '%s' "$payload" | curl \
  --silent \
  --max-time 2 \
  --request POST \
  --header 'Content-Type: application/json' \
  "$@" \
  --data-binary @- \
  "http://127.0.0.1:${PORT}/hook/${AGENT}" >/dev/null 2>&1

exit 0
