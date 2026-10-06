# Doom Term Update Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people update Doom Term with one command per platform: an AppImage with embedded update information for Linux, a Scoop bucket for Windows and a Homebrew tap for macOS, all fed from the existing GitHub release and verified on real runners before they are promoted.

**Architecture:** The release pipeline gains an AppImage, built with the repository's existing `script/linux/bundle` and driven by environment variables only, plus its `.zsync` file. A fork-owned Python module renders the Scoop manifest and Homebrew cask from a release's `SHA256SUMS.txt` and decides whether a channel may take a version, never backwards. A new workflow, `doomterm-channels.yml`, runs after a release is published: it resolves the release, renders the manifests, verifies Linux, Windows and macOS on real runners, and, once the maintainer approves the `channels` environment, commits the manifests to two small channel repositories. The application does not change and no file shared with upstream is edited.

**Tech Stack:** Python 3.11 standard library with `unittest`; GitHub Actions with SHA-pinned actions; bash and PowerShell; `linuxdeploy`, the AppImage runtime and `appimageupdatetool` (pinned, checksum-verified); Scoop; Homebrew; `gh`; Podman for the local Linux proof; `actionlint`.

**Spec:** None as a separate file. The design was agreed in conversation on 2026-10-05, and this plan's Architecture, Global Constraints, Review Focus and Appendix A (the measurements the design rests on) are the spec. The maintainer may ask for them to be split into `docs/superpowers/specs/2026-10-05-update-channels-design.md`.

## Global Constraints

- Work in `.worktrees/update-channels`, branch `feat/update-channels`, based on `origin/main` (`af788ad39` or later). The checkout at the repository root can lag `origin/main`; read files from the worktree.
- Change no application code and no file that exists upstream. Every new or edited path stays under `script/doomterm/`, `docs/doom-term/` or `.github/workflows/doomterm-`. `python3 script/doomterm/check-inventory.py` must pass with no ledger row added.
- Hosted services stay compile-excluded and Doom Term gains no network behavior.
- Workflows follow `docs/doom-term/repository-maintenance.md`: every action pinned to a commit SHA (reuse the SHAs already in `doomterm-ci.yml`), `permissions: contents: read` by default, and secrets only in the `promote` job.
- Pinned tools, exact: `linuxdeploy` release `1-alpha-20251107-1`, asset `linuxdeploy-x86_64.AppImage`, sha256 `c20cd71e3a4e3b80c3483cef793cda3f4e990aca14014d23c544ca3ce1270b4d`; AppImageUpdate release `2.0.0-alpha-1-20251018`, asset `appimageupdatetool-x86_64.AppImage`, sha256 `d976cdac667b03dee8cb23fb95ef74b042c406c5cbab3ff294d2b16efeaff84f`; AppImage runtime: type2-runtime release `20251108`, asset `runtime-x86_64`, sha256 `2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d`, handed to the build through `LDAI_RUNTIME_FILE` (otherwise the bundled appimagetool downloads the rolling `continuous` runtime).
- Exact names: AppImage `DoomTerm-x86_64.AppImage` and `DoomTerm-x86_64.AppImage.zsync`; channel repositories `CMLeadmon/scoop-doomterm` and `CMLeadmon/homebrew-doomterm`; environment `channels`; secret `CHANNELS_TOKEN`; update address `gh-releases-zsync|CMLeadmon|Doom-Term|latest|DoomTerm-x86_64.AppImage.zsync`.
- Python is standard library only and must pass on 3.11, the version CI uses.
- Do not create a version tag, publish a release or dispatch the release workflow (`AGENTS.md`). Creating repositories, an environment or a token, and running the channels workflow for a real release, each need the maintainer's explicit go-ahead at that step.
- Product copy reuses the README tagline and adds no game vocabulary beyond the product name.
- Record exact revisions, commands and results in the PR and distinguish fresh runs from earlier evidence (`AI_POLICY.md`). Use `CHANGELOG-NONE` for pipeline-only changes.

## Reviewed amendments (2026-10-05)

Task 3 review exposed three defects in the original prescribed snippets. Ruling R13 supersedes
those snippets and the affected Task 2 verification body:

- `script/doomterm/verify_appimage.py` is the shared standard-library verifier called by both
  workflows. Published pairs require exact checksum entries and matching SHA256 for both files
  before executing the AppImage. It checks the update address, zsync metadata and binary version.
  Build verification omits published sums; branch builds allow unknown versions, tags require exact
  versions. `test_verify_appimage.py` runs in the existing channel policy test step.
- `channel_manifests.py previous-appimage --tag TAG` reads GitHub releases API JSON from stdin and
  selects the highest valid published version strictly older than TAG with both AppImage assets.
  The workflow fetches all pages, authenticates the predecessor pair before running it, and checks
  the updated image against the target pair's published checksums.
- Duplicate checksum names are rejected so coverage is unambiguous. Existing Task 1/2 snippets
  describe the original implementation; these added interfaces and their persistent regression tests
  are required by the reviewed correction. The workflow snippets below incorporate the correction.

Tasks 1 and 2 were completed in the original session. Task 3 was resumed with Codex after provider
quota exhaustion; Task 6 agent disclosure must name both sessions and their actual work. The local
ledger keeps review decisions and exact validation evidence; it is not a public PR artifact.

Task 5 review corrected the AppImage command to include `-O`, so it replaces the file and retains
the promised `.zs-old` backup. The runbook distinguishes automatic/default manual AppImage
enforcement from pull-request rehearsals and the manual pre-AppImage exception.

Whole-branch review corrected non-PR workflow concurrency to use independent run IDs while
retaining PR cancellation. Promotions share a `queue: max` group with cancellation disabled, so
unrelated CI completions and out-of-order arrivals cannot replace pending releases. This is
GitHub's bounded 100-entry queue. Current actionlint 1.7.12 predates the field; retain its strict
output and narrowly ignore only that unexpected-key message. Task 6 must establish actual
GitHub server acceptance.

The final fix also requires ASCII, `v`-prefixed three/four-part tags at tag boundaries; version and
digest validators use `fullmatch`. `decide` validates its candidate before bootstrap. Persistent
regressions cover invalid inputs and CLI exit/output contracts, superseding the original Task 1
validator snippets. Valid shipped tags and numerical ordering remain supported.

## Review Focus

- A release that lacks a file the channels need (the Windows zip, the macOS zip, the AppImage, its `.zsync`, or a checksum line for one of them) must fail loudly and never produce a manifest with an empty or guessed hash. Pinned by Task 1 (`test_a_missing_asset_is_an_error_not_an_empty_hash`, `test_writes_nothing_when_an_asset_has_no_checksum`, `AssetCheckTest`) and by Task 3 (`resolve` runs `check-assets`).
- Re-running or out-of-order promotion: the same tag again changes nothing, an older tag after a newer one is refused, and the first promotion into an empty repository works. Pinned by Task 1 (`DecideTest`) and Task 4 (`promote_sim.sh`).
- Names that are not plain published releases (`v1.2.0-rc1`, `latest`, a draft or prerelease on GitHub) are rejected before anything is rendered. Pinned by Task 1 (`VersionTest`, `test_refuses_a_prerelease_tag`) and Task 3 (`resolve`).
- A packaging layout change, such as the Windows zip gaining a top-level folder or the macOS zip losing `osx/`, must fail on a runner and not reach users. Pinned by the Task 3 verify jobs, which require the installed file to exist and its version to equal the release.
- An AppImage with a wrong or missing update address, a `.zsync` file that does not describe it, or a version that differs from the tag must fail the build and the verification. Pinned by Task 2 (the verification step and its negative controls) and Task 3 (`verify-linux`).

---

### Task 1: Channel manifest library

**Files:**
- Create: `script/doomterm/channel_manifests.py`
- Create: `script/doomterm/test_channel_manifests.py`
- Create: `script/doomterm/fixtures/SHA256SUMS.v1.1.8.txt`
- Modify: `.github/workflows/doomterm-ci.yml` (job `policy-and-plate-tests`: insert one step before "Test tab group directory commands and SQLite migration")

**Interfaces:**
- Consumes: nothing.
- Produces, in module `channel_manifests`:
  - constants `OWNER`, `REPO`, `SUMS_NAME`, `WINDOWS_ZIP`, `MACOS_ZIP`, `APPIMAGE`, `APPIMAGE_ZSYNC`, `APPIMAGE_UPDATE_INFORMATION`, `SCOOP_MANIFEST`, `CASK_MANIFEST` (the last two are `pathlib.Path` values relative to a render directory);
  - `normalize_version(tag: str) -> str`, `version_key(version: str) -> tuple[int, ...]`, `parse_sha256sums(text: str) -> dict[str, str]`, `asset_hash(sums: dict[str, str], name: str) -> str`;
  - `scoop_manifest(version: str, sha256: str) -> str`, `cask(version: str, sha256: str) -> str`;
  - `read_scoop_version(text: str) -> str | None`, `read_cask_version(text: str) -> str | None`, `decide(current: str | None, candidate: str) -> str` returning `"update"`, `"same"` or `"older"`;
  - `render_channels(tag: str, sums_text: str, out_dir: pathlib.Path) -> list[pathlib.Path]`, `missing_assets(names: Iterable[str], require_appimage: bool) -> list[str]`;
  - command line `python3 script/doomterm/channel_manifests.py {render|version|decide|check-assets|appimage-update-info}`. Exit 0 is success, 1 means `check-assets` found missing assets, 2 means bad input.

- [x] **Step 1: Create the worktree**

```bash
cd "/var/home/cleadmon/Projects/Doom Term"
git fetch origin
git worktree add .worktrees/update-channels -b feat/update-channels origin/main
cd .worktrees/update-channels
git log -1 --format='%h %s'
```

Expected: a commit at or after `af788ad39`. Every later command in this plan runs from `.worktrees/update-channels`.

- [x] **Step 2: Add the fixture, the real v1.1.8 checksum file**

Create `script/doomterm/fixtures/SHA256SUMS.v1.1.8.txt`:

```text
f0dd601c577c0c43aefb105794bed94f69285cad9a266ddd9d0c6431c57fd598  DoomTermSetup.exe
33954f08761e1f9c3b8c2a9de7b04b17f54425b48b5a8a4596ad8aab5f23dda8  doomterm-agent-status-in-band.py
d407894d665017b8bf6356f81ea5efb4759c671c9489b14aeff523bdeef7c540  doomterm-agent-status.py
7dd302db6faeae0fb2f90389484ef5631b991cca23836fefb0c0c8a050e32f6b  doomterm-bfr-theme.zip
18f27d61b35abd7fa593ea574a9aef9a53e65ffc11a353ea57150fc2b3a6e139  doomterm-bluehighway-theme.zip
f263aa3cfc7cf2909bfe3d0efcbe090da2f5879d6a89cae2136afb1fc082b553  doomterm-canopy-theme.zip
630341e59c6db775bc19c973b8346130e46c8feec90d617dcc9abfdf039289c8  doomterm-linux-x86_64.tar.gz
8f8d3675d610483342117c287cbcae6164839e7957017a17bdbc4f14f3f1f5e1  doomterm-macos-arm64.dmg
4cd3ee9a34c133eeb6332281686d1ea16a5cada27de49885c33a8f1f5be19bcb  doomterm-macos-arm64.zip
e924ff6dc0e794e21a93e6e0c18081ac152124701974b5725eb5b63fe4bb0e2e  doomterm-redsky-theme.zip
84a9057508ed477090dbb356cd91365ab310e8329eb61adb6ba703bdeec8e178  doomterm-replay-theme.zip
860ea9e0b9adfafd1b775edd4c5be906f8edd87bfe53b35257d2a15497e14524  doomterm-windows-x64.zip
```

Check that it is byte-identical to the published file:

```bash
diff <(gh release download v1.1.8 -R CMLeadmon/Doom-Term -p SHA256SUMS.txt -O -) script/doomterm/fixtures/SHA256SUMS.v1.1.8.txt && echo identical
```

Expected: `identical`.

- [x] **Step 3: Write the first tests, for checksums and versions**

Create `script/doomterm/test_channel_manifests.py`:

```python
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

import channel_manifests as channels

HERE = pathlib.Path(__file__).resolve().parent
SUMS = (HERE / "fixtures" / "SHA256SUMS.v1.1.8.txt").read_text()
WINDOWS_SHA = "860ea9e0b9adfafd1b775edd4c5be906f8edd87bfe53b35257d2a15497e14524"
MACOS_SHA = "4cd3ee9a34c133eeb6332281686d1ea16a5cada27de49885c33a8f1f5be19bcb"


class ChecksumTest(unittest.TestCase):
    def test_reads_the_published_checksum_file(self):
        sums = channels.parse_sha256sums(SUMS)
        self.assertEqual(sums["doomterm-windows-x64.zip"], WINDOWS_SHA)
        self.assertEqual(sums["doomterm-macos-arm64.zip"], MACOS_SHA)

    def test_skips_comments_and_blank_lines_and_accepts_binary_mode_markers(self):
        text = f"# header\n\n{WINDOWS_SHA.upper()} *a.zip\n{MACOS_SHA}  b.zip\n"
        self.assertEqual(channels.parse_sha256sums(text), {"a.zip": WINDOWS_SHA, "b.zip": MACOS_SHA})

    def test_rejects_a_line_that_is_not_a_sha256_digest(self):
        with self.assertRaises(ValueError):
            channels.parse_sha256sums("abc123  a.zip\n")

    def test_a_missing_asset_is_an_error_not_an_empty_hash(self):
        with self.assertRaises(ValueError):
            channels.asset_hash({"other.zip": WINDOWS_SHA}, "doomterm-windows-x64.zip")


class VersionTest(unittest.TestCase):
    def test_strips_the_v_from_a_release_tag(self):
        self.assertEqual(channels.normalize_version("v1.1.8"), "1.1.8")

    def test_accepts_the_four_part_tags_the_project_has_shipped(self):
        self.assertEqual(channels.normalize_version("v1.1.2.1"), "1.1.2.1")

    def test_rejects_prerelease_and_non_release_names(self):
        for tag in ("v1.2.0-rc1", "latest", "main", "v1.2", "V1.1.8", ""):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                channels.normalize_version(tag)

    def test_orders_versions_numerically_not_alphabetically(self):
        order = ["1.0.3", "1.1.0", "1.1.2", "1.1.2.1", "1.1.8", "1.1.10"]
        self.assertEqual(sorted(order, key=channels.version_key), order)

    def test_a_missing_fourth_part_equals_zero(self):
        self.assertEqual(channels.version_key("1.1.2"), channels.version_key("1.1.2.0"))
```

- [x] **Step 4: Run them and watch them fail**

Run: `python3 -m unittest discover -s script/doomterm -p 'test_channel_manifests.py'`

Expected: `ModuleNotFoundError: No module named 'channel_manifests'` and `FAILED (errors=1)`.

- [x] **Step 5: Write the minimal implementation**

Create `script/doomterm/channel_manifests.py`:

```python
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
```

- [x] **Step 6: Run the tests and watch them pass**

Run: `python3 -m unittest discover -s script/doomterm -p 'test_channel_manifests.py'`

Expected: `Ran 9 tests` and `OK`.

- [x] **Step 7: Add the renderer tests**

Append to `script/doomterm/test_channel_manifests.py`, separated from the existing code by two blank lines:

```python
class ScoopManifestTest(unittest.TestCase):
    def test_points_at_the_tagged_windows_zip_with_its_hash(self):
        manifest = json.loads(channels.scoop_manifest("1.1.8", WINDOWS_SHA))
        self.assertEqual(manifest["version"], "1.1.8")
        self.assertEqual(
            manifest["architecture"]["64bit"],
            {
                "url": "https://github.com/CMLeadmon/Doom-Term/releases/download/v1.1.8/doomterm-windows-x64.zip",
                "hash": WINDOWS_SHA,
            },
        )

    def test_installs_the_executable_the_zip_holds_at_its_root(self):
        manifest = json.loads(channels.scoop_manifest("1.1.8", WINDOWS_SHA))
        self.assertEqual(manifest["bin"], "doomterm.exe")
        self.assertEqual(manifest["shortcuts"], [["doomterm.exe", "Doom Term"]])

    def test_ends_with_a_newline(self):
        self.assertTrue(channels.scoop_manifest("1.1.8", WINDOWS_SHA).endswith("}\n"))

    def test_refuses_a_hash_that_is_not_sha256(self):
        with self.assertRaises(ValueError):
            channels.scoop_manifest("1.1.8", "abc")

    def test_refuses_a_version_that_is_not_a_release_version(self):
        with self.assertRaises(ValueError):
            channels.scoop_manifest("1.2.0-rc1", WINDOWS_SHA)


class CaskTest(unittest.TestCase):
    def setUp(self):
        self.cask = channels.cask("1.1.8", MACOS_SHA)

    def test_pins_version_and_hash(self):
        self.assertIn('version "1.1.8"', self.cask)
        self.assertIn(f'sha256 "{MACOS_SHA}"', self.cask)

    def test_downloads_the_tagged_apple_silicon_zip(self):
        self.assertIn(
            'url "https://github.com/CMLeadmon/Doom-Term/releases/download/v#{version}/doomterm-macos-arm64.zip"',
            self.cask,
        )
        self.assertIn("depends_on arch: :arm64", self.cask)

    def test_installs_the_app_from_the_osx_folder_the_zip_holds(self):
        self.assertIn('app "osx/DoomTerm.app"', self.cask)

    def test_leaves_no_template_placeholder_behind(self):
        self.assertNotIn("$", self.cask)

    def test_refuses_a_hash_that_is_not_sha256(self):
        with self.assertRaises(ValueError):
            channels.cask("1.1.8", "")
```

- [x] **Step 8: Run them and watch the new ones fail**

Run: `python3 -m unittest discover -s script/doomterm -p 'test_channel_manifests.py'`

Expected: `Ran 19 tests` and `FAILED (errors=10)`, each an `AttributeError` for `scoop_manifest` or `cask`.

- [x] **Step 9: Add the renderers**

Append to `script/doomterm/channel_manifests.py`, separated by two blank lines:

```python
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
```

- [x] **Step 10: Run the tests and watch them pass**

Run: `python3 -m unittest discover -s script/doomterm -p 'test_channel_manifests.py'`

Expected: `Ran 19 tests` and `OK`.

- [x] **Step 11: Add the tests for rendering, decisions, asset checks and the command line**

Append to `script/doomterm/test_channel_manifests.py`, separated by two blank lines. This block ends the file with the `unittest.main()` guard:

```python
class RenderChannelsTest(unittest.TestCase):
    def test_writes_both_manifests_for_the_published_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            written = channels.render_channels("v1.1.8", SUMS, pathlib.Path(tmp))
            names = sorted(path.relative_to(tmp).as_posix() for path in written)
            self.assertEqual(
                names, ["homebrew-doomterm/Casks/doomterm.rb", "scoop-doomterm/bucket/doomterm.json"]
            )
            scoop = json.loads((pathlib.Path(tmp) / "scoop-doomterm/bucket/doomterm.json").read_text())
            self.assertEqual(scoop["architecture"]["64bit"]["hash"], WINDOWS_SHA)

    def test_writes_nothing_when_an_asset_has_no_checksum(self):
        without_macos = "\n".join(line for line in SUMS.splitlines() if "macos" not in line)
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                channels.render_channels("v1.1.8", without_macos, pathlib.Path(tmp))
            self.assertEqual(list(pathlib.Path(tmp).iterdir()), [])

    def test_refuses_a_prerelease_tag(self):
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(ValueError):
            channels.render_channels("v1.2.0-rc1", SUMS, pathlib.Path(tmp))


class DecideTest(unittest.TestCase):
    def test_a_channel_with_no_manifest_takes_the_release(self):
        self.assertEqual(channels.decide(None, "1.1.8"), "update")

    def test_a_newer_release_updates(self):
        self.assertEqual(channels.decide("1.1.7", "1.1.8"), "update")
        self.assertEqual(channels.decide("1.1.2", "1.1.2.1"), "update")

    def test_the_same_release_is_a_no_op(self):
        self.assertEqual(channels.decide("1.1.8", "1.1.8"), "same")

    def test_an_older_release_never_moves_the_channel_backwards(self):
        self.assertEqual(channels.decide("1.1.8", "1.1.7"), "older")
        self.assertEqual(channels.decide("1.1.10", "1.1.9"), "older")

    def test_a_channel_version_it_cannot_read_is_an_error(self):
        with self.assertRaises(ValueError):
            channels.decide("garbage", "1.1.8")


class ManifestVersionTest(unittest.TestCase):
    def test_reads_the_version_back_from_what_it_renders(self):
        self.assertEqual(
            channels.read_scoop_version(channels.scoop_manifest("1.1.8", WINDOWS_SHA)), "1.1.8"
        )
        self.assertEqual(channels.read_cask_version(channels.cask("1.1.8", MACOS_SHA)), "1.1.8")

    def test_unreadable_manifests_have_no_version(self):
        self.assertIsNone(channels.read_scoop_version("not json"))
        self.assertIsNone(channels.read_scoop_version("[]"))
        self.assertIsNone(channels.read_cask_version('cask "x" do\nend\n'))


class AssetCheckTest(unittest.TestCase):
    BASE = ["SHA256SUMS.txt", "doomterm-windows-x64.zip", "doomterm-macos-arm64.zip"]

    def test_a_release_without_the_appimage_passes_only_when_it_is_not_required(self):
        self.assertEqual(channels.missing_assets(self.BASE, require_appimage=False), [])
        self.assertEqual(
            channels.missing_assets(self.BASE, require_appimage=True),
            ["DoomTerm-x86_64.AppImage", "DoomTerm-x86_64.AppImage.zsync"],
        )

    def test_a_release_with_the_appimage_but_no_zsync_file_is_incomplete(self):
        names = [*self.BASE, "DoomTerm-x86_64.AppImage"]
        self.assertEqual(
            channels.missing_assets(names, require_appimage=True), ["DoomTerm-x86_64.AppImage.zsync"]
        )

    def test_names_every_missing_asset(self):
        self.assertEqual(channels.missing_assets([], require_appimage=False), self.BASE)


class UpdateInformationTest(unittest.TestCase):
    def test_points_the_appimage_at_the_latest_release_zsync_file(self):
        self.assertEqual(
            channels.APPIMAGE_UPDATE_INFORMATION,
            "gh-releases-zsync|CMLeadmon|Doom-Term|latest|DoomTerm-x86_64.AppImage.zsync",
        )


class CommandLineTest(unittest.TestCase):
    def run_cli(self, *args, stdin=""):
        return subprocess.run(
            [sys.executable, str(HERE / "channel_manifests.py"), *args],
            input=stdin,
            capture_output=True,
            text=True,
        )

    def test_version_prints_the_version(self):
        result = self.run_cli("version", "--tag", "v1.1.8")
        self.assertEqual((result.returncode, result.stdout), (0, "1.1.8\n"))

    def test_version_exits_2_for_a_tag_that_is_not_a_release(self):
        self.assertEqual(self.run_cli("version", "--tag", "v1.2.0-rc1").returncode, 2)

    def test_render_writes_the_manifests(self):
        with tempfile.TemporaryDirectory() as tmp:
            sums = pathlib.Path(tmp) / "SHA256SUMS.txt"
            sums.write_text(SUMS)
            out = pathlib.Path(tmp) / "out"
            result = self.run_cli("render", "--tag", "v1.1.8", "--sums", str(sums), "--out", str(out))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((out / "scoop-doomterm/bucket/doomterm.json").is_file())
            self.assertTrue((out / "homebrew-doomterm/Casks/doomterm.rb").is_file())

    def test_decide_says_update_when_the_channel_has_no_manifest_yet(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = pathlib.Path(tmp) / "none.json"
            result = self.run_cli(
                "decide", "--kind", "scoop", "--manifest", str(missing), "--version", "1.1.8"
            )
            self.assertEqual((result.returncode, result.stdout), (0, "update\n"))

    def test_decide_says_older_when_the_channel_is_already_ahead(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = pathlib.Path(tmp) / "doomterm.json"
            manifest.write_text(channels.scoop_manifest("1.1.9", WINDOWS_SHA))
            result = self.run_cli(
                "decide", "--kind", "scoop", "--manifest", str(manifest), "--version", "1.1.8"
            )
            self.assertEqual((result.returncode, result.stdout), (0, "older\n"))

    def test_decide_fails_on_a_manifest_it_cannot_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = pathlib.Path(tmp) / "doomterm.json"
            manifest.write_text("not json")
            result = self.run_cli(
                "decide", "--kind", "scoop", "--manifest", str(manifest), "--version", "1.1.8"
            )
            self.assertEqual(result.returncode, 2)

    def test_check_assets_lists_what_is_missing_and_fails(self):
        result = self.run_cli(
            "check-assets", "--require-appimage", stdin="SHA256SUMS.txt\ndoomterm-windows-x64.zip\n"
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(
            result.stdout.split(),
            ["doomterm-macos-arm64.zip", "DoomTerm-x86_64.AppImage", "DoomTerm-x86_64.AppImage.zsync"],
        )

    def test_check_assets_is_silent_when_nothing_is_missing(self):
        result = self.run_cli("check-assets", stdin="SHA256SUMS.txt doomterm-windows-x64.zip doomterm-macos-arm64.zip")
        self.assertEqual((result.returncode, result.stdout), (0, ""))

    def test_appimage_update_info_prints_the_embedded_address(self):
        result = self.run_cli("appimage-update-info")
        self.assertEqual(result.stdout, channels.APPIMAGE_UPDATE_INFORMATION + "\n")


if __name__ == "__main__":
    unittest.main()
```

- [x] **Step 12: Run them and watch the new ones fail**

Run: `python3 -m unittest discover -s script/doomterm -p 'test_channel_manifests.py'`

Expected: `Ran 42 tests` and `FAILED (failures=8, errors=13)`.

- [x] **Step 13: Add the rest of the module**

Append to `script/doomterm/channel_manifests.py`, separated by two blank lines. This block ends the file with the `main()` entry point:

```python
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
```

- [x] **Step 14: Run the tests and watch them pass**

Run: `python3 -m unittest discover -s script/doomterm -p 'test_channel_manifests.py'`

Expected: `Ran 42 tests` and `OK`.

- [x] **Step 15: Check the output with its real consumers**

Scoop's schema, Ruby's parser and Python 3.11 are what actually read this output. `jsonschema` is a development-only dependency (`python3 -m pip install --user jsonschema` if it is missing).

```bash
TMP="$(mktemp -d)"
python3 script/doomterm/channel_manifests.py render --tag v1.1.8 --sums script/doomterm/fixtures/SHA256SUMS.v1.1.8.txt --out "$TMP/rendered"
cat "$TMP/rendered/scoop-doomterm/bucket/doomterm.json" "$TMP/rendered/homebrew-doomterm/Casks/doomterm.rb"

curl -fsSL https://raw.githubusercontent.com/ScoopInstaller/Scoop/master/schema.json -o "$TMP/scoop-schema.json"
python3 - "$TMP" <<'PY'
import json
import sys

import jsonschema

tmp = sys.argv[1]
schema = json.load(open(f"{tmp}/scoop-schema.json"))
manifest = json.load(open(f"{tmp}/rendered/scoop-doomterm/bucket/doomterm.json"))
jsonschema.validate(manifest, schema)
print("scoop schema: OK")
PY

podman run --rm --security-opt label=disable -v "$TMP/rendered:/r:ro" docker.io/library/ruby:3.3-slim ruby -c /r/homebrew-doomterm/Casks/doomterm.rb
podman run --rm --security-opt label=disable -v "$PWD:/w:ro" -w /w docker.io/library/python:3.11-slim python -m unittest discover -s script/doomterm -p 'test_channel_manifests.py'
```

Expected: both rendered files print with version `1.1.8` and the real hashes `860ea9e0…` (Windows) and `4cd3ee9a…` (macOS); then `scoop schema: OK`, `Syntax OK`, and `Ran 42 tests` with `OK` under Python 3.11.

- [x] **Step 16: Run the tests in CI**

In `.github/workflows/doomterm-ci.yml`, insert this step into the `policy-and-plate-tests` job immediately before the step named `Test tab group directory commands and SQLite migration`:

```yaml
      - name: Test channel manifest rendering and check the rendered cask
        run: |
          python3 -m unittest discover -s script/doomterm -p 'test_channel_manifests.py'
          python3 script/doomterm/channel_manifests.py render --tag v1.1.8 --sums script/doomterm/fixtures/SHA256SUMS.v1.1.8.txt --out "$RUNNER_TEMP/channels"
          ruby -c "$RUNNER_TEMP/channels/homebrew-doomterm/Casks/doomterm.rb"
```

- [x] **Step 17: Lint the workflow, run the ledger check and commit**

```bash
podman run --rm --security-opt label=disable -v "$PWD:/repo:ro" -w /repo docker.io/rhysd/actionlint:latest -color=false .github/workflows/doomterm-ci.yml
git add script/doomterm .github/workflows/doomterm-ci.yml
python3 script/doomterm/check-inventory.py | tail -1
```

Expected: `actionlint` reports exactly one finding, `SC2035` in the publish job's `sha256sum * > SHA256SUMS.txt`, which is already on `origin/main` and is not part of this plan. The ledger check ends with `OK: the ledger matches the tree.`

```bash
git commit -m "Add the channel manifest renderer and its tests

Renders the Scoop manifest and Homebrew cask for a published release from its
SHA256SUMS.txt, and decides whether a channel may take a version. The pipeline
that uses it follows in later commits; this one only adds the logic and its tests."
```

---

### Task 2: Linux AppImage in the release build

**Files:**
- Modify: `.github/workflows/doomterm-ci.yml` (job `build-linux`: add three steps and replace the last step, `Upload Linux Artifact`)

**Interfaces:**
- Consumes: `python3 script/doomterm/channel_manifests.py appimage-update-info` from Task 1.
- Produces: release assets `DoomTerm-x86_64.AppImage` and `DoomTerm-x86_64.AppImage.zsync` in the `doomterm-linux-x86_64` artifact, next to the tarball. The existing `publish-release` job already copies every file of that artifact into `release-assets/` and checksums them, so it needs no change.

- [x] **Step 1: Build an AppImage locally from a published binary**

This proves the repository's existing `script/linux/bundle` already works for the `doomterm` channel. It needs the build image `localhost/doomterm-build:ubuntu24.04` (built by `script/doomterm/build-env`) and about 1.5 GB of free disk. Use a scratch directory on a real disk, not a small `/tmp`.

```bash
SP="$HOME/.cache/doomterm-appimage-proof"; rm -rf "$SP"; mkdir -p "$SP/tools" "$SP/target/release-lto"
gh release download v1.1.8 -R CMLeadmon/Doom-Term -p doomterm-linux-x86_64.tar.gz -D "$SP"
tar -xzf "$SP/doomterm-linux-x86_64.tar.gz" -C "$SP"
cp "$SP/doomterm-linux-x86_64/doomterm" "$SP/target/release-lto/doomterm"
curl -fsSL --retry 3 --retry-all-errors -o "$SP/tools/linuxdeploy-x86_64.AppImage" https://github.com/linuxdeploy/linuxdeploy/releases/download/1-alpha-20251107-1/linuxdeploy-x86_64.AppImage
echo "c20cd71e3a4e3b80c3483cef793cda3f4e990aca14014d23c544ca3ce1270b4d  $SP/tools/linuxdeploy-x86_64.AppImage" | sha256sum -c -
curl -fsSL --retry 3 --retry-all-errors -o "$SP/tools/runtime-x86_64" https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64
echo "2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d  $SP/tools/runtime-x86_64" | sha256sum -c -
chmod +x "$SP/tools/linuxdeploy-x86_64.AppImage"; ln -sf linuxdeploy-x86_64.AppImage "$SP/tools/linuxdeploy"
UPD="$(python3 script/doomterm/channel_manifests.py appimage-update-info)"
podman run --rm --security-opt label=disable -v "$PWD:/work:ro" -v "$SP:/out" -w /work \
  -e CARGO_TARGET_DIR=/out/target -e APPIMAGE_EXTRACT_AND_RUN=1 \
  -e LDAI_OUTPUT=DoomTerm-x86_64.AppImage -e "LDAI_UPDATE_INFORMATION=$UPD" -e LDAI_NO_APPSTREAM=1 \
  -e LDAI_RUNTIME_FILE=/out/tools/runtime-x86_64 \
  -e SETTINGS_SCHEMA_EXECUTABLE=/out/target/release-lto/doomterm \
  -e PATH=/out/tools:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  localhost/doomterm-build:ubuntu24.04 \
  bash -c './script/linux/bundle --channel doomterm --skip-build --packages appimage' 2>&1 | tee "$SP/step1-build.log"
grep -c 'Downloading runtime file from' "$SP/step1-build.log"
```

Expected: the last line is `Successfully built AppImage at /out/target/release-lto/bundle/linux/DoomTerm-x86_64.AppImage!`, preceded by `zsyncmake is available and updateinformation is provided, hence generating zsync file`. If the repository mount is read-only the script still works, because everything it writes goes to `/out`. The `grep -c` prints `0`: the build log has no `Downloading runtime file from` line, so the pinned runtime was used. If it prints `1`, `LDAI_RUNTIME_FILE` was ignored and the runtime came from the rolling `continuous` release; stop and report.

- [x] **Step 2: Check the outputs**

```bash
OUT="$SP/target/release-lto/bundle/linux"
ls -la "$OUT"
readelf -p .upd_info "$OUT/DoomTerm-x86_64.AppImage"
head -n 8 "$OUT/DoomTerm-x86_64.AppImage.zsync"
mkdir -p "$SP/tmp"; env -u DISPLAY -u WAYLAND_DISPLAY TMPDIR="$SP/tmp" APPIMAGE_EXTRACT_AND_RUN=1 "$OUT/DoomTerm-x86_64.AppImage" --version
cmp -l -n 944632 "$SP/tools/runtime-x86_64" "$OUT/DoomTerm-x86_64.AppImage" | wc -l
```

Expected: the AppImage is about 90 to 100 MB and the `.zsync` file about 335 KB; the `.upd_info` dump shows `gh-releases-zsync|CMLeadmon|Doom-Term|latest|DoomTerm-x86_64.AppImage.zsync`; the `.zsync` header contains `Filename: DoomTerm-x86_64.AppImage` and `URL: DoomTerm-x86_64.AppImage`; the `--version` command prints `Doom Term 1.1.8`; the `cmp` count is about `91`, because the first 944,632 bytes of the AppImage are the pinned runtime with only its 16-byte digest and the update address patched in (against the rolling `continuous` runtime the same comparison differs in hundreds of thousands of bytes).

- [x] **Step 3: Prove the app works inside the AppImage with the project's GUI smoke test**

`drag-smoke` runs an executable under Xvfb in `localhost/doomterm-verify:ubuntu24.04` (build it with the command in that script's error message if it is missing) and drags a tab out with real pointer input. It needs the binary inside its own repository root, so run it from a scratch copy:

```bash
R="$HOME/.cache/doomterm-drag-proof"; rm -rf "$R"; mkdir -p "$R/script/doomterm" "$R/target/appimage" "$R/out"
cp script/doomterm/drag-smoke "$R/script/doomterm/drag-smoke"
cp "$SP/target/release-lto/bundle/linux/DoomTerm-x86_64.AppImage" "$R/target/appimage/"
printf '#!/bin/sh\nexport APPIMAGE_EXTRACT_AND_RUN=1\nexec "$(dirname "$0")/DoomTerm-x86_64.AppImage" "$@"\n' > "$R/target/appimage/run.sh"
chmod +x "$R/target/appimage/run.sh" "$R/script/doomterm/drag-smoke"
(cd "$R" && DOOMTERM_BINARY=target/appimage/run.sh bash script/doomterm/drag-smoke out)
```

Expected: `windows before drag: 1; after drag: 2` and `PASS: dragging a tab out of the window opened a new window.` Open `$R/out/before-drag.png` and `$R/out/after-drag.png` and look at them; a passing exit code is not a substitute for seeing a rendered window.

- [x] **Step 4: Add the AppImage steps to the Linux build job**

In `.github/workflows/doomterm-ci.yml`, replace the final step of `build-linux`, `Upload Linux Artifact`, with the following. It adds three steps and uploads the AppImage files beside the tarball. The files are copied to the workspace root first so the artifact stays flat, like the macOS and Windows ones.

```yaml
      - name: Install Pinned AppImage Tooling
        run: |
          set -euo pipefail
          tools="$RUNNER_TEMP/appimage-tools"
          mkdir -p "$tools"
          curl -fsSL --retry 3 --retry-all-errors -o "$tools/linuxdeploy-x86_64.AppImage" https://github.com/linuxdeploy/linuxdeploy/releases/download/1-alpha-20251107-1/linuxdeploy-x86_64.AppImage
          echo "c20cd71e3a4e3b80c3483cef793cda3f4e990aca14014d23c544ca3ce1270b4d  $tools/linuxdeploy-x86_64.AppImage" | sha256sum -c -
          curl -fsSL --retry 3 --retry-all-errors -o "$tools/runtime-x86_64" https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64
          echo "2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d  $tools/runtime-x86_64" | sha256sum -c -
          chmod +x "$tools/linuxdeploy-x86_64.AppImage"
          ln -sf linuxdeploy-x86_64.AppImage "$tools/linuxdeploy"
          echo "$tools" >> "$GITHUB_PATH"

      - name: Build Linux AppImage
        env:
          APPIMAGE_EXTRACT_AND_RUN: '1'
          LDAI_OUTPUT: DoomTerm-x86_64.AppImage
          LDAI_NO_APPSTREAM: '1'
          LDAI_RUNTIME_FILE: ${{ runner.temp }}/appimage-tools/runtime-x86_64
          SETTINGS_SCHEMA_EXECUTABLE: ${{ github.workspace }}/target/release-lto/doomterm
        run: |
          set -euo pipefail
          LDAI_UPDATE_INFORMATION="$(python3 script/doomterm/channel_manifests.py appimage-update-info)"
          export LDAI_UPDATE_INFORMATION
          ./script/linux/bundle --channel doomterm --skip-build --packages appimage
          cp target/release-lto/bundle/linux/DoomTerm-x86_64.AppImage target/release-lto/bundle/linux/DoomTerm-x86_64.AppImage.zsync .

      - name: Verify AppImage Runs And Carries Its Update Address
        env:
          APPIMAGE_EXTRACT_AND_RUN: '1'
        run: |
          set -euo pipefail
          flags=()
          if [[ "${GITHUB_REF}" == refs/tags/v* ]]; then
            flags+=(--version "${GITHUB_REF_NAME#v}")
          fi
          python3 script/doomterm/verify_appimage.py --dir . "${flags[@]}"

      - name: Upload Linux Artifact
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: doomterm-linux-x86_64
          path: |
            doomterm-linux-x86_64.tar.gz
            DoomTerm-x86_64.AppImage
            DoomTerm-x86_64.AppImage.zsync
```

- [x] **Step 5: Lint the workflow**

Run: `podman run --rm --security-opt label=disable -v "$PWD:/repo:ro" -w /repo docker.io/rhysd/actionlint:latest -color=false .github/workflows/doomterm-ci.yml`

Expected: exactly one finding, the pre-existing `SC2035` in the publish job. Any other finding is a defect in this step. In particular, assign `LDAI_UPDATE_INFORMATION` on its own line and export it afterwards: `export VAR="$(cmd)"` hides a failing `cmd` (`SC2155`) and would build an AppImage with no update address.

- [x] **Step 6: Exercise the new verification step on your local AppImage**

The helper below runs one step's script from a workflow file on this machine. It is local-only; do not commit it.

```python
#!/usr/bin/env python3
"""Local-only helper (do not commit): run one workflow step's `run:` script on this machine.

Usage: run_step.py WORKFLOW.yml JOB "STEP NAME" [KEY=VALUE ...]

The job's and the step's `env:` are applied first, then the KEY=VALUE overrides. Override any
value that is a `${{ ... }}` expression, because nothing here evaluates expressions.
"""
import os
import subprocess
import sys

import yaml

workflow_path, job_name, step_name, *overrides = sys.argv[1:]
with open(workflow_path) as handle:
    job = yaml.safe_load(handle)["jobs"][job_name]
step = next(step for step in job["steps"] if step.get("name") == step_name)
env = dict(os.environ)
for source in (job.get("env") or {}, step.get("env") or {}):
    env.update({key: str(value) for key, value in source.items()})
env.update(pair.split("=", 1) for pair in overrides)
sys.exit(subprocess.run(["bash", "-e", "-c", step["run"]], env=env).returncode)
```

Save it as `$SP/run_step.py`, then run the step against the AppImage from Step 1, with positive and negative cases:

```bash
R="$SP/ci"; rm -rf "$R"; mkdir -p "$R/script/doomterm"
cp script/doomterm/channel_manifests.py "$R/script/doomterm/"
cp "$SP/target/release-lto/bundle/linux/DoomTerm-x86_64.AppImage"* "$R/"
WF="$PWD/.github/workflows/doomterm-ci.yml"; STEP="Verify AppImage Runs And Carries Its Update Address"
cd "$R"
echo "--- branch build"; env -u DISPLAY TMPDIR="$SP/tmp" python3 "$SP/run_step.py" "$WF" build-linux "$STEP" GITHUB_REF=refs/heads/main GITHUB_REF_NAME=main; echo "exit $?"
echo "--- tag build, version matches"; env -u DISPLAY TMPDIR="$SP/tmp" python3 "$SP/run_step.py" "$WF" build-linux "$STEP" GITHUB_REF=refs/tags/v1.1.8 GITHUB_REF_NAME=v1.1.8; echo "exit $?"
echo "--- tag build, version does not match"; env -u DISPLAY TMPDIR="$SP/tmp" python3 "$SP/run_step.py" "$WF" build-linux "$STEP" GITHUB_REF=refs/tags/v9.9.9 GITHUB_REF_NAME=v9.9.9; echo "exit $?"
cd - >/dev/null
```

Expected: the first two print `Doom Term 1.1.8` and `exit 0`; the third prints `Doom Term 1.1.8` and `exit 1`. Then blank the update address inside a copy of the AppImage and confirm the step now fails:

```bash
python3 - "$R" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1], "DoomTerm-x86_64.AppImage")
data = bytearray(path.read_bytes())
needle = b"gh-releases-zsync|CMLeadmon|Doom-Term|latest|DoomTerm-x86_64.AppImage.zsync"
start = data.find(needle, 0, 2_000_000)
assert start > 0
data[start:start + len(needle)] = b"\0" * len(needle)
path.write_bytes(data)
PY
(cd "$R" && env -u DISPLAY TMPDIR="$SP/tmp" python3 "$SP/run_step.py" "$WF" build-linux "$STEP" GITHUB_REF=refs/heads/main GITHUB_REF_NAME=main; echo "exit $?")
```

Expected: `exit 1` with no `Doom Term` line, because the update-address check fails first.

The `.zsync` header must also describe this exact AppImage. Restore the intact copies first, otherwise the blanked address above would fail these controls before they reach the header checks, then change one hex digit of the `SHA-1:` header, and separately make the `Filename:` differ only at the dot:

```bash
restore() { cp "$SP/target/release-lto/bundle/linux/DoomTerm-x86_64.AppImage" "$SP/target/release-lto/bundle/linux/DoomTerm-x86_64.AppImage.zsync" "$R/"; }
edit_zsync() { python3 - "$R" "$1" "$2" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1], "DoomTerm-x86_64.AppImage.zsync")
data = path.read_bytes()
old, new = sys.argv[2].encode(), sys.argv[3].encode()
assert data.count(old, 0, 1024) == 1
path.write_bytes(data.replace(old, new, 1))
PY
}
run() { (cd "$R" && env -u DISPLAY TMPDIR="$SP/tmp" python3 "$SP/run_step.py" "$WF" build-linux "$STEP" GITHUB_REF=refs/heads/main GITHUB_REF_NAME=main; echo "exit $?"); }
restore; sha="$(sed -n 's/^SHA-1: //p' <(head -n 8 "$R/DoomTerm-x86_64.AppImage.zsync"))"; edit_zsync "SHA-1: ${sha:0:1}" "SHA-1: $([ "${sha:0:1}" = 0 ] && echo 1 || echo 0)"; run
restore; edit_zsync "Filename: DoomTerm-x86_64.AppImage" "Filename: DoomTerm-x86_64xAppImage"; run
restore
```

Expected: both runs print `exit 1` and no `Doom Term` line. Before the SHA-1 comparison and the fixed-string matching existed, both of these passed. The last `restore` leaves the working copies intact for later tasks.

- [x] **Step 7: Commit**

```bash
git add .github/workflows/doomterm-ci.yml
git commit -m "Build an AppImage and its zsync file with every release

The AppImage embeds the address of the latest release's .zsync file, so
appimageupdatetool can update it by downloading only the changed blocks. It is
built by the existing script/linux/bundle from the same binary as the tarball.
The build checks the embedded address, the zsync header and the version."
```

---

### Task 3: Channels workflow, resolve, render and verify

**Files:**
- Create: `.github/workflows/doomterm-channels.yml`

**Interfaces:**
- Consumes: from Task 1, the commands `version`, `check-assets`, `render` and `appimage-update-info`; from Task 2, the AppImage assets on a release.
- Produces: workflow `Doom Term Channels` with jobs `resolve` (outputs `tag`, `version`, `has_appimage`, `promote`), `render` (uploads artifact `channel-manifests`, laid out as `scoop-doomterm/bucket/doomterm.json` and `homebrew-doomterm/Casks/doomterm.rb`), `verify-linux`, `verify-windows` and `verify-macos`. Task 4 adds `promote`.

- [x] **Step 1: Create the workflow**

Create `.github/workflows/doomterm-channels.yml`. It runs after the release workflow, on demand for any tag, and on pull requests that change it; pull requests never promote.

```yaml
name: Doom Term Channels

# Puts a published release on the Scoop and Homebrew channels and checks that the Linux
# AppImage can update. A pull request that changes this pipeline rehearses it against the
# latest release and promotes nothing.

on:
  workflow_run:
    workflows: ["Doom Term CI & Release"]
    types: [completed]
  workflow_dispatch:
    inputs:
      tag:
        description: 'Release tag to put on the channels, for example v1.1.9'
        required: true
        type: string
      require_appimage:
        description: 'Fail when the release has no AppImage (turn off only for releases made before the AppImage existed)'
        type: boolean
        default: true
  pull_request:
    paths:
      - .github/workflows/doomterm-channels.yml
      - script/doomterm/channel_manifests.py
      - script/doomterm/test_channel_manifests.py
      - script/doomterm/verify_appimage.py
      - script/doomterm/test_verify_appimage.py

concurrency:
  group: doomterm-channels-${{ github.event_name }}-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

permissions:
  contents: read

jobs:
  resolve:
    name: Resolve release
    if: >-
      github.event_name != 'workflow_run' ||
      (github.event.workflow_run.conclusion == 'success' &&
      github.event.workflow_run.event == 'push' &&
      startsWith(github.event.workflow_run.head_branch, 'v'))
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    outputs:
      tag: ${{ steps.release.outputs.tag }}
      version: ${{ steps.release.outputs.version }}
      has_appimage: ${{ steps.release.outputs.has_appimage }}
      promote: ${{ steps.release.outputs.promote }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false

      - name: Resolve and check the release
        id: release
        env:
          GH_TOKEN: ${{ github.token }}
          EVENT: ${{ github.event_name }}
          RUN_TAG: ${{ github.event.workflow_run.head_branch }}
          INPUT_TAG: ${{ inputs.tag }}
          INPUT_REQUIRE_APPIMAGE: ${{ inputs.require_appimage }}
        run: |
          set -euo pipefail
          case "$EVENT" in
            workflow_run)
              tag="$RUN_TAG"; require=true; promote=true ;;
            workflow_dispatch)
              tag="$INPUT_TAG"; require="$INPUT_REQUIRE_APPIMAGE"; promote=true ;;
            *)
              tag="$(gh release view --repo "$GITHUB_REPOSITORY" --json tagName --jq .tagName)"
              require=false; promote=false ;;
          esac
          version="$(python3 script/doomterm/channel_manifests.py version --tag "$tag")"
          release="$(gh release view "$tag" --repo "$GITHUB_REPOSITORY" --json isDraft,isPrerelease,assets)"
          if [ "$(jq -r '.isDraft or .isPrerelease' <<<"$release")" != false ]; then
            echo "::error::$tag is a draft or a prerelease; the channels only carry published releases"
            exit 1
          fi
          names="$(jq -r '.assets[].name' <<<"$release")"
          flags=()
          if [ "$require" = true ]; then flags+=(--require-appimage); fi
          if ! missing="$(python3 script/doomterm/channel_manifests.py check-assets "${flags[@]}" <<<"$names")"; then
            echo "::error::Release $tag is missing: ${missing//$'\n'/, }"
            exit 1
          fi
          has_appimage=false
          if grep -qx 'DoomTerm-x86_64.AppImage' <<<"$names" && grep -qx 'DoomTerm-x86_64.AppImage.zsync' <<<"$names"; then
            has_appimage=true
          fi
          {
            echo "tag=$tag"
            echo "version=$version"
            echo "has_appimage=$has_appimage"
            echo "promote=$promote"
          } >> "$GITHUB_OUTPUT"

  render:
    name: Render channel manifests
    needs: resolve
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - name: Checkout repository
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false

      - name: Render the manifests from the release checksums
        env:
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ needs.resolve.outputs.tag }}
        run: |
          set -euo pipefail
          gh release download "$TAG" --repo "$GITHUB_REPOSITORY" --pattern SHA256SUMS.txt --dir "$RUNNER_TEMP"
          python3 script/doomterm/channel_manifests.py render --tag "$TAG" --sums "$RUNNER_TEMP/SHA256SUMS.txt" --out channels

      - name: Upload the rendered manifests
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: channel-manifests
          path: channels/
          if-no-files-found: error

  verify-linux:
    name: Verify Linux AppImage
    needs: resolve
    if: needs.resolve.outputs.has_appimage == 'true'
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    env:
      TAG: ${{ needs.resolve.outputs.tag }}
      VERSION: ${{ needs.resolve.outputs.version }}
      GH_TOKEN: ${{ github.token }}
      APPIMAGE_EXTRACT_AND_RUN: '1'
    steps:
      - name: Checkout repository
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false

      - name: Download and check the release's AppImage
        run: |
          set -euo pipefail
          mkdir assets
          gh release download "$TAG" --repo "$GITHUB_REPOSITORY" --dir assets --pattern SHA256SUMS.txt --pattern 'DoomTerm-x86_64.AppImage*'
          python3 script/doomterm/verify_appimage.py --dir assets --sums assets/SHA256SUMS.txt --version "$VERSION"

      - name: Update the previous release's AppImage to this one
        run: |
          set -euo pipefail
          previous="$(gh api --paginate --slurp "repos/$GITHUB_REPOSITORY/releases" | jq 'add' | python3 script/doomterm/channel_manifests.py previous-appimage --tag "$TAG")"
          if [ -z "$previous" ]; then
            echo "::notice::No earlier release has an AppImage, so there is nothing to update from yet."
            exit 0
          fi
          mkdir update
          gh release download "$previous" --repo "$GITHUB_REPOSITORY" --dir update --pattern SHA256SUMS.txt --pattern 'DoomTerm-x86_64.AppImage*'
          previous_version="$(python3 script/doomterm/channel_manifests.py version --tag "$previous")"
          python3 script/doomterm/verify_appimage.py --dir update --sums update/SHA256SUMS.txt --version "$previous_version"
          tool="$RUNNER_TEMP/appimageupdatetool"
          curl -fsSL --retry 3 --retry-all-errors -o "$tool" https://github.com/AppImageCommunity/AppImageUpdate/releases/download/2.0.0-alpha-1-20251018/appimageupdatetool-x86_64.AppImage
          echo "d976cdac667b03dee8cb23fb95ef74b042c406c5cbab3ff294d2b16efeaff84f  $tool" | sha256sum -c -
          chmod +x "$tool"
          "$tool" -O -u "zsync|https://github.com/$GITHUB_REPOSITORY/releases/download/$TAG/DoomTerm-x86_64.AppImage.zsync" update/DoomTerm-x86_64.AppImage
          cp assets/DoomTerm-x86_64.AppImage.zsync update/
          python3 script/doomterm/verify_appimage.py --dir update --sums assets/SHA256SUMS.txt --version "$VERSION"

  verify-windows:
    name: Verify Windows (Scoop)
    needs: [resolve, render]
    runs-on: windows-latest
    timeout-minutes: 30
    steps:
      - name: Download the rendered manifests
        uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4
        with:
          name: channel-manifests
          path: channels

      - name: Install Scoop
        shell: pwsh
        run: |
          $ErrorActionPreference = 'Stop'
          Invoke-RestMethod -Uri https://get.scoop.sh -OutFile install-scoop.ps1
          ./install-scoop.ps1 -RunAsAdmin
          Add-Content -Path $env:GITHUB_PATH -Value "$HOME\scoop\shims"

      - name: Install Doom Term from the rendered bucket
        shell: pwsh
        env:
          VERSION: ${{ needs.resolve.outputs.version }}
        run: |
          $ErrorActionPreference = 'Stop'
          $bucket = Join-Path $PWD 'channels/scoop-doomterm'
          git -C $bucket init -b main
          git -C $bucket add -A
          git -C $bucket -c user.name=ci -c user.email=ci@users.noreply.github.com commit -m rehearsal
          New-Item -ItemType Directory -Force "$HOME\scoop\buckets" | Out-Null
          Copy-Item -Recurse $bucket "$HOME\scoop\buckets\doomterm"
          scoop install doomterm/doomterm
          $prefix = scoop prefix doomterm
          if (-not (Test-Path "$prefix\doomterm.exe")) { throw "doomterm.exe was not installed under $prefix" }
          $installed = (Get-Content "$prefix\manifest.json" -Raw | ConvertFrom-Json).version
          if ($installed -ne $env:VERSION) { throw "Scoop installed $installed, expected $env:VERSION" }
          $out = Join-Path $env:RUNNER_TEMP 'version.txt'
          Start-Process -FilePath "$prefix\doomterm.exe" -ArgumentList '--version' -RedirectStandardOutput $out -NoNewWindow -Wait
          $printed = (Get-Content $out -Raw).Trim()
          if ($printed -ne "Doom Term $env:VERSION") { throw "doomterm.exe --version printed '$printed'" }

  verify-macos:
    name: Verify macOS (Homebrew)
    needs: [resolve, render]
    runs-on: macos-14
    timeout-minutes: 30
    steps:
      - name: Download the rendered manifests
        uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4
        with:
          name: channel-manifests
          path: channels

      - name: Install Doom Term from the rendered tap
        env:
          HOMEBREW_NO_AUTO_UPDATE: '1'
          HOMEBREW_NO_INSTALL_CLEANUP: '1'
          VERSION: ${{ needs.resolve.outputs.version }}
        run: |
          set -euo pipefail
          tap="$PWD/channels/homebrew-doomterm"
          git -C "$tap" init -b main
          git -C "$tap" add -A
          git -C "$tap" -c user.name=ci -c user.email=ci@users.noreply.github.com commit -m rehearsal
          brew tap CMLeadmon/doomterm "$tap"
          brew install --cask CMLeadmon/doomterm/doomterm
          app=/Applications/DoomTerm.app/Contents/MacOS/doomterm
          test -x "$app"
          printed="$("$app" --version)"
          if [ "$printed" != "Doom Term $VERSION" ] && [ "$printed" != "Doom Term v$VERSION" ]; then
            echo "::error::doomterm --version printed '$printed'"
            exit 1
          fi
```

- [x] **Step 2: Lint it**

Run: `podman run --rm --security-opt label=disable -v "$PWD:/repo:ro" -w /repo docker.io/rhysd/actionlint:latest -color=false .github/workflows/doomterm-channels.yml`

Expected: no output.

- [x] **Step 3: Run `resolve` and `render` against the real v1.1.8 release**

Reuse `run_step.py` from Task 2 Step 6 (`$SP/run_step.py`). These runs call the real `gh`, so they test the actual release metadata:

```bash
SP="${SP:-$HOME/.cache/doomterm-appimage-proof}"
WF=.github/workflows/doomterm-channels.yml; TOK="$(gh auth token)"; OUT="$(mktemp -d)"
resolve() {
  : > "$OUT/gh_output"
  python3 "$SP/run_step.py" "$WF" resolve "Resolve and check the release" GH_TOKEN="$TOK" GITHUB_REPOSITORY=CMLeadmon/Doom-Term GITHUB_OUTPUT="$OUT/gh_output" "$@"
  echo "exit=$? outputs: $(tr '\n' ' ' < "$OUT/gh_output")"
}
resolve EVENT=workflow_dispatch INPUT_TAG=v1.1.8 INPUT_REQUIRE_APPIMAGE=false RUN_TAG=
resolve EVENT=workflow_dispatch INPUT_TAG=v1.1.8 INPUT_REQUIRE_APPIMAGE=true RUN_TAG=
resolve EVENT=workflow_run RUN_TAG=v1.1.8 INPUT_TAG= INPUT_REQUIRE_APPIMAGE=
resolve EVENT=pull_request RUN_TAG= INPUT_TAG= INPUT_REQUIRE_APPIMAGE=
resolve EVENT=workflow_dispatch INPUT_TAG=v1.2.0-rc1 INPUT_REQUIRE_APPIMAGE=false RUN_TAG=
resolve EVENT=workflow_dispatch INPUT_TAG=latest INPUT_REQUIRE_APPIMAGE=false RUN_TAG=
resolve EVENT=workflow_dispatch INPUT_TAG=v9.9.9 INPUT_REQUIRE_APPIMAGE=false RUN_TAG=
python3 "$SP/run_step.py" "$WF" render "Render the manifests from the release checksums" GH_TOKEN="$TOK" GITHUB_REPOSITORY=CMLeadmon/Doom-Term TAG=v1.1.8 RUNNER_TEMP="$OUT"
find channels -type f | sort; rm -rf channels
```

Expected, in order: (1) `exit=0 outputs: tag=v1.1.8 version=1.1.8 has_appimage=false promote=true`; (2) and (3) `::error::Release v1.1.8 is missing: DoomTerm-x86_64.AppImage, DoomTerm-x86_64.AppImage.zsync` with `exit=1`, because v1.1.8 predates the AppImage; (4) `exit=0 outputs: tag=v1.1.8 version=1.1.8 has_appimage=false promote=false`; (5) and (6) `error: … is not a release tag like v1.1.8 or v1.1.2.1` with `exit=2`; (7) `release not found` with `exit=1`. The render step prints `channels/homebrew-doomterm/Casks/doomterm.rb` and `channels/scoop-doomterm/bucket/doomterm.json`.

- [x] **Step 4: Run the `verify-linux` check against a local release directory**

`gh_stub.sh` stands in for `gh release download`:

```bash
#!/usr/bin/env bash
# Local-only stand-in for `gh release download`: copies matching files from $RELEASE_DIR.
if [ "$1 $2" = "release download" ]; then
  shift 2
  dir=.
  patterns=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --dir) dir="$2"; shift 2 ;;
      --pattern) patterns+=("$2"); shift 2 ;;
      *) shift ;;
    esac
  done
  mkdir -p "$dir"
  for pattern in "${patterns[@]}"; do
    for file in $RELEASE_DIR/$pattern; do cp "$file" "$dir/"; done
  done
  exit 0
fi
echo "unexpected gh call: $*" >&2
exit 99
```

Save the stub as `$SP/bin/gh` and `chmod +x` it. Then build a fake release directory and run the step:

```bash
SP="${SP:-$HOME/.cache/doomterm-appimage-proof}"
mkdir -p "$SP/bin" "$SP/rel"
cp "$SP/target/release-lto/bundle/linux/DoomTerm-x86_64.AppImage"* "$SP/rel/"
(cd "$SP/rel" && sha256sum DoomTerm-x86_64.AppImage DoomTerm-x86_64.AppImage.zsync > SHA256SUMS.txt)
WF="$PWD/.github/workflows/doomterm-channels.yml"; STEP="Download and check the release's AppImage"
verify() { (cd "$SP/ci" && rm -rf assets && env -u DISPLAY PATH="$SP/bin:$PATH" RELEASE_DIR="$SP/rel" TMPDIR="$SP/tmp" GITHUB_REPOSITORY=CMLeadmon/Doom-Term python3 "$SP/run_step.py" "$WF" verify-linux "$STEP" GH_TOKEN=x "$@"; echo "exit $?"); }
verify TAG=v1.1.8 VERSION=1.1.8
verify TAG=v9.9.9 VERSION=9.9.9
cp "$SP/rel/DoomTerm-x86_64.AppImage" "$SP/orig.AppImage"
python3 -c "import pathlib; p = pathlib.Path('$SP/rel/DoomTerm-x86_64.AppImage'); b = bytearray(p.read_bytes()); b[-100] ^= 0xFF; p.write_bytes(b)"
verify TAG=v1.1.8 VERSION=1.1.8
cp "$SP/orig.AppImage" "$SP/rel/DoomTerm-x86_64.AppImage"
```

Expected: the first run prints two `OK` lines and `exit 0`; the second, with a version that does not match the binary, ends `exit 1`; the third, after flipping a byte, prints `WARNING: 1 computed checksum did NOT match` and `exit 1`. The step that finds the previous AppImage release and updates it cannot be exercised until an earlier release carries an AppImage; it first runs for real at the second AppImage release (Task 9). Its search loop can be checked now against the real repository, where it must find nothing:

```bash
python3 "$SP/run_step.py" "$WF" verify-linux "Update the previous release's AppImage to this one" TAG=v1.1.8 VERSION=1.1.8 GITHUB_REPOSITORY=CMLeadmon/Doom-Term GH_TOKEN="$(gh auth token)" RUNNER_TEMP="$SP/tmp"; echo "exit $?"
```

Expected: `::notice::No earlier release has an AppImage, so there is nothing to update from yet.` and `exit 0`.

- [x] **Step 5: Run the ledger check and commit**

```bash
git add .github/workflows/doomterm-channels.yml
python3 script/doomterm/check-inventory.py | tail -1
git commit -m "Add the channels workflow: resolve, render and verify

After a release is published this resolves it, renders the Scoop manifest and
Homebrew cask from its checksums, and checks the AppImage, the Scoop install and
the Homebrew install on real runners. A pull request that changes the pipeline
rehearses it against the latest release. Promotion to the channels follows."
```

Expected: the ledger check ends with `OK: the ledger matches the tree.`

---

### Task 4: Promotion to the channels, with an approval gate

**Files:**
- Modify: `.github/workflows/doomterm-channels.yml` (append one job)

**Interfaces:**
- Consumes: the `channel-manifests` artifact and the `resolve` outputs from Task 3; `channel_manifests.py decide` from Task 1; the repository secret `CHANNELS_TOKEN` in environment `channels` (created in Task 7).
- Produces: one commit per channel repository per newly promoted version, authored by `github-actions[bot]`, touching `bucket/doomterm.json` and `Casks/doomterm.rb`.

- [x] **Step 1: Append the `promote` job**

Append this to the end of `.github/workflows/doomterm-channels.yml`. It runs only when `resolve` says the run may promote and every verification that ran succeeded, waits for approval in the `channels` environment, and only the checkout steps that push receive the token.

```yaml
  promote:
    name: Promote to the channels
    needs: [resolve, render, verify-linux, verify-windows, verify-macos]
    if: >-
      ${{ !cancelled() &&
      needs.resolve.outputs.promote == 'true' &&
      needs.verify-windows.result == 'success' &&
      needs.verify-macos.result == 'success' &&
      (needs.verify-linux.result == 'success' || needs.verify-linux.result == 'skipped') }}
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    environment: channels
    concurrency:
      group: doomterm-channels-promote
      cancel-in-progress: false
      queue: max
    steps:
      - name: Checkout this repository for its scripts
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          persist-credentials: false
          path: doomterm

      - name: Download the rendered manifests
        uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4
        with:
          name: channel-manifests
          path: manifests

      - name: Checkout the Scoop bucket
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          repository: CMLeadmon/scoop-doomterm
          token: ${{ secrets.CHANNELS_TOKEN }}
          path: scoop-doomterm

      - name: Checkout the Homebrew tap
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with:
          repository: CMLeadmon/homebrew-doomterm
          token: ${{ secrets.CHANNELS_TOKEN }}
          path: homebrew-doomterm

      - name: Update the channels
        env:
          VERSION: ${{ needs.resolve.outputs.version }}
        run: |
          set -euo pipefail
          promote() {
            local kind="$1" manifest="$2" verdict repo
            repo="${manifest%%/*}"
            verdict="$(python3 doomterm/script/doomterm/channel_manifests.py decide --kind "$kind" --manifest "$manifest" --version "$VERSION")"
            case "$verdict" in
              same)
                echo "$manifest is already at $VERSION" ;;
              older)
                echo "::error::$manifest is ahead of $VERSION; refusing to move the channel backwards"
                return 1 ;;
              update)
                mkdir -p "$(dirname "$manifest")"
                cp "manifests/$manifest" "$manifest"
                git -C "$repo" config user.name "github-actions[bot]"
                git -C "$repo" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
                git -C "$repo" add "${manifest#*/}"
                git -C "$repo" commit -m "doomterm $VERSION" -m "Release: https://github.com/$GITHUB_REPOSITORY/releases/tag/v$VERSION"
                git -C "$repo" push origin HEAD:main ;;
            esac
          }
          promote scoop scoop-doomterm/bucket/doomterm.json
          promote cask homebrew-doomterm/Casks/doomterm.rb
```

- [x] **Step 2: Lint the whole file**

Run: `podman run --rm --security-opt label=disable -v "$PWD:/repo:ro" -w /repo docker.io/rhysd/actionlint:latest -color=false .github/workflows/doomterm-channels.yml`

Expected: no output.

- [x] **Step 3: Run the promotion script against two fake channel repositories**

This executes the `promote` step's real shell, extracted from the workflow, against local bare repositories. It covers the first promotion into an empty repository, a repeat, a newer version, an older version and a four-part version. Save it as `$SP/promote_sim.sh` and run it:

```bash
#!/usr/bin/env bash
# Local-only (do not commit): runs the promote step's shell against two fake channel repositories.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
SIM="$(mktemp -d)"
trap 'rm -rf "$SIM"' EXIT
CLI="$ROOT/script/doomterm/channel_manifests.py"
SUMS="$ROOT/script/doomterm/fixtures/SHA256SUMS.v1.1.8.txt"

mkdir -p "$SIM/remote" "$SIM/run/doomterm/script"
cp -r "$ROOT/script/doomterm" "$SIM/run/doomterm/script/doomterm"
for repo in scoop-doomterm homebrew-doomterm; do
  git init -q --bare -b main "$SIM/remote/$repo.git"
  git clone -q "$SIM/remote/$repo.git" "$SIM/run/$repo" 2>/dev/null
  git -C "$SIM/run/$repo" -c user.name=seed -c user.email=seed@example.invalid commit -q --allow-empty -m seed
  git -C "$SIM/run/$repo" push -q origin HEAD:main
done

python3 - "$ROOT" > "$SIM/promote_body.sh" <<'PY'
import pathlib, sys
workflow = pathlib.Path(sys.argv[1], ".github/workflows/doomterm-channels.yml").read_text()
block = workflow.split("      - name: Update the channels\n")[1].split("        run: |\n")[1]
print("\n".join(line[10:] for line in block.splitlines()))
PY

promote_as() {
  local version="$1"
  rm -rf "$SIM/run/manifests"
  python3 "$CLI" render --tag v1.1.8 --sums "$SUMS" --out "$SIM/run/manifests"
  sed -i "s/1\.1\.8/$version/g" "$SIM/run/manifests/scoop-doomterm/bucket/doomterm.json" "$SIM/run/manifests/homebrew-doomterm/Casks/doomterm.rb"
  (cd "$SIM/run" && VERSION="$version" GITHUB_REPOSITORY=CMLeadmon/Doom-Term bash -e "$SIM/promote_body.sh")
}
commits() { git -C "$SIM/remote/$1.git" rev-list --count main; }
expect() { [ "$1" = "$2" ] && echo "ok: $3" || { echo "FAIL: $3 (got $1, want $2)"; exit 1; }; }

promote_as 1.1.8 >/dev/null 2>&1
expect "$(commits scoop-doomterm)-$(commits homebrew-doomterm)" 2-2 "first promotion fills empty channel repositories"
promote_as 1.1.8 >/dev/null 2>&1
expect "$(commits scoop-doomterm)-$(commits homebrew-doomterm)" 2-2 "the same version again changes nothing"
promote_as 1.1.9 >/dev/null 2>&1
expect "$(commits scoop-doomterm)-$(commits homebrew-doomterm)" 3-3 "a newer version is committed"
if promote_as 1.1.8 >/dev/null 2>&1; then echo "FAIL: an older version was accepted"; exit 1; fi
expect "$(commits scoop-doomterm)-$(commits homebrew-doomterm)" 3-3 "an older version is refused and nothing is committed"
promote_as 1.1.9.1 >/dev/null 2>&1
expect "$(commits scoop-doomterm)-$(commits homebrew-doomterm)" 4-4 "a four-part version outranks its three-part base"
echo "all promotion checks passed"
```

Run: `bash "${SP:-$HOME/.cache/doomterm-appimage-proof}/promote_sim.sh"`

Expected:

```
ok: first promotion fills empty channel repositories
ok: the same version again changes nothing
ok: a newer version is committed
ok: an older version is refused and nothing is committed
ok: a four-part version outranks its three-part base
all promotion checks passed
```

The first check exists because `cp` cannot create `bucket/` or `Casks/` in a channel repository that has none, so the first promotion would fail. Lint cannot see that; this script can.

- [x] **Step 4: Run the ledger check and commit**

```bash
git add .github/workflows/doomterm-channels.yml
python3 script/doomterm/check-inventory.py | tail -1
git commit -m "Promote verified releases to the Scoop and Homebrew channels

The promote job waits for approval in the channels environment, then commits the
generated manifests to the two channel repositories with a token scoped to just
them. It does nothing when a channel already has the version and refuses to move
a channel backwards, so re-running an old tag cannot downgrade anyone."
```

Expected: the ledger check ends with `OK: the ledger matches the tree.`

---

### Task 5: Documentation

**Files:**
- Create: `docs/doom-term/update-channels.md`
- Modify: `docs/doom-term/README.md` (one index line)

**Interfaces:**
- Consumes: the names and behavior fixed in Tasks 1 to 4.
- Produces: the user and maintainer page that Task 8 later flips from "not live yet" to live.

- [x] **Step 1: Write the page**

Create `docs/doom-term/update-channels.md`. Its status line says "not live yet", because the channel repositories do not exist and nothing has been promoted when this merges; `CONTRIBUTING.md` requires separating released behavior from changes only on `main`.

```markdown
# Update channels

Doom Term does not update itself and makes no update checks. Each platform has a package channel
that you update with one command. Every channel points at the files of a GitHub release, and the
`SHA256SUMS.txt` on that release is the checksum all three are verified against.

> **Status: not live yet.** This page describes what the release pipeline builds and what the
> maintainer sets up once. It changes to "live" when the first release is promoted to the channels.

## Install and update

| Platform | Install once | Update |
| --- | --- | --- |
| Linux x86_64 | Download `DoomTerm-x86_64.AppImage` from a release, `chmod +x` it, and run it | `appimageupdatetool -O DoomTerm-x86_64.AppImage` |
| Windows x86_64 | `scoop bucket add doomterm https://github.com/CMLeadmon/scoop-doomterm`, then `scoop install doomterm` | `scoop update doomterm` |
| macOS Apple silicon | `brew install --cask CMLeadmon/doomterm/doomterm` | `brew upgrade --cask doomterm` |

The Linux tarball, the Windows installer and zip, and the macOS DMG and zip stay on every release.

### Linux: AppImage

- The AppImage uses your system's libraries exactly as the tarball does, so it has the same
  Ubuntu 24.04 baseline. It adds updating, not portability.
- AppImages need FUSE 2 (`libfuse2`). Without it, run `APPIMAGE_EXTRACT_AND_RUN=1 ./DoomTerm-x86_64.AppImage`.
- `appimageupdatetool` is the command-line tool of the
  [AppImageUpdate](https://github.com/AppImageCommunity/AppImageUpdate) project. It downloads only the
  blocks that changed. In a test from v1.1.5 to v1.1.6 it reused about 52 MB and fetched about 60 MB
  of a 94 MB file; the saving depends on how much the binary changed.
- The previous file is kept next to the new one as `DoomTerm-x86_64.AppImage.zs-old`, which is your
  rollback.
- The updater warns that the AppImage is not signed. Releases are checksummed, not GPG-signed.
- The AppImage is published from the first release after v1.1.8. Earlier releases have the tarball only.

### Windows: Scoop

- Scoop installs the standalone zip, `doomterm-windows-x64.zip`. It does not run the installer, so
  integrations that only the installer registers, such as the Explorer folder context-menu entries,
  are not set up. Use `DoomTermSetup.exe` if you want them.
- Release builds are unsigned.

### macOS: Homebrew

- Apple silicon only. The app is unsigned and not notarized, so macOS blocks the first launch until
  you approve it in System Settings, Privacy & Security, Open Anyway.
- Doom Term has its own tap because Homebrew announced that the main cask repository would disable
  casks that fail Gatekeeper checks from 2026-09-01.

## How a release reaches the channels

1. A `v*` tag runs `Doom Term CI & Release`, which builds every platform and publishes the release,
   including `DoomTerm-x86_64.AppImage` and its `.zsync` file.
2. When that workflow finishes, `Doom Term Channels` starts. It resolves the release, renders the
   Scoop manifest and Homebrew cask from the release's `SHA256SUMS.txt`, and verifies three things on
   real runners:
   - Linux: the AppImage matches its checksum, carries the update address, has a `.zsync` file for
     itself, and reports the release's version. When an earlier release has an AppImage, the
     updater turns that file into this one.
   - Windows: Scoop installs the manifest and `doomterm.exe --version` reports the release's version.
   - macOS: Homebrew installs the cask and the app's `--version` reports the release's version.
3. `promote` runs in the `channels` environment and waits for the maintainer's approval. It then
   commits the generated manifests to `CMLeadmon/scoop-doomterm` and `CMLeadmon/homebrew-doomterm`.
   It does nothing when a channel is already at the version and refuses to move a channel backwards.
4. A pull request that changes this pipeline runs the checks in step 2 against the latest release and
   promotes nothing.

The channel repositories hold only generated files. To change a manifest, change
`script/doomterm/channel_manifests.py`.

## Maintainer runbook

- **Approve a promotion:** open the `Doom Term Channels` run, choose Review deployments, and approve
  `channels`.
- **Run it again for a tag:** `gh workflow run doomterm-channels.yml -f tag=v1.1.9`. For a release
  made before the AppImage existed, add `-f require_appimage=false`.
- **Rotate the token:** create a fine-grained personal access token owned by `CMLeadmon`, limited to
  the two channel repositories, with Contents set to Read and write, and an expiry date. Store it with
  `gh secret set CHANNELS_TOKEN --env channels --repo CMLeadmon/Doom-Term`. Set a reminder two weeks
  before it expires; an expired token fails the `promote` job, not the release.
- **Roll a channel back:** revert the manifest commit in the channel repository. Do not re-run an
  older tag; `promote` refuses it. The next release promotes normally.
- **Releases marked latest after AppImages are introduced** must carry the AppImage and its `.zsync` file,
  because the AppImage's update address is the latest release. Automatic release runs and default manual
  runs enforce this requirement. Pull-request rehearsals and manual runs with `require_appimage=false`
  permit releases made before AppImages existed.

## Known limits

- The AppImage installs under `/opt/warpdotdev/warp-terminaldoomterm/` inside itself, because the
  upstream packaging script builds that name from the binary name. It is cosmetic, and fixing it means
  editing a shared upstream script.
- The AppImage carries the same static `THIRD_PARTY_LICENSES.txt` fallback text as other builds
  made without `cargo-about`, not a per-build list.
- The Windows and macOS channels are verified on GitHub-hosted runners only. No physical Windows or
  Mac machine is part of the release checks.
- There is no winget package, no Intel macOS build and no code signing.
- The first AppImage release cannot test updating, because no earlier AppImage exists. The second
  one does.
```

- [x] **Step 2: Add it to the documentation index**

In `docs/doom-term/README.md`, under "Develop and contribute", insert this line immediately before `- [Contribution guide](../../CONTRIBUTING.md)`:

```markdown
- [Update channels pipeline](update-channels.md): how releases reach AppImage, Scoop, and Homebrew (not live yet)
```

- [x] **Step 3: Check the claims and links, run the ledger check and commit**

Every number and name in the page comes from Appendix A. Confirm the file names it mentions exist and the ledger still passes:

```bash
for f in .github/workflows/doomterm-channels.yml script/doomterm/channel_manifests.py; do test -f "$f" && echo "exists: $f"; done
python3 script/doomterm/check-inventory.py | tail -1
git add docs/doom-term
git commit -m "Document the update channels and the maintainer runbook

Explains how each platform updates, how a release reaches the channels, how to
approve, re-run, roll back and rotate the token, and what is still limited. The
page says the channels are not live yet, because nothing has been promoted."
```

Expected: two `exists:` lines and `OK: the ledger matches the tree.`

---

### Task 6: Rehearse on CI with a pull request

**Files:**
- No new files. Edits only if a contingency below applies.

**Interfaces:**
- Consumes: Tasks 1 to 5 committed on `feat/update-channels`.
- Produces: an open pull request with a green dry run. Nothing is promoted by a pull request.

- [ ] **Step 1: Push the branch and open the pull request**

`AGENT_CONTEXT` must be one honest sentence naming the agent and model that executed this plan and the review the maintainer did (`AI_POLICY.md`). The command refuses to run without it.

```bash
: "${AGENT_CONTEXT:?set AGENT_CONTEXT to one sentence naming the agent, its scope and the maintainer review}"
REV="$(git rev-parse HEAD)"
TESTS="$(python3 -m unittest discover -s script/doomterm -p 'test_channel_manifests.py' 2>&1 | tail -3 | tr '\n' ' ')"
LEDGER="$(python3 script/doomterm/check-inventory.py 2>&1 | tail -1)"
BODY="$(mktemp)"
cat > "$BODY" <<EOF
## Description

Adds the pipeline that puts a published Doom Term release on three update channels: an AppImage with embedded update information (Linux), a Scoop bucket (Windows) and a Homebrew tap (macOS). The application does not change. The channels are not live until the maintainer creates the two channel repositories and promotes a release; see docs/doom-term/update-channels.md.

## Linked issue or scope

Maintainer-approved scope from the 2026-10-05 update-process review; implements docs/superpowers/plans/2026-10-05-update-channels.md.

## Verification

Tested revision: $REV (local), CI results below.

- Unit tests (run locally; the same suite also passes under Python 3.11 in a container): $TESTS
- Ledger: $LEDGER
- actionlint: only the existing SC2035 in the publish job.
- Local AppImage proof from the published v1.1.8 binary: built with script/linux/bundle, update address and zsync header checked, \`--version\` run, and the project's drag-smoke test passed under Xvfb.
- Not yet run: the Windows and macOS verification and the AppImage update test. They run on CI in this PR (dry run against the latest release) and at the first two AppImage releases.

## Agent context

$AGENT_CONTEXT

## Review checklist

- [x] Scope is focused and unrelated work is preserved.
- [x] Product claims distinguish released behavior from changes only on main.
- [x] Applicable verification and its limits are recorded.
- [x] Upstream-shared edits are recorded in the invasive-diff ledger (none were needed).
- [x] License notices and the local product boundary are preserved.

## Changelog

CHANGELOG-NONE
EOF
git push -u origin feat/update-channels
gh pr create --base main --head feat/update-channels --title "Add update channels: AppImage, Scoop bucket and Homebrew tap pipeline" --body-file "$BODY"
```

- [ ] **Step 2: Watch the dry run**

```bash
gh pr checks --watch
gh run list --branch feat/update-channels --json name,conclusion,databaseId --jq '.[] | "\(.name)\t\(.conclusion)\t\(.databaseId)"'
```

For each run id: `gh run view <id> --json jobs --jq '.jobs[] | "\(.name)\t\(.conclusion)"'`.

Expected for `Doom Term CI & Release`: `Policy & Plate Pure-Rust Invariants` success; `Build Linux x86_64`, `Build macOS ARM64`, `Build Windows x86_64` success; `Publish GitHub Release` skipped. Expected for `Doom Term Channels`: `Resolve release` success, `Render channel manifests` success, `Verify Linux AppImage` skipped (v1.1.8 has no AppImage), `Verify Windows (Scoop)` success, `Verify macOS (Homebrew)` success, `Promote to the channels` skipped.

- [ ] **Step 3: If a job failed, read its log and apply the matching fix**

Read the log first: `gh run view <id> --log-failed`. The Windows and macOS verifications have never run before this PR, so these are the likely first failures and their exact fixes. Apply only the one that matches, commit it with a message saying what the log showed, push, and watch again.

**The policy job says `ruby: command not found`.** In the step `Test channel manifest rendering and check the rendered cask`, add `sudo apt-get install -y ruby` as the first line of the `run:` script.

**The Linux job fails inside `Build Linux AppImage`.** The runner image differs from the build container. Read which tool linuxdeploy or the bundle script reports missing, install it with `apt-get` in the existing `Install Linux Build Dependencies` step, and say so in the PR.

**`Verify Windows (Scoop)` fails with `doomterm.exe --version printed ''`.** The Windows build is a GUI-subsystem program and prints nothing to a redirected handle. Replace the last three lines of that step's script, from `$out = Join-Path` onward, with this, which keeps the manifest-version check above it as the verification:

```powershell
          Write-Host "Scoop installed doomterm.exe $installed from the rendered bucket; the binary is not run because it prints nothing to a redirected stream."
```

Then add this bullet to "Known limits" in `docs/doom-term/update-channels.md`: "Windows verification checks that Scoop installed `doomterm.exe` at the release's version; it does not run the binary."

**`Verify Windows (Scoop)` fails at `scoop bucket add` with a path error.** Replace the line `scoop bucket add doomterm $bucket` with:

```powershell
          New-Item -ItemType Directory -Force "$HOME\scoop\buckets" | Out-Null
          Copy-Item -Recurse $bucket "$HOME\scoop\buckets\doomterm"
```

**`Verify macOS (Homebrew)` fails because the app is killed or blocked by Gatekeeper.** The cask installed; macOS refused to run the unsigned binary. In the step, insert this line before `printed="$("$app" --version)"`:

```bash
          xattr -dr com.apple.quarantine /Applications/DoomTerm.app
```

Then add this bullet to "Known limits": "macOS verification clears the quarantine attribute before running the binary, so it checks the installation and not Gatekeeper's behavior."

**`Verify macOS (Homebrew)` fails at `brew tap` or `brew install`.** Read the Homebrew error. If it rejects installing from a local path, replace the `brew tap` line with `brew tap --force CMLeadmon/doomterm "$tap"`; any other error is a real defect in the rendered cask, so fix `cask()` and its test in Task 1 instead of working around it here.

- [ ] **Step 4: Confirm nothing was promoted, then hand over**

```bash
gh run list --workflow doomterm-channels.yml --branch feat/update-channels --limit 1 --json databaseId --jq '.[0].databaseId' | xargs -I{} gh run view {} --json jobs --jq '.jobs[] | select(.name=="Promote to the channels") | .conclusion'
```

Expected: `skipped`. Update the PR description with the run URLs and results (`gh pr edit --body-file`), and leave the PR open. Merging is the maintainer's decision.

---

### Task 7: Create the channel repositories, the environment and the token

**Files:**
- No repository files. This task creates things on GitHub.

**Interfaces:**
- Consumes: nothing from earlier tasks, but the first real promotion (Task 8) needs all of it.
- Produces: public repositories `CMLeadmon/scoop-doomterm` and `CMLeadmon/homebrew-doomterm`; environment `channels` on `CMLeadmon/Doom-Term` requiring the maintainer's approval and limited to the `main` branch; secret `CHANNELS_TOKEN` in that environment.

- [ ] **Step 1: Get the maintainer's go-ahead**

Stop here and ask the maintainer. This task creates two public repositories under their account, a deployment environment, and a token. Do not continue without an explicit yes.

- [ ] **Step 2: Create the Scoop bucket repository**

```bash
WT="/var/home/cleadmon/Projects/Doom Term/.worktrees/update-channels"
BASE="$(mktemp -d)"; mkdir "$BASE/scoop-doomterm"; cd "$BASE/scoop-doomterm"
git init -q -b main
cp "$WT/LICENSE-MIT" LICENSE
```

Create `README.md` in that directory:

````markdown
# scoop-doomterm

[Scoop](https://scoop.sh) bucket for [Doom Term](https://github.com/CMLeadmon/Doom-Term).

```powershell
scoop bucket add doomterm https://github.com/CMLeadmon/scoop-doomterm
scoop install doomterm
scoop update doomterm
```

The manifest in `bucket/` is generated by Doom Term's release pipeline after each verified release.
Do not edit it by hand: change `script/doomterm/channel_manifests.py` in the Doom Term repository
instead. See the
[update channels guide](https://github.com/CMLeadmon/Doom-Term/blob/main/docs/doom-term/update-channels.md).

Scoop installs the portable zip, so integrations that only the Windows installer registers are not
set up. Release builds are unsigned.
````

```bash
git add LICENSE README.md
git commit -q -m "Add README and license"
gh repo create CMLeadmon/scoop-doomterm --public --description "Scoop bucket for Doom Term, generated by its release pipeline" --source=. --remote=origin --push
```

Expected: the repository exists with one commit: `gh repo view CMLeadmon/scoop-doomterm --json visibility,defaultBranchRef --jq '.visibility, .defaultBranchRef.name'` prints `PUBLIC` and `main`.

- [ ] **Step 3: Create the Homebrew tap repository**

```bash
mkdir "$BASE/homebrew-doomterm"; cd "$BASE/homebrew-doomterm"
git init -q -b main
cp "$WT/LICENSE-MIT" LICENSE
```

Create `README.md` in that directory:

````markdown
# homebrew-doomterm

[Homebrew](https://brew.sh) tap for [Doom Term](https://github.com/CMLeadmon/Doom-Term).

```sh
brew install --cask CMLeadmon/doomterm/doomterm
brew upgrade --cask doomterm
```

The cask in `Casks/` is generated by Doom Term's release pipeline after each verified release. Do
not edit it by hand: change `script/doomterm/channel_manifests.py` in the Doom Term repository
instead. See the
[update channels guide](https://github.com/CMLeadmon/Doom-Term/blob/main/docs/doom-term/update-channels.md).

Apple silicon only. The app is unsigned and not notarized, so macOS blocks the first launch until
you approve it in System Settings, Privacy & Security, Open Anyway.
````

```bash
git add LICENSE README.md
git commit -q -m "Add README and license"
gh repo create CMLeadmon/homebrew-doomterm --public --description "Homebrew tap for Doom Term, generated by its release pipeline" --source=. --remote=origin --push
cd "$WT"
```

Expected: `gh repo view CMLeadmon/homebrew-doomterm --json visibility --jq .visibility` prints `PUBLIC`.

- [ ] **Step 4: Create the `channels` environment**

The environment requires the maintainer's approval and only exposes its secret to workflows that run from `main`. These calls follow GitHub's REST documentation and were not run while this plan was written, so read the confirmation output.

```bash
USER_ID="$(gh api user --jq .id)"
gh api --method PUT repos/CMLeadmon/Doom-Term/environments/channels --input - <<JSON
{
  "wait_timer": 0,
  "prevent_self_review": false,
  "reviewers": [{"type": "User", "id": $USER_ID}],
  "deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}
}
JSON
gh api --method POST repos/CMLeadmon/Doom-Term/environments/channels/deployment-branch-policies -f name=main -f type=branch
gh api repos/CMLeadmon/Doom-Term/environments/channels --jq '.protection_rules[].type'
```

Expected: the last command lists `required_reviewers` and `branch_policy`.

- [ ] **Step 5: Create the token and store it**

This step is manual because GitHub only creates fine-grained tokens in the web interface. The maintainer does it:

1. Open GitHub, Settings, Developer settings, Personal access tokens, Fine-grained tokens, Generate new token.
2. Name it `doomterm-channels`. Resource owner `CMLeadmon`. Expiration: a date within one year.
3. Repository access: Only select repositories, then `scoop-doomterm` and `homebrew-doomterm`.
4. Repository permissions: Contents set to Read and write. Metadata Read-only is added automatically. Nothing else.
5. Generate the token and copy it.

Then store it, pasting the token at the prompt:

```bash
gh secret set CHANNELS_TOKEN --env channels --repo CMLeadmon/Doom-Term
gh secret list --env channels --repo CMLeadmon/Doom-Term
```

Expected: the list shows `CHANNELS_TOKEN`. Set a calendar reminder two weeks before the token's expiry date; `docs/doom-term/update-channels.md` explains the rotation.

---

### Task 8: First promotion of v1.1.8 and the documentation flip

**Files:**
- Modify: `docs/doom-term/update-channels.md`, `docs/doom-term/getting-started.md`, `docs/doom-term/README.md` (in a second, docs-only pull request)

**Interfaces:**
- Consumes: the Task 6 pull request merged by the maintainer (the workflow must exist on `main` for `workflow_dispatch`), and Task 7 complete.
- Produces: v1.1.8 manifests live in both channel repositories, verified by a real install, and documentation that says so.

- [ ] **Step 1: Get the maintainer's go-ahead**

Running the workflow publishes v1.1.8's manifests to the new channels. It creates no release and no tag. Ask the maintainer to confirm that the Task 6 pull request is merged and that they want v1.1.8 on the channels now.

- [ ] **Step 2: Run the channels workflow for v1.1.8**

v1.1.8 predates the AppImage, so the AppImage requirement is switched off for this one run:

```bash
gh workflow run doomterm-channels.yml --ref main -f tag=v1.1.8 -f require_appimage=false
sleep 10
RUN="$(gh run list --workflow doomterm-channels.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$RUN"
```

The run stops at `Promote to the channels`, waiting for approval. The maintainer approves it in the web interface: open the run, choose Review deployments, tick `channels`, Approve and deploy. The `verify-windows` and `verify-macos` jobs have already passed by then; do not ask for approval if either failed.

- [ ] **Step 3: Confirm both channel repositories carry v1.1.8**

```bash
gh api repos/CMLeadmon/scoop-doomterm/contents/bucket/doomterm.json --jq .content | base64 -d | head -3
gh api repos/CMLeadmon/homebrew-doomterm/contents/Casks/doomterm.rb --jq .content | base64 -d | sed -n '1,3p'
gh api repos/CMLeadmon/scoop-doomterm/commits --jq '.[0] | .commit.message | split("\n")[0]'
```

Expected: the manifest shows `"version": "1.1.8"`, the cask shows `version "1.1.8"`, and the last line is `doomterm 1.1.8`.

- [ ] **Step 4: Install it for real and record the result**

On the maintainer's Windows machine, in PowerShell: `scoop bucket add doomterm https://github.com/CMLeadmon/scoop-doomterm`, then `scoop install doomterm`, then start Doom Term from the Start menu and confirm it opens. If a Mac is available: `brew install --cask CMLeadmon/doomterm/doomterm`, approve the first launch in Privacy & Security, and confirm it opens. Record what was and was not tried, with the machine's OS version; the runner checks are not a substitute for these.

- [ ] **Step 5: Flip the documentation in a second pull request**

```bash
cd "/var/home/cleadmon/Projects/Doom Term"
git fetch origin
git worktree add .worktrees/update-channels-live -b docs/update-channels-live origin/main
cd .worktrees/update-channels-live
```

In `docs/doom-term/update-channels.md`, replace the status block

```markdown
> **Status: not live yet.** This page describes what the release pipeline builds and what the
> maintainer sets up once. It changes to "live" when the first release is promoted to the channels.
```

with

```markdown
> **Status:** the Scoop bucket and the Homebrew tap carry v1.1.8 and later. The AppImage is published
> from the first release after v1.1.8.
```

In `docs/doom-term/getting-started.md`, replace the Linux row of the table

```markdown
| Linux x86_64 | `doomterm-linux-x86_64.tar.gz` | Ubuntu 24.04 ABI baseline; a graphical desktop and required system libraries |
```

with

```markdown
| Linux x86_64 | `doomterm-linux-x86_64.tar.gz`, or `DoomTerm-x86_64.AppImage` from the first release after v1.1.8 | Ubuntu 24.04 ABI baseline; a graphical desktop and required system libraries |
```

and insert this section immediately before the heading `## Add agent status`:

```markdown
## Update

Windows and macOS update with one command through the [update channels](update-channels.md):
`scoop update doomterm` or `brew upgrade --cask doomterm`. On Linux the AppImage updates with
`appimageupdatetool -O DoomTerm-x86_64.AppImage` once a release carries it. Otherwise download the new
package, verify it against `SHA256SUMS.txt`, and replace the old one.
```

In `docs/doom-term/README.md`, delete the index line added in Task 5 and insert this line under "Use Doom Term", immediately before `- [Roadmap and release status](roadmap.md)`:

```markdown
- [Update channels](update-channels.md): update with Scoop on Windows or Homebrew on macOS; AppImage updates on Linux from the first release after v1.1.8
```

Commit and open the pull request with the changelog marker `CHANGELOG-IMPROVEMENT: Install and update Doom Term with Scoop on Windows and Homebrew on macOS.`, using the same body structure as Task 6 and the real-install result from Step 4 as its evidence.

---

### Task 9: Acceptance at the next real release

**Files:**
- None. The maintainer decides when a release is cut; this plan never tags one.

**Interfaces:**
- Consumes: everything above, merged.
- Produces: evidence that the AppImage and the update path work on a real release.

- [ ] **Step 1: After the first release made with the new pipeline, check the assets**

```bash
TAG=v1.1.9   # the release the maintainer cut
gh release view "$TAG" --repo CMLeadmon/Doom-Term --json assets --jq '.assets[].name' | grep -c -E '^DoomTerm-x86_64\.AppImage(\.zsync)?$'
gh release download "$TAG" --repo CMLeadmon/Doom-Term -p SHA256SUMS.txt -O - | grep -E 'AppImage'
```

Expected: `2`, then two checksum lines, one for the AppImage and one for its `.zsync`.

- [ ] **Step 2: Check the channels run**

Open the `Doom Term Channels` run that started when the release workflow finished. Expected: `Resolve release`, `Render channel manifests`, `Verify Linux AppImage`, `Verify Windows (Scoop)` and `Verify macOS (Homebrew)` succeeded, and `Promote to the channels` is waiting for approval. In `Verify Linux AppImage`, the step `Update the previous release's AppImage to this one` shows the `::notice::No earlier release has an AppImage` message on this first AppImage release. Approve, then confirm both channel repositories moved to the new version (Task 8, Step 3).

- [ ] **Step 3: After the second AppImage release, confirm the update path ran for real**

In that release's `Verify Linux AppImage` job, the update step must not print the notice. It must download the previous release's AppImage, run `appimageupdatetool` against this release's `.zsync` URL, and finish with the new version. Check the log for `Update successful` and a version line equal to the new tag. This is the first time the real update path runs against GitHub-hosted files, so a failure here is a defect to fix in the pipeline, not a reason to skip the check.

- [ ] **Step 4: Update the notes template**

The "Install and update manually" paragraph in each release's notes should now name the channels. In the notes for that release, replace it with: "Update with `scoop update doomterm` (Windows), `brew upgrade --cask doomterm` (macOS) or `appimageupdatetool -O DoomTerm-x86_64.AppImage` (Linux). The tarball, installer and DMG remain available; verify them against `SHA256SUMS.txt`. Release builds are unsigned." Keep the existing sentence about unsigned builds and Gatekeeper and SmartScreen warnings.

---

## Appendix A: What was measured before this plan was written (2026-10-05)

These are the facts the design rests on. Each was observed on the day, from `origin/main` at `af788ad39` and release v1.1.8, not recalled.

| Fact | How it was observed |
| --- | --- |
| The macOS zip holds `osx/DoomTerm.app/Contents/MacOS/doomterm`, so the cask says `app "osx/DoomTerm.app"` | `unzip -l doomterm-macos-arm64.zip` on the published asset |
| The Windows zip has `doomterm.exe` and its DLLs at the root, so Scoop's `bin` is `doomterm.exe` | `unzip -l doomterm-windows-x64.zip` on the published asset |
| Both zips match the published `SHA256SUMS.txt` | `sha256sum -c SHA256SUMS.txt --ignore-missing` |
| `script/linux/bundle --channel doomterm --skip-build --packages appimage` builds an AppImage with only environment variables set | run in `doomterm-build:ubuntu24.04` against the v1.1.6 binary: 94 MB AppImage and a 335 KB `.zsync` in about 6 seconds |
| `LDAI_OUTPUT` is required. Without it the build produced `Doom_Term-x86_64.AppImage`, named from the desktop file's `Name=Doom Term`, with a `.zsync` describing that name, while the script still announced success at `DoomTerm-x86_64.AppImage`, a file that did not exist. With it set the files are `DoomTerm-x86_64.AppImage` and `DoomTerm-x86_64.AppImage.zsync` | the same build run with and without the variable |
| `zsyncmake` is bundled, so CI needs no apt package for it | the container has no `zsyncmake` and the build still generated the `.zsync` file |
| The AppImage runtime (the first 944,632 bytes of every AppImage) is downloaded at build time from the rolling `continuous` release unless `LDAI_RUNTIME_FILE` is set. With the dated `20251108` runtime handed over through `LDAI_RUNTIME_FILE`, the build log has no download line and the AppImage head differs from the pinned runtime in 91 bytes, all inside the `.digest_md5` and `.upd_info` fields; the rolling runtime differs from it in 467,271 bytes | the build log before and after, `cmp -l` of the runtime against the AppImage head, `readelf -SW` for the field offsets |
| The embedded update address is readable with `readelf -p .upd_info`; `--appimage-updateinformation` is forwarded to the app, and rejected, when `APPIMAGE_EXTRACT_AND_RUN=1` is set | both tried on a fresh build |
| The AppImage runs headless (`Doom Term 1.1.6`) and passes `drag-smoke` (1 window before, 2 after) under Xvfb | run against the AppImage in `doomterm-verify:ubuntu24.04` |
| `appimageupdatetool -O -u zsync\|<url> <old AppImage>` updated v1.1.5 to v1.1.6, with a matching checksum and a byte-identical result; it reused about 52 MB and fetched about 60 MB of a 94 MB file; the old file was kept as `.zs-old`; it warns "AppImage not signed" | run over a local range-capable HTTP server; the GitHub URL form was not exercised |
| No libraries are bundled (`usr/lib` inside the AppImage is empty), so it relies on the host's libraries like the tarball | `--appimage-extract` and `ls` |
| The AppImage's internal install path is `/opt/warpdotdev/warp-terminaldoomterm/` and its `THIRD_PARTY_LICENSES.txt` is the static fallback headed "Doom Term v1.0.0" | `--appimage-extract` and `head` |
| Scoop's own JSON schema accepts the rendered manifest and rejects a bad one; Ruby parses the cask; the tests pass on Python 3.11 | schema validation with a negative control, `ruby -c`, a `python:3.11-slim` container |
| `actionlint` reports one finding, `SC2035` in the publish job, on both the original and the patched workflow | run on both files |
| The `promote` step's shell refuses an older version and handles empty channel repositories | `promote_sim.sh`, 5 checks |
| The `resolve` step handles all three event types and rejects `v1.2.0-rc1`, `latest` and a tag with no release | run against the real v1.1.8 release |
| Homebrew's main cask repository announced it would disable casks failing Gatekeeper checks from 2026-09-01, and said third-party taps are unaffected | Homebrew discussion 6334 |
| Environments with required reviewers are available on public repositories on every plan; scheduled workflows are disabled after 60 days without repository activity in a public repository | GitHub documentation |

Not measured, and left to the dry run in Task 6 and the acceptance in Tasks 8 and 9: Scoop's behavior with a local bucket on a runner, whether the Windows binary prints `--version` to a redirected stream, Homebrew's and Gatekeeper's behavior for the unsigned app on a runner, the `gh-releases-zsync` address resolving against real GitHub releases, and the update step's positive path.

## Appendix B: Left out on purpose

- **winget.** Needs a manual first submission and a silent-install check; the installer's `[Run]` entry has no `skipifsilent`, so a silent install may launch the app. A later plan.
- **Scoop `checkver` and `autoupdate` fields.** The release workflow pushes manifests, so they would only add fields to validate. Add them if a bucket bot is ever wanted.
- **Homebrew `zap` stanza.** The app's data locations on macOS were not verified.
- **AppImage signing.** `LDAI_SIGN=1` with a GPG key would silence the updater's "not signed" warning; it needs key custody.
- **Renaming the AppImage's internal path** from `warp-terminaldoomterm`. It needs a one-line edit to a shared upstream script and a ledger row.
- **A per-build third-party license list** in the AppImage. It needs `cargo-about` in CI.
- **Draft, verify, then publish, with immutable releases.** The channels workflow reads a published release and works with or without that change. Immutable releases would end attaching theme packs after publishing.
