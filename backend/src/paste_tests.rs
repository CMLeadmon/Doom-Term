use super::*;
use std::os::unix::fs::PermissionsExt;
use std::time::Duration;

#[tokio::test]
async fn paste_results_correlate_refusals_and_real_child_delivery() {
    std::env::set_var("DOOM_TERM_NO_TMUX", "1");
    let sessions: SessionsMap = Arc::new(RwLock::new(HashMap::new()));
    let usage = Arc::new(usage::service::UsageService::new());
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let fixture = tempfile::tempdir().unwrap();
    for (id, mode, expected) in [
        ("off", "", b"OK".as_slice()),
        ("on", "\\033[?2004h", b"\x1b[200~A\nB\x1b[201~".as_slice()),
    ] {
        let script = fixture.path().join(format!("{id}.sh"));
        std::fs::write(&script, format!("#!/bin/sh\nstty raw -echo\nprintf '{mode}READY'\ndd bs=1 count={} of={id}.received 2>/dev/null\nprintf DONE\nsleep 30\n", expected.len())).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
        let events = tx.clone();
        let session = Arc::new(
            PtySession::spawn(
                id.into(),
                80,
                24,
                Some(fixture.path().display().to_string()),
                Some(script.display().to_string()),
                move |event| {
                    let _ = events.send(ServerMessage::PtyEvent {
                        session_id: id.into(),
                        event,
                    });
                },
                || {},
            )
            .unwrap(),
        );
        // Kill the owned child even when an assertion fails.
        struct Cleanup(Arc<PtySession>);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = self.0.kill();
            }
        }
        let _cleanup = Cleanup(session.clone());
        sessions.write().insert(id.into(), session);
        wait_output(&mut rx, "READY").await;
        for (request, target, text, error_fragment) in [
            (
                "missing",
                "missing",
                "SECRET".to_owned(),
                Some("unavailable"),
            ),
            (
                "oversize",
                id,
                "\x00".repeat(1024 * 1024 + 1),
                Some("1 MiB"),
            ),
            ("empty", id, "\x03\x1b".to_owned(), None),
        ] {
            handle_client_msg(
                ClientMessage::Paste {
                    request_id: request.into(),
                    id: target.into(),
                    text,
                },
                &sessions,
                &usage,
                &tx,
            );
            let error = result(&mut rx, request, target).await;
            match error_fragment {
                Some(fragment) => assert!(
                    error.as_deref().unwrap_or("").contains(fragment),
                    "{error:?}"
                ),
                None => assert_eq!(error, None),
            }
            assert!(!error.unwrap_or_default().contains("SECRET"));
        }
        if id == "off" {
            handle_client_msg(
                ClientMessage::Paste {
                    request_id: "blocked".into(),
                    id: id.into(),
                    text: "SECRET\rnext".into(),
                },
                &sessions,
                &usage,
                &tx,
            );
            let error = result(&mut rx, "blocked", id).await.unwrap();
            assert!(error.contains("Multiline paste blocked") && !error.contains("SECRET"));
        }
        handle_client_msg(
            ClientMessage::Paste {
                request_id: "sent".into(),
                id: id.into(),
                text: if id == "off" { "OK" } else { "A\r\nB" }.into(),
            },
            &sessions,
            &usage,
            &tx,
        );
        assert_eq!(result(&mut rx, "sent", id).await, None);
        // The result may race the child's output; observe the actual file.
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if std::fs::read(fixture.path().join(format!("{id}.received")))
                    .ok()
                    .as_deref()
                    == Some(expected)
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
    }
}

async fn wait_output(rx: &mut tokio::sync::mpsc::UnboundedReceiver<ServerMessage>, marker: &str) {
    tokio::time::timeout(Duration::from_secs(3), async {
        let mut output = String::new();
        while let Some(message) = rx.recv().await {
            if let ServerMessage::PtyEvent {
                event: DemuxEvent::Output { data },
                ..
            } = message
            {
                output.push_str(&data);
                if output.contains(marker) {
                    return;
                }
            }
        }
        panic!("child closed before {marker}");
    })
    .await
    .unwrap();
}

async fn result(
    rx: &mut tokio::sync::mpsc::UnboundedReceiver<ServerMessage>,
    request: &str,
    target: &str,
) -> Option<String> {
    tokio::time::timeout(Duration::from_secs(3), async {
        while let Some(message) = rx.recv().await {
            if let ServerMessage::PasteResult {
                request_id,
                session_id,
                error,
            } = message
            {
                assert_eq!(request_id, request);
                assert_eq!(session_id, target);
                return error;
            }
        }
        panic!("missing paste result");
    })
    .await
    .unwrap()
}
