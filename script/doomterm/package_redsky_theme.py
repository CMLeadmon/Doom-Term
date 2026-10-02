#!/usr/bin/env python3
"""Package the Redsky theme pack as a zip with a deterministic byte layout.

The archive holds one top-level folder, `redsky/`. A theme's relative image path resolves against
Doom Term's themes folder, not against the YAML's own folder, so the files have to land in
`<themes folder>/redsky/` and the YAML points at `redsky/redsky.gif`.

Usage:
    python3 script/doomterm/package_redsky_theme.py [--out PATH]

Prints `<sha256>  <file name>`, the form SHA256SUMS.txt uses.
"""

from __future__ import annotations

import argparse
import hashlib
import pathlib
import zipfile

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
PACK_DIR = REPO_ROOT / "themes" / "redsky"
FILES = ("redsky.yaml", "redsky.gif", "README.txt")
FIXED_TIME = (2026, 10, 1, 0, 0, 0)
DEFAULT_OUT = REPO_ROOT / "target" / "redsky" / "doomterm-redsky-theme.zip"


def build(out: pathlib.Path, pack_dir: pathlib.Path = PACK_DIR) -> str:
    """Writes the archive to `out` and returns its SHA-256."""
    sources = {name: (pack_dir / name).read_bytes() for name in FILES}
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in sources.items():
            info = zipfile.ZipInfo(f"redsky/{name}", FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, data)
    return hashlib.sha256(out.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=pathlib.Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    digest = build(args.out)
    print(f"{digest}  {args.out.name}")


if __name__ == "__main__":
    main()
