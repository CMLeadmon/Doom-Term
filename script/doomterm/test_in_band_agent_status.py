import json
import os
import tempfile
import unittest
from pathlib import Path

from in_band_agent_status import claude_report, codex_report, osc_message, send_to_terminal


class InBandAgentStatusTests(unittest.TestCase):
    def test_claude_uses_status_line_context_and_five_hour_usage(self):
        report = claude_report({
            "context_window": {"used_percentage": 34},
            "rate_limits": {"five_hour": {"used_percentage": 21},
                            "seven_day": {"used_percentage": 84}},
        })
        self.assertEqual(report, {"agent": "claude", "context": 0.34,
                                  "usage": 0.21, "working": None})

    def test_codex_matches_thread_and_uses_five_hour_window(self):
        with tempfile.TemporaryDirectory() as directory:
            sessions = Path(directory) / "sessions" / "2026" / "09" / "29"
            sessions.mkdir(parents=True)
            for thread_id, primary in (("11111111-1111-1111-1111-111111111111", 12),
                                       ("22222222-2222-2222-2222-222222222222", 47)):
                path = sessions / f"rollout-2026-09-29T00-00-00-{thread_id}.jsonl"
                path.write_text(json.dumps({"payload": {"type": "token_count", "info": {
                    "last_token_usage": {"total_tokens": 25000},
                    "model_context_window": 100000,
                }, "rate_limits": {
                    "primary": {"used_percent": primary, "window_minutes": 300},
                    "secondary": {"used_percent": 90, "window_minutes": 10080},
                }}}) + "\n")
            report = codex_report({"type": "agent-turn-complete",
                                   "thread-id": "11111111-1111-1111-1111-111111111111"},
                                  Path(directory))
            self.assertEqual(report, {"agent": "codex", "context": 0.25,
                                      "usage": 0.12, "working": None})

            rollout = sessions / "rollout-2026-09-29T00-00-00-11111111-1111-1111-1111-111111111111.jsonl"
            rollout.write_text(json.dumps({"payload": {"type": "token_count", "info": {
                "last_token_usage": {"total_tokens": 25000},
                "model_context_window": 100000,
            }, "rate_limits": {
                "primary": {"used_percent": 90, "window_minutes": 10080},
                "secondary": {"used_percent": 14, "window_minutes": 300},
            }}}) + "\n")
            report = codex_report({"type": "agent-turn-complete",
                                   "thread-id": "11111111-1111-1111-1111-111111111111"},
                                  Path(directory))
            self.assertEqual(report["usage"], 0.14)

    def test_message_is_bounded_and_has_no_control_bytes_in_payload(self):
        message = osc_message({"agent": "claude", "context": 0.2,
                               "usage": 0.3, "working": None})
        self.assertTrue(message.startswith(b"\x1b]777;notify;DoomTerm Agent Status;"))
        self.assertTrue(message.endswith(b"\x07"))
        self.assertNotIn(b"\x1b", message[2:])
        self.assertEqual(message.count(b"\x07"), 1)

    @unittest.skipIf(os.name == "nt", "requires a Unix PTY")
    def test_message_reaches_the_controlling_terminal(self):
        import pty

        child, terminal = pty.fork()
        if child == 0:
            send_to_terminal(osc_message({"agent": "claude", "context": 0.2,
                                          "usage": 0.3, "working": None}))
            os._exit(0)
        try:
            data = os.read(terminal, 4096)
            os.waitpid(child, 0)
            self.assertIn(b"\x1b]777;notify;DoomTerm Agent Status;", data)
            self.assertIn(b'"usage":0.3', data)
        finally:
            os.close(terminal)


if __name__ == "__main__":
    unittest.main()
