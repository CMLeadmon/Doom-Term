use super::*;
use std::time::{Duration, Instant};

/// Real PTYs and HTTP hook requests, without real agent binaries, credentials,
/// user transcripts, tmux servers, or global HOME changes.
struct Fixture {
    root: tempfile::TempDir,
    sessions: SessionsMap,
    usage: UsageHandle,
    tx: tokio::sync::mpsc::UnboundedSender<ServerMessage>,
    rx: tokio::sync::mpsc::UnboundedReceiver<ServerMessage>,
}

impl Fixture {
    fn new() -> Self {
        std::env::set_var("DOOM_TERM_NO_TMUX", "1");
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        Self {
            root: tempfile::tempdir().unwrap(),
            sessions: Arc::new(RwLock::new(HashMap::new())),
            usage: Arc::new(usage::service::UsageService::new()),
            tx,
            rx,
        }
    }

    fn pane(&self, agent: &str, name: &str) -> String {
        let program = self.root.path().join(agent);
        if !program.exists() {
            std::fs::copy("/bin/cat", &program).unwrap();
        }
        let id = format!("{}-{name}", self.root.path().display());
        handle_client_msg(
            ClientMessage::Spawn {
                id: id.clone(),
                cols: 80,
                rows: 24,
                cwd: Some(self.root.path().display().to_string()),
                shell: Some(program.display().to_string()),
            },
            &self.sessions,
            &self.usage,
            &self.tx,
        );
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if self
                .sessions
                .read()
                .get(&id)
                .and_then(|s| s.foreground_command())
                .as_deref()
                == Some(agent)
            {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "fixture process did not become the foreground agent"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        id
    }

    async fn hook(&self, agent: &str, pane: Option<&str>, count: u64) {
        let path = self.root.path().join(format!("{agent}-{count}.jsonl"));
        let record = if agent == "claude" {
            serde_json::json!({"type":"assistant", "message": {"model":"claude-haiku-4-5", "usage":{"input_tokens":count}}})
        } else {
            serde_json::json!({"payload":{"type":"token_count", "info":{"model_context_window":200000, "last_token_usage":{"total_tokens":count}}}})
        };
        std::fs::write(&path, format!("{record}\n")).unwrap();
        let body =
            serde_json::json!({"event":"Stop", "cwd":self.root.path(), "transcript_path":path})
                .to_string();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let agent = agent.to_owned();
        let sessions = self.sessions.clone();
        let task = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (bus, _) = tokio::sync::broadcast::channel(4);
            serve_hook(
                stream,
                &bus,
                &Arc::new(RwLock::new(HashMap::new())),
                Some(agent),
                &sessions,
            )
            .await;
        });
        let header = pane
            .map(|id| format!("X-Doom-Term-Session: {id}\r\n"))
            .unwrap_or_default();
        let mut stream = TcpStream::connect(addr).await.unwrap();
        stream.write_all(format!("POST /hook HTTP/1.1\r\nHost: {addr}\r\n{header}Content-Length: {}\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
        let mut reply = String::new();
        stream.read_to_string(&mut reply).await.unwrap();
        task.await.unwrap();
        assert!(reply.starts_with("HTTP/1.1 204"));
    }

    fn context(&mut self, id: &str) -> Option<f64> {
        handle_client_msg(
            ClientMessage::GetTelemetry {
                cwd: None,
                session_id: Some(id.into()),
            },
            &self.sessions,
            &self.usage,
            &self.tx,
        );
        while let Ok(msg) = self.rx.try_recv() {
            if let ServerMessage::Telemetry {
                session_id,
                context_used,
                ..
            } = msg
            {
                assert_eq!(session_id.as_deref(), Some(id));
                return context_used;
            }
        }
        panic!("missing telemetry response");
    }

    fn wait_command(&self, id: &str, command: &str) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while self
            .sessions
            .read()
            .get(id)
            .and_then(|s| s.foreground_command())
            .as_deref()
            != Some(command)
        {
            assert!(
                Instant::now() < deadline,
                "foreground did not become {command}"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let sessions: Vec<_> = self.sessions.read().values().cloned().collect();
        for session in sessions {
            let _ = session.kill();
        }
    }
}

#[tokio::test]
async fn same_agent_panes_in_one_directory_keep_their_own_context() {
    for agent in ["claude", "codex"] {
        let mut fixture = Fixture::new();
        let a = fixture.pane(agent, "a");
        let b = fixture.pane(agent, "b");
        fixture.hook(agent, Some(&a), 20000).await;
        fixture.hook(agent, Some(&b), 40000).await;
        assert_eq!(
            fixture.context(&a),
            Some(0.1),
            "pane A borrowed pane B's context for {agent}"
        );
        assert_eq!(fixture.context(&b), Some(0.2));
    }
}

#[tokio::test]
async fn an_unattributed_hook_cannot_describe_a_pane() {
    for agent in ["claude", "codex"] {
        let mut fixture = Fixture::new();
        let a = fixture.pane(agent, "a");
        fixture.hook(agent, None, 20000).await;
        assert_eq!(
            fixture.context(&a),
            None,
            "a directory match is not proof of pane ownership"
        );
    }
}

#[tokio::test]
async fn a_new_agent_process_in_the_same_pane_does_not_inherit_the_old_transcript() {
    let mut fixture = Fixture::new();
    let program = fixture.root.path().join("claude");
    std::fs::copy("/bin/cat", &program).unwrap();
    let id = format!("{}-restart", fixture.root.path().display());
    handle_client_msg(
        ClientMessage::Spawn {
            id: id.clone(),
            cols: 80,
            rows: 24,
            cwd: Some(fixture.root.path().display().to_string()),
            shell: Some("/bin/sh".into()),
        },
        &fixture.sessions,
        &fixture.usage,
        &fixture.tx,
    );
    fixture.wait_command(&id, "sh");
    let session = fixture.sessions.read().get(&id).unwrap().clone();
    session
        .write(format!("{}\n", program.display()).as_bytes())
        .unwrap();
    fixture.wait_command(&id, "claude");
    fixture.hook("claude", Some(&id), 20000).await;
    assert_eq!(fixture.context(&id), Some(0.1));
    session.write(b"\x03").unwrap();
    fixture.wait_command(&id, "sh");
    session
        .write(format!("{}\n", program.display()).as_bytes())
        .unwrap();
    fixture.wait_command(&id, "claude");
    assert_eq!(
        fixture.context(&id),
        None,
        "a different foreground process needs its own hook"
    );
}
