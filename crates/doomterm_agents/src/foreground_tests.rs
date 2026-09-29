use std::ffi::OsString;

use super::{Foreground, classify};

fn argv(args: &[&str]) -> Vec<OsString> {
    args.iter().map(OsString::from).collect()
}

fn program(args: &[&str]) -> Option<String> {
    match classify(&argv(args)) {
        Foreground::Program { name, .. } => Some(name),
        _ => None,
    }
}

fn host(args: &[&str]) -> Option<String> {
    match classify(&argv(args)) {
        Foreground::Remote { host } => Some(host),
        _ => None,
    }
}

#[test]
fn programs_are_named_as_typed() {
    // argv as observed from real processes on 2026-09-27.
    assert_eq!(
        program(&["claude", "Read README.md"]).as_deref(),
        Some("claude")
    );
    assert_eq!(
        program(&["codex", "Read README.md"]).as_deref(),
        Some("codex")
    );
    assert_eq!(program(&["agy", "-i", "prompt"]).as_deref(), Some("agy"));
    assert_eq!(
        program(&["/usr/local/bin/gemini"]).as_deref(),
        Some("gemini")
    );
    assert_eq!(program(&["C:\\Tools\\codex.exe"]).as_deref(), Some("codex"));
}

#[test]
fn interpreters_are_seen_through() {
    assert_eq!(
        program(&["node", "--no-warnings", "/opt/codex/bin/codex.js", "exec"]).as_deref(),
        Some("codex")
    );
    assert_eq!(
        program(&["bun", "/home/u/.bun/bin/opencode"]).as_deref(),
        Some("opencode")
    );
    assert_eq!(program(&["node", "server.js"]).as_deref(), Some("server"));
}

#[test]
fn arguments_that_mention_an_agent_do_not_rename_the_program() {
    assert_eq!(program(&["vim", "claude-notes.md"]).as_deref(), Some("vim"));
    assert_eq!(
        program(&["cat", "/home/u/.codex/config.toml"]).as_deref(),
        Some("cat")
    );
    assert_eq!(
        program(&["claude-code-helper"]).as_deref(),
        Some("claude-code-helper")
    );
    assert_eq!(program(&[]).as_deref(), Some(""));
}

#[test]
fn ssh_destinations_skip_options_and_their_values() {
    assert_eq!(host(&["ssh", "build-box"]).as_deref(), Some("build-box"));
    assert_eq!(
        host(&[
            "ssh",
            "-i",
            "/k/key",
            "-p",
            "2222",
            "-o",
            "StrictHostKeyChecking=no",
            "reviewer@127.0.0.1"
        ])
        .as_deref(),
        Some("127.0.0.1")
    );
    assert_eq!(
        host(&["ssh", "-tt", "-p2222", "me@example.org", "ls"]).as_deref(),
        Some("example.org")
    );
    assert_eq!(
        host(&["ssh", "-J", "jump", "-A", "target"]).as_deref(),
        Some("target")
    );
    assert_eq!(host(&["ssh", "--", "host"]).as_deref(), Some("host"));
    assert_eq!(
        host(&["ssh", "ssh://git@forge:2222"]).as_deref(),
        Some("forge")
    );
    assert_eq!(
        program(&["ssh", "-V"]).as_deref(),
        Some("ssh"),
        "no destination: not a session"
    );
}

#[test]
fn mosh_destinations() {
    assert_eq!(
        host(&["mosh", "--ssh=ssh -p 2222", "me@box"]).as_deref(),
        Some("box")
    );
    assert_eq!(
        host(&["mosh", "-p", "60001", "box"]).as_deref(),
        Some("box")
    );
    assert_eq!(
        host(&[
            "mosh-client",
            "-#",
            "box | 10.0.0.2 60001",
            "10.0.0.2",
            "60001"
        ])
        .as_deref(),
        Some("box")
    );
}

#[cfg(unix)]
#[test]
fn a_real_pty_reports_its_foreground_program() {
    // Spawn `sleep` in the foreground of a fresh pseudo-terminal and ask who owns it.
    use std::os::fd::AsRawFd;

    let pty = rustix_openpty();
    let Some((leader, follower_path)) = pty else {
        return;
    };
    let mut child = command::blocking::Command::new("setsid")
        .args(["-w", "sh", "-c"])
        .arg(format!(
            "exec <{follower_path} >{follower_path} 2>&1; exec sleep 5"
        ))
        .spawn()
        .expect("spawn");
    std::thread::sleep(std::time::Duration::from_millis(400));
    let mut system = sysinfo::System::new();
    let seen = super::probe(u32::MAX, Some(leader.as_raw_fd()), &mut system);
    let _ = child.kill();
    let _ = child.wait();
    assert!(
        matches!(&seen, Some(Foreground::Program { name, .. }) if name == "sleep"),
        "{seen:?}"
    );
}

#[cfg(unix)]
fn rustix_openpty() -> Option<(std::fs::File, String)> {
    use std::os::fd::FromRawFd;
    // SAFETY: plain libc pty allocation; every descriptor is owned by the returned File.
    unsafe {
        let leader = libc::posix_openpt(libc::O_RDWR | libc::O_NOCTTY);
        if leader < 0 || libc::grantpt(leader) != 0 || libc::unlockpt(leader) != 0 {
            return None;
        }
        let name = libc::ptsname(leader);
        if name.is_null() {
            return None;
        }
        let path = std::ffi::CStr::from_ptr(name)
            .to_string_lossy()
            .into_owned();
        Some((std::fs::File::from_raw_fd(leader), path))
    }
}
