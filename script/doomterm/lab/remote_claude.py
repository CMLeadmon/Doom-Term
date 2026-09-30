#!/usr/bin/env python3
"""A stand-in for Claude Code on a remote host, for exercising the in-band path over real SSH.

  remote_claude.py LOG TEE SCRIPT

Runs the statusLine command the way Claude Code does, with Claude's statusLine JSON on stdin:
once at session start, when context and rate limits are still unknown, and after each assistant
message. It then goes quiet, as an idle session does. TEE records every payload it sends (the
ground truth) and hands it unchanged to SCRIPT.
"""

import json
import os
import subprocess
import sys
import time


def payload(context, usage, session_id, cwd):
    data = {
        "session_id": session_id,
        "cwd": cwd,
        "workspace": {"current_dir": cwd},
        "context_window": {"used_percentage": context},
    }
    if usage is not None:
        data["rate_limits"] = {"five_hour": {"used_percentage": usage,
                                             "resets_at": int(time.time()) + 3 * 3600}}
    return data


def main():
    log, tee, script = sys.argv[1:4]
    session_id = "lab-remote-%d" % os.getpid()
    cwd = os.getcwd()

    def status_line(context, usage):
        subprocess.run([sys.executable, tee, log, script, "claude"],
                       input=json.dumps(payload(context, usage, session_id, cwd)),
                       universal_newlines=True, stdout=subprocess.PIPE)

    print("Claude Code (remote stand-in)")
    time.sleep(1)
    status_line(None, None)
    time.sleep(4)
    status_line(31, 22)
    time.sleep(5)
    status_line(34, 22)
    while True:
        sys.stdout.write("\x1b7\x1b[999;1H\x1b[2K? for shortcuts\x1b8")
        sys.stdout.flush()
        time.sleep(2)


if __name__ == "__main__":
    main()
