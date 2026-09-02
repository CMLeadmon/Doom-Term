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

/// The working directory of whatever is in the foreground of `shell_pid`'s
/// terminal, falling back to the shell's own.
///
/// ── WHY NOT ASK THE SHELL ──────────────────────────────────────────────────
///
/// Doom Term learned the directory from OSC 7, which the integration script
/// emits from `PROMPT_COMMAND` — that is, once per prompt. `cd somewhere &&
/// claude` never draws another prompt, so the sequence never fires and the app
/// keeps reporting the directory the session started in, indefinitely.
///
/// That is not cosmetic. CONTEXT % is looked up BY directory, so a stale one
/// silently sends the lookup to a path with no transcripts and the plate reads
/// '--' for an agent that is right there. The kernel has the answer, it costs
/// one readlink, and it is true whatever the user's shell does or does not
/// emit.
///
/// The FOREGROUND process is asked first because it is the one the reading is
/// about: an agent may have changed directory since it started, and it is that
/// agent's context we are trying to describe.
pub fn foreground_cwd(shell_pid: u32) -> Option<String> {
    let read = |pid: i64| {
        std::fs::read_link(format!("/proc/{}/cwd", pid))
            .ok()
            .map(|p| p.to_string_lossy().to_string())
    };

    std::fs::read_to_string(format!("/proc/{}/stat", shell_pid))
        .ok()
        .and_then(|stat| parse_tpgid(&stat))
        .and_then(|tpgid| read(tpgid as i64))
        .or_else(|| read(shell_pid as i64))
}

/// Map a real process name to a plate identity. Unknown binaries are not
/// agents — a plain command must never light up the agent well.
pub fn classify_agent(comm: &str) -> Option<AgentIdentity> {
    // The key selects which mark and which colour the plate draws, so it has to
    // name the vendor whose agent this actually is. Borrowing another vendor's
    // key puts their logo in the well: `agy` used to resolve to "gemini" and so
    // drew Gemini's star, and `aider` resolved to "claude" and drew Anthropic's
    // burst. Antigravity and Gemini CLI are different products, and aider is
    // nobody's but its own.
    let (key, name) = match comm {
        "claude" => ("claude", "CLAUDE CODE"),
        "codex" => ("codex", "CODEX"),
        "gemini" => ("gemini", "GEMINI CLI"),
        "agy" | "antigravity" => ("antigravity", "ANTIGRAVITY"),
        "aider" => ("aider", "AIDER"),
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
    fn no_agent_borrows_another_vendors_key() {
        // The key picks the mark and the colour, so a shared key draws the wrong
        // vendor's logo in the well. Antigravity is not Gemini CLI, and aider is
        // not Claude Code, however similar their plumbing.
        let agy = classify_agent("agy").expect("agy is an agent");
        assert_eq!(agy.key, "antigravity");
        assert_eq!(agy.name, "ANTIGRAVITY");
        assert_eq!(classify_agent("antigravity").unwrap().key, "antigravity");
        assert_ne!(agy.key, classify_agent("gemini").unwrap().key);
        assert_ne!(classify_agent("aider").unwrap().key, classify_agent("claude").unwrap().key);

        // Every distinct binary that maps to an identity keeps a distinct key.
        // agy and antigravity are the one legitimate pair — two names, one product.
        let bins = [
            "claude", "codex", "gemini", "agy", "antigravity", "aider", "opencode", "grok", "copilot",
        ];
        let mut keys: Vec<&str> = bins.iter().filter_map(|b| classify_agent(b)).map(|a| a.key).collect();
        keys.sort_unstable();
        let before = keys.len();
        keys.dedup();
        assert_eq!(keys.len(), before - 1, "only agy/antigravity may share a key");
    }

    #[test]
    fn a_negative_tpgid_means_no_controlling_terminal() {
        assert_eq!(parse_tpgid("1 (init) S 0 1 1 0 -1 4194560"), None);
    }
}
