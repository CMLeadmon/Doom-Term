fn context() -> &'static crate::AppContext {
    panic!("local telemetry must not access context")
}

fn executor() -> &'static crate::r#async::executor::Background {
    panic!("local telemetry must not schedule work")
}

fn user_id() -> Option<String> {
    panic!("local telemetry must not access identity")
}

fn anonymous_id() -> String {
    panic!("local telemetry must not access anonymous identity")
}

fn name() -> std::borrow::Cow<'static, str> {
    panic!("local telemetry must not access event name")
}

fn payload() -> Option<serde_json::Value> {
    panic!("local telemetry must not create payload")
}

fn contains_ugc() -> bool {
    panic!("local telemetry must not evaluate metadata")
}

#[test]
fn local_recording_does_not_evaluate_arguments() {
    crate::record_telemetry_from_ctx!(
        user_id(),
        anonymous_id(),
        name(),
        payload(),
        contains_ugc(),
        context()
    );
}

#[test]
fn local_background_recording_does_not_evaluate_arguments() {
    crate::record_telemetry_on_executor!(
        user_id(),
        anonymous_id(),
        name(),
        payload(),
        contains_ugc(),
        executor()
    );
}
