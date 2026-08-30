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
}
