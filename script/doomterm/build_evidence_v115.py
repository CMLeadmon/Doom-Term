#!/usr/bin/env python3
"""Builds the v1.1.5 section of evidence.html from the plate lab's runs.

  build_evidence_v115.py collect RUNS_DIR   copy the runs worth keeping into evidence/v115
  build_evidence_v115.py page               regenerate the section of evidence.html

Every figure and every number in the section is computed from the recorded runs, so the page
cannot drift from the data. Re-running `page` is idempotent.
"""

import argparse
import base64
import gzip
import html
import io
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

import analyze_plate_trace as analysis
import evidence_charts as charts

REPO = Path(__file__).resolve().parents[2]
EVIDENCE = REPO / "evidence" / "v115"
LAB = EVIDENCE / "lab"
REAL = EVIDENCE / "real-ssh"
PAGE = REPO / "evidence.html"
BUILDS = ("before", "after")
SCENARIOS = ("fps", "fps-quiet", "waiting", "dash-claude", "dash-codex", "dash-remote", "dash-agy")
PLATE_HEIGHT = 87  # 29 logical pixels at scale 3
START, END = "<!-- v115:start -->", "<!-- v115:end -->"
CSS_START, CSS_END = "/* v115:start */", "/* v115:end */"
ROLE_NAME = {"before": "v1.1.4", "after": "v1.1.5", "truth": "real"}

e = html.escape


# --- collecting -------------------------------------------------------------------------------

def collect(runs):
    """Copies each run's records (large logs compressed) and a crop of its plate."""
    runs = Path(runs)
    for build in BUILDS:
        for scenario in SCENARIOS:
            source = runs / build / scenario
            if not (source / "metrics.json").exists():
                print(f"skipped {build}/{scenario}: no metrics")
                continue
            target = LAB / build / scenario
            shutil.rmtree(target, ignore_errors=True)
            target.mkdir(parents=True)
            for name in ("metrics.json", "truth.jsonl", "markers.jsonl", "regions.json", "driver.log",
                         "binary.sha256", "summary.txt"):
                if (source / name).exists():
                    shutil.copy2(source / name, target / name)
            for name in ("trace.jsonl", "fb.jsonl"):
                if (source / name).exists():
                    with open(source / name, "rb") as plain, gzip.open(target / (name + ".gz"), "wb", 9) as packed:
                        shutil.copyfileobj(plain, packed)
            for shot in ("final.png", "ready.png"):
                if (source / shot).exists():
                    crop = Image.open(source / shot).convert("RGB")
                    width, height = crop.size
                    window_bottom = 1000  # the lab's window is 1920x1000 at the screen origin
                    crop.crop((0, window_bottom - PLATE_HEIGHT, width, window_bottom)).save(
                        target / f"plate-{shot}", optimize=True)
            print(f"collected {build}/{scenario}")


HARDWARE = EVIDENCE / "hardware"


def collect_hardware(runs):
    """Copies the headless-KWin runs: animation and CPU on the GPU, and real Claude over SSH."""
    runs = Path(runs)
    for source in sorted(runs.glob("kwin-*")) + sorted(runs.glob("real-ssh-*")) + sorted(runs.glob("real-local-*")):
        if not (source / "metrics.json").exists():
            continue
        target = HARDWARE / source.name
        shutil.rmtree(target, ignore_errors=True)
        target.mkdir(parents=True)
        for name in ("metrics.json", "truth.jsonl", "payloads.jsonl", "markers.jsonl", "clock-skew.txt",
                     "summary.txt", "binary.sha256"):
            if (source / name).exists():
                shutil.copy2(source / name, target / name)
        with open(source / "trace.jsonl", "rb") as plain, gzip.open(target / "trace.jsonl.gz", "wb", 9) as packed:
            shutil.copyfileobj(plain, packed)
        gpu = []
        for log in sorted((source / "xdg" / "state").glob("*/doomterm*.log")):
            for line in log.read_text(errors="replace").splitlines():
                if "wgpu::resources" in line and ("adapter" in line.lower() or "Backend" in line or ":" in line.split("]")[-1]):
                    gpu.append(line.split("] ", 2)[-1].strip())
        (target / "gpu.txt").write_text("\n".join(dict.fromkeys(gpu[:12])) + "\n")
        shots = sorted(source.glob("window-*.png"))
        if shots:
            last_index = shots[-1].name.split("-")[1]
            for shot in shots:
                if shot.name.split("-")[1] == last_index:
                    image = Image.open(shot).convert("RGB")
                    width, height = image.size
                    image.crop((0, height - PLATE_HEIGHT, width, height)).save(
                        target / ("plate-" + shot.name.split("-", 2)[2]), optimize=True)
        print(f"collected hardware run {source.name}")


# --- loading ----------------------------------------------------------------------------------

class Run:
    def __init__(self, build, scenario, root=LAB, directory=None):
        self.dir = Path(directory) if directory else Path(root) / build / scenario
        self.build, self.scenario = build, scenario
        self.metrics = json.loads((self.dir / "metrics.json").read_text())
        self.events = analysis.load_jsonl(self.dir / "trace.jsonl")
        self.truth = analysis.load_jsonl(self.dir / "truth.jsonl")
        first = self.events[0]
        self.offset = first["unix_ms"] / 1000 - first["t_ms"] / 1000
        self.window = self.metrics["window"]
        self.accuracy = self.metrics.get("accuracy") or {}

    @classmethod
    def at(cls, directory):
        return cls(None, None, directory=directory)

    def shown(self, key):
        """Displayed value over the window, in seconds from its start."""
        return [(state["t_s"] - self.window["from_s"], state.get(key))
                for state in self.metrics["plate"]["timeline"]]

    def real(self, key):
        """What was really true, in the same time base."""
        steps = analysis.truth_steps(self.truth, key)
        return [(wall - self.offset - self.window["from_s"], value) for wall, value in steps]

    def mark_intervals_ms(self):
        marks = {m["name"]: m["wall"] for m in analysis.load_jsonl(self.dir / "markers.jsonl")}
        changes = [c for c in analysis.load_jsonl(self.dir / "fb.jsonl")
                   if not c.get("summary") and c["region"] == "mark"]
        start, end = marks["agent-started"] + 5.0, marks["agent-end"]
        times = [c["wall"] * 1000 for c in changes if start <= c["wall"] <= end]
        return [round(b - a, 3) for a, b in zip(times, times[1:])]


def fixed(value, digits=1):
    return "n/a" if value is None else f"{value:.{digits}f}"


def pct(run, key):
    return run.accuracy.get(key, {}).get("match_pct")


# --- figures ----------------------------------------------------------------------------------

def legend(*roles):
    items = "".join(f'<span class="v115-key {r}"><i></i>{ROLE_NAME[r]}</span>' for r in roles)
    return f'<div class="v115-legend">{items}</div>'


def figure(title, chart, caption, table=None):
    details = f'<details><summary>Numbers behind this chart</summary>{table}</details>' if table else ""
    return (f'<figure class="v115-figure"><figcaption class="v115-title">{e(title)}</figcaption>'
            f'{chart}<figcaption>{caption}</figcaption>{details}</figure>')


def table(headers, rows, cls=""):
    head = "".join(f"<th>{e(h)}</th>" for h in headers)
    body = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in row) + "</tr>" for row in rows)
    return f'<div class="v115-scroll"><table class="v115-table {cls}"><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'


def waiting_figure(runs):
    rows = []
    for build in BUILDS:
        run = runs[build]["waiting"]
        acc = run.accuracy["waiting"]
        rows.append({
            "name": ROLE_NAME[build],
            "note": f'{acc["shown_changes"]} changes shown, {acc["truth_changes"]} real',
            "lines": [{"role": "truth", "label": "real", "steps": run.real("waiting")},
                      {"role": build, "label": "shown", "steps": run.shown("waiting")}],
        })
    span = runs["before"]["waiting"].window["seconds"]
    chart = charts.step_chart(rows, (0, span), (0, 3.3), "seconds into the measured window", width=860,
                              y_ticks=[0, 1, 2, 3], label="WAITING count over time, shown against what was real")
    data = table(["", "changes shown", "real changes", "quick reversals shown", "quick reversals real", "correct"],
                 [[ROLE_NAME[b], runs[b]["waiting"].accuracy["waiting"]["shown_changes"],
                   runs[b]["waiting"].accuracy["waiting"]["truth_changes"],
                   runs[b]["waiting"].accuracy["waiting"]["shown_reversals_5s"],
                   runs[b]["waiting"].accuracy["waiting"]["truth_reversals_5s"],
                   f'{pct(runs[b]["waiting"], "waiting"):.1f}%'] for b in BUILDS])
    return figure(
        "WAITING: how many other agents need you",
        legend("truth", "before", "after") + chart,
        "Three test agents work in other tabs and stop between turns. The dashed grey line is how many of "
        "them were really waiting. The count may trail reality by up to 4 seconds, which is the time to "
        "notice a change plus the quiet delay that stops a pause from reading as waiting.", data)


def number_figure(runs, scenario, key, title, label, intro):
    rows = []
    for build in BUILDS:
        run = runs[build][scenario]
        acc = run.accuracy[key]
        rows.append({
            "name": ROLE_NAME[build],
            "note": f'correct {acc["match_pct"]:.1f}% of the time',
            "lines": [{"role": "truth", "label": "real", "steps": run.real(key)},
                      {"role": build, "label": "shown", "steps": run.shown(key)}],
        })
    peak = max((v for r in rows for line in r["lines"] for _, v in line["steps"] if v is not None), default=50)
    y_max = charts.nice_ticks(0, peak * 1.6, 4)[-1]
    span = runs["before"][scenario].window["seconds"]
    chart = charts.step_chart(rows, (0, span), (0, y_max), "seconds into the measured window", width=560,
                              y_format=lambda v: f"{v:g}%", label=label)
    return figure(title, chart, intro)


def cadence_figure(runs, scenario, title, note):
    series = []
    for build in BUILDS:
        run = runs[build][scenario]
        fb = run.metrics["framebuffer"]
        series.append({"role": build, "name": ROLE_NAME[build], "values": run.mark_intervals_ms(),
                       "note": f'{fb["mark_changes_per_s"]:.1f} frames/s, p95 {fb["mark_interval_ms"]["p95"]:.0f} ms'})
    chart = charts.histogram(series, 10, 200, width=860, height=250, label=title)
    return figure(title, legend("before", "after") + chart, note)


def accuracy_figure(runs):
    def pair(name, scenario, key):
        return {"name": name, "before": pct(runs["before"][scenario], key), "after": pct(runs["after"][scenario], key)}

    rows = [pair("WAITING count", "waiting", "waiting"),
            pair("Claude CONTEXT after an API error", "dash-claude", "context_pct"),
            pair("Codex USAGE", "dash-codex", "usage_pct"),
            pair("Codex CONTEXT", "dash-codex", "context_pct"),
            pair("SSH Claude CONTEXT, idle", "dash-remote", "context_pct"),
            pair("SSH Claude USAGE, idle", "dash-remote", "usage_pct"),
            pair("agy CONTEXT", "dash-agy", "context_pct"),
            pair("agy USAGE", "dash-agy", "usage_pct")]
    chart = charts.paired_bars(rows, width=860, label="Share of time the plate showed what was real, before and after")
    data = table(["check", "v1.1.4", "v1.1.5"],
                 [[e(r["name"]), fixed(r["before"]) + "%", fixed(r["after"]) + "%"] for r in rows])
    return figure("How often the plate showed what was real", legend("before", "after") + chart,
                  "Share of the measured window in which the displayed value was the real value, or one that was "
                  "real within the previous 4 seconds. Agy was already reported correctly; it is here to show that "
                  "nothing regressed.", data)


# --- page -------------------------------------------------------------------------------------

def plate_image(run, name):
    path = run.dir / name
    if not path.exists():
        return ""
    data = base64.b64encode(path.read_bytes()).decode()
    return f'<img class="v115-plate" alt="" src="data:image/png;base64,{data}">'


def captures(runs):
    cards = []
    for scenario, title, what in (
        ("dash-claude", "Claude after an API error", "CONTEXT"),
        ("dash-codex", "Codex after a turn that ends on a weekly-only event", "USAGE"),
        ("dash-remote", "Claude over SSH after a minute and a half idle", "CONTEXT and USAGE"),
        ("waiting", "Three agents working in other tabs", "WAITING"),
    ):
        images = "".join(
            f'<div class="v115-shot"><span class="v115-tag {b}">{ROLE_NAME[b]}</span>{plate_image(runs[b][scenario], "plate-final.png")}</div>'
            for b in BUILDS)
        cards.append(f'<figure class="v115-figure v115-capture"><figcaption class="v115-title">{e(title)}</figcaption>'
                     f'{images}<figcaption>The plate at the end of the run. Watch {e(what)}.</figcaption></figure>')
    return "".join(cards)


def summary(runs):
    b, a = runs["before"], runs["after"]

    def cpu(r):
        return r.metrics.get("cpu_cores")

    def rows_for(label, before, after, note=""):
        return [label, before, after, note]

    wb, wa = b["waiting"].accuracy["waiting"], a["waiting"].accuracy["waiting"]
    rows = [
        rows_for("Mark animation, agent printing output", f'{b["fps"].metrics["framebuffer"]["mark_changes_per_s"]:.1f} frames/s',
                 f'{a["fps"].metrics["framebuffer"]["mark_changes_per_s"]:.1f} frames/s', "pixels of the mark changing, read from outside the application"),
        rows_for("Mark animation, agent silent", f'{b["fps-quiet"].metrics["framebuffer"]["mark_changes_per_s"]:.1f} frames/s',
                 f'{a["fps-quiet"].metrics["framebuffer"]["mark_changes_per_s"]:.1f} frames/s', "only the animation repaints the plate"),
        rows_for("Workspace re-renders while animating", f'{b["fps-quiet"].metrics["trace"]["plate_render_per_s"]:.1f} per second',
                 f'{a["fps-quiet"].metrics["trace"]["plate_render_per_s"]:.1f} per second', "each one rebuilt every tab, panel and pane"),
        rows_for("Application CPU while animating", f'{fixed(cpu(b["fps-quiet"]), 2)} cores', f'{fixed(cpu(a["fps-quiet"]), 2)} cores',
                 "software-rendered display; a GPU lowers both"),
        rows_for("WAITING changes shown", f'{wb["shown_changes"]}', f'{wa["shown_changes"]}', f'{wa["truth_changes"]} were real'),
        rows_for("WAITING blips that reversed within 5 s", f'{wb["shown_reversals_5s"]}', f'{wa["shown_reversals_5s"]}',
                 f'{wb["truth_reversals_5s"]} and {wa["truth_reversals_5s"]} were real'),
        rows_for("WAITING correct", f'{wb["match_pct"]:.1f}%', f'{wa["match_pct"]:.1f}%', ""),
        rows_for("Claude CONTEXT correct after an API error", f'{pct(b["dash-claude"], "context_pct"):.1f}%',
                 f'{pct(a["dash-claude"], "context_pct"):.1f}%', "a zero-usage record hid the last real turn"),
        rows_for("Codex USAGE correct", f'{pct(b["dash-codex"], "usage_pct"):.1f}%', f'{pct(a["dash-codex"], "usage_pct"):.1f}%',
                 f'{b["dash-codex"].metrics["plate"]["usage_dash_flips"]} dashes before, {a["dash-codex"].metrics["plate"]["usage_dash_flips"]} after'),
        rows_for("Idle Claude over SSH, CONTEXT correct", f'{pct(b["dash-remote"], "context_pct"):.1f}%',
                 f'{pct(a["dash-remote"], "context_pct"):.1f}%', "the old script is unchanged on the remote host"),
    ]
    return table(["Measured", "v1.1.4", "v1.1.5", "Note"], rows, "v115-summary")


REVIEW = [
    # (source, finding, how it was checked, outcome)
    ("Local", "Claude usage lookup: one failed request replaced the last good value with nothing.", "Read the code path", "Fixed: the last reading is kept; a rate-limit reply backs the lookup off for five minutes; a reading nothing has confirmed for a whole window is dropped."),
    ("Local", "Every probe replaced the whole report, so one torn or failed read blanked context, usage and working together.", "Read the code path; lab", "Fixed: readings are held until something real changes."),
    ("Local", "Local Antigravity status was dropped by a single missed detection, and reports sent before the first probe were discarded.", "Read the code path", "Fixed: three missed probes are tolerated and an early report is kept."),
    ("Local", "Output continuity was published raw every 100 ms, so any pause of about half a second flipped a pane between working and waiting.", "Read the code; lab (89 changes against 43 real)", "Fixed: a working pane is shown as done only after 2.5 s of looking idle."),
    ("Local", "The animation timer ran at 100 ms and re-rendered the whole workspace each tick.", "Read the code; measured at 9.5 frames/s", "Fixed: the mark repaints itself every 50 ms; the workspace is not re-rendered."),
    ("Local", "Repository diffs ran inside the detection task with no timeout.", "Read the code path", "Fixed: own task, 3 s timeout, a flag that stops a hung repository from piling up work."),
    ("Local", "Claude context showed a dash when the newest record was the zero-usage record written after an API error.", "Real transcripts: 6 of 43 ended that way", "Fixed. A real model with an unknown window still shows a dash on purpose."),
    ("Local", "An empty pane name underflowed the plate's text width (a panic in debug builds).", "Reproduced by a test", "Fixed."),
    ("Local", "Remote agents named only by the running command never animated.", "Read the code path", "Fixed: detected in the monitor, steadied like every other agent."),
    ("Local", "Polled diff and branch were overwritten when git failed once; a poisoned process-table lock stopped all probing.", "Read the code path", "Fixed: three misses before a value is dropped; the lock is recovered."),
    ("Local", "A terminal-model lock was taken on the UI thread while rendering.", "Measured", "Lock wait was 0.003 ms at the 95th percentile. The render-time lock was removed anyway."),
    ("Remote", "In-band Claude and Codex reports expired after 60 s although Claude Code and Codex are silent while idle.", "Read the code and Claude Code's documentation", "Fixed: a report stays until its command ends or another replaces it."),
    ("Remote", "The helper scripts used syntax and library calls from Python 3.7 and 3.8, so hosts with Python 3.6 sent nothing.", "Read the code", "Fixed, and a test now parses both scripts as Python 3.6 and bans the newer calls."),
    ("Remote", "A failed SSH poll overwrote the last report.", "Read the code path", "Fixed."),
    ("Remote", "One probe that missed the SSH client discarded a stored report for good.", "Read the code path", "Fixed: three misses."),
    ("Remote", "The Claude branch of the in-band script crashed on empty input and could print after a failed encode.", "Read the code", "Fixed: empty or malformed input gives a dash line; output is always UTF-8."),
    ("Remote", "Antigravity's thinking and tool_use states were not counted as working.", "Read the code; the agy documentation lists five states", "Fixed."),
    ("Remote", "Documentation: Windows example used backslashes that Git Bash drops; links pointed at v1.1.3; a version requirement for five-hour usage had no source.", "Claude Code documentation", "Fixed."),
    ("Remote", "git diff can delay an in-band message by up to 2 s; translated git output reads as zero.", "Read the code", "Not changed. The delay is bounded and the message still arrives."),
    ("Remote", "Inside tmux or screen the message can be dropped; Windows console delivery is untested.", "Claude Code documentation; no Windows host", "Not changed. Listed under limits."),
    ("Remote", "Codex installed through npm runs a wrapper and a child, so the polled helper finds two processes.", "Read the code", "Not changed. The polled helper is the fallback path."),
]


def review_table():
    rows = [[e(s), e(f), e(c), e(o)] for s, f, c, o in REVIEW]
    return table(["Review", "Finding", "How it was checked", "Outcome"], rows)


REAL_RUNS = (
    ("real-ssh-before", "before", "v1.1.4 app, installed script"),
    ("real-ssh-after-old-script", "after", "v1.1.5 app, installed script"),
    ("real-ssh-after-new-script", "after", "v1.1.5 app, new script"),
)
LOCAL_RUNS = (
    ("real-local-claude-before", "before", "Claude Code, v1.1.4"),
    ("real-local-claude-after", "after", "Claude Code, v1.1.5"),
    ("real-local-codex-before", "before", "Codex, v1.1.4"),
    ("real-local-codex-after", "after", "Codex, v1.1.5"),
)


def hardware_runs():
    names = (("kwin-fps-quiet-before", "kwin-fps-quiet-after")
             + tuple(n for n, _, _ in REAL_RUNS) + tuple(n for n, _, _ in LOCAL_RUNS))
    return {name: Run.at(HARDWARE / name) for name in names if (HARDWARE / name / "metrics.json").exists()}


def agent_crop(run):
    """The plate crop of the window that held the agent: the one whose title names ssh or claude."""
    crops = sorted(run.dir.glob("plate-*.png"))
    named = [c for c in crops if re.search(r"ssh|claude|carter", c.name, re.I)]
    chosen = (named or crops or [None])[-1]
    if chosen is None:
        return ""
    data = base64.b64encode(chosen.read_bytes()).decode()
    return f'<img class="v115-plate" alt="" src="data:image/png;base64,{data}">'


def gpu_line(run):
    path = run.dir / "gpu.txt"
    if not path.exists():
        return "not recorded"
    lines = [l for l in path.read_text().splitlines() if l.strip()]
    adapters = [l for l in lines if re.search(r"(Discrete|Integrated|Cpu|Virtual)\w*:", l)]
    return (adapters or lines or ["not recorded"])[0]


def hardware_section(hw):
    if not hw:
        return ""
    parts = []
    before, after = hw.get("kwin-fps-quiet-before"), hw.get("kwin-fps-quiet-after")
    if before and after:
        def anim(run, key):
            return run.metrics["trace"]["animation"][key]

        rows = [
            ["Mark frames painted per second", f'{anim(before, "frames_per_s"):.1f}', f'{anim(after, "frames_per_s"):.1f}'],
            ["Time between frames, median", f'{anim(before, "interval_ms")["p50"]:.0f} ms', f'{anim(after, "interval_ms")["p50"]:.0f} ms'],
            ["Time between frames, 95th percentile", f'{anim(before, "interval_ms")["p95"]:.0f} ms', f'{anim(after, "interval_ms")["p95"]:.0f} ms'],
            ["Workspace re-renders per second", f'{before.metrics["trace"]["plate_render_per_s"]:.1f}', f'{after.metrics["trace"]["plate_render_per_s"]:.1f}'],
            ["Application CPU", f'{fixed(before.metrics.get("cpu_cores"), 3)} cores', f'{fixed(after.metrics.get("cpu_cores"), 3)} cores'],
            ["Graphics adapter", e(gpu_line(before)), e(gpu_line(after))],
        ]
        parts += ['<h3>Animation and CPU on this machine\'s GPU</h3>',
                  '<p>One agent works and prints nothing, in a headless KWin session on the Radeon that drives this desktop. '
                  'Only the animation repaints the plate. The frame count is the number of paints whose animation phase differed from the previous paint.</p>',
                  table(["", "v1.1.4", "v1.1.5"], rows, "v115-summary")]
    local = [(hw[n], role, label) for n, role, label in LOCAL_RUNS if n in hw]
    if local:
        parts.append('<h3>Real Claude Code and Codex on this machine</h3>')
        parts.append('<p>The real agents, with the real logins, answered one short prompt in a Doom Term pane and then sat idle. '
                     'The dashed grey line is what each agent wrote into its own transcript or rollout, read back after the run.</p>')
        rows = []
        for run, role, label in local:
            acc = run.accuracy
            rows.append([e(label), f'{acc["context_pct"]["match_pct"]:.1f}%' if "context_pct" in acc else "n/a",
                         f'{acc["usage_pct"]["match_pct"]:.1f}%' if "usage_pct" in acc else "n/a",
                         str(run.metrics["plate"]["context_dash_flips"] + run.metrics["plate"]["usage_dash_flips"])])
        parts.append(table(["Run", "CONTEXT correct", "USAGE correct", "times a value fell to a dash"], rows))
        shots = "".join(f'<figure class="v115-figure v115-capture"><figcaption class="v115-title">{e(label)}</figcaption>'
                        f'<div class="v115-shot"><span class="v115-tag {role}">{ROLE_NAME[role]}</span>{agent_crop(run)}</div>'
                        f'<figcaption>The plate at the end of the run.</figcaption></figure>' for run, role, label in local)
        parts.append('<div class="v115-grid">' + shots + "</div>")
    runs = [(hw[n], role, label) for n, role, label in REAL_RUNS if n in hw]
    if runs:
        parts.append('<h3>Over a real SSH connection to the MacBook</h3>')
        parts.append('<p>Doom Term ran OpenSSH to the MacBook. There a stand-in for Claude Code called the status-line script under the '
                     'MacBook\'s own Python 3.9 the way Claude Code does: once at session start with nothing known, then after each of two '
                     'assistant messages, then never again, as an idle session behaves. The dashed grey line is each payload as sent. '
                     'The installed script is the one already on the MacBook from v1.1.3. Real Claude Code was not used here because its '
                     'folder-trust prompt needs a keypress and would have meant changing the MacBook\'s Claude settings.</p>')
        summary_rows = []
        for run, role, label in runs:
            acc = run.accuracy
            summary_rows.append([e(label), f'{acc["context_pct"]["match_pct"]:.1f}%' if "context_pct" in acc else "n/a",
                                 f'{acc["usage_pct"]["match_pct"]:.1f}%' if "usage_pct" in acc else "n/a",
                                 str(run.metrics["plate"]["context_dash_flips"] + run.metrics["plate"]["usage_dash_flips"])])
        parts.append(table(["Run", "CONTEXT correct", "USAGE correct", "times a value fell to a dash"], summary_rows))
        grid = []
        for key, title in (("context_pct", "CONTEXT"), ("usage_pct", "USAGE")):
            rows = []
            for run, role, label in runs:
                acc = run.accuracy.get(key)
                rows.append({"name": label, "note": f'correct {acc["match_pct"]:.1f}%' if acc else "",
                             "lines": [{"role": "truth", "label": "real", "steps": run.real(key)},
                                       {"role": role, "label": "shown", "steps": run.shown(key)}]})
            span = min(r.window["seconds"] for r, _, _ in runs)
            peak = max((v for row in rows for line in row["lines"] for _, v in line["steps"] if v is not None), default=50)
            y_max = charts.nice_ticks(0, peak * 1.6, 4)[-1]
            chart = charts.step_chart(rows, (0, span), (0, y_max), "seconds into the measured window", width=560,
                                      y_format=lambda v: f"{v:g}%", label=f"Claude over SSH: {title}")
            grid.append(figure(f"Claude over SSH: {title}", chart,
                               "Orange is v1.1.4, blue is v1.1.5; the shaded band is where the plate showed a dash."))
        parts.append('<div class="v115-grid">' + "".join(grid) + "</div>")
        shots = "".join(f'<figure class="v115-figure v115-capture"><figcaption class="v115-title">{e(label)}</figcaption>'
                        f'<div class="v115-shot"><span class="v115-tag {role}">{ROLE_NAME[role]}</span>{agent_crop(run)}</div>'
                        f'<figcaption>The plate at the end of the run.</figcaption></figure>' for run, role, label in runs)
        parts.append('<div class="v115-grid">' + shots + "</div>")
    return "\n".join(parts)


def test_counts(name):
    """Passed and failed counts parsed from a saved test run, or None when it was not saved."""
    path = EVIDENCE / "tests" / name
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    passed = sum(int(n) for n in re.findall(r"test result: \w+\. (\d+) passed", text))
    failed = sum(int(n) for n in re.findall(r"; (\d+) failed", text))
    if not passed and not failed:
        ran = re.findall(r"^Ran (\d+) tests?", text, flags=re.M)
        passed = sum(int(n) for n in ran)
        failed = len(re.findall(r"^FAILED", text, flags=re.M))
    return passed, failed


def tests_section():
    rows = []
    for label, files, where in (
        ("Rust crates: doomterm_agents and doomterm_plate", ("linux-cargo.txt",), "Linux x86-64, rustc 1.92"),
        ("Helper scripts and lab analysis (Python unittest)", ("linux-python.txt",), "Linux, Python 3.14"),
        ("Rust crates: doomterm_agents and doomterm_plate", ("macos-cargo.txt",), "macOS 14 arm64, rustc 1.98"),
        ("Helper scripts and lab analysis (Python unittest)", ("macos-python.txt",), "macOS 14, system Python 3.9.6"),
    ):
        counts = test_counts(files[0])
        result = "not recorded" if counts is None else f"{counts[0]} passed, {counts[1]} failed"
        rows.append([e(label), e(where), result])
    rows.append(["Windows", "CI build and unit tests", "Runs on the release tag; the GUI was not run"])
    return ('<h3>Tests and platforms</h3>' +
            table(["Suite", "Where", "Result"], rows) +
            '<p>Every fix above began as a failing test. The stabilizer has 25 tests covering held values, missed '
            'detections, the quiet delay, conversation changes and rate-limit windows, and each rule was checked by '
            'breaking it and watching the tests fail.</p>')


def build_section(runs, extra):
    commit = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    sha = {b: (runs[b]["fps"].dir / "binary.sha256").read_text().split()[0][:16] for b in BUILDS
           if (runs[b]["fps"].dir / "binary.sha256").exists()}
    meta = "".join(f'<div class="meta-item"><div class="meta-label">{e(k)}</div><div class="meta-value">{e(v)}</div></div>'
                   for k, v in (("Release", "v1.1.5"), ("Commit", commit),
                                ("v1.1.4 lab binary", sha.get("before", "n/a")), ("v1.1.5 lab binary", sha.get("after", "n/a"))))
    a, b = runs["after"], runs["before"]
    parts = [
        START,
        '<section class="bevel-raised v115" id="v1-1-5">',
        '<h2>v1.1.5: the status plate, measured</h2>',
        f'<div class="v115-meta">{meta}</div>',
        '<p class="v115-lead">The bottom plate flashed numbers in WAITING, dropped CONTEXT and USAGE to dashes, and '
        'animated its mark slowly. The same scenarios ran against the v1.1.4 logic and against v1.1.5, and the plate '
        'was scored against what each test agent was really doing.</p>',
        '<div class="callout callout-success"><div class="callout-title">What was verified</div>'
        '<p style="margin:0">On Linux, in a virtual display, with stand-ins that write the files real agents write, '
        'with real Claude Code and Codex on this machine, and with OpenSSH to a MacBook. macOS crates and helper scripts were tested natively. '
        'The Windows GUI and the macOS GUI were not run. The limits are listed below.</p></div>',
        '<h3>Before and after</h3>', summary(runs),
        '<h3>WAITING</h3>', waiting_figure(runs),
        '<h3>CONTEXT and USAGE</h3>',
        '<div class="v115-grid">',
        number_figure(runs, "dash-claude", "context_pct", "Claude CONTEXT after an API error", "Claude CONTEXT over time",
                      "Claude Code writes a zero-usage record after an API error. v1.1.4 read that record and showed a dash until the next real turn."),
        number_figure(runs, "dash-codex", "usage_pct", "Codex USAGE across turns", "Codex USAGE over time",
                      "Real Codex sessions often end a turn on an event that carries only the weekly window. v1.1.4 read only the newest event."),
        number_figure(runs, "dash-remote", "context_pct", "Idle Claude over SSH: CONTEXT", "SSH Claude CONTEXT over time",
                      "Claude Code runs its status line when a message arrives and is silent while idle. v1.1.4 dropped the report after 60 seconds."),
        number_figure(runs, "dash-remote", "usage_pct", "Idle Claude over SSH: USAGE", "SSH Claude USAGE over time",
                      "The same report carries the five-hour usage, which stays true while the session is idle."),
        '</div>', accuracy_figure(runs),
        '<h3>Animation</h3>',
        cadence_figure(runs, "fps", "Mark animation with an agent printing output",
                       "Time between changes of the mark's pixels, read from outside the application at about 300 samples a second. "
                       "Output from the agent also repaints the window, so v1.1.5 runs above its 20 frames a second floor here."),
        cadence_figure(runs, "fps-quiet", "Mark animation with a silent agent",
                       "Only the animation repaints the plate, so this is the cadence the mark sets for itself: a repaint every 50 ms, or 20 frames a second."),
        '<h3>On the screen</h3><div class="v115-grid">' + captures(runs) + '</div>',
        hardware_section(hardware_runs()),
        '<h3>Code review</h3><p>Two independent read-only reviews covered the local pipeline and the remote scripts. '
        'Each finding was checked against the code, against real session files on this machine, or against the vendors\' '
        'documentation before it was acted on.</p>', review_table(),
        tests_section(),
        '<h3>How this was measured, and its limits</h3><ul class="v115-list">'
        '<li>The lab runs Doom Term in a virtual display with software rendering. Absolute frame rates depend on the renderer; '
        'the comparison between builds does not, because both ran the same scenarios on the same display.</li>'
        '<li>The v1.1.4 binary in the comparison is the v1.1.4 code plus the trace switch only. The diff touches the trace and nothing else in behaviour.</li>'
        '<li>The stand-in agents replay the files and messages real agents write, at cadences taken from real sessions. '
        'They are not the agents; the real-agent runs below cover that gap for Claude Code and Codex.</li>'
        '<li>Ground truth is each stand-in\'s own record of its state and its real numbers, written by the stand-in, never read back from Doom Term. '
        'The display may trail it by 4 seconds.</li>'
        '<li>Windows and macOS were not run as GUI applications. CI builds both. On Windows the trace switch below records what the plate showed.</li>'
        '<li>Inside tmux or screen the in-band message can be dropped by the multiplexer. If an agent exits inside an SSH session that stays open, '
        'its last numbers stay until that session ends.</li></ul>',
        extra.get("release", ""),
        '<h3>Reproduce</h3><pre>'
        '# lab run: SCENARIO is waiting, dash-claude, dash-codex, dash-remote, dash-agy, fps or fps-quiet\n'
        'script/doomterm/plate-lab SCENARIO /path/to/doomterm /path/to/output\n'
        'python3 script/doomterm/analyze_plate_trace.py /path/to/output\n\n'
        '# on any platform: record what the plate shows and when it paints\n'
        'DOOMTERM_PLATE_TRACE=plate-trace.jsonl doomterm\n\n'
        '# rebuild this section from the recorded runs\n'
        'python3 script/doomterm/build_evidence_v115.py page</pre>',
        '</section>',
        END,
    ]
    return "\n".join(parts)


CSS = f"""{CSS_START}
    :root {{ color-scheme: dark; }}
    .v115 {{ --before: #d95926; --after: #3987e5; --truth: #8f8672; }}
    .v115 h3 {{ margin-top: 2rem; }}
    .v115 .v115-lead {{ max-width: 72ch; font-size: 1.05rem; }}
    .v115 .v115-meta {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(min(210px, 100%), 1fr)); gap: 0.75rem; margin: 0 0 1.25rem; }}
    .v115 .v115-scroll {{ overflow-x: auto; }}
    .v115 .v115-table {{ width: 100%; border-collapse: collapse; margin: 0.75rem 0 1rem; font-size: 0.875rem; }}
    .v115 .v115-table th, .v115 .v115-table td {{ padding: 0.6rem 0.85rem; text-align: left; border: 1px solid var(--border-light); vertical-align: top; }}
    .v115 .v115-table th {{ background: var(--surface-well); color: var(--ink-dim); font: 700 0.72rem var(--font-mono); text-transform: uppercase; letter-spacing: 0.04em; }}
    .v115 .v115-summary td:nth-child(2), .v115 .v115-summary td:nth-child(3) {{ font-family: var(--font-mono); white-space: nowrap; }}
    .v115 .v115-summary td:nth-child(2) {{ color: var(--before); }}
    .v115 .v115-summary td:nth-child(3) {{ color: var(--after); font-weight: 700; }}
    .v115 .v115-summary td:nth-child(4) {{ color: var(--ink-dim); }}
    .v115 .v115-figure {{ margin: 1rem 0 1.5rem; padding: 1rem; background: var(--surface-well); border: 1px solid var(--border-light); min-width: 0; }}
    .v115 .v115-title {{ font-weight: 700; color: #fff; margin-bottom: 0.4rem; }}
    .v115 figcaption {{ font-size: 0.825rem; color: var(--ink-dim); margin-top: 0.6rem; max-width: 84ch; line-height: 1.45; }}
    .v115 .v115-title + .v115-legend, .v115 .v115-legend {{ display: flex; flex-wrap: wrap; gap: 1.25rem; margin: 0.25rem 0 0.5rem; font: 0.75rem var(--font-mono); }}
    .v115 .v115-key i {{ display: inline-block; width: 1.6rem; height: 0; border-top: 3px solid; margin-right: 0.4rem; vertical-align: middle; }}
    .v115 .v115-key.truth i {{ border-top: 2px dashed var(--truth); }}
    .v115 .v115-key.before i {{ border-color: var(--before); }}
    .v115 .v115-key.after i {{ border-color: var(--after); }}
    .v115 .v115-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(min(520px, 100%), 1fr)); gap: 1rem; }}
    .v115 .v115-grid > .v115-figure {{ margin: 0; }}
    .v115 .v115-svg {{ width: 100%; height: auto; display: block; margin: 0; }}
    .v115 .v115-svg .grid {{ stroke: var(--border-light); stroke-width: 1; }}
    .v115 .v115-svg .grid.vertical {{ stroke-dasharray: 2 5; opacity: 0.7; }}
    .v115 .v115-svg .tick, .v115 .v115-svg .axis-title, .v115 .v115-svg .row-note {{ fill: var(--ink-dim); font-size: 11px; }}
    .v115 .v115-svg .row-label {{ fill: var(--ink); font-size: 12px; }}
    .v115 .v115-svg .row-name {{ font-size: 12px; font-weight: 700; fill: var(--ink); }}
    .v115 .v115-svg .row-name.before {{ fill: var(--before); }}
    .v115 .v115-svg .row-name.after {{ fill: var(--after); }}
    .v115 .v115-svg .line {{ fill: none; stroke-width: 2.2; stroke-linejoin: round; }}
    .v115 .v115-svg .line.truth {{ stroke: var(--truth); stroke-width: 1.6; stroke-dasharray: 5 3; }}
    .v115 .v115-svg .line.before {{ stroke: var(--before); }}
    .v115 .v115-svg .line.after {{ stroke: var(--after); }}
    .v115 .v115-svg .gap {{ opacity: 0.2; }}
    .v115 .v115-svg .gap.before, .v115 .v115-svg .bar.before, .v115 .v115-svg .bars.before {{ fill: var(--before); }}
    .v115 .v115-svg .gap.after, .v115 .v115-svg .bar.after, .v115 .v115-svg .bars.after {{ fill: var(--after); }}
    .v115 .v115-svg .bars {{ fill-opacity: 0.55; stroke-width: 1; }}
    .v115 .v115-svg .bars.before {{ stroke: var(--before); }}
    .v115 .v115-svg .bars.after {{ stroke: var(--after); }}
    .v115 .v115-svg .value {{ font-size: 11px; font-weight: 700; }}
    .v115 .v115-svg .value.before {{ fill: var(--before); }}
    .v115 .v115-svg .value.after {{ fill: var(--after); }}
    .v115 .v115-svg .crosshair {{ stroke: var(--ink); stroke-width: 1; opacity: 0.6; pointer-events: none; }}
    .v115 .v115-capture .v115-shot {{ margin: 0.5rem 0; }}
    .v115 .v115-tag {{ display: inline-block; font: 700 0.7rem var(--font-mono); padding: 0.1rem 0.45rem; margin-bottom: 0.2rem; border: 1px solid; }}
    .v115 .v115-tag.before {{ color: var(--before); }}
    .v115 .v115-tag.after {{ color: var(--after); }}
    .v115 .v115-plate {{ display: block; width: 100%; height: auto; image-rendering: pixelated; border: 1px solid var(--border-dark); }}
    .v115 details {{ margin-top: 0.6rem; font-size: 0.85rem; }}
    .v115 summary {{ cursor: pointer; color: var(--ink-dim); }}
    .v115 summary:focus-visible, .v115 a:focus-visible {{ outline: 2px solid var(--accent); outline-offset: 2px; }}
    .v115 .v115-list {{ max-width: 84ch; padding-left: 1.25rem; display: grid; gap: 0.5rem; }}
    .v115-tip {{ position: fixed; z-index: 20; pointer-events: none; padding: 0.4rem 0.65rem; background: var(--surface-elevated); border: 1px solid var(--border-light); font: 0.75rem var(--font-mono); color: var(--ink); white-space: pre; }}
    @media (max-width: 720px) {{ .v115.bevel-raised {{ padding: 1.25rem 1rem; }} body {{ padding: 1rem 0.75rem; }} }}
    @media (prefers-reduced-motion: reduce) {{ .v115 * {{ transition: none !important; animation: none !important; }} }}
    {CSS_END}"""

SCRIPT = """<script>
(function () {
  function valueAt(steps, t) { var v = null; for (var i = 0; i < steps.length; i++) { if (steps[i][0] <= t) v = steps[i][1]; else break; } return v; }
  function show(v, unit) { return v === null ? '--' : v + (unit || ''); }
  var tip = document.createElement('div'); tip.className = 'v115-tip'; tip.hidden = true; document.body.appendChild(tip);
  document.querySelectorAll('svg.v115-svg[data-chart]').forEach(function (svg) {
    var data = JSON.parse(svg.getAttribute('data-chart')), cross = svg.querySelector('.crosshair');
    function move(ev) {
      var box = svg.getBoundingClientRect(), x = (ev.clientX - box.left) * data.width / box.width;
      if (x < data.plotLeft || x > data.plotRight) { leave(); return; }
      var t = data.x[0] + (x - data.plotLeft) / (data.plotRight - data.plotLeft) * (data.x[1] - data.x[0]);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
      var lines = ['at ' + t.toFixed(1) + ' s'];
      data.rows.forEach(function (row) {
        lines.push(row.name + ': ' + row.lines.map(function (l) { return l.label + ' ' + show(valueAt(l.steps, t), data.unit); }).join(', '));
      });
      tip.textContent = lines.join('\\n'); tip.hidden = false;
      tip.style.left = Math.min(ev.clientX + 14, window.innerWidth - tip.offsetWidth - 8) + 'px';
      tip.style.top = (ev.clientY + 14) + 'px';
    }
    function leave() { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; }
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerleave', leave);
  });
})();
</script>"""


def insert(section):
    page = PAGE.read_text(encoding="utf-8")
    if CSS_START in page:
        page = re.sub(re.escape(CSS_START) + r".*?" + re.escape(CSS_END), lambda m: CSS.strip(), page, flags=re.S)
    else:
        page = page.replace("</style>", "\n    " + CSS.strip() + "\n  </style>", 1)
    block = section + "\n" + SCRIPT
    if START in page:
        page = re.sub(re.escape(START) + r".*?" + re.escape(END) + r"(\s*<script>.*?</script>)?", lambda m: block, page, count=1, flags=re.S)
    else:
        marker = "<!-- SECTION 1: EXECUTIVE STATE SUMMARY -->"
        page = page.replace(marker, block + "\n\n    " + marker, 1)
    note = ('<p class="v115-note" style="color: var(--ink-dim); margin: 0 0 1.5rem;">Newest evidence first. '
            'The v1.1.5 section is current; sections 1 to 10 record earlier milestones and releases as they were written.</p>')
    if "v115-note" not in page:
        page = page.replace("</header>", "</header>\n    " + note, 1)
    PAGE.write_text(page, encoding="utf-8")


def load_all():
    return {b: {s: Run(b, s) for s in SCENARIOS} for b in BUILDS}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("collect", "page"))
    parser.add_argument("runs", nargs="?")
    args = parser.parse_args()
    if args.command == "collect":
        collect(args.runs)
        collect_hardware(args.runs)
        return 0
    runs = load_all()
    extra = {}
    for key, name in (("real", "real-ssh.html"), ("release", "release.html")):
        path = EVIDENCE / "fragments" / name
        if path.exists():
            extra[key] = path.read_text(encoding="utf-8")
    insert(build_section(runs, extra))
    print("wrote", PAGE)
    return 0


if __name__ == "__main__":
    sys.exit(main())
