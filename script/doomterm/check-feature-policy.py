#!/usr/bin/env python3
"""Check the Doom Term Cargo feature policy.

Verifies the parts of the product boundary that live in Cargo's feature
resolution, by asking Cargo rather than by reading the manifest:

  * `doomterm` and `warp_services` cannot be enabled together
  * the Doom Term binary requires the `doomterm` feature
  * every upstream channel binary requires `warp_services`, so a local-only
    feature set cannot build one
  * `gui` does not imply `voice_input`
  * the Doom Term feature set resolves without `warp_services`

Scope, stated plainly: this checks feature *resolution*. It says nothing about
what ends up in the compiled binary. The dependency-graph and symbol audit that
substantiates "hosted services are not in this build" is T4.3's
`check-build-policy.py`, which does not exist yet. Do not read a pass here as
evidence of removal.

Usage:
    python3 script/doomterm/check-feature-policy.py [--cargo CMD]

Exit status is 0 when every check passes and 1 otherwise.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]

DOOMTERM_BIN = "doomterm"
UPSTREAM_BINS = ["warp-oss", "warp", "integration", "stable", "dev", "preview"]


class Checker:
    def __init__(self, cargo: list[str]) -> None:
        self.cargo = cargo
        self.failures: list[str] = []
        self.passes: list[str] = []

    def run(self, args: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [*self.cargo, *args],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

    def ok(self, name: str) -> None:
        self.passes.append(name)
        print(f"  ok    {name}")

    def fail(self, name: str, detail: str) -> None:
        self.failures.append(f"{name}: {detail}")
        print(f"  FAIL  {name}")
        print(f"        {detail}")

    # -- checks ---------------------------------------------------------------

    def check_features_are_mutually_exclusive(self) -> None:
        name = "doomterm and warp_services are mutually exclusive"
        result = self.run([
            "check", "--locked", "-p", "warp", "--lib",
            "--no-default-features", "--features", "doomterm,warp_services",
        ])
        if result.returncode == 0:
            self.fail(
                name,
                "the combination compiled. A build can then contain the hosted service "
                "implementations while claiming to be local-only, and nothing would catch it.",
            )
            return
        combined = result.stdout + result.stderr
        if "mutually exclusive" not in combined:
            self.fail(
                name,
                "the build failed, but not with the mutual-exclusion compile_error. It may be "
                f"failing for an unrelated reason:\n{combined[-800:]}",
            )
            return
        self.ok(name)

    def check_doomterm_binary_requires_its_feature(self) -> None:
        name = f"the {DOOMTERM_BIN} binary requires the doomterm feature"
        meta = self.metadata()
        target = self.find_binary(meta, DOOMTERM_BIN)
        if target is None:
            self.fail(name, f"no binary target named {DOOMTERM_BIN} exists")
            return
        required = set(target.get("required-features", []))
        if "doomterm" not in required:
            self.fail(
                name,
                f"required-features is {sorted(required)}. Without `doomterm`, a default build "
                "would produce a binary named doomterm that is configured as an upstream channel.",
            )
            return
        self.ok(name)

    def check_upstream_binaries_require_warp_services(self) -> None:
        name = "upstream channel binaries require warp_services"
        meta = self.metadata()
        missing = []
        for bin_name in UPSTREAM_BINS:
            target = self.find_binary(meta, bin_name)
            if target is None:
                missing.append(f"{bin_name} (no such target)")
                continue
            if "warp_services" not in set(target.get("required-features", [])):
                missing.append(bin_name)
        if missing:
            self.fail(
                name,
                f"these do not require warp_services: {', '.join(missing)}. A --features doomterm "
                "build would still build them, and 'this product has no hosted services' would "
                "depend on nobody running the other binary in the same package.",
            )
            return
        self.ok(name)

    def check_gui_does_not_imply_voice_input(self) -> None:
        name = "gui does not imply voice_input"
        meta = self.metadata()
        package = self.warp_package(meta)
        if package is None:
            self.fail(name, "could not find the `warp` package in cargo metadata")
            return
        gui = package["features"].get("gui")
        if gui is None:
            self.fail(name, "the `gui` feature does not exist")
            return
        if "voice_input" in gui:
            self.fail(
                name,
                "`gui` still enables `voice_input`, so any graphical build compiles in microphone "
                "capability. Doom Term ships no voice input.",
            )
            return
        self.ok(name)

    def check_doomterm_feature_set_resolves(self) -> None:
        name = "the Doom Term feature set resolves with no default features"
        result = self.run([
            "metadata", "--format-version", "1", "--no-deps",
            "--filter-platform", "x86_64-unknown-linux-gnu",
        ])
        if result.returncode != 0:
            self.fail(name, f"cargo metadata failed: {result.stderr[-500:]}")
            return
        result = self.run([
            "check", "--locked", "-p", "warp", "--bin", DOOMTERM_BIN,
            "--no-default-features", "--features", "doomterm,gui",
            "--message-format", "short",
        ])
        if result.returncode != 0:
            self.fail(
                name,
                f"the documented build contract does not compile:\n"
                f"{(result.stdout + result.stderr)[-1500:]}",
            )
            return
        self.ok(name)

    # -- helpers --------------------------------------------------------------

    _meta_cache: dict | None = None

    def metadata(self) -> dict:
        if self._meta_cache is None:
            result = self.run(["metadata", "--format-version", "1", "--no-deps"])
            result.check_returncode()
            self._meta_cache = json.loads(result.stdout)
        return self._meta_cache

    @staticmethod
    def warp_package(meta: dict) -> dict | None:
        return next((p for p in meta["packages"] if p["name"] == "warp"), None)

    def find_binary(self, meta: dict, name: str) -> dict | None:
        package = self.warp_package(meta)
        if package is None:
            return None
        return next(
            (t for t in package["targets"] if t["name"] == name and "bin" in t["kind"]),
            None,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cargo",
        default="cargo",
        help="Cargo command to invoke. Useful for running inside the build container.",
    )
    args = parser.parse_args()

    print("Doom Term feature policy")
    checker = Checker(args.cargo.split())
    checker.check_doomterm_binary_requires_its_feature()
    checker.check_upstream_binaries_require_warp_services()
    checker.check_gui_does_not_imply_voice_input()
    checker.check_features_are_mutually_exclusive()
    checker.check_doomterm_feature_set_resolves()

    print()
    if checker.failures:
        print(f"{len(checker.failures)} check(s) failed.")
        return 1
    print(f"All {len(checker.passes)} checks passed.")
    print(
        "Note: this covers feature resolution only. Evidence that hosted service code is "
        "absent from the built binary is T4.3's job."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
