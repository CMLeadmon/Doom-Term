#!/usr/bin/env python3
"""Check the Doom Term invasive-diff ledger against the real fork delta.

Compares every tracked path that differs from the recorded upstream merge base
with docs/doom-term/invasive-diff.json, and fails when the ledger and the tree
disagree.

What this catches:

  * a file shared with upstream was edited without a ledger row
  * a ledger row is still marked 'planned' although the file has been edited
  * a ledger row claims an edit that no longer exists in the tree (stale row)
  * a row with a blank reason, validation, owner or task
  * a glob or wildcard used where a physical path is required
  * a genuinely new fork path that falls outside every declared fork-owned area

What this deliberately does not do: it makes no judgement about whether an edit
was a good idea. That is what review is for. It only refuses to let a shared-file
edit go unrecorded.

Usage:
    python3 script/doomterm/check-inventory.py [--base <sha>] [--json]

Exit status is 0 when the ledger matches the tree and 1 when it does not.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
LEDGER_PATH = REPO_ROOT / "docs" / "doom-term" / "invasive-diff.json"

REQUIRED_ROW_KEYS = (
    "path",
    "kind",
    "owner",
    "task",
    "reason",
    "validation",
    "upstream_base",
    "status",
    "last_merge_review",
)
VALID_STATUSES = {"planned", "modified", "deleted", "renamed"}
VALID_KINDS = {"shared"}
GLOB_CHARS = set("*?[]")

# A reason has to say something. These are the lengths below which a row is
# treated as unjustified rather than briefly justified.
MIN_REASON_CHARS = 20
MIN_VALIDATION_CHARS = 10


def git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def path_exists_at(rev: str, path: str) -> bool:
    result = subprocess.run(
        ["git", "cat-file", "-e", f"{rev}:{path}"],
        cwd=REPO_ROOT,
        capture_output=True,
        check=False,
    )
    return result.returncode == 0


def changed_paths(base: str) -> dict[str, str]:
    """Tracked paths differing between `base` and the working tree.

    Returns {path: status letter}. Renames are reported as a deletion of the old
    path and an addition of the new one, because the ledger records one physical
    path per row and an upstream file that the fork renames still needs its row.
    """
    raw = git("diff", "-M", "--name-status", "-z", base)
    fields = raw.split("\0")
    out: dict[str, str] = {}
    i = 0
    while i < len(fields):
        code = fields[i]
        if not code:
            break
        letter = code[0]
        if letter in ("R", "C"):
            old, new = fields[i + 1], fields[i + 2]
            out[old] = "D" if letter == "R" else "M"
            out[new] = "A"
            i += 3
        else:
            out[fields[i + 1]] = letter
            i += 2
    return out


def validate_ledger(ledger: dict) -> list[str]:
    problems: list[str] = []
    owners = ledger.get("owners", {})
    seen: set[str] = set()

    for index, row in enumerate(ledger.get("rows", [])):
        label = row.get("path") or f"row {index}"

        missing = [k for k in REQUIRED_ROW_KEYS if k not in row]
        if missing:
            problems.append(f"{label}: missing required field(s): {', '.join(missing)}")
            continue

        path = row["path"]
        if path in seen:
            problems.append(f"{path}: duplicate row; one physical path per row")
        seen.add(path)

        if GLOB_CHARS & set(path):
            problems.append(
                f"{path}: wildcards are never an acceptable ledger entry; "
                "name each physical path"
            )
        if path.endswith("/"):
            problems.append(f"{path}: directory entries are not acceptable; name each file")

        if row["kind"] not in VALID_KINDS:
            problems.append(f"{path}: kind {row['kind']!r} is not one of {sorted(VALID_KINDS)}")
        if row["status"] not in VALID_STATUSES:
            problems.append(
                f"{path}: status {row['status']!r} is not one of {sorted(VALID_STATUSES)}"
            )
        if row["owner"] not in owners:
            problems.append(f"{path}: owner {row['owner']!r} is not declared in `owners`")
        if not str(row["task"]).strip():
            problems.append(f"{path}: task is blank")
        if len(str(row["reason"]).strip()) < MIN_REASON_CHARS:
            problems.append(
                f"{path}: reason is blank or too short to be a justification; "
                "say which invariant the edit implements"
            )
        if len(str(row["validation"]).strip()) < MIN_VALIDATION_CHARS:
            problems.append(
                f"{path}: validation is blank; name the test or audit that covers this edit"
            )
        if row["upstream_base"] != ledger["upstream_base"]:
            problems.append(
                f"{path}: upstream_base {row['upstream_base']!r} does not match the ledger "
                f"baseline {ledger['upstream_base']!r}"
            )

    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base",
        help="Upstream merge base to compare against. Defaults to the ledger's upstream_base.",
    )
    parser.add_argument("--json", action="store_true", help="Emit a machine-readable report.")
    args = parser.parse_args()

    if not LEDGER_PATH.exists():
        print(f"error: ledger not found at {LEDGER_PATH}", file=sys.stderr)
        return 1

    ledger = json.loads(LEDGER_PATH.read_text())
    base = args.base or ledger["upstream_base"]

    schema_problems = validate_ledger(ledger)

    try:
        git("cat-file", "-e", f"{base}^{{commit}}")
    except subprocess.CalledProcessError:
        print(
            f"error: upstream base {base} is not present in this clone.\n"
            "       Run `git fetch upstream` and try again.",
            file=sys.stderr,
        )
        return 1

    rows_by_path = {row["path"]: row for row in ledger["rows"] if "path" in row}
    areas = ledger.get("fork_owned_areas", [])
    changed = changed_paths(base)

    unlisted: list[str] = []
    still_planned: list[str] = []
    uncovered_new: list[str] = []
    new_by_area: dict[str, list[str]] = {}
    listed_shared: list[str] = []

    for path, letter in sorted(changed.items()):
        shared = path_exists_at(base, path)
        if shared:
            row = rows_by_path.get(path)
            if row is None:
                unlisted.append(path)
            elif row["status"] == "planned":
                still_planned.append(path)
            else:
                listed_shared.append(path)
        else:
            area = next((a for a in areas if path.startswith(a["prefix"])), None)
            if area is None:
                uncovered_new.append(path)
            else:
                new_by_area.setdefault(area["prefix"], []).append(path)

    stale: list[str] = []
    for path, row in rows_by_path.items():
        if row.get("status") in ("modified", "deleted", "renamed") and path not in changed:
            stale.append(path)

    report = {
        "base": base,
        "changed_tracked_paths": len(changed),
        "shared_recorded": sorted(listed_shared),
        "shared_unlisted": sorted(unlisted),
        "shared_still_marked_planned": sorted(still_planned),
        "stale_rows": sorted(stale),
        "new_paths_by_area": {k: sorted(v) for k, v in sorted(new_by_area.items())},
        "new_paths_uncovered": sorted(uncovered_new),
        "schema_problems": schema_problems,
    }
    failed = bool(
        unlisted or still_planned or stale or uncovered_new or schema_problems
    )
    report["ok"] = not failed

    if args.json:
        print(json.dumps(report, indent=2))
        return 1 if failed else 0

    print(f"Doom Term invasive-diff check against {base[:12]}")
    print(
        f"  {len(changed)} tracked path(s) differ from the upstream base: "
        f"{len(listed_shared) + len(unlisted) + len(still_planned)} shared with upstream, "
        f"{sum(len(v) for v in new_by_area.values()) + len(uncovered_new)} fork-owned."
    )

    planned_rows = sum(1 for r in ledger["rows"] if r.get("status") == "planned")
    print(f"  ledger: {len(ledger['rows'])} row(s), {planned_rows} still planned.")

    for prefix, paths in sorted(new_by_area.items()):
        print(f"  fork-owned area {prefix}: {len(paths)} path(s)")

    if not failed:
        print("OK: the ledger matches the tree.")
        return 0

    print()
    if schema_problems:
        print("Ledger rows that are not usable as a justification:")
        for problem in schema_problems:
            print(f"  - {problem}")
    if unlisted:
        print("Files shared with upstream were changed without a ledger row:")
        for path in sorted(unlisted):
            print(f"  - {path}")
        print(
            "  Add a row to docs/doom-term/invasive-diff.json naming the invariant this\n"
            "  edit implements and why an additive fork-owned module cannot do it alone."
        )
    if still_planned:
        print("Ledger rows still marked 'planned' although the file has been changed:")
        for path in sorted(still_planned):
            print(f"  - {path}")
        print("  Set status to 'modified' and update reason/validation to what you actually did.")
    if stale:
        print("Ledger rows claim an edit that is not in the tree:")
        for path in sorted(stale):
            print(f"  - {path}")
        print("  Either restore the edit or remove the row.")
    if uncovered_new:
        print("New fork paths outside every declared fork-owned area:")
        for path in sorted(uncovered_new):
            print(f"  - {path}")
        print("  Add the path's area to `fork_owned_areas`, or move the file into an existing one.")

    return 1


if __name__ == "__main__":
    sys.exit(main())
