# Feature inventory

What a shipped Doom Term build keeps, what it excludes, and — measured rather
than estimated — what excluding each thing actually costs.

The keep/remove column is the decision. The coupling column is why some of those
decisions are a morning's work and others are the bulk of the project.

**Status:** implementation follows the plan’s keep/remove defaults under the maintainer’s
resume instruction. M2 remains incomplete. The
measurements are real, taken at `e7c864a61` with
`script/doomterm/caller-inventory.py`.

## Decisions

| Feature | v1 | Notes |
| --- | --- | --- |
| PTY, shell integration, blocks, scrollback, command history | **Keep** | The product |
| Tabs, splits, windows, keyboard navigation, command palette | **Keep** | Local actions stay registered and discoverable |
| Themes, fonts, terminal colors, native editor/input behaviour | **Keep** | User selection persists; Four Materials governs owned chrome only |
| Local workflows, arguments, aliases | **Keep** | Existing local files execute with no Drive and no account |
| Built-in workflow catalog | **Keep, offline only** | Bundled definitions; no runtime catalog fetch |
| Shell completions, native suggestions | **Keep local providers** | No hosted prediction, classifier download or AI correction |
| SSH as a user shell command | **Keep** | The user's own process may use the network |
| Local launch configurations, session restore | **Keep** | No team or workspace account requirement |
| Local notebooks/editor/file browsing used by terminal flows | **Keep where present** | Audit coupling; no redesign |
| Local logs, OS-level crash diagnostics | **Keep** | Local only, never uploaded |
| Claude Code / Codex run by the user in a PTY | **Keep as ordinary programs** | The plate reads local evidence; it does not manage or authenticate them |
| Account, login, team/org management, billing, referral | **Remove** | No routes, actions, models, credentials or listeners |
| Drive and team preference sync | **Remove service and UI** | Keep only separately identified local data types |
| Agent Mode, hosted models, Oz, remote indexing, agent tools, MCP | **Remove** | No AI or service implementation dependency |
| Voice input, server-generated command features | **Remove** | No microphone prompt, no remote transcription |
| Analytics, off-device traces, queued telemetry files | **Remove** | No collection or export; inert compatibility macros allowed |
| Sentry and crash uploading | **Remove** | No SDK, native framework, helper or uploader |
| Warp remote-server provisioning, session relay, sharing | **Remove** | No automatic remote binary provisioning |
| `local_control`, agent CLI, TUI, wasm artifacts | **Do not ship in v1** | Source retained upstream |
| Autoupdate and remote changelog | **Remove** | Manual download; local release notes |

Already confirmed absent from the Doom Term dependency graph at `e7c864a61`:
Sentry, `sentry-log`, `minidumper`, `crash-handler` and `voice_input`. Those are
optional upstream and the Doom Term feature set does not select them, so the
work there is to keep them out, not to get them out.

## What exclusion actually costs

`callers` counts files outside a module that reference it. `retained` counts how
many of those sit in areas Doom Term keeps — terminal, workspace, settings,
workflows, themes, search, persistence and the shared UI components. A reference
from retained code cannot just be deleted; it has to be classified as local
logic to keep, hosted logic to exclude, or a shared type to extract.

| Module | Own files | Own lines | Callers | In retained areas |
| --- | ---: | ---: | ---: | ---: |
| `ai` | 583 | 305,466 | 378 | **269** |
| `server` | 61 | 40,624 | 499 | **170** |
| `auth` | 17 | 6,990 | 206 | **85** |
| `remote_server` | 24 | 10,293 | 46 | 20 |
| `crash_reporting` | 5 | 1,242 | 10 | 3 |
| `autoupdate` | 9 | 3,782 | 8 | 3 |
| `local_control` | 15 | 5,332 | **2** | 1 |
| `onboarding` | 0 | 0 | **12** | 7 |

Regenerate with `python3 script/doomterm/caller-inventory.py`.

### Reading the table

Two groups, and they need different treatment.

The reference counts include both app-module and external-crate imports. Onboarding
is an external crate with twelve referencing files, not a module with zero callers.
Remote-server references also cross the crate boundary. These counts are a lexical
upper bound, not a resolved compiler closure or an estimate of implementation effort.

The first boundary excludes `local_control` from both the app and the terminal’s
transitive CLI dependency. The remaining service boundaries require classifying
references as local logic to preserve, hosted logic to exclude, or shared types to
extract. The compiler and production dependency graph determine completion.

### What this does not say

It does not say the work is 354 files of work for `ai`. Many references will
turn out to be a single import that disappears when a shared type moves, and a
handful will turn out to be load-bearing in ways that need a real design
decision. It also does not say the compiler agrees: the authoritative list is
whatever `cargo check` reports once the module roots are gated, and producing
that list requires building. This inventory says where to look and roughly how
much is there.

## Local workflows are a real preservation problem

There is an existing `LocalWorkflows` model, but the workflow views and types
import AI, Drive and cloud models. "Gate all of Drive" is therefore not an
adequate step: it would take local workflow editing and execution with it. The
plan's answer is to extract the pure workflow values, argument parsing and local
loading from the cloud variants, and build a narrow local workflow adapter if
the existing editing view needs Drive types too widely. Existing local
edit/run/alias behaviour and its round-trip tests have to keep passing.

## Retained compatibility types

Some hosted-looking types are load-bearing for local storage. `persistence`
depends directly on `ai_types`, and retaining inert serialized types avoids an
unnecessary database rewrite. Each retained type-only exception gets named here
with its package and reason as it is confirmed, rather than being waved through
by substring.

| Package | Retained because | Confirmed |
| --- | --- | --- |
| `ai_types` | `persistence` serializes these; excluding them forces a database migration for no privacy gain | Audited 2026-09-21 |

An entry here is a claim that the type carries no transport or credential
behaviour. That claim needs checking per type, not per package name.

The `ai_types` audit covered its manifest and all four source files (229 lines).
They define identifiers, serializable enums/structs, parsing, display and JSON
conversion. The manifest depends only on anyhow, serde, serde_json, thiserror and
uuid. No transport, credential lookup, process launch or filesystem IO is present.
This exception does not extend to the separate `ai` package.

### Telemetry compatibility (2026-09-21)

The local UI core retains the `Event`/`EventPayload` data shapes for existing code and
an empty `flush_events` result for test compatibility. It has no event store, recorder
functions, focus tracker or background recording task. The core event traits and
app event enums remain for type compatibility; local macro variants type-check their
arguments without evaluating them. The app's Rudder payload/collector modules are
excluded. This source boundary does not replace packaged symbol/file/network checks.
