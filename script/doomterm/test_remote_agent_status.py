import json
import os
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path

from remote_agent_status import claude_usage, read_status


class RemoteAgentStatusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.proc = self.root / "proc"
        self.proc.mkdir()
        self.home = self.root / "home"
        self.home.mkdir()
        self.cwd = self.root / "project"
        self.cwd.mkdir()

    def process(self, pid, command, cwd=None, session_id="123"):
        directory = self.proc / str(pid)
        directory.mkdir()
        (directory / "cmdline").write_bytes(command.encode() + b"\0")
        (directory / "environ").write_bytes(
            f"DOOMTERM_SESSION_ID={session_id}\0".encode())
        (directory / "cwd").symlink_to(cwd or self.cwd)
        (directory / "fd").mkdir()
        return directory

    def test_codex_reads_only_the_matching_live_rollout(self):
        process = self.process(101, "codex")
        rollout = self.root / "rollout-123.jsonl"
        rollout.write_text("\n".join([
            json.dumps({"payload": {"type": "task_started"}}),
            json.dumps({"payload": {"type": "token_count", "info": {
                "last_token_usage": {"total_tokens": 250},
                "model_context_window": 1000},
                "rate_limits": {"primary": {"used_percent": 45, "window_minutes": 300},
                                "secondary": {"used_percent": 70, "window_minutes": 10080}}}}),
        ]) + "\n")
        (process / "fd" / "5").symlink_to(rollout)
        self.assertEqual(read_status("codex", self.cwd, "123", self.home, self.proc), {
            "context": 0.25, "usage": 0.45, "working": True,
        })

    def test_remote_probe_reports_repository_diff(self):
        self.process(101, "codex")
        subprocess.run(["git", "-C", str(self.cwd), "init", "-q"], check=True)
        path = self.cwd / "a.txt"
        path.write_text("one\n")
        subprocess.run(["git", "-C", str(self.cwd), "add", "a.txt"], check=True)
        subprocess.run(["git", "-C", str(self.cwd), "-c", "user.name=t", "-c",
                        "user.email=t@t", "commit", "-q", "-m", "initial"], check=True)
        path.write_text("two\nthree\n")

        self.assertEqual(read_status("codex", self.cwd, "123", self.home, self.proc)["diff"],
                         {"added": 2, "removed": 1, "files": 1})

    def test_ambiguous_processes_return_unknown(self):
        self.process(101, "codex")
        self.process(102, "codex")
        self.assertEqual(read_status("codex", self.cwd, "123", self.home, self.proc), {
            "context": None, "usage": None, "working": None,
        })

    def test_claude_uses_pid_session_and_matching_transcript(self):
        self.process(201, "claude")
        sessions = self.home / ".claude" / "sessions"
        sessions.mkdir(parents=True)
        (sessions / "201.json").write_text(json.dumps({
            "sessionId": "abc", "cwd": str(self.cwd), "status": "busy",
        }))
        project = self.home / ".claude" / "projects" / "project"
        project.mkdir(parents=True)
        (project / "abc.jsonl").write_text(json.dumps({"type": "assistant", "message": {
            "model": "claude-opus-4-6", "usage": {"input_tokens": 100000,
            "cache_read_input_tokens": 200000, "cache_creation_input_tokens": 0},
        }}) + "\n")
        self.assertEqual(read_status("claude", self.cwd, "123", self.home, self.proc), {
            "context": 0.3, "usage": None, "working": True,
        })

    def test_claude_usage_is_opt_in_and_cached_without_storing_credentials(self):
        claude_home = self.home / ".claude"
        claude_home.mkdir()
        (claude_home / ".credentials.json").write_text(json.dumps({
            "claudeAiOauth": {"accessToken": "secret"},
        }))
        calls = []

        def fetch(token):
            calls.append(token)
            return {"five_hour": {"utilization": 25},
                    "seven_day": {"utilization": 60}}

        self.assertEqual(claude_usage(claude_home, self.home / "cache", fetch), 0.25)
        self.assertEqual(claude_usage(claude_home, self.home / "cache", fetch), 0.25)
        self.assertEqual(calls, ["secret"])
        self.assertNotIn("secret", (self.home / "cache").read_text())

    def test_claude_session_id_cannot_select_other_transcripts(self):
        self.process(201, "claude")
        sessions = self.home / ".claude" / "sessions"
        sessions.mkdir(parents=True)
        (sessions / "201.json").write_text(json.dumps({
            "sessionId": "*", "cwd": str(self.cwd), "status": "idle",
        }))
        project = self.home / ".claude" / "projects" / "project"
        project.mkdir(parents=True)
        (project / "another.jsonl").write_text(json.dumps({"type": "assistant", "message": {
            "model": "claude-opus-4-6", "usage": {"input_tokens": 100000,
            "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0},
        }}) + "\n")
        self.assertEqual(read_status("claude", self.cwd, "123", self.home, self.proc), {
            "context": None, "usage": None, "working": False,
        })

    def test_concurrent_claude_usage_probes_share_one_request(self):
        claude_home = self.home / ".claude"
        claude_home.mkdir()
        (claude_home / ".credentials.json").write_text(json.dumps({
            "claudeAiOauth": {"accessToken": "secret"},
        }))
        calls = []
        results = []

        def fetch(token):
            calls.append(token)
            time.sleep(0.05)
            return {"five_hour": {"utilization": 50}}

        threads = [threading.Thread(target=lambda: results.append(
            claude_usage(claude_home, self.home / "cache", fetch))) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(results, [0.5, 0.5])
        self.assertEqual(calls, ["secret"])

    def test_same_directory_in_other_pane_does_not_match(self):
        self.process(101, "codex", session_id="other")
        self.assertEqual(read_status("codex", self.cwd, "123", self.home, self.proc), {
            "context": None, "usage": None, "working": None,
        })

    def test_two_panes_in_same_directory_select_own_process(self):
        selected = self.process(101, "codex", session_id="123")
        self.process(102, "codex", session_id="other")
        rollout = self.root / "rollout-123.jsonl"
        rollout.write_text(json.dumps({"payload": {"type": "task_started"}}) + "\n")
        (selected / "fd" / "5").symlink_to(rollout)
        self.assertEqual(read_status("codex", self.cwd, "123", self.home, self.proc), {
            "context": None, "usage": None, "working": True,
        })


if __name__ == "__main__":
    unittest.main()
