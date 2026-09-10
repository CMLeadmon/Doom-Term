#![cfg(unix)]

use doom_term_pty::{
    tmux::{self, TmuxHandle},
    DemuxEvent, PtySession,
};
use std::os::unix::fs::PermissionsExt;
use std::time::{Duration, Instant};

fn isolated(test: &str) -> bool {
    if std::env::var_os("DOOM_ATTACHMENT_TEST_CHILD").is_some() {
        return false;
    }
    let dir = tempfile::tempdir().unwrap();
    let result = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", test, "--nocapture"])
        .env("DOOM_ATTACHMENT_TEST_CHILD", "1")
        .env("TMUX_TMPDIR", dir.path())
        .env_remove("TMUX")
        .env_remove("TMUX_PANE")
        .env_remove("DOOM_TERM_NO_TMUX")
        .output()
        .unwrap();
    let _ = std::process::Command::new("tmux")
        .env("TMUX_TMPDIR", dir.path())
        .args(["-N", "-L", "doom-term", "kill-server"])
        .output();
    assert!(
        result.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
    true
}

#[test]
fn missing_prefix_targets_never_query_capture_or_kill_a_neighbor() {
    if isolated("missing_prefix_targets_never_query_capture_or_kill_a_neighbor") {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let script = dir.path().join("history-child.sh");
    std::fs::write(&script, "#!/bin/sh\ni=0; while [ $i -lt 100 ]; do printf 'ARCHIVE_%s\\n' \"$i\"; i=$((i+1)); done\nprintf 'READY_EXACT\\n'\nexec cat\n").unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let session = PtySession::spawn(
        "target-long".into(),
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
        assert!(session.is_durable(), "real supported tmux is required");
        let deadline = Instant::now() + Duration::from_secs(4);
        let mut output = String::new();
        while Instant::now() < deadline && !output.contains("READY_EXACT") {
            if let Ok(DemuxEvent::Output { data }) = rx.recv_timeout(Duration::from_millis(50)) {
                output.push_str(&data);
            }
        }
        assert!(
            output.contains("READY_EXACT"),
            "fixture did not become ready"
        );
        let full = TmuxHandle {
            exe: tmux::resolve_tmux(None).unwrap(),
            name: "doom-target-long".into(),
        };
        assert!(
            full.capture_history(100).is_some(),
            "fixture must have history to protect"
        );
        let short = TmuxHandle {
            exe: full.exe.clone(),
            name: "doom-target".into(),
        };
        // Collect every observation before asserting: the broken implementation
        // also kills this test-owned neighbor, demonstrating the harmful branch.
        let pid = short.pane_pid();
        let history = short.capture_history(100);
        let found = short.has_session();
        let killed = short.kill_session();
        let survivor = full.has_session();
        assert_eq!(
            (pid, history, found, killed, survivor),
            (None, None, false, false, true)
        );
    }));
    session.kill().unwrap();
    if let Err(panic) = result {
        std::panic::resume_unwind(panic);
    }
}
