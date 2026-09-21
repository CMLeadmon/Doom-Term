#!/usr/bin/env python3
"""Measure how far the hosted modules reach into the rest of the application.

T4.1 needs a resolved caller inventory before the compile boundary can be
drawn: for each module that Doom Term excludes, which files outside it depend
on it, and how much of that is code Doom Term is keeping.

This is a *reference* inventory, produced by reading source. It is an upper
bound on the work and a map of where it lands — it is not the compiler's
answer. The authoritative list is whatever `cargo check` reports once the
module roots are actually gated, and that list can only be produced by
building. Treat this as the thing that tells you where to look.

Usage:
    python3 script/doomterm/caller-inventory.py [--json] [--module NAME]

Exit status is always 0: this reports, it does not gate.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
APP_SRC = REPO_ROOT / "app" / "src"

# Modules the Doom Term build intends to exclude, with why. Keep in step with
# docs/doom-term/feature-inventory.md.
EXCLUDED_MODULES = {
    "ai": "Hosted AI, agent mode, MCP integration and remote indexing.",
    "server": "Warp server clients, GraphQL, telemetry collection and Drive.",
    "auth": "Account, login, credential refresh and team management.",
    "onboarding": "Account-first onboarding flow.",
    "local_control": "Control sidecar; not shipped in v1.",
    "remote_server": "Warp remote-server provisioning and session relay.",
    "autoupdate": "Warp-server autoupdate and remote changelog.",
    "crash_reporting": "Sentry and crash uploading.",
}

# Directories whose contents Doom Term keeps. A reference from one of these into
# an excluded module is the expensive kind: it cannot simply be deleted, it has
# to be classified as local logic to retain, hosted logic to exclude, or a
# shared type to extract.
RETAINED_AREAS = [
    "terminal",
    "workspace",
    "workspaces",
    "pane_group",
    "settings",
    "settings_view",
    "workflows",
    "themes",
    "command_palette",
    "search",
    "persistence",
    "ui_components",
    "view_components",
]


def module_reference_pattern(module: str) -> re.Pattern[str]:
    """Matches both in-crate module references and workspace-crate references.

    Several of these names exist twice: `crate::local_control` is an app module
    and `local_control` is also a workspace crate, and excluding one does not
    exclude the other. An earlier version of this script matched only the module
    form and reported `onboarding` as having no callers at all, when in fact
    `root_view.rs` and `lib.rs` use the crate directly. Counting only one form
    understates the work and, worse, makes something look free when it is not.
    """
    return re.compile(
        rf"\bcrate::{module}::"
        rf"|\buse crate::{module}\b"
        rf"|\bsuper::{module}::"
        rf"|(?<![:\w]){module}::"
        rf"|\buse {module}\b"
    )


def rust_files() -> list[pathlib.Path]:
    return sorted(APP_SRC.rglob("*.rs"))


def analyse(module: str, files: list[pathlib.Path]) -> dict:
    pattern = module_reference_pattern(module)
    own_prefix = APP_SRC / module

    inside = 0
    outside: list[str] = []
    for path in files:
        try:
            text = path.read_text(errors="replace")
        except OSError:
            continue
        if not pattern.search(text):
            continue
        if path.is_relative_to(own_prefix):
            inside += 1
        else:
            outside.append(str(path.relative_to(REPO_ROOT)))

    own_files = list(own_prefix.rglob("*.rs")) if own_prefix.is_dir() else []
    own_lines = 0
    for path in own_files:
        try:
            own_lines += len(path.read_text(errors="replace").splitlines())
        except OSError:
            pass

    by_area: dict[str, int] = {}
    for rel in outside:
        parts = pathlib.PurePath(rel).parts
        area = parts[2] if len(parts) > 3 else "(top level)"
        by_area[area] = by_area.get(area, 0) + 1

    retained_hits = sum(count for area, count in by_area.items() if area in RETAINED_AREAS)

    return {
        "module": module,
        "reason_excluded": EXCLUDED_MODULES[module],
        "own_files": len(own_files),
        "own_lines": own_lines,
        "referencing_files_inside": inside,
        "referencing_files_outside": len(outside),
        "referencing_files_in_retained_areas": retained_hits,
        "by_area": dict(sorted(by_area.items(), key=lambda kv: -kv[1])),
        "outside_files": outside,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Emit the full report as JSON.")
    parser.add_argument("--module", help="Report on a single module.")
    args = parser.parse_args()

    files = rust_files()
    modules = [args.module] if args.module else list(EXCLUDED_MODULES)
    for module in modules:
        if module not in EXCLUDED_MODULES:
            print(f"error: {module} is not a declared excluded module", file=sys.stderr)
            return 1

    reports = [analyse(module, files) for module in modules]

    if args.json:
        print(json.dumps({"modules": reports}, indent=2))
        return 0

    head = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        cwd=REPO_ROOT, capture_output=True, text=True, check=False,
    ).stdout.strip()
    print(f"Doom Term caller inventory at {head}")
    print(f"{len(files)} Rust files under app/src\n")

    print(f"{'module':<18}{'own files':>10}{'own lines':>11}{'callers':>9}{'retained':>10}")
    print("-" * 58)
    for report in reports:
        print(
            f"{report['module']:<18}"
            f"{report['own_files']:>10}"
            f"{report['own_lines']:>11}"
            f"{report['referencing_files_outside']:>9}"
            f"{report['referencing_files_in_retained_areas']:>10}"
        )
    print()
    print("callers  = files outside the module that reference it")
    print("retained = how many of those sit in areas Doom Term keeps")
    print()

    for report in reports:
        if not report["by_area"]:
            continue
        top = list(report["by_area"].items())[:8]
        rendered = ", ".join(f"{area} {count}" for area, count in top)
        print(f"{report['module']}: {rendered}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
