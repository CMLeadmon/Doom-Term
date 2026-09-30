#!/usr/bin/env python3
"""Drives Doom Term inside the plate lab's virtual display. Runs in the lab container.

  lab_driver.py SCENARIO --out DIR [--seconds N]

It opens tabs, starts the fake agents from script/doomterm/lab/bin, holds for the scenario's
duration and records screenshots and wall-clock markers. What the plate did is read from the
application's own trace and from the framebuffer sampler the runner starts on the host.
"""

import argparse
import glob
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

WINDOW_CLASS = "io.cmleadmon.DoomTerm"
WINDOW_WIDTH, WINDOW_HEIGHT = 1920, 1000
PLATE_LOGICAL_HEIGHT = 29
SCALE_DEFAULT = 3
COMPACT_MIN_W = 240

# Logical plate pixels (x0, y0, x1, y1), from doomterm_plate's layout.
REGIONS = {
    "mark": (107, 1, 131, 28),
    "context": (1, 2, 48, 17),
    "usage": (50, 2, 98, 17),
    "waiting_count": (338, 11, 384, 27),
    "waiting_rows": (392, 4, 560, 27),
}


def run(*command, check=True):
    return subprocess.run(command, check=check, capture_output=True, text=True).stdout


class Lab:
    def __init__(self, out_dir):
        self.out = Path(out_dir)
        self.window = None
        self.started = time.time()

    def marker(self, name, **extra):
        record = {"name": name, "wall": time.time(), **extra}
        with (self.out / "markers.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record) + "\n")
        print(f"[{time.time() - self.started:7.1f}s] {name}", flush=True)

    def find_window(self, timeout=120):
        end = time.time() + timeout
        while time.time() < end:
            found = run("xdotool", "search", "--onlyvisible", "--class", WINDOW_CLASS, check=False)
            ids = found.split()
            if ids:
                self.window = ids[0]
                return
            time.sleep(1)
        raise SystemExit("the Doom Term window never appeared")

    def arrange_window(self):
        run("xdotool", "windowmove", self.window, "0", "0")
        run("xdotool", "windowsize", "--sync", self.window, str(WINDOW_WIDTH), str(WINDOW_HEIGHT))
        run("xdotool", "windowactivate", "--sync", self.window, check=False)
        time.sleep(1)

    def bootstrapped_count(self):
        total = 0
        for path in glob.glob(os.path.expanduser("~/.local/state/*/doomterm*.log")):
            try:
                total += Path(path).read_text(errors="replace").count("Shell is bootstrapped")
            except OSError:
                pass
        return total

    def wait_bootstrapped(self, count, timeout=60):
        end = time.time() + timeout
        while time.time() < end:
            if self.bootstrapped_count() >= count:
                return
            time.sleep(0.5)
        print(f"warning: fewer than {count} shells bootstrapped", flush=True)

    def key(self, combo):
        run("xdotool", "key", "--clearmodifiers", combo)

    def type_line(self, text):
        run("xdotool", "type", "--clearmodifiers", "--delay", "25", text)
        run("xdotool", "key", "Return")

    def new_tab(self, expected_shells):
        self.key("ctrl+shift+t")
        self.wait_bootstrapped(expected_shells)
        time.sleep(1)

    def screenshot(self, name):
        run("import", "-window", "root", str(self.out / f"{name}.png"), check=False)

    def write_regions(self):
        info = run("xwininfo", "-id", self.window)
        x = int(re.search(r"Absolute upper-left X:\s+(-?\d+)", info).group(1))
        y = int(re.search(r"Absolute upper-left Y:\s+(-?\d+)", info).group(1))
        width = int(re.search(r"Width:\s+(\d+)", info).group(1))
        height = int(re.search(r"Height:\s+(\d+)", info).group(1))
        scale = next(
            (s for s in range(SCALE_DEFAULT, 0, -1) if width / s >= COMPACT_MIN_W), 1
        )
        plate_y = y + height - PLATE_LOGICAL_HEIGHT * scale
        regions = {
            name: [
                x + x0 * scale,
                plate_y + y0 * scale,
                x + x1 * scale,
                plate_y + y1 * scale,
            ]
            for name, (x0, y0, x1, y1) in REGIONS.items()
        }
        geometry = {"window": [x, y, width, height], "scale": scale, "regions": regions}
        (self.out / "regions.json").write_text(json.dumps(geometry, indent=1), encoding="utf-8")
        return geometry

    def hold(self, seconds, label):
        """Waits, taking a screenshot every 30 s."""
        end = time.time() + seconds
        shots = 0
        while time.time() < end:
            time.sleep(min(30, max(0.0, end - time.time())))
            shots += 1
            self.screenshot(f"{label}-{shots:02d}")


def scenario_waiting(lab, seconds):
    """Other panes run agents whose output pauses between bursts; the focused pane is a shell."""
    lab.new_tab(2)
    lab.type_line("agy --pattern=bursty")
    lab.new_tab(3)
    lab.type_line("codex --pattern=cycle")
    lab.new_tab(4)
    lab.type_line("claude --pattern=cycle")
    lab.key("ctrl+1")
    time.sleep(2)
    lab.marker("steady-start")
    lab.hold(seconds, "waiting")
    lab.marker("steady-end")


def scenario_dash_claude(lab, seconds):
    """The focused pane's Claude hits an API error 25 s in; the transcript then ends in a
    zero-usage record."""
    lab.type_line("claude --pattern=cycle --tail=synthetic@25")
    lab.marker("agent-started")
    lab.hold(seconds, "dash-claude")
    lab.marker("agent-end")


def scenario_dash_codex(lab, seconds):
    """The focused pane's Codex ends every turn on an event without the 5-hour window."""
    lab.type_line("codex --pattern=cycle --windows=flap")
    lab.marker("agent-started")
    lab.hold(seconds, "dash-codex")
    lab.marker("agent-end")


def scenario_dash_remote(lab, seconds):
    """An SSH pane whose remote Claude reports twice and then goes quiet, as an idle one does."""
    lab.type_line("ssh lab@fakehost --lab-agent=claude")
    lab.marker("agent-started")
    lab.hold(seconds, "dash-remote")
    lab.marker("agent-end")


def scenario_dash_agy(lab, seconds):
    """The focused pane's agy walks the turn states a real one reports."""
    lab.type_line("agy --pattern=bursty")
    lab.marker("agent-started")
    lab.hold(seconds, "dash-agy")
    lab.marker("agent-end")


def scenario_fps(lab, seconds):
    """One agent working continuously in the focused pane."""
    lab.type_line("claude --pattern=steady")
    lab.marker("agent-started")
    lab.hold(seconds, "fps")
    lab.marker("agent-end")


SCENARIOS = {
    "waiting": (scenario_waiting, 120),
    "dash-claude": (scenario_dash_claude, 100),
    "dash-codex": (scenario_dash_codex, 100),
    "dash-remote": (scenario_dash_remote, 130),
    "dash-agy": (scenario_dash_agy, 100),
    "fps": (scenario_fps, 60),
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("scenario", choices=sorted(SCENARIOS))
    parser.add_argument("--out", required=True)
    parser.add_argument("--seconds", type=int)
    args = parser.parse_args()
    function, default_seconds = SCENARIOS[args.scenario]
    lab = Lab(args.out)
    lab.find_window()
    lab.arrange_window()
    lab.wait_bootstrapped(1)
    time.sleep(2)
    geometry = lab.write_regions()
    lab.marker("ready", geometry=geometry)
    lab.screenshot("ready")
    function(lab, args.seconds or default_seconds)
    lab.screenshot("final")
    lab.marker("done")


if __name__ == "__main__":
    sys.exit(main())
