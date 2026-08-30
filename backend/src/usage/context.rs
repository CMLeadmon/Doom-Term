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
}
