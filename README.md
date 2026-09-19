# Doom Term

> **An industrial, local-first reskin and hardened fork of [Warp Terminal](https://github.com/warpdotdev/warp).**

Doom Term combines the robust Rust-based terminal core and GPU-accelerated rendering of Warp with a brutalist, hardware-inspired aesthetic ("Four Materials, and No Fifth") while stripping out telemetry, cloud account locks, and extraneous proprietary network dependencies.

---

## ⚖️ Origin, Credits & Legal Disclaimers

### Attribution & Upstream Heritage
* **Upstream Project**: This software is an independent open-source fork of [Warp Terminal](https://github.com/warpdotdev/warp), originally created by **Denver Technologies, Inc. / Warp Technologies, Inc.**
* **Upstream Baseline**: Forked from `warpdotdev/warp` at commit [`a0f5eb31`](https://github.com/warpdotdev/warp/commit/a0f5eb31a2ba46e46898f41d8c0e256ae7d20dda) (September 2026).
* **Prior Architecture**: The original Tauri + PTY daemon prototype of Doom Term has been archived and preserved at [CMLeadmon/Doom-Term--deprecated](https://github.com/CMLeadmon/Doom-Term--deprecated).

### Trademark Disclaimer
* **"Warp"** and associated logos, marks, and trade dress are trademarks of **Denver Technologies, Inc. / Warp Technologies, Inc.**
* **Doom Term** is an independent community project. It is **NOT** affiliated with, endorsed by, sponsored by, or associated with Denver Technologies, Inc., Warp Technologies, Inc., id Software, or ZeniMax Media.
* In compliance with open-source trademark policies, all upstream official brand logos, icons, and trademarks have been or are being removed and replaced with Doom Term branding.

### Software Licenses
In full compliance with open-source licensing and copyleft reciprocity:
* **Core Application & Crates**: Licensed under the **[GNU Affero General Public License v3 (AGPL-3.0)](LICENSE-AGPL)**.
  - As required by the AGPL v3, all modifications, additions, and derivative works in this repository remain free and open source under the AGPL-3.0.
  - If you distribute binaries or host services derived from this work, you must make the complete corresponding source code available under the AGPL v3.
* **UI Framework Crates** (`warpui`, `warpui_core`): Licensed under the **[MIT License](LICENSE-MIT)**.
* **Third-Party Dependencies**: Upstream and fork dependencies (Tokio, NuShell, Alacritty, Fig specs, etc.) are credited in accordance with their respective open-source licenses.

---

## 🎯 Project Mission: The Fork Strategy

Warp built an exceptionally fast, Rust-powered terminal engine and modern command handling architecture, but bundled it with mandatory telemetry, cloud features, and modern rounded styling. 

Doom Term adapts this powerful core to a distinct set of operational and aesthetic principles:

### 1. The "Four Materials" Visual Reskin
Replacing generic rounded chrome with a disciplined, brutalist design system:
* **Plate**: Striated neutral steel grey chassis.
* **Recess**: Deep matte well background (`#14120f`).
* **Hard 1px Bevels**: Precision raised and recessed borders (`--bevel-up`, `--bevel-dn`) with **zero blurred drop-shadows** and **zero border-radius**.
* **Ink**: Contrast-guarded high-legibility state indicators and typography.

### 2. Stripping Extraneous & Cloud Features
* **Zero Telemetry**: All analytical reporting, event trackers, and telemetry beacons are removed or inert.
* **No Account Required**: Completely bypasses cloud onboarding, sign-in walls, and team synchronization services.
* **100% Local-First & Offline**: Runs entirely on your machine without querying external servers, protecting developer privacy and air-gapped workflows.
* **Cleaned Shell Interaction**: Focusing on raw terminal fidelity, developer ergonomics, and rock-solid PTY management.

### 3. The UI Design Study: [`mockups/`](mockups/)

The reskin above is being designed in the open, in [`mockups/`](mockups/) — a
self-contained, **non-shipping** prototype. Nothing there is part of the build:
no crate depends on it, `cargo build` never sees it, and `./script/presubmit`
does not run it.

Open [`mockups/shell.html`](mockups/shell.html) to use it:

```sh
python3 -m http.server 8777 --directory mockups
```

It rebuilds a real Warp screen from a production screenshot, measures how close
the rebuild got, and docks the archived Doom Term status plate beneath it. The
plate, the agent marks and the status glyphs are not redrawn for the mockup —
`mockups/plate.js` is the reference renderer copied byte for byte from the
[archived prototype](https://github.com/CMLeadmon/Doom-Term--deprecated), and
`mockups/plate.doom.js` is a fork of it carrying three labelled changes.
[`mockups/README.md`](mockups/README.md) says what is real, what is forked and
what is a stand-in.

---

## 🛠️ Building and Running Locally

### Prerequisites
* **Rust**: Ensure you have a recent stable Rust toolchain installed (managed via [rustup](https://rustup.rs/)).
* **Platform Dependencies**:
  * **Linux**: Standard build essentials, CMake, OpenSSL development headers, Fontconfig, and X11/Wayland development libraries.
  * **macOS**: Xcode Command Line Tools.
  * **Windows**: Visual Studio C++ Build Tools.

### Quick Start

1. **Clone the repository:**
   ```bash
   git clone https://github.com/CMLeadmon/Doom-Term.git
   cd "Doom Term"
   ```

2. **Bootstrap the environment:**
   ```bash
   ./script/bootstrap
   ```

3. **Run in development mode:**
   ```bash
   ./script/run
   ```

4. **Run test suite & linters:**
   ```bash
   ./script/presubmit
   ```

---

## 🤝 Contributing

Contributions are welcome! Please ensure:
1. All contributions adhere to the **GNU AGPL v3** (or **MIT** for files within `warpui`/`warpui_core`).
2. Changes adhere to the local-first, zero-telemetry philosophy.
3. Pull requests pass `./script/presubmit` before review.

---

## 📄 Documentation & Links

* [AGENTS.md](AGENTS.md) — Architectural guidelines and instructions for AI coding assistants.
* [LICENSE-AGPL](LICENSE-AGPL) — GNU Affero General Public License v3 text.
* [LICENSE-MIT](LICENSE-MIT) — MIT License text for UI crates.
* [mockups/README.md](mockups/README.md) — The **UI design study**: an interactive, non-shipping prototype of the reskin, with its pixel-parity and behaviour evidence.
* [Archived Prototype](https://github.com/CMLeadmon/Doom-Term--deprecated) — Historical reference for the previous Doom Term daemon/shell implementation.
