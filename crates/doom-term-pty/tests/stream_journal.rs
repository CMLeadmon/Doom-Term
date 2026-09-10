use doom_term_pty::stream::{
    Identity, JournalHub, Sequence, StreamError, StreamMetadata, StreamPayload,
};
use doom_term_pty::DemuxEvent;

fn isolated(test: &str) -> bool {
    if std::env::var_os("DOOM_JOURNAL_TEST_CHILD").is_some() {
        return false;
    }
    let result = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", test, "--nocapture"])
        .env("DOOM_JOURNAL_TEST_CHILD", "1")
        .env("DOOM_TERM_NO_TMUX", "1")
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
    true
}

fn metadata(id: &str) -> StreamMetadata {
    StreamMetadata::new(id.into(), Identity::random().unwrap(), 80, 24, false).unwrap()
}

fn output(text: &str) -> StreamPayload {
    StreamPayload::Event(DemuxEvent::Output { data: text.into() })
}

#[test]
fn retains_more_than_500_events_and_reads_by_contiguous_cursor() {
    let hub = JournalHub::default();
    let stream = hub.open(metadata("shell")).unwrap();
    for _ in 0..600 {
        stream.append(output("x")).unwrap();
    }
    assert_eq!(stream.snapshot().high_water, Sequence::new(600));
    let first = stream.read_after(Sequence::new(0)).unwrap().unwrap();
    assert_eq!(first.sequence, Sequence::new(1));
    let last = stream.read_after(Sequence::new(599)).unwrap().unwrap();
    assert_eq!(last.sequence, Sequence::new(600));
    assert!(stream.read_after(Sequence::new(600)).unwrap().is_none());
    assert_eq!(
        stream.read_after(Sequence::new(601)).unwrap_err(),
        StreamError::FutureCursor
    );
}

#[test]
fn a_cursor_overtaken_by_record_eviction_is_a_gap_not_a_raw_tail() {
    let hub = JournalHub::default();
    let stream = hub.open(metadata("busy")).unwrap();
    for _ in 0..8193 {
        stream.append(output("x")).unwrap();
    }
    assert_eq!(stream.snapshot().retained_records, 8192);
    assert_eq!(stream.snapshot().first_retained, Some(Sequence::new(2)));
    assert_eq!(
        stream.read_after(Sequence::new(0)).unwrap_err(),
        StreamError::Gap
    );
    assert_eq!(
        stream
            .read_after(Sequence::new(1))
            .unwrap()
            .unwrap()
            .sequence,
        Sequence::new(2)
    );
}

#[test]
fn closed_stream_preserves_known_outcome_and_refuses_more_records() {
    let stream = JournalHub::default().open(metadata("closed")).unwrap();
    stream.append(output("last output")).unwrap();
    stream
        .append(StreamPayload::Closed { exit_code: Some(7) })
        .unwrap();
    assert!(stream.snapshot().ended);
    assert!(matches!(
        stream
            .read_after(Sequence::new(1))
            .unwrap()
            .unwrap()
            .payload,
        StreamPayload::Closed { exit_code: Some(7) }
    ));
    assert_eq!(
        stream.append(output("late")).unwrap_err(),
        StreamError::Ended
    );
}

#[test]
fn releasing_the_last_stream_handle_releases_its_retention_budget() {
    let hub = JournalHub::default();
    let stream = hub.open(metadata("owned")).unwrap();
    stream.append(output("sensitive transcript")).unwrap();
    let clone = stream.clone();
    drop(stream);
    assert!(hub.retained_bytes() > 0);
    drop(clone);
    assert_eq!(hub.retained_bytes(), 0);
}

#[test]
fn real_pty_output_and_successful_resize_are_in_the_same_stream() {
    if isolated("real_pty_output_and_successful_resize_are_in_the_same_stream") {
        return;
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let session = doom_term_pty::PtySession::spawn(
        format!("journal-{}", std::process::id()),
        80,
        24,
        None,
        Some("/bin/cat".into()),
        move |event| {
            let _ = tx.send(event);
        },
        || {},
    )
    .unwrap();
    let result = || {
        session.write(b"journal-before-resize\n").unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
        let mut seen = false;
        while std::time::Instant::now() < deadline {
            if let Ok(DemuxEvent::Output { data }) =
                rx.recv_timeout(std::time::Duration::from_millis(50))
            {
                if data.contains("journal-before-resize") {
                    seen = true;
                    break;
                }
            }
        }
        assert!(seen, "real PTY output did not arrive");
        let journal = session.stream();
        let before_resize = journal.snapshot().high_water;
        session.resize(100, 35).unwrap();
        let after_resize = journal.snapshot().high_water;
        assert!(after_resize > before_resize);
        let mut cursor = before_resize;
        let mut resize = None;
        while cursor < after_resize {
            let record = journal.read_after(cursor).unwrap().unwrap();
            cursor = record.sequence;
            if let StreamPayload::Resize { cols, rows } = record.payload {
                resize = Some((cols, rows));
            }
        }
        assert_eq!(resize, Some((100, 35)));
        assert_eq!(journal.snapshot().metadata.initial_cols, 80);
    };
    // Always tear down this test-owned pane, including after an assertion.
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(result));
    session.kill().unwrap();
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[test]
fn direct_control_fault_keeps_the_process_alive_but_refuses_further_input() {
    if isolated("direct_control_fault_keeps_the_process_alive_but_refuses_further_input") {
        return;
    }
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let script = dir.path().join("fault-child.sh");
    std::fs::write(
        &script,
        r"#!/bin/sh
printf '\033['
head -c 73728 /dev/zero | tr '\000' 1
printf '\aAFTER_FAULT'
exec sleep 30
",
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let session = doom_term_pty::PtySession::spawn(
        "fault-child".into(),
        80,
        24,
        Some(dir.path().display().to_string()),
        Some(script.display().to_string()),
        move |event| {
            let _ = tx.send(event);
        },
        || {},
    )
    .unwrap();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
        let mut fault = false;
        while std::time::Instant::now() < deadline {
            if let Ok(DemuxEvent::StreamFault { .. }) =
                rx.recv_timeout(std::time::Duration::from_millis(50))
            {
                fault = true;
                break;
            }
        }
        assert!(fault, "real child must emit an explicit stream fault");
        assert!(session.is_alive(), "fault must not kill the child");
        assert!(session.stream().snapshot().ended);
        assert!(session.write(b"NOT_SENT").is_err());
        assert!(session.paste("NOT_SENT").is_err());
        assert!(session.resize(100, 35).is_err());
        assert!(session
            .get_replay_events()
            .iter()
            .any(|e| matches!(e, DemuxEvent::StreamFault { .. })));
    }));
    session.kill().unwrap();
    if let Err(panic) = result {
        std::panic::resume_unwind(panic);
    }
}
