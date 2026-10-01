#!/usr/bin/env python3
"""Ground truth for a run against a real local agent, read from the records the agent itself wrote.

  real_truth.py claude|codex OUT.jsonl SINCE_UNIX_SECONDS

Claude Code's transcripts and Codex's rollouts carry a timestamp on every record, so the context
fill and usage the agent really stated, and when, can be read back after the run and compared with
what the plate showed. Only files modified since the run began are read.
"""

import calendar
import json
import sys
import time
from itertools import chain
from pathlib import Path

ONE_MILLION = ("claude-fable-5", "claude-mythos-5", "claude-opus-5", "claude-opus-4-8",
               "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-5", "claude-sonnet-4-6")
TWO_HUNDRED_K = ("claude-haiku-4-5", "claude-opus-4-5", "claude-opus-4-1", "claude-opus-4-0",
                 "claude-opus-4-2", "claude-3")


def iso_to_unix(text):
    if not isinstance(text, str):
        return None
    whole, _, fraction = text.rstrip("Z").partition(".")
    try:
        seconds = calendar.timegm(time.strptime(whole, "%Y-%m-%dT%H:%M:%S"))
    except ValueError:
        return None
    return seconds + (float("0." + fraction) if fraction.isdigit() else 0.0)


def records(path):
    with open(path, encoding="utf-8", errors="replace") as stream:
        for line in stream:
            try:
                yield json.loads(line)
            except ValueError:
                continue


def recent_files(root, pattern, since):
    return sorted(p for p in Path(root).rglob(pattern) if p.stat().st_mtime >= since)


def claude_truth(projects, since):
    """(unix time, context percent) for each real main-thread turn of the recent transcripts."""
    truth = []
    for path in recent_files(projects, "*.jsonl", since):
        for record in records(path):
            message = record.get("message") or {}
            model = message.get("model", "")
            if (record.get("type") != "assistant" or record.get("isSidechain")
                    or model == "<synthetic>" or not isinstance(message.get("usage"), dict)):
                continue
            window = (1_000_000 if model.startswith(ONE_MILLION)
                      else 200_000 if model.startswith(TWO_HUNDRED_K) else None)
            when = iso_to_unix(record.get("timestamp"))
            usage = message["usage"]
            tokens = sum(usage.get(k) or 0 for k in
                         ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
            if window and when is not None:
                truth.append((when, 100.0 * min(tokens / window, 1.0)))
    return sorted(truth)


def codex_truth(sessions, since):
    """(unix time, context percent, five-hour usage percent) per token event of the recent rollouts."""
    truth = []
    for path in recent_files(sessions, "rollout-*.jsonl", since):
        entries = records(path)
        first = next(entries, None)
        started = iso_to_unix(first.get("timestamp")) if first else None
        if started is None or started < since:
            continue
        usage = None
        for record in chain((first,), entries):
            payload = record.get("payload") or {}
            if payload.get("type") != "token_count":
                continue
            when = iso_to_unix(record.get("timestamp"))
            limits = payload.get("rate_limits") or {}
            for key in ("primary", "secondary"):
                window = limits.get(key)
                if isinstance(window, dict) and window.get("window_minutes") == 300:
                    usage = window.get("used_percent")
            info = payload.get("info")
            if isinstance(info, dict) and when is not None:
                used = (info.get("last_token_usage") or {}).get("total_tokens")
                size = info.get("model_context_window")
                if used is not None and size:
                    truth.append((when, 100.0 * min(used / size, 1.0), usage))
    return sorted(truth)


def main():
    kind, out, since = sys.argv[1], sys.argv[2], float(sys.argv[3])
    home = Path.home()
    with open(out, "w", encoding="utf-8") as stream:
        if kind == "claude":
            rows = [(w, c, None) for w, c in claude_truth(home / ".claude" / "projects", since)]
        else:
            rows = codex_truth(home / ".codex" / "sessions", since)
        for index, (when, context, usage) in enumerate(rows):
            record = {"wall": when, "pid": 1, "agent": kind, "context_pct": context, "usage_pct": usage}
            if index == 0:
                record["event"] = "start"
            stream.write(json.dumps(record) + "\n")
    print(f"{len(rows)} records")


if __name__ == "__main__":
    main()
