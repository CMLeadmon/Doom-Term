# Handoff: write the Doom Term implementation plan

## Your task

Produce **one implementation plan** covering this project end to end — first
commit through published GitHub release. Write it to
`docs/doom-term/implementation-plan.md`.

**Write the plan. Do not write product code.** You may run read-only commands to
verify claims, and you should. Ask the user before you start if any decision
below is genuinely ambiguous; otherwise proceed under the stated assumptions and
label them.

---

## The project

`/var/home/cleadmon/Projects/Doom Term` is a fork of `warpdotdev/warp` pinned at
`a0f5eb31a`. Doom Term takes Warp's Rust terminal core and GPU renderer, dresses
it in a brutalist hardware aesthetic ("Four Materials, and No Fifth"), strips the
cloud, and ships it as a self-published GitHub release for Linux, macOS and
Windows.

The aesthetic and the status plate are specified and prototyped in
[`mockups/`](../../mockups/) — a non-shipping design study with generated
evidence. `mockups/plate.js` is the archived prototype's canvas renderer copied
byte for byte; `mockups/README.md` says what is real and what is a stand-in.
Read both before planning the UI work.

---

## Decisions already made — do not relitigate

1. **Track upstream.** Keep merging `warpdotdev/warp`. Prefer additive,
   seam-shaped changes over invasive rewrites of shared views. Merge tax is
   accepted; unbounded divergence is not.
2. **Rip out cloud and AI.** Remove Warp's account, Drive, Oz, hosted models,
   telemetry, Sentry, and Warp-server autoupdate from what ships. The status
   plate's `AGENT` / `CONTEXT` / `USAGE` fields are fed by
   `crates/warp_harness_usage`, which parses Claude Code and Codex JSONL session
   histories **locally** — no server, no account.
3. **All three platforms in v1.** Linux, macOS, Windows.
4. **Doom Term scope is the plate plus the Four Materials reskin.** Nothing else
   ports from the archived prototype. No Scratchpad, no ContextGraph, no
   InterAgentMessageBus, no Verification Panel.

---

## The central tension — resolve it explicitly in §1 of your plan

Decisions 1 and 2 pull against each other. Deleting `warp_server_client` and the
AI subsystem touches a large fraction of `app/src` and makes every future merge
painful. Deleting nothing leaves the cloud in the binary.

**The resolution I believe is correct, which you should adopt or argue down with
evidence: make Doom Term a *channel*, not a patch.**

Warp already ships a first-class `oss` channel — `app/Cargo.toml:3`
(`default-run = "warp-oss"`), `app/src/bin/oss.rs`, `app/channels/oss/`, and all
three bundle scripts accept `--channel oss` (`script/linux/bundle:226`,
`script/macos/bundle:430`, `script/windows/bundle.ps1:157`). The OSS channel
already drops Sentry by design.

Feature enablement is overwhelmingly **runtime**, not compile-time:
`app/src/features.rs:16` `enabled_features()` unions
`ChannelState::additional_features()`, `RELEASE_FLAGS`, and a set of
`#[cfg(feature = ...)]` entries. `RELEASE_FLAGS`
(`crates/warp_features/src/lib.rs:1090`) contains **seven** flags. Nothing
cloud-, AI-, Drive- or Oz-related is in it. Those features are turned on from
Warp's server, which a Doom Term build will never reach.

So the bulk of "rip out the cloud" is a **channel definition the fork owns and
upstream will never touch**, not a diff against shared files. Plan around that:
add a `doomterm` channel (its own `bin`, `app/channels/doomterm/`, its own
`additional_features` set and `ChannelConfig`), and express as much of the fork
as possible there.

Then be honest about what that does *not* cover, and name every remaining
invasive edit individually. At minimum it does not cover: code paths that run
unconditionally rather than behind a flag; the sign-in/onboarding surfaces;
network clients that get constructed regardless; and the reskin itself. Your plan
must carry a running **invasive-diff inventory** — every file you will edit that
upstream also edits, with a one-line justification for each. That inventory is
the artifact that keeps decision 1 true over time.

---

## Ground truth — verified against this tree at HEAD

Cite these rather than re-deriving them. Re-check anything you intend to build
on; the commands are cheap.

### Repository state
- Doom Term's entire delta from upstream is **one commit** (`caebaa5ec`):
  `git diff --stat a0f5eb31a HEAD` → 25 files, +4,649/−78, all of it `README.md`
  and `mockups/`. No product code has been written.
- **`README.md` describes a fork that does not exist yet.** It claims in the
  completed past tense that telemetry is "removed or inert" and that sign-in is
  "completely bypassed". Neither is true: 422 `.rs` files reference telemetry,
  `crates/warp_core/src/telemetry.rs` and `crates/warpui_core/src/telemetry/`
  are intact, `sentry`/`sentry-log` are still dependencies
  (`app/Cargo.toml:144,175`), and `crates/warp_server_auth/` is untouched.
  Branding is likewise untouched — `APP_NAME=WarpOss`,
  `app/channels/oss/dev.warp.WarpOss.desktop`, Warp icons, and the
  `warp://`/`warposs://` URL schemes (`crates/warpui/src/browser.rs:21-23`).
  Your plan must include closing this gap, and must state whether the README
  gets corrected now or the code catches up to it.
- Branch `design/doom-term-sidecar-mockup` is byte-identical to `main`.
- The tree has never been built here (no `target/`). Toolchain is pinned to
  Rust 1.92.0 (`rust-toolchain.toml`). 88 workspace members. Budget for a long
  first build and say so in the plan.

### Licensing and trademarks
- App and most crates are AGPL-3.0; `warpui` and `warpui_core` are MIT
  (`FAQ.md:93`). Forking is explicitly permitted (`FAQ.md:131`).
- AGPL's source-offer obligation is satisfied by the public repo.
- **Trademark stripping is a prerequisite for distributing binaries, not
  polish.** Schedule it before the first release, not after.

### Release pipeline (what you are inheriting)
- `.github/workflows/cut_new_releases.yml` — cron `0 8 * * *`; `dev` nightly,
  `preview`/`stable` weekly. Calls `create_release.yml` per channel.
- `.github/workflows/create_release.yml` — 3,097 lines, 27 jobs. `prepare_release`
  tags, opens the GitHub release (`softprops/action-gh-release`), opens a Sentry
  release. Then per-platform jobs bundle and upload.
- Entry point is `script/bundle` (33 lines), dispatching on `uname -s` to
  `script/macos/bundle`, `script/linux/bundle`, `script/windows/bundle.ps1`.
- Artifacts: macOS per-arch + universal DMG (cargo-bundle + `create-dmg`,
  Developer ID codesign + `notarytool`); Linux AppImage/.deb/.rpm
  (`create_release.yml:1137`) plus signed Arch packages via
  `.github/actions/bundle_arch_package`; Windows Inno Setup installers
  (`script/windows/*.iss`) with Azure Trusted Signing; a wasm web bundle.
- Everything goes to **both** `gh release upload` and GCS
  (`warp-releases/<channel>/<tag>`), plus symbols to Sentry.

### What makes that pipeline fork-hostile, and what doesn't
- **Fork guards:** `if: github.repository_owner == 'warpdotdev'` appears in 17
  workflow locations including `cut_new_releases.yml:33` and `ci.yml:53`. Until
  these go, a fork's scheduled release is a silent no-op.
- **The real pipeline runs in a private repo.** `repo-sync.yml` syncs
  `warpdotdev/warp-internal` ↔ `warpdotdev/warp`, and
  `.github/actions/prepare_environment/action.yml:104` gates the channel-config
  SSH key on `github.repository == 'warpdotdev/warp-internal'`.
- **Upstream's public GitHub releases carry no binaries.** Verified via
  `gh api --paginate repos/warpdotdev/warp/releases` → 56 releases, exactly one
  with assets, and that one is a screenshot dump. So there is no upstream
  precedent to copy for GitHub-release distribution; you are building it.
- **But the private-config dependency degrades gracefully by design:**
  `script/install_channel_config` exits 1 without SSH access and
  `prepare_environment` calls it as `|| true` (`:121`), with the comment at
  `:101-102` — *"elsewhere (mirrors, fork PRs) this is a no-op and
  install_channel_config falls back gracefully."*
- **Signing is optional.** Windows `$SIGN_TOOL_CMD` defaults to `''` —
  *"When empty, the installer is built without signing"* (`bundle.ps1:34`).
  macOS falls back to ad-hoc signing with no cert (`script/macos/bundle:916`).
  CI already passes `--nosign` for some artifacts (`create_release.yml:476`).
  Plan for unsigned v1 on macOS/Windows and say plainly what users will see
  (Gatekeeper and SmartScreen warnings), or price the certificates.
- **Runners cost money.** `macos-26-xlarge` and every `namespace-profile-*` are
  paid. Re-target to `ubuntu-latest`/`macos-latest`/`windows-latest` and expect
  the 60-minute `timeout-minutes` values — tuned for warm caches on large
  machines — to be too short for cold builds.
- **No autoupdate on this channel.** `app/src/autoupdate/mod.rs:782` bails with
  *"Local, integration, and open-source channel binaries don't support
  autoupdate"*, and the URL builder is `unreachable!()` at `:1154`. Decide: ship
  without updates in v1, or build a GitHub-releases updater. Say which.

### The reskin — the part with real surface area
- **Themes are colour-only.** `app/src/themes/theme.rs` is `ColorU` fields
  throughout (see `PromptColors` at `:566`). There is no geometry in the theme.
- **Geometry is per-call-site.** `corner_radius` appears at **719 sites in
  `app/src`** (top clusters: `settings_view` 25 files,
  `ai/blocklist/inline_action` 11, `view_components` 10, `auth` 9). Editing
  those individually would be the single largest source of merge conflict in the
  project and would violate decision 1.
- **There is a choke point.** `Rect::with_corner_radius`
  (`crates/warpui_core/src/scene.rs:677`) and `Rect.corner_radius`
  (`:103`, `:113`) are where every radius lands. A clamp there, gated on the
  Doom Term channel, turns 719 edits into roughly one. `warpui_core` is MIT.
  Evaluate this. If you reject it, say why and price the alternative.
- Bevels are additive (a new primitive or a container wrapper), not a clamp.
  Plan them separately from the radius kill.

### The plate's data, and where it can honestly come from
- `mockups/plate.js:430` `DEFAULT_STATE` is the field contract: `context`,
  `usage`, `sandbox`, `agent`, `agentName`, `path`, `branch`, `chips`, `table`,
  `waiting`. Note its comments: `'--'` for *"unknowable"*, and `waiting` is
  *"sessions that have stopped — never invented"*.
- **`crates/warp_harness_usage/`** is the real feed for `agent`, `agentName`,
  `context`, `usage` and `table`: `claude.rs`, `codex.rs`, `capture.rs`,
  `PARSER_VERSION = 2`, all local JSONL parsing.
- `crates/repo_metadata/` is the likely feed for `branch`.
- For every remaining field, the plan must name a real source or specify that it
  renders `--`. **No field may be populated by a plausible-looking constant.**

### Rendering the plate — constraints that rule options out
- **Warp has no webview.** Zero hits for `wry|CEF|WKWebView|webkit2gtk|webview`
  across the workspace manifests. `crates/warpui/src/browser.rs` is 28 lines of
  HTML-escaping and URL-scheme allowlisting.
- **Warp has no plugin or extension API.** Zero hits for
  `pub trait Plugin|plugin_api|extension_api|pub trait Extension`.
- Therefore `plate.js` cannot be embedded; it must be reimplemented as a
  `warpui` view. `warpui` can host it — `WindowStyle::Pin => WindowLevel::AlwaysOnTop`
  (`crates/warpui/src/windowing/winit/window.rs:648`) if a separate pinned window
  is ever wanted.
- Port `plateSpec()`'s geometry as data, not as redrawn constants, and re-verify
  the port against `mockups/evidence/metrics.json` (current baseline: 84.96% of
  pixels within 8 levels, MAE 11.41). The plan must specify how plate parity is
  measured in CI or in a check script.

### Local control — investigated, and deliberately not the answer
`crates/local_control/` is a real versioned protocol (authenticated loopback
HTTP at `/v1/control`, 84 actions, all `Implemented`). It is **not** a shortcut
for the plate: payloads are identity-only (`session_values()` at
`app/src/local_control/handlers/metadata.rs:915` returns ids, indices and
`is_active` — no title, cwd, branch, command, agent or token counts); there is
no event stream; and it is off in shipped builds (`LocalControlMode` defaults to
`Disabled` for non-dogfood channels at
`app/src/settings/local_control.rs:39-45`, and `FeatureFlag::WarpControlCli` is
in `DOGFOOD_FLAGS`, not `RELEASE_FLAGS`, at
`crates/warp_features/src/lib.rs:1027`). Do not design the plate around it. Note
it as optional future surface only.

---

## What the plan must contain

Size each section to its actual complexity. Ordering below is the order of work.

1. **Strategy and the invasive-diff budget.** Resolve the central tension. Define
   the channel-shaped approach, the seams, and the rule for when an invasive edit
   is allowed. Establish the invasive-diff inventory as a living document.
2. **Upstream-merge workflow.** Cadence, who runs it, how conflicts in the
   inventory files are handled, and how a merge is verified.
3. **Channel bring-up.** The `doomterm` channel end to end: binary, channel
   assets, `ChannelConfig`, `additional_features`, paths/app-id, URL scheme,
   and a first successful local build of it. This is the milestone that unblocks
   everything else.
4. **Cloud and AI removal.** Ordered, each step with its verification. Separate
   *disabled by flag* from *removed from the binary* and say which each item is.
   Include an explicit **keep/remove inventory** of Warp features for the user to
   sign off — "superfluous" is undefined and is the user's call, not yours.
   Terminal-native features (blocks, command palette, workflows, themes) are
   presumed **kept** unless the user says otherwise; put them in the inventory.
5. **Trademark and branding strip.** Names, icons, URL schemes, desktop/plist
   entries, installer strings, and the in-app surfaces. Gate the first release
   on this.
6. **The Four Materials reskin.** Radius kill at the choke point, bevel
   primitive, the palette as a Doom Term theme, and the chrome. Say what is
   token-driven and what is per-view.
7. **The status plate.** The `warpui` view, its layout home in the window, the
   `warp_harness_usage` feed, the honest-data rule, and parity verification
   against `mockups/evidence/`.
8. **Test and verification strategy.** What runs locally, what runs in CI, and
   what can only be checked by hand on each OS.
9. **CI.** Reclaim `ci.yml` for the fork: guards, runners, timeouts, cost.
10. **Release pipeline.** A fork-owned release workflow producing Linux
    (AppImage/.deb/.rpm), macOS (DMG), Windows (Inno installer) artifacts,
    attached to a GitHub release. Signing posture, versioning and tag scheme,
    release notes, and the update story.
11. **Milestones.** Sequence the above into shippable increments with a clear
    definition of done for each. Identify the critical path and what can run in
    parallel.
12. **Risks and open questions.** Ranked, each with a trigger and a mitigation.

---

## Standards for the plan itself

- **Cite `file:line` for every claim about the code**, and verify it against this
  tree before writing it down. Facts in this handoff are good as of HEAD
  (`caebaa5ec`); spot-check the ones you build on.
- **Distinguish verified from assumed.** Mark assumptions as assumptions. The
  user has said explicitly that honesty is rewarded — a plan that says "I could
  not verify X without a build" is worth more than one that asserts X.
- **No fabricated capability.** This project's own history is the reason: an
  earlier Doom Term prototype shipped a "Multi-Lens Verification" panel that
  hardcoded `verdict: 'APPROVED'` and four always-PASS lenses, and an agent
  telemetry readout that produced `CONTEXT: 4%` and a token table from a
  hardcoded constant before a single command had been run. Every number the plate
  shows must trace to a real source, or render `--`.
- **YAGNI.** Decision 4 is narrow on purpose. If you find yourself planning a
  feature, check it against the four decisions first.
- Estimates: prefer sequencing and dependencies over hour counts. Where you do
  estimate, say what the estimate assumes.

---

## Traps, found the hard way

- **No game vocabulary anywhere** — in code, identifiers, comments, UI strings or
  docs. Doom Term resembles Doom in *pixels only*. The mugshot slot shows the
  active AI agent, not a marine. Purge any `MARKS.marine`-style leftovers if the
  plate port carries them across.
- **The plate's geometry is measured, not invented.** It derives from Doom's own
  `st_stuff.c` offsets, and the plate is grey, not brown. `plateSpec(480)` must
  stay a generalisation of those measurements rather than a redraw — see the
  comment at `mockups/plate.js:475`.
- **Agent-busy is continuity, not recency.** Idle agents repaint their footers on
  a timer, so any "is this agent working" test built on recency will pulse
  forever. Design the plate's activity signal accordingly.
- **Archived-prototype context is archived.** Notes about `src-tauri/`,
  `backend/`, `crates/doom-term-pty/`, the Vite dev server and the AppImage
  toolbox describe
  [CMLeadmon/Doom-Term--deprecated](https://github.com/CMLeadmon/Doom-Term--deprecated),
  **not this repo**. Those files do not exist here. Do not send anyone looking
  for them.
- **`nodeterm` is BUSL-1.1.** Its context/usage implementation is a useful
  reference for technique only. Never copy its code or its comments.
- **A green local gate is not a green CI.** Formatting and lint live in CI jobs
  that local scripts do not run. Whatever local verification the plan defines,
  state explicitly which CI checks it does *not* cover.

---

## Out of scope

Everything beyond the four decisions. Specifically: Scratchpad, ContextGraph,
InterAgentMessageBus, the Verification Panel, the workspace picker, any
reimplementation of Warp's agent features against BYO API keys, the wasm/web
build, and the `local_control`-driven sidecar. Note any of these you think the
user should reconsider in §12 as an open question — do not plan them.
