use std::borrow::Cow;

use chrono::{DateTime, Utc};
use serde_json::Value;

#[derive(Clone, Debug)]
pub struct Event {
    /// The type of the event and its payload.
    pub payload: EventPayload,

    // We are using the session creation time as the identifier for the session.
    // Some metrics platforms (e.g. Amplitude) expect this.
    pub session_created_at: DateTime<Utc>,

    /// The time at which the event occurred.
    pub timestamp: DateTime<Utc>,

    /// Whether the event contains user-generated content.
    pub contains_ugc: bool,
}

/// Represents the type of telemetry event and its contents.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum EventPayload {
    IdentifyUser {
        user_id: String,
        anonymous_id: String,
    },
    AppActive {
        user_id: Option<String>,
        anonymous_id: String,
    },
    NamedEvent {
        user_id: Option<String>,
        anonymous_id: String,
        name: Cow<'static, str>,
        value: Option<Value>,
    },
}
