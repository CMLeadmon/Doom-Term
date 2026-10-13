#!/usr/bin/env python3
"""Send Claude Code, Codex or Antigravity status through the terminal pane that runs the agent."""

import argparse
import calendar
import contextlib
import errno
import hashlib
import json
import math
import os
import re
import shlex
import socket
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

TITLE = b"\x1b]777;notify;DoomTerm Agent Status;"
THREAD_ID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,36}\Z")
HELPER_VERSION = "5"
# Doom Term v1.1.10 and newer clear a relayed agent on this message; older versions ignore it.
ABSENCE = {"agent": None}
# Doom Term trusts a reported turn state for 60 seconds; the watcher resends well within that.
WATCH_HEARTBEAT = 5.0


def fraction(percent):
    if isinstance(percent, bool) or not isinstance(percent, (int, float)):
        return None
    if not 0 <= percent <= 100:
        return None
    return percent / 100


def as_dict(value):
    return value if isinstance(value, dict) else {}


def finite_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


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
    names = [model.get("id"), model.get("display_name")] if isinstance(model, dict) else [model]
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
    resets_at = utc_epoch(entry.get("reset_time"))
    if (isinstance(seconds, (int, float)) and not isinstance(seconds, bool)
            and 0 <= seconds < 4_000_000_000):
        resets_at = epoch_seconds(time.time() + seconds)
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
    if not finite_number(percent):
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
    return codex_rollout_report(files[0], thread_id, notification.get("cwd"))


def codex_rollout_report(path, thread_id, cwd):
    with_info, with_window = newest_token_events(path)
    context = None
    if with_info is not None:
        info = with_info["info"]
        tokens = as_dict(info.get("last_token_usage")).get("total_tokens")
        window = info.get("model_context_window")
        if finite_number(tokens) and finite_number(window) and tokens >= 0 and window > 0:
            context = max(0.0, min(tokens / window, 1.0))
    usage = resets_at = None
    if with_window is not None:
        window = session_window(with_window)
        usage = fraction_of_percent(window.get("used_percent"))
        resets_at = epoch_seconds(window.get("resets_at"))
    report = {"agent": "codex", "context": context, "usage": usage, "working": None,
              "diff": git_diff(cwd)}
    return annotate(report, resets_at, thread_id)


def osc_message(report):
    body = json.dumps(report, separators=(",", ":"), allow_nan=False).encode("ascii")
    return TITLE + body + b"\x07"


def ancestor_terminals():
    if sys.platform == "darwin":
        yield from macos_ancestor_terminals()
        return
    for target, _, _ in ancestor_terminal_holders():
        yield target


def process_stat(pid):
    """The parent pid and controlling terminal number of a process, or None when unreadable."""
    try:
        with open(f"/proc/{pid}/stat", "rb") as stream:
            fields = stream.read().rpartition(b")")[2].split()
        return int(fields[1]), int(fields[4])
    except (OSError, ValueError, IndexError):
        return None


def process_terminals(pid, tty_nr, seen):
    """Each terminal a process holds open as its own, with the descriptor that holds it."""
    if not tty_nr:
        return
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
            yield target, fd


def ancestor_terminal_holders():
    """Each terminal an ancestor holds open as its own, with that process and descriptor."""
    if not os.path.isdir("/proc/self"):
        return
    pid, seen = os.getppid(), set()
    for _ in range(32):
        if pid <= 1:
            return
        stat = process_stat(pid)
        if stat is None:
            return
        parent, tty_nr = stat
        for target, fd in process_terminals(pid, tty_nr, seen):
            yield target, pid, fd
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


def herdr_pane():
    """The herdr pane this process runs in, or None outside herdr.

    Herdr emulates the terminal of every pane, so an OSC written to the pane's own terminal stops
    at herdr. The report has to be written to the terminal of the herdr client instead.
    """
    pane_id = os.environ.get("HERDR_PANE_ID")
    socket_path = os.environ.get("HERDR_SOCKET_PATH")
    if os.environ.get("HERDR_ENV") != "1" or not pane_id or not socket_path:
        return None
    return {"pane_id": pane_id, "socket": socket_path}


def herdr_request(pane, method, params):
    """The result of one herdr socket API call, or None when herdr does not answer."""
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        client.settimeout(0.5)
        client.connect(pane["socket"])
        request = {"id": "doomterm-agent-status", "method": method, "params": params}
        client.sendall((json.dumps(request) + "\n").encode("utf-8"))
        reply = b""
        while not reply.endswith(b"\n"):
            chunk = client.recv(65536)
            if not chunk:
                break
            reply += chunk
        result = as_dict(json.loads(reply.decode("utf-8"))).get("result")
        return result if isinstance(result, dict) else None
    except (OSError, ValueError):
        return None
    finally:
        client.close()


def herdr_pane_info(pane):
    """Herdr's record of this pane, or None when it cannot be had."""
    result = herdr_request(pane, "pane.get", {"pane_id": pane["pane_id"]})
    info = as_dict(result).get("pane")
    return info if isinstance(info, dict) else None


def herdr_in_background(pane):
    """True only when herdr says another pane is the focused one.

    The plate shows one agent per terminal, so a pane the person is not looking at stays quiet
    instead of replacing the numbers of the agent they are using. When herdr cannot say, the
    report is sent.
    """
    info = herdr_pane_info(pane)
    return info is not None and info.get("focused") is False


def herdr_cache_directory(pane):
    root = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    key = hashlib.sha256(os.path.abspath(pane["socket"]).encode("utf-8")).hexdigest()
    return root / "doomterm" / "herdr-status" / key


def herdr_cache_path(pane):
    key = hashlib.sha256(pane["pane_id"].encode("utf-8")).hexdigest()
    return herdr_cache_directory(pane) / (key + ".json")


def process_start(pid):
    """When a process started, as text that differs between two processes given the same pid, or
    None when it cannot be read."""
    if sys.platform == "darwin":
        try:
            started = subprocess.check_output(
                ["ps", "-o", "lstart=", "-p", str(pid)], universal_newlines=True, timeout=1,
                stderr=subprocess.DEVNULL).strip()
        except (OSError, ValueError, subprocess.SubprocessError):
            return None
        return started or None
    try:
        fields = Path("/proc/{}/stat".format(pid)).read_bytes().rpartition(b")")[2].split()
        return fields[19].decode("ascii")
    except (OSError, IndexError, UnicodeDecodeError):
        return None


def herdr_process_identity(pane):
    info = as_dict(herdr_request(pane, "pane.process_info", {"pane_id": pane["pane_id"]}))
    processes = as_dict(info.get("process_info")).get("foreground_processes", [])
    result = []
    for process in processes:
        pid = as_dict(process).get("pid")
        if isinstance(pid, int) and not isinstance(pid, bool):
            started = process_start(pid)
            if started is not None:
                result.append([pid, started])
    return sorted(result)


def cache_herdr_report(pane, report):
    """Store measurements only, including from background panes, with private atomic writes."""
    path = herdr_cache_path(pane)
    temporary = None
    try:
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        record = {"at": time.time(), "report": report, "process": herdr_process_identity(pane)}
        fd, temporary = tempfile.mkstemp(dir=str(path.parent), prefix=".report-")
        with os.fdopen(fd, "w") as stream:
            json.dump(record, stream, allow_nan=False)
        os.replace(temporary, str(path))
    except (OSError, ValueError):
        pass
    finally:
        if temporary is not None:
            try:
                os.unlink(temporary)
            except OSError:
                pass


def herdr_codex_rollout(pane, info):
    """Use an explicit session reference or a rollout held by this pane's foreground process.

    A shared app-server's files are never searched: they can belong to another client.
    """
    home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    reference = as_dict(info.get("agent_session"))
    if reference.get("agent") == "codex":
        value = reference.get("value")
        if reference.get("kind") == "id" and isinstance(value, str) and THREAD_ID.fullmatch(value):
            paths = list((home / "sessions").rglob("*" + value + ".jsonl"))
            return (paths[0], value) if len(paths) == 1 else (None, value)
        if reference.get("kind") == "path" and isinstance(value, str):
            path = Path(value)
            try:
                path.resolve().relative_to((home / "sessions").resolve())
            except ValueError:
                return None, None
            match = re.search(r"([0-9a-fA-F]{8}-[0-9a-fA-F-]{27,36})\.jsonl$", path.name)
            if path.is_absolute() and match:
                return path, match.group(1)
    result = as_dict(herdr_request(pane, "pane.process_info", {"pane_id": pane["pane_id"]}))
    paths = set()
    for process in as_dict(result.get("process_info")).get("foreground_processes", []):
        pid = as_dict(process).get("pid")
        if not isinstance(pid, int) or isinstance(pid, bool):
            continue
        try:
            for descriptor in Path("/proc/{}/fd".format(pid)).iterdir():
                try:
                    path = descriptor.resolve(strict=True)
                    path.relative_to((home / "sessions").resolve())
                    if path.name.startswith("rollout-") and path.suffix == ".jsonl":
                        paths.add(path)
                except (OSError, ValueError):
                    continue
        except OSError:
            continue
    if len(paths) == 1:
        path = paths.pop()
        match = re.search(r"([0-9a-fA-F]{8}-[0-9a-fA-F-]{27,36})\.jsonl$", path.name)
        if match:
            return path, match.group(1)
    return None, None


SUPPORTED_AGENTS = ("claude", "codex", "agy")


def herdr_cached_report(pane, agent, session_id):
    """The measurements a hook in this pane last saved, for `agent` (any supported agent when
    None) and this conversation. Without a conversation to compare they are used only while the
    same processes hold the pane."""
    try:
        cached = as_dict(json.loads(herdr_cache_path(pane).read_text()))
        saved = as_dict(cached.get("report"))
        expected = session_identity(session_id)
        same_session = (saved.get("session") == expected if expected is not None else
                        bool(cached.get("process")) and
                        cached.get("process") == herdr_process_identity(pane))
        if ((saved.get("agent") == agent if agent is not None
             else saved.get("agent") in SUPPORTED_AGENTS)
                and same_session and 0 <= time.time() - cached["at"] <= 6 * 60 * 60):
            return dict(saved)
    except (OSError, ValueError, TypeError, KeyError):
        pass
    return None


def herdr_watch_report(pane, info):
    """The report for a herdr pane, or None when no supported agent runs in it."""
    agent = info.get("agent")
    reference = as_dict(info.get("agent_session"))
    session_id = reference.get("value") if reference.get("agent") == agent else None
    report = {"agent": agent, "context": None, "usage": None, "working": None, "diff": None}
    if agent not in SUPPORTED_AGENTS:
        # Herdr does not recognise every way an agent is started; a hook that ran from the
        # process still holding the pane names it.
        saved = herdr_cached_report(pane, None, None)
        if saved is None:
            return None
        report, agent = saved, saved["agent"]
    elif agent == "codex":
        path, session_id = herdr_codex_rollout(pane, info)
        if path is not None:
            report = codex_rollout_report(path, session_id,
                                         info.get("foreground_cwd") or info.get("cwd"))
    else:
        report = herdr_cached_report(pane, agent, session_id) or report
    if report.get("usage_resets_at", float("inf")) <= time.time():
        report["usage"] = None
        report.pop("usage_resets_at", None)
    state = info.get("agent_status")
    report["working"] = True if state == "working" else (
        False if state in ("idle", "done", "blocked") else None)
    if report.get("context") is None and report.get("usage") is None:
        # Nulls preserve the HUD's held readings. A distinct boundary explicitly forgets them.
        session_id = "unknown:{}:{}:{}:{}".format(
            pane["socket"], pane["pane_id"], session_id, herdr_process_identity(pane))
    elif not session_id and report.get("session") is None:
        session_id = "herdr:{}:{}:{}".format(
            pane["socket"], pane["pane_id"], herdr_process_identity(pane))
    return annotate(report, None, session_id)


@contextlib.contextmanager
def herdr_route(socket_path, pane_id):
    """Routes delivery as if this process ran in `pane_id`; the watcher is not itself a pane."""
    values = {"HERDR_ENV": "1", "HERDR_PANE_ID": pane_id, "HERDR_SOCKET_PATH": socket_path,
              "DOOMTERM_HERDR_WATCHER": "1"}
    original = {key: os.environ.get(key) for key in values}
    os.environ.update(values)
    try:
        yield
    finally:
        for key, value in original.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def herdr_watch_tick(socket_path, previous=None, now=None):
    """One refresh of the focused pane's report. Focus is resolved again after reading telemetry,
    so a slow read cannot publish a pane that lost focus.

    `previous` is the `sent` record of an earlier tick. A report is written only when it differs,
    when the attached clients changed, or when `WATCH_HEARTBEAT` has passed, so the clients'
    terminals and Doom Term's log are not written every second for nothing.
    """
    now = time.monotonic() if now is None else now
    route = {"socket": socket_path}
    result = as_dict(herdr_request(route, "session.snapshot", {}))
    snapshot = as_dict(result.get("snapshot"))
    focused = snapshot.get("focused_pane_id")
    info = next((item for item in snapshot.get("panes", [])
                 if as_dict(item).get("pane_id") == focused), None)
    if info is None:
        return {"report": None, "sent": previous,
                "delivery": {"delivered": False, "reason": "no_focused_pane"}}
    pane = {"socket": socket_path, "pane_id": focused}
    report = herdr_watch_report(pane, info)
    current = herdr_pane_info(pane)
    if current is None or current.get("focused") is not True:
        return {"report": None, "sent": previous,
                "delivery": {"delivered": False, "reason": "focus_changed"}}
    message = osc_message(report if report is not None else ABSENCE)
    with herdr_route(socket_path, focused):
        clients = sorted({target for target, _, _ in terminal_holders()})
        digest = hashlib.sha256(message).hexdigest()
        if (previous is not None and previous.get("message") == digest
                and previous.get("clients") == clients
                and 0 <= now - previous.get("at", float("-inf")) < WATCH_HEARTBEAT):
            return {"pane_id": focused, "report": report, "sent": previous,
                    "delivery": {"delivered": False, "reason": "unchanged"}}
        delivery = send_to_terminal(message)
    return {"pane_id": focused, "report": report, "delivery": delivery,
            "sent": {"message": digest, "clients": clients, "at": now}}


def watch_herdr(arguments):
    parser = argparse.ArgumentParser(description="Refresh the HUD from herdr's focused agent")
    parser.add_argument("--socket", default=os.environ.get("HERDR_SOCKET_PATH"), required=False)
    parser.add_argument("--interval", type=float, default=1.0)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--diagnose", action="store_true")
    args = parser.parse_args(arguments)
    if not (sys.platform.startswith("linux") or sys.platform == "darwin") or not args.socket:
        parser.error("watch-herdr needs Linux or macOS and --socket or HERDR_SOCKET_PATH")
    if not math.isfinite(args.interval) or args.interval < 0.2:
        parser.error("--interval must be finite and at least 0.2 seconds")
    import fcntl
    directory = herdr_cache_directory({"socket": args.socket})
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(str(directory / "watch.lock"), os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(fd, "w") as lock:
        # A hook asking whether a watcher runs holds a shared lock for an instant; only a lock
        # still held after these attempts belongs to another watcher.
        for attempt in range(10):
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if attempt == 9:
                    return 0
                time.sleep(0.1)
        sent = None
        while True:
            result = herdr_watch_tick(args.socket, sent)
            sent = result["sent"]
            if args.diagnose:
                print(json.dumps(result, allow_nan=False), file=sys.stderr, flush=True)
            if args.once:
                return 0 if result["delivery"]["delivered"] else 1
            time.sleep(args.interval)


def herdr_watcher_running(pane):
    """Whether a watch-herdr process holds this herdr session's lock and so delivers the focused
    pane's report."""
    try:
        import fcntl
    except ImportError:
        return False
    try:
        fd = os.open(str(herdr_cache_directory(pane) / "watch.lock"), os.O_RDONLY)
    except OSError:
        return False
    try:
        fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
    except OSError as error:
        return error.errno in (errno.EAGAIN, errno.EWOULDBLOCK, errno.EACCES)
    finally:
        # Closing the descriptor also releases a shared lock the probe obtained.
        os.close(fd)
    return False


def process_arguments(pid):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as stream:
            return [part.decode("utf-8", "replace") for part in stream.read().split(b"\0") if part]
    except OSError:
        return []


def herdr_session_name(socket_path):
    """The session whose server owns a socket: empty for the default, else the session's name."""
    directory = os.path.dirname(socket_path)
    if os.path.basename(os.path.dirname(directory)) == "sessions":
        return os.path.basename(directory)
    return ""


def herdr_client_session(arguments):
    """The session an interactive herdr client attaches to, or None for any other herdr command:
    the server, a subcommand, or an attach to a server on another machine."""
    if not arguments or os.path.basename(arguments[0]) != "herdr":
        return None
    rest = arguments[1:]
    if rest[:2] == ["session", "attach"] and len(rest) == 3:
        return rest[2]
    session = ""
    options = iter(rest)
    for option in options:
        if option == "--session":
            session = next(options, "")
        elif option.startswith("--session="):
            session = option.partition("=")[2]
        elif option != "--handoff":
            return None
    return session


def descends_from(pid, ancestor):
    for _ in range(32):
        stat = process_stat(pid)
        if stat is None or stat[0] <= 1:
            return False
        if stat[0] == ancestor:
            return True
        pid = stat[0]
    return False


def herdr_server_pid():
    """The herdr server that owns this process's pane, found among the ancestors."""
    pid = os.getppid()
    for _ in range(32):
        if pid <= 1:
            return None
        arguments = process_arguments(pid)
        if arguments and os.path.basename(arguments[0]) == "herdr" and arguments[1:2] == ["server"]:
            return pid
        stat = process_stat(pid)
        if stat is None:
            return None
        pid = stat[0]
    return None


def herdr_client_holders(pane):
    """Each terminal held open by an interactive client of this pane's herdr session, with that
    process and descriptor: the terminals the person is looking at.

    A herdr command run inside a pane holds that pane's terminal, so anything that descends from
    the server is not a client.
    """
    if sys.platform == "darwin":
        yield from macos_herdr_client_holders(pane)
        return
    if not os.path.isdir("/proc/self"):
        return
    session = herdr_session_name(pane["socket"])
    server = herdr_server_pid()
    if server is None and os.environ.get("DOOMTERM_HERDR_WATCHER") == "1":
        server = herdr_socket_server_pid(pane)
        if server is None:
            return
    seen = set()
    for entry in sorted(name for name in os.listdir("/proc") if name.isdigit()):
        pid = int(entry)
        try:
            if os.stat("/proc/" + entry).st_uid != os.getuid():
                continue
        except OSError:
            continue
        if herdr_client_session(process_arguments(pid)) != session:
            continue
        if server is not None and descends_from(pid, server):
            continue
        stat = process_stat(pid)
        if stat is None:
            continue
        for target, fd in process_terminals(pid, stat[1], seen):
            yield target, pid, fd


def macos_processes():
    """Every process as pid -> (parent pid, uid, controlling terminal or None, argument words),
    from ps, since macOS has no /proc. Arguments are split at whitespace."""
    try:
        output = subprocess.check_output(
            ["ps", "-A", "-o", "pid=,ppid=,uid=,tty=,command="], universal_newlines=True,
            timeout=2, stderr=subprocess.DEVNULL)
    except (OSError, ValueError, subprocess.SubprocessError):
        return {}
    table = {}
    for line in output.splitlines():
        fields = line.split(None, 4)
        try:
            pid, parent, uid = (int(field) for field in fields[:3])
            tty, command = fields[3], fields[4]
        except (ValueError, IndexError):
            continue
        terminal = "/dev/" + tty if re.fullmatch(r"tty[a-zA-Z0-9]+", tty) else None
        table[pid] = (parent, uid, terminal, command.split())
    return table


def table_descends_from(table, pid, ancestor):
    for _ in range(32):
        parent = table.get(pid, (0,))[0]
        if parent <= 1:
            return False
        if parent == ancestor:
            return True
        pid = parent
    return False


def macos_herdr_client_holders(pane):
    """`herdr_client_holders` from a ps listing. A macOS terminal is opened by name, so no
    descriptor is named."""
    table = macos_processes()
    session = herdr_session_name(pane["socket"])
    server, pid = None, os.getppid()
    for _ in range(32):
        entry = table.get(pid)
        if entry is None or pid <= 1:
            break
        arguments = entry[3]
        if arguments and os.path.basename(arguments[0]) == "herdr" and arguments[1:2] == ["server"]:
            server = pid
            break
        pid = entry[0]
    if server is None and os.environ.get("DOOMTERM_HERDR_WATCHER") == "1":
        server = herdr_socket_server_pid(pane)
        if server is None:
            return
    seen = set()
    for pid in sorted(table):
        _, uid, terminal, arguments = table[pid]
        if uid != os.getuid() or terminal is None or terminal in seen:
            continue
        if herdr_client_session(arguments) != session:
            continue
        if server is not None and table_descends_from(table, pid, server):
            continue
        seen.add(terminal)
        yield terminal, pid, None


def herdr_socket_server_pid(pane):
    """The server's pid from the socket's peer credentials, for a watcher with no server
    ancestor."""
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        client.settimeout(0.5)
        client.connect(pane["socket"])
        if sys.platform == "darwin":
            # <sys/un.h>: level SOL_LOCAL is 0; LOCAL_PEERCRED (1) is a struct xucred whose second
            # field is the uid, and LOCAL_PEERPID (2) is the pid.
            _, uid = struct.unpack_from("=II", client.getsockopt(0, 0x001, 76))
            pid = client.getsockopt(0, 0x002)
        else:
            pid, uid, _ = struct.unpack(
                "3i", client.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        return pid if uid == os.getuid() else None
    except (OSError, AttributeError, struct.error):
        return None
    finally:
        client.close()


def terminal_holders():
    pane = herdr_pane()
    if pane is not None:
        return herdr_client_holders(pane)
    return ancestor_terminal_holders()


def terminals():
    if herdr_pane() is not None:
        # Native Windows herdr panes run in herdr's own ConPTY sessions, and no client terminal
        # can be named from a pane, so nothing there is a destination.
        if os.name != "nt":
            for target, _, _ in terminal_holders():
                yield target
    elif os.name == "nt":
        yield "CONOUT$"
    else:
        yield "/dev/tty"
        yield from ancestor_terminals()


# pidfd_open and pidfd_getfd have the same numbers on every architecture that defines them.
PIDFD_OPEN, PIDFD_GETFD = 434, 438
PIDFD_ARCHITECTURES = ("x86_64", "i686", "aarch64", "armv7l", "armv8l", "riscv64", "ppc64le",
                       "s390x")


def borrow_descriptor(pid, descriptor):
    """A duplicate of another process's open descriptor, from a process the kernel's ptrace rules
    let this one attach to (Linux 5.6 or newer). Raises OSError when it cannot be had."""
    if not sys.platform.startswith("linux") or os.uname().machine not in PIDFD_ARCHITECTURES:
        raise OSError(errno.ENOSYS, "descriptors cannot be borrowed on this platform")
    try:
        import ctypes
        libc = ctypes.CDLL(None, use_errno=True)
    except (ImportError, OSError):
        raise OSError(errno.ENOSYS, "no C library to ask for a descriptor")
    libc.syscall.restype = ctypes.c_long
    pidfd = libc.syscall(ctypes.c_long(PIDFD_OPEN), ctypes.c_long(pid), ctypes.c_long(0))
    if pidfd < 0:
        raise OSError(ctypes.get_errno(), "pidfd_open failed")
    try:
        borrowed = libc.syscall(ctypes.c_long(PIDFD_GETFD), ctypes.c_long(pidfd),
                                ctypes.c_long(descriptor), ctypes.c_long(0))
        if borrowed < 0:
            raise OSError(ctypes.get_errno(), "pidfd_getfd failed")
        return borrowed
    finally:
        os.close(pidfd)


# prctl(2): the process lets any process of the same user borrow its descriptors under Yama.
PR_SET_PTRACER, PR_SET_PTRACER_ANY = 0x59616D61, (1 << 64) - 1


def launch_herdr(arguments):
    """Replace this process with the herdr client, marked as one whose terminal may be borrowed.

    A client whose terminal is not writable by name (Tailscale SSH creates root-owned ones) can only
    be reached through its open descriptor, and with kernel.yama.ptrace_scope=1 the kernel allows
    that only to the client's own ancestors. The permission survives exec and covers this client alone.
    """
    if sys.platform.startswith("linux"):
        try:
            import ctypes
            libc = ctypes.CDLL(None, use_errno=True)
            libc.prctl(ctypes.c_int(PR_SET_PTRACER), ctypes.c_ulong(PR_SET_PTRACER_ANY),
                       ctypes.c_ulong(0), ctypes.c_ulong(0), ctypes.c_ulong(0))
        except (ImportError, OSError, AttributeError):
            pass
    try:
        os.execvp("herdr", ["herdr"] + list(arguments))
    except OSError as error:
        sys.stderr.write("herdr could not be started: {}\n".format(error.strerror or error))
        return 127


def unreachable_herdr_clients(delivery):
    """Attached herdr clients whose terminal this process could neither open nor borrow."""
    reached = set(delivery.get("terminals") or ())
    refused = []
    for attempt in delivery.get("attempts", ()):
        terminal = attempt.get("terminal")
        if (terminal and terminal not in reached and terminal not in refused
                and attempt["reason"] in ("permission_denied", "borrow_failed")):
            refused.append(terminal)
    return refused


def borrow_terminal(terminal, attempts):
    """The descriptor an ancestor already holds for a terminal this process may not open by name.

    It is used only if it is the device that was named, so a descriptor that changed hands in the
    meantime cannot send the report to another pane.
    """
    for target, pid, descriptor in terminal_holders():
        if target != terminal:
            continue
        try:
            borrowed = borrow_descriptor(pid, descriptor)
        except OSError as error:
            attempts.append({"terminal": terminal, "reason": "borrow_failed", "errno": error.errno})
            return None
        try:
            if os.fstat(borrowed).st_rdev == os.stat(terminal).st_rdev:
                return borrowed
        except OSError:
            pass
        os.close(borrowed)
        attempts.append({"terminal": terminal, "reason": "borrow_failed", "errno": errno.EBADF})
        return None
    return None


def send_to_terminal(message=None):
    """Return delivery evidence; with no message, only probe terminal access without writing.

    Inside herdr every attached client is a destination, because each is a separate terminal that
    someone may be looking at. Elsewhere the first terminal that can be identified is the one.
    """
    flags = os.O_WRONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOCTTY", 0)
    attempts = []
    herdr = herdr_pane() is not None
    results = []
    for terminal in terminals():
        via = None
        try:
            descriptor = os.open(terminal, flags)
        except OSError as error:
            reason = ("permission_denied" if error.errno in (errno.EACCES, errno.EPERM)
                      else "no_controlling_terminal" if terminal == "/dev/tty"
                      and error.errno in (errno.ENXIO, errno.ENODEV, errno.ENOENT)
                      else "open_failed")
            attempts.append({"terminal": terminal, "reason": reason, "errno": error.errno})
            descriptor = (borrow_terminal(terminal, attempts)
                          if reason == "permission_denied" else None)
            if descriptor is None:
                if reason == "no_controlling_terminal" or herdr:
                    continue
                # Once a destination is identified, a farther ancestor may belong to another pane.
                break
            via = "client_descriptor" if herdr else "ancestor_descriptor"
        try:
            if os.name != "nt" and not os.isatty(descriptor):
                attempts.append({"terminal": terminal, "reason": "not_terminal"})
                if herdr:
                    continue
                break
            if message is not None:
                remaining = memoryview(message)
                while remaining:
                    written = os.write(descriptor, remaining)
                    if written <= 0:
                        raise OSError(errno.EIO, "zero-byte terminal write")
                    remaining = remaining[written:]
            result = {"delivered": message is not None, "writable": True,
                      "reason": "sent" if message is not None else "writable",
                      "terminal": terminal, "attempts": attempts}
            if via is not None:
                result["via"] = via
            if not herdr:
                return result
            results.append(result)
        except OSError as error:
            # A partial OSC must not be continued on another terminal.
            attempts.append({"terminal": terminal, "reason": "write_failed",
                             "errno": error.errno})
            if not herdr:
                return {"delivered": False, "writable": True, "reason": "write_failed",
                        "terminal": terminal, "attempts": attempts}
        finally:
            os.close(descriptor)
    if results:
        merged = dict(results[0])
        merged["terminals"] = [result["terminal"] for result in results]
        return merged
    reasons = [attempt["reason"] for attempt in attempts]
    reason = next((name for name in ("permission_denied", "write_failed") if name in reasons),
                  None)
    if reason is None:
        reason = ("no_ancestor_terminal" if attempts and all(
            name == "no_controlling_terminal" for name in reasons)
                  else "open_failed" if attempts
                  else "herdr_unsupported" if herdr and os.name == "nt"
                  else "no_herdr_client" if herdr else "no_ancestor_terminal")
    return {"delivered": False, "writable": reason == "write_failed", "reason": reason,
            "terminal": None, "attempts": attempts}


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


def delivery_advice(delivery, daemon=False):
    if daemon:
        return ("Codex shared app-server ancestry detected. Save the conversation ID and restart "
                "with codex --no-daemon; recovery may require a fork. Do not route via SSH_TTY.")
    if delivery["reason"] == "background_pane":
        return ("Herdr has another pane focused, so this agent stays quiet rather than replace the "
                "focused agent's numbers on the plate. Focus this pane; Claude refreshes on its "
                "next status-line run.")
    if delivery["reason"] == "herdr_watcher":
        return ("This pane's measurements were saved for the herdr watcher (watch-herdr), which "
                "sends the focused pane's report to every attached client. To see its delivery, "
                "stop its service and run watch-herdr --once --diagnose.")
    if delivery["reason"] == "herdr_unsupported":
        return ("Native Windows herdr panes cannot reach the terminal of a herdr client. Run the "
                "agent outside herdr, or in herdr on a Linux or macOS host reached over SSH.")
    if delivery["reason"] == "no_herdr_client":
        return ("Herdr found no attached client with a terminal on this machine. Start herdr in "
                "the Doom Term pane, or in the SSH session on this host. A client on another "
                "machine (herdr --remote) holds the terminal there, and this host cannot write to "
                "it.")
    if delivery["reason"] == "no_matching_report":
        return ("No unique rollout matches this completed-turn notification. Check the selected "
                "conversation ID and CODEX_HOME; internal tasks may have no on-disk rollout.")
    if delivery["reason"] == "permission_denied":
        advice = ("Inspect ownership and writability of the listed TTY as the agent account. Ask the "
                  "host administrator to repair that SSH session; do not use blanket chmod or sudo hooks.")
        refused = [attempt for attempt in delivery["attempts"]
                   if attempt["reason"] == "borrow_failed"]
        if refused:
            advice += (" Borrowing the agent's own open terminal was refused too (errno {}); Linux "
                       "allows it only on kernel 5.6 or newer with kernel.yama.ptrace_scope=0 or "
                       "CAP_SYS_PTRACE.".format(refused[0]["errno"]))
            if herdr_pane() is not None:
                advice += (" For a herdr client, detach it and attach again through "
                           "`doomterm-agent-status-in-band launch-herdr`.")
        return advice
    if not delivery["writable"]:
        return ("Run the check inside the agent's SSH session. A detached daemon without a terminal "
                "ancestor cannot report in-band; for Codex use --no-daemon and restart after hook setup.")
    if not delivery["delivered"] and delivery["reason"] == "write_failed":
        return "Terminal write failed. Reconnect and rerun the diagnostic from the intended pane."
    return "Complete a turn and inspect the intended Doom Term pane; terminal access alone is not client receipt."


def report_for(agent, data):
    if agent == "claude":
        return claude_report(data)
    if agent == "agy":
        return agy_report(data)
    home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    return codex_report(as_dict(data), home)


def codex_daemon_ancestor():
    """Detect a shared server in this process's ancestry, never an unrelated pane's server."""
    if not sys.platform.startswith("linux"):
        return None
    pid = os.getppid()
    for _ in range(32):
        if pid <= 1:
            return False
        try:
            fields = Path(f"/proc/{pid}/stat").read_bytes().rpartition(b")")[2].split()
            command = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
            if b"app-server" in command and (b"--managed-daemon" in command or b"daemon" in command):
                return True
            pid = int(fields[1])
        except (OSError, ValueError, IndexError):
            return None
    return None


def configuration_check(agent, path):
    try:
        text = path.read_text(encoding="utf-8")
        if agent == "codex":
            try:
                import tomllib
            except ImportError:
                return {"status": "unverified", "detail":
                        "TOML inspection requires Python 3.11+. Check the root notify array manually; "
                        "Python 3.6+ still supports reporting and --diagnose."}
            try:
                settings = tomllib.loads(text)
            except ValueError:
                return {"status": "fail", "detail": "Invalid TOML in the selected configuration."}
            command = settings.get("notify")
            if command is not None and not isinstance(command, list):
                return {"status": "fail", "detail": "Codex notify must be an array of command arguments."}
        else:
            settings = as_dict(json.loads(text))
            status_line = as_dict(settings.get("statusLine"))
            if agent == "claude" and status_line and status_line.get("type") != "command":
                return {"status": "fail", "detail": "Claude statusLine.type must be command."}
            if agent == "agy" and "enabled" in status_line and not isinstance(status_line["enabled"], bool):
                return {"status": "fail", "detail": "agy statusLine.enabled must be a boolean."}
            if agent == "agy" and status_line.get("enabled") is False:
                return {"status": "fail", "detail": "Enable agy's status line using /statusline enable."}
            command = status_line.get("command")
            if command is not None and not isinstance(command, str):
                return {"status": "fail", "detail": "statusLine.command must be a command string."}
        if not command:
            return {"status": "fail", "detail":
                    "No reporting hook configured in this file. Merge setup with existing hooks, then restart."}
        tokens = shlex.split(command) if isinstance(command, str) else command
        if not isinstance(tokens, list) or not all(isinstance(token, str) for token in tokens):
            return {"status": "fail", "detail": "Reporting command has an invalid shape."}
        names = ("doomterm-agent-status-in-band", "doomterm-agent-status-in-band.py", "in_band_agent_status.py")
        basenames = [token.replace("\\", "/").split("/")[-1] for token in tokens]
        index = None
        if len(tokens) == 2 and basenames[0] in names:
            index = 0
        elif (len(tokens) == 3 and re.fullmatch(r"python(?:3(?:\.\d+)?)?(?:\.exe)?", basenames[0])
              and basenames[1] in names):
            index = 1
        if index is not None:
            if tokens[index + 1] != agent:
                return {"status": "fail", "detail": "Reporting hook selects a different agent."}
            return {"status": "pass", "detail":
                    "Direct reporting command found on disk. Its interpreter, installed path and "
                    "loaded runtime configuration must still be verified by the actual hook."}
        return {"status": "unverified", "detail":
                "Custom or wrapped hook: inspect it and run --diagnose through that hook. "
                "The check neither executes nor replaces existing commands."}
    except (OSError, ValueError, UnicodeError):
        return {"status": "fail", "detail": "Cannot read or parse the selected configuration file."}


def setup_check(arguments):
    parser = argparse.ArgumentParser(description="Read-only remote status setup check; does not send an OSC.")
    parser.add_argument("agent", choices=("claude", "codex", "agy"))
    parser.add_argument("--config", type=Path, help="agent configuration file to inspect")
    parser.add_argument("--payload", type=Path, help="captured status-line JSON or Codex notification JSON")
    parser.add_argument("--expected-sha256", help="expected hash of this installed helper")
    args = parser.parse_args(arguments)
    home = Path.home()
    defaults = {"claude": home / ".claude" / "settings.json",
                "agy": home / ".gemini" / "antigravity-cli" / "settings.json",
                "codex": Path(os.environ.get("CODEX_HOME", home / ".codex")) / "config.toml"}
    digest = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    helper_matches = args.expected_sha256 is None or digest == args.expected_sha256.lower()
    daemon = codex_daemon_ancestor() if args.agent == "codex" else False
    delivery = send_to_terminal()
    checks = {
        "python": {"status": "pass", "version": list(sys.version_info[:3]),
                   "detail": "This helper requires Python 3.6 or newer."},
        "helper": {"status": "pass" if helper_matches else "fail", "version": HELPER_VERSION,
                   "sha256": digest, "detail": "Running helper hash" if helper_matches else
                   "Hash mismatch: reinstall the intended release's helper and restart the agent."},
        "configuration": configuration_check(args.agent, args.config or defaults[args.agent]),
        "daemon": {"status": "fail" if daemon else "unverified" if daemon is None else "pass",
                   "detail": delivery_advice(delivery, True) if daemon else
                   "Only this check's ancestry was inspected. Run --diagnose in the actual reporting hook "
                   "to verify the agent route; a shell check cannot establish the agent's launch mode."},
        "terminal": {"status": "pass" if delivery["writable"] else "fail", "delivery": delivery,
                     "detail": delivery_advice(delivery)},
        "measurements": {"status": "unverified", "detail":
                         "Supply --payload with captured agent JSON to check parsing. No values are invented."},
        "reload": {"status": "unverified", "detail":
                   "Restart the agent after configuring its hook, or explicitly reload its status line. "
                   "Settings on disk do not prove a running process loaded them."},
        "client_receipt": {"status": "unverified", "detail":
                           "This check sends no report. Complete a turn in the intended Doom Term pane "
                           "and compare its Context/Usage fields with --diagnose evidence."},
    }
    pane = herdr_pane()
    if pane is not None:
        info = herdr_pane_info(pane)
        unreachable = unreachable_herdr_clients(delivery)
        watcher = herdr_watcher_running(pane)
        unsupported = delivery["reason"] == "herdr_unsupported"
        checks["herdr"] = {
            "status": "fail" if unreachable or unsupported
            else "pass" if info is not None else "unverified",
            "pane": pane["pane_id"],
            "focused": None if info is None else info.get("focused"),
            "client_terminals": delivery.get("terminals", []),
            "watcher": watcher,
            "detail": "Reports go to the terminal of the herdr client, not this pane's own "
                      "terminal, which herdr keeps to itself. " + (
                          "The herdr watcher sends the focused pane's report; this pane's hooks "
                          "only save their measurements for it." if watcher else
                          "Only the focused pane reports. Run watch-herdr to follow focus while "
                          "agents are idle and to clear the plate on a pane without an agent.")}
        if unsupported:
            checks["herdr"]["detail"] = delivery_advice(delivery)
        if unreachable:
            checks["herdr"]["unreachable_client_terminals"] = unreachable
            checks["herdr"]["detail"] = (
                "Attached herdr client terminal(s) {} cannot be written or borrowed by this account, "
                "so whoever is connected through them gets no report. The terminal is not "
                "owned by you (Tailscale SSH creates root-owned ones) and, with "
                "kernel.yama.ptrace_scope=1, the kernel lets only a client's ancestors borrow its "
                "descriptor. Detach and attach again with: python3 {} launch-herdr "
                "(or set kernel.yama.ptrace_scope=0)."
            ).format(", ".join(unreachable), shlex.quote(os.path.abspath(sys.argv[0])))
    if args.payload is not None:
        try:
            data = json.loads(args.payload.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                raise ValueError("expected a JSON object")
            report = report_for(args.agent, data)
            measured = report is not None and any(report[key] is not None for key in ("context", "usage"))
            checks["measurements"] = {"status": "pass" if measured else "unverified", "report": report,
                                      "detail": "Parsed available context/usage; null means unavailable. "
                                      "Captured data does not establish freshness or delivery."}
        except (OSError, ValueError, UnicodeError):
            checks["measurements"] = {"status": "fail", "detail": "Cannot read or parse the supplied payload."}
    failed = any(check["status"] == "fail" for check in checks.values())
    write_line(json.dumps({"agent": args.agent, "checks": checks, "ok": not failed,
                          "status": "failed" if failed else "incomplete"}, allow_nan=False))
    return 1 if failed else 0


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "watch-herdr":
        return watch_herdr(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "launch-herdr":
        return launch_herdr(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "check":
        return setup_check(sys.argv[2:])
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("agent", choices=("claude", "codex", "agy"))
    parser.add_argument("notification", nargs="?")
    parser.add_argument("--diagnose", action="store_true",
                        help="emit delivery evidence to stderr and fail if no report was delivered")
    arguments = sys.argv[1:]
    # Python 3.6-3.13 argparse cannot intermix an option and an optional positional here.
    if "--diagnose" in arguments:
        arguments = ["--diagnose"] + [argument for argument in arguments if argument != "--diagnose"]
    args = parser.parse_args(arguments)
    if args.agent == "codex":
        if args.notification is None:
            return 2
        try:
            data = json.loads(args.notification)
        except ValueError:
            data = {}
    else:
        data = load_stdin_json()
    report = report_for(args.agent, data)
    daemon = codex_daemon_ancestor() if args.agent == "codex" else False
    pane = herdr_pane()
    if pane is not None and report is not None and not daemon:
        cache_herdr_report(pane, report)
    if report is None or daemon:
        delivery = {"delivered": False, "writable": False,
                    "reason": "shared_daemon" if daemon else "no_matching_report",
                    "terminal": None, "attempts": []}
    elif pane is not None and herdr_watcher_running(pane):
        # One sender per herdr session: a hook's report has no turn state, and two senders would
        # make the plate alternate between their versions of it.
        delivery = {"delivered": False, "writable": True, "reason": "herdr_watcher",
                    "terminal": None, "attempts": []}
    elif pane is not None and herdr_in_background(pane):
        delivery = {"delivered": False, "writable": True, "reason": "background_pane",
                    "terminal": None, "attempts": []}
    else:
        delivery = send_to_terminal(osc_message(report))
    if args.agent == "agy":
        write_line(footer(report, "5h"))
    if args.diagnose:
        result = {"agent": args.agent, "report": report, "delivery": delivery,
                  "daemon_ancestor": daemon, "client_receipt": "unverified",
                  "advice": delivery_advice(delivery, daemon)}
        print(json.dumps(result, allow_nan=False), file=sys.stderr)
        return 0 if delivery["delivered"] or delivery["reason"] == "herdr_watcher" else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
