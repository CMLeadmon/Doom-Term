#!/usr/bin/env python3
"""Generate the Doom Term application icon set from its pixel-art masters.

The icon is a striated stone plate with the red prompt chevron, drawn with the status plate's
own palette and stone fill (`crates/doomterm_plate/src/paint.rs`). Two masters are drawn, a
32x32 and a hand-set 16x16, and every output size is a whole-number multiple of one of them, so
no size is smoothed or resampled:

    16 = 16x1    32 = 32x1    48 = 16x3    64 = 32x2    128 = 32x4    256 = 32x8    512 = 32x16

Usage:
    python3 script/doomterm/generate_icons.py           write the icons
    python3 script/doomterm/generate_icons.py --check   fail if the committed icons differ
"""

from __future__ import annotations

import argparse
import struct
import sys
import zlib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ICON_DIR = REPO_ROOT / "app" / "channels" / "doomterm" / "icon" / "no-padding"

MASK = 0xFFFFFFFF

STONE = [0x505150, 0x595A58, 0x454645, 0x616260, 0x535452, 0x4B4C4A, 0x5D5E5C, 0x404140]
STONE_CRACK = 0x393A39
BEVEL_HI = 0xA2A29F
BEVEL_HI_SIDE = 0x9A9A97
BEVEL_LO = 0x2F2F2E
BEVEL_LO_SIDE = 0x3A3A39
NUM_HI = 0xF01A12
NUM_MID = 0xD40B06
NUM_LO = 0xA80603
NUM_SHADOW = 0x3A0402

# 16 is the hand-set master; the rest are whole multiples of the 32 master, except 48 (16 x 3).
PNG_SIZES = {16: (16, 1), 32: (32, 1), 64: (32, 2), 128: (32, 4), 256: (32, 8), 512: (32, 16)}
ICO_SIZES = {16: (16, 1), 32: (32, 1), 48: (16, 3), 64: (32, 2), 128: (32, 4), 256: (32, 8)}


class Image:
    def __init__(self, size: int) -> None:
        self.size = size
        self.pixels: list[tuple[int, int, int, int]] = [(0, 0, 0, 0)] * (size * size)

    def put(self, x: int, y: int, color: int) -> None:
        if 0 <= x < self.size and 0 <= y < self.size:
            self.pixels[y * self.size + x] = (color >> 16 & 255, color >> 8 & 255, color & 255, 255)

    def erase(self, x: int, y: int) -> None:
        if 0 <= x < self.size and 0 <= y < self.size:
            self.pixels[y * self.size + x] = (0, 0, 0, 0)

    def rect(self, x: int, y: int, w: int, h: int, color: int) -> None:
        for yy in range(h):
            for xx in range(w):
                self.put(x + xx, y + yy, color)

    def rgba(self) -> bytes:
        return b"".join(bytes(pixel) for pixel in self.pixels)


def stone(im: Image, x: int, y: int, w: int, h: int) -> None:
    """The plate's hash-driven striation, then its 1px bevel (`Rasterizer::stone`)."""
    im.rect(x, y, w, h, STONE[0])
    for row in range(1, h - 1, 2):
        col = 1 + row % 3
        while col < w - 1:
            hashed = ((((col * 0x9E3779B9) & MASK) ^ ((row * 0x85EBCA6B) & MASK)) * 0xC2B2AE35) & MASK
            run = min(2 + (hashed >> 9) % 4, w - 1 - col)
            patch = min(1 + (hashed >> 16) % 2, h - 1 - row)
            im.rect(x + col, y + row, run, patch, STONE[(hashed >> 24) % len(STONE)])
            if hashed % 17 == 0 and row + 2 < h - 1:
                im.rect(x + col, y + row, 1, 2, STONE_CRACK)
            col += run + 1 + (hashed >> 20) % 3
    im.rect(x, y, w, 1, BEVEL_HI)
    im.rect(x, y, 1, h, BEVEL_HI_SIDE)
    im.rect(x, y + h - 1, w, 1, BEVEL_LO)
    im.rect(x + w - 1, y, 1, h, BEVEL_LO_SIDE)


def red_shape(im: Image, ox: int, oy: int, rows: list[str]) -> None:
    """A red figure in the big numerals' style: a 1px shadow, then three tone bands by row."""
    height = len(rows)
    for r, row in enumerate(rows):
        for c, cell in enumerate(row):
            if cell == "1":
                im.put(ox + c + 1, oy + r + 1, NUM_SHADOW)
    for r, row in enumerate(rows):
        t = (r + 0.5) / height
        tone = NUM_HI if t < 0.36 else NUM_MID if t < 0.72 else NUM_LO
        for c, cell in enumerate(row):
            if cell == "1":
                im.put(ox + c, oy + r, tone)


def chevron(height: int, stroke: int) -> list[str]:
    half = height // 2
    width = half - 1 + stroke
    rows = []
    for r in range(height):
        i = r if r < half else height - 1 - r
        rows.append(("." * i + "1" * stroke).ljust(width, "."))
    return rows


def bar(width: int, height: int) -> list[str]:
    return ["1" * width] * height


def chamfer(im: Image, depth: int) -> None:
    last = im.size - 1
    for i in range(depth):
        for j in range(depth - i):
            for x, y in ((i, j), (last - i, j), (i, last - j), (last - i, last - j)):
                im.erase(x, y)


def master32() -> Image:
    im = Image(32)
    stone(im, 0, 0, 32, 32)
    red_shape(im, 5, 8, chevron(16, 5))
    red_shape(im, 17, 21, bar(10, 3))
    chamfer(im, 2)
    return im


def master16() -> Image:
    im = Image(16)
    stone(im, 0, 0, 16, 16)
    red_shape(im, 3, 4, chevron(8, 3))
    red_shape(im, 9, 10, bar(4, 2))
    chamfer(im, 1)
    return im


def scaled(im: Image, factor: int) -> tuple[int, bytes]:
    size = im.size * factor
    rows = []
    for y in range(im.size):
        row = b"".join(bytes(im.pixels[y * im.size + x]) * factor for x in range(im.size))
        rows.extend([row] * factor)
    return size, b"".join(rows)


def png(size: int, rgba: bytes) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    stride = size * 4
    raw = b"".join(b"\x00" + rgba[y * stride:(y + 1) * stride] for y in range(size))
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def ico(images: list[tuple[int, bytes]]) -> bytes:
    directory, payload = b"", b""
    offset = 6 + 16 * len(images)
    for size, data in images:
        directory += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
        payload += data
        offset += len(data)
    return struct.pack("<HHH", 0, 1, len(images)) + directory + payload


def render(masters: dict[int, Image], table: dict[int, tuple[int, int]]) -> dict[int, bytes]:
    out = {}
    for size, (source, factor) in table.items():
        drawn, rgba = scaled(masters[source], factor)
        assert drawn == size
        out[size] = png(size, rgba)
    return out


def outputs() -> dict[Path, bytes]:
    masters = {16: master16(), 32: master32()}
    files = {ICON_DIR / f"{s}x{s}.png": data for s, data in render(masters, PNG_SIZES).items()}
    ico_pngs = render(masters, ICO_SIZES)
    files[ICON_DIR / "icon.ico"] = ico(sorted(ico_pngs.items()))
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="fail if the committed icons differ")
    args = parser.parse_args()
    files = outputs()
    if args.check:
        stale = [p for p, data in files.items() if not p.exists() or p.read_bytes() != data]
        for path in stale:
            print(f"stale: {path.relative_to(REPO_ROOT)}", file=sys.stderr)
        return 1 if stale else 0
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    for path, data in files.items():
        path.write_bytes(data)
        print(f"wrote {path.relative_to(REPO_ROOT)} ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
