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
