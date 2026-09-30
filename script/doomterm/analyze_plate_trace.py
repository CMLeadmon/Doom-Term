#!/usr/bin/env python3
"""Turns a plate-lab run directory into the numbers the evidence page reports.

  analyze_plate_trace.py RUN_DIR [--skip SECONDS] [--tail SECONDS]

Reads the application's trace (trace.jsonl), the framebuffer sampler's change log (fb.jsonl) and
the driver's markers (markers.jsonl), and writes metrics.json next to them. The steady-state
window starts `skip` seconds after the plate first shows an agent and ends `tail` seconds before
the trace does, so start-up and tear-down are not measured.
"""

import argparse
import bisect
import json
import sys
from pathlib import Path

ROW_FIELDS = ("n", "name", "status")


def load_jsonl(path):
    path = Path(path)
    if not path.exists():
        return []
    records = []
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            line = line.strip()
            if line:
                try:
                    records.append(json.loads(line))
                except ValueError:
                    continue
    return records


def percentile(sorted_values, fraction):
    return sorted_values[round(fraction * (len(sorted_values) - 1))]


def interval_stats(times_ms):
    """Distribution, in milliseconds, of the gaps between consecutive times."""
    gaps = sorted(round(b - a, 3) for a, b in zip(times_ms, times_ms[1:]))
    if not gaps:
        return {"n": 0}
    return {
        "n": len(gaps),
        "p50": percentile(gaps, 0.50),
        "p95": percentile(gaps, 0.95),
        "p99": percentile(gaps, 0.99),
        "max": gaps[-1],
        "mean": round(sum(gaps) / len(gaps), 3),
    }


def value_stats(values):
    values = sorted(values)
    if not values:
        return {"n": 0}
    return {
        "n": len(values),
        "p50": round(percentile(values, 0.50), 3),
        "p95": round(percentile(values, 0.95), 3),
        "max": round(values[-1], 3),
    }


def plate_flicker(states):
    """Counts the ways the displayed plate changed between consecutive states."""
    flicker = {
        "context_dash_flips": 0,
        "usage_dash_flips": 0,
        "waiting_changes": 0,
        "waiting_reversals_5s": 0,
        "rows_changes": 0,
    }
    for index in range(1, len(states)):
        before, now = states[index - 1], states[index]
        if before.get("context_pct") is not None and now.get("context_pct") is None:
            flicker["context_dash_flips"] += 1
        if before.get("usage_pct") is not None and now.get("usage_pct") is None:
            flicker["usage_dash_flips"] += 1
        if before.get("waiting") != now.get("waiting"):
            flicker["waiting_changes"] += 1
        if before.get("rows") != now.get("rows"):
            flicker["rows_changes"] += 1
        if index >= 2:
            earlier = states[index - 2]
            quick = now["t_ms"] - earlier["t_ms"] <= 5000
            if quick and earlier.get("waiting") == now.get("waiting") != before.get("waiting"):
                flicker["waiting_reversals_5s"] += 1
    return flicker


def truth_steps(records, key):
    """A step function of (wall time, value) built from the fakes' own log of what is really true.

    `key` is "waiting" (live agents that are not working) or a number the fakes report, such as
    "context_pct", taken from the newest live agent.
    """
    states = {}
    steps = []
    for record in sorted(records, key=lambda r: r["wall"]):
        pid = record["pid"]
        if record.get("event") == "exit":
            states.pop(pid, None)
        else:
            state = states.setdefault(pid, {"order": record["wall"]})
            for field in ("working", "context_pct", "usage_pct"):
                if field in record:
                    state[field] = record[field]
            if record.get("event") == "start":
                state["order"] = record["wall"]
        if key == "waiting":
            value = sum(1 for s in states.values() if not s.get("working", False))
        elif states:
            value = max(states.values(), key=lambda s: s["order"]).get(key)
        else:
            value = None
        steps.append((record["wall"], value))
    return steps


def value_at(steps, when):
    index = bisect.bisect_right([wall for wall, _ in steps], when) - 1
    return steps[index][1] if index >= 0 else None


def close(shown, expected, tolerance):
    if shown is None or expected is None:
        return shown is expected
    return abs(shown - expected) <= tolerance


def accuracy(states, truth, key, from_wall, to_wall, lag_s=4.0, tolerance=0, step_s=0.1, default=None):
    """How much of the window the plate showed what was really true.

    A value is also accepted for `lag_s` after the truth changed if it is the one that was true
    before, because detection and the quiet delay legitimately take that long.
    """
    shown = [(state["unix_ms"] / 1000.0, state.get(key)) for state in states]
    changes = []
    for (_, before), (wall, after) in zip(truth, truth[1:]):
        if before != after:
            changes.append((wall, before))
    samples = matched = 0
    at = from_wall
    while at < to_wall:
        expected = value_at(truth, at)
        expected = default if expected is None else expected
        seen = value_at(shown, at)
        ok = close(seen, expected, tolerance)
        if not ok:
            recent = [(wall, before) for wall, before in changes if wall <= at]
            if recent and at - recent[-1][0] <= lag_s:
                previous = default if recent[-1][1] is None else recent[-1][1]
                ok = close(seen, previous, tolerance)
        samples += 1
        matched += ok
        at += step_s
    return {"match_pct": round(100.0 * matched / max(samples, 1), 2), "samples": samples}


def timeline(states):
    return [
        {
            "t_s": round(state["t_ms"] / 1000, 3),
            "agent": state.get("agent"),
            "working": state.get("working"),
            "context_pct": state.get("context_pct"),
            "usage_pct": state.get("usage_pct"),
            "waiting": state.get("waiting"),
            "rows": [{key: row.get(key) for key in ROW_FIELDS} for row in state.get("rows", [])],
        }
        for state in states
    ]


def framebuffer_metrics(run, skip_s):
    changes = [r for r in load_jsonl(run / "fb.jsonl") if not r.get("summary")]
    marks = {m["name"]: m["wall"] for m in load_jsonl(run / "markers.jsonl")}
    if not changes or "agent-started" not in marks or "agent-end" not in marks:
        return None
    start = marks["agent-started"] + skip_s
    end = marks["agent-end"]
    within = [c for c in changes if start <= c["wall"] <= end]
    seconds = max(end - start, 1e-9)
    mark_times = [c["wall"] * 1000.0 for c in within if c["region"] == "mark"]
    return {
        "window_s": round(seconds, 3),
        "mark_changes_per_s": round(len(mark_times) / seconds, 3),
        "mark_interval_ms": interval_stats(mark_times),
        "region_changes": {
            name: sum(1 for c in within if c["region"] == name)
            for name in ("mark", "context", "usage", "waiting_count", "waiting_rows")
        },
    }


def truth_accuracy(run, states, events, from_s, to_s):
    records = load_jsonl(run / "truth.jsonl")
    if not records or not all("unix_ms" in event for event in events):
        return None
    # Convert the trace's own timeline into wall-clock seconds through the events' stamps.
    first = events[0]
    offset = first["unix_ms"] / 1000 - first["t_ms"] / 1000
    from_wall, to_wall = from_s + offset, to_s + offset
    scores = {}
    for key in ("waiting", "context_pct", "usage_pct"):
        if key != "waiting" and not any(key in record for record in records):
            continue
        scores[key] = accuracy(
            states, truth_steps(records, key), key, from_wall, to_wall,
            tolerance=0 if key == "waiting" else 1,
            default=0 if key == "waiting" else None,
        )
    return scores


def analyze_run(run, skip_s=5.0, tail_s=2.0):
    run = Path(run)
    events = load_jsonl(run / "trace.jsonl")
    if not events:
        return {"error": "no trace"}
    states = [e for e in events if e["ev"] == "plate"]
    first_agent = next(
        (s for s in states if s.get("agent") != "shell" or s.get("rows")), None
    )
    from_s = (first_agent["t_ms"] / 1000 if first_agent else 0.0) + skip_s
    to_s = events[-1]["t_ms"] / 1000 - tail_s
    seconds = max(to_s - from_s, 1e-9)

    def within(event):
        return from_s <= event["t_ms"] / 1000 <= to_s

    baseline = [s for s in states if s["t_ms"] / 1000 < from_s][-1:]
    window_states = baseline + [s for s in states if within(s)]
    inside = [e for e in events if within(e)]

    def times(name):
        return [e["t_ms"] for e in inside if e["ev"] == name]

    def per_second(name):
        return round(len(times(name)) / seconds, 3)

    probes = [e for e in inside if e["ev"] == "probe"]
    starts = [e for e in inside if e["ev"] == "probe_start"]
    return {
        "window": {"from_s": round(from_s, 3), "to_s": round(to_s, 3), "seconds": round(seconds, 3)},
        "trace": {
            "paint_per_s": per_second("paint"),
            "plate_render_per_s": per_second("plate_render"),
            "frame_event_per_s": per_second("frame_event"),
            "tick_interval_ms": interval_stats(times("tick")),
            "probe_ms": value_stats([p["ms"] for p in probes]),
            "probe_lock_ms": value_stats([p["lock_ms"] for p in starts]),
            "probe_interval_ms": interval_stats([p["t_ms"] for p in starts]),
        },
        "plate": {**plate_flicker(window_states), "timeline": timeline(window_states)},
        "accuracy": truth_accuracy(run, states, events, from_s, to_s),
        "framebuffer": framebuffer_metrics(run, skip_s),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("run")
    parser.add_argument("--skip", type=float, default=5.0)
    parser.add_argument("--tail", type=float, default=2.0)
    args = parser.parse_args()
    metrics = analyze_run(args.run, args.skip, args.tail)
    (Path(args.run) / "metrics.json").write_text(json.dumps(metrics, indent=1), encoding="utf-8")
    summary = {k: v for k, v in metrics.items() if k != "plate"}
    summary["plate"] = {k: v for k, v in metrics.get("plate", {}).items() if k != "timeline"}
    print(json.dumps(summary, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
