#!/usr/bin/env python3
"""Send Claude Code or Codex status through the terminal pane that runs the agent."""

import json
import os
import re
import subprocess
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
    workspace = data.get("workspace") or {}
    cwd = workspace.get("current_dir") or data.get("cwd")
    return {"agent": "claude", "context": context, "usage": usage, "working": None,
            "diff": git_diff(cwd)}


def git_diff(cwd):
    if not isinstance(cwd, str) or not os.path.isabs(cwd) or not os.path.isdir(cwd):
        return None
    try:
        output = subprocess.run(
            ["git", "-C", cwd, "--no-optional-locks", "diff", "--shortstat", "HEAD"],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, timeout=2,
        )
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    if output.returncode:
        return None
    stats = {"added": 0, "removed": 0, "files": 0}
    for count, kind in re.findall(r"(\d+) (files? changed|insertions?\(\+\)|deletions?\(-\))",
                                  output.stdout):
        key = "files" if kind.startswith("file") else (
            "added" if kind.startswith("insertion") else "removed")
        stats[key] = int(count)
    return stats


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
        return {"agent": "codex", "context": None, "usage": None, "working": None,
                "diff": git_diff(notification.get("cwd"))}
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
            "usage": fraction(percent), "working": None,
            "diff": git_diff(notification.get("cwd"))}


def osc_message(report):
    body = json.dumps(report, separators=(",", ":"), allow_nan=False).encode("ascii")
    return TITLE + body + b"\x07"


def ancestor_terminals():
    if sys.platform == "darwin":
        yield from macos_ancestor_terminals()
        return
    if not os.path.isdir("/proc/self"):
        return
    pid, seen = os.getppid(), set()
    for _ in range(32):
        if pid <= 1:
            return
        try:
            with open(f"/proc/{pid}/stat", "rb") as stream:
                fields = stream.read().rpartition(b")")[2].split()
            parent, tty_nr = int(fields[1]), int(fields[4])
        except (OSError, ValueError, IndexError):
            return
        if tty_nr:
            for fd in (1, 2, 0):
                try:
                    target = os.readlink(f"/proc/{pid}/fd/{fd}")
                except OSError:
                    continue
                if target.startswith(("/dev/pts/", "/dev/tty")) and target not in seen:
                    seen.add(target)
                    yield target
        pid = parent


def macos_ancestor_terminals():
    pid, seen = os.getppid(), set()
    for _ in range(32):
        if pid <= 1:
            return
        try:
            output = subprocess.check_output(
                ["ps", "-p", str(pid), "-o", "ppid=", "-o", "tty="],
                text=True, timeout=1, stderr=subprocess.DEVNULL,
            )
            parent_text, tty = output.split()
            parent = int(parent_text)
        except (OSError, ValueError, subprocess.SubprocessError):
            return
        if re.fullmatch(r"tty[a-zA-Z0-9]+", tty):
            terminal = "/dev/" + tty
            if terminal not in seen:
                seen.add(terminal)
                yield terminal
        pid = parent


def terminals():
    if os.name == "nt":
        yield "CONOUT$"
    else:
        yield "/dev/tty"
        yield from ancestor_terminals()


def send_to_terminal(message):
    flags = os.O_WRONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOCTTY", 0)
    for terminal in terminals():
        try:
            descriptor = os.open(terminal, flags)
        except OSError:
            continue
        try:
            if os.name == "nt" or os.isatty(descriptor):
                os.write(descriptor, message)
                return
        except OSError:
            pass
        finally:
            os.close(descriptor)


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
