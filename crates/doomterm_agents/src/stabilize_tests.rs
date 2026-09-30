use std::time::Duration;

use instant::Instant;

use super::*;
use crate::agent_sessions::AgentReport;
use crate::foreground::Foreground;

const HOUR: f64 = 3600.0;

struct Clock {
    start: Instant,
}

impl Clock {
    fn new() -> Self {
        Self {
            start: Instant::now(),
        }
    }

    fn at(&self, seconds: f64) -> Instant {
        self.start + Duration::from_secs_f64(seconds)
    }
}

fn report(context: Option<f32>, usage: Option<f32>) -> AgentReport {
    AgentReport {
        context,
        usage,
        ..AgentReport::default()
    }
}

fn seen(agent: &'static str, report: AgentReport) -> Observation<&'static str> {
    Observation {
        agent: Some(agent),
        remote_agent: None,
        report,
        output_continuous: false,
        session: Some(1),
        report_time: None,
        foreground: None,
    }
}

fn busy(agent: &'static str) -> Observation<&'static str> {
    Observation {
        output_continuous: true,
        ..seen(agent, AgentReport::default())
    }
}

fn quiet(agent: &'static str) -> Observation<&'static str> {
    seen(agent, AgentReport::default())
}

fn unseen() -> Observation<&'static str> {
    Observation {
        agent: None,
        remote_agent: None,
        report: AgentReport::default(),
        output_continuous: false,
        session: None,
        report_time: None,
        foreground: None,
    }
}

#[test]
fn a_value_survives_a_probe_that_reads_nothing() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();

    stabilizer.update(&seen("claude", report(Some(0.16), None)), clock.at(0.0), 0);
    let status = stabilizer.update(&quiet("claude"), clock.at(1.0), 0);

    assert_eq!(status.context, Some(0.16));
}

#[test]
fn a_new_value_replaces_the_held_one() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();

    stabilizer.update(&seen("claude", report(Some(0.16), None)), clock.at(0.0), 0);
    let status = stabilizer.update(&seen("claude", report(Some(0.20), None)), clock.at(1.0), 0);

    assert_eq!(status.context, Some(0.20));
}

#[test]
fn a_missed_detection_keeps_the_agent_and_its_values_through_the_grace_period() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    stabilizer.update(&seen("claude", report(Some(0.16), Some(0.4))), clock.at(0.0), 0);

    let status = stabilizer.update(&unseen(), clock.at(2.9), 0);

    assert_eq!(status.agent, Some("claude"));
    assert_eq!(status.context, Some(0.16));
    assert_eq!(status.usage, Some(0.4));
}

#[test]
fn an_agent_missing_for_the_whole_grace_period_is_gone_with_its_values() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    stabilizer.update(&seen("claude", report(Some(0.16), Some(0.4))), clock.at(0.0), 0);

    let status = stabilizer.update(&unseen(), clock.at(3.0), 0);

    assert_eq!(status.agent, None);
    assert_eq!(status.context, None);
    assert_eq!(status.usage, None);
}

#[test]
fn an_agent_that_reappears_within_the_grace_period_keeps_its_values() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    stabilizer.update(&seen("claude", report(Some(0.16), None)), clock.at(0.0), 0);
    stabilizer.update(&unseen(), clock.at(1.0), 0);

    let status = stabilizer.update(&quiet("claude"), clock.at(2.0), 0);

    assert_eq!(status.agent, Some("claude"));
    assert_eq!(status.context, Some(0.16));
}

#[test]
fn a_different_agent_replaces_the_held_one_at_once_and_starts_afresh() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    stabilizer.update(&seen("claude", report(Some(0.30), Some(0.5))), clock.at(0.0), 0);

    let status = stabilizer.update(&quiet("codex"), clock.at(1.0), 0);

    assert_eq!(status.agent, Some("codex"));
    assert_eq!(status.context, None);
    assert_eq!(status.usage, None);
}

#[test]
fn a_new_process_of_the_same_agent_starts_afresh() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    stabilizer.update(&seen("claude", report(Some(0.30), None)), clock.at(0.0), 0);

    let restarted = Observation {
        session: Some(2),
        ..quiet("claude")
    };
    let status = stabilizer.update(&restarted, clock.at(1.0), 0);

    assert_eq!(status.context, None);
}

#[test]
fn a_new_conversation_in_the_same_process_starts_afresh() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    let first = AgentReport {
        session: Some(10),
        ..report(Some(0.30), None)
    };
    stabilizer.update(&seen("claude", first), clock.at(0.0), 0);

    let cleared = AgentReport {
        session: Some(11),
        ..AgentReport::default()
    };
    let status = stabilizer.update(&seen("claude", cleared), clock.at(1.0), 0);

    assert_eq!(status.context, None);
}

#[test]
fn a_read_that_names_no_conversation_does_not_end_the_held_one() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    let first = AgentReport {
        session: Some(10),
        ..report(Some(0.30), None)
    };
    stabilizer.update(&seen("claude", first), clock.at(0.0), 0);

    let status = stabilizer.update(&quiet("claude"), clock.at(1.0), 0);

    assert_eq!(status.context, Some(0.30));
}

#[test]
fn a_remote_agent_has_the_same_grace_period() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    let remote = |report| Observation {
        agent: None,
        remote_agent: Some("claude"),
        report,
        output_continuous: false,
        session: Some(7),
        report_time: None,
        foreground: None,
    };
    stabilizer.update(&remote(report(Some(0.34), Some(0.22))), clock.at(0.0), 0);

    let during = stabilizer.update(&unseen(), clock.at(2.0), 0);
    let after = stabilizer.update(&unseen(), clock.at(3.0), 0);

    assert_eq!(during.remote_agent, Some("claude"));
    assert_eq!(during.context, Some(0.34));
    assert_eq!(after.remote_agent, None);
    assert_eq!(after.context, None);
}

#[test]
fn context_is_held_for_as_long_as_the_agent_lives() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    stabilizer.update(&seen("codex", report(Some(0.12), None)), clock.at(0.0), 0);

    let status = stabilizer.update(&quiet("codex"), clock.at(6.0 * HOUR), 0);

    assert_eq!(status.context, Some(0.12));
}

#[test]
fn working_rises_at_once() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();

    let status = stabilizer.update(&busy("agy"), clock.at(0.0), 0);

    assert!(status.working);
}

#[test]
fn working_falls_only_after_the_quiet_delay() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    stabilizer.update(&busy("agy"), clock.at(0.0), 0);

    let early = stabilizer.update(&quiet("agy"), clock.at(0.5), 0);
    let almost = stabilizer.update(&quiet("agy"), clock.at(2.4), 0);
    let done = stabilizer.update(&quiet("agy"), clock.at(2.5), 0);

    assert!(early.working);
    assert!(almost.working);
    assert!(!done.working);
}

#[test]
fn a_pause_shorter_than_the_delay_never_shows_as_waiting() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    stabilizer.update(&busy("agy"), clock.at(0.0), 0);
    stabilizer.update(&quiet("agy"), clock.at(0.6), 0);
    stabilizer.update(&quiet("agy"), clock.at(1.5), 0);

    let resumed = stabilizer.update(&busy("agy"), clock.at(1.6), 0);
    let next_pause = stabilizer.update(&quiet("agy"), clock.at(3.0), 0);

    assert!(resumed.working);
    assert!(next_pause.working, "a new pause restarts the quiet delay");
}

#[test]
fn the_agents_own_turn_state_outranks_output_continuity() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    let turn_running = AgentReport {
        working: Some(true),
        ..AgentReport::default()
    };

    let status = stabilizer.update(&seen("claude", turn_running), clock.at(0.0), 0);

    assert!(status.working, "no output, but the agent says a turn runs");
}

#[test]
fn an_agent_that_says_its_turn_ended_is_not_working_despite_output() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    let turn_running = AgentReport {
        working: Some(true),
        ..AgentReport::default()
    };
    stabilizer.update(&seen("claude", turn_running.clone()), clock.at(0.0), 0);
    stabilizer.update(&seen("claude", turn_running), clock.at(4.9), 0);
    let turn_over = Observation {
        output_continuous: true,
        ..seen(
            "claude",
            AgentReport {
                working: Some(false),
                ..AgentReport::default()
            },
        )
    };

    let just_ended = stabilizer.update(&turn_over, clock.at(5.0), 0);
    let settled = stabilizer.update(&turn_over, clock.at(8.0), 0);

    assert!(just_ended.working, "the end of a turn also waits out the quiet delay");
    assert!(!settled.working);
}

#[test]
fn an_agent_that_is_gone_is_not_working() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    stabilizer.update(&busy("agy"), clock.at(0.0), 0);

    let status = stabilizer.update(&unseen(), clock.at(3.0), 0);

    assert!(!status.working);
}

#[test]
fn usage_is_dropped_the_moment_its_window_resets() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    let windowed = AgentReport {
        usage_resets_at: Some(1_000),
        ..report(None, Some(0.97))
    };

    let before = stabilizer.update(&seen("codex", windowed.clone()), clock.at(0.0), 999);
    let after = stabilizer.update(&seen("codex", windowed), clock.at(1.0), 1_000);

    assert_eq!(before.usage, Some(0.97));
    assert_eq!(
        after.usage, None,
        "the observation still carries the old window's number"
    );
}

#[test]
fn a_reading_from_a_window_that_already_reset_is_never_shown() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    let expired = AgentReport {
        usage_resets_at: Some(1_000),
        ..report(Some(0.1), Some(0.97))
    };

    let status = stabilizer.update(&seen("codex", expired), clock.at(0.0), 5_000);

    assert_eq!(status.usage, None);
    assert_eq!(status.context, Some(0.1));
}

#[test]
fn usage_with_no_reset_time_is_dropped_once_unconfirmed_for_a_whole_window() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    stabilizer.update(&seen("claude", report(None, Some(0.3))), clock.at(0.0), 0);

    let within = stabilizer.update(&quiet("claude"), clock.at(5.0 * HOUR - 1.0), 0);
    let beyond = stabilizer.update(&quiet("claude"), clock.at(5.0 * HOUR), 0);

    assert_eq!(within.usage, Some(0.3));
    assert_eq!(beyond.usage, None);
}

#[test]
fn a_confirmation_restarts_the_unconfirmed_window() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    stabilizer.update(&seen("claude", report(None, Some(0.3))), clock.at(0.0), 0);
    stabilizer.update(&seen("claude", report(None, Some(0.35))), clock.at(4.0 * HOUR), 0);

    let status = stabilizer.update(&quiet("claude"), clock.at(8.0 * HOUR), 0);

    assert_eq!(status.usage, Some(0.35));
}

#[test]
fn a_stored_report_does_not_keep_its_usage_alive_past_its_window() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    let stored = Observation {
        report_time: Some(clock.at(0.0)),
        ..seen("claude", report(None, Some(0.3)))
    };
    stabilizer.update(&stored, clock.at(0.0), 0);

    let within = stabilizer.update(&stored, clock.at(5.0 * HOUR - 1.0), 0);
    let beyond = stabilizer.update(&stored, clock.at(5.0 * HOUR), 0);

    assert_eq!(within.usage, Some(0.3));
    assert_eq!(
        beyond.usage, None,
        "presenting the same stored report again is not a new confirmation"
    );
}

fn ssh_to(host: &str) -> Foreground {
    Foreground::Remote { host: host.into() }
}

fn on_ssh(agent: &'static str) -> Observation<&'static str> {
    Observation {
        foreground: Some(ssh_to("prod")),
        ..quiet(agent)
    }
}

#[test]
fn an_unreadable_foreground_keeps_the_last_known_one_through_the_grace_period() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    stabilizer.update(&on_ssh("claude"), clock.at(0.0), 0);

    let during = stabilizer.update(&quiet("claude"), clock.at(2.0), 0);
    let after = stabilizer.update(&quiet("claude"), clock.at(3.0), 0);

    assert_eq!(during.foreground, Some(ssh_to("prod")));
    assert_eq!(after.foreground, None);
}

#[test]
fn a_program_with_no_name_says_nothing_about_the_foreground() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    stabilizer.update(&on_ssh("claude"), clock.at(0.0), 0);
    let vanished = Observation {
        foreground: Some(Foreground::Program {
            name: String::new(),
            pid: 4242,
        }),
        ..quiet("claude")
    };

    let status = stabilizer.update(&vanished, clock.at(1.0), 0);

    assert_eq!(status.foreground, Some(ssh_to("prod")));
}

#[test]
fn a_concrete_foreground_replaces_the_held_one_at_once() {
    let clock = Clock::new();
    let mut stabilizer = Stabilizer::new();
    stabilizer.update(&on_ssh("claude"), clock.at(0.0), 0);
    let back_at_the_prompt = Observation {
        foreground: Some(Foreground::Shell),
        ..quiet("claude")
    };

    let status = stabilizer.update(&back_at_the_prompt, clock.at(1.0), 0);

    assert_eq!(status.foreground, Some(Foreground::Shell));
}
