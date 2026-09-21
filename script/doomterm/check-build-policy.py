#!/usr/bin/env python3
"""Assert what is and is not in the Doom Term dependency graph.

This is the gate that substantiates "removed". A module being `cfg`'d out is
not removal: the crate can still link into the binary, and only the resolved
dependency graph shows the difference. `local_control` was exactly that case —
excluded from compilation by a `cfg`, and still in the graph, because
`warp_terminal` depends on `warp_cli` which depended on it unconditionally.

Run per target, against the real Doom Term feature set, with no test or
workspace feature unification: those union features across the workspace and
will happily show a clean graph that the shipped binary does not have.

Scope: this proves a crate is not linked. It does not prove that no prohibited
*string* or symbol survives, which is T4.3's separate scan, and it says nothing
about runtime behaviour, which is the observed-network test.

Usage:
    python3 script/doomterm/check-build-policy.py [--target TRIPLE] [--json]
                                                  [--allow-expected-failures]

Exit status is 0 when the graph matches policy and 1 when it does not.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]

DOOMTERM_FEATURES = "doomterm,gui"

# Crates that must not be linked into a Doom Term build, with the reason each
# is prohibited. The reason is not decoration: when one of these reappears,
# whoever sees the failure needs to know whether it is a real regression or a
# policy question.
PROHIBITED = {
    "ai": "Hosted AI and agent mode.",
    "warp_server_client": "Warp server API client.",
    "warp_server_auth": "Account authentication and credential refresh.",
    "warp_graphql": "GraphQL transport to Warp's servers.",
    "warp_multi_agent_client": "Hosted multi-agent endpoint client.",
    "cloud_object_client": "Warp Drive object transport.",
    "cloud_object_persistence": "Drive object persistence.",
    "firebase": "Firebase authentication.",
    "onboarding": "Account-first onboarding flow.",
    "local_control": "Control sidecar; not shipped in v1.",
    "remote_server": "Warp remote-server provisioning.",
    "mcp": "Hosted MCP integration.",
    "sentry": "Crash reporting SDK.",
    "sentry-log": "Crash reporting log bridge.",
    "minidumper": "Crash minidump transport.",
    "crash-handler": "Crash handler.",
    "voice_input": "Microphone capture and remote transcription.",
    "opentelemetry-otlp": "Off-device trace exporter.",
    "opentelemetry-proto": "Off-device trace encoding.",
}

# Crates that are retained deliberately, with the reason. An entry here is a
# claim that the crate carries no transport or credential behaviour in this
# build; it has to be justified per crate, never by substring.
ALLOWED_WITH_REASON = {
    "ai_types": (
        "Serialized types only. `persistence` stores them, so excluding them would force a "
        "database migration for no privacy gain. Audited: no transport or credential behaviour."
    ),
}

# Crates known to still be present, which this gate is intended to remove. Each
# entry is a promise, not an exemption: `--allow-expected-failures` lets CI run
# the gate before M2 finishes without the result being reported as a pass.
EXPECTED_FAILURES_TASK = "T4.1/T4.2"


PROHIBITED_FEATURES = {"asset_cache": {"remote-fetch"}}
REQUIRED_FEATURES = {"warpui_core": {"local_only"}}


def missing_required_features(graph: dict[str, set[str]]) -> list[str]:
    return sorted(
        f"{package}/{feature}"
        for package, features in REQUIRED_FEATURES.items()
        for feature in features - graph.get(package, set())
    )


def prohibited_features(graph: dict[str, set[str]]) -> list[str]:
    return sorted(
        f"{package}/{feature}"
        for package, features in PROHIBITED_FEATURES.items()
        for feature in features & graph.get(package, set())
    )


def parse_tree(output: str) -> dict[str, set[str]]:
    graph: dict[str, set[str]] = {}
    for line in output.splitlines():
        if not line.strip():
            continue
        package, separator, rest = line.partition("|")
        if not separator or "|" not in rest or not package.split():
            raise ValueError("Unrecognized cargo tree output; refusing to report a clean graph")
        features = rest.split("|", 1)[0]
        graph.setdefault(package.split()[0], set()).update(filter(None, features.split(",")))
    if not graph:
        raise ValueError("Empty cargo tree output; refusing to report a clean graph")
    return graph


def cargo_tree(features: str | None, target: str) -> dict[str, set[str]]:
    args = [
        "cargo", "tree", "--locked", "--color", "never", "-p", "warp",
        "--target", target,
        "--edges", "normal",
        "--prefix", "none",
        "--format", "{p}|{f}|",
    ]
    if features is not None:
        args += ["--no-default-features", "--features", features]
    result = subprocess.run(args, cwd=REPO_ROOT, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        print(result.stderr[-2000:], file=sys.stderr)
        raise SystemExit("cargo tree failed")
    return parse_tree(result.stdout)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", default="x86_64-unknown-linux-gnu")
    parser.add_argument("--json", action="store_true")
    parser.add_argument(
        "--allow-expected-failures",
        action="store_true",
        help=(
            "Report crates still present as outstanding work rather than failures. "
            "For running the gate during M2, before the boundary is finished. "
            "A release build must never use this."
        ),
    )
    args = parser.parse_args()

    graph = cargo_tree(DOOMTERM_FEATURES, args.target)
    upstream = cargo_tree(None, args.target)

    forbidden_features = prohibited_features(graph)
    missing_features = missing_required_features(graph)
    present = sorted(name for name in PROHIBITED if name in graph)
    absent = sorted(name for name in PROHIBITED if name not in graph)

    # Several prohibited crates are optional upstream features that the default
    # upstream build does not select either — sentry, voice_input and the crash
    # handlers among them. Their absence from the upstream graph is normal, not
    # a sign the fork broke upstream, and an earlier version of this gate
    # reported exactly that false positive.
    #
    # Upstream health is verified by building it, not by inspecting this graph:
    # `cargo check --workspace --all-targets` on the upstream feature set is the
    # check that catches a fork edit damaging a shared seam. What this gate can
    # usefully say is which prohibited crates upstream does link, so that
    # excluding one here is visibly a fork decision rather than an accident of
    # upstream's own defaults.
    upstream_linked = sorted(name for name in PROHIBITED if name in upstream)
    never_upstream = sorted(
        name for name in PROHIBITED if name not in upstream and name not in graph
    )

    report = {
        "target": args.target,
        "features": DOOMTERM_FEATURES,
        "doomterm_graph_size": len(graph),
        "upstream_graph_size": len(upstream),
        "prohibited_absent": absent,
        "prohibited_present": present,
        "prohibited_linked_by_upstream": upstream_linked,
        "prohibited_absent_from_both": never_upstream,
        "allowed_with_reason": {
            name: reason for name, reason in ALLOWED_WITH_REASON.items() if name in graph
        },
        "prohibited_features_present": forbidden_features,
        "required_features_missing": missing_features,
        "ok": not present and not forbidden_features and not missing_features,
    }

    if args.json:
        print(json.dumps(report, indent=2))
        return 0 if report["ok"] or args.allow_expected_failures else 1

    print(f"Doom Term build policy — {args.target}")
    print(f"  features: --no-default-features --features {DOOMTERM_FEATURES}")
    print(f"  graph: {len(graph)} crates (upstream: {len(upstream)})")
    print()

    if absent:
        print(f"Not in the Doom Term graph ({len(absent)}/{len(PROHIBITED)}):")
        for name in absent:
            if name in never_upstream:
                print(f"  ok    {name}  (optional upstream too; keep it unselected)")
            else:
                print(f"  ok    {name}  (excluded by this fork)")
    if report["allowed_with_reason"]:
        print("\nRetained deliberately:")
        for name, reason in report["allowed_with_reason"].items():
            print(f"  note  {name}: {reason}")
    if present:
        print(f"\nStill linked ({len(present)}/{len(PROHIBITED)}):")
        for name in present:
            print(f"  {'todo' if args.allow_expected_failures else 'FAIL'}  "
                  f"{name}: {PROHIBITED[name]}")
    for feature in forbidden_features:
        print(f"  FAIL  feature {feature}")
    for feature in missing_features:
        print(f"  FAIL  required feature missing: {feature}")
    print()
    if report["ok"]:
        print("Graph matches policy.")
        return 0
    if args.allow_expected_failures:
        print(
            f"{len(present)} crate(s) still linked; outstanding work for {EXPECTED_FAILURES_TASK}.\n"
            "Reported as outstanding because --allow-expected-failures was passed. This is not a "
            "pass, and a release build must not use that flag."
        )
        return 0
    print(f"{len(present) + len(forbidden_features) + len(missing_features)} policy violation(s).")
    return 1


if __name__ == "__main__":
    sys.exit(main())
