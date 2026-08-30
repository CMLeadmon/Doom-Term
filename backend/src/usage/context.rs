//! CONTEXT % — how full the running agent's context window is.
//!
//! Read from the agent's own transcript, which is the only place the number
//! exists: no agent CLI reports its token usage to the terminal, and /proc
//! cannot find the file either, because `claude` appends and closes the
//! transcript rather than holding the fd open.
//!
//! This is NOT the same number as USAGE %, and the two must never be blended.
//! USAGE % is the account's rate limit, fetched over HTTPS by `service.rs`;
//! CONTEXT % is one session's window fill, read from a local file. They come
//! from unrelated sources and can move in opposite directions.

/// Context window by model family, in tokens.
///
/// Taken 2026-08-30 from the authoritative model reference. Matched by prefix
/// because the transcript records the id verbatim and it sometimes carries a
/// date suffix (`claude-sonnet-4-6-20260115`).
///
/// Longest prefix first: `claude-haiku-4-5` must be tested before any shorter
/// string that could also match it.
const WINDOWS: &[(&str, u64)] = &[
    ("claude-haiku-4-5", 200_000),
    ("claude-opus-5", 1_000_000),
    ("claude-opus-4-8", 1_000_000),
    ("claude-opus-4-7", 1_000_000),
    ("claude-opus-4-6", 1_000_000),
    ("claude-sonnet-5", 1_000_000),
    ("claude-sonnet-4-6", 1_000_000),
    ("claude-fable-5", 1_000_000),
    ("claude-mythos-5", 1_000_000),
];

/// The context window for a model id, or None when we do not know it.
///
/// None is a real answer and the plate renders it as `--`. Defaulting to some
/// plausible window would turn an unknown into a confident wrong percentage,
/// which is the failure this whole slot exists to avoid — a model with a
/// larger window than we assumed would read as dangerously full.
pub fn context_window(model: &str) -> Option<u64> {
    WINDOWS
        .iter()
        .find(|(family, _)| model.starts_with(family))
        .map(|(_, window)| *window)
}

/// The newest token accounting found in a transcript.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    pub used: u64,
    pub model: String,
}

/// Parse one transcript line, returning its token total when it is an
/// assistant turn that carries usage.
///
/// `used` is the INPUT side only — `input_tokens` plus both cache counters.
/// Those three are what was sent to the model, and therefore what occupies the
/// window. `output_tokens` is excluded on purpose: the reply is not in the
/// window until it is sent back as part of the next request's input, where it
/// arrives already counted. Adding it here would count it twice.
pub fn snapshot_from_line(line: &str) -> Option<Snapshot> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    if value.get("type")?.as_str()? != "assistant" {
        return None;
    }
    let message = value.get("message")?;
    let usage = message.get("usage")?;
    let model = message.get("model")?.as_str()?.to_string();

    let field = |name: &str| usage.get(name).and_then(|v| v.as_u64()).unwrap_or(0);
    let used = field("input_tokens")
        + field("cache_read_input_tokens")
        + field("cache_creation_input_tokens");

    Some(Snapshot { used, model })
}

/// How much of the transcript to read per step, scanning backwards.
/// The newest usage was in the final 64 KB of a 6.1 MB file when measured.
pub const SCAN_CHUNK: u64 = 65_536;

/// Give up after this much. A transcript whose last several megabytes contain
/// no assistant usage is not one we can describe, and reading a 100 MB file on
/// a 2 Hz poll to discover that would be worse than reporting nothing.
pub const MAX_SCAN: u64 = 4 * 1024 * 1024;

/// The newest token accounting in a transcript, scanning from the end.
///
/// Backwards because the file is append-only and can reach megabytes: the
/// answer is almost always in the last chunk, and a forward read would cost
/// the whole file on every poll. Partial lines at a chunk's leading edge are
/// carried into the next step rather than parsed, so a record split across the
/// boundary is not silently dropped.
pub fn newest_snapshot(path: &std::path::Path) -> Option<Snapshot> {
    use std::io::{Read, Seek, SeekFrom};

    let mut file = std::fs::File::open(path).ok()?;
    let size = file.metadata().ok()?.len();

    let mut pos = size;
    let mut scanned = 0u64;
    // Bytes from the previous (later) step that began before `pos`.
    let mut carry: Vec<u8> = Vec::new();

    while pos > 0 && scanned < MAX_SCAN {
        let step = SCAN_CHUNK.min(pos);
        pos -= step;
        scanned += step;

        let mut block = vec![0u8; step as usize];
        file.seek(SeekFrom::Start(pos)).ok()?;
        file.read_exact(&mut block).ok()?;
        block.extend_from_slice(&carry);

        let mut lines: Vec<&[u8]> = block.split(|b| *b == b'\n').collect();
        // The first element starts before `pos` unless we reached the top of
        // the file, so it is incomplete and belongs to the next step.
        carry = if pos > 0 {
            let head = lines.remove(0);
            head.to_vec()
        } else {
            Vec::new()
        };

        for raw in lines.iter().rev() {
            let Ok(text) = std::str::from_utf8(raw) else {
                continue;
            };
            if let Some(snapshot) = snapshot_from_line(text) {
                return Some(snapshot);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_current_families_all_carry_a_million_token_window() {
        assert_eq!(context_window("claude-opus-5"), Some(1_000_000));
        assert_eq!(context_window("claude-opus-4-8"), Some(1_000_000));
        assert_eq!(context_window("claude-sonnet-5"), Some(1_000_000));
        assert_eq!(context_window("claude-fable-5"), Some(1_000_000));
    }

    #[test]
    fn haiku_is_the_one_that_is_not() {
        // The whole reason this is a table and not a constant.
        assert_eq!(context_window("claude-haiku-4-5"), Some(200_000));
        assert_eq!(context_window("claude-haiku-4-5-20251001"), Some(200_000));
    }

    #[test]
    fn a_model_we_do_not_know_has_no_window_rather_than_a_guessed_one() {
        // A wrong denominator produces a confident, wrong percentage — worse
        // than the '--' the plate draws for None. Never default the divisor.
        assert_eq!(context_window("claude-opus-9"), None);
        assert_eq!(context_window("gpt-5"), None);
        assert_eq!(context_window(""), None);
    }

    #[test]
    fn a_dated_snapshot_matches_its_family() {
        // Ids arrive from the transcript verbatim and sometimes carry a date.
        assert_eq!(context_window("claude-sonnet-4-6-20260115"), Some(1_000_000));
    }

    #[test]
    fn reads_the_input_side_token_total_from_an_assistant_line() {
        // Shape confirmed against a real transcript on 2026-08-30.
        let line = r#"{"type":"assistant","message":{"model":"claude-opus-5",
            "usage":{"input_tokens":2,"cache_creation_input_tokens":1905,
            "cache_read_input_tokens":335468,"output_tokens":2217}}}"#;
        let snap = snapshot_from_line(line).expect("an assistant usage line");
        // 2 + 1905 + 335468. The output tokens are deliberately NOT counted:
        // this measures what was SENT, which is what fills the window on the
        // next request. Including the reply would double-count it a turn later.
        assert_eq!(snap.used, 337_375);
        assert_eq!(snap.model, "claude-opus-5");
    }

    #[test]
    fn tolerates_a_usage_block_missing_the_cache_fields() {
        // An uncached first turn has no cache_read/cache_creation at all.
        let line = r#"{"type":"assistant","message":{"model":"claude-opus-5",
            "usage":{"input_tokens":1200,"output_tokens":30}}}"#;
        assert_eq!(snapshot_from_line(line).unwrap().used, 1200);
    }

    #[test]
    fn ignores_lines_that_are_not_an_assistant_turn_with_usage() {
        // A transcript is mostly user turns, tool results and metadata. Only
        // an assistant message carries the token accounting.
        assert!(snapshot_from_line(r#"{"type":"user","message":{"content":"hi"}}"#).is_none());
        assert!(snapshot_from_line(r#"{"type":"assistant","message":{"model":"m"}}"#).is_none());
        assert!(snapshot_from_line("not json at all").is_none());
        assert!(snapshot_from_line("").is_none());
    }

    #[test]
    fn a_usage_block_without_a_model_is_unusable() {
        // Without the model there is no denominator, so there is no percentage.
        let line = r#"{"type":"assistant","message":{"usage":{"input_tokens":10}}}"#;
        assert!(snapshot_from_line(line).is_none());
    }

    /// Write a transcript to a unique temp path and hand back the path.
    fn write_transcript(name: &str, body: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("doom-term-ctx-{}.jsonl", name));
        std::fs::write(&path, body).expect("temp transcript");
        path
    }

    /// One assistant turn carrying usage. Used by this task and by Task 4.
    fn assistant_line(model: &str, input: u64) -> String {
        format!(
            r#"{{"type":"assistant","message":{{"model":"{}","usage":{{"input_tokens":{}}}}}}}"#,
            model, input
        )
    }

    #[test]
    fn finds_the_last_usage_not_the_first() {
        // The newest turn is the current state of the window; an earlier one
        // describes a context that has since grown.
        let path = write_transcript(
            "ordering",
            &format!(
                "{}\n{}\n{}\n",
                assistant_line("claude-opus-5", 100),
                r#"{"type":"user","message":{"content":"next"}}"#,
                assistant_line("claude-opus-5", 900),
            ),
        );
        assert_eq!(newest_snapshot(&path).unwrap().used, 900);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn finds_a_usage_line_that_straddles_a_chunk_boundary() {
        // The scan reads fixed-size blocks backwards from the end, so a record
        // split across a boundary arrives as two halves and must be rejoined.
        // Placed deliberately: the trailing padding is sized so the final
        // chunk BEGINS in the middle of the usage line. A test that merely
        // exceeds one chunk does not exercise this — the answer would sit in
        // the last block and the carry path would never run.
        let usage = format!("{}\n", assistant_line("claude-opus-5", 4242));
        let filler = format!("{}\n", r#"{"type":"user","message":{"content":"x"}}"#);

        let suffix_bytes = SCAN_CHUNK as usize - usage.len() / 2;
        let mut suffix = filler.repeat(suffix_bytes / filler.len() + 1);
        suffix.truncate(suffix_bytes); // exact, so the boundary lands where we want
        let prefix = filler.repeat(10);
        let body = format!("{}{}{}", prefix, usage, suffix);

        let path = write_transcript("straddle", &body);
        let size = std::fs::metadata(&path).unwrap().len();
        let last_chunk_starts = size - SCAN_CHUNK;
        let usage_starts = prefix.len() as u64;
        assert!(
            last_chunk_starts > usage_starts
                && last_chunk_starts < usage_starts + usage.len() as u64,
            "the boundary must fall inside the usage line for this test to mean anything"
        );

        assert_eq!(newest_snapshot(&path).unwrap().used, 4242);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn a_transcript_with_no_usage_yields_nothing() {
        let path = write_transcript(
            "empty",
            concat!(r#"{"type":"user","message":{"content":"hi"}}"#, "\n"),
        );
        assert!(newest_snapshot(&path).is_none());
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn a_missing_file_yields_nothing_rather_than_panicking() {
        // The agent can exit and its transcript be moved between the poll that
        // found it and the poll that reads it.
        assert!(newest_snapshot(std::path::Path::new("/nonexistent/x.jsonl")).is_none());
    }
}
