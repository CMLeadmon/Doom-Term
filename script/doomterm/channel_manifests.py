#!/usr/bin/env python3
"""Render and decide the package-channel manifests for a published Doom Term release.

Doom Term is installed and updated through three channels that point at the release assets: a
Scoop bucket (Windows), a Homebrew tap (macOS) and an AppImage with embedded update information
(Linux). This module is the pure logic. It reads the release's SHA256SUMS.txt, renders the Scoop
manifest and the Homebrew cask, refuses to move a channel backwards, and names the assets a
release must carry. .github/workflows/doomterm-channels.yml does the I/O.

Usage:
    python3 script/doomterm/channel_manifests.py render --tag v1.1.8 --sums SHA256SUMS.txt --out DIR
    python3 script/doomterm/channel_manifests.py version --tag v1.1.8
    python3 script/doomterm/channel_manifests.py decide --kind scoop --manifest PATH --version 1.1.8
    python3 script/doomterm/channel_manifests.py check-assets [--require-appimage] < asset-names.txt
    python3 script/doomterm/channel_manifests.py appimage-update-info
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import string
import sys
from collections.abc import Iterable

OWNER = "CMLeadmon"
REPO = "Doom-Term"
RELEASE_URL = f"https://github.com/{OWNER}/{REPO}/releases/download"

SUMS_NAME = "SHA256SUMS.txt"
WINDOWS_ZIP = "doomterm-windows-x64.zip"
MACOS_ZIP = "doomterm-macos-arm64.zip"
APPIMAGE = "DoomTerm-x86_64.AppImage"
APPIMAGE_ZSYNC = f"{APPIMAGE}.zsync"
APPIMAGE_UPDATE_INFORMATION = f"gh-releases-zsync|{OWNER}|{REPO}|latest|{APPIMAGE_ZSYNC}"

SCOOP_MANIFEST = pathlib.Path("scoop-doomterm") / "bucket" / "doomterm.json"
CASK_MANIFEST = pathlib.Path("homebrew-doomterm") / "Casks" / "doomterm.rb"

_VERSION = re.compile(r"^\d+(\.\d+){2,3}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def normalize_version(tag: str) -> str:
    """Returns the version for a release tag such as `v1.1.8`; rejects any other name."""
    version = tag[1:] if tag.startswith("v") else tag
    if not _VERSION.match(version):
        raise ValueError(f"{tag!r} is not a release tag like v1.1.8 or v1.1.2.1")
    return version


def version_key(version: str) -> tuple[int, ...]:
    """Sort key that compares versions numerically and treats a missing fourth part as 0."""
    parts = tuple(int(part) for part in version.split("."))
    return parts + (0,) * (4 - len(parts))


def parse_sha256sums(text: str) -> dict[str, str]:
    """Maps file name to lowercase SHA-256 for the `sha256sum` lines of a checksum file."""
    sums: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        digest, _, name = line.partition(" ")
        digest, name = digest.lower(), name.strip().lstrip("*")
        if not name or not _SHA256.match(digest):
            raise ValueError(f"unparseable checksum line: {line!r}")
        sums[name] = digest
    return sums


def asset_hash(sums: dict[str, str], name: str) -> str:
    try:
        return sums[name]
    except KeyError:
        raise ValueError(f"{SUMS_NAME} has no entry for {name}") from None


def _checked_version(version: str) -> str:
    if not _VERSION.match(version):
        raise ValueError(f"{version!r} is not a release version like 1.1.8")
    return version


def _checked_digest(sha256: str) -> str:
    if not _SHA256.match(sha256):
        raise ValueError(f"{sha256!r} is not a lowercase SHA-256 digest")
    return sha256


def scoop_manifest(version: str, sha256: str) -> str:
    """The Scoop manifest for the Windows zip of `version`."""
    manifest = {
        "version": _checked_version(version),
        "description": "A terminal with a cockpit. Keep your shells, projects, and coding agents in view.",
        "homepage": f"https://github.com/{OWNER}/{REPO}",
        "license": "AGPL-3.0-only",
        "architecture": {
            "64bit": {
                "url": f"{RELEASE_URL}/v{version}/{WINDOWS_ZIP}",
                "hash": _checked_digest(sha256),
            }
        },
        "bin": "doomterm.exe",
        "shortcuts": [["doomterm.exe", "Doom Term"]],
    }
    return json.dumps(manifest, indent=4) + "\n"


_CASK = string.Template(
    """cask "doomterm" do
  version "$version"
  sha256 "$sha256"

  url "$release_url/v#{version}/$asset"
  name "Doom Term"
  desc "Terminal with a cockpit for shells, projects, and coding agents"
  homepage "https://github.com/$owner/$repo"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on arch: :arm64

  app "osx/DoomTerm.app"
end
"""
)


def cask(version: str, sha256: str) -> str:
    """The Homebrew cask for the Apple silicon zip of `version`."""
    return _CASK.substitute(
        version=_checked_version(version),
        sha256=_checked_digest(sha256),
        release_url=RELEASE_URL,
        asset=MACOS_ZIP,
        owner=OWNER,
        repo=REPO,
    )


def read_scoop_version(text: str) -> str | None:
    """The `version` of a Scoop manifest, or None when the text is not one."""
    try:
        version = json.loads(text).get("version")
    except (json.JSONDecodeError, AttributeError):
        return None
    return version if isinstance(version, str) else None


def read_cask_version(text: str) -> str | None:
    """The `version` stanza of a Homebrew cask, or None when it has none."""
    match = re.search(r'^\s*version "([^"]+)"\s*$', text, re.MULTILINE)
    return match.group(1) if match else None


def decide(current: str | None, candidate: str) -> str:
    """`update` when a channel at `current` should take `candidate`, `same` when it already has
    it, and `older` when taking it would move the channel backwards."""
    if current is None:
        return "update"
    new, old = version_key(candidate), version_key(_checked_version(current))
    if new > old:
        return "update"
    return "same" if new == old else "older"


def render_channels(tag: str, sums_text: str, out_dir: pathlib.Path) -> list[pathlib.Path]:
    """Writes the Scoop manifest and Homebrew cask for `tag` under `out_dir`.

    Nothing is written unless every asset the manifests need has a checksum.
    """
    version = normalize_version(tag)
    sums = parse_sha256sums(sums_text)
    files = {
        SCOOP_MANIFEST: scoop_manifest(version, asset_hash(sums, WINDOWS_ZIP)),
        CASK_MANIFEST: cask(version, asset_hash(sums, MACOS_ZIP)),
    }
    written = []
    for relative, text in files.items():
        path = out_dir / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        written.append(path)
    return written


def missing_assets(names: Iterable[str], require_appimage: bool) -> list[str]:
    """The release assets absent from `names`, in the order the channels need them."""
    present = set(names)
    required = [SUMS_NAME, WINDOWS_ZIP, MACOS_ZIP]
    if require_appimage:
        required += [APPIMAGE, APPIMAGE_ZSYNC]
    return [name for name in required if name not in present]


def _current_version(kind: str, manifest: pathlib.Path) -> str | None:
    if not manifest.exists():
        return None
    read = read_scoop_version if kind == "scoop" else read_cask_version
    version = read(manifest.read_text(encoding="utf-8"))
    if version is None:
        raise ValueError(f"cannot read a version from {manifest}")
    return version


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)

    render = commands.add_parser("render", help="write the Scoop manifest and Homebrew cask")
    render.add_argument("--tag", required=True)
    render.add_argument("--sums", type=pathlib.Path, required=True)
    render.add_argument("--out", type=pathlib.Path, required=True)

    version = commands.add_parser("version", help="print the version for a release tag")
    version.add_argument("--tag", required=True)

    decision = commands.add_parser("decide", help="print update, same or older for one channel")
    decision.add_argument("--kind", choices=("scoop", "cask"), required=True)
    decision.add_argument("--manifest", type=pathlib.Path, required=True)
    decision.add_argument("--version", required=True)

    assets = commands.add_parser("check-assets", help="list release assets missing from stdin")
    assets.add_argument("--require-appimage", action="store_true")

    commands.add_parser("appimage-update-info", help="print the address the AppImage embeds")

    args = parser.parse_args(argv)
    try:
        if args.command == "render":
            render_channels(args.tag, args.sums.read_text(encoding="utf-8"), args.out)
        elif args.command == "version":
            print(normalize_version(args.tag))
        elif args.command == "decide":
            current = _current_version(args.kind, args.manifest)
            print(decide(current, _checked_version(args.version)))
        elif args.command == "check-assets":
            missing = missing_assets(sys.stdin.read().split(), args.require_appimage)
            if missing:
                print("\n".join(missing))
                return 1
        elif args.command == "appimage-update-info":
            print(APPIMAGE_UPDATE_INFORMATION)
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
