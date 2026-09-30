#!/usr/bin/env python3
"""Watches regions of an Xvfb framebuffer and records when each one changes.

  fb_sampler.py --fb DIR/Xvfb_screen0 --regions regions.json --out fb.jsonl --stop stopfile

Xvfb started with `-fbdir` keeps its screen in an XWD file that can be memory-mapped, so the
application is observed from outside, at a few hundred samples a second, without an X client or
any cooperation from the binary under test. Each output line is one change of one region.
"""

import argparse
import json
import struct
import sys
import time
import zlib
from pathlib import Path

import numpy as np


def open_framebuffer(path):
    with open(path, "rb") as stream:
        header = struct.unpack(">25I", stream.read(100))
    header_size, width, height = header[0], header[4], header[5]
    bytes_per_line, ncolors = header[12], header[19]
    offset = header_size + ncolors * 12
    mapped = np.memmap(path, dtype=np.uint8, mode="r", offset=offset, shape=(height, bytes_per_line))
    return mapped[:, : width * 4].reshape(height, width, 4)


def wait_for(path, stop, timeout=180):
    end = time.time() + timeout
    while time.time() < end and not Path(stop).exists():
        if Path(path).exists():
            return True
        time.sleep(0.2)
    return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fb", required=True)
    parser.add_argument("--regions", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--stop", required=True)
    parser.add_argument("--period", type=float, default=0.003)
    args = parser.parse_args()

    if not wait_for(args.fb, args.stop) or not wait_for(args.regions, args.stop):
        return 1
    time.sleep(0.2)
    screen = open_framebuffer(args.fb)
    regions = json.loads(Path(args.regions).read_text())["regions"]
    last = {}
    started = time.perf_counter()
    loops = 0
    with open(args.out, "w", encoding="utf-8") as out:
        while not Path(args.stop).exists():
            now = time.perf_counter() - started
            wall = time.time()
            for name, (x0, y0, x1, y1) in regions.items():
                crc = zlib.crc32(np.ascontiguousarray(screen[y0:y1, x0:x1]).tobytes())
                if last.get(name) != crc:
                    last[name] = crc
                    out.write(
                        json.dumps({"t": round(now, 4), "wall": wall, "region": name, "crc": crc})
                        + "\n"
                    )
            loops += 1
            time.sleep(args.period)
        out.write(
            json.dumps({"summary": True, "loops": loops, "seconds": time.perf_counter() - started})
            + "\n"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
