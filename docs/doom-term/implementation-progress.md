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
  Eight build-policy regression tests passed. Application Clippy passed with
  `-D warnings`; upstream comparison and all five feature-policy checks passed.

## Telemetry boundary checkpoint

- Doom Term selects `warpui_core/local_only`: the event store and app-focus tracker
  are absent from that module tree. App collectors, identity-context registration,
  Rudder sender/disk queue, telemetry regex updates and direct agent-tip analytics
  requests are compile-excluded. Terminal secret masking is retained.
- Four local macro tests prove that event, identity, context and executor arguments
  are not evaluated. Five upstream queue/focus tests still pass. The channel/core
  suite passes ten focused tests, including the fresh-process channel check.
- Doom Term application Clippy and both core crates’ test-target Clippy pass with
  `-D warnings`; the upstream application check also passes. Compiler dependency
  records confirm the excluded telemetry modules are absent; see
  [source-selection evidence](evidence/m2-boundary/telemetry-source-selection.json).
- All three target dependency graphs require the local-only telemetry feature.
  They still report eleven prohibited service packages and `ok: false`.

## Updater boundary checkpoint

The local build excludes the updater module, polling, download/relaunch paths, update
controls, and version/time server endpoints. Changelog requests load bundled development
notes; settings describe manual installation. Doom Term Clippy, the upstream app check,
a full Linux debug build, and local app/test compilation pass. Source-selection evidence is recorded in
[the updater report](evidence/m2-boundary/updater-source-selection.json).

The real GUI renders under Ubuntu 24.04/Xvfb with Vulkan llvmpipe and shuts down cleanly.
It still opens the upstream sign-in screen; skipping login attempts anonymous account
creation and fails. This blocks terminal/settings acceptance until T4 account startup
is removed. The trace also records the installation-detection loopback listener.
`script/doomterm/gui-smoke` now exercises the built binary with an isolated home and
requires a real shell command, so a rendered login window cannot count as a functional
terminal. No binary is ready for release.

## Remaining release gates

M2 is incomplete. Service startup, hosted dependencies and packaged telemetry/network-observed
acceptance still need implementation and verification. M1 shell/profile acceptance also
needs independent verification. Materials, status plate, branding, fork CI, packages,
three-platform acceptance and publication follow the implementation plan. No release
or privacy guarantee is established by the checks above.

Detailed command output lives in `.git/doomterm-evidence/`; execution rulings and
continuation state live in `.superpowers/sdd/implementation-plan/progress.md`.
