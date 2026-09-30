#!/usr/bin/env python3
"""Send Claude Code, Codex or Antigravity status through the terminal pane that runs the agent."""

import calendar
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path


TITLE = b"\x1b]777;notify;DoomTerm Agent Status;"
THREAD_ID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,36}\Z")


def fraction(percent):
    if isinstance(percent, bool) or not isinstance(percent, (int, float)):
        return None
    if not 0 <= percent <= 100:
        return None
    return percent / 100


def as_dict(value):
    return value if isinstance(value, dict) else {}


def session_identity(value):
    """A number that is the same for the same session id and differs between ids."""
    if not isinstance(value, str) or not value:
        return None
    return int(hashlib.sha256(value.encode("utf-8")).hexdigest()[:12], 16)


def epoch_seconds(value):
    """A Unix time in seconds, or None when the value cannot be one."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value) if 0 < value < 4_000_000_000 else None


def utc_epoch(text):
    try:
        return calendar.timegm(time.strptime(text, "%Y-%m-%dT%H:%M:%SZ"))
    except (TypeError, ValueError):
        return None


def annotate(report, usage_resets_at, session_id):
    """Adds what identifies the window and conversation a report describes; omitted when unknown."""
    if report.get("usage") is not None and usage_resets_at is not None:
        report["usage_resets_at"] = usage_resets_at
    session = session_identity(session_id)
    if session is not None:
        report["session"] = session
    return report


def claude_report(data):
    data = as_dict(data)
    context = fraction(as_dict(data.get("context_window")).get("used_percentage"))
    window = as_dict(as_dict(data.get("rate_limits")).get("five_hour"))
    usage = fraction(window.get("used_percentage"))
    workspace = as_dict(data.get("workspace"))
    cwd = workspace.get("current_dir") or data.get("cwd")
    report = {"agent": "claude", "context": context, "usage": usage, "working": None,
              "diff": git_diff(cwd)}
    return annotate(report, epoch_seconds(window.get("resets_at")), data.get("session_id"))


def agy_quota(data):
    """Five-hour quota consumed for the model family in use and when it resets; unknown when it is
    not reported."""
    model = data.get("model")
    names = model.values() if isinstance(model, dict) else [model]
    name = " ".join(value for value in names if isinstance(value, str)).lower()
    if not name:
        return None, None
    bucket = "gemini-5h" if "gemini" in name else "3p-5h"
    quota = data.get("quota")
    entry = quota.get(bucket) if isinstance(quota, dict) else None
    entry = as_dict(entry)
    remaining = entry.get("remaining_fraction")
    if isinstance(remaining, bool) or not isinstance(remaining, (int, float)):
        return None, None
    if not 0 <= remaining <= 1:
        return None, None
    seconds = entry.get("reset_in_seconds")
    if isinstance(seconds, (int, float)) and not isinstance(seconds, bool) and seconds >= 0:
        resets_at = int(time.time() + seconds)
    else:
        resets_at = utc_epoch(entry.get("reset_time"))
    return 1 - remaining, resets_at


AGY_WORKING_STATES = ("thinking", "tool_use", "working")


def agy_report(data):
    data = as_dict(data)
    window = as_dict(data.get("context_window"))
    context = fraction(window.get("used_percentage"))
    if context is None:
        remaining = fraction(window.get("remaining_percentage"))
        context = None if remaining is None else 1 - remaining
    workspace = as_dict(data.get("workspace"))
    state = data.get("agent_state")
    if state in AGY_WORKING_STATES:
        working = True
    elif state == "idle":
        working = False
    else:
        working = None
    usage, resets_at = agy_quota(data)
    report = {"agent": "agy", "context": context, "usage": usage,
              "working": working,
              "diff": git_diff(workspace.get("current_dir") or data.get("cwd"))}
    return annotate(report, resets_at, data.get("session_id") or data.get("conversation_id"))


def git_diff(cwd):
    if not isinstance(cwd, str) or not os.path.isabs(cwd) or not os.path.isdir(cwd):
        return None
    try:
        output = subprocess.run(
            ["git", "-C", cwd, "--no-optional-locks", "diff", "--shortstat", "HEAD"],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            universal_newlines=True, timeout=2,
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


def session_window(payload):
    """The five-hour (300 minute) window of a token event, when it carries one."""
    rates = as_dict(payload.get("rate_limits"))
    for key in ("primary", "secondary"):
        window = rates.get(key)
        if (isinstance(window, dict) and window.get("window_minutes") == 300
                and fraction_of_percent(window.get("used_percent")) is not None):
            return window
    return None


def fraction_of_percent(percent):
    if isinstance(percent, bool) or not isinstance(percent, (int, float)):
        return None
    return max(0.0, min(percent / 100.0, 1.0))


def newest_token_events(path):
    """The newest token event with token info and the newest with a five-hour window.

    Real events often carry only the weekly window, or no token info at all, so one event cannot
    supply both numbers.
    """
    try:
        with path.open("rb") as stream:
            stream.seek(0, 2)
            length = stream.tell()
            start = max(0, length - 1024 * 1024)
            stream.seek(start)
            data = stream.read()
    except OSError:
        return None, None
    if start:
        data = data.partition(b"\n")[2]
    with_info = with_window = None
    for line in reversed(data.splitlines()):
        try:
            record = json.loads(line)
        except (ValueError, UnicodeDecodeError):
            continue
        payload = as_dict(as_dict(record).get("payload"))
        if payload.get("type") != "token_count":
            continue
        if with_info is None and isinstance(payload.get("info"), dict):
            with_info = payload
        if with_window is None and session_window(payload) is not None:
            with_window = payload
        if with_info is not None and with_window is not None:
            break
    return with_info, with_window


def codex_report(notification, codex_home):
    if notification.get("type") != "agent-turn-complete":
        return None
    thread_id = notification.get("thread-id")
    if not isinstance(thread_id, str) or not THREAD_ID.fullmatch(thread_id):
        return None
    files = list((codex_home / "sessions").rglob("*" + thread_id + ".jsonl"))
    if len(files) != 1:
        return None
    with_info, with_window = newest_token_events(files[0])
    context = None
    if with_info is not None:
        info = with_info["info"]
        tokens = as_dict(info.get("last_token_usage")).get("total_tokens")
        window = info.get("model_context_window")
        if isinstance(tokens, (int, float)) and isinstance(window, (int, float)) and window > 0:
            context = max(0.0, min(tokens / window, 1.0))
    usage = resets_at = None
    if with_window is not None:
        window = session_window(with_window)
        usage = fraction_of_percent(window.get("used_percent"))
        resets_at = epoch_seconds(window.get("resets_at"))
    report = {"agent": "codex", "context": context, "usage": usage, "working": None,
              "diff": git_diff(notification.get("cwd"))}
    return annotate(report, resets_at, thread_id)


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
                    descriptor = f"/proc/{pid}/fd/{fd}"
                    target = os.readlink(descriptor)
                    device = os.stat(descriptor).st_rdev
                except OSError:
                    continue
                if (target.startswith(("/dev/pts/", "/dev/tty"))
                        and (device & 0xffffffff) == (tty_nr & 0xffffffff)
                        and target not in seen):
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
                universal_newlines=True, timeout=1, stderr=subprocess.DEVNULL,
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


def load_stdin_json():
    try:
        value = json.load(sys.stdin)
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def write_line(text):
    """Writes the status text as UTF-8 whatever the locale, after the report has been sent."""
    data = (text + "\n").encode("utf-8")
    try:
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
    except AttributeError:
        print(text)


def footer(report, usage_label):
    context = report["context"]
    usage = report["usage"]
    return ("Context: {:.0%}".format(context) if context is not None else "Context: \u2014") + (
        "  {}: {:.0%}".format(usage_label, usage) if usage is not None
        else "  {}: \u2014".format(usage_label))


def main():
    if len(sys.argv) < 2:
        return 2
    if sys.argv[1] == "claude":
        report = claude_report(load_stdin_json())
        send_to_terminal(osc_message(report))
        write_line(footer(report, "Session"))
    elif sys.argv[1] == "agy":
        report = agy_report(load_stdin_json())
        send_to_terminal(osc_message(report))
        write_line(footer(report, "5h"))
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
