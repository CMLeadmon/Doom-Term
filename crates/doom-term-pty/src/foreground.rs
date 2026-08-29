//! Who is actually running in the terminal.
//!
//! The only honest answer comes from the kernel: /proc/<pid>/stat field 8
//! (`tpgid`) is the foreground process group of the controlling terminal, and
//! /proc/<tpgid>/comm is the command in it. Never guess from a tab title.

/// What the plate needs to render an agent. There is deliberately no `model`
/// field: no agent CLI reports its model to the terminal, so any model string
/// here would be invented.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentIdentity {
    pub key: &'static str,
    pub name: &'static str,
}

/// Field 8 of /proc/<pid>/stat. `comm` (field 2) is parenthesised and may
/// contain ')' and spaces, so split after the LAST ')': the remaining fields
/// are state, ppid, pgrp, session, tty_nr, tpgid — tpgid is index 5.
fn parse_tpgid(stat: &str) -> Option<i32> {
    let after_comm = stat.rsplit_once(')')?.1;
    let tpgid: i32 = after_comm.split_whitespace().nth(5)?.parse().ok()?;
    if tpgid <= 0 {
        None
    } else {
        Some(tpgid)
    }
}

/// The command currently in the foreground of `shell_pid`'s terminal.
/// Returns None off Linux, or when the shell itself is in the foreground.
pub fn foreground_command(shell_pid: u32) -> Option<String> {
    let stat = std::fs::read_to_string(format!("/proc/{}/stat", shell_pid)).ok()?;
    let tpgid = parse_tpgid(&stat)?;
    let comm = std::fs::read_to_string(format!("/proc/{}/comm", tpgid)).ok()?;
    Some(comm.trim().to_string())
}

/// Map a real process name to a plate identity. Unknown binaries are not
/// agents — a plain command must never light up the agent well.
pub fn classify_agent(comm: &str) -> Option<AgentIdentity> {
    let (key, name) = match comm {
        "claude" => ("claude", "CLAUDE CODE"),
        "codex" => ("codex", "CODEX"),
        "gemini" => ("gemini", "GEMINI CLI"),
        "agy" | "antigravity" => ("gemini", "ANTIGRAVITY"),
        "aider" => ("claude", "AIDER"),
        "opencode" => ("opencode", "OPENCODE"),
        "grok" => ("grok", "GROK CLI"),
        "copilot" => ("copilot", "GITHUB COPILOT"),
        _ => return None,
    };
    Some(AgentIdentity { key, name })
}

/// Isolation is reported, never assumed. The daemon spawns onto the host, so
/// the only true "sandbox" is the whole process being containerised.
pub fn detect_isolation() -> &'static str {
    let contained = std::path::Path::new("/run/.containerenv").exists()
        || std::path::Path::new("/.dockerenv").exists();
    if contained {
        "sandbox"
    } else {
        "host"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tpgid_from_a_stat_line_whose_comm_contains_spaces_and_parens() {
        // /proc/<pid>/stat field 2 is parenthesised and may itself contain
        // ')' and spaces, so the parse must split after the LAST ')'.
        let stat = "4242 (my )weird( proc) S 4240 4242 4242 34816 9001 4194304 …";
        assert_eq!(parse_tpgid(stat), Some(9001));
    }

    #[test]
    fn a_shell_in_the_foreground_of_its_own_terminal_is_not_an_agent() {
        assert!(classify_agent("bash").is_none());
        assert!(classify_agent("zsh").is_none());
        assert!(classify_agent("ls").is_none());
    }

    #[test]
    fn known_agent_binaries_are_identified_without_inventing_a_model() {
        let claude = classify_agent("claude").expect("claude is an agent");
        assert_eq!(claude.key, "claude");
        assert_eq!(claude.name, "CLAUDE CODE");
        assert_eq!(classify_agent("codex").unwrap().name, "CODEX");
        assert_eq!(classify_agent("gemini").unwrap().name, "GEMINI CLI");
    }

    #[test]
    fn a_negative_tpgid_means_no_controlling_terminal() {
        assert_eq!(parse_tpgid("1 (init) S 0 1 1 0 -1 4194560"), None);
    }
}
