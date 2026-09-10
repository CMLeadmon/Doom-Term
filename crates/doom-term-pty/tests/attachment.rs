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
        let full = TmuxHandle::named(tmux::resolve_tmux(None).unwrap(), "doom-target-long".into());
        assert!(
            full.capture_history(100).is_some(),
            "fixture must have history to protect"
        );
        let short = TmuxHandle::named(full.exe.clone(), "doom-target".into());
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

#[test]
fn durable_create_conflicts_and_attach_reuses_only_the_original_pane() {
    if isolated("durable_create_conflicts_and_attach_reuses_only_the_original_pane") {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let create = || {
        PtySession::create(
            "durable".into(),
            80,
            24,
            Some(dir.path().display().to_string()),
            Some("/bin/cat".into()),
        )
    };
    let first = create().unwrap();
    let incarnation = first.stream().snapshot().metadata.incarnation;
    let epoch = first.stream().snapshot().metadata.stream_epoch;
    let pid = first.shell_pid().expect("real pane pid");
    assert!(
        create().is_err(),
        "creating twice must not attach or replace"
    );
    assert_eq!(first.shell_pid(), Some(pid));
    first.retire_adapter().unwrap();
    assert_eq!(display_clients(), 0);
    assert!(!first.is_alive());
    assert_eq!(
        first.shell_pid(),
        Some(pid),
        "retirement must preserve the pane"
    );
    for _ in 0..3 {
        let next = PtySession::attach_durable("durable".into(), &incarnation, 80, 24).unwrap();
        assert_eq!(next.shell_pid(), Some(pid));
        assert_eq!(next.stream().snapshot().metadata.incarnation, incarnation);
        assert_ne!(next.stream().snapshot().metadata.stream_epoch, epoch);
        assert_eq!(display_clients(), 1);
        next.write(b"same-process\n").unwrap();
        wait_for_output(&next, "same-process");
        next.retire_adapter().unwrap();
        assert_eq!(display_clients(), 0);
    }
    assert!(PtySession::attach_durable("durabl".into(), &incarnation, 80, 24).is_err());
    assert!(PtySession::attach_durable("missing".into(), &incarnation, 80, 24).is_err());
    assert_eq!(
        tmux::list_sessions(&tmux::resolve_tmux(None).unwrap()).len(),
        1
    );
    first.kill().unwrap();
    let replacement = create().unwrap();
    assert_ne!(
        replacement.stream().snapshot().metadata.incarnation,
        incarnation
    );
    assert!(PtySession::attach_durable("durable".into(), &incarnation, 80, 24).is_err());
    assert!(first.paste("stale").is_err());
    assert!(
        first.kill().is_err(),
        "an old handle cannot kill its replacement"
    );
    assert!(replacement.shell_pid().is_some());
    replacement.kill().unwrap();
}

fn display_clients() -> usize {
    let output = std::process::Command::new("tmux")
        .args([
            "-N",
            "-L",
            "doom-term",
            "list-clients",
            "-F",
            "#{client_pid}",
        ])
        .output()
        .unwrap();
    assert!(output.status.success());
    String::from_utf8(output.stdout).unwrap().lines().count()
}

fn wait_for_output(session: &PtySession, marker: &str) {
    let journal = session.stream();
    let mut cursor = doom_term_pty::stream::Sequence::new(0);
    let mut text = String::new();
    let deadline = Instant::now() + Duration::from_secs(4);
    while Instant::now() < deadline {
        while let Some(record) = journal.read_after(cursor).unwrap() {
            cursor = record.sequence;
            if let doom_term_pty::stream::StreamPayload::Event(DemuxEvent::Output { data }) =
                record.payload
            {
                text.push_str(&data);
                if text.contains(marker) {
                    return;
                }
            }
        }
        journal.wait_for_change(cursor, Duration::from_millis(20));
    }
    panic!("No {marker:?} in {text:?}");
}

#[test]
fn archive_stays_separate_while_an_editor_survives_adapter_replacement() {
    if isolated("archive_stays_separate_while_an_editor_survives_adapter_replacement") {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let script = dir.path().join("editor.sh");
    std::fs::write(&script, "#!/bin/sh\ni=0; while [ $i -lt 100 ]; do printf 'ARCHIVE_%s\\n' \"$i\"; i=$((i+1)); done\nexec vi -Nu NONE -i NONE -n recovered.txt\n").unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
    let first = PtySession::create(
        "editor".into(),
        80,
        24,
        Some(dir.path().display().to_string()),
        Some(script.display().to_string()),
    )
    .unwrap();
    wait_for_output(&first, "recovered.txt");
    let incarnation = first.stream().snapshot().metadata.incarnation;
    let pid = first.shell_pid().unwrap();
    first.write(b"iEDIT_BEFORE_GAP").unwrap();
    wait_for_output(&first, "EDIT_BEFORE_GAP");
    first.retire_adapter().unwrap();
    let archive = first.capture_archive().unwrap();
    assert_eq!((archive.cols, archive.rows), (80, 24));
    assert!(archive.data.contains("ARCHIVE_0"));
    assert!(
        !archive.data.contains("EDIT_BEFORE_GAP"),
        "editor viewport is not historical rows"
    );
    assert!(archive.potentially_overlapping);
    let next = PtySession::attach_durable("editor".into(), &incarnation, 80, 24).unwrap();
    assert_eq!(next.shell_pid(), Some(pid));
    wait_for_output(&next, "EDIT_BEFORE_GAP");
    assert!(
        !next.get_replay_events().iter().any(|event| matches!(event,
        DemuxEvent::Output { data } if data.contains("ARCHIVE_0"))),
        "archive must not enter the fresh live stream"
    );
    next.write(b"_AFTER\x1b:w!\r").unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    while Instant::now() < deadline
        && std::fs::read(dir.path().join("recovered.txt"))
            .ok()
            .as_deref()
            != Some(b"EDIT_BEFORE_GAP_AFTER\n")
    {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(
        std::fs::read_to_string(dir.path().join("recovered.txt")).unwrap(),
        "EDIT_BEFORE_GAP_AFTER\n"
    );
    next.kill().unwrap();
}

#[test]
fn old_identity_refuses_respawned_pane_and_restarted_server_even_if_numeric_id_is_reused() {
    if isolated(
        "old_identity_refuses_respawned_pane_and_restarted_server_even_if_numeric_id_is_reused",
    ) {
        return;
    }
    let create =
        || PtySession::create("replaced".into(), 80, 24, None, Some("/bin/cat".into())).unwrap();
    let first = create();
    let incarnation = first.stream().snapshot().metadata.incarnation;
    let exe = tmux::resolve_tmux(None).unwrap();
    let old = TmuxHandle::resolve_owned(exe.clone(), "replaced", &incarnation).unwrap();
    let pane = old.query("#{pane_id}").unwrap();
    let status = std::process::Command::new(&exe)
        .args([
            "-N",
            "-L",
            "doom-term",
            "respawn-pane",
            "-k",
            "-t",
            &pane,
            "--",
            "/bin/cat",
        ])
        .status()
        .unwrap();
    assert!(status.success());
    assert!(
        old.pane_pid().is_none(),
        "a respawn is a different root process even with unchanged pane metadata"
    );
    assert!(TmuxHandle::resolve_owned(exe.clone(), "replaced", &incarnation).is_err());
    assert!(old
        .paste("must-not-reach-new-root")
        .unwrap_err()
        .to_string()
        .contains("replaced"));
    assert!(old.capture_archive().is_err());
    assert!(!old.kill_session());
    first.retire_adapter().unwrap();
    assert!(std::process::Command::new(&exe)
        .args(["-N", "-L", "doom-term", "kill-server"])
        .status()
        .unwrap()
        .success());
    let replacement = create();
    let current = TmuxHandle::resolve_owned(
        exe.clone(),
        "replaced",
        &replacement.stream().snapshot().metadata.incarnation,
    )
    .unwrap();
    assert_eq!(
        current.query("#{pane_id}"),
        Some(pane),
        "fixture must actually reuse the numeric pane id"
    );
    assert!(old.pane_pid().is_none());
    assert!(!old.kill_session());
    assert!(old.paste("must-not-reach-restarted-server").is_err());
    assert!(old.capture_archive().is_err());
    assert!(current.pane_pid().is_some());
    replacement.kill().unwrap();
}

#[test]
fn legacy_pane_requires_explicit_identity_assignment_and_can_only_be_adopted_once() {
    if isolated("legacy_pane_requires_explicit_identity_assignment_and_can_only_be_adopted_once") {
        return;
    }
    let first = PtySession::spawn(
        "legacy".into(),
        80,
        24,
        None,
        Some("/bin/cat".into()),
        |_| {},
        || {},
    )
    .unwrap();
    let exe = tmux::resolve_tmux(None).unwrap();
    let legacy = TmuxHandle::named(exe.clone(), "doom-legacy".into());
    let deadline = Instant::now() + Duration::from_secs(2);
    while legacy.pane_pid().is_none() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    let pid = legacy.pane_pid().unwrap();
    let pane = legacy.query("#{pane_id}").unwrap();
    let invented = doom_term_pty::stream::Identity::random().unwrap();
    assert_eq!(
        TmuxHandle::resolve_owned(exe.clone(), "legacy", &invented).unwrap_err(),
        tmux::AttachError::Unidentified
    );
    first.retire_adapter().unwrap();
    assert!(TmuxHandle::recover_legacy(exe.clone(), "legacy", &pane, pid + 1).is_err());
    let owned = TmuxHandle::recover_legacy(exe.clone(), "legacy", &pane, pid).unwrap();
    assert_eq!(owned.pane_pid(), Some(pid));
    assert!(TmuxHandle::recover_legacy(exe, "legacy", &pane, pid).is_err());
    assert!(owned.kill_session());
}

#[test]
fn stalled_display_bootstrap_reaps_its_client_and_keeps_the_created_root() {
    if isolated("stalled_display_bootstrap_reaps_its_client_and_keeps_the_created_root") {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let real = tmux::resolve_tmux(None).unwrap();
    let wrapper = dir.path().join("tmux");
    let pid_file = dir.path().join("owned-client-pid");
    std::fs::write(&wrapper, format!("#!/bin/sh\nif [ \"$4\" = if-shell ]; then\nprintf '%s' \"$$\" > '{}'\nexec sleep 30\nfi\nexec '{}' \"$@\"\n", pid_file.display(), real.display())).unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o700)).unwrap();
    let mut paths = vec![dir.path().to_path_buf()];
    paths.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap()));
    std::env::set_var("PATH", std::env::join_paths(paths).unwrap());
    let started = Instant::now();
    let result = PtySession::create("timeout".into(), 80, 24, None, Some("/bin/cat".into()));
    assert!(result.is_err());
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "bootstrap exceeded its overall deadline"
    );
    let pid: i32 = std::fs::read_to_string(pid_file).unwrap().parse().unwrap();
    assert_eq!(
        nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), None),
        Err(nix::errno::Errno::ESRCH),
        "owned client must be reaped, not left as a zombie"
    );
    let root = TmuxHandle::named(real, "doom-timeout".into());
    assert!(
        root.pane_pid().is_some(),
        "timeout must not kill or replace the created pane"
    );
    assert_eq!(display_clients(), 0);
    assert!(root.kill_session());
}

#[test]
fn direct_create_journals_output_and_cannot_retire_its_living_process() {
    if isolated("direct_create_journals_output_and_cannot_retire_its_living_process") {
        return;
    }
    std::env::set_var("DOOM_TERM_NO_TMUX", "1");
    let session =
        PtySession::create("direct".into(), 80, 24, None, Some("/bin/cat".into())).unwrap();
    assert!(!session.is_durable());
    assert!(session.retire_adapter().is_err());
    assert!(session.is_alive());
    assert!(session.capture_archive().is_err());
    session.write(b"DIRECT_STILL_LIVE\n").unwrap();
    wait_for_output(&session, "DIRECT_STILL_LIVE");
    session.kill().unwrap();
}
