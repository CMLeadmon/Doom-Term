//! What the agents' own hooks have told us about where their transcripts are.
//!
//! ── WHY THIS EXISTS ────────────────────────────────────────────────────────
//!
//! Directory scans cannot prove pane ownership, even when only one transcript
//! exists: another agent in the same directory may not have written its first
//! record yet. Live telemetry requires a hook carrying the exact Doom pane id.
//!
//! In practice that is not a rare case, it is the common one — opening a second
//! Claude Code in a repo you are already working in is a normal thing to do,
//! and the blank appears exactly when you have most reason to want the number.
//!
//! The hook payload carries `transcript_path` directly. It is the only signal
//! that comes from INSIDE the agent's own process and is therefore the only one
//! that can be authoritative about which file belongs to which run. When a hook
//! has spoken for a pane, that pane may use the path; its neighbors may not.
//!
//! `/proc` cannot substitute for this: `claude` appends to its transcript and
//! closes it rather than holding the fd open, so the file is not reachable from
//! the process table (verified 2026-08-29).

use doom_term_pty::foreground::ProcessIdentity;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// How long a hint describes a live agent.
///
/// A stale or expired hint reports unknown until another hook arrives. The
/// foreground process must also match; the TTL alone is not a liveness check.
const HINT_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_HINTS: usize = 256;

#[derive(Debug, Clone)]
struct Hint {
    path: PathBuf,
    at: Instant,
    process: ProcessIdentity,
}

type Key = (String, String, String);
type Entries = HashMap<Key, Hint>;
type Registry = parking_lot::RwLock<Entries>;

fn insert(entries: &mut Entries, key: Key, hint: Hint) {
    entries.retain(|_, entry| entry.at.elapsed() <= HINT_TTL);
    if entries.len() >= MAX_HINTS && !entries.contains_key(&key) {
        if let Some(oldest) = entries
            .iter()
            .min_by_key(|(_, entry)| entry.at)
            .map(|(key, _)| key.clone())
        {
            entries.remove(&oldest);
        }
    }
    entries.insert(key, hint);
}

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(|| parking_lot::RwLock::new(HashMap::new()))
}

/// Record what an agent's hook said about itself.
///
/// Keyed by (agent, cwd, pane), never by directory alone. Hooks outside Doom
/// Term may still drive unambiguous attention events, but not context readings.
pub fn remember(
    agent: &str,
    cwd: &str,
    session_id: Option<&str>,
    process: Option<ProcessIdentity>,
    transcript_path: &str,
) {
    let Some(id) = session_id.filter(|id| !id.is_empty()) else {
        return;
    };
    let Some(process) = process else { return };
    if agent.is_empty() || cwd.is_empty() || transcript_path.is_empty() {
        return;
    }
    insert(
        &mut registry().write(),
        (agent.to_string(), cwd.to_string(), id.to_string()),
        Hint {
            path: PathBuf::from(transcript_path),
            at: Instant::now(),
            process,
        },
    );
}

/// The transcript a hook named for this agent in this directory, if it is still
/// current and still on disk.
///
/// A path that has been deleted is no answer at all — reporting it would send
/// the reader down the scan-free path to a file that cannot be read, which
/// looks identical to an agent with no context.
pub fn transcript_for(
    agent: &str,
    cwd: &str,
    session_id: Option<&str>,
    process: Option<ProcessIdentity>,
) -> Option<PathBuf> {
    let id = session_id.filter(|id| !id.is_empty())?;
    let process = process?;
    let hint = registry()
        .read()
        .get(&(agent.to_string(), cwd.to_string(), id.to_string()))
        .cloned()?;
    if hint.at.elapsed() > HINT_TTL || hint.process != process {
        return None;
    }
    hint.path.exists().then_some(hint.path)
}

#[cfg(test)]
mod tests {
    use super::*;
    const PROCESS: Option<ProcessIdentity> = Some(ProcessIdentity {
        pid: 123,
        start_ticks: 456,
    });

    #[test]
    fn hint_retention_is_bounded_and_prunes_expired_entries() {
        let mut entries = Entries::new();
        for index in 0..300 {
            insert(
                &mut entries,
                ("claude".into(), "/fixture".into(), index.to_string()),
                Hint {
                    path: PathBuf::from("/fixture/transcript.jsonl"),
                    at: Instant::now(),
                    process: PROCESS.unwrap(),
                },
            );
        }
        assert!(
            entries.len() <= 256,
            "unbounded hint registry: {}",
            entries.len()
        );
        for hint in entries.values_mut() {
            hint.at = Instant::now() - HINT_TTL - Duration::from_secs(1);
        }
        insert(
            &mut entries,
            ("claude".into(), "/fixture".into(), "new".into()),
            Hint {
                path: PathBuf::from("/fixture/new.jsonl"),
                at: Instant::now(),
                process: PROCESS.unwrap(),
            },
        );
        assert_eq!(
            entries.len(),
            1,
            "expired entries should not occupy the cache"
        );
    }

    #[test]
    fn an_unknown_directory_has_no_hint() {
        assert!(transcript_for("claude", "/nowhere/at/all", Some("pane"), PROCESS).is_none());
    }

    #[test]
    fn remembers_a_path_the_hook_named() {
        let file = std::env::temp_dir().join("doom-term-hint-remember.jsonl");
        std::fs::write(&file, "{}").unwrap();
        remember(
            "claude",
            "/hint/remember",
            Some("pane"),
            PROCESS,
            file.to_str().unwrap(),
        );
        assert_eq!(
            transcript_for("claude", "/hint/remember", Some("pane"), PROCESS),
            Some(file.clone())
        );
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
        remember(
            "claude",
            "/hint/shared",
            Some("pane"),
            PROCESS,
            a.to_str().unwrap(),
        );
        remember(
            "codex",
            "/hint/shared",
            Some("pane"),
            PROCESS,
            b.to_str().unwrap(),
        );
        assert_eq!(
            transcript_for("claude", "/hint/shared", Some("pane"), PROCESS),
            Some(a.clone())
        );
        assert_eq!(
            transcript_for("codex", "/hint/shared", Some("pane"), PROCESS),
            Some(b.clone())
        );
        std::fs::remove_file(&a).ok();
        std::fs::remove_file(&b).ok();
    }

    #[test]
    fn a_path_that_no_longer_exists_is_not_an_answer() {
        remember(
            "claude",
            "/hint/gone",
            Some("pane"),
            PROCESS,
            "/nonexistent/transcript.jsonl",
        );
        assert!(transcript_for("claude", "/hint/gone", Some("pane"), PROCESS).is_none());
    }

    #[test]
    fn empty_fields_are_refused_rather_than_stored() {
        // Vendors disagree about field names and a missing one arrives as "".
        // Storing it would key a hint under a directory that is every directory.
        remember("", "/hint/empty", Some("pane"), PROCESS, "/tmp/x.jsonl");
        remember("claude", "", Some("pane"), PROCESS, "/tmp/x.jsonl");
        remember("claude", "/hint/empty", Some("pane"), PROCESS, "");
        assert!(transcript_for("claude", "/hint/empty", Some("pane"), PROCESS).is_none());
        assert!(transcript_for("", "/hint/empty", Some("pane"), PROCESS).is_none());
    }
}
