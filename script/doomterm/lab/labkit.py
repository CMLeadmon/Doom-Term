"""Shared pieces of the plate lab's fake agents.

Each fake reproduces the files a real agent writes and the terminal output cadence a real agent
shows, so the status plate is exercised through the same code paths a real session uses. The
fakes are Python scripts named after the agent because the foreground probe identifies an
interpreter's script, not the interpreter.
"""

import json
import os
import random
import re
import signal
import sys
import time
import uuid
from pathlib import Path

LAB_DIR = Path(__file__).resolve().parent
REPO_ROOT = LAB_DIR.parent.parent.parent


def home():
    return Path(os.environ.get("HOME") or Path.home())


def now_ms():
    return int(time.time() * 1000)


def option(name, default):
    """Value of `--name=value` on the command line, else `default`."""
    prefix = f"--{name}="
    for argument in sys.argv[1:]:
        if argument.startswith(prefix):
            return argument[len(prefix):]
    return default


def seconds(name, default):
    return float(option(name, default))


def truth(**fields):
    """Records what is really true of this fake at this moment, for scoring the plate against.

    Written to $LAB_TRUTH when the lab sets it: the fake's own state and the numbers it has really
    reported, never anything read back from Doom Term.
    """
    path = os.environ.get("LAB_TRUTH")
    if path:
        append_json_line(Path(path), {"wall": time.time(), "pid": os.getpid(), **fields})


def append_json_line(path, record):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(record, separators=(",", ":")) + "\n")


def clean_up_on_signal(callback):
    def handler(_signum, _frame):
        callback()
        truth(event="exit")
        sys.stdout.write("\n")
        sys.stdout.flush()
        os._exit(0)

    signal.signal(signal.SIGINT, handler)
    signal.signal(signal.SIGTERM, handler)


def paint_footer(text):
    """Repaints a status footer in place, the way an idle agent CLI does."""
    sys.stdout.write(f"\x1b7\x1b[999;1H\x1b[2K{text}\x1b8")
    sys.stdout.flush()


def stream_token_line(step):
    frames = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
    sys.stdout.write(f"\r{frames[step % len(frames)]} working {'.' * (step % 4)}   ")
    sys.stdout.flush()


def idle_for(duration, footer="? for shortcuts"):
    """An idle prompt: one footer repaint every 1.3-2.0 s, never continuous output."""
    end = time.monotonic() + duration
    while time.monotonic() < end:
        paint_footer(footer)
        time.sleep(min(random.uniform(1.3, 2.0), max(0.0, end - time.monotonic())))


def work_for(duration, pause_chance=0.0):
    """A working turn: dense output, optionally with the silent gaps real agents show while they
    wait on a tool or a network call."""
    end = time.monotonic() + duration
    step = 0
    while time.monotonic() < end:
        stream_token_line(step)
        step += 1
        time.sleep(0.08)
        if pause_chance and random.random() < pause_chance:
            time.sleep(random.uniform(0.7, 1.6))


def in_band_script():
    """The in-band status script under test: `--script=PATH`, else $LAB_IN_BAND_SCRIPT, else the
    one in this checkout."""
    default = os.environ.get(
        "LAB_IN_BAND_SCRIPT", str(REPO_ROOT / "script" / "doomterm" / "in_band_agent_status.py")
    )
    return option("script", default)


def claude_slug(cwd):
    return re.sub(r"[^A-Za-z0-9-]", "-", str(cwd))


def new_id():
    return str(uuid.uuid4())
