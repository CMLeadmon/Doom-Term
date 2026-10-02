#!/usr/bin/env python3
"""Send Claude Code, Codex or Antigravity status through the terminal pane that runs the agent."""

import argparse
import calendar
import errno
import hashlib
import json
import math
import os
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path

TITLE = b"\x1b]777;notify;DoomTerm Agent Status;"
THREAD_ID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,36}\Z")
HELPER_VERSION = "3"


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
    with_info, with_window = newest_token_events(files[0])
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
              "diff": git_diff(notification.get("cwd"))}
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


def ancestor_terminal_holders():
    """Each terminal an ancestor holds open as its own, with that process and descriptor."""
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


def terminals():
    if os.name == "nt":
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


def borrow_terminal(terminal, attempts):
    """The descriptor an ancestor already holds for a terminal this process may not open by name.

    It is used only if it is the device that was named, so a descriptor that changed hands in the
    meantime cannot send the report to another pane.
    """
    for target, pid, descriptor in ancestor_terminal_holders():
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
    """Return delivery evidence; with no message, only probe terminal access without writing."""
    flags = os.O_WRONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOCTTY", 0)
    attempts = []
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
                if reason == "no_controlling_terminal":
                    continue
                # Once a destination is identified, a farther ancestor may belong to another pane.
                break
            via = "ancestor_descriptor"
        try:
            if os.name != "nt" and not os.isatty(descriptor):
                attempts.append({"terminal": terminal, "reason": "not_terminal"})
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
            return result
        except OSError as error:
            # A partial OSC must not be continued on another terminal.
            attempts.append({"terminal": terminal, "reason": "write_failed",
                             "errno": error.errno})
            return {"delivered": False, "writable": True, "reason": "write_failed",
                    "terminal": terminal, "attempts": attempts}
        finally:
            os.close(descriptor)
    reason = next((attempt["reason"] for attempt in attempts
                   if attempt["reason"] == "permission_denied"), None)
    if reason is None:
        reason = ("no_ancestor_terminal" if attempts and all(
            attempt["reason"] == "no_controlling_terminal" for attempt in attempts)
                  else "open_failed" if attempts else "no_ancestor_terminal")
    return {"delivered": False, "writable": False, "reason": reason,
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
    if report is None or daemon:
        delivery = {"delivered": False, "writable": False,
                    "reason": "shared_daemon" if daemon else "no_matching_report",
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
        return 0 if delivery["delivered"] else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
