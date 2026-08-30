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
