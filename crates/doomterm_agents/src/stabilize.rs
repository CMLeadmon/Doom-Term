//! Keeps what the status plate shows steady while the observations feeding it are not.
//!
//! A probe reports what one look at a pane saw. Looks fail, records are read mid-write, agents
//! pause between bursts of output, and a status that follows every look flickers. The
//! [`Stabilizer`] holds what was last confirmed and changes it only when something real has: a
//! new value, a different agent or conversation, an agent that is gone, or a rate-limit window
//! that has ended.

use std::time::Duration;

use instant::Instant;

use crate::agent_sessions::AgentReport;

/// How long an agent that stops being observed keeps its place before it counts as gone.
pub const ABSENT_GRACE: Duration = Duration::from_secs(3);
/// How long a pane must look idle before a working agent is shown as done.
pub const WORKING_FALL_DELAY: Duration = Duration::from_millis(2_500);
/// Length of the rate-limit window `usage` describes. A reading nothing has confirmed for this
/// long belongs to a window that has since ended.
pub const USAGE_WINDOW: Duration = Duration::from_secs(5 * 60 * 60);

/// What one probe of a pane saw.
pub struct Observation<A> {
    pub agent: Option<A>,
    pub remote_agent: Option<A>,
    /// What the agent's records say. A field the probe could not read is `None` and never erases
    /// a value already held.
    pub report: AgentReport,
    pub output_continuous: bool,
    /// Identifies the process or command being observed; a different one starts afresh.
    pub session: Option<u64>,
    /// When the agent produced `report`, for a report that is stored and presented again; `None`
    /// when this probe read it just now.
    pub report_time: Option<Instant>,
}

/// What the plate should show.
#[derive(Clone, Debug, PartialEq)]
pub struct Status<A> {
    pub agent: Option<A>,
    pub remote_agent: Option<A>,
    pub context: Option<f32>,
    pub usage: Option<f32>,
    pub usage_resets_at: Option<u64>,
    pub working: bool,
}

struct Slot<A> {
    agent: Option<A>,
    last_seen: Option<Instant>,
}

impl<A: Copy + PartialEq> Slot<A> {
    fn replaced_by(&self, observed: Option<A>) -> bool {
        matches!((self.agent, observed), (Some(held), Some(now)) if held != now)
    }

    fn observe(&mut self, observed: Option<A>, now: Instant) {
        if let Some(agent) = observed {
            self.agent = Some(agent);
            self.last_seen = Some(now);
        } else if self
            .last_seen
            .is_some_and(|seen| now.saturating_duration_since(seen) >= ABSENT_GRACE)
        {
            self.agent = None;
            self.last_seen = None;
        }
    }
}

#[derive(Clone, Copy)]
struct Usage {
    fraction: f32,
    resets_at: Option<u64>,
    confirmed: Instant,
}

pub struct Stabilizer<A> {
    agent: Slot<A>,
    remote_agent: Slot<A>,
    session: Option<u64>,
    conversation: Option<u64>,
    context: Option<f32>,
    usage: Option<Usage>,
    working: bool,
    last_busy: Option<Instant>,
}

fn differs(held: Option<u64>, observed: Option<u64>) -> bool {
    matches!((held, observed), (Some(held), Some(now)) if held != now)
}

impl<A: Copy + PartialEq> Stabilizer<A> {
    pub fn new() -> Self {
        Self {
            agent: Slot {
                agent: None,
                last_seen: None,
            },
            remote_agent: Slot {
                agent: None,
                last_seen: None,
            },
            session: None,
            conversation: None,
            context: None,
            usage: None,
            working: false,
            last_busy: None,
        }
    }

    /// Folds one observation, made at `now` (`now_epoch_s` in Unix seconds), into the status.
    pub fn update(
        &mut self,
        observation: &Observation<A>,
        now: Instant,
        now_epoch_s: u64,
    ) -> Status<A> {
        let replaced = self.agent.replaced_by(observation.agent)
            || self.remote_agent.replaced_by(observation.remote_agent)
            || differs(self.session, observation.session)
            || differs(self.conversation, observation.report.session);
        if replaced {
            self.forget_values();
        }
        self.agent.observe(observation.agent, now);
        self.remote_agent.observe(observation.remote_agent, now);
        self.session = observation.session.or(self.session);
        self.conversation = observation.report.session.or(self.conversation);

        if self.agent.agent.is_none() && self.remote_agent.agent.is_none() {
            self.forget_values();
            self.session = None;
            self.conversation = None;
        } else {
            self.take_values(observation, now, now_epoch_s);
        }
        self.track_working(observation, now);
        self.status()
    }

    fn forget_values(&mut self) {
        self.context = None;
        self.usage = None;
        self.working = false;
        self.last_busy = None;
    }

    fn take_values(&mut self, observation: &Observation<A>, now: Instant, now_epoch_s: u64) {
        let report = &observation.report;
        if let Some(context) = report.context {
            self.context = Some(context);
        }
        if let Some(held) = self.usage {
            let ended = match held.resets_at {
                Some(resets_at) => resets_at <= now_epoch_s,
                None => now.saturating_duration_since(held.confirmed) >= USAGE_WINDOW,
            };
            if ended {
                self.usage = None;
            }
        }
        let confirmed = observation.report_time.unwrap_or(now);
        let current_window = match report.usage_resets_at {
            Some(resets_at) => resets_at > now_epoch_s,
            None => now.saturating_duration_since(confirmed) < USAGE_WINDOW,
        };
        if let Some(fraction) = report.usage.filter(|_| current_window) {
            let newer = self.usage.is_none_or(|held| confirmed >= held.confirmed);
            if newer {
                self.usage = Some(Usage {
                    fraction,
                    resets_at: report.usage_resets_at,
                    confirmed,
                });
            }
        }
    }

    fn track_working(&mut self, observation: &Observation<A>, now: Instant) {
        let present = self.agent.agent.is_some() || self.remote_agent.agent.is_some();
        let busy = present
            && observation
                .report
                .working
                .unwrap_or(observation.output_continuous);
        if busy {
            self.working = true;
            self.last_busy = Some(now);
        } else if self.working
            && self
                .last_busy
                .is_none_or(|busy_at| now.saturating_duration_since(busy_at) >= WORKING_FALL_DELAY)
        {
            self.working = false;
        }
    }

    fn status(&self) -> Status<A> {
        Status {
            agent: self.agent.agent,
            remote_agent: self.remote_agent.agent,
            context: self.context,
            usage: self.usage.map(|usage| usage.fraction),
            usage_resets_at: self.usage.and_then(|usage| usage.resets_at),
            working: self.working,
        }
    }
}

impl<A: Copy + PartialEq> Default for Stabilizer<A> {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
#[path = "stabilize_tests.rs"]
mod tests;
