# Doom Term Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for implementation, or
> `superpowers:subagent-driven-development` if the maintainer selects delegated execution.
> Execute the checkboxes task by task. This document authorizes no product implementation.

**Goal:** Publish a local-only, independently branded desktop terminal for Linux, macOS,
and Windows, retaining Warp's terminal core and ergonomic modern dark chrome while adding
an honest, locally sourced status plate as an analog cyberpunk telemetry HUD.

**Architecture:** Add a first-class `doomterm` channel and isolate fork policy, assets,
and plate code behind that seam. Use a separate Cargo build configuration to
exclude hosted services; runtime feature flags alone cannot meet the removal requirement.
Keep upstream implementations in the source tree where possible, outside the shipped build.

**Tech stack:** Rust 1.92.0, WarpUI/WGPU, the existing PTY and persistence layers,
`warp_harness_usage`, platform bundle tools, and GitHub Actions/Releases.

**Spec:** [handoff-implementation-plan.md](handoff-implementation-plan.md).
**Evidence baseline:** `caebaa5ec`, based on upstream `a0f5eb31a`; inspected 2026-09-20.
**Status:** In active execution. M0, M1, M2, and M3 completed; M4 retired by design decision;
M5 (Status Plate integration) in progress; M6 and M7 queued.

### Global constraints

- Track upstream; preserve reviewable seams and a file-level invasive-diff inventory.
- Remove account, Drive sync, Oz, hosted AI, telemetry collection/export, Sentry, and
  Warp-server autoupdate from the shipped product.
- Ship all three desktop operating systems in v1.
- Retain Warp's modern dark chrome and dock the honest status plate. M4 (Four Materials reskin)
  is formally retired to protect developer ergonomics and prevent upstream merge debt.
  No archived application subsystems, workspace picker, BYO-key agent implementation,
  web build, or local-control sidecar.
- No invented measurements. Unknown values display `--`; an observed zero is different.
- No game vocabulary in new identifiers, comments, UI copy, or implementation documentation.
  Preserve necessary legal notices and archived reference evidence without copying its vocabulary.
- Never copy nodeterm code or comments. Implement from this repository and independently
  documented data formats.
- Product identity must be independent before any public binary distribution.
- Keep terminal-native blocks, command palette, workflows, and themes unless the user changes
  that decision. Removing a cloud dependency is not permission to remove its local consumer.

### Review focus

| Condition | Required behavior | Owning acceptance tests |
| --- | --- | --- |
| Two agent sessions use the same directory | Never attribute one session's usage to the other | T7.2 association ambiguity and pane-switch tests |
| JSONL is truncated, rotated, denied, or changes schema | Preserve diagnostics; show unknown instead of a false zero or stale fact | T7.2 capture recovery tests |
| Upstream adds a default feature or a service constructor | Doom Term cannot acquire it silently | T3.1 allowlist, T4.3 dependency audit, T9 policy gate |
| Fractional DPI, narrow windows, long Unicode paths | Legible plate, correct clicks, no stolen terminal input | T6.1 and T7.1/T7.3 layout and native tests |
| Fresh installation beside Warp, then upgrade/uninstall | Independent identity and data; no login; preserve the user's terminal state | T3.2, T5, T10 installer acceptance |

## 1. Strategy and invasive-diff budget

### Decision: channel-shaped ownership, with a real compile boundary

Adopt the proposed channel approach, but reject the inference that a channel definition
alone removes the cloud. The existing binary wrapper is an excellent model for identity:
it sets `ChannelState` before entering `warp::run()`
([`app/src/bin/oss.rs:10`](../../app/src/bin/oss.rs#L10)). However, OSS still constructs
production server/Oz configuration at lines 16–17. `ChannelConfig` requires those values,
whereas telemetry and crash configuration are already optional
([`crates/warp_core/src/channel/config.rs:8`](../../crates/warp_core/src/channel/config.rs#L8)).

More significantly:

- Cargo defaults include `agent_mode`, shared sessions, AI rules, and analytics collection;
  they do not require a server to become enabled
  ([`app/Cargo.toml:501`](../../app/Cargo.toml#L501)). `enabled_features()` also unions
  Cargo-selected flags and release flags
  ([`app/src/features.rs:16`](../../app/src/features.rs#L16)).
- `RELEASE_FLAGS` includes autoupdate and crash reporting, so even this small list cannot
  be inherited without filtering
  ([`crates/warp_features/src/lib.rs:1090`](../../crates/warp_features/src/lib.rs#L1090)).
- Startup initializes persisted authentication, constructs `ServerApiProvider`, retrieves
  an AI client, and starts credential refresh
  ([`app/src/lib.rs:1509`](../../app/src/lib.rs#L1509),
  [`app/src/lib.rs:1534`](../../app/src/lib.rs#L1534),
  [`app/src/lib.rs:1562`](../../app/src/lib.rs#L1562)). The provider constructs real server
  and auth clients ([`app/src/server/server_api.rs:1471`](../../app/src/server/server_api.rs#L1471)).
- AI and server crates are ordinary dependencies, not optional ones
  ([`app/Cargo.toml:53`](../../app/Cargo.toml#L53),
  [`app/Cargo.toml:237`](../../app/Cargo.toml#L237)).

**Chosen design:** `Channel::DoomTerm` owns identity and product policy. A `doomterm` Cargo
feature selects the local application; a positive `warp_services` feature retains upstream
hosted implementations for upstream builds. Release builds use `--no-default-features` and
an explicit approved feature set. Never rely on dead-code elimination or invalid endpoint
URLs to establish removal. A local-only build may retain inert data types needed by terminal
storage, but cannot contain a hosted service client, exporter, or auth refresh implementation.

The alternatives are (a) runtime disabling only, which cannot substantiate binary removal,
or (b) deleting entire upstream subsystems, which needlessly destroys the merge base.
Compile-selecting modules and extracting the few shared local responsibilities costs more
than a channel wrapper, but preserves upstream source and makes the product boundary testable.

### What “removed” means

Use these labels in PRs and release evidence:

| Label | Evidence required | Sufficient for v1? |
| --- | --- | --- |
| Runtime disabled | Policy tests, no registrations/tasks/requests in exercised flows | Interim milestone only for prohibited services |
| Compile excluded | Source/module boundary plus target-specific production dependency graph excludes implementation | Required for hosted services, collection/export and crash SDKs |
| Type compatibility retained | Explicit list of types/macros, no service implementation or data collection | Allowed where local terminal/persistence needs it |
| Source retained | Upstream implementation remains in Git, outside Doom Term compilation | Preferred over deletion |

Symbol and string scans corroborate the graph/source audit; neither proves absence by itself.
Keep normal local error logging, with no remote sink and no user transcript content.

### T1 — Establish truth and the diff ledger

**Files:** first implementation commit changes `README.md`; creates
`docs/doom-term/invasive-diff.json`, `docs/doom-term/upstream-base.txt`, and
`script/doomterm/check-inventory.py`. The present plan remains one end-to-end plan;
these are operational records created during execution, not additional plans.

- [ ] Correct the README **in the first implementation commit**, not after the code catches
  up. Replace the completed claims at [`README.md:45`](../../README.md#L45) with “planned;
  current product code is upstream Warp.” Link milestones and clearly label available
  mockups. Do not advertise offline/privacy guarantees before T4 passes.
- [ ] Record the upstream baseline, fork SHA, dirty-tree state, and evidence commands.
  Read-only verification here found only `README.md` and `mockups/` in
  `git diff --stat a0f5eb31a HEAD`: 25 files, +4,649/−78; no `target/` directory.
  `git diff main design/doom-term-sidecar-mockup --stat` was empty.
- [ ] Create ledger rows with `path`, `reason`, `owner`, `task`, `validation`,
  `upstream_base`, `status`, and `last_merge_review`. One physical path per row.
- [ ] Make the checker compare changed tracked paths against the merge-base. Classify
  genuinely new paths separately; renames/deletions of upstream files require rows too.
  Fail on unlisted shared changes, stale removed rows, or blank justification/validation.
- [ ] Commit as `docs: establish Doom Term implementation baseline`.

**Budget rule:** prefer new fork-owned modules and narrow registration/policy seams. Every
shared edit must identify the invariant it implements and why an additive module cannot
do it alone. Do not scatter appearance edits across radius call sites. A change touching
more than ten new shared files, or introducing a second app-wide abstraction, requires an
explicit review of the ledger before merging. This is a review threshold, not an estimate
that cloud separation fits in ten files.

**Honesty about completeness:** the inventory below names the known planned shared edits.
The exact downstream compile-error set cannot be verified without building. T4.1 produces
the complete dependency/caller closure before that work is called done; each additional
file must be individually added to this ledger. A wildcard such as `app/src/**` is never
an acceptable ledger entry. Binary removal is on the critical path regardless of its size.

### Initial shared-file inventory

Numbers are evidence anchors at the inspected baseline, not intended edit ranges. Rows
marked “conditional” are inspected integration candidates; remove them from the ledger if
the implemented seam does not require changing them. New test files live next to their
owners using `_tests.rs`; modifications to existing tests are tracked too.

| Existing path and evidence | Planned edit and one-line justification | Task |
| --- | --- | --- |
| `README.md:45` | Replace premature product claims; later document tested installation | T1/T10 |
| `Cargo.toml:30` | Register fork-owned crate dependencies | T3/T7 |
| `Cargo.lock:1` | Record resolved changes without opportunistic dependency upgrades | T3/T4/T7 |
| `app/Cargo.toml:20` | Binary, feature boundaries, optional dependencies, package metadata | T3/T4/T5 |
| `app/build.rs:33` | Honor local-only build; independent Windows metadata and assets | T3/T5 |
| `app/src/lib.rs:3` | Conditional module/startup/action registration; no cloud singletons | T3/T4 |
| `app/src/features.rs:16` | Select a closed Doom Term runtime flag set | T3 |
| `crates/warp_core/Cargo.toml:11` | Propagate local-only product configuration | T3/T4 |
| `crates/warp_core/src/channel/mod.rs:10` | Add and exhaustively classify `DoomTerm` | T3 |
| `crates/warp_core/src/channel/config.rs:8` | Represent absence of hosted configuration explicitly | T3/T4 |
| `crates/warp_core/src/channel/state.rs:64` | Local configuration access and independent URL scheme | T3/T4 |
| `crates/warp_core/src/paths.rs:35` | Isolate settings, application data, and profile paths | T3 |
| `crates/warp_core/src/channel/state_tests.rs:1` | Verify new channel/config behavior | T3 |
| `crates/warp_core/src/paths_tests.rs:1` | Prove coexistence and path isolation | T3 |
| `app/src/root_view.rs:3996` | Local workspace startup and exclusion of auth/onboarding children | T4 |
| `app/src/root_view_tests.rs:1` | Fresh-profile and restored-profile local startup coverage | T4 |
| `app/src/server/mod.rs:16` | Separate compatibility/event types from hosted server modules | T4 |
| `app/src/server/server_api.rs:1463` | Conditional upstream service provider boundary | T4 |
| `app/src/server/telemetry/mod.rs:47` | Exclude collection/queue implementation | T4 |
| `app/src/server/telemetry/collector.rs:35` | Exclude persistence and flush tasks | T4 |
| `crates/warp_core/src/telemetry.rs:147` | Compile away emission expressions for the local build | T4 |
| `crates/warpui_core/Cargo.toml:19` | Local telemetry build feature propagation | T4 |
| `crates/warpui_core/src/telemetry/mod.rs:17` | Remove recording paths, including direct calls | T4 |
| `crates/asset_cache/Cargo.toml:19` | Make remote fetching optional while retaining local/inline assets | T4 |
| `crates/asset_cache/src/lib.rs:34` | Exclude URL fetching and return a local unsupported-source error | T4 |
| `app/src/tracing.rs:1` | Exclude hosted trace exporters and auth refresh integration | T4 |
| `app/src/settings/init.rs:1` | Initialize local settings without cloud synchronization | T4 |
| `app/src/settings_view/mod.rs:1` | Filter hosted settings pages and search entries | T4/T5 |
| `app/src/command_palette.rs:1` | Remove hosted actions; retain native commands | T4/T5 |
| `app/src/menu.rs:1` | Product menus, offline About/help, no updater or account entries | T4/T5 |
| `app/src/workflows/mod.rs:3` | Separate local workflow types from cloud workflow variants | T4 |
| `app/src/workflows/manager.rs:1` | Retain local discovery/execution without Drive | T4 |
| `app/src/workflows/workflow_view.rs:39` | Isolate reusable workflow UI from AI/Drive imports | T4 |
| `app/src/workflows/workflow_enum.rs:1` | Separate local argument enums from cloud model types | T4 |
| `app/src/workflows/categories.rs:32` | Retain local categorization without `CloudModel` | T4 |
| `app/src/themes/mod.rs:1` | Register Doom Term theme | T6 |
| `app/src/settings/theme.rs:15` | Choose the fork default without overwriting saved user choices | T6 |
| `app/src/workspace/view.rs:26803` | Mount plate; adapt owned window chrome at one layout seam | T6/T7 |
| `app/src/terminal/view/tab_metadata.rs:16` | Conditional: expose a consistent owned snapshot for the plate | T7 |
| `app/src/view_components/action_button.rs:673` | Channel-aware hard bevel at a shared control seam | T6 |
| `crates/warpui_core/src/rendering/mod.rs:66` | Generic frame policy for square chrome and suppressed shadows | T6 |
| `crates/warpui/src/rendering/wgpu/renderer/rect.rs:98` | Enforce policy for rectangles and shadow submission | T6 |
| `crates/warpui/src/rendering/wgpu/renderer/image.rs:147` | Enforce policy for rounded image masks | T6 |
| `app/src/uri/mod.rs:1` | Accept only supported Doom Term intents for this channel | T5 |
| `crates/warpui/src/browser.rs:17` | Conditional: align the test/web allowlist; this is not the desktop URI handler | T5 |
| `script/linux/bundle:226` | Channel identity and explicit Cargo features; no inherited classifier | T3/T10 |
| `script/macos/bundle:430` | Channel identity, explicit Cargo features, public packaging/signing mode | T3/T10 |
| `script/windows/bundle.ps1:157` | Channel validation, identity, explicit features, fork installer template | T3/T10 |
| `script/compile_icon:27` | Permit a conventional Doom Term icon without the adaptive icon bundle | T5 |
| `.github/workflows/ci.yml:1` | Reclaim fork CI triggers, jobs, runners, and required checks | T9 |

Adding the channel also affects the following **exhaustive-match sites**. Keep these
mechanical edits separate from service removal. A channel addition must not break the
upstream configurations that remain in the tree:

| Existing path and evidence | Explicit Doom Term behavior |
| --- | --- |
| `app/src/autoupdate/mod.rs:782` | Unsupported; no URL construction/download |
| `app/src/autoupdate/mac.rs:737` | Exhaustive identity handling; implementation excluded from local build |
| `app/src/autoupdate/linux.rs:677` | Same exclusion and identity handling |
| `app/src/autoupdate/windows.rs:320` | Same exclusion and identity handling |
| `app/src/autoupdate/changelog.rs:48` | No server changelog |
| `app/src/crash_reporting/mod.rs:281` | Exhaustive label for upstream compilation; no local SDK |
| `app/src/server/telemetry_ext.rs:121` | Exhaustive label for upstream compilation; no local collector |
| `crates/remote_server/src/setup.rs:349` | No Warp remote-server provisioning for Doom Term |
| `crates/http_server/src/lib.rs:77` | Reserve a distinct channel port if compiled; do not start an auth listener |
| `crates/warp_tui/src/terminal_session_view.rs:415` | Exhaustive command identity; do not add a shipped TUI product |
| `crates/warp_tui/src/autoupdate.rs:961` | Explicit unsupported channel |

### Fork-owned file map

Create these during the corresponding tasks; names below are proposed interfaces, not
claims that those files already exist.

| Paths | Responsibility |
| --- | --- |
| `app/src/bin/doomterm.rs`, `app/channels/doomterm/` | Binary, icons, desktop metadata, bundle assets |
| `app/src/doomterm/{mod,policy,startup,branding,theme,chrome}.rs` | Product policy and small integration adapters |
| `app/src/doomterm/plate/{mod,model,view,terminal_snapshot}.rs` | Native view, lifecycle and active-pane integration |
| `app/src/doomterm/local_workflows.rs` | Local workflow UI adapter if extracting the shared view is more invasive |
| `crates/doomterm_plate/src/{lib,spec,paint,glyphs,state}.rs` | Pure geometry, pixel operations, glyph data and presentation state |
| `crates/doomterm_harness/src/{lib,discovery,association,capture,observation,activity}.rs` | Read-only session discovery, usage parsing adapter, freshness and activity |
| `crates/doomterm_plate/Cargo.toml`, `crates/doomterm_harness/Cargo.toml` | Explicit dependencies; no hosted AI dependency |
| `script/doomterm/{run,run.ps1,check-build-policy.py,check-inventory.py,check-plate.py,export-plate-reference.mjs,verify-package.py}` | Reproducible local and CI entry points |
| `script/doomterm/windows-installer.iss` | Independent Inno identity and registry integration |
| `.github/actions/doomterm-setup/action.yml`, `.github/workflows/doomterm-release.yml` | Public-only build setup and publication |
| `docs/doom-term/{feature-inventory,upstream-merge,release,verification}.md` | Maintainer decisions and operating procedures |
| `mockups/evidence/plate/`, `crates/doomterm_harness/tests/fixtures/` | Deterministic visual fixtures and synthetic/redacted history cases |

## 2. Upstream-merge workflow

### T2 — Make upstream tracking routine

**Owner:** the Doom Term maintainer, with the implementer of each ledger seam reviewing
its conflicts. **Cadence assumption:** weekly during development, before each release
candidate, and promptly for relevant security fixes. No unattended auto-merge.

- [ ] Document the remotes and create an integration branch from fork `main`:

  ```sh
  git fetch upstream
  git switch -c merge/upstream-YYYY-MM-DD origin/main
  git merge --no-ff upstream/main
  ```

  Resolve the actual upstream default branch from `git remote show upstream` first; use
  that ref if it differs. Never replace the maintained fork branch with upstream.
- [ ] Inspect the upstream delta for every ledger file, even when Git reports no conflict.
  Reapply the intended invariant, not “ours” or “theirs” wholesale. Audit new startup
  constructors, Cargo feature edges, release flags, and package resource copies.
- [ ] Refresh file/line evidence and the base SHA only after the merge passes the Doom
  Term production graph audit, local terminal regression tests, renderer tests, and CI.
  Retain upstream default-channel compile smoke coverage to detect damage to reusable seams.
- [ ] For each conflict record the upstream change, retained fork behavior, and test evidence.
  Run all desktop builds for channel/config/renderer/packaging changes; pure fork-local
  documentation does not need that fan-out.
- [ ] Merge through a reviewed PR; never mix dependency upgrades or restyling into the
  conflict-resolution commit. Revert the merge if a release blocker cannot be resolved.

Keep inherited repo-sync automation guarded/inactive. It targets a private upstream mirror,
not this fork's merge workflow
([`.github/workflows/repo-sync.yml:18`](../../.github/workflows/repo-sync.yml#L18)).
Do not remove all `warpdotdev` guards globally.

**Done:** a dry-run merge of the recorded baseline is clean; a deliberately unlisted shared
edit fails the ledger check; the procedure specifies the responsible reviewer and gates.

## 3. Channel bring-up

### T3.1 — Define product identity and feature policy

**Files:** channel/config/state/paths and manifests in §1; new binary and policy module.
**Depends on:** T1. **Produces:** a buildable channel before visual or telemetry work.

**Identity assumptions to settle before v1 data exists:** display name `Doom Term`, binary
and package name `doomterm`, app component `DoomTerm`, app ID `io.cmleadmon.DoomTerm`,
scheme `doomterm`, log `doomterm.log`, home config `.doomterm`. Construct the app ID with
`AppId::new("io", "cmleadmon", "DoomTerm")` and test serialized round trips. This deliberately
uses three components to fit the existing parser's `splitn(4, '.')` shape
([`crates/warp_core/src/app_id.rs:29`](../../crates/warp_core/src/app_id.rs#L29)). Use
the same identifier in Rust and packages, and test its platform directory representation.
The identifier is a proposed application namespace, not a claim of domain ownership.

- [ ] Add `Channel::DoomTerm`, non-dogfood, no server URL overrides, no updater, and a
  distinct scheme. Update every enumerated exhaustive match; do not hide omissions with `_`.
- [ ] Add `doomterm` binary with `required-features = ["doomterm"]`. Leave existing
  upstream binary names intact. Point documented development commands at the new wrapper;
  do not silently call `./script/run` and get the wrong channel.
- [ ] Introduce `warp_services` as the default upstream service selection and `doomterm`
  as the local selection; make incompatible combinations a clear compile-time error.
  Give upstream-only binaries matching `required-features` where necessary so they are
  not accidentally built under the local feature set.
- [ ] Represent hosted configuration as absent for the local build. Prefer an optional
  grouped hosted-services config, retaining existing serialized field compatibility for
  upstream channels. Enumerate accessor consumers in T4.1. Never use production defaults,
  empty URL parsing, or fake credentials to stand in for “no services.”
- [ ] Define one closed `DOOMTERM_FEATURES` allowlist and select it before the existing
  release/default union. Initially enable only tested native terminal capabilities; add
  each additional flag with a local feature acceptance test. No `DEBUG_FLAGS` inheritance.
  Check preferences/overrides cannot re-enable prohibited behavior; the compile boundary
  remains the final guarantee.
- [ ] Add subprocess tests for global `ChannelState`: identity, feature list, isolated
  paths, absent configuration, rejected hosted feature combinations, and release/debug
  parity. A process-local singleton must not make tests order-dependent.

**Build contract, after these features are introduced:**

```sh
cargo check --locked -p warp --bin doomterm --no-default-features --features doomterm,gui
cargo build --locked -p warp --bin doomterm --no-default-features --features doomterm,gui
```

The feature list is a contract to implement, not a claim that it works today. In particular,
`gui` currently enables voice input and `local_fs` enables `ai/local_fs`
([`app/Cargo.toml:733`](../../app/Cargo.toml#L733),
[`app/Cargo.toml:793`](../../app/Cargo.toml#L793)). Decouple GUI presence from voice;
explicitly preserve voice selection in upstream GUI bundle configurations. Change optional
dependency forwarding to `ai?/local_fs` once AI is optional. Check `build.rs` feature aliases
as well as Cargo edges; a cfg alias does not activate optional dependencies.

### T3.2 — First local window and package scaffolding

- [ ] Add fork channel assets and bundle metadata alongside the existing OSS metadata
  ([`app/Cargo.toml:1035`](../../app/Cargo.toml#L1035)). Add `doomterm` branches to all
  three platform bundlers with `--no-default-features` and the same explicit features.
- [ ] Add local-only startup entry sufficiently to open a real shell without constructing
  cloud clients. At this intermediate stage, clearly label retained compiled services as
  not yet removed; **do not distribute this build**.
- [ ] Create isolated temporary profile directories and verify fresh launch, typing,
  command output, resizing, exit, and a second launch. Install alongside Warp and confirm
  independent settings, logs, persistence DB, keychain/service names, single-instance
  coordination, desktop identity, and protocol handlers.
- [ ] Inspect bootstrap/build dependency scripts, then install documented public build
  prerequisites. Use `./script/bootstrap --skip-common-skills` when agent skill installation
  is irrelevant. Do not require private channel-config access.
- [ ] Record toolchain, native SDKs, dependency downloads, disk peak, elapsed first build,
  and exact command. Budget a long cold build: the tree has no local build evidence;
  Rust is pinned at [`rust-toolchain.toml:2`](../../rust-toolchain.toml#L2).
  Do not promise a 60-minute build. Filesystem enumeration found 81 app/top-level crate
  manifests; the handoff's “88 members” is not treated as a verified resolved Cargo count.
- [ ] Commit `feat: bring up the Doom Term channel` after the targeted test/lint/format
  sequence. This milestone unblocks plate integration and all platform package work.

**Done:** a documented local command starts the actual Doom Term channel into a usable
shell on the development OS. This establishes neither privacy nor three-platform support.

## 4. Cloud and AI removal

### Feature inventory for maintainer sign-off

The four handoff decisions are fixed. The proposed interpretations below must be visible
in `feature-inventory.md` and reviewed before the relevant removal PR is merged. Planning
continues with these defaults; unfamiliar features are not silently declared superfluous.

| Feature | v1 decision | Implementation classification / acceptance |
| --- | --- | --- |
| PTY, shell integration, blocks, scrollback, command history | Keep | Local execution, restoration and search pass |
| Tabs, splits, windows, keyboard navigation, command palette | Keep | Local actions remain registered and discoverable |
| Themes, fonts, terminal colors, native editor/input behavior | Keep | User selection persists; Four Materials governs owned chrome |
| Local workflows, arguments and aliases | Keep | Existing local files execute without Drive/auth |
| Built-in workflow catalog | Keep only offline bundled definitions | No runtime catalog fetch; preserve notices |
| Shell completions and native suggestions | Keep local providers | Exclude hosted prediction, classifier downloads and AI correction |
| SSH as a user shell command | Keep | User process may use networking; no Warp server needed |
| Warp remote-server provisioning/session relay/sharing | Remove from this build | No automatic remote binary/service provisioning |
| Local launch configurations and session restore | Keep | No team/workspace account requirement |
| Local notebooks/editor/file browsing already used by terminal flows | Retain local functionality where present | Audit coupling; no redesign or new workspace picker |
| Account, login, team/org management, billing, referral/reward UI | Remove from this build | No routes, actions, models, credentials or listeners |
| Drive and team preference sync | Remove service/UI | Keep only separately identified local data types/workflow logic |
| Warp Agent Mode, hosted models, Oz, remote indexing, agent tools/MCP integration | Remove from this build | No AI/service implementation dependencies |
| Voice input and server-generated command features | Remove from this build | No microphone prompt or remote transcription |
| Analytics, traces exported off-device, queued telemetry files | Remove from this build | No collection/export; inert compatibility macros allowed |
| Sentry and crash uploading | Remove from this build | No SDK, native framework, helper or uploader |
| Local logs and OS-level crash diagnostics | Keep | Local errors only, no automatic upload |
| Claude Code/Codex run by the user in a PTY | Keep as ordinary programs | Plate reads local evidence; does not manage or authenticate agents |
| `local_control`, standalone agent CLI, TUI and wasm artifacts | Do not ship/enable in v1 | Preserve upstream source where necessary |
| Autoupdate and remote changelog checks | Remove from this build | Manual GitHub download and local release notes |

Local workflows are a real preservation problem: there is an existing `LocalWorkflows`
model, but workflow views/types import AI, Drive and cloud models
([`app/src/workflows/local_workflows.rs:28`](../../app/src/workflows/local_workflows.rs#L28),
[`app/src/workflows/workflow_view.rs:39`](../../app/src/workflows/workflow_view.rs#L39),
[`app/src/workflows/mod.rs:3`](../../app/src/workflows/mod.rs#L3)). Therefore “gate all of
Drive” is not an adequate implementation step.

### T4.1 — Discover and close the service dependency boundary

**Files:** manifests, startup, server/module registration, local workflow seams in §1;
new `check-build-policy.py` and a machine-readable prohibited-package/policy list.

- [ ] Capture `cargo metadata` and `cargo tree` for each production target with only the
  Doom Term features. Trace reverse edges for `ai`, `warp_server_client`,
  `warp_server_auth`, `cloud_object_client`, Sentry, OTLP exporters and voice input.
  Separate normal/build/dev dependencies; record build-time network tools separately.
- [ ] Make hosted dependencies optional and owned by `warp_services`. Compile-select
  module roots and service-specific registrations; put local startup in `doomterm/startup.rs`.
  Preserve thin shared types only after checking they carry no transport/credential behavior.
- [ ] Run the smallest local check after each module boundary change. For every compiler
  error classify the caller as local logic to retain, hosted logic to exclude, or a shared
  type to extract. Add each actual shared file to the ledger before editing it.
- [ ] Extract pure workflow values, argument parsing, and local loading from cloud variants.
  Reuse local workflow execution. If the existing editing view requires widespread Drive
  types, build the narrow local workflow adapter listed in §1, using existing widgets and
  file formats. Preserve existing local edit/run/alias behavior and round-trip tests.
- [ ] Audit retained `ai_types`, cloud model schemas, and persistence dependencies rather
  than banning by substring. For example persistence directly uses `ai_types`
  ([`crates/persistence/Cargo.toml:22`](../../crates/persistence/Cargo.toml#L22)); retaining
  inert serialized types can avoid an unnecessary database rewrite. Identify each retained
  type-only exception by package and reason in the graph policy.
- [ ] Finish with a resolved caller inventory, actual modified-file list, successful check,
  and no unknown service edges. A compiling no-op implementation that fabricates success
  or authentication is prohibited; unsupported operations return explicit local errors.

### T4.2 — Remove startup, UI and background service behavior

- [ ] Split startup into shared terminal infrastructure and optional hosted registration.
  Audit credential reads, IAP refresh, experiments, cloud preferences, code indexing,
  download attribution, queued tasks, shutdown flushing, and launch-mode/CLI paths.
  The baseline also initializes AI and telemetry directly
  ([`app/src/lib.rs:2067`](../../app/src/lib.rs#L2067)).
- [ ] Enter a workspace immediately on a fresh profile. Exclude authentication views and
  their event handlers, not just the first frame; `RootView` currently selects these
  children from its auth/onboarding state
  ([`app/src/root_view.rs:3996`](../../app/src/root_view.rs#L3996)). Preserve local shell
  setup errors, permissions guidance, restoration, and OS-required prompts.
- [ ] Remove hosted settings pages and settings-search results, command palette entries,
  menus, keybindings, context actions, help links, banners, deep links and CLI subcommands.
  Test dispatch by action ID as well as visually hidden controls.
- [ ] Audit non-service network paths too: async image/theme assets, documentation previews,
  completion updates, model downloads and font loading. Bundle required resources and retain
  local-file/inline assets; reject remote asset sources without fetching. The generic cache
  currently builds asynchronous URL fetches and calls an HTTP client
  ([`crates/asset_cache/src/lib.rs:34`](../../crates/asset_cache/src/lib.rs#L34),
  [`crates/asset_cache/src/lib.rs:143`](../../crates/asset_cache/src/lib.rs#L143)). Make that
  transport optional and exclude it from the Doom Term graph. Record any retained generic
  network dependency's actual consumer; a renamed package is not a removal strategy.
- [ ] Ensure user-supplied `WARP_API_KEY`, server URL overrides, old settings, debug flags,
  restored state, and incoming auth URLs cannot activate service behavior.
- [ ] Exercise blocks/history, local workflow argument editing and execution, aliases,
  themes, launch configs, split/tab/window lifecycle, clipboard, search and shell completion
  under a fresh local profile. Record any retained local feature limitation explicitly.

### T4.3 — Remove telemetry and establish binary/privacy evidence

- [ ] Compile-select telemetry macros so event expressions are not evaluated. Remove
  direct recorder calls and registration/queue paths too: lower-level macros and functions
  can bypass the app's collector
  ([`crates/warp_core/src/telemetry.rs:147`](../../crates/warp_core/src/telemetry.rs#L147),
  [`crates/warpui_core/src/telemetry/mod.rs:17`](../../crates/warpui_core/src/telemetry/mod.rs#L17)).
  Test a side-effecting event argument and assert that the side effect never runs.
- [ ] Exclude collectors, disk queues and exporters. Keep only compatibility traits/types
  required by retained code. Verify no event file appears after launch/use/shutdown;
  `TelemetryCollector` has both disk-write and shutdown-flush methods today
  ([`app/src/server/telemetry/collector.rs:82`](../../app/src/server/telemetry/collector.rs#L82)).
- [ ] Exclude `crash_reporting`, `cocoa_sentry`, native Sentry resources, crash uploader
  helpers, OTLP exporters and diagnostic upload actions. Sentry dependencies are already
  optional, so verify feature propagation instead of claiming the manifest entries alone
  mean Sentry ships ([`app/Cargo.toml:144`](../../app/Cargo.toml#L144),
  [`app/Cargo.toml:486`](../../app/Cargo.toml#L486)).
- [ ] Audit release graphs independently of workspace/test feature unification. Build
  symbols/package contents and scan for prohibited clients/exporters and operational
  endpoint strings; review false positives from notices or retained type names.
- [ ] Run network-observed fresh launch, terminal use, settings, plate watching, idle,
  shutdown and relaunch with internet available, then with egress blocked. Require **zero
  app-initiated network attempts**, not merely zero successful connections. Capture DNS,
  TCP and UDP attempts with process attribution. Exclude deliberately run user programs
  from the assertion and test them separately.
- [ ] Repeat on packaged release binaries on all three OSes. Include a long idle test and
  malformed histories so error paths cannot start reporting. Archive graph, process/file
  traces, package manifest and test results under the candidate SHA.

**Done:** forbidden functionality is compile excluded, retained compatibility types are
listed, preserved local features pass, and exact release candidates show no application
network attempts. Update README claims only to the scope actually verified.

## 5. Trademark and branding strip

### T5 — Make distributed identity independent

**Depends on:** T3 identity. Can proceed alongside T4 after channel bring-up.
**Files:** channel assets, branding module, URI/menu/settings seams, build/bundle scripts;
new fork installer and license/notice manifest.

- [ ] Create original Doom Term icon assets in PNG, ICO and macOS-compatible formats.
  Replace app/about/installer/loading graphics and product-facing names. Do not repurpose
  upstream marks or copy assets from the archived application without verifying provenance.
- [ ] Parameterize identifiers in Linux desktop/MIME/AppImage/deb/rpm metadata, macOS
  plist/services/dock metadata, and Windows resources, AppUserModelID, mutex, registry,
  shortcuts, uninstall and shell menu entries. The current installer hardcodes publisher,
  URL and product registry names
  ([`script/windows/windows-installer.iss:5`](../../script/windows/windows-installer.iss#L5),
  [`script/windows/windows-installer.iss:111`](../../script/windows/windows-installer.iss#L111)).
  Select a new fork-owned installer template, preserving the upstream one.
- [ ] Register `doomterm://` only for supported local intents; reject account, sharing and
  hosted-agent intents without network access. Test actual OS dispatch, not just the
  web/test-only browser helper
  ([`crates/warpui/src/browser.rs:16`](../../crates/warpui/src/browser.rs#L16)).
- [ ] Ship local Help/About text, license access, release version, source URL and manual
  release-download link. Opening a link is user initiated; never fetch it in the background.
- [ ] Audit shell bootstrap prompts, environment-facing names, notifications, default tab
  titles and errors. Keep internal compatibility identifiers where renaming would break
  terminal protocols; explain each visible legacy format exception. Preserve copyright,
  license and upstream attribution rather than mechanically deleting the word “Warp.”
- [ ] Generate a package resource list and scan distributed strings/assets. Maintain a
  reviewed allowlist for legal notices and intentional file-format compatibility. Manually
  inspect first run, menus, settings, dialogs, taskbar/dock and installer screenshots.
- [ ] Bundle AGPL/MIT notices and dependency notices; validate the licenses/provenance of
  plate glyphs and marks before porting those assets. Use independent agent labels if an
  agent mark's distribution rights are unverified. Never bundle comparison screenshots.
- [ ] Publish exact corresponding source and build instructions with each binary release,
  including fork changes and required build material/dependency revisions. A public repo
  is the delivery mechanism, not proof by itself that the matching complete source is
  available. See [AGPLv3 §6](https://www.gnu.org/licenses/agpl-3.0.en.html).

The repository identifies app licensing as AGPL and the two UI crates as MIT and explicitly
permits forks ([`FAQ.md:93`](../../FAQ.md#L93), [`FAQ.md:131`](../../FAQ.md#L131)).
The product mark audit is a **release gate**, including prerelease public binaries.

**Done:** package audit and screenshots contain only intended product identity and permitted
attribution; side-by-side install/uninstall leaves Warp and Doom Term data independent.

## 6. Milestone M4 (Four Materials reskin) — Formally Retired

### Decision: Retire M4 to protect developer ergonomics and upstream maintainability

Following an exhaustive side-by-side interactive comparison (`mockup.html` Tab 1) and
multi-dimensional evaluation documented in `evidence.html` Section 6, **Milestone M4 is formally
retired from the core Doom Term release architecture**.

**Rationale:**
1. **Hero Feature Focus (The "Cyberpunk Cockpit"):** Doom Term's distinctive identity is the
   hardware status plate (`crates/doomterm_plate`). Docking this analog telemetry HUD into Warp's
   clean, modern dark chrome creates a striking high-contrast visual identity. Applying hard 2px
   bevels and square corners to every button, tab, and card dilutes that impact and camouflages
   the plate in a sea of grey bevels.
2. **Daily Developer Ergonomics (The 8-Hour Test):** Terminal users spend 8–10 hours per day in
   the application. Hundreds of high-contrast 2px light/dark bevel borders create persistent
   peripheral edge noise and eye strain. Warp's subtle hairlines and calibrated 6–8px rounded
   corners provide proven long-session comfort.
3. **Eliminating the Upstream "Merge Tax":** Enforcing `ChromePolicy::SquareHardEdges` across
   `crates/warpui_core` GPU vertex preparation (`rect.rs`, `image.rs`) and overriding hundreds
   of view files would create catastrophic ongoing merge conflicts with upstream `warpdotdev/warp`.
   Without M4, Doom Term modifies **zero** GPU rendering pipelines; the status plate remains an
   additive, isolated footer view.

*(Optional future enhancement):* If retro-brutalist styling is ever desired, it may be shipped as
an optional opt-in CSS/theme extension, but it is not a prerequisite or gate for Doom Term v1.0.0.

## 7. Status plate

### Decisions and evidence

**Home:** a footer below the workspace terminal area, one plate per window, bound to the
focused terminal pane. Reserve layout space so it cannot cover the prompt or scrollback;
modals remain above the workspace. `Workspace::render` is the mounting seam
([`app/src/workspace/view.rs:26803`](../../app/src/workspace/view.rs#L26803)). No separate
window, sidecar, extra agent rail or workspace picker is added.

**Reference assumption:** implement `mockups/plate.js`, as explicitly named by the handoff,
including its token table and chip slots. Do not silently switch to `plate.doom.js`:
that variant removes those fields and changes queue layout
([`mockups/README.md:50`](../../mockups/README.md#L50)). A later preference for that variant
changes the geometry fixtures; it does not change data truth requirements.

**Renderer:** native WarpUI `View`/`Element`, using a pure Rust geometry/pixel-operation
module. No JavaScript runtime or webview dependency. Manifest and Rust trait searches at
the baseline found no embedded webview or plugin API. The small browser helper implements
escaping and scheme checking, not embedding
([`crates/warpui/src/browser.rs:1`](../../crates/warpui/src/browser.rs#L1)).

**Data:** reuse `warp_harness_usage` directly, without importing hosted `ai`. Its dependencies
are serde and serde_json
([`crates/warp_harness_usage/Cargo.toml:8`](../../crates/warp_harness_usage/Cargo.toml#L8)).
It accepts captured records, not a live PTY or directory watcher. Its snapshot is cumulative
usage with attribution/coverage; it does **not** currently expose context occupancy,
quota percentage, sandbox state or an activity state machine
([`crates/warp_harness_usage/src/lib.rs:77`](../../crates/warp_harness_usage/src/lib.rs#L77),
[`crates/warp_harness_usage/src/codex.rs:25`](../../crates/warp_harness_usage/src/codex.rs#L25),
[`crates/warp_harness_usage/src/claude.rs:24`](../../crates/warp_harness_usage/src/claude.rs#L24)).

### Field contract

Every displayed observation carries session identity, source record/file, capture generation,
coverage and observation time in the model. Raw prompts/tool arguments never enter UI logs.

| Field | Real source and interpretation | Missing/ambiguous behavior |
| --- | --- | --- |
| `agent` | Verified foreground executable/session association: Claude Code, Codex, or known shell | Generic unknown mark; never infer from text resembling a footer |
| `agentName` | Verified harness identity; model only from applicable record attribution | Known harness name alone, otherwise `--`; do not pick a historical model arbitrarily |
| `context` | New optional local observation parser: current context tokens and same-session reported capacity | `--` unless both are reported with compatible semantics; cumulative tokens are not context occupancy |
| `usage` | New optional parser for a reported rate-limit window and consumed fraction | `--`; no conversion from token totals or local model-price tables |
| `table` | `extract_claude` / `extract_codex`, preserving provider counter semantics and coverage | Unknown cells/limits `--`; partial counts visibly marked; never synthetic limits |
| `sandbox` | Explicit provider policy record, only where its meaning maps exactly to the displayed tier | `--`; do not copy prototype default `OFF` |
| `path` | Active terminal's shell-reported cwd via `display_working_directory` | `--`; never the app process cwd or a default `~` |
| `branch` | Existing `current_git_branch` adapter for the active terminal | `--` outside repo, detached/unknown as applicable; no local branch for an SSH cwd |
| `chips` | Only actual local toggle/alert state with a registered owner | Unknown/unlit and noninteractive; a false-looking disabled toggle must not imply a known setting |
| `waiting` | This app's associated sessions with an observed stop/turn-complete/needs-input transition | Empty list; no inferred rows from silence/mtime |
| `pulse`, `phase` | Monotonic animation clock gated by verified activity state | Static when idle/unknown; no fabricated activity |
| `mode`, `transport` | v1 uses the waiting layout; no transport subsystem is ported | `transport = None`; mode is layout state, not a claim about activity |

Cwd/branch adapters already exist
([`app/src/terminal/view/tab_metadata.rs:16`](../../app/src/terminal/view/tab_metadata.rs#L16),
[`app/src/terminal/view/tab_metadata.rs:36`](../../app/src/terminal/view/tab_metadata.rs#L36)).
Use them instead of creating a second repository watcher. The prototype's unknown-field
contract is documented at [`mockups/plate.js:430`](../../mockups/plate.js#L430), but its
`sandbox: 'OFF'` and `path: '~'` defaults must be tightened for the live product.

### T7.1 — Geometry, glyphs and deterministic painting

**Depends on:** T3; pure module can proceed independently of T4 and T7.2.
**Files:** `doomterm_plate`, reference exporter/checker, plate view adapter.

- [ ] Export numeric geometry, glyph matrices, palette and waiting-row boxes from the
  reference into versioned data fixtures. Preserve `plateSpec(width)` formulas, not one
  screenshot's coordinates. Strip reference-only names/comments from production types.
  Geometry begins at [`mockups/plate.js:479`](../../mockups/plate.js#L479).
- [ ] Define `PlateSpec::for_width(width: u32) -> PlateSpec`, a semantic `PlateState`, and
  `paint(spec: &PlateSpec, state: &PlateState) -> Vec<PixelOp>`. `PixelOp` describes colored
  integer rectangles; the same operations feed a small test rasterizer and WarpUI scene
  submission. Keep hit regions derived from `PlateSpec` and visible rows.
- [ ] Port text/glyph/palette/agent-mark rendering from verified reference data. Preserve
  measured 32-pixel height, left anchors and right-relative fields. Test these minimum
  invariants before wiring the app:

  ```rust
  let base = PlateSpec::for_width(480);
  assert_eq!((base.height, base.context_x, base.usage_x), (32, 44, 90));
  assert_eq!((base.sandbox_x, base.zone_x, base.zone_width), (381, 334, 0));
  assert_eq!(PlateSpec::for_width(700).sandbox_x, 601);
  ```

- [ ] Generate fixtures at widths 480, 600, 700, 960 and 1280 plus every waiting-column
  threshold ±1. Test all-unknown state, known zero, maximal counts, long Unicode labels,
  empty/one/six/overflow waiting rows, and deterministic animation phases.
- [ ] Render at an integer physical-pixel scale. For a narrow window, reduce the integer
  scale before clipping; below the 480-pixel design minimum show a compact unknown/status
  summary rather than overlap fields. The compact fallback is explicitly outside reference
  parity and needs its own layout tests. Do not claim the reference is valid at arbitrary
  subminimum widths. Reference upscaling rejects fractional scales
  ([`mockups/plate.js:893`](../../mockups/plate.js#L893)).
- [ ] Add accessible names/text for rendered values and actual controls; use text fallback
  for unsupported glyphs, never silent loss of the underlying value. Retain full source
  values for accessible text even when painted labels are truncated.

### T7.2 — Local discovery, association, usage and activity

**Files:** `doomterm_harness`, parser fixtures/tests, plate model and terminal snapshot adapter.
**Interfaces:** `SessionKey { provider, native_id }`; `Observation<T>` with known/partial/
unknown variants and provenance; `HarnessSnapshot` with usage, metadata and activity;
`associate(pane_snapshot, candidates) -> Association` where ambiguity is a first-class result.
These types are owned by the new adapter; `warp_harness_usage::UsageSnapshot` remains intact.

- [ ] Discover histories under user-configured roots, with conventional Claude/Codex roots
  as **assumptions requiring fixture verification**, honoring CLI home overrides. Read only
  local histories. Remote/WSL sessions without a verified accessible source stay unknown.
  Do not inspect unrelated credential stores or copy whole transcripts to app storage.
- [ ] Match a foreground process generation, provider, session metadata, cwd and observed
  launch/session identity. Cwd alone and “most recently modified file” are insufficient.
  Prefer an explicit session identifier already present in observed launch arguments or
  metadata; if several candidates remain, display `--`. Do not introduce a session picker
  or intercept/rewrite user commands to manufacture an association.
- [ ] Implement bounded background capture, never file I/O in render. Start with proposed
  limits of 1 MiB per line, 32 MiB per active capture, 100,000 records and eight open
  histories; surface `ResourceLimited` instead of silently accepting a complete result.
  Use the parser's existing `JsonlLimits` and diagnostics
  ([`crates/warp_harness_usage/src/capture.rs:19`](../../crates/warp_harness_usage/src/capture.rs#L19)).
  Reassess limits using representative histories, documenting memory and latency results.
- [ ] Watch the verified roots, debounce updates at 250 ms, and use a two-second metadata
  rescan fallback if watching is unsupported. Track file identity/size and capture generation;
  restart on rotation/truncation. Never count replayed cumulative checkpoints as new tokens.
  Initially reparse a bounded frozen capture on change; optimize incremental aggregation
  only if measured capture costs require it.
- [ ] Feed captures and matching diagnostics into `extract_claude`/`extract_codex`.
  Claude can include discovered subagent captures; Codex currently describes root-rollout
  scope only. Preserve those distinctions in displayed totals/tooltips
  ([`crates/warp_harness_usage/src/claude.rs:84`](../../crates/warp_harness_usage/src/claude.rs#L84),
  [`crates/warp_harness_usage/src/codex.rs:78`](../../crates/warp_harness_usage/src/codex.rs#L78)).
- [ ] Add optional metadata observations for context capacity, current occupancy, quota and
  sandbox only against concrete versioned records. Never hardcode a model capacity. A
  missing schema fixture means that field remains unknown in v1, not a guessed number.
  Reject negative/nonfinite counters, zero denominators, incompatible scope and stale
  windows. For valid percentages use `100 * used / capacity`, with explicit rounding;
  reject contradictory values rather than hiding them by clamping.
- [ ] Table semantics: Codex cached input is a subset of input and reasoning is included
  in output; use provider total when present. Claude total is a derived sum only when all
  disjoint required counters are known. Label cache/read/write scope; never sum both a
  parent counter and its partitions. Unknown limits remain `--`
  ([`crates/warp_harness_usage/src/codex.rs:25`](../../crates/warp_harness_usage/src/codex.rs#L25),
  [`crates/warp_harness_usage/src/claude.rs:24`](../../crates/warp_harness_usage/src/claude.rs#L24)).
- [ ] Implement `Unknown`, `Idle`, `Working`, `NeedsInput`, `Stopped` transitions from
  verified provider lifecycle records and terminal process exit. A turn start begins
  continuity; an explicit completion/stop/exit ends it. Repaint bytes, mtime changes and
  periodic footers never begin or extend working state. When a provider lacks decisive
  lifecycle evidence, report unknown; do not leave an animation running indefinitely.
- [ ] Test with synthetic/redacted fixtures: two sessions in one cwd; old/resumed session;
  process ID reuse; focus change while reading; repeated checkpoints; compaction;
  concurrent append/partial trailing line; corrupt interior line; permission denial;
  symlink replacement; deleted/rotated source; huge line; unknown provider schema;
  overflow; Unicode/Windows paths; idle footer repaint; completion and disconnect.

Explicit behavioral examples for the new test harness:

```text
same cwd + two valid sessions + no session identifier => Association::Ambiguous
known total_tokens=0 + Known coverage => table cell "0"
no current-context capacity => context "--"
Working(turn A) + footer repaint + turn-complete(A) + footer repaint => Idle
capture generation 4 for pane A arrives after focus moved to B => discard
```

### T7.3 — Mount, lifecycle and interaction

- [ ] Create the plate model/view once per window; subscribe to focused-pane, cwd/branch,
  process-lifecycle and harness snapshot changes. Cancel readers on pane/window close;
  debounce invalidation and avoid repainting the terminal for unchanged observations.
- [ ] Take short, owned snapshots of terminal state. Do not add nested terminal-model
  locks, perform filesystem reads under the lock, or acquire it in the paint path.
- [ ] Build persistent mouse-state handles at construction. Waiting rows may focus only
  the existing associated pane; hidden/overflow rows are not clickable. Unknown lamps
  have no action. Clicks on the plate must not send bytes to the terminal.
- [ ] Provide keyboard/accessibility equivalents for real actions and static reduced-motion
  output. No animation when unknown/idle; start a bounded frame clock only while needed.
- [ ] Validate long-running shell output, alternate screen, IME composition, split changes,
  moving tabs between windows, reconnect, no histories, and multiple providers. Record
  frame/capture cost; a proposed initial target is <2 ms plate paint on the reference
  development machine, with no periodic repaint while idle. This is a target, not measured fact.

### T7.4 — Visual parity with independently generated evidence

The handoff's `84.96% within 8 / MAE 11.41` measures a **Warp shell HTML rebuild**, not the
plate ([`mockups/evidence/metrics.json:6`](../../mockups/evidence/metrics.json#L6)). The
README explicitly excludes the plate and rail
([`mockups/README.md:77`](../../mockups/README.md#L77)). Do not present those numbers as
proof of a Rust plate port or require a deliberate reskin to match the old shell screenshot.

- [ ] Keep the original study/metrics as provenance and re-run its existing measurement
  command if that study changes. Its channel-wise error formula is reusable, while its
  fixed app crop/landmarks are not a generic plate checker
  ([`mockups/scripts/measure.py:176`](../../mockups/scripts/measure.py#L176)).
- [ ] Add a reference exporter using `renderPlate()` to emit raw RGBA plus width/height,
  serialized state, geometry and source SHA-256. Use test-only fixture states; production
  modules cannot import `DEMO_STATE`. Export to `mockups/evidence/plate/` without modifying
  the archived renderer merely to make parity pass.
- [ ] Rasterize Rust `PixelOp`s independently to raw RGBA. `check-plate.py` compares equal
  dimensions, exact geometry/hit boxes, maximum channel error and MAE; save diff images and
  machine-readable metrics. Require byte equality for the pure integer renderer.
- [ ] Capture native WarpUI plate pixels at controlled scale/color settings. Initial GPU
  gate: at least 99% of pixels within eight levels and MAE ≤1, exact field/row positions,
  with screenshots/heatmaps attached. These are proposed acceptance limits to validate
  during bring-up; changing them requires an explained baseline review, not silent drift.
  Keep any approved driver-specific tolerance separate from the exact pure-renderer test.
- [ ] Run pure parity in every affected PR; native capture on the release OS matrix. If a
  runner cannot provide a real display, mark native visual verification incomplete and
  require recorded manual capture of that exact candidate before publication.

**Done:** measured reference fidelity, live data provenance, unknown-state tests, lifecycle
tests and native input/layout acceptance all pass. `local_control` remains unused: its
session payload is identity-only and its public default is disabled
([`app/src/local_control/handlers/metadata.rs:915`](../../app/src/local_control/handlers/metadata.rs#L915),
[`app/src/settings/local_control.rs:39`](../../app/src/settings/local_control.rs#L39)).

## 8. Test and verification strategy

### T8 — Turn acceptance criteria into repeatable gates

**Files:** tests adjacent to new modules, GUI integration cases under
`app/src/integration_testing/doomterm/`, registration in the actual integration runner,
fork verification scripts and `verification.md`. Inspect the GUI integration skill before
choosing registration files; list those exact shared files in the ledger before editing.

Use meaningful behavior tests, not tests that simply restate implementation. Put Rust tests
in separate `_tests.rs` files. Build the test app with the same Doom Term policy; an upstream
integration binary with cloud behavior does not validate the released product.

| Layer | Local execution | CI / release evidence |
| --- | --- | --- |
| Policy/identity and parser/geometry tests | Smallest affected package/filter | All affected targets; deterministic fixtures |
| Native feature preservation | Focused GUI integration tests and interactive shell | Blocks/history/workflows/themes/tabs/splits/restore |
| Compile exclusion | Production graph + module audit | Per-target release graph; no test-feature union |
| Privacy | Observed startup/use/idle/shutdown | Exact packaged binaries; attempted network/file activity |
| Visual | Pure pixel parity; development GPU capture | Pure gate plus OS captures and material checklist |
| Packaging | Extract and inspect local package | Install, launch, upgrade, uninstall on clean OS profiles |
| Compatibility | Explicit upstream-channel compile smoke | Shared-seam changes and upstream merge PRs |

After feature boundaries exist, baseline commands are:

```sh
cargo nextest run --locked -p doomterm_plate -p doomterm_harness -p warp_harness_usage
cargo nextest run --locked -p warp --lib --no-default-features --features doomterm,gui -E 'test(doomterm)'
cargo clippy --locked -p doomterm_plate -p doomterm_harness --all-targets --tests -- -D warnings
cargo clippy --locked -p warp --lib --bin doomterm --no-default-features --features doomterm,gui -- -D warnings
python3 script/doomterm/check-build-policy.py
python3 script/doomterm/check-inventory.py
python3 script/doomterm/check-plate.py
```

Add focused existing terminal/workflow/renderer tests and doc tests when those owners
change. A filter matching zero tests must fail the wrapper. Do not substitute these new
tests for the affected retained feature tests.

**Required local order:** implement/self-review → relevant tests → affected Clippy and
other build/lint checks → applicable mutating formatters once → PR. If a later code change
affects behavior, repeat the affected sequence. Do not rerun tests merely because formatting
ran. No full `./script/presubmit` unless specifically requested.

**What a local green result does not cover:** other OS cfg branches, native installers,
OS security prompts, GPU/driver differences, full workspace compatibility, migrations,
license checks, PowerShell lint, WGSL formatting and Obj-C/C++ formatting unless actually
run. Existing CI has distinct formatting/Clippy, license, WGSL and PowerShell jobs
([`.github/workflows/ci.yml:550`](../../.github/workflows/ci.yml#L550),
[`.github/workflows/ci.yml:645`](../../.github/workflows/ci.yml#L645)).

**Manual matrix, exact candidate SHA required:**

- Linux: AppImage extraction and executable launch, deb/rpm install, X11 and Wayland,
  clipboard, shell startup, IME, scaling, supported distro ABI and uninstall.
- macOS: both selected architectures, downloaded/quarantined DMG, app drag/install,
  first launch warnings, Dock/Finder/services, clipboard/IME, fullscreen/mixed DPI,
  preserved permissions and update-by-replacement.
- Windows: downloaded installer security prompt, per-user install, PowerShell and
  supported shells, ConPTY, long/non-ASCII paths, DPI changes, file associations, PATH,
  uninstall and side-by-side Warp installation. WSL history discovery remains unknown
  unless explicitly verified; that must not break ordinary WSL terminal use.

Cloud/native verification follows cheap local gates and selects only affected dimensions.
Use the public GitHub runner matrix in §9; the repository's Oz-specific verification skill
is useful sequencing guidance but is not made a build or account prerequisite.

## 9. CI

### T9 — Reclaim fork CI without activating upstream infrastructure

**Files:** `.github/workflows/ci.yml`, new fork setup action and verification scripts.
**Depends on:** T3. Bring up a small CI path early; add each gate with its implementation.

The current workflow targets `master`/release branches, gates on upstream ownership, and
uses larger runners for lint jobs
([`.github/workflows/ci.yml:1`](../../.github/workflows/ci.yml#L1),
[`.github/workflows/ci.yml:53`](../../.github/workflows/ci.yml#L53),
[`.github/workflows/ci.yml:565`](../../.github/workflows/ci.yml#L565)). Its environment action
already tolerates absent private channel config, but also selects upstream Xcode/setup
behavior ([`.github/actions/prepare_environment/action.yml:100`](../../.github/actions/prepare_environment/action.yml#L100)).
Create fork setup rather than treating the private config as the primary blocker.

- [ ] Trigger on PRs to fork `main`, pushes to `main`, and manual runs; correct manual-event
  handling so absent PR fields do not suppress jobs. Replace the owner guard only in the
  reclaimed workflow. Keep private repo-sync and upstream release cron inactive.
- [ ] Use read-only job permissions for validation and no secrets on untrusted PRs. Pin
  actions/tool downloads to reviewed revisions/checksums. No GCP, Sentry, Trunk, private
  channel repository, paid Namespace runner, or organization token requirement.
- [ ] Add fast policy, inventory, source/fixture and formatting checks first. Follow with
  Linux targeted tests/build and affected macOS/Windows native jobs. Channel/shared-core
  edits require all three; documentation-only changes use static checks.
- [ ] Before the M3 identity/source gate passes, keep binary artifacts local to the build
  job and upload only logs/metrics. Public CI artifact storage is also distribution; early
  package dry runs must not bypass the prerequisite for public branding and source readiness.
- [ ] Start with `ubuntu-latest`, `macos-latest`, `windows-latest`. Resolve and record their
  actual architecture/SDK image at execution. Select a standard Intel macOS runner for the
  separate x86-64 release target if `macos-latest` is ARM; never infer an architecture from
  the label. Pin an explicit supported image if moving `latest` breaks toolchain compatibility.
- [ ] Proposed timeouts: fast jobs 15 minutes, native tests 180, release bundles 300.
  Measure cold builds and peak disk/RAM before tightening. GitHub-hosted jobs have a
  six-hour execution limit; splitting jobs/caching is the first response, not silently
  switching to paid runners ([GitHub limits](https://docs.github.com/en/actions/reference/limits)).
- [ ] Cache registry/git dependencies and target artifacts keyed by OS, architecture,
  Rust version, lockfile, native toolchain and feature profile. Separate local/upstream
  profiles to prevent feature-unification evidence mistakes. Cancel superseded PR runs;
  retain failures and manifests with short artifact retention.
- [ ] Preserve useful existing Rust/format/license/schema/PowerShell/WGSL checks, adapting
  cloud-dependent tests to explicit exclusions with reasons. Remove service upload steps
  from the fork job graph. No “green” empty matrix or skipped required build.
- [ ] Make a final required aggregation job fail if any required target/gate is missing,
  skipped unexpectedly, failed or cancelled. Record native display gaps separately from
  successful compilation. Add a clean-cache build on manual/release-candidate runs.
- [ ] Measure queue/build durations, cache size and artifact retention. Standard hosted
  runners are free for public repositories under current GitHub documentation, but larger
  runners, private-repo usage and storage can incur charges. Set a maintainer-reviewed
  storage/spend cap; do not claim unlimited free storage
  ([GitHub billing](https://docs.github.com/en/actions/concepts/billing-and-usage)).

**Done:** a fork PR actually executes the expected jobs on standard runners without upstream
credentials; a failing/missing platform prevents a green required check.

## 10. Release pipeline

### Release decisions

- **Distribution:** GitHub Releases only. No GCS, Sentry releases/symbol uploads, Arch
  repository publication, wasm build, standalone agent CLI or TUI artifacts in v1.
- **Updates:** manual download/install only. No GitHub updater in v1. Explain replacing an
  existing install and preserving data; release notes link to the next release page.
- **Signing:** unsigned Windows installer; macOS ad-hoc code signing where execution requires
  it, without Developer ID/notarization. “Unsigned” is not permission to omit required Mach-O
  signing. Verify nested binaries and final bundles after packaging.
- **Versioning:** semantic versions, first stable `v1.0.0`; candidates `v1.0.0-rc.N` are
  prereleases. Keep one app version source under `app/channels/doomterm/version.toml` and
  require tag equality. Derive numeric Windows version and distro-compatible prerelease
  ordering explicitly; never pass raw prerelease strings into numeric installer fields.
- **Architecture assumption:** Linux x86-64; Windows x86-64; macOS ARM64 and x86-64 as two
  DMGs. All three OSes are mandatory. Universal DMG, Linux ARM64 and Windows ARM64 are
  deferred unless the user expands the hardware matrix; do not confuse OS scope with
  every upstream architecture.
- **Support floor assumption:** first validate Linux on Ubuntu 24.04-equivalent ABI,
  Windows 11, and macOS 14+. Advertise only tested versions. An existing deployment-target
  variable is not proof of OS support
  ([`.cargo/config.toml:9`](../../.cargo/config.toml#L9)). Containerize the Linux build on
  the chosen ABI floor if the standard host is newer; a newer glibc build cannot be made
  older-compatible by renaming its artifact.

The inherited dispatcher and package scripts are reusable mechanisms
([`script/bundle:5`](../../script/bundle#L5)); the inherited orchestration also uploads
to external services and uses paid/private runners
([`.github/workflows/create_release.yml:278`](../../.github/workflows/create_release.yml#L278),
[`.github/workflows/create_release.yml:387`](../../.github/workflows/create_release.yml#L387),
[`.github/workflows/create_release.yml:1048`](../../.github/workflows/create_release.yml#L1048)).
Build a new workflow instead of pruning thousands of lines in place.

### T10.1 — Fork-owned package production

**Depends on:** T3 for dry runs; T4–T8 for releasable candidates.

- [ ] Add public setup recipes for compiler/native libraries and packaging tools. Audit
  every dependency download for public availability, pinned identity and checksum;
  test with no upstream secrets. Include Linux packaging tools, macOS cargo-bundle/DMG
  tools and Windows Inno Setup plus bundled ConPTY/runtime prerequisites.
- [ ] Make all platform scripts accept `--channel doomterm`, select the exact locked local
  Cargo configuration, omit Sentry/classifier/voice/cloud extras, and output a machine-readable
  artifact manifest. Reject unsupported artifact types for this channel.
- [ ] Reuse Linux package generation for AppImage, deb and rpm; the upstream workflow already
  invokes these package types
  ([`.github/workflows/create_release.yml:1137`](../../.github/workflows/create_release.yml#L1137)).
  Test dependencies, executable bits, icons, launchers and clean uninstall on compatible
  Debian- and RPM-family systems. Do not ship a package merely because an archive was created.
- [ ] Produce one macOS app/DMG per architecture with correct executable architecture,
  deployment target, dynamic libraries, icons and schemes. Extend the missing-adaptive-icon
  fallback, currently OSS-only ([`script/compile_icon:25`](../../script/compile_icon#L25)).
  Use the script's explicit ad-hoc path or fork equivalent; do not assume `--nosign` alone
  yields a runnable Apple Silicon bundle. The existing fallback is at
  [`script/macos/bundle:916`](../../script/macos/bundle#L916).
- [ ] Produce Windows Inno installers with a distinct upgrade/uninstall identity, accurate
  version resources and no signing command. Signing is already optional
  ([`script/windows/bundle.ps1:34`](../../script/windows/bundle.ps1#L34)). Test upgrades
  without force-killing Warp or deleting either application's user data.
- [ ] Attach source archive/build manifest, license notices, SHA-256 sums and checks from
  `verify-package.py`. Check architecture, executable/library inventory, forbidden resources,
  embedded identity, version and install scripts against an explicit manifest.

Expected binary asset set for version 1.0.0:

```text
doomterm-1.0.0-linux-x86_64.AppImage
doomterm_1.0.0_amd64.deb
doomterm-1.0.0-1.x86_64.rpm
doomterm-1.0.0-macos-arm64.dmg
doomterm-1.0.0-macos-x86_64.dmg
doomterm-1.0.0-windows-x86_64-setup.exe
```

### T10.2 — Validate, draft and publish atomically

Proposed workflow dependency graph:

```text
validate tag / exact source / required CI
  -> build Linux, macOS ARM64, macOS x86-64, Windows
  -> package audits + candidate install/native/privacy evidence
  -> assemble checksums, source, manifest, release notes
  -> create/update draft GitHub release and upload complete asset set
  -> maintainer publication gate
  -> publish draft + anonymous download/checksum smoke
```

- [ ] Trigger builds on `v*` tags and manual candidate dispatch. Validate semver/tag/source
  version and ensure the SHA is an approved fork commit. PR jobs can build artifacts but
  cannot publish. A tag must not bypass required checks or publish an incomplete matrix.
- [ ] Build once for each candidate. Carry immutable manifests/checksums through testing
  and publication; do not rebuild after manual acceptance. Reuse workflow artifacts to
  retry upload failures without changing already-tested binaries.
- [ ] Gate draft assembly on the full expected asset list, successful graph/privacy/brand
  checks, matching source SHA/version and manual evidence where native CI is unavailable.
  Only the release job gets `contents: write`; avoid unnecessary external credentials.
- [ ] Write release notes with supported OS/architectures, exact upstream base, feature
  changes, manual update instructions, known unknown plate fields, limitations, source and
  license links, checksum instructions and security-prompt expectations.
- [ ] State plainly that unnotarized macOS builds may be blocked by Gatekeeper and require
  an explicit OS override for trusted software. Link Apple's guidance; do not recommend
  disabling system security globally
  ([Apple support](https://support.apple.com/en-us/102445)). Windows may show an unknown
  publisher/SmartScreen warning, and policy or Smart App Control may block unsigned code
  ([Microsoft guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)).
  Test the downloaded, quarantined artifact, not only a locally built executable.
- [ ] Use a release environment/manual publish action as the maintainer's final review
  point. After publication, download each asset anonymously, verify checksums, and confirm
  source/notes links and platform assets are publicly accessible.
- [ ] If a post-publication defect is found, mark the release affected and publish a new
  patch/candidate; do not move the tag or silently replace different bytes under the same
  version. Keep an accessible last-known-good release and explain data-version rollback limits.

**Done:** an actual published GitHub release with all six binary assets, complete matching
source, checksums/notices, installation evidence and truthful limitations. A draft or a
green build workflow alone is not project completion.

## 11. Milestones and critical path

| Milestone | Work / suggested commit boundary | Definition of done |
| --- | --- | --- |
| M0 — Honest baseline | T1/T2; documentation and ledger commit | README corrected; scope inventory and merge procedure reviewable |
| M1 — Real channel | T3; channel/build commit | Local shell window under Doom Term identity; explicit feature policy; no public binary |
| M2 — Local product boundary | T4.1 then T4.2/T4.3; several module-sized commits | Closed caller inventory, excluded service code, preserved native features, privacy evidence |
| M3 — Independent identity | T5; assets/identity and installer commits | Trademark/source audit passes on all package layouts |
| M4 — Material system | T6.1 then T6.2; renderer policy then chrome commits | Formal A/B evaluation completed; retired/nixed to preserve modern ergonomics and maintain upstream rebase simplicity |
| M5 — Honest plate | T7.1 and T7.2, then T7.3/T7.4 | Pure parity, real local data, native WarpUI element integration, zero deadlocks |
| M6 — Three-platform candidate | T8/T9/T10.1; CI and packaging commits | Multi-platform packaging and reclaimed public CI matrix verified |
| M7 — Published v1 | T10.2; version/source/release metadata commit | v1.0.0 Release candidate, SHA256 checksums, and verified docs |

**Critical path:** M0 → M1 → compile closure/local feature preservation in M2 → native
integration of materials/plate → all-platform candidate validation → publication.
The largest uncertainty is M2, not drawing the plate. Do not defer it until after visual polish.

**Parallelizable work after M1:** original branding/assets; pure plate geometry/parity;
local history adapter; early CI/setup/package dry runs. They consume the agreed identity,
field contract and feature boundary, but do not require each other's implementation.
Shared startup, workspace and renderer edits remain coordinated; integration waits for the
upstream task's interface rather than competing edits to those files. Execution method is
chosen separately; this plan does not launch agents or worktrees.

**Commit discipline:** use reviewable component commits; no requirement that every temporary
checkpoint passes independently. Before a PR, run the repository's prescribed affected
tests → lint/build → formatter order. Do not treat local checks as a substitute for CI.

## 12. Risks, triggers and remaining decisions

| Rank | Risk / trigger | Mitigation and release consequence |
| --- | --- | --- |
| 1 | Cloud/AI types are deeply coupled to retained terminal/workflow flows; removing a module breaks local behavior | T4 caller classification and pure-type extraction; update each ledger path; delay release rather than ship runtime-only removal or delete kept features |
| 2 | A new Cargo edge/default/release flag reintroduces service behavior | Closed runtime list, explicit Cargo features, per-target dependency/module audit and startup/network tests on upstream merges |
| 3 | Wrong session attribution or cumulative totals presented as current context | Identity/provenance model, ambiguity tests, unsupported fields `--`; never infer by recency |
| 4 | Cross-platform cold builds exceed runner disk, memory or timeout | Measure at M1/M6, reduce debug data, split caches/jobs and limit concurrency; any paid runner change needs an explicit budget decision |
| 5 | Round masks/shadows survive through a renderer bypass or new backend | Final-submission tests and native surface inventory; add one generic seam rather than scattered view edits |
| 6 | Packaging depends on private/downloaded upstream assets or embeds upstream identity | Public clean setup, complete resource manifest, brand scan and install smoke before distributing candidates |
| 7 | Visual baseline is misrepresented or loosened to pass | Separate shell-study, exact plate raster and native GPU metrics; retain source hashes and reviewed threshold changes |
| 8 | History scanning leaks prompts, stalls UI or grows without bound | Background bounded capture, no transcript logging/storage, cancellation and adversarial fixture tests |
| 9 | Unsigned builds cannot run under recipient policy | Document expected OS behavior, test downloaded packages, offer source builds; if target users require signing, make certificates/notarization a separately costed prerequisite |
| 10 | Source/asset provenance incomplete | Package source and notices tied to the tag; replace unverified assets before publication; never copy BUSL reference implementation |
| 11 | Upstream merge accumulates broad special cases | Weekly ledger review, component ownership, reviewed compatibility smoke, no unrelated refactors; surface rising shared-file count |
| 12 | A platform lacks interactive display or architecture coverage | Record verification as incomplete; obtain exact-candidate native evidence before claiming support |

**Assumptions requiring maintainer review, without blocking this plan:**

1. Approve the explicit keep/remove inventory in §4, especially local notebook/editor
   retention and removal of voice/remote-server conveniences. New scope changes get a
   corresponding task and ledger update before implementation.
2. Confirm the proposed identity and support/architecture matrix before the first persistent
   profile or released installer. No ownership of a new domain is assumed.
3. Confirm the explicitly requested `plate.js` field/geometry contract rather than the
   alternate `plate.doom.js` presentation. Default is the handoff's named reference.
4. Accept unsigned/ad-hoc, manually updated v1 and its OS-policy limitations. Paid signing,
   universal DMG, additional architectures and a GitHub updater are not included.
5. Accept unknown `CONTEXT`, `USAGE`, sandbox/activity values when provider records cannot
   substantiate them. This is required honesty, not permission to fabricate support.

**Not verified during planning:** compilation, exhaustive downstream exclusion closure,
live provider record coverage, startup network behavior, public dependency downloads,
GPU parity, native installers, supported OS floors, runner capacities or signing behavior.
Each has an explicit implementation gate above. No success claim depends on an unrun build.

**Scope remains closed:** archived subsystems and the local-control sidecar are not future
tasks hidden in this plan. A later request for them needs its own scope decision.
