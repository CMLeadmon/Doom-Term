#!/usr/bin/env python3
"""Appends a marker with the application's CPU time so far: cpu_marker.py NAME MARKERS_FILE."""

import json
import os
import sys
import time


def doomterm_cpu_ticks():
    best = 0
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            with open(f"/proc/{pid}/comm", encoding="utf-8") as stream:
                if stream.read().strip() != "doomterm":
                    continue
            with open(f"/proc/{pid}/stat", encoding="utf-8") as stream:
                fields = stream.read().rpartition(")")[2].split()
            best = max(best, int(fields[11]) + int(fields[12]))
        except (OSError, ValueError, IndexError):
            continue
    return best


if __name__ == "__main__":
    name, path = sys.argv[1:3]
    with open(path, "a", encoding="utf-8") as stream:
        stream.write(json.dumps({"name": name, "wall": time.time(), "cpu_ticks": doomterm_cpu_ticks(),
                                 "clk_tck": os.sysconf("SC_CLK_TCK")}) + "\n")
