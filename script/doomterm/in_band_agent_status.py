#!/usr/bin/env python3
"""Send Claude Code or Codex status through the terminal pane that runs the agent."""

import json
import os
import re
import sys
from pathlib import Path


TITLE = b"\x1b]777;notify;DoomTerm Agent Status;"
THREAD_ID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,36}\Z")


def fraction(percent):
    if isinstance(percent, bool) or not isinstance(percent, (int, float)):
        return None
    if not 0 <= percent <= 100:
        return None
    return percent / 100


def claude_report(data):
    context = fraction((data.get("context_window") or {}).get("used_percentage"))
    usage = fraction(((data.get("rate_limits") or {}).get("five_hour") or {})
                     .get("used_percentage"))
    return {"agent": "claude", "context": context, "usage": usage, "working": None}


def newest_token_event(path):
    try:
        with path.open("rb") as stream:
            stream.seek(0, 2)
            length = stream.tell()
            start = max(0, length - 1024 * 1024)
            stream.seek(start)
            data = stream.read()
    except OSError:
        return None
    if start:
        data = data.partition(b"\n")[2]
    for line in reversed(data.splitlines()):
        try:
            record = json.loads(line)
        except (ValueError, UnicodeDecodeError):
            continue
        payload = record.get("payload") or {}
        if payload.get("type") == "token_count" and isinstance(payload.get("info"), dict):
            return payload
    return None


def codex_report(notification, codex_home):
    if notification.get("type") != "agent-turn-complete":
        return None
    thread_id = notification.get("thread-id")
    if not isinstance(thread_id, str) or not THREAD_ID.fullmatch(thread_id):
        return None
    files = list((codex_home / "sessions").rglob(f"*{thread_id}.jsonl"))
    if len(files) != 1:
        return None
    event = newest_token_event(files[0])
    if event is None:
        return {"agent": "codex", "context": None, "usage": None, "working": None}
    info = event["info"]
    tokens = (info.get("last_token_usage") or {}).get("total_tokens")
    window = info.get("model_context_window")
    context = None
    if isinstance(tokens, (int, float)) and isinstance(window, (int, float)) and window > 0:
        context = max(0.0, min(tokens / window, 1.0))
    rates = event.get("rate_limits") or {}
    session_window = next((window for key in ("primary", "secondary")
                           if isinstance(window := rates.get(key), dict)
                           and window.get("window_minutes") == 300), {})
    percent = session_window.get("used_percent")
    return {"agent": "codex", "context": context,
            "usage": fraction(percent), "working": None}


def osc_message(report):
    body = json.dumps(report, separators=(",", ":"), allow_nan=False).encode("ascii")
    return TITLE + body + b"\x07"


def send_to_terminal(message):
    terminal = "CONOUT$" if os.name == "nt" else "/dev/tty"
    try:
        descriptor = os.open(terminal, os.O_WRONLY | getattr(os, "O_BINARY", 0))
        try:
            os.write(descriptor, message)
        finally:
            os.close(descriptor)
    except OSError:
        pass


def main():
    if len(sys.argv) < 2:
        return 2
    if sys.argv[1] == "claude":
        data = json.load(sys.stdin)
        report = claude_report(data)
        send_to_terminal(osc_message(report))
        context = report["context"]
        usage = report["usage"]
        print(f"Context: {context:.0%}" if context is not None else "Context: —", end="")
        print(f"  Session: {usage:.0%}" if usage is not None else "  Session: —")
    elif sys.argv[1] == "codex" and len(sys.argv) >= 3:
        notification = json.loads(sys.argv[2])
        home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
        report = codex_report(notification, home)
        if report is not None:
            send_to_terminal(osc_message(report))
    else:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
