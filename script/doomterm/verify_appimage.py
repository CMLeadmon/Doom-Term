#!/usr/bin/env python3
"""Verify an AppImage pair before running its version command.

Published assets require --sums; local builds have no release checksum file yet.
Omitting --version allows branch builds whose version is unknown.
"""

from __future__ import annotations

import argparse
import hashlib
import pathlib
import re
import subprocess
import sys

from channel_manifests import (
    APPIMAGE,
    APPIMAGE_UPDATE_INFORMATION,
    APPIMAGE_ZSYNC,
    asset_hash,
    parse_sha256sums,
)


def verify_appimage(directory: pathlib.Path, sums: pathlib.Path | None, version: str | None) -> str:
    """Authenticate published digests, check update metadata, then run --version."""
    image = (directory / APPIMAGE).resolve()
    zsync = directory / APPIMAGE_ZSYNC
    if sums is not None:
        published = parse_sha256sums(sums.read_text(encoding="utf-8"))
        expected = {name: asset_hash(published, name) for name in (APPIMAGE, APPIMAGE_ZSYNC)}
        for name, digest in expected.items():
            with (directory / name).open("rb") as handle:
                actual = hashlib.file_digest(handle, "sha256").hexdigest()
            if actual != digest:
                raise ValueError(f"SHA256 mismatch for {name}")

    embedded = subprocess.run(
        ["readelf", "-p", ".upd_info", str(image)], check=True, capture_output=True, text=True,
    ).stdout
    addresses = re.findall(r"^\s*\[\s*[0-9a-f]+\]\s*(.*)$", embedded, re.MULTILINE)
    if addresses != [APPIMAGE_UPDATE_INFORMATION]:
        raise ValueError("AppImage update information mismatch")

    header = {}
    with zsync.open("rb") as handle:
        for line in handle:
            if line == b"\n":
                break
            name, separator, value = line.decode("ascii").rstrip("\n").partition(": ")
            if not separator:
                raise ValueError("malformed zsync header")
            if name in header:
                raise ValueError(f"duplicate zsync field: {name}")
            header[name] = value
        else:
            raise ValueError("unterminated zsync header")
    with image.open("rb") as handle:
        sha1 = hashlib.file_digest(handle, "sha1").hexdigest()
    expected_header = {
        "Filename": APPIMAGE,
        "URL": APPIMAGE,
        "Length": str(image.stat().st_size),
        "SHA-1": sha1,
    }
    for name, expected in expected_header.items():
        if header.get(name) != expected:
            raise ValueError(f"zsync {name} mismatch")

    image.chmod(image.stat().st_mode | 0o111)
    printed = subprocess.run(
        [str(image), "--version"], check=True, capture_output=True, text=True,
    ).stdout.strip()
    if version is not None and printed != f"Doom Term {version}":
        raise ValueError(f"AppImage version mismatch: {printed!r}, expected 'Doom Term {version}'")
    return printed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dir", type=pathlib.Path, required=True)
    parser.add_argument("--sums", type=pathlib.Path)
    parser.add_argument("--version")
    args = parser.parse_args(argv)
    try:
        print(verify_appimage(args.dir, args.sums, args.version))
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
