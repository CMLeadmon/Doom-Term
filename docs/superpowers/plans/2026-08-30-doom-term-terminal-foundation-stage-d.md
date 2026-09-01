# Stage D — tmux as the session substrate: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a Doom Term shell outlive the daemon and the UI, so a running agent survives a daemon restart instead of dying with it.

**Architecture:** Each pane's PTY stops hosting the user's shell directly and instead hosts a **tmux client** attached to `doom-<session-id>`. The shell lives under the tmux server, which is not our child, so killing or restarting the daemon detaches rather than kills. `new-session -A` is idempotent: the same call creates on first use and re-attaches afterwards, so the frontend's existing reconnect path gets durability for free. Everything downstream of the PTY — the demuxer, the xterm screen model, the Doom palette, the block model — is unchanged, because tmux is configured to be transparent rather than to draw its own UI.

**Tech Stack:** Rust (`portable-pty`, `std::process::Command` for tmux queries), tmux ≥ 3.3, TypeScript/React for the mode indicator.

**Spec:** `docs/superpowers/specs/2026-08-29-doom-term-terminal-foundation-design.md` (Stage D, plus the licensing section for the notices file)

---

## Spike findings — measured, not assumed

Run on tmux 3.7b before this plan was written. Four of these contradict the naive design; two of them would have shipped as silent breakage.

| Question | Measured answer |
|---|---|
| Does a bare `OSC 133` from inside a pane reach the client? | **No.** tmux consumes it. The block model would go permanently dead. |
| Does bare `OSC 7` reach the client? | **No.** tmux consumes it for `pane_current_path`. The status plate would stop following `cd`. |
| Does `ESC P tmux; <ESC-doubled payload> ESC \` reach the client? | **Yes**, with `allow-passthrough on`. A real `ESC ] 133 ; A BEL` arrived in the client stream. |
| Does tmux put the client in the alternate screen? | **Yes** — `ESC[?1049h` is the first thing it sends on attach. Everything would be alt-screen forever, so scrollback and blocks would both be gone. |
| Does `terminal-overrides ',*:smcup@:rmcup@'` stop that? | **Yes.** Zero `1049h`/`1049l` in the client stream, output flows into the primary buffer, passthrough still works. |
| Does `capture-pane -S -N -E -1` return history without duplicating the visible screen? | **Yes**, exactly: 57 history + 23 visible = 80 total, boundary clean. `-e` preserves SGR. |
| Is `new-session -A` idempotent? | **Yes.** Second call left one session and the same `pane_pid`. |
| Does `/proc/<pane_pid>/stat` tpgid still identify the foreground command? | **Yes.** The existing `foreground.rs` mechanism works unchanged once it is pointed at `pane_pid` instead of the client pid. |

Two consequences that shape the task list:

1. **`smcup@` is mandatory, and it costs the alt-screen signal.** With it, a full-screen program inside the pane (vim, htop) no longer emits `1049h` to our screen model, so `isAltScreen()` is always false and such programs would render through the block path and come out mangled. Task 7 recovers that signal from tmux itself. Agents are already covered by the existing `foregroundAgent` clause at `usePtyEvents.ts:207`, so this only affects non-agent full-screen programs.
2. **The shell integration must wrap its own sequences.** Task 3.

---

## Deviation from the spec, and why

The spec's D1 is "bundle tmux as a second Tauri sidecar" and calls it "the largest non-code cost in this design". This plan keeps the bundle (Task 8) but **moves it last** and makes the daemon resolve tmux as *sidecar-first, then `$PATH`*.

The reason is that every behavioural risk in Stage D — passthrough, alt-screen, identity, kill semantics — is independent of where the binary came from. Sequencing discovery first means the risky work gets verified against a real tmux immediately, and Task 8 becomes a drop-in with no code change. It also means Stage D delivers durability on any machine that already has tmux, which is most development machines, without waiting on per-platform packaging.

This does not reduce the agreed scope; it reorders it so the packaging chore cannot block the feature.

## Global Constraints

- **tmux ≥ 3.3 required.** `allow-passthrough` does not exist before it, and without passthrough the block model silently dies. An older or unparseable version must fall back to direct spawn, never run degraded.
- **Never touch these files.** They hold uncommitted work: `.nodeterm/project.json`, `backend/src/main.rs` *(see the exception below)*, `crates/doom-term-pty/src/foreground.rs`, `src/components/StatusPlate.tsx`, `src/components/TabBar.tsx`, `src/components/TabBar.test.tsx`, `src/hud/plate.d.ts`, `src/hud/plate.js`, `src/hud/state.ts`, `src/types/sessionTree.ts`, `src/types/terminal.ts`.
  - `backend/src/main.rs` **must** be modified — it is the only `PtySession` consumer. The rule is narrower: **do not touch the `ServerMessage::Telemetry` struct or the `let agent = session_id` block**, which is exactly where the uncommitted hunk sits. Tasks 4 and 6 are designed so those lines stay byte-identical.
  - `crates/doom-term-pty/src/foreground.rs` needs no change at all: Task 4 changes *which pid* is passed to `foreground_command`, not how it works.
- **No game vocabulary** in anything the UI renders. "SESSION NOT DURABLE", not "no respawn point".
- **nodeterm is BUSL-1.1; Doom Term is MIT.** tmux techniques are facts and free to use. Do not copy nodeterm's code or comments. (nodeterm's own tmux sessions are visible on this machine as `nt-term-*` — read the behaviour, write our own.)
- **tmux is ISC; libevent is BSD-3-Clause; ncurses is MIT-like.** Bundling creates attribution obligations. Task 8 carries them.
- Session name is `doom-<session-id>` everywhere. One constant, one function.
- Rust tests: `cargo test --manifest-path crates/doom-term-pty/Cargo.toml` (27 passing today) and `cargo test --manifest-path backend/Cargo.toml` (2 passing today).
- TS gate: `npx tsc --noEmit && npx vitest run && npm run build`. Currently 186 tests over 26 files, all green.

---

## File Structure

**Create**
- `crates/doom-term-pty/src/tmux.rs` — everything tmux. Version parsing, discovery, the config body, argv construction, and a `TmuxHandle` for post-spawn queries. All the string- and argv-building is pure and unit-tested; only `TmuxHandle`'s methods shell out.
- `src/components/SessionModeNotice.tsx` — the honest-degradation strip.
- `THIRD-PARTY-NOTICES.md` — tmux/libevent/ncurses attribution (Task 8).
- `tools/build-tmux-sidecar.mjs` — packaging (Task 8).

**Modify**
- `crates/doom-term-pty/src/lib.rs` — export the new module.
- `crates/doom-term-pty/src/shell_integration.rs` — extract `ShellLaunch`; wrap OSC in the tmux passthrough when `$TMUX` is set; move OSC 7 to a BEL terminator.
- `crates/doom-term-pty/src/session.rs` — the tmux branch in `spawn`, plus kill/signal/identity redirection.
- `backend/src/main.rs` — the new `SessionMode` message and the durability plumbing. Not the Telemetry struct.
- `src/core/ptyClient.ts` — handle `SessionMode`, expose session durability.
- `src/hooks/usePtyEvents.ts` — let a daemon-reported TUI state override the screen's own alt-screen flag.
- `src/App.tsx` — render the notice.

---

### Task 1: Discover tmux and gate on its version

**Files:**
- Create: `crates/doom-term-pty/src/tmux.rs`
- Modify: `crates/doom-term-pty/src/lib.rs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pub const MIN_MAJOR: u32 = 3; pub const MIN_MINOR: u32 = 3;`
  - `pub fn parse_version(version_output: &str) -> Option<(u32, u32)>`
  - `pub fn version_supported(version_output: &str) -> bool`
  - `pub fn session_name(session_id: &str) -> String`
  - `pub fn resolve_tmux(sidecar_dir: Option<&std::path::Path>) -> Option<std::path::PathBuf>`

- [ ] **Step 1: Write the failing tests**

Append to `crates/doom-term-pty/src/tmux.rs` (create the file with just this test module for now):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_version_out_of_every_shape_tmux_reports() {
        assert_eq!(parse_version("tmux 3.7b"), Some((3, 7)));
        assert_eq!(parse_version("tmux 3.2a\n"), Some((3, 2)));
        assert_eq!(parse_version("tmux next-3.4"), Some((3, 4)));
        assert_eq!(parse_version("tmux 2.8"), Some((2, 8)));
    }

    #[test]
    fn an_unreadable_version_is_refused_rather_than_assumed_new() {
        // `allow-passthrough` arrived in 3.3, and without it the shell's OSC
        // 133 never reaches us — blocks stop working and nothing says so. A
        // build we cannot date is therefore not durable-capable: falling back
        // to a direct spawn is the behaviour we already have, and correct.
        assert_eq!(parse_version("tmux master"), None);
        assert_eq!(parse_version(""), None);
        assert!(!version_supported("tmux master"));
    }

    #[test]
    fn the_floor_is_the_release_that_added_passthrough() {
        assert!(!version_supported("tmux 3.2a"));
        assert!(version_supported("tmux 3.3"));
        assert!(version_supported("tmux 3.7b"));
        assert!(!version_supported("tmux 2.9"));
    }

    #[test]
    fn a_session_name_is_namespaced_so_it_never_adopts_a_stranger() {
        // Attaching to a name we did not create would hand a user someone
        // else's shell. The prefix is what keeps `doom-1` distinct from a
        // hand-made session called `1`.
        assert_eq!(session_name("node-7"), "doom-node-7");
        assert!(session_name("x").starts_with("doom-"));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path crates/doom-term-pty/Cargo.toml tmux::`
Expected: FAIL — the module is not declared in `lib.rs` and the functions do not exist.

- [ ] **Step 3: Write the implementation**

Put this **above** the test module in `crates/doom-term-pty/src/tmux.rs`:

```rust
//! tmux as the session substrate.
//!
//! The PTY we open hosts a tmux *client*, not the user's shell. The shell lives
//! under the tmux server, which is nobody's child of ours, so restarting or
//! crashing the daemon detaches the client and leaves the work running. That is
//! the whole point: an agent mid-task used to die with the daemon.
//!
//! Everything that builds a string or an argv here is pure, because the
//! interesting failures are in the arguments, not in the spawning.

use std::path::{Path, PathBuf};

/// `allow-passthrough` landed in tmux 3.3. Below that, a shell's OSC 133 is
/// swallowed by tmux and never reaches our demuxer, so command blocks silently
/// stop existing. That is a worse outcome than not using tmux at all.
pub const MIN_MAJOR: u32 = 3;
pub const MIN_MINOR: u32 = 3;

/// Major and minor from `tmux -V`, which reports as `tmux 3.7b`, `tmux 3.2a`
/// or `tmux next-3.4`. The suffix letter is a point release and is ignored.
///
/// Returns None when no `<major>.<minor>` is present at all — `tmux master`
/// being the real case. We refuse those rather than assume they are new: the
/// cost of guessing high is invisible breakage, and the cost of guessing low is
/// the direct spawn we already ship.
pub fn parse_version(version_output: &str) -> Option<(u32, u32)> {
    let bytes = version_output.as_bytes();
    let dot = version_output.find('.')?;

    let start = bytes[..dot]
        .iter()
        .rposition(|b| !b.is_ascii_digit())
        .map(|i| i + 1)
        .unwrap_or(0);
    if start == dot {
        return None;
    }
    let major: u32 = version_output[start..dot].parse().ok()?;

    let after = &version_output[dot + 1..];
    let end = after
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(after.len());
    if end == 0 {
        return None;
    }
    let minor: u32 = after[..end].parse().ok()?;

    Some((major, minor))
}

pub fn version_supported(version_output: &str) -> bool {
    match parse_version(version_output) {
        Some((major, minor)) => (major, minor) >= (MIN_MAJOR, MIN_MINOR),
        None => false,
    }
}

/// The tmux session backing a Doom Term pane.
///
/// Namespaced deliberately: `new-session -A` attaches to whatever already
/// carries the name, so an un-prefixed id could adopt a session the user made
/// by hand and hand them a shell they did not open.
pub fn session_name(session_id: &str) -> String {
    format!("doom-{}", session_id)
}

/// Where to find tmux: the bundled sidecar first, then the user's PATH.
///
/// Sidecar-first so a bundled build is self-contained and reproducible; PATH
/// second so a development checkout works before any packaging exists. Both
/// orders were considered — this one means adding the bundle later changes no
/// code, only what is on disk.
pub fn resolve_tmux(sidecar_dir: Option<&Path>) -> Option<PathBuf> {
    if std::env::var("DOOM_TERM_NO_TMUX").is_ok() {
        return None;
    }
    if let Some(dir) = sidecar_dir {
        let bundled = dir.join(if cfg!(windows) { "tmux.exe" } else { "tmux" });
        if bundled.is_file() {
            return Some(bundled);
        }
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join("tmux"))
        .find(|candidate| candidate.is_file())
}
```

Add to `crates/doom-term-pty/src/lib.rs`, after the `shell_integration` line:

```rust
pub mod tmux;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path crates/doom-term-pty/Cargo.toml`
Expected: PASS — 31 passing (27 existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add crates/doom-term-pty/src/tmux.rs crates/doom-term-pty/src/lib.rs
git commit -m "feat(tmux): discover tmux and gate on the passthrough-capable version"
```

---

### Task 2: The transparent tmux config and the spawn argv

Both are pure string/argv construction, and both encode spike findings that are invisible in the finished product. Test them where they are legible.

**Files:**
- Modify: `crates/doom-term-pty/src/tmux.rs`

**Interfaces:**
- Consumes: `session_name` from Task 1.
- Produces:
  - `pub fn config_body() -> String`
  - `pub fn write_config() -> Option<PathBuf>`
  - `pub fn new_session_args(conf: &Path, name: &str, cols: u16, rows: u16, env: &[(String, String)], shell: &str, shell_args: &[String]) -> Vec<String>`

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `crates/doom-term-pty/src/tmux.rs`:

```rust
    #[test]
    fn the_config_keeps_tmux_out_of_the_alternate_screen() {
        // Measured, not assumed: attaching sends ESC[?1049h as its first bytes,
        // which would put the screen model in the alternate buffer for the whole
        // life of the session — no scrollback, and no command blocks, ever.
        // Removing smcup/rmcup from the client's terminfo is what stops it.
        let conf = config_body();
        assert!(conf.contains("smcup@"), "must disable the alternate screen");
        assert!(conf.contains("rmcup@"));
    }

    #[test]
    fn the_config_lets_the_shells_own_escape_sequences_through() {
        // Bare OSC 133 and OSC 7 from inside a pane are consumed by tmux and
        // never reach us. The DCS wrapper in shell_integration is the way out,
        // and it only works if passthrough is enabled here.
        assert!(config_body().contains("allow-passthrough on"));
    }

    #[test]
    fn the_config_gives_tmux_no_keys_and_no_chrome_of_its_own() {
        // Doom Term draws the UI. A tmux status bar would eat a row and render
        // vocabulary we do not control, and a live prefix key would swallow
        // C-b before the agent in the pane ever saw it.
        let conf = config_body();
        assert!(conf.contains("status off"));
        assert!(conf.contains("set -g prefix None"));
        assert!(conf.contains("set -g prefix2 None"));
    }

    #[test]
    fn the_config_does_not_delay_escape() {
        // tmux defaults to a 500ms escape-time, which every full-screen program
        // in the pane experiences as a stuck Esc key.
        assert!(config_body().contains("escape-time 0"));
    }

    #[test]
    fn a_new_session_is_attach_or_create_at_an_explicit_size() {
        // -A is what makes reattach free: the same call creates the first time
        // and attaches every time after, so the client's reconnect path needs no
        // knowledge of which case it is in. -x/-y matter because a session
        // created at tmux's 80x24 default and resized afterwards makes every
        // program in it redraw at the wrong width first.
        let args = new_session_args(
            Path::new("/run/doom.conf"),
            "doom-n1",
            100,
            30,
            &[],
            "/bin/bash",
            &[],
        );
        let joined = args.join(" ");
        assert!(joined.contains("-f /run/doom.conf"), "{joined}");
        assert!(joined.contains("new-session -A"), "{joined}");
        assert!(joined.contains("-s doom-n1"), "{joined}");
        assert!(joined.contains("-x 100"), "{joined}");
        assert!(joined.contains("-y 30"), "{joined}");
    }

    #[test]
    fn the_shell_and_its_integration_args_go_after_the_terminator() {
        // Without `--`, tmux joins the remaining words into one shell command
        // string, and `--rcfile` would be parsed by tmux rather than bash.
        let args = new_session_args(
            Path::new("/c"),
            "doom-n1",
            80,
            24,
            &[],
            "/bin/bash",
            &["--rcfile".into(), "/run/i.sh".into(), "-i".into()],
        );
        let dashdash = args.iter().position(|a| a == "--").expect("needs --");
        assert_eq!(&args[dashdash + 1..], ["/bin/bash", "--rcfile", "/run/i.sh", "-i"]);
    }

    #[test]
    fn environment_reaches_the_pane_and_not_merely_the_client() {
        // The client process's environment is not the pane's: the pane is a
        // child of the tmux server, which may long predate this client. -e is
        // the only thing that puts ZDOTDIR where the shell will read it.
        let args = new_session_args(
            Path::new("/c"),
            "doom-n1",
            80,
            24,
            &[("ZDOTDIR".into(), "/run/doom-term".into())],
            "/bin/zsh",
            &[],
        );
        let joined = args.join(" ");
        assert!(joined.contains("-e ZDOTDIR=/run/doom-term"), "{joined}");
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path crates/doom-term-pty/Cargo.toml tmux::`
Expected: FAIL — `config_body` and `new_session_args` are not defined.

- [ ] **Step 3: Write the implementation**

Add to `crates/doom-term-pty/src/tmux.rs`, above the test module:

```rust
/// The tmux configuration that makes tmux invisible.
///
/// Every line here is load-bearing and several are counter-intuitive, so each
/// says why. The user's own ~/.tmux.conf is deliberately NOT loaded: this is a
/// UI substrate, not the user's tmux, and inheriting their status bar, prefix
/// and key table would break the pane in ways they could not diagnose.
pub fn config_body() -> String {
    String::from(
        r#"# Doom Term tmux substrate. Generated per run; safe to delete.

# Doom Term draws the interface. A tmux status bar would take a row and render
# its own vocabulary inside ours.
set -g status off
set -g set-titles off

# No prefix key at all. C-b belongs to whatever is running in the pane; an
# agent that uses it would otherwise never see it.
set -g prefix None
set -g prefix2 None

# tmux defaults to holding Esc for 500ms to disambiguate escape sequences,
# which every full-screen program in the pane experiences as a stuck key.
set -g escape-time 0

# The shell's OSC 133 and OSC 7 do not reach a client on their own — tmux
# consumes them. The integration script wraps them in a DCS passthrough, and
# this is what permits it. Without this line, command blocks stop existing.
set -g allow-passthrough on

# Attaching normally sends ESC[?1049h and holds the client in the alternate
# screen for the entire session, which would leave our screen model with no
# scrollback and no blocks for as long as the pane is open. Removing smcup and
# rmcup from the client's terminfo stops tmux using it, so output flows into
# the primary buffer exactly as it does without tmux.
set -ga terminal-overrides ',*:smcup@:rmcup@'

set -g default-terminal "xterm-256color"
set -as terminal-features ',*:RGB'

# Scrollback recovered by capture-pane on reattach; see session.rs.
set -g history-limit 5000

# One client per session, so the newest attach decides the size. Anything else
# letterboxes the pane to a client that is no longer on screen.
set -g window-size latest

# Surviving detach is the entire feature.
set -g destroy-unattached off
set -g remain-on-exit off

# Mouse handling belongs to the pane's program and to our own UI, not to tmux.
set -g mouse off
set -g bell-action none
set -g visual-activity off
"#,
    )
}

/// Write the config where only this user can read it, next to the shell
/// integration scripts. A tmux config can run shell commands, so a
/// world-writable location would be an execution hole.
pub fn write_config() -> Option<PathBuf> {
    let base = std::env::var("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    let dir = base.join("doom-term");
    std::fs::create_dir_all(&dir).ok()?;

    let path = dir.join("tmux.conf");
    std::fs::write(&path, config_body()).ok()?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }

    Some(path)
}

/// argv for attach-or-create, at an explicit size, running our shell.
///
/// `-A` is what makes reattach free: identical on first spawn and on every
/// reconnect, so no caller has to know which case it is in. `-x`/`-y` apply
/// only at creation, which is fine — an existing session is resized by the
/// client's own PTY instead.
pub fn new_session_args(
    conf: &Path,
    name: &str,
    cols: u16,
    rows: u16,
    env: &[(String, String)],
    shell: &str,
    shell_args: &[String],
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-f".into(),
        conf.to_string_lossy().to_string(),
        "new-session".into(),
        "-A".into(),
        "-s".into(),
        name.into(),
        "-x".into(),
        cols.to_string(),
        "-y".into(),
        rows.to_string(),
    ];
    for (key, value) in env {
        args.push("-e".into());
        args.push(format!("{}={}", key, value));
    }
    // Without the terminator tmux folds the rest into a single command string
    // and parses our shell's own flags as its own.
    args.push("--".into());
    args.push(shell.into());
    args.extend(shell_args.iter().cloned());
    args
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path crates/doom-term-pty/Cargo.toml`
Expected: PASS — 38 passing.

- [ ] **Step 5: Commit**

```bash
git add crates/doom-term-pty/src/tmux.rs
git commit -m "feat(tmux): a transparent substrate config and attach-or-create argv"
```

---

### Task 3: Get the shell's OSC sequences past tmux

The shell integration currently emits bare OSC 133 and OSC 7. Inside tmux both are consumed and never arrive, so blocks and the `cd`-following status plate would both go dead. The scripts must wrap their own output when `$TMUX` is set.

The wrapper is `ESC P tmux; <payload with every ESC doubled> ESC \`. To keep the doubling rule trivially correct, **every sequence we emit must contain exactly one ESC** — so OSC 7 moves from an ST terminator (`ESC \`, a second ESC) to a BEL terminator, which the demuxer already accepts because OSC 133 uses it.

**Files:**
- Modify: `crates/doom-term-pty/src/shell_integration.rs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pub struct ShellLaunch { pub args: Vec<String>, pub env: Vec<(String, String)> }`
  - `pub fn shell_launch(shell: &str) -> ShellLaunch`
  - `apply_shell_integration(&mut CommandBuilder, &str)` keeps its signature and behaviour.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `crates/doom-term-pty/src/shell_integration.rs`:

```rust
    #[test]
    fn every_emitted_sequence_carries_exactly_one_escape() {
        // The tmux passthrough wrapper requires each ESC in the payload to be
        // doubled. Emitting one ESC per sequence makes that a fixed prefix
        // instead of an escaping pass, which is why OSC 7 is BEL-terminated
        // here rather than ST-terminated.
        for script in [bash_integration_script(), zsh_integration_script()] {
            assert!(
                !script.contains(r"\033\\") && !script.contains(r"\e\\"),
                "an ST terminator would put a second ESC in the payload"
            );
            assert!(script.contains(r"]7;file://"), "OSC 7 must still be emitted");
        }
    }

    #[test]
    fn sequences_are_wrapped_for_tmux_only_when_running_under_it() {
        // Outside tmux the wrapper would be printed literally as garbage; inside
        // it, its absence means the sequence is swallowed and the block model
        // goes quiet with no error anywhere.
        for script in [bash_integration_script(), zsh_integration_script()] {
            assert!(script.contains("$TMUX"), "must test for tmux");
            assert!(script.contains("Ptmux;"), "must emit the DCS passthrough");
        }
    }

    #[test]
    fn the_wrapper_is_used_for_every_boundary_not_just_some() {
        // A half-wrapped script is the worst outcome: blocks open and never
        // close, so every command looks like it is still running.
        let bash = bash_integration_script();
        for marker in ["133;A", "133;C", "133;D", "]7;file://"] {
            assert!(bash.contains(marker), "missing {marker}");
        }
        assert!(
            !bash.contains(r"printf '\033]133"),
            "no boundary may bypass the wrapper by printing OSC directly"
        );
    }

    #[test]
    fn a_launch_reports_the_args_and_env_the_shell_needs() {
        // tmux runs the shell for us, so the integration can no longer be
        // applied by mutating a CommandBuilder — the arguments have to be
        // available as data that can also be threaded through tmux's argv.
        let bash = shell_launch("/bin/bash");
        assert_eq!(bash.args.first().map(String::as_str), Some("--rcfile"));
        assert!(bash.args.contains(&"-i".to_string()));

        let zsh = shell_launch("/usr/bin/zsh");
        assert!(zsh.args.is_empty(), "zsh is configured by ZDOTDIR, not by args");
        assert!(zsh.env.iter().any(|(k, _)| k == "ZDOTDIR"));

        let fish = shell_launch("/usr/bin/fish");
        assert!(fish.args.is_empty() && fish.env.is_empty(), "unknown shells are untouched");
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path crates/doom-term-pty/Cargo.toml shell_integration::`
Expected: FAIL — `shell_launch` is undefined, and the scripts contain `\033\\` and unwrapped `printf '\033]133`.

- [ ] **Step 3: Write the implementation**

Replace `bash_integration_script` in `crates/doom-term-pty/src/shell_integration.rs`:

```rust
/// Bash shell integration.
///
/// Without this nothing ever emits OSC 133, so the UI never learns when a
/// command started or finished: blocks stay "running" forever and never get an
/// exit code, a duration or a pass/fail rail. OSC 7 is included so `cd` moves
/// the status plate.
///
/// Every sequence goes through `__doom_term_osc`, because inside tmux a bare
/// OSC never reaches us — tmux consumes 133 and keeps 7 for itself. The DCS
/// wrapper is the documented way out and requires `allow-passthrough on`, which
/// the substrate config sets. One ESC per sequence keeps the wrapper a fixed
/// prefix rather than an escaping pass, which is why OSC 7 ends in BEL here.
pub fn bash_integration_script() -> String {
    String::from(
        r#"# Doom Term shell integration. Generated per session; safe to delete.
[ -f /etc/bash.bashrc ] && . /etc/bash.bashrc
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"

__doom_term_osc() {
  if [ -n "$TMUX" ]; then
    printf '\033Ptmux;\033%s\033\\' "$1"
  else
    printf '%s' "$1"
  fi
}

__doom_term_precmd() {
  local ec=$?
  __doom_term_osc "$(printf '\033]133;D;%s\007' "$ec")"
  __doom_term_osc "$(printf '\033]7;file://%s%s\007' "${HOSTNAME:-localhost}" "$PWD")"
}

if ((BASH_VERSINFO[0] >= 5)) && [[ ${PROMPT_COMMAND@a} == *a* ]]; then
  PROMPT_COMMAND+=(__doom_term_precmd)
else
  case "${PROMPT_COMMAND:-}" in
    *__doom_term_precmd*) ;;
    *) PROMPT_COMMAND="__doom_term_precmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}" ;;
  esac
fi

# PS0 is expanded after the command is read but before it runs. It cannot call
# a function that writes to stdout without the output landing in the prompt, so
# the wrapper is inlined by value at rc time instead.
if [ -n "$TMUX" ]; then
  __doom_term_ps0=$'\ePtmux;\e\e]133;C\a\e\\'
  __doom_term_a=$'\ePtmux;\e\e]133;A\a\e\\'
  __doom_term_b=$'\ePtmux;\e\e]133;B\a\e\\'
else
  __doom_term_ps0=$'\e]133;C\a'
  __doom_term_a=$'\e]133;A\a'
  __doom_term_b=$'\e]133;B\a'
fi
PS0="${__doom_term_ps0}${PS0:-}"
case "$PS1" in
  *'133;A'*) ;;
  *) PS1="\[${__doom_term_a}\]${PS1}\[${__doom_term_b}\]" ;;
esac
"#,
    )
}
```

Replace `zsh_integration_script`:

```rust
/// Zsh equivalent. ZDOTDIR points here, so we hand control straight back to the
/// user's own dotfiles before adding the hooks. Same tmux wrapping as bash: see
/// `bash_integration_script` for why it exists.
pub fn zsh_integration_script() -> String {
    String::from(
        r#"# Doom Term shell integration. Generated per session; safe to delete.
if [ -n "$DOOM_TERM_USER_ZDOTDIR" ]; then
  export ZDOTDIR="$DOOM_TERM_USER_ZDOTDIR"
else
  unset ZDOTDIR
fi
[ -f "${ZDOTDIR:-$HOME}/.zshrc" ] && source "${ZDOTDIR:-$HOME}/.zshrc"

__doom_term_osc() {
  if [ -n "$TMUX" ]; then
    print -n "\033Ptmux;\033$1\033\\"
  else
    print -n "$1"
  fi
}

__doom_term_precmd() {
  local ec=$?
  __doom_term_osc "\033]133;D;${ec}\007"
  __doom_term_osc "\033]7;file://${HOST}${PWD}\007"
  __doom_term_osc "\033]133;A\007"
}
__doom_term_preexec() { __doom_term_osc "\033]133;C\007" }

typeset -ag precmd_functions preexec_functions
precmd_functions+=(__doom_term_precmd)
preexec_functions+=(__doom_term_preexec)
"#,
    )
}
```

Add `ShellLaunch` and `shell_launch`, and rewrite `apply_shell_integration` to use them, replacing the existing `apply_shell_integration`:

```rust
/// What a shell needs on its command line and in its environment for the
/// integration to take effect.
///
/// This exists as data rather than as CommandBuilder mutation because under
/// tmux we do not spawn the shell — tmux does, from an argv we hand it, into an
/// environment that is the server's rather than ours.
pub struct ShellLaunch {
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

pub fn shell_launch(shell: &str) -> ShellLaunch {
    let mut launch = ShellLaunch { args: Vec::new(), env: Vec::new() };
    if std::env::var("DOOM_TERM_NO_SHELL_INTEGRATION").is_ok() {
        return launch;
    }
    match shell_name(shell).as_str() {
        "bash" => {
            if let Some(path) =
                write_integration_file("bash-integration.sh", &bash_integration_script())
            {
                launch.args.push("--rcfile".to_string());
                launch.args.push(path.to_string_lossy().to_string());
                launch.args.push("-i".to_string());
            }
        }
        "zsh" => {
            if let Ok(existing) = std::env::var("ZDOTDIR") {
                launch
                    .env
                    .push(("DOOM_TERM_USER_ZDOTDIR".to_string(), existing));
            }
            if let Some(path) = write_integration_file(".zshrc", &zsh_integration_script()) {
                if let Some(dir) = path.parent() {
                    launch
                        .env
                        .push(("ZDOTDIR".to_string(), dir.to_string_lossy().to_string()));
                }
            }
        }
        _ => {}
    }
    launch
}

/// Add shell integration to a directly-spawned command. The tmux path uses
/// `shell_launch` instead, so both routes read from one definition.
pub fn apply_shell_integration(cmd: &mut CommandBuilder, shell: &str) {
    let launch = shell_launch(shell);
    for (key, value) in &launch.env {
        cmd.env(key, value);
    }
    for arg in &launch.args {
        cmd.arg(arg);
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path crates/doom-term-pty/Cargo.toml`
Expected: PASS — 42 passing. The four pre-existing `shell_integration` tests must still pass unchanged.

- [ ] **Step 5: Verify the wrapper against a real tmux**

This is the one place a unit test cannot prove the outcome, and it is the assumption the whole stage rests on. Run:

```bash
cd /tmp && cat > /tmp/doomchk.conf <<'EOF'
set -g status off
set -g allow-passthrough on
set -ga terminal-overrides ',*:smcup@:rmcup@'
EOF
tmux -L doomchk kill-server 2>/dev/null
tmux -L doomchk -f /tmp/doomchk.conf new-session -d -s chk -x 80 -y 24 'bash --norc --noprofile'
sleep 1
script -q -c "tmux -L doomchk attach -t chk" /tmp/doomchk.raw >/dev/null 2>&1 &
sleep 1.5
tmux -L doomchk send-keys -t chk "printf '\\033Ptmux;\\033\\033]133;A\\007\\033\\\\'" Enter
sleep 1
tmux -L doomchk kill-server 2>/dev/null; sleep 0.5
python3 -c "d=open('/tmp/doomchk.raw','rb').read(); print('OSC133 delivered:', d.count(b'\x1b]133')); print('1049h:', d.count(b'\x1b[?1049h'))"
```

Expected: `OSC133 delivered: 1` or more, and `1049h: 0`. If either fails, stop — the substrate is not transparent and Task 4 onward will be built on sand.

- [ ] **Step 6: Commit**

```bash
git add crates/doom-term-pty/src/shell_integration.rs
git commit -m "feat(pty): wrap shell integration OSC for tmux passthrough"
```

---

### Task 4: Spawn through tmux, and keep identity, signals and kill honest

The pid the daemon holds is now the tmux *client*, whose controlling terminal shows the client itself in the foreground — so the plate would report no agent, ever. `killpg` on it would kill the client and leave the shell. `kill()` would detach rather than terminate.

All three are fixed by routing through the pane. `shell_pid()` **keeps its name and its return type** so that `backend/src/main.rs`'s telemetry lookup — which holds uncommitted work — stays byte-identical.

**Files:**
- Modify: `crates/doom-term-pty/src/tmux.rs`
- Modify: `crates/doom-term-pty/src/session.rs`
- Modify: `backend/src/main.rs` (the `Spawn` arm only)

**Interfaces:**
- Consumes: `session_name`, `resolve_tmux`, `version_supported`, `write_config`, `new_session_args` (Tasks 1–2); `shell_launch`/`ShellLaunch` (Task 3).
- Produces:
  - `pub struct TmuxHandle { pub exe: PathBuf, pub name: String }`
  - `impl TmuxHandle { pub fn query(&self, format: &str) -> Option<String>; pub fn pane_pid(&self) -> Option<u32>; pub fn has_session(&self) -> bool; pub fn kill_session(&self) -> bool }`
  - `PtySession::spawn` keeps its signature; durability is read afterwards via `pub fn is_durable(&self) -> bool` and `pub fn durability_detail(&self) -> Option<String>`.
  - `PtySession::shell_pid()` unchanged in name and signature; now returns the pane pid when tmux-backed.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `crates/doom-term-pty/src/tmux.rs`:

```rust
    #[test]
    fn a_handle_asks_tmux_about_its_own_session_only() {
        // A query without -t answers about whichever session tmux considers
        // current, which is not necessarily ours — the same class of mislabel
        // the per-session telemetry lookup already exists to prevent.
        let h = TmuxHandle { exe: PathBuf::from("/usr/bin/tmux"), name: "doom-n1".into() };
        assert_eq!(
            h.query_args("#{pane_pid}"),
            vec!["display-message", "-p", "-t", "doom-n1", "#{pane_pid}"]
        );
    }

    #[test]
    fn killing_means_kill_the_session_not_detach_from_it() {
        // Detaching is the default and is exactly wrong here: the user asked to
        // close the tab, and a surviving shell they can no longer see is a leak
        // they cannot find.
        let h = TmuxHandle { exe: PathBuf::from("/usr/bin/tmux"), name: "doom-n1".into() };
        assert_eq!(h.kill_args(), vec!["kill-session", "-t", "doom-n1"]);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path crates/doom-term-pty/Cargo.toml tmux::`
Expected: FAIL — `TmuxHandle` is not defined.

- [ ] **Step 3: Write the implementation**

Add to `crates/doom-term-pty/src/tmux.rs`, above the test module:

```rust
/// A live tmux session, addressed by name.
///
/// Every query names `-t <session>` explicitly. Without it tmux answers about
/// whatever it considers current, which for a daemon holding several sessions
/// is a coin flip.
#[derive(Debug, Clone)]
pub struct TmuxHandle {
    pub exe: PathBuf,
    pub name: String,
}

impl TmuxHandle {
    pub fn query_args(&self, format: &str) -> Vec<String> {
        vec![
            "display-message".into(),
            "-p".into(),
            "-t".into(),
            self.name.clone(),
            format.into(),
        ]
    }

    pub fn kill_args(&self) -> Vec<String> {
        vec!["kill-session".into(), "-t".into(), self.name.clone()]
    }

    /// Read one tmux format string. None when tmux is gone or the session is.
    pub fn query(&self, format: &str) -> Option<String> {
        let out = std::process::Command::new(&self.exe)
            .args(self.query_args(format))
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let value = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if value.is_empty() {
            None
        } else {
            Some(value)
        }
    }

    /// The pid of the shell inside the pane.
    ///
    /// This — not the client's pid — is what foreground detection must start
    /// from. The client's controlling terminal is the PTY we opened, and the
    /// foreground process group on it is the client itself, so asking about the
    /// client reports tmux forever and the agent well stays empty.
    pub fn pane_pid(&self) -> Option<u32> {
        self.query("#{pane_pid}")?.parse().ok()
    }

    pub fn has_session(&self) -> bool {
        std::process::Command::new(&self.exe)
            .args(["has-session", "-t", &self.name])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    pub fn kill_session(&self) -> bool {
        std::process::Command::new(&self.exe)
            .args(self.kill_args())
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
}
```

In `crates/doom-term-pty/src/session.rs`, add to the imports:

```rust
use crate::shell_integration::{apply_shell_integration, shell_launch};
use crate::tmux::{self, TmuxHandle};
```

Add two fields to `PtySession`:

```rust
    /// The tmux session backing this pane, when there is one. Its presence is
    /// what makes the shell outlive us.
    tmux: Option<TmuxHandle>,
    /// Why this session is not durable, when it is not. Reported to the UI:
    /// a persistence guarantee that silently is not one is worse than none.
    durability_detail: Option<String>,
```

Replace the block in `spawn` that runs from `let shell = shell_cmd.unwrap_or_else(...)` through `.context("Failed to spawn command in PTY")?;` with:

```rust
        let shell = shell_cmd.unwrap_or_else(|| {
            std::env::var("SHELL").unwrap_or_else(|_| {
                if cfg!(windows) {
                    "powershell.exe".to_string()
                } else {
                    "/bin/bash".to_string()
                }
            })
        });

        let working_dir = resolve_cwd(cwd.as_deref());

        // Prefer tmux. The shell then belongs to the tmux server rather than to
        // us, so restarting or crashing the daemon detaches instead of killing —
        // which is the entire reason this stage exists. Everything about the
        // fallback path below is what shipped before, so a machine without tmux
        // is no worse off than yesterday, only less durable.
        let (mut cmd, tmux_handle, durability_detail) =
            match build_tmux_command(&id, cols, rows, &shell) {
                Ok(built) => built,
                Err(reason) => {
                    log::info!("session {}: direct spawn ({})", id, reason);
                    let mut cmd = CommandBuilder::new(&shell);
                    apply_shell_integration(&mut cmd, &shell);
                    (cmd, None, Some(reason))
                }
            };

        cmd.cwd(&working_dir);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("DOOM_TERM", "1");

        let child = pair
            .slave
            .spawn_command(cmd)
            .context("Failed to spawn command in PTY")?;
```

Add these free functions to `session.rs`, above `impl PtySession`:

```rust
/// The directory a session should start in, falling back the way the previous
/// inline version did: requested, then home, then wherever the daemon runs.
fn resolve_cwd(requested: Option<&str>) -> std::path::PathBuf {
    if let Some(dir) = requested {
        let expanded = expand_path(dir);
        if expanded.exists() {
            return expanded;
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        return std::path::PathBuf::from(home);
    }
    std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/"))
}

/// Build the tmux client command, or say why we cannot.
///
/// The error is a sentence for a human, not a code: it is shown in the UI, and
/// "tmux not found" is the difference between a user installing tmux and a user
/// assuming their sessions are durable when they are not.
type TmuxCommand = (CommandBuilder, Option<TmuxHandle>, Option<String>);

fn build_tmux_command(
    id: &str,
    cols: u16,
    rows: u16,
    shell: &str,
) -> std::result::Result<TmuxCommand, String> {
    if std::env::var("DOOM_TERM_NO_TMUX").is_ok() {
        return Err("disabled by DOOM_TERM_NO_TMUX".to_string());
    }
    let exe = tmux::resolve_tmux(sidecar_dir().as_deref())
        .ok_or_else(|| "tmux not found on PATH".to_string())?;

    let version = std::process::Command::new(&exe)
        .arg("-V")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    if !tmux::version_supported(&version) {
        return Err(format!(
            "tmux {} is too old; {}.{} or newer is required",
            version.trim().trim_start_matches("tmux ").trim(),
            tmux::MIN_MAJOR,
            tmux::MIN_MINOR
        ));
    }

    let conf = tmux::write_config().ok_or_else(|| "could not write the tmux config".to_string())?;
    let name = tmux::session_name(id);
    let launch = shell_launch(shell);

    let mut cmd = CommandBuilder::new(&exe);
    for arg in tmux::new_session_args(
        &conf, &name, cols, rows, &launch.env, shell, &launch.args,
    ) {
        cmd.arg(arg);
    }
    // No -c here, deliberately: it would have to precede `--`, and everything
    // after `--` belongs to the shell. `new-session` without -c takes the
    // client's own working directory, and the caller sets that with cmd.cwd()
    // immediately below — so the directory arrives the same way it does on the
    // direct-spawn path. An already-existing session keeps the directory it was
    // created in regardless, which is right: the user's `cd` history lives there.

    Ok((cmd, Some(TmuxHandle { exe, name }), None))
}

/// Where a bundled tmux would live: beside the daemon executable, which is how
/// Tauri lays sidecars out.
fn sidecar_dir() -> Option<std::path::PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
}
```

Store the new fields in the returned `Self { ... }`: add `tmux: tmux_handle,` and `durability_detail,`.

Replace `shell_pid`, and add the two accessors:

```rust
    /// The pid whose /proc entry names the foreground command.
    ///
    /// Under tmux this is the pane's shell, not the client we spawned: the
    /// client is what sits in the foreground of OUR pty, so asking about it
    /// reports tmux forever and the agent well never lights up. The name and
    /// signature are unchanged so callers do not have to know which case holds.
    pub fn shell_pid(&self) -> Option<u32> {
        match &self.tmux {
            Some(handle) => handle.pane_pid(),
            None => self.shell_pid_direct,
        }
    }

    pub fn is_durable(&self) -> bool {
        self.tmux.is_some()
    }

    pub fn durability_detail(&self) -> Option<String> {
        self.durability_detail.clone()
    }
```

Rename the existing `shell_pid` **field** to `shell_pid_direct` (declaration and the two assignments in `spawn`).

Replace `kill` and the `killpg` targets in `send_signal`:

```rust
    /// The pid to signal: the pane's shell under tmux, ours otherwise.
    fn signal_target(&self) -> Option<u32> {
        match &self.tmux {
            Some(handle) => handle.pane_pid(),
            None => self.child_pid,
        }
    }

    pub fn kill(&self) -> Result<()> {
        self.running.store(false, Ordering::Relaxed);
        // Under tmux, killing our own child only detaches the client and the
        // shell keeps running with nothing attached to it — a leak the user
        // cannot see or reach. Closing a tab has to close the session.
        if let Some(handle) = &self.tmux {
            handle.kill_session();
        }
        let _ = self.send_signal("SIGKILL");
        Ok(())
    }
```

In `send_signal`, replace each `if let Some(pid) = self.child_pid {` with `if let Some(pid) = self.signal_target() {`.

Finally, in `backend/src/main.rs`, in the `ClientMessage::Spawn` arm, replace `sessions.write().insert(id, Arc::new(session));` with:

```rust
                Ok(session) => {
                    let _ = tx.send(ServerMessage::SessionMode {
                        session_id: id.clone(),
                        durable: session.is_durable(),
                        detail: session.durability_detail(),
                    });
                    sessions.write().insert(id, Arc::new(session));
                }
```

And append a variant to the end of the `ServerMessage` enum — appended, so the uncommitted `Telemetry` hunk is untouched:

```rust
    /// Whether this session survives the daemon, and why not when it does not.
    ///
    /// Reported rather than assumed: a durability guarantee that silently is
    /// not one is worse than no guarantee, because the user acts on it — they
    /// leave an agent running and close the lid.
    SessionMode {
        session_id: String,
        durable: bool,
        detail: Option<String>,
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path crates/doom-term-pty/Cargo.toml && cargo test --manifest-path backend/Cargo.toml`
Expected: PASS — 44 in the crate, 2 in the backend.

- [ ] **Step 5: Verify the diff did not touch the uncommitted hunk**

Run: `git diff backend/src/main.rs | grep -c "session_id: Option<String>"`
Expected: `0`. If it is not 0, the Telemetry struct was touched; revert that part.

- [ ] **Step 6: Commit**

```bash
git add crates/doom-term-pty/src/tmux.rs crates/doom-term-pty/src/session.rs backend/src/main.rs
git commit -m "feat(pty): host the shell in tmux and route identity, signals and kill through the pane"
```

---

### Task 5: Recover scrollback on reattach

A fresh tmux attach repaints the visible screen only, so everything above the fold is lost on every reconnect — which is exactly the moment a user most wants to see what happened while they were gone. `capture-pane -S -N -E -1` returns history *without* the visible screen, so it can be emitted before attaching with no duplication.

**Files:**
- Modify: `crates/doom-term-pty/src/tmux.rs`
- Modify: `crates/doom-term-pty/src/session.rs`

**Interfaces:**
- Consumes: `TmuxHandle` (Task 4).
- Produces: `impl TmuxHandle { pub fn capture_args(&self, lines: u32) -> Vec<String>; pub fn capture_history(&self, lines: u32) -> Option<String> }`, and `pub const REPLAY_LINES: u32 = 2000;`

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `crates/doom-term-pty/src/tmux.rs`:

```rust
    #[test]
    fn history_capture_stops_where_the_visible_screen_starts() {
        // -E -1 is the whole trick: line 0 is the top of the visible pane, so
        // ending at -1 takes the history and nothing else. Without it the
        // replay repeats every visible line, and the attach repaint then draws
        // them a second time.
        let h = TmuxHandle { exe: PathBuf::from("/usr/bin/tmux"), name: "doom-n1".into() };
        assert_eq!(
            h.capture_args(2000),
            vec!["capture-pane", "-p", "-e", "-t", "doom-n1", "-S", "-2000", "-E", "-1"]
        );
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path crates/doom-term-pty/Cargo.toml tmux::history_capture`
Expected: FAIL — `capture_args` is not defined.

- [ ] **Step 3: Write the implementation**

Add to `TmuxHandle` in `crates/doom-term-pty/src/tmux.rs`:

```rust
    pub fn capture_args(&self, lines: u32) -> Vec<String> {
        vec![
            "capture-pane".into(),
            "-p".into(),
            // Keep the colours. Without -e the replay comes back grey and looks
            // like a different session than the one being resumed.
            "-e".into(),
            "-t".into(),
            self.name.clone(),
            "-S".into(),
            format!("-{}", lines),
            // Line 0 is the top of the visible pane, so -1 is the last line of
            // history. The attach repaint draws the visible screen itself.
            "-E".into(),
            "-1".into(),
        ]
    }

    /// Scrollback above the fold, or None when there is none to recover.
    pub fn capture_history(&self, lines: u32) -> Option<String> {
        let out = std::process::Command::new(&self.exe)
            .args(self.capture_args(lines))
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&out.stdout).to_string();
        if text.trim().is_empty() {
            None
        } else {
            Some(text)
        }
    }
```

Add near the top of `tmux.rs`:

```rust
/// How much scrollback to replay on reattach. Bounded because it arrives as one
/// event: `history-limit` is 5000, and replaying all of it stalls the first
/// frame after a reconnect for no benefit anyone can read.
pub const REPLAY_LINES: u32 = 2000;
```

In `session.rs`, inside `spawn`, immediately after `build_tmux_command` succeeds and **before** `pair.slave.spawn_command(cmd)`, capture from a session that already exists:

```rust
        // Ask before attaching: the client repaints the visible screen as soon
        // as it connects, and history is only distinguishable from it while the
        // client is not there yet.
        let replay_history = tmux_handle
            .as_ref()
            .filter(|handle| handle.has_session())
            .and_then(|handle| handle.capture_history(tmux::REPLAY_LINES));
```

Then emit it **before** `thread::spawn` — `event_callback` is moved into the reader thread, so this is the last point at which it is still owned here, and it also puts the recovered scrollback ahead of anything the attach paints:

```rust
        if let Some(history) = replay_history {
            // Above the live screen rather than through it: capture-pane was
            // asked for history only (-E -1), so nothing here is repainted by
            // the attach that follows.
            event_callback(DemuxEvent::Output { data: history });
        }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path crates/doom-term-pty/Cargo.toml && cargo build --manifest-path backend/Cargo.toml`
Expected: PASS — 45 in the crate; the backend compiles.

- [ ] **Step 5: Commit**

```bash
git add crates/doom-term-pty/src/tmux.rs crates/doom-term-pty/src/session.rs
git commit -m "feat(tmux): replay scrollback above the fold when reattaching"
```

---

### Task 6: Say plainly when a session is not durable

**Files:**
- Modify: `src/core/ptyClient.ts`
- Create: `src/components/SessionModeNotice.tsx`
- Create: `src/components/SessionModeNotice.test.tsx`
- Modify: `src/App.tsx:385` (insert above the existing `<div className="flex-1 flex min-h-0 min-w-0">`)

**Interfaces:**
- Consumes: `ServerMessage::SessionMode { session_id, durable, detail }` from Task 4.
- Produces:
  - `ptyClient.getSessionMode(id: string): { durable: boolean; detail: string | null } | null`
  - `ptyClient.onSessionMode(cb: (id: string, durable: boolean, detail: string | null) => void): () => void`
  - `<SessionModeNotice sessionId={string | null} />`

- [ ] **Step 1: Write the failing test**

Create `src/components/SessionModeNotice.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SessionModeNotice } from './SessionModeNotice';
import { ptyClient } from '../core/ptyClient';

afterEach(cleanup);

function report(id: string, durable: boolean, detail: string | null) {
  (ptyClient as unknown as {
    handleServerMessage: (m: { event: string; data: unknown }) => void;
  }).handleServerMessage({
    event: 'SessionMode',
    data: { session_id: id, durable, detail },
  });
}

describe('SessionModeNotice', () => {
  it('says nothing when the session survives the daemon', () => {
    report('s1', true, null);
    const { container } = render(<SessionModeNotice sessionId="s1" />);
    expect(container.textContent).toBe('');
  });

  it('names the reason when durability was wanted and not available', () => {
    // Silence here is the failure mode that matters: a user who believes a
    // session is durable leaves an agent running and closes the lid.
    //
    // Asserted on textContent rather than getByText: the notice interpolates
    // the reason, so the text spans several nodes inside one div and every
    // ancestor matches the same query.
    report('s2', false, 'tmux not found on PATH');
    const { container } = render(<SessionModeNotice sessionId="s2" />);
    expect(container.textContent).toContain('SESSION NOT DURABLE');
    expect(container.textContent).toContain('tmux not found on PATH');
  });

  it('does not nag when durability was switched off on purpose', () => {
    // An explicit opt-out is a decision already made, not a problem to report.
    report('s3', false, 'disabled by DOOM_TERM_NO_TMUX');
    const { container } = render(<SessionModeNotice sessionId="s3" />);
    expect(container.textContent).toBe('');
  });

  it('says nothing about a session the daemon has not described', () => {
    const { container } = render(<SessionModeNotice sessionId="unknown" />);
    expect(container.textContent).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/SessionModeNotice.test.tsx`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write the implementation**

In `src/core/ptyClient.ts`, add the field beside the other handler maps:

```ts
  private sessionModes = new Map<string, { durable: boolean; detail: string | null }>();
  private sessionModeHandlers = new Set<
    (id: string, durable: boolean, detail: string | null) => void
  >();
```

Add the public surface next to `onTelemetry`:

```ts
  public getSessionMode(id: string): { durable: boolean; detail: string | null } | null {
    return this.sessionModes.get(id) ?? null;
  }

  public onSessionMode(
    cb: (id: string, durable: boolean, detail: string | null) => void
  ): () => void {
    this.sessionModeHandlers.add(cb);
    return () => this.sessionModeHandlers.delete(cb);
  }
```

In `handleServerMessage`, add a branch beside the `Telemetry` one:

```ts
    } else if (msg.event === 'SessionMode') {
      const mode = msg.data as {
        session_id: string;
        durable: boolean;
        detail: string | null;
      };
      this.sessionModes.set(mode.session_id, {
        durable: mode.durable,
        detail: mode.detail ?? null,
      });
      this.sessionModeHandlers.forEach((cb) =>
        cb(mode.session_id, mode.durable, mode.detail ?? null)
      );
```

Create `src/components/SessionModeNotice.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { ptyClient } from '../core/ptyClient';

/**
 * A one-line notice when the active session will not survive the daemon.
 *
 * Shown rather than assumed, because the user acts on durability: they leave an
 * agent running and close the lid. Silence has to mean "this survives".
 *
 * An explicit opt-out is not reported. Someone who set DOOM_TERM_NO_TMUX has
 * already made the decision, and a permanent banner restating it is nagging.
 */
const OPTED_OUT = 'disabled by DOOM_TERM_NO_TMUX';

export function SessionModeNotice({ sessionId }: { sessionId: string | null }) {
  const [, bump] = useState(0);

  useEffect(() => ptyClient.onSessionMode(() => bump((n) => n + 1)), []);

  if (!sessionId) return null;
  const mode = ptyClient.getSessionMode(sessionId);
  if (!mode || mode.durable) return null;
  if (mode.detail === OPTED_OUT) return null;

  return (
    <div
      className="shrink-0 px-2 py-0.5 text-[10px] tracking-wide font-mono"
      style={{ background: 'var(--rail-warn, #4a3a12)', color: 'var(--ink, #d8cbb0)' }}
    >
      SESSION NOT DURABLE — {mode.detail ?? 'reason unknown'}. This shell ends with the daemon.
    </div>
  );
}
```

In `src/App.tsx`, add the import beside the other component imports:

```tsx
import { SessionModeNotice } from './components/SessionModeNotice';
```

and insert directly above the `<div className="flex-1 flex min-h-0 min-w-0">` at line 385:

```tsx
      <SessionModeNotice sessionId={activeNode?.id ?? null} />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/SessionModeNotice.test.tsx && npx tsc --noEmit`
Expected: PASS — 4 tests, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/ptyClient.ts src/components/SessionModeNotice.tsx src/components/SessionModeNotice.test.tsx src/App.tsx
git commit -m "feat(ui): report plainly when a session will not outlive the daemon"
```

---

### Task 7: Restore the alt-screen signal that `smcup@` costs

With `smcup@`, a full-screen program inside the pane no longer emits `ESC[?1049h` to our screen model, so `isAltScreen()` at `usePtyEvents.ts:194` is permanently false and such a program renders through the block path — the mangled-redraw failure the code already documents at line 202. Recognised agents are unaffected because line 207 already covers them; `vim`, `htop` and `less` are not.

tmux still knows. `#{alternate_on}` is polled and delivered as the existing `TuiMode` event, so no new wire type is needed. The cost is honest and worth stating: the switch is up to one poll interval late.

**Files:**
- Modify: `crates/doom-term-pty/src/tmux.rs`
- Modify: `crates/doom-term-pty/src/session.rs`
- Modify: `src/hooks/usePtyEvents.ts:192-200`
- Modify: `src/hooks/usePtyEvents.test.ts` (or create if absent)

**Interfaces:**
- Consumes: `TmuxHandle` (Task 4), `DemuxEvent::TuiMode { active }` (existing).
- Produces: `impl TmuxHandle { pub fn alternate_on(&self) -> Option<bool> }`, and a `PtySession` background poll emitting `TuiMode` on change only.

- [ ] **Step 1: Write the failing tests**

Add to `crates/doom-term-pty/src/tmux.rs` tests:

```rust
    #[test]
    fn the_alternate_screen_flag_is_asked_of_the_pane() {
        // Removing smcup from the client's terminfo is what keeps our screen
        // model in the primary buffer, and the price is that a full-screen
        // program in the pane no longer announces itself to us. tmux still
        // knows, so we ask it rather than lose the signal.
        let h = TmuxHandle { exe: PathBuf::from("/usr/bin/tmux"), name: "doom-n1".into() };
        assert_eq!(
            h.query_args("#{alternate_on}"),
            vec!["display-message", "-p", "-t", "doom-n1", "#{alternate_on}"]
        );
    }
```

Create `src/hooks/usePtyEvents.altScreen.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveTuiState } from './usePtyEvents';

describe('resolveTuiState', () => {
  it('trusts the screen when nothing has reported otherwise', () => {
    expect(resolveTuiState(true, undefined)).toBe(true);
    expect(resolveTuiState(false, undefined)).toBe(false);
  });

  it('prefers what the daemon reported over what the screen can see', () => {
    // Under tmux the screen CANNOT see it: the alternate screen is deliberately
    // disabled on the client so scrollback and blocks survive, which means a
    // full-screen program in the pane leaves no trace in our buffer type.
    expect(resolveTuiState(false, true)).toBe(true);
  });

  it('lets the daemon clear it again when the program exits', () => {
    // A latch that only ever sets would leave the pane in grid mode forever
    // after the first vim.
    expect(resolveTuiState(false, false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path crates/doom-term-pty/Cargo.toml tmux::the_alternate && npx vitest run src/hooks/usePtyEvents.altScreen.test.ts`
Expected: FAIL both — `query_args` for that format is untested and `resolveTuiState` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `TmuxHandle` in `tmux.rs`:

```rust
    /// Whether the pane's program is on the alternate screen.
    ///
    /// Our own screen model cannot answer this: `smcup@` deliberately keeps the
    /// client out of the alternate buffer so scrollback and command blocks
    /// survive, and the side effect is that a full-screen program in the pane
    /// is invisible to us. tmux is the only remaining witness.
    pub fn alternate_on(&self) -> Option<bool> {
        Some(self.query("#{alternate_on}")? == "1")
    }
```

Add to `tmux.rs`:

```rust
/// How often to ask tmux whether the pane went full-screen. A render decision
/// that used to be per-frame becomes per-tick, so the switch can be this late.
/// Recognised agents do not depend on it — they are identified by process — so
/// this only paces vim, htop and their kind.
pub const ALT_POLL: std::time::Duration = std::time::Duration::from_millis(500);
```

In `session.rs`, after the reader thread is spawned, add the poll. `event_callback` is already moved, so clone the handle and use a second sender — pass a second callback into `spawn`. To avoid changing the signature, spawn this thread **before** the reader thread and give it its own `Box<dyn FnMut>` cloned from the caller's channel. The simplest correct shape, given `event_callback` is `FnMut + Send`, is to wrap it once in an `Arc<Mutex<...>>` shared by both threads:

```rust
        let shared_callback = Arc::new(parking_lot::Mutex::new(event_callback));

        // The alternate-screen poll. Emits only on change: the frontend treats
        // TuiMode as a state report, and a repeated one would re-render the pane
        // twice a second for no reason.
        if let Some(handle) = tmux_handle.clone() {
            let running_poll = running.clone();
            let poll_callback = shared_callback.clone();
            thread::spawn(move || {
                let mut last: Option<bool> = None;
                while running_poll.load(Ordering::Relaxed) {
                    if let Some(active) = handle.alternate_on() {
                        if last != Some(active) {
                            last = Some(active);
                            (poll_callback.lock())(DemuxEvent::TuiMode { active });
                        }
                    }
                    thread::sleep(tmux::ALT_POLL);
                }
            });
        }
```

Then replace **every** remaining `event_callback(x)` with `(shared_callback.lock())(x)` — both the calls inside the reader thread and the scrollback replay Task 5 added just before `thread::spawn`. `event_callback` is now moved into the `Arc` at the top, so any surviving direct call will fail to compile; that is the intended safety net, not a problem to work around.

In `src/hooks/usePtyEvents.ts`, export the pure resolver above the hook:

```ts
/**
 * Which source decides whether the pane is full-screen.
 *
 * The screen model is the default and is right without tmux. Under tmux it is
 * structurally blind: the client is kept out of the alternate buffer on purpose
 * so scrollback and command blocks keep working, so a full-screen program in
 * the pane never touches our buffer type. When the daemon has reported a state,
 * it is the only one that saw the truth.
 */
export function resolveTuiState(
  screenSaysAlt: boolean,
  daemonReported: boolean | undefined
): boolean {
  return daemonReported ?? screenSaysAlt;
}
```

Add a module-scope map beside the hook's other per-session state:

```ts
const reportedTuiState = new Map<string, boolean>();
```

In the `onTuiMode` handler at line 148, record it before the existing state update:

```ts
      onTuiMode: (active) => {
        const id = ptyClient.getSessionId();
        reportedTuiState.set(id, active);
```

And at line 194, replace:

```ts
      const inAltScreen = emu.isAltScreen();
```

with:

```ts
      const inAltScreen = resolveTuiState(emu.isAltScreen(), reportedTuiState.get(sessionId));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path crates/doom-term-pty/Cargo.toml && npx vitest run && npx tsc --noEmit`
Expected: PASS — 46 Rust tests in the crate, all TS tests green.

- [ ] **Step 5: Commit**

```bash
git add crates/doom-term-pty/src/tmux.rs crates/doom-term-pty/src/session.rs src/hooks/usePtyEvents.ts src/hooks/usePtyEvents.altScreen.test.ts
git commit -m "feat(tmux): recover the alt-screen signal that disabling smcup costs"
```

---

### Task 8: Bundle tmux, and carry its notices

Separable on purpose: Tasks 1–7 deliver durability wherever tmux is installed, and `resolve_tmux` already prefers a bundled binary, so this task adds a file to disk and changes no code path. If per-platform packaging stalls, nothing above it is blocked.

Windows has no tmux; `resolve_tmux` returns None there and Task 6 reports it. That is the honest outcome, not a gap to paper over.

**Files:**
- Create: `tools/build-tmux-sidecar.mjs`
- Create: `THIRD-PARTY-NOTICES.md`
- Modify: `src-tauri/tauri.conf.json` (add to `bundle.externalBin`)
- Modify: `package.json` (add the `sidecar:tmux` script and chain it into `sidecar`)

**Interfaces:**
- Consumes: `resolve_tmux`'s sidecar-first lookup (Task 1) — the binary must land beside the daemon as `tmux-<triple>`.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the notices file**

Create `THIRD-PARTY-NOTICES.md`:

```markdown
# Third-party notices

Doom Term is MIT licensed. It bundles and depends on the following, whose
licences require attribution.

## tmux — ISC

Copyright (c) Nicholas Marriott and contributors.
Bundled as an executable sidecar; unmodified. <https://github.com/tmux/tmux>

Permission to use, copy, modify, and distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.

## libevent — BSD-3-Clause

Copyright (c) Niels Provos, Nick Mathewson and contributors.
Linked into the bundled tmux. <https://libevent.org/>

## ncurses — MIT-like (X11-style)

Copyright (c) Thomas E. Dickey and contributors.
Linked into the bundled tmux. <https://invisible-island.net/ncurses/>

## @xterm/headless, @xterm/addon-unicode11 — MIT

Copyright (c) The xterm.js authors. <https://github.com/xtermjs/xterm.js>

## Prior art

Doom Term's durable-session design was informed by reading nodeterm
(BUSL-1.1, © Enes Kirca), which uses tmux the same way. No nodeterm code or
documentation was copied; the techniques are independently implemented here.
```

- [ ] **Step 2: Write the packaging script**

Create `tools/build-tmux-sidecar.mjs`:

```javascript
#!/usr/bin/env node
/**
 * Installs tmux as a second Tauri sidecar.
 *
 * Unlike the daemon, tmux is not ours to build from this repo: it is a C
 * program needing libevent and ncurses, and producing a static binary per
 * target is platform work that does not belong in a Node script. So this takes
 * a path to a binary you have already obtained or built, verifies it runs and
 * is new enough, and installs it under the name Tauri expects.
 *
 * Absent a binary this exits 0 with a message rather than failing the build:
 * a bundle without tmux is a working application with non-durable sessions,
 * which the UI reports, and that is a legitimate build.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN = [3, 3];

function hostTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const match = out.match(/^host:\s*(\S+)$/m);
  if (!match) throw new Error('could not read the host triple from `rustc -vV`');
  return match[1];
}

const source = process.env.DOOM_TMUX_BINARY;
if (!source) {
  console.log(
    'sidecar:tmux skipped — set DOOM_TMUX_BINARY to a tmux >= 3.3 executable to bundle one.'
  );
  process.exit(0);
}
if (!fs.existsSync(source)) {
  throw new Error(`DOOM_TMUX_BINARY points at ${source}, which does not exist`);
}

const version = execFileSync(source, ['-V'], { encoding: 'utf8' });
const parsed = version.match(/(\d+)\.(\d+)/);
if (!parsed) {
  throw new Error(`could not read a version from \`${source} -V\`: ${version.trim()}`);
}
const [, major, minor] = parsed.map(Number);
if (major < MIN[0] || (major === MIN[0] && minor < MIN[1])) {
  // Below 3.3 there is no allow-passthrough, so the shell's OSC 133 never
  // reaches the app and command blocks stop working with no error anywhere.
  throw new Error(`${source} is tmux ${major}.${minor}; ${MIN.join('.')} or newer is required`);
}

const triple = hostTriple();
const exe = process.platform === 'win32' ? '.exe' : '';
const destDir = path.join(root, 'src-tauri/binaries');
const dest = path.join(destDir, `tmux-${triple}${exe}`);

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(source, dest);
fs.chmodSync(dest, 0o755);

console.log(`tmux sidecar installed: ${path.relative(root, dest)} (tmux ${major}.${minor})`);
```

- [ ] **Step 3: Wire it into the build**

In `package.json`, change the `sidecar` script and add the new one:

```json
    "sidecar": "npm run sidecar:daemon && npm run sidecar:tmux",
    "sidecar:daemon": "node tools/build-sidecar.mjs",
    "sidecar:tmux": "node tools/build-tmux-sidecar.mjs",
```

In `src-tauri/tauri.conf.json`, add to `bundle.externalBin`:

```json
    "externalBin": [
      "binaries/doom-term-server",
      "binaries/tmux"
    ],
```

- [ ] **Step 4: Verify both paths**

Run: `npm run sidecar`
Expected: the daemon installs as before, and `sidecar:tmux skipped — set DOOM_TMUX_BINARY…`.

Run: `DOOM_TMUX_BINARY=$(which tmux) npm run sidecar:tmux && ls src-tauri/binaries/`
Expected: `tmux-x86_64-unknown-linux-gnu` present alongside the daemon.

Note: the system tmux on this machine is dynamically linked against libsystemd, libutempter, libtinfo and libevent_core, so copying it is fine for a local build but **not** shippable. A release bundle needs a statically linked tmux. Record that in the release checklist rather than pretending the copy is sufficient.

Run: `rm src-tauri/binaries/tmux-* && npm run build`
Expected: clean build; the removal keeps the repo from carrying a non-redistributable binary.

- [ ] **Step 5: Commit**

```bash
git add tools/build-tmux-sidecar.mjs THIRD-PARTY-NOTICES.md package.json src-tauri/tauri.conf.json
git commit -m "build: bundle tmux as a sidecar and carry its notices"
```

---

## Final verification

- [ ] `cargo test --manifest-path crates/doom-term-pty/Cargo.toml` — 46 passing
- [ ] `cargo test --manifest-path backend/Cargo.toml` — 2 passing
- [ ] `npx tsc --noEmit` — clean
- [ ] `npx vitest run` — 190+ passing
- [ ] `npm run build` — succeeds
- [ ] `git status --short` — the eleven uncommitted files listed in Global Constraints are still `M` and unstaged, and `git diff backend/src/main.rs` still contains the `Telemetry`/`session_id` hunk unchanged

## Live verification

Per `doom-term-two-tabs-fight-over-sessions`, **close duplicate browser tabs first** — shared `localStorage` manufactures phantom bugs.

- [ ] `tmux ls` shows a `doom-<id>` session per open pane
- [ ] Command blocks still open and close, with exit codes and durations — this proves the passthrough wrapper works end to end
- [ ] `cd /tmp` moves the status plate — proves OSC 7 survives too
- [ ] The plate identifies a running agent — proves `pane_pid` identity
- [ ] **The payoff:** start `claude` in a pane, `pkill doom-term-server`, wait for the client to reconnect. The agent is still running and its screen comes back, with scrollback above it
- [ ] `echo $COLUMNS && echo $LINES` matches the pane and changes on resize — tmux must not have broken Stage A
- [ ] `printf 'café 🎉 日本語 |\n'` renders correctly — Stage B's Unicode path through tmux
- [ ] Run `vim`, confirm it renders as a grid within ~0.5s and the pane returns to blocks on `:q`
- [ ] Closing a tab removes the session from `tmux ls` — no invisible leak
- [ ] `DOOM_TERM_NO_TMUX=1` restarts into direct spawn with no notice shown
- [ ] Temporarily rename tmux off `$PATH`: the notice reads "SESSION NOT DURABLE — tmux not found on PATH"

## Found during execution — three defects the plan did not anticipate

All three were invisible to the test suite and were caught only by driving the
real daemon. They are fixed in `1c0613d`; recorded here because the plan as
written would have shipped them.

1. **`-f <conf>` is honoured only when the tmux server starts.** Against a
   server already running on the default socket — the normal case — it is
   silently ignored, taking the entire config with it: passthrough off, smcup
   in place, status bar and prefix back. Everything Tasks 2–7 depend on. Fixed
   by running our own server on `-L doom-term`, which also guarantees we can
   never adopt, resize or kill a session the user made by hand. Every
   `TmuxHandle` invocation names the socket too, or it would query a stranger.

2. **Bash expands PS0 and PS1 in two passes.** Prompt expansion, then parameter
   expansion and quote removal. The DCS terminator's backslash fused with
   whatever followed: against systemd's `$(...)` in PS0 it became the `\$`
   prompt escape, leaving the sequence unterminated so tmux swallowed the
   output of every command; against `\]` in PS1 it printed a stray `]`. The
   prompt strings need **four** backslashes — each pass halves them.

3. **The daemon can be launched from inside someone else's tmux** and hands its
   environment to the client. `$TMUX` is exactly what the integration script
   tests to decide whether to wrap, so it would wrap for the wrong server.
   `env_remove("TMUX")` on the client.

Verified end to end afterwards: all four OSC 133 boundaries arrive as block
events with correct exit codes (0 for `echo`, 1 for `false`), OSC 7 follows a
`cd`, and a shell keeps its variables across a SIGKILLed daemon with the same
pane pid and its scrollback replayed.

## Known limitations, stated rather than discovered

- **Windows gets no durability.** There is no tmux; the notice says so.
- **Alt-screen detection is up to 500ms late** for programs that are not recognised agents. Task 7's trade-off, taken deliberately to keep scrollback and blocks.
- **Sessions can leak if the app forgets an id.** Clearing `localStorage` orphans `doom-*` sessions with no UI to reach them. They are on a private socket, so `tmux ls` will not show them — use `tmux -L doom-term ls`, and `tmux -L doom-term kill-server` to clear them. A session adopter is possible later; it is not in this stage.
- **The 500-event ring is now redundant on the tmux path but still replays.** `ClientMessage::Reattach` replays it when a pane re-mounts inside one connection, which under tmux duplicates lines xterm already holds. The spec anticipated the ring's role shrinking to in-flight events; that trim is not in this stage because it changes the direct-spawn path too, and doing it here would mean touching reattach semantics for both substrates at once.
- **A bundled tmux must be statically linked.** The local build copies the system binary, which is not redistributable.
