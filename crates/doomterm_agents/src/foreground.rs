//! Identifies what a pane is running from the operating system, not from text on screen.
//!
//! A terminal title or a command line that merely mentions an agent's name proves nothing: an
//! idle shell sitting in `~/.claude` has "claude" in its title. The process in the pty's
//! foreground process group is the program the user is actually talking to.

use std::ffi::OsString;

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

/// The program in a pane's foreground, classified.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Foreground {
    /// The shell itself is waiting at its prompt.
    Shell,
    /// A program, named as the user would type it: `argv[0]`'s file name without an extension,
    /// or the script an interpreter was asked to run.
    Program { name: String, pid: u32 },
    /// A client connected to another machine.
    Remote { host: String },
}

/// Programs that only run another program named by their next argument.
const INTERPRETERS: &[&str] = &["node", "nodejs", "bun", "deno", "python", "python3"];

/// Remote-session clients. `mosh` runs `mosh-client` in the foreground once connected.
const REMOTE_CLIENTS: &[&str] = &["ssh", "autossh", "mosh", "mosh-client", "et"];

/// OpenSSH options that consume a value (`ssh(1)` SYNOPSIS).
const SSH_OPTIONS_WITH_VALUE: &str = "BbcDEeFIiJLlmOoPpQRSWw";

fn program_name(arg: &OsString) -> String {
    // Split on both separators: a Windows argv[0] uses `\`, and `Path` only treats that as a
    // separator when compiled for Windows.
    let arg = arg.to_string_lossy();
    let name = arg
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .to_lowercase();
    for suffix in [".exe", ".js", ".mjs", ".cjs", ".py"] {
        if let Some(stripped) = name.strip_suffix(suffix) {
            return stripped.to_string();
        }
    }
    name
}

/// Classifies a foreground process from its argument vector.
pub fn classify(argv: &[OsString]) -> Foreground {
    let Some(first) = argv.first() else {
        return Foreground::Program {
            name: String::new(),
            pid: 0,
        };
    };
    let mut program = program_name(first);
    let mut rest = &argv[1..];
    if INTERPRETERS.contains(&program.as_str())
        && let Some(index) = rest
            .iter()
            .position(|a| !a.to_string_lossy().starts_with('-'))
    {
        program = program_name(&rest[index]);
        rest = &rest[index + 1..];
    }

    if REMOTE_CLIENTS.contains(&program.as_str()) {
        let args: Vec<String> = rest
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        if let Some(host) = remote_host(&program, &args) {
            return Foreground::Remote { host };
        }
    }
    Foreground::Program {
        name: program,
        pid: 0,
    }
}

/// The destination host named by a remote client's arguments, without user or port.
fn remote_host(program: &str, args: &[String]) -> Option<String> {
    let destination = match program {
        "mosh-client" => args
            .iter()
            .position(|a| a == "-#")
            .and_then(|i| args.get(i + 1))
            .and_then(|spec| spec.split_whitespace().next().map(str::to_owned))
            .or_else(|| args.iter().find(|a| !a.starts_with('-')).cloned()),
        "mosh" => {
            let mut iter = args.iter();
            let mut found = None;
            while let Some(arg) = iter.next() {
                if arg == "--" {
                    found = iter.next().cloned();
                    break;
                }
                if arg == "-p" || arg == "--port" || arg == "--ssh" || arg == "--server" {
                    iter.next();
                } else if !arg.starts_with('-') {
                    found = Some(arg.clone());
                    break;
                }
            }
            found
        }
        _ => ssh_destination(args),
    }?;
    let without_scheme = destination.trim_start_matches("ssh://");
    let without_user = without_scheme.rsplit('@').next().unwrap_or(without_scheme);
    let host = without_user.split(':').next().unwrap_or(without_user);
    (!host.is_empty()).then(|| host.to_string())
}

fn ssh_destination(args: &[String]) -> Option<String> {
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg == "--" {
            return iter.next().cloned();
        }
        let Some(flags) = arg.strip_prefix('-').filter(|f| !f.is_empty()) else {
            return Some(arg.clone());
        };
        for (i, flag) in flags.char_indices() {
            if SSH_OPTIONS_WITH_VALUE.contains(flag) {
                // `-p2222` carries its value inline; `-p 2222` takes the next argument.
                if i + flag.len_utf8() == flags.len() {
                    iter.next();
                }
                break;
            }
        }
    }
    None
}

/// Reads the foreground program of a pane from the operating system.
///
/// Returns `None` when it cannot be determined (the pty is gone, or the platform gives no
/// answer), which callers must show as unknown rather than guess.
pub fn probe(
    shell_pid: u32,
    pty_leader_fd: Option<i32>,
    system: &mut System,
) -> Option<Foreground> {
    #[cfg(unix)]
    {
        let fd = pty_leader_fd?;
        // SAFETY: `tcgetpgrp` only reads terminal state for `fd`. A stale descriptor makes it
        // fail, which is reported as unknown.
        let pgid = unsafe { libc::tcgetpgrp(fd) };
        if pgid <= 0 {
            return None;
        }
        let pgid = pgid as u32;
        if pgid == shell_pid {
            return Some(Foreground::Shell);
        }
        let pid = Pid::from_u32(pgid);
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[pid]),
            true,
            ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
        );
        // A pipeline's group leader can exit before its siblings; that is still "a command".
        let Some(process) = system.process(pid) else {
            return Some(Foreground::Program {
                name: String::new(),
                pid: pgid,
            });
        };
        Some(with_pid(classify(process.cmd()), pgid))
    }
    #[cfg(windows)]
    {
        let _ = pty_leader_fd;
        foreground_by_descendants(shell_pid, system)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (shell_pid, pty_leader_fd, system);
        None
    }
}

fn with_pid(foreground: Foreground, pid: u32) -> Foreground {
    match foreground {
        Foreground::Program { name, .. } => Foreground::Program { name, pid },
        other => other,
    }
}

/// Windows has no foreground process group, so the shell's descendants are searched instead:
/// the shallowest descendant that `is_interesting` accepts wins, else the shell's first child.
#[cfg(windows)]
fn foreground_by_descendants(shell_pid: u32, system: &mut System) -> Option<Foreground> {
    // Console hosts and helpers that sit between the shell and the program the user started.
    const PLUMBING: &[&str] = &["conhost", "openconsole", "cmd"];
    use std::collections::{HashMap, VecDeque};

    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::OnlyIfNotSet),
    );
    let shell = Pid::from_u32(shell_pid);
    system.process(shell)?;
    let mut children: HashMap<Pid, Vec<Pid>> = HashMap::new();
    for (pid, process) in system.processes() {
        if let Some(parent) = process.parent() {
            children.entry(parent).or_default().push(*pid);
        }
    }
    let mut queue: VecDeque<Pid> = children.get(&shell).cloned().unwrap_or_default().into();
    if queue.is_empty() {
        return Some(Foreground::Shell);
    }
    while let Some(pid) = queue.pop_front() {
        if let Some(process) = system.process(pid) {
            match classify(process.cmd()) {
                Foreground::Program { name, .. } if PLUMBING.contains(&name.as_str()) => {}
                found => return Some(with_pid(found, pid.as_u32())),
            }
        }
        queue.extend(children.get(&pid).cloned().unwrap_or_default());
    }
    Some(Foreground::Shell)
}

#[cfg(test)]
#[path = "foreground_tests.rs"]
mod tests;
