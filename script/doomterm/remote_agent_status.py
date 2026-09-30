#!/usr/bin/env python3
"""Report a single live Claude or Codex session to Doom Term over SSH."""

import argparse
import fcntl
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


UNKNOWN = {"context": None, "usage": None, "working": None}
MAX_TAIL = 64 * 1024 * 1024
USAGE_URL = "https://api.anthropic.com/api/oauth/usage"


def newest_record(path, matches):
    try:
        with path.open("rb") as stream:
            stream.seek(0, 2)
            length = stream.tell()
            window = 256 * 1024
            while True:
                start = max(0, length - window)
                stream.seek(start)
                data = stream.read()
                if start:
                    data = data.partition(b"\n")[2]
                for line in reversed(data.splitlines()):
                    try:
                        record = json.loads(line)
                    except (ValueError, UnicodeDecodeError):
                        continue
                    if matches(record):
                        return record
                if start == 0 or window >= MAX_TAIL:
                    return None
                window *= 4
    except OSError:
        return None


def process_env(process):
    try:
        values = (process / "environ").read_bytes().split(b"\0")
    except OSError:
        return {}
    result = {}
    for value in values:
        key, sep, raw = value.partition(b"=")
        if sep:
            result[key.decode(errors="replace")] = raw.decode(errors="replace")
    return result


def matching_processes(kind, cwd, session_id, proc_root):
    matches = []
    try:
        processes = list(proc_root.iterdir())
    except OSError:
        return matches
    for process in processes:
        if not process.name.isdecimal():
            continue
        try:
            argv = (process / "cmdline").read_bytes().split(b"\0")
            executable = Path(argv[0].decode(errors="replace")).name.lower()
            if executable in ("node", "nodejs", "bun") and len(argv) > 1:
                executable = Path(argv[1].decode(errors="replace")).stem.lower()
            if executable != kind:
                continue
            if process_env(process).get("DOOMTERM_SESSION_ID") != session_id:
                continue
            if (process / "cwd").resolve(strict=True) == cwd.resolve(strict=True):
                matches.append(process)
        except (OSError, IndexError):
            continue
    return matches


def claude_status(process, cwd, home):
    env = process_env(process)
    claude_home = Path(env.get("CLAUDE_CONFIG_DIR", home / ".claude"))
    try:
        session = json.loads((claude_home / "sessions" / (process.name + ".json")).read_text())
    except (OSError, ValueError):
        return dict(UNKNOWN)
    if session.get("cwd") != str(cwd):
        return dict(UNKNOWN)
    working = {"busy": True, "idle": False}.get(session.get("status"))
    session_id = session.get("sessionId")
    if not isinstance(session_id, str) or not session_id or not all(
        ord(char) < 128 and (char.isalnum() or char in "-_") for char in session_id
    ):
        return {**UNKNOWN, "working": working}
    projects = claude_home / "projects"
    transcripts = list(projects.glob("*/" + session_id + ".jsonl"))
    if len(transcripts) != 1:
        return {**UNKNOWN, "working": working}
    record = newest_record(transcripts[0], lambda row:
        row.get("type") == "assistant" and not row.get("isSidechain")
        and row.get("message", {}).get("model") != "<synthetic>"
        and isinstance(row.get("message", {}).get("usage"), dict))
    context = None
    if record:
        message = record["message"]
        model = message.get("model", "")
        if any(model.startswith(prefix) for prefix in (
            "claude-fable-5", "claude-mythos-5", "claude-opus-5", "claude-opus-4-8",
            "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-5", "claude-sonnet-4-6",
        )):
            window = 1_000_000
        elif any(model.startswith(prefix) for prefix in (
            "claude-haiku-4-5", "claude-opus-4-5", "claude-opus-4-1",
            "claude-opus-4-0", "claude-opus-4-2", "claude-3",
        )):
            window = 200_000
        else:
            window = None
        usage = message["usage"]
        tokens = [usage.get(key) for key in (
            "input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens",
        )]
        if window and all(isinstance(token, int) and token >= 0 for token in tokens):
            context = min(sum(tokens) / window, 1.0)
    return {"context": context, "usage": None, "working": working}


def fetch_claude_usage(token):
    request = urllib.request.Request(USAGE_URL, headers={
        "Authorization": "Bearer " + token,
        "anthropic-beta": "oauth-2025-04-20",
    })
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.load(response)


def claude_usage(claude_home, cache_file, fetch=fetch_claude_usage):
    try:
        cache_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        descriptor = os.open(cache_file.with_suffix(".lock"), os.O_RDWR | os.O_CREAT, 0o600)
        with os.fdopen(descriptor, "r+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            return _claude_usage_unlocked(claude_home, cache_file, fetch)
    except OSError:
        return None


USAGE_RETRY_SECONDS = 60
USAGE_WINDOW_SECONDS = 5 * 60 * 60


def _claude_usage_unlocked(claude_home, cache_file, fetch):
    cached = {}
    try:
        loaded = json.loads(cache_file.read_text())
        cached = loaded if isinstance(loaded, dict) else {}
    except (OSError, ValueError):
        pass
    now = time.time()
    held = cached.get("usage")
    confirmed = cached.get("at")
    if not isinstance(held, (int, float)) or not isinstance(confirmed, (int, float)) \
            or not 0 <= now - confirmed < USAGE_WINDOW_SECONDS:
        held = None
    tried = max(
        (value for value in (cached.get("at"), cached.get("failed_at"))
         if isinstance(value, (int, float))), default=0)
    if 0 <= now - tried < USAGE_RETRY_SECONDS:
        return held
    value = None
    try:
        credentials = json.loads((claude_home / ".credentials.json").read_text())
        token = credentials["claudeAiOauth"]["accessToken"]
        response = fetch(token)
        percent = (response.get("five_hour") or {}).get("utilization")
        if isinstance(percent, (int, float)):
            value = max(0.0, min(percent / 100.0, 1.0))
    except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError):
        pass
    if value is not None:
        record = {"at": now, "usage": value}
    else:
        # A failed request says nothing about the last reading; it only delays the next attempt.
        record = {"at": confirmed if held is not None else 0, "usage": held, "failed_at": now}
    try:
        temporary = cache_file.with_suffix(".tmp")
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            json.dump(record, stream)
        temporary.replace(cache_file)
    except OSError:
        pass
    return value if value is not None else held


def session_window(payload):
    """The five-hour (300 minute) window of a token event, when it carries one."""
    rates = payload.get("rate_limits")
    for key in ("primary", "secondary"):
        window = rates.get(key) if isinstance(rates, dict) else None
        if (isinstance(window, dict) and window.get("window_minutes") == 300
                and isinstance(window.get("used_percent"), (int, float))
                and not isinstance(window.get("used_percent"), bool)):
            return window
    return None


def codex_status(process):
    try:
        descriptors = list((process / "fd").iterdir())
    except OSError:
        return dict(UNKNOWN)
    rollouts = []
    for link in descriptors:
        try:
            if link.name.isdecimal() and link.is_symlink():
                target = Path(os.readlink(link))
                if target.name.startswith("rollout-") and target.name.endswith(".jsonl"):
                    rollouts.append(link.resolve(strict=True))
        except OSError:
            continue
    if len(rollouts) != 1:
        return dict(UNKNOWN)
    rollout = rollouts[0]
    event = newest_record(rollout, lambda row:
        row.get("payload", {}).get("type") == "token_count"
        and isinstance(row.get("payload", {}).get("info"), dict))
    limits = newest_record(rollout, lambda row:
        row.get("payload", {}).get("type") == "token_count"
        and session_window(row["payload"]) is not None)
    task = newest_record(rollout, lambda row:
        row.get("payload", {}).get("type") in
        ("task_started", "task_complete", "turn_aborted"))
    context = usage = None
    if event:
        info = event["payload"]["info"]
        used = info.get("last_token_usage", {}).get("total_tokens")
        window = info.get("model_context_window")
        if isinstance(used, (int, float)) and isinstance(window, (int, float)) and window > 0:
            context = max(0.0, min(used / window, 1.0))
    if limits:
        percent = session_window(limits["payload"]).get("used_percent")
        usage = max(0.0, min(percent / 100.0, 1.0))
    working = task["payload"]["type"] == "task_started" if task else None
    return {"context": context, "usage": usage, "working": working}


def git_diff(cwd):
    if not cwd.is_absolute() or not cwd.is_dir():
        return None
    try:
        output = subprocess.run(
            ["git", "-C", str(cwd), "--no-optional-locks", "diff", "--shortstat", "HEAD"],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            universal_newlines=True, timeout=2,
        )
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    if output.returncode:
        return None
    stats = {"added": 0, "removed": 0, "files": 0}
    for clause in output.stdout.split(","):
        words = clause.split()
        if len(words) < 2 or not words[0].isdigit():
            continue
        kind = words[1]
        key = "files" if kind.startswith("file") else (
            "added" if kind.startswith("insertion") else (
                "removed" if kind.startswith("deletion") else None))
        if key:
            stats[key] = int(words[0])
    return stats


def read_status(kind, cwd, session_id, home=None, proc_root=Path("/proc"),
                with_claude_usage=False):
    home = Path(home or Path.home())
    cwd = Path(cwd)
    processes = matching_processes(kind, cwd, session_id, Path(proc_root))
    if len(processes) != 1:
        return dict(UNKNOWN)
    diff = git_diff(cwd)
    if kind == "claude":
        status = claude_status(processes[0], cwd, home)
        if with_claude_usage:
            env = process_env(processes[0])
            claude_home = Path(env.get("CLAUDE_CONFIG_DIR", home / ".claude"))
            status["usage"] = claude_usage(
                claude_home, home / ".cache" / "doomterm" / "claude-session-usage.json")
    else:
        status = codex_status(processes[0])
    if diff is not None:
        status["diff"] = diff
    return status


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind", choices=("claude", "codex"), required=True)
    cwd_args = parser.add_mutually_exclusive_group(required=True)
    cwd_args.add_argument("--cwd")
    cwd_args.add_argument("--cwd-hex")
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--claude-usage", action="store_true")
    args = parser.parse_args()
    try:
        cwd = bytes.fromhex(args.cwd_hex).decode("utf-8") if args.cwd_hex else args.cwd
    except (UnicodeDecodeError, ValueError):
        parser.error("--cwd-hex must encode a UTF-8 path")
    print(json.dumps(read_status(
        args.kind, cwd, args.session_id, with_claude_usage=args.claude_usage),
        separators=(",", ":")))


if __name__ == "__main__":
    main()
