use std::cell::Cell;

use super::{EnablementState, TelemetryEvent, TelemetryEventDesc};

struct DisabledEvent;

crate::register_telemetry_event!(DisabledEvent);

impl TelemetryEvent for DisabledEvent {
    fn name(&self) -> &'static str {
        "local-only macro test"
    }

    fn payload(&self) -> Option<serde_json::Value> {
        None
    }

    fn description(&self) -> &'static str {
        "Tests event expression evaluation without sending telemetry"
    }

    fn enablement_state(&self) -> EnablementState {
        EnablementState::ChannelSpecific { channels: vec![] }
    }

    fn contains_ugc(&self) -> bool {
        false
    }

    fn event_descs() -> impl Iterator<Item = Box<dyn TelemetryEventDesc>> {
        std::iter::empty()
    }
}

fn event(evaluations: &Cell<u32>) -> DisabledEvent {
    evaluations.set(evaluations.get() + 1);
    DisabledEvent
}

fn context() -> &'static warpui_core::AppContext {
    panic!("local-only telemetry must not access application context")
}

#[test]
fn local_telemetry_never_evaluates_event_or_context() {
    let evaluations = Cell::new(0);
    crate::send_telemetry_from_ctx!(event(&evaluations), context());
    assert_eq!(evaluations.get(), 0);
}

#[test]
fn local_app_telemetry_never_evaluates_event_or_context() {
    let evaluations = Cell::new(0);
    crate::send_telemetry_from_app_ctx!(event(&evaluations), context());
    assert_eq!(evaluations.get(), 0);
}
