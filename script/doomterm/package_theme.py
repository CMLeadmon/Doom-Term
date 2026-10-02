#!/usr/bin/env python3
"""Package a Doom Term theme pack as a zip with a deterministic byte layout.

The archive holds one top-level folder named after the pack, such as `redsky/`. A theme's relative
image path resolves against Doom Term's themes folder, not against the YAML's own folder, so the
files have to land in `<themes folder>/<pack>/` and the YAML points at `<pack>/<pack>.gif`.

Usage:
    python3 script/doomterm/package_theme.py PACK [--out PATH]

Prints `<sha256>  <file name>`, the form SHA256SUMS.txt uses.
"""

from __future__ import annotations

import argparse
import hashlib
import pathlib
import zipfile

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
THEMES_DIR = REPO_ROOT / "themes"
PACKS = ("redsky", "bluehighway", "canopy")
FIXED_TIME = (2026, 10, 1, 0, 0, 0)


def pack_files(pack: str) -> tuple[str, str, str]:
    return (f"{pack}.yaml", f"{pack}.gif", "README.txt")


def default_out(pack: str) -> pathlib.Path:
    return REPO_ROOT / "target" / pack / f"doomterm-{pack}-theme.zip"


def build(pack: str, out: pathlib.Path, pack_dir: pathlib.Path | None = None) -> str:
    """Writes the archive to `out` and returns its SHA-256."""
    pack_dir = pack_dir or THEMES_DIR / pack
    sources = {name: (pack_dir / name).read_bytes() for name in pack_files(pack)}
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in sources.items():
            info = zipfile.ZipInfo(f"{pack}/{name}", FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, data)
    return hashlib.sha256(out.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("pack", choices=PACKS)
    parser.add_argument("--out", type=pathlib.Path)
    args = parser.parse_args()
    out = args.out or default_out(args.pack)
    print(f"{build(args.pack, out)}  {out.name}")


if __name__ == "__main__":
    main()
