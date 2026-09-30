use std::time::Duration;

use doomterm_plate::DiffStats;

use super::*;

#[test]
fn in_band_status_identifies_agent_and_validates_fractions() {
    let parsed =
        parse_in_band(br#"{"agent":"claude","context":0.25,"usage":0.7,"working":null}"#).unwrap();
    assert_eq!(parsed.0, crate::agent_sessions::AgentKind::Claude);
    assert_eq!(parsed.1.context, Some(0.25));
    assert_eq!(parsed.1.usage, Some(0.7));
    assert!(
        parse_in_band(br#"{"agent":"other","context":0.2,"usage":0.3,"working":null}"#).is_none()
    );
    assert!(
        parse_in_band(br#"{"agent":"codex","context":0.2,"usage":2,"working":null}"#).is_none()
    );
}

#[test]
fn in_band_status_carries_bounded_remote_diff_counts() {
    let parsed = parse_in_band(
        br#"{"agent":"claude","context":0.25,"usage":0.7,"working":null,"diff":{"added":12,"removed":3,"files":2}}"#,
    )
    .unwrap();
    assert_eq!(
        parsed.2,
        Some(DiffStats {
            added: 12,
            removed: 3,
            files: 2,
        })
    );
    assert!(parse_in_band(
        br#"{"agent":"claude","context":0.25,"usage":0.7,"working":null,"diff":{"added":-1,"removed":3,"files":2}}"#
    ).is_none());
}

#[test]
fn polled_status_carries_remote_diff_counts() {
    let parsed = parse_report_with_diff(
        br#"{"context":0.25,"usage":0.7,"working":true,"diff":{"added":12,"removed":3,"files":2}}"#,
    )
    .unwrap();
    assert_eq!(parsed.0.context, Some(0.25));
    assert_eq!(parsed.1.unwrap().files, 2);
}

#[test]
fn valid_report_uses_only_bounded_fractions_and_explicit_working_state() {
    let report = parse_report(br#"{"context":0.25,"usage":0.7,"working":true}"#).unwrap();
    assert_eq!(report.context, Some(0.25));
    assert_eq!(report.usage, Some(0.7));
    assert_eq!(report.working, Some(true));
}

#[test]
fn invalid_or_untrusted_values_are_unknown() {
    assert!(parse_report(br#"{"context":2,"usage":-1,"working":"yes"}"#).is_none());
    assert!(parse_report(br#"{"context":0.5,"usage":null,"working":null}"#).is_some());
    assert!(parse_report(b"not json").is_none());
    assert!(parse_report(&vec![b'x'; 4097]).is_none());
}

#[test]
fn cwd_transport_contains_only_hex_even_for_shell_metacharacters() {
    let cwd = "/project/it's $(touch /tmp/bad); 🦀";
    let encoded = encode_cwd(cwd);
    assert!(encoded.starts_with("2f70726f6a6563742f"));
    assert_eq!(encoded.len(), cwd.len() * 2);
    assert!(encoded.bytes().all(|byte| byte.is_ascii_hexdigit()));
}

#[test]
fn in_band_status_accepts_antigravity_and_reports_its_own_agent() {
    let parsed = parse_in_band(
        br#"{"agent":"agy","context":0.04,"usage":0.1,"working":false,"diff":{"added":1,"removed":0,"files":1}}"#,
    )
    .unwrap();
    assert_eq!(parsed.0, AgentKind::Antigravity);
    assert_eq!(parsed.1.context, Some(0.04));
    assert_eq!(parsed.1.working, Some(false));
    assert!(
        parse_in_band(br#"{"agent":"gemini","context":0.2,"usage":0.3,"working":null}"#).is_none()
    );
}

#[test]
fn a_remote_pane_accepts_every_supported_agent() {
    for agent in [AgentKind::Claude, AgentKind::Codex, AgentKind::Antigravity] {
        assert!(accepts_in_band(agent, true, None), "{agent:?} over SSH");
    }
    assert!(!accepts_in_band(AgentKind::Other, true, None));
}

#[test]
fn a_local_pane_accepts_antigravity_only_while_antigravity_is_its_foreground_agent() {
    assert!(accepts_in_band(
        AgentKind::Antigravity,
        false,
        Some(AgentKind::Antigravity)
    ));
    assert!(!accepts_in_band(AgentKind::Antigravity, false, None));
    assert!(!accepts_in_band(
        AgentKind::Antigravity,
        false,
        Some(AgentKind::Claude)
    ));
}

#[test]
fn a_local_pane_never_takes_claude_or_codex_reports_from_the_stream() {
    assert!(!accepts_in_band(
        AgentKind::Claude,
        false,
        Some(AgentKind::Claude)
    ));
    assert!(!accepts_in_band(
        AgentKind::Codex,
        false,
        Some(AgentKind::Codex)
    ));
}

#[test]
fn an_idle_agents_report_stays_valid_for_hours() {
    // Claude Code runs its status line only on events and Codex notifies only at the end of a
    // turn; an idle agent's context and usage are as true after ten minutes as after ten seconds.
    assert_eq!(in_band_max_age(), Duration::from_secs(6 * 60 * 60));
}

#[test]
fn an_in_band_turn_state_is_trusted_only_while_it_is_fresh() {
    let fresh = Duration::from_secs(59);
    let stale = Duration::from_secs(61);
    assert_eq!(in_band_working(Some(true), fresh), Some(true));
    assert_eq!(in_band_working(Some(true), stale), None);
    assert_eq!(in_band_working(Some(false), stale), None);
    assert_eq!(in_band_working(None, fresh), None);
}

#[test]
fn in_band_status_carries_the_reset_time_of_the_usage_window() {
    let parsed = parse_in_band(
        br#"{"agent":"claude","context":0.2,"usage":0.3,"usage_resets_at":1900000000,"working":null}"#,
    )
    .unwrap();
    assert_eq!(parsed.1.usage_resets_at, Some(1_900_000_000));
}

#[test]
fn a_report_without_a_reset_time_has_none() {
    let parsed =
        parse_in_band(br#"{"agent":"claude","context":0.2,"usage":0.3,"working":null}"#).unwrap();
    assert_eq!(parsed.1.usage_resets_at, None);
}

#[test]
fn a_malformed_reset_time_is_ignored_and_does_not_reject_the_report() {
    let parsed = parse_in_band(
        br#"{"agent":"claude","context":0.2,"usage":0.3,"usage_resets_at":"soon","working":null}"#,
    )
    .unwrap();
    assert_eq!(parsed.1.usage, Some(0.3));
    assert_eq!(parsed.1.usage_resets_at, None);
}
