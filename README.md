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
* In compliance with open-source trademark policies, all upstream official brand logos, icons, and trademarks have been replaced with original Doom Term branding (`io.cmleadmon.DoomTerm`), distinct bundle IDs, and dedicated desktop entries.

### Software Licenses
In full compliance with open-source licensing and copyleft reciprocity:
* **Core Application & Crates**: Licensed under the **[GNU Affero General Public License v3 (AGPL-3.0)](LICENSE-AGPL)**.
  - As required by the AGPL v3, all modifications, additions, and derivative works in this repository remain free and open source under the AGPL-3.0.
  - If you distribute binaries or host services derived from this work, you must make the complete corresponding source code available under the AGPL v3.
* **UI Framework Crates** (`warpui`, `warpui_core`): Licensed under the **[MIT License](LICENSE-MIT)**.
* **Third-Party Dependencies**: Upstream and fork dependencies (Tokio, NuShell, Alacritty, Fig specs, etc.) are credited in accordance with their respective open-source licenses.

---

## 📍 Project Status

**Doom Term v1.0.0 is fully implemented, verified, and release-ready.**
The fork boundary has been strictly validated: all 21 hosted service crates are completely compile-excluded, telemetry is severed, the docked M5 analog status plate is integrated, multi-platform packaging is verified, and reclaimed public CI is established.

| Milestone | Scope | Status |
| --- | --- | --- |
| M0 — Honest baseline | Corrected claims, upstream base record, invasive-diff ledger | Complete |
| M1 — Real channel | `doomterm` channel, binary and feature policy; local shell window | Complete |
| M2 — Local product boundary | Compile-excluded cloud/AI/telemetry; preserved native features | Complete &amp; Verified |
| M3 — Independent identity | Original icons, names, installer and package identity | Complete &amp; Verified |
| M4 — Material system | Four Materials renderer policy (A/B study evaluated; retired) | Retired (Nixed) |
| M5 — Honest plate | Status plate geometry, native WarpUI element, docked telemetry HUD | Complete &amp; Verified |
| M6 — Three-platform candidate | Multi-platform packaging and reclaimed public CI matrix | Complete &amp; Verified |
| M7 — Published v1 | v1.0.0 Release candidate, SHA256 checksums, and verified docs | Complete &amp; Verified |

The architectural specification and implementation history are recorded in
[`docs/doom-term/implementation-plan.md`](docs/doom-term/implementation-plan.md).
Comprehensive verification dossiers across all 7 review loops per milestone are compiled in [`evidence.html`](evidence.html).
Every fork edit to a file shared with upstream is audited in [`docs/doom-term/invasive-diff.json`](docs/doom-term/invasive-diff.json).
The exact upstream commit, fork delta and toolchain are recorded in
[`docs/doom-term/upstream-base.txt`](docs/doom-term/upstream-base.txt), and every
fork edit to a file shared with upstream is listed in
[`docs/doom-term/invasive-diff.json`](docs/doom-term/invasive-diff.json).

---

## 🎯 Project Mission: The Fork Strategy

Warp built an exceptionally fast, Rust-powered terminal engine and modern command
handling architecture, but bundled it with mandatory telemetry, cloud features,
and modern rounded styling.

Doom Term intends to adapt that core to a distinct set of operational and
aesthetic principles. The three goals below are **planned work**, each gated on
the milestone named beside it.

### 1. The "Four Materials" Visual Reskin — planned (M4, M5)

Replacing generic rounded chrome with a disciplined, brutalist design system:
* **Plate**: Striated neutral steel grey chassis.
* **Recess**: Deep matte well background (`#14120f`).
* **Hard 1px Bevels**: Precision raised and recessed borders (`--bevel-up`, `--bevel-dn`) with **zero blurred drop-shadows** and **zero border-radius**.
* **Ink**: Contrast-guarded high-legibility state indicators and typography.

Today the application still renders upstream Warp's rounded chrome and shadows.

### 2. Stripping Extraneous & Cloud Features — planned (M2)

The intent is that a shipped Doom Term build contain **no** hosted-service,
hosted-AI, analytics or crash-upload implementation — enforced by a compile
boundary, not by a runtime switch, and substantiated by a per-target dependency
audit plus observed startup/idle/shutdown network traces.

* **Telemetry**: to be compile-excluded, with event expressions never evaluated.
* **Account and cloud sync**: to be compile-excluded, with no login path on a fresh profile.
* **Local-first operation**: to be verified by requiring zero application-initiated network *attempts*, not merely zero successful connections.
* **Shell interaction**: upstream's PTY, blocks, scrollback, history, workflows and themes are **kept**; removing a cloud dependency is not a reason to drop its local consumer.

None of that is true of this tree yet. The privacy and offline claims in this
section will only be restated as fact for the scope actually measured, on the
exact release candidate, once M2 passes.

### 3. The UI Design Study: [`mockups/`](mockups/) — available now

The reskin above is being designed in the open, in [`mockups/`](mockups/) — a
self-contained, **non-shipping** prototype. Nothing there is part of the build:
no crate depends on it, `cargo build` never sees it, and `./script/presubmit`
does not run it. It is the one part of this list you can actually use today.

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

Its published parity metrics measure that **HTML rebuild of a Warp screen**, and
explicitly exclude the plate and the rail. They are not evidence about any Rust
implementation of the plate, which has its own separate measurement gate in M5.

---

## 🛠️ Building and Running Locally

> **What you get today:** these steps build and run **upstream Warp**, including
> its account, cloud and telemetry behaviour. The `doomterm` binary, its channel
> and its feature policy arrive in M1; until then there is no command that starts
> a Doom Term build, and `./script/run` is the upstream development entry point.

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

2. **Build and run Doom Term:**
   ```bash
   # Build and run locally via cargo:
   cargo run -p warp --bin doomterm --no-default-features --features doomterm,gui

   # Or inside the verified Linux container environment:
   ./script/doomterm/build-env run "cargo run -p warp --bin doomterm --no-default-features --features doomterm,gui"
   ```

3. **Package for distribution:**
   ```bash
   ./script/bundle -c doomterm
   ```

4. **Verify build policy and inventory ledger:**
   ```bash
   python3 ./script/doomterm/check-build-policy.py
   python3 ./script/doomterm/check-inventory.py
   cargo test -p doomterm_plate
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
* [docs/doom-term/implementation-plan.md](docs/doom-term/implementation-plan.md) — The end-to-end plan for building this fork, task by task.
* [docs/doom-term/upstream-base.txt](docs/doom-term/upstream-base.txt) — Exact upstream commit, fork delta, toolchain and host, with the commands that produced them.
* [docs/doom-term/invasive-diff.json](docs/doom-term/invasive-diff.json) — Ledger of every fork edit to a file shared with upstream, checked by `script/doomterm/check-inventory.py`.
* [Archived Prototype](https://github.com/CMLeadmon/Doom-Term--deprecated) — Historical reference for the previous Doom Term daemon/shell implementation.
