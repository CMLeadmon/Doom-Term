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
