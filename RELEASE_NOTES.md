# Doom Term v1.1.7 Release Notes

Doom Term v1.1.7 adds Replay, an optional theme that loops real gameplay recorded from the shareware game, and lets the remote agent-status helper report from SSH terminals it could not open before.

- **Replay theme pack (optional).** `doomterm-replay-theme.zip` is a theme pack, not part of the application, and the first that is a recording instead of a drawing: about eleven seconds of the shareware game's own built-in demo, a corridor of steps, a pistol fight, an explosion, an imp that walks at you and a demon that charges, shown at 30 percent opacity behind the text with a screen melt that closes the loop. The frames were drawn by an unmodified Chocolate Doom playing `DOOM1.WAD`, the freely distributable shareware data file, so the art belongs to id Software; Doom Term is an independent project and is not affiliated with, endorsed by or sponsored by id Software or ZeniMax Media. Extract the zip into the themes folder (Linux: `~/.local/share/doomterm/themes/`) so that a `replay` folder ends up inside it, then choose Replay in Settings, Appearance, Themes. It keeps the standard grey plate and holds its frames decoded, about 60 MiB more memory while the theme is active. At the shipped opacity the text keeps at least 9:1 contrast against the brightest tenth of the picture. [Replay theme pack](https://github.com/CMLeadmon/Doom-Term/blob/v1.1.7/docs/doom-term/replay-theme.md) explains where the footage comes from, the measured cost and how to rebuild it.
- **Big Fucking Replay theme pack (optional, attached after the release).** `doomterm-bfr-theme.zip` is a second recording in the same form as Replay: about nine seconds of real gameplay, all indoors, in which a player fires the BFG 9000 as fast as it will go into a crowd of two Cyberdemons, four Barons and a swarm of Demons, Imps, Sergeants, Cacodemons and Lost Souls, running, strafing and whipping round at about Replay's pace, shown at 25 percent opacity behind the text with a screen melt that closes the loop. Its supporting colours are the BFG's own greens and it keeps the standard grey plate. The frames were drawn by an unmodified Chocolate Doom playing a crowded copy of the secret map of episode 2, built from the full game's `DOOM.WAD`. That data file is not freely redistributable and is not in the zip: only the pictures are. The art belongs to id Software; Doom Term is an independent project and is not affiliated with, endorsed by or sponsored by id Software or ZeniMax Media. Extract the zip into the themes folder (Linux: `~/.local/share/doomterm/themes/`) so that a `bfr` folder ends up inside it, then choose Big Fucking Replay in Settings, Appearance, Themes. It holds its frames decoded, about 55 MiB more memory while the theme is active, and at the shipped opacity the text keeps at least 8:1 contrast against the brightest tenth of the picture. The blasts are bright flashes, which the pack's README says; lower `opacity` or choose another theme if they bother you. [Big Fucking Replay theme pack](https://github.com/CMLeadmon/Doom-Term/blob/main/docs/doom-term/bfr-theme.md) explains where the footage comes from, the measured cost and how to rebuild it.
- **Every theme pack is a release asset.** Redsky, Blue Highway, Canopy and Replay are each built from the tagged source by the publish job and have their own line in `SHA256SUMS.txt`, and so does Big Fucking Replay. Blue Highway and Canopy were attached by hand to v1.1.6, and Big Fucking Replay to v1.1.7 after it was published; the publish job builds it from the next tag on.
- **Status over root-owned SSH terminals.** The in-band agent-status helper (now version 3) no longer goes silent when an SSH session's terminal is owned by root with mode 0600, as under Tailscale SSH. On Linux it writes through the descriptor the agent already holds, which needs kernel 5.6 or newer and `kernel.yama.ptrace_scope` set to 0; where that is refused it still reports `permission_denied`. Claude Code's own status bar no longer repeats the helper's Context and Session line, which appear on the Doom Term plate. Install the updated helper on each SSH host.
- **Remote reporting diagnostics.** The helper has a read-only setup check and explicit `--diagnose` delivery results for missing or inaccessible SSH terminals. Detected Linux Codex 0.160.0 shared-daemon hooks withhold reports to preserve pane isolation and need `--no-daemon`. Invalid agy quota resets no longer crash reporting, and an effort-only model object no longer selects unrelated quota. [Remote agent setup](https://github.com/CMLeadmon/Doom-Term/blob/v1.1.7/docs/doom-term/remote-agent-status.md) covers supported modes, terminal ownership checks and verification limits.

This release changes no application code: the Doom Term builds are made from the same application sources as v1.1.6, and what is new is the theme packs, the remote helper scripts, the documentation and the checks around them. Replay was exercised live on Linux in an isolated headless lab, first with the v1.1.5 build and then with the published v1.1.7 build and the published zip: the theme loads from the themes folder, ten screenshots taken a second apart show ten different backgrounds with each, and resident memory rose by 58.5 MiB (219.8 MB to 279.7 MB) and by 60.9 MiB (217.6 MB to 280.0 MB). Big Fucking Replay was exercised the same way after the release, with the published v1.1.7 build and the zip: ten screenshots taken a second apart show ten different backgrounds, and resident memory rose by 55 MiB (196.3 to 251.7 MiB). The animation's frame rate and GPU cost on a real display have not been measured, and the themes folder on macOS and Windows is not yet documented.

**Install and update manually.** Save your work, close Doom Term, download the asset for your platform, and verify it against `SHA256SUMS.txt` from this release. Linux has an x86-64 tarball; macOS has an Apple Silicon app bundle and DMG; Windows has an x86-64 installer and standalone zip. Release builds are unsigned. macOS may require a Gatekeeper override for software you trust; Windows may show an unknown-publisher warning. Doom Term does not update itself or submit telemetry. The source and license files are in the [v1.1.7 tag](https://github.com/CMLeadmon/Doom-Term/tree/v1.1.7). This fork is based on upstream Warp commit `a0f5eb31a2ba46e46898f41d8c0e256ae7d20dda`.

---

# Doom Term v1.1.6 Release Notes

Doom Term v1.1.6 lets a theme recolour the bottom status plate's stone, and adds Redsky, an optional animated theme that uses it.

- **Plate stone.** A theme file can carry a `plate_stone` colour, the mid tone of the plate's stone. The plate derives its nine stone colours from it and keeps its bevels, wells, numerals, and labels as they are. A theme without the key paints the plate exactly as before, and a value that is not a valid hex colour is ignored without rejecting the theme.
- **Redsky theme pack (optional).** `doomterm-redsky-theme.zip` is a theme pack, not part of the application: a black sun behind drifting storm clouds, a panning skyline, and two lightning strikes, drawn at 10 percent opacity behind the text, with a wine-maroon plate. Extract it into the themes folder (Linux: `~/.local/share/doomterm/themes/`) so that a `redsky` folder ends up inside it, then choose Redsky in Settings, Appearance, Themes. The animation holds every frame decoded, about 58 MiB more memory while the theme is active. [Redsky theme pack](https://github.com/CMLeadmon/Doom-Term/blob/v1.1.6/docs/doom-term/redsky-theme.md) explains the layout and how the animation is generated.
- **Blue Highway and Canopy theme packs (optional, attached after the release).** `doomterm-bluehighway-theme.zip` and `doomterm-canopy-theme.zip` are two more theme packs in the same form as Redsky, and need no application changes. Blue Highway is a tractor-trailer that holds its place on a West Virginia ridge road at misty dawn, with dark green ridges, a steel arch bridge that crosses the sun, a barn, utility poles and a slate-navy plate. Canopy is the inside of an Amazon forest, with light shafts, a scarlet macaw, a swinging spider monkey, blue morphos, a busy floor and a moss-green plate. Both are drawn at 10 percent opacity behind the text. Extract either into the themes folder (Linux: `~/.local/share/doomterm/themes/`) so that a `bluehighway` or `canopy` folder ends up inside it, then choose it in Settings, Appearance, Themes. The plate tint needs this release or later. Each holds its frames decoded, about 60 MiB more memory while active, and was exercised live with the published v1.1.6 build on Linux. [Blue Highway and Canopy theme packs](https://github.com/CMLeadmon/Doom-Term/blob/main/docs/doom-term/blue-highway-and-canopy-themes.md) explains the layout, the measured cost and how the animations are generated.

Redsky and the plate stone were exercised live on Linux in an isolated lab: with the pack the stone is wine-maroon and the bevels stay grey, the v1.1.5 binary on the same pack keeps a grey plate, and a theme without the key matches v1.1.5 pixel for pixel. The animation's frame rate and GPU cost on a real display have not been measured, and the themes folder on macOS and Windows is not yet documented.

**Install and update manually.** Save your work, close Doom Term, download the asset for your platform, and verify it against `SHA256SUMS.txt` from this release. Linux has an x86-64 tarball; macOS has an Apple Silicon app bundle and DMG; Windows has an x86-64 installer and standalone zip. Release builds are unsigned. macOS may require a Gatekeeper override for software you trust; Windows may show an unknown-publisher warning. Doom Term does not update itself or submit telemetry. The source and license files are in the [v1.1.6 tag](https://github.com/CMLeadmon/Doom-Term/tree/v1.1.6). This fork is based on upstream Warp commit `a0f5eb31a2ba46e46898f41d8c0e256ae7d20dda`.

The GUI changes were exercised live on Linux. macOS and Windows GUI behavior depends on the release builds and was not exercised interactively.

---

# Doom Term v1.1.5 Release Notes

Doom Term v1.1.5 steadies the bottom status plate and makes the agent mark animate at a regular 20 frames per second while an agent works.

- **Stable readings.** WAITING holds an agent through brief pauses and missed process checks. CONTEXT and five-hour USAGE keep the last confirmed reading through incomplete records, transient read failures, and idle periods. A new agent or conversation starts with fresh readings, and USAGE expires when its rate-limit window resets. Unavailable values still show a dash.
- **Smoother mark.** The working mark schedules its own repaint every 50 ms without rebuilding the workspace for every animation frame. Repository diff checks run separately from agent detection, with a timeout.
- **Agent records.** Claude Code's zero-usage error record no longer hides the last real context value. Codex context and five-hour usage can come from different events in the same rollout, and a new Codex process no longer borrows an older live session in the same directory. The remote status scripts accept Python 3.6 and preserve confirmed readings across transient failures.
- **Remote status.** In-band reports remain available while their SSH command runs, up to six hours, and carry a conversation identity and usage reset time. [Remote agent setup](https://github.com/CMLeadmon/Doom-Term/blob/v1.1.5/docs/doom-term/remote-agent-status.md) explains the updated helper and configuration.

The [v1.1.5 evidence dossier](https://github.com/CMLeadmon/Doom-Term/blob/v1.1.5/evidence.html) contains before/after plate measurements, screenshots, test results, and the limits of the verification. Its lab agents reproduce observed session records; live Linux checks also exercise OpenSSH and the local agents listed in the dossier.

**Install and update manually.** Save your work, close Doom Term, download the asset for your platform, and verify it against `SHA256SUMS.txt` from this release. Linux has an x86-64 tarball; macOS has an Apple Silicon app bundle and DMG; Windows has an x86-64 installer and standalone zip. Release builds are unsigned. macOS may require a Gatekeeper override for software you trust; Windows may show an unknown-publisher warning. Doom Term does not update itself or submit telemetry. The source and license files are in the [v1.1.5 tag](https://github.com/CMLeadmon/Doom-Term/tree/v1.1.5). This fork is based on upstream Warp commit `a0f5eb31a2ba46e46898f41d8c0e256ae7d20dda`.

The GUI changes were exercised live on Linux. macOS and Windows GUI behavior depends on the release builds and was not exercised interactively. A remote helper needs an attached terminal or console; tmux and screen can interfere with in-band status delivery. Values that the agent has not reported remain unknown.

---

# Doom Term v1.1.4 Release Notes

Doom Term v1.1.4 brings Context and Usage to Antigravity, names queued agents by their pane, keeps the status plate intact at half-window width, and lets a tab be dragged out into its own window.

- **Antigravity status.** `doomterm-agent-status-in-band agy` reads Antigravity's `/statusline` data and shows context, five-hour usage, working state, and diff counts for `agy` over SSH and in local panes, with Antigravity's own mark. Setup is in [Remote agent setup](https://github.com/CMLeadmon/Doom-Term/blob/v1.1.4/docs/doom-term/remote-agent-status.md).
- **Agent queue.** The bottom panel lists every pane that is running an agent, across all tabs and split panes, and names each one by its pane name (the name from Rename pane, else the pane title). Clicking a row focuses that pane.
- **Half-width plate.** The status plate chooses the largest whole-pixel scale that still fits and compacts to CONTEXT, USAGE, and the agent mark with details in narrow windows. The right border is always drawn at the window's edge.
- **Drag a tab out.** Dragging a tab out of the window opens it in a new Doom Term window, as in Warp. Multiple windows work from a second launch of the installed app.
- **New icon.** The application icon is a striated stone plate with the red prompt chevron, drawn on a 32x32 pixel grid.

---

# Doom Term v1.1.3 Release Notes

Doom Term v1.1.3 restores Ctrl+C interruption for running terminal commands, improves remote agent status, and hardens theme loading on Windows.

- Ctrl+C reaches the active PTY command, including Claude Code sessions.
- Remote Claude Code and Codex reports include ADD, DEL, and FILES counts from the remote repository. The Claude status helper can reach its pane even when Claude launches it in a detached process session.
- Windows theme loading accepts common saved Doom Term theme spellings. Startup no longer treats native Registry preferences as a settings file.
- The unused nightly Populate Build Cache workflow has been disabled after repeated startup failures before any job ran.

[Remote agent setup](https://github.com/CMLeadmon/Doom-Term/blob/v1.1.3/docs/doom-term/remote-agent-status.md) explains installing and configuring the updated helper.

---

# Doom Term v1.1.2.1 Release Notes

Doom Term v1.1.2.1 accepts context and five-hour session usage from remote Claude Code and Codex through a status message sent in the agent's own terminal pane. This works with SSH launched from Windows PowerShell as well as macOS and Linux terminals. Warpify's Linux SSH polling remains available as a fallback.

- [Remote agent setup](https://github.com/CMLeadmon/Doom-Term/blob/v1.1.2.1/docs/doom-term/remote-agent-status.md) covers the script, Claude Code statusLine, Codex notification, and fallback.
- Usage now selects the five-hour session window on local and remote panes; the weekly window is never substituted.
- In-band values are accepted only for an active SSH pane and expire after one minute without an update.

---

# Doom Term v1.1.2 Release Notes

Doom Term v1.1.2 reads Claude and Codex context and usage from agents running in a Warpified SSH session. The status plate and tab readouts use the remote agent's own records. The SSH connection uses Warpify's existing ControlMaster; the small remote helper is installed explicitly by the user.

- [Remote agent setup](https://github.com/CMLeadmon/Doom-Term/blob/v1.1.2/docs/doom-term/remote-agent-status.md) covers installation, verification, updates, privacy, and supported hosts.
- Codex context and rate-limit usage come from its active remote rollout. Claude context comes from its active remote transcript. Claude rate-limit usage remains optional and uses the remote Claude Code login when the existing Privacy setting is enabled.
- Missing helper, disconnected SSH sessions, unsupported agents, or ambiguous process matches display unknown values instead of borrowing another pane's readings.

---

# Doom Term v1.1.1 Release Notes

Doom Term v1.1.1 refreshes the bottom status plate using Doom's original status bar as a visual reference. Its grey chassis has irregular stone grain, Context and Usage sit directly on the material, and the ADD/DEL/FILES table uses the original HUD's pale labels and yellow tally style.

- The agent queue shows its visible position and the Warp tab title, with room reserved for names instead of agent codes. Clicking a queue row activates that tab.
- The new **Doom Term** theme colors the terminal and the surrounding interface and is selectable in Settings > Appearance > Themes.
- [Before, after, and Doom 1993 HUD crops](evidence/v111/README.md) document the visual comparison. The original status bar [draws the `STBAR` WAD patch](https://github.com/id-Software/DOOM/blob/master/linuxdoom-1.10/st_stuff.c); this release generates its own texture rather than shipping game art.

---

# Doom Term v1.1.0 Release Notes

Doom Term v1.1.0 replaces guessed agent status with per-pane process and session observations. The 87 px status plate and both tab layouts show Doom Term pixel marks that animate while an agent works. A DIFF well shows local Git changes in place of FULL MODE.

- Context comes from the active Claude or Codex session record. Codex usage comes from its local record. Unknown values display dashes.
- Claude rate-limit usage can be enabled in Privacy settings or the Command Palette. It is off by default; when enabled, Doom Term queries Anthropic while a local Claude session is open.
- SSH and other remote clients are identified as remote sessions without attributing local agent usage to them.
- Custom tab names carry through to the plate. The local CLI no longer advertises hosted Oz commands.
- Bundled builds include single-instance support, so a second launch opens a window in the existing app.

The [remediation dossier](https://github.com/CMLeadmon/Doom-Term/blob/main/remediation.html) shows live application captures and the limits of each check.

---

# Doom Term v1.0.3 Release Notes

> **"The Cyberpunk Cockpit" — An industrial, local-first, hardened terminal emulator.**

Doom Term v1.0.3 restores universal agent brand icons across all surfaces (bottom rail analog status plate HUD, vertical tabs sidebar rows, summary mode tabs, and detail sidecars) and reactivates real-time local context & usage telemetry readouts while upholding Doom Term's strict local-first, zero-cloud architecture.

---

## ⚡ Key Highlights in v1.0.3

### 1. Universal Agent Brand Icons Everywhere
* **Analog Status Plate HUD**: Ported pure-Rust geometric rasterizers (`draw_agent_mark`) for all 10 agent variants (`claude`, `antigravity`, `agy`, `gemini`, `codex`, `opencode`, `copilot`, `grok`, `aider`, and default `shell`) with exact coordinate math from `mockups/plate.doom.js`. Includes authentic vendor palettes (`AGENT_COLORS`), dynamic cosine pulse glow (`mark_tones`), and 0.92 vertical squashed shock rings for busy states.
* **Vertical Tabs Sidebar Rows**: Restored authentic agent brand icons across tab rows and summary mode overview via `CLIAgent` classification under Doom Term's local-only architecture.
* **Detail Sidecar Panel**: Restored colored agent brand logo tiles and agent titles in the tab details view.

### 2. Real-Time Context & Usage Telemetry Readouts
* **Bottom Status Plate HUD**: Dynamically samples local transcript and cache metadata across Claude (`~/.claude/projects/`), Antigravity/Gemini (`~/.gemini/antigravity-cli/brain/`), and Codex (`~/.codex/`), populating real-time `XX%` context and usage dual LED readouts with honest `--%` fallback for unmeasured sessions.
* **Vertical Tabs Sidebar Badges**: Added right-aligned telemetry badges (`XX% ctx  YY% usg`) to tab metadata rows.
* **Detail Sidecar Readouts**: Dedicated high-contrast `CONTEXT: XX% • USAGE: YY%` telemetry readout section in the detail sidecar panel.

### 3. Zero-Deadlock Concurrency & Local-Only Boundary
* **Lock-Free Concurrency**: All agent detections and telemetry lookups strictly minimize and drop `TerminalModel` locks before heavy string matching or filesystem I/O, preventing UI freezes and beachballs.
* **Zero Cloud Dependencies**: 100% offline, zero network requests, zero telemetry emissions; all 21 hosted/cloud crates remain completely severed (`check-build-policy.py`).
* **Ledger Synchronization**: 100% compliance with invasive diff ledger (`script/doomterm/check-inventory.py`).

### 4. 49 Verification Loops & Visual Evidence Dossier
* Exhaustive 7-loop reviews across all 7 plan phases compiled in Section 10 of `evidence.html`, backed by 40 visual artifacts (`evidence/plate/plate-*-idle.png` and `evidence/plate/plate-*-busy.png` at 1x and 3x integer scale).

---

# Doom Term v1.0.2 Release Notes

> **"The Cyberpunk Cockpit" — An industrial, local-first, hardened terminal emulator.**

Doom Term v1.0.2 delivers a major overhaul of the analog status plate HUD: expanding the bottom rail height to 96px universally, introducing crisp 3x integer pixel scaling so the stylized cockpit instruments fill the entire rail without tiny text, and adopting the clean `mockups/plate.doom.js` telemetry layout.

---

## ⚡ Key Highlights in v1.0.2

### 1. Universal 96px Bottom Rail (+33% Height Increase)
* **Full-Height Cockpit Telemetry**: The bottom status plate rail has been increased by an additional 33% (from Windows 72px to 96px, or 3.0x original base) across **all platforms** (Windows, Linux, and macOS).
* **Industrial Presence**: Creates an assertive, unmistakable retro-analog hardware presence grounded at the base of the terminal window.

### 2. 3.0x Integer Pixel Scaling (No Tiny Text)
* **1:1 Native Raster Scaling**: The pure-Rust status plate raster engine now scales its pixel operations by an integer factor of 3.0x (`PLATE_INTEGER_SCALE = 3.0`), rendering directly into the 96px scene quad buffer (`32px * 3 = 96px`).
* **Crisp, Bold Retro Typography**: Completely eliminates tiny text. Primary big glyphs are rendered at 24×42 pixels per character and secondary status text at 15×18 pixels per character, with zero subpixel blurring or anti-aliasing artifacts.
* **Proportional Dividers**: Hairline divider updated to 2.0px for crisp structural definition against terminal scrollback.

### 3. Clean `plate.doom.js` Telemetry Layout
* **Removed Deprecated Chips & Static Table**: Pruned the legacy multi-color chip lamps (blue/gold/red) and static token table (IN/OUT/CAC/TOT).
* **Reclaimed Elastic Center**: Reallocated 90 horizontal pixels back to the central elastic waiting queue (`zone_width` expanded from `W - 480` to `W - 390`).
* **Anchored MODE Indicator**: The session mode indicator is anchored cleanly to the right edge (`W - 8`).
* **Aggressive Two-Column Waiting Queue**: The elastic queue splits into two columns at `WAITING_NAME_MIN` (3 chars), displaying two distinct columns of background tab telemetry starting at standard 640px window widths.

### 4. Verified with 7 Review Passes
* Complete geometric, rasterizer, element, build policy, test suite, and visual evidence audits compiled in `evidence.html` (Section 9), backed by visual artifacts (`evidence/plate/plate-640-3x.png` and `evidence/plate/plate-hostile-3x.png`).

---

# Doom Term v1.0.1 Release Notes

> **"The Cyberpunk Cockpit" — An industrial, local-first, hardened terminal emulator.**

Doom Term v1.0.1 brings requested ergonomic improvements: reintroducing full vertical tab bar functionality and increasing the Windows bottom rail height for enhanced visibility.

---

## ⚡ Key Highlights in v1.0.1

### 1. Reintroduced Vertical Tab Bar Functionality
* **Full Vertical Tab Layout**: Reintroduced the native vertical tab layout option in **Settings > Appearance** ("Use vertical tab layout") and Command Palette actions.
* **Vertical Tabs Summary Mode**: Enabled summary mode for condensed tab overviews.
* **Allowlist Integration**: Feature flags `FeatureFlag::VerticalTabs` and `FeatureFlag::VerticalTabsSummaryMode` are formally added to the Doom Term feature allowlist (`DOOMTERM_FEATURES`) and compile-time features.
* **Completely Local & Hardened**: Operates with full offline support without requiring cloud services or account synchronization.

### 2. Windows Bottom Rail 2.25x Height Increase
* **Enlarged Industrial Footer**: On Windows, the bottom telemetry plate rail logical height has been increased from 32px to 72px (2.25x scaling).
* **Vertically Centered Instrument Cluster**: The retro-analog instrument cluster operations are vertically centered within the expanded rail, maintaining balanced top and bottom padding, sharp pixel rendering, and the protective top divider.

---

# Doom Term v1.0.0 Release Notes

> **"The Cyberpunk Cockpit" — An industrial, local-first, hardened terminal emulator.**

Doom Term v1.0.0 is the inaugural production release of Doom Term, a specialized fork of Warp Terminal. It combines Warp's blazing-fast Rust-based terminal core and modern GPU rendering with a private, offline, hardware-inspired cyber-cockpit telemetry interface.

---

## ⚡ Key Highlights in v1.0.0

### 1. Absolute Privacy & Offline Independence
* **Zero Telemetry**: All telemetry emissions, analytics queues, and background pings are compile-excluded.
* **Zero Cloud Locks**: No login screen, no mandatory account creation, no cloud session synchronization.
* **Strict Policy Enforcement**: Audited via `check-build-policy.py`, confirming that all 21 hosted/cloud crates (including Sentry, Firebase, remote server clients, and cloud object persistence) are completely pruned from the dependency graph.

### 2. The Analog Status Plate HUD (Milestone M5)
* **Docked Instrument Cluster**: A 32px logical height retro-analog telemetry plate sits firmly at the bottom of the workspace.
* **Pure-Rust Engine**: Powered by the standalone `doomterm_plate` crate, computing exact integer pixel operations and custom 5x6 silhouette status indicators with zero third-party font rendering dependencies.
* **Cockpit Telemetry**:
  - Dual LED context and usage readouts.
  - Active session agent, working directory, and git branch telemetry with guaranteed non-overlapping truncation.
  - Elastic waiting queue displaying background session tabs and their real-time state.
* **Lock-Free Concurrency**: Operates with 0 nested `TerminalModel` locks, guaranteeing zero deadlocks or UI beachballs.

### 3. Preserved Native Terminal Superpowers
* Retains Warp's core terminal ergonomics: block-based output navigation, intelligent completions, fast PTY execution, vim/emacs keybindings, rich history search, and local workflows.
* Retains Warp's modern rounded dark chrome while mounting the status plate as the central high-contrast hero element.

### 4. Cross-Platform Packaging & Reclaimed CI (Milestone M6)
* **Linux**: Native AppImage, deb, and rpm packaging via `./script/linux/bundle -c doomterm`, complete with FreeDesktop desktop entry (`io.cmleadmon.DoomTerm.desktop`) and 512x512 icon assets.
* **macOS**: Standalone application bundle (`DoomTerm.app`) with custom `io.cmleadmon.DoomTerm` bundle identifier and `doomterm://` URL scheme handler.
* **Windows**: Inno Setup installer integration with isolated single-instance mutex (`Local\WarpDoomTerm_SingleInstance`) and `doomterm.exe` binary.
* **Public CI**: Reclaimed GitHub Actions workflow (`.github/workflows/doomterm-ci.yml`) executing on standard public runners (`ubuntu-24.04`, `macos-14`, `windows-latest`) without requiring private secrets or paid runner infrastructure.

---

## 🔒 Verification & Compliance

* **AGPL-3.0 Reciprocity**: All modifications and additions remain completely open source under the GNU Affero General Public License v3.
* **Ledger Synchronization**: 415/415 shared files verified against upstream baseline `a0f5eb31a2ba` via `script/doomterm/check-inventory.py`.
* **Exhaustive Evidence**: Comprehensive 7-loop reviews and verification metrics compiled in [`evidence.html`](evidence.html).

---

## 📦 Installation & Quick Start

### Running from Pre-built Bundle
* **Linux**: `./DoomTerm-x86_64.AppImage`
* **macOS**: Open `DoomTerm.app`
* **Windows**: Run `DoomTermSetup.exe`

### Building from Source
```bash
# Clone the repository
git clone https://github.com/CMLeadmon/Doom-Term.git
cd "Doom Term"

# Run locally using the isolated container build environment
./script/doomterm/build-env run "cargo run -p warp --bin doomterm --no-default-features --features doomterm,gui"

# Or build the release binary directly with local toolchain (requires protoc)
cargo build --release -p warp --bin doomterm --no-default-features --features doomterm,gui
```
