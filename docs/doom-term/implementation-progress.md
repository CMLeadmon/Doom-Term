# Implementation progress

Current branch: `implementation/doomterm-m2`. Resumed from `e7c864a61` on
2026-09-20 with inherited uncommitted control-sidecar exclusion and inventory scripts.

## Verified in this session

- Linux Doom Term `cargo check --locked -p warp --bin doomterm --no-default-features
  --features doomterm,gui` passed in the existing Ubuntu 24.04 build container.
- Production normal dependency graph excludes `local_control` after the inherited
  app/CLI feature boundary. The OTLP exporter and protocol packages are also excluded. Eleven prohibited
  packages remain on Linux, macOS and Windows target graphs. These are dependency
  checks, not native macOS/Windows execution.
- Caller inventory now includes external-crate references; previous zero-caller
  onboarding claims were incorrect and are corrected in `feature-inventory.md`.

## In progress

- T4.1: dependency/caller closure. The current candidate passed an upstream
  `cargo check --locked -p warp --bin warp-oss` comparison.
- T4.2: compile exclusion of asset-cache HTTP transport; local and inline assets retained.
- Installed nextest in the persistent build-container Cargo home. The asset-cache
  suite passed 9 local-only tests and 6 upstream tests; Clippy passed both modes.
  Five build-policy regression tests passed. Application Clippy passed with
  `-D warnings`; upstream comparison and all five feature-policy checks passed.

## Remaining release gates

M2 is incomplete. Service startup, hosted dependencies, telemetry and network-observed
acceptance still need implementation and verification. M1 shell/profile acceptance also
needs independent verification. Materials, status plate, branding, fork CI, packages,
three-platform acceptance and publication follow the implementation plan. No release
or privacy guarantee is established by the checks above.

Detailed command output lives in `.git/doomterm-evidence/`; execution rulings and
continuation state live in `.superpowers/sdd/implementation-plan/progress.md`.
