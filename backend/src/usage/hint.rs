//! What the agents' own hooks have told us about where their transcripts are.
//!
//! ── WHY THIS EXISTS ────────────────────────────────────────────────────────
//!
//! Both `context.rs` and `codex.rs` find a transcript by scanning a directory
//! tree and matching the `cwd` recorded inside each file. That is exact, but it
//! cannot disambiguate: two agents in one directory produce two matching files
//! and neither module can say which pane it is looking at, so both correctly
//! give up and the plate draws '--'.
//!
//! In practice that is not a rare case, it is the common one — opening a second
//! Claude Code in a repo you are already working in is a normal thing to do,
//! and the blank appears exactly when you have most reason to want the number.
//!
//! The hook payload carries `transcript_path` directly. It is the only signal
//! that comes from INSIDE the agent's own process and is therefore the only one
//! that can be authoritative about which file belongs to which run. When a hook
//! has spoken for a directory, its answer wins and the scan is skipped.
//!
//! `/proc` cannot substitute for this: `claude` appends to its transcript and
//! closes it rather than holding the fd open, so the file is not reachable from
//! the process table (verified 2026-08-29).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// How long a hint describes a live agent.
///
/// Shorter than `context::RECENT_WINDOW`, because a hint is a stronger claim: a
/// stale path would keep pointing a pane at a session that has since exited,
/// whereas an expired hint merely falls back to the scan.
const HINT_TTL: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone)]
struct Hint {
    path: PathBuf,
    at: Instant,
}

type Registry = parking_lot::RwLock<HashMap<(String, String), Hint>>;

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(|| parking_lot::RwLock::new(HashMap::new()))
}

/// Record what an agent's hook said about itself.
///
/// Keyed by (agent, cwd) rather than cwd alone: a Claude and a Codex working in
/// the same repository are two different answers, and collapsing them would let
/// whichever fired last describe the other.
pub fn remember(agent: &str, cwd: &str, transcript_path: &str) {
    if agent.is_empty() || cwd.is_empty() || transcript_path.is_empty() {
        return;
    }
    registry().write().insert(
        (agent.to_string(), cwd.to_string()),
        Hint {
            path: PathBuf::from(transcript_path),
            at: Instant::now(),
        },
    );
}

/// The transcript a hook named for this agent in this directory, if it is still
/// current and still on disk.
///
/// A path that has been deleted is no answer at all — reporting it would send
/// the reader down the scan-free path to a file that cannot be read, which
/// looks identical to an agent with no context.
pub fn transcript_for(agent: &str, cwd: &str) -> Option<PathBuf> {
    let hint = registry()
        .read()
        .get(&(agent.to_string(), cwd.to_string()))
        .cloned()?;
    if hint.at.elapsed() > HINT_TTL {
        return None;
    }
    hint.path.exists().then_some(hint.path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unknown_directory_has_no_hint() {
        assert!(transcript_for("claude", "/nowhere/at/all").is_none());
    }

    #[test]
    fn remembers_a_path_the_hook_named() {
        let file = std::env::temp_dir().join("doom-term-hint-remember.jsonl");
        std::fs::write(&file, "{}").unwrap();
        remember("claude", "/hint/remember", file.to_str().unwrap());
        assert_eq!(transcript_for("claude", "/hint/remember"), Some(file.clone()));
        std::fs::remove_file(&file).ok();
    }

    #[test]
    fn two_agents_in_one_directory_keep_separate_hints() {
        // The whole point of keying on the agent as well: a Codex hook must not
        // be able to answer a question about the Claude running beside it.
        let a = std::env::temp_dir().join("doom-term-hint-a.jsonl");
        let b = std::env::temp_dir().join("doom-term-hint-b.jsonl");
        std::fs::write(&a, "{}").unwrap();
        std::fs::write(&b, "{}").unwrap();
        remember("claude", "/hint/shared", a.to_str().unwrap());
        remember("codex", "/hint/shared", b.to_str().unwrap());
        assert_eq!(transcript_for("claude", "/hint/shared"), Some(a.clone()));
        assert_eq!(transcript_for("codex", "/hint/shared"), Some(b.clone()));
        std::fs::remove_file(&a).ok();
        std::fs::remove_file(&b).ok();
    }

    #[test]
    fn a_path_that_no_longer_exists_is_not_an_answer() {
        // The agent exited and its transcript was moved or cleaned up. Falling
        // back to the scan is right; pointing at a missing file is not.
        remember("claude", "/hint/gone", "/nonexistent/transcript.jsonl");
        assert!(transcript_for("claude", "/hint/gone").is_none());
    }

    #[test]
    fn empty_fields_are_refused_rather_than_stored() {
        // Vendors disagree about field names and a missing one arrives as "".
        // Storing it would key a hint under a directory that is every directory.
        remember("", "/hint/empty", "/tmp/x.jsonl");
        remember("claude", "", "/tmp/x.jsonl");
        remember("claude", "/hint/empty", "");
        assert!(transcript_for("claude", "/hint/empty").is_none());
        assert!(transcript_for("", "/hint/empty").is_none());
    }
}
