# Development

## Product entry point

Doom Term is a Rust workspace fork of Warp. `AGENTS.md` contains shared architecture and coding
rules; its Doom Term section takes precedence over upstream commands when building this product.
Use the toolchain pinned in `rust-toolchain.toml` (currently Rust 1.92.0).

```sh
git clone https://github.com/CMLeadmon/Doom-Term.git
cd Doom-Term
cargo run -p warp --bin doomterm --no-default-features --features doomterm,gui
```

Install platform-native prerequisites before building. Linux needs a compiler, CMake, pkg-config,
Protobuf, OpenSSL, font, audio, and X11/Wayland libraries; macOS needs Xcode command line tools and
Protobuf; Windows needs the MSVC C++ toolchain and Protobuf. The active
[CI workflow](../../.github/workflows/doomterm-ci.yml) records the platform build commands.
The upstream bootstrap scripts may also configure upstream services; review their scope before use.

## Linux build container

The repository's Ubuntu 24.04 container provides a consistent Linux build baseline. Install Podman,
then run from the repository root:

```sh
./script/doomterm/build-env build
./script/doomterm/build-env run "cargo build -p warp --bin doomterm --no-default-features --features doomterm,gui"
```

Run the locally built GUI on a graphical display. The container helper preserves the host path
and Cargo cache for debug assets and repeat builds. See
[the container definition](../../script/doomterm/Containerfile.linux) for dependencies.

For an installed binary, use:

```sh
cargo build --release -p warp --bin doomterm --no-default-features --features release_bundle,doomterm,gui
```

`release_bundle` supplies the installed application's single-instance behavior. Build and packaging
commands are distinct from release publication; do not tag or publish as a side effect of verification.

## Focused validation

Choose checks based on the changed surface. These are entry points, not a requirement to run every
command for every PR:

```sh
cargo nextest run -p doomterm_agents -p doomterm_plate -p doomterm_backdrop
cargo clippy -p doomterm_agents -p doomterm_plate -p doomterm_backdrop --all-targets -- -D warnings
python3 script/doomterm/check-build-policy.py
python3 script/doomterm/check-inventory.py
```

For tab-directory logic use `script/doomterm/test-tab-groups`. It imports the production module
without the app unit-test target's hosted-service dependencies. See [tab-groups.md](tab-groups.md)
for migration and actual GUI verification entry points.

Follow the order in [AGENTS.md](../../AGENTS.md): targeted tests after implementation and self-review,
then relevant lint/build checks, then applicable formatters once. Use `./script/format` for applicable
code changes. A later behavior or configuration edit requires its affected checks again. Full
presubmit is opt-in. Documentation needs factual, local-link, and rendering checks; a pure prose edit
does not require compiling the workspace.

## Work with upstream

Keep a topic branch from `origin/main`. Record every change to an upstream-shared file in
[invasive-diff.json](invasive-diff.json); new fork files need a declared ownership area. Follow
[upstream-merge.md](upstream-merge.md) when incorporating Warp changes. Do not drop unused upstream
code or workflows wholesale: retained source supports the fork's merge history and alternate builds.

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for PR expectations and
[AI_POLICY.md](../../AI_POLICY.md) for agent-assisted work.
