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

/// How much scrollback to replay on reattach. Bounded because it arrives as one
/// event: `history-limit` is 5000, and replaying all of it stalls the first
/// frame after a reconnect for no benefit anyone can read.
pub const REPLAY_LINES: u32 = 2000;

/// How often to ask tmux whether the pane went full-screen. A render decision
/// that used to be per-frame becomes per-tick, so the switch can be this late.
/// Recognised agents do not depend on it — they are identified by process — so
/// this only paces vim, htop and their kind.
pub const ALT_POLL: std::time::Duration = std::time::Duration::from_millis(500);

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

    /// Whether the pane's program is on the alternate screen.
    ///
    /// Our own screen model cannot answer this: `smcup@` deliberately keeps the
    /// client out of the alternate buffer so scrollback and command blocks
    /// survive, and the side effect is that a full-screen program in the pane
    /// is invisible to us. tmux is the only remaining witness.
    pub fn alternate_on(&self) -> Option<bool> {
        Some(self.query("#{alternate_on}")? == "1")
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
}
