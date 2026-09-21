#[path = "types.rs"]
mod types;

pub use types::{Event, EventPayload};

/// A local-only application has no telemetry queue to drain.
pub fn flush_events() -> Vec<Event> {
    Vec::new()
}

// Type-check inputs without evaluating them, capturing values, or scheduling work.
#[macro_export]
macro_rules! record_telemetry_from_ctx {
    ($user_id:expr, $anonymous_id:expr, $name:expr, $payload:expr, $contains_ugc:expr, $ctx:expr) => {{
        if false {
            let _ = $crate::telemetry::EventPayload::NamedEvent {
                user_id: $user_id,
                anonymous_id: $anonymous_id,
                name: $name,
                value: $payload,
            };
            let _: bool = $contains_ugc;
            let _ = &$ctx;
        }
    }};
}

#[macro_export]
macro_rules! record_telemetry_on_executor {
    ($user_id:expr, $anonymous_id:expr, $name:expr, $payload:expr, $contains_ugc:expr, $executor:expr) => {{
        $crate::record_telemetry_from_ctx!(
            $user_id,
            $anonymous_id,
            $name,
            $payload,
            $contains_ugc,
            $executor
        );
    }};
}

#[cfg(test)]
#[path = "mod_tests.rs"]
mod tests;
