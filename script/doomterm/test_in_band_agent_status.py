import ast
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from in_band_agent_status import (
    agy_report, claude_report, codex_report, osc_message, send_to_terminal, session_identity,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def agy_fixture(name):
    return json.loads((FIXTURES / name).read_text())


class InBandAgentStatusTests(unittest.TestCase):
    def test_claude_reports_diff_from_its_remote_working_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            def git(*args):
                return subprocess.run(
                    ["git", "-C", directory, "-c", "user.name=t", "-c", "user.email=t@t",
                     "-c", "commit.gpgsign=false", *args],
                    check=True, stdout=subprocess.DEVNULL,
                )

            git("init", "-q")
            path = Path(directory) / "a.txt"
            path.write_text("one\ntwo\n")
            git("add", "a.txt")
            git("commit", "-q", "-m", "initial")
            path.write_text("one\nTHREE\nfour\n")

            report = claude_report({"workspace": {"current_dir": directory}})

            self.assertEqual(report.get("diff"), {"added": 2, "removed": 1, "files": 1})

    def test_claude_uses_status_line_context_and_five_hour_usage(self):
        report = claude_report({
            "context_window": {"used_percentage": 34},
            "rate_limits": {"five_hour": {"used_percentage": 21},
                            "seven_day": {"used_percentage": 84}},
        })
        self.assertEqual(report, {"agent": "claude", "context": 0.34,
                                  "usage": 0.21, "working": None, "diff": None})

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
                                      "usage": 0.12, "working": None, "diff": None,
                                      "session": session_identity(
                                          "11111111-1111-1111-1111-111111111111")})

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

    def test_codex_reports_diff_without_a_token_event(self):
        with tempfile.TemporaryDirectory() as directory:
            sessions = Path(directory) / "sessions"
            sessions.mkdir()
            thread_id = "11111111-1111-1111-1111-111111111111"
            (sessions / f"rollout-{thread_id}.jsonl").write_text("{}\n")
            subprocess.run(["git", "-C", directory, "init", "-q"], check=True)
            path = Path(directory) / "a.txt"
            path.write_text("one\n")
            subprocess.run(["git", "-C", directory, "add", "a.txt"], check=True)
            subprocess.run(["git", "-C", directory, "-c", "user.name=t", "-c",
                            "user.email=t@t", "commit", "-q", "-m", "initial"], check=True)
            path.write_text("two\n")

            report = codex_report({"type": "agent-turn-complete", "thread-id": thread_id,
                                   "cwd": directory}, Path(directory))

            self.assertEqual(report.get("diff"), {"added": 1, "removed": 1, "files": 1})

    def test_agy_reports_context_five_hour_usage_and_turn_state_from_its_status_line(self):
        report = agy_report(agy_fixture("agy_statusline_after_turn.json"))
        self.assertAlmostEqual(report["context"], 0.0398178, places=6)
        self.assertAlmostEqual(report["usage"], 1 - 0.897495, places=6)
        self.assertEqual(report["agent"], "agy")
        self.assertIs(report["working"], False)
        self.assertIsNone(report["diff"])

    def test_agy_working_state_is_taken_from_agent_state(self):
        data = agy_fixture("agy_statusline_fresh.json")
        for state in ("working", "thinking", "tool_use"):
            self.assertIs(agy_report({**data, "agent_state": state})["working"], True, state)
        self.assertIs(agy_report({**data, "agent_state": "idle"})["working"], False)
        self.assertIsNone(agy_report({**data, "agent_state": "initializing"})["working"])
        self.assertIsNone(agy_report({**data, "agent_state": "compacting"})["working"])
        self.assertIsNone(agy_report({k: v for k, v in data.items() if k != "agent_state"})["working"])

    def test_agy_usage_uses_the_bucket_of_the_model_family_in_use(self):
        data = agy_fixture("agy_statusline_after_turn.json")
        data["quota"]["3p-5h"]["remaining_fraction"] = 0.25
        for model in ("Claude Sonnet 4.6 (Thinking)", "GPT-OSS 120B (Medium)"):
            report = agy_report({**data, "model": {"id": model, "display_name": model}})
            self.assertEqual(report["usage"], 0.75, model)
        gemini = agy_report({**data, "model": {"id": "gemini-3.1-pro-high",
                                                "display_name": "Gemini 3.1 Pro (High)"}})
        self.assertAlmostEqual(gemini["usage"], 1 - 0.897495, places=6)

    def test_agy_never_substitutes_the_weekly_bucket_or_invents_usage(self):
        data = agy_fixture("agy_statusline_after_turn.json")
        del data["quota"]["gemini-5h"]
        self.assertIsNone(agy_report(data)["usage"])
        self.assertIsNone(agy_report({k: v for k, v in data.items() if k != "quota"})["usage"])

    def test_agy_context_falls_back_to_remaining_percentage_and_rejects_nonsense(self):
        self.assertAlmostEqual(
            agy_report({"context_window": {"remaining_percentage": 60}})["context"], 0.4)
        for bad in ({"used_percentage": 120}, {"used_percentage": -1},
                    {"used_percentage": "40"}, {"used_percentage": True}, {}, None):
            self.assertIsNone(agy_report({"context_window": bad})["context"], bad)

    def test_agy_reports_diff_from_its_workspace_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            def git(*args):
                return subprocess.run(
                    ["git", "-C", directory, "-c", "user.name=t", "-c", "user.email=t@t",
                     "-c", "commit.gpgsign=false", *args],
                    check=True, stdout=subprocess.DEVNULL,
                )

            git("init", "-q")
            path = Path(directory) / "a.txt"
            path.write_text("one\n")
            git("add", "a.txt")
            git("commit", "-q", "-m", "initial")
            path.write_text("two\nthree\n")
            data = agy_fixture("agy_statusline_after_turn.json")
            data["workspace"] = {"current_dir": directory, "project_dir": directory}
            self.assertEqual(agy_report(data)["diff"], {"added": 2, "removed": 1, "files": 1})

    @classmethod
    def run_agy_under_pty(cls, stdin_text):
        return cls.run_under_pty("agy", stdin_text)

    @staticmethod
    def run_under_pty(mode, stdin_text):
        import pty

        script = Path(__file__).resolve().parent / "in_band_agent_status.py"
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "stdin.json"
            source.write_text(stdin_text)
            child, terminal = pty.fork()
            if child == 0:
                os.execv("/bin/sh", ["sh", "-c", 'exec "$0" "$1" "$2" < "$3"',
                                     sys.executable, str(script), mode, str(source)])
            chunks = []
            try:
                while True:
                    try:
                        chunk = os.read(terminal, 4096)
                    except OSError:
                        break
                    if not chunk:
                        break
                    chunks.append(chunk)
            finally:
                os.close(terminal)
            _, status = os.waitpid(child, 0)
        return os.waitstatus_to_exitcode(status), b"".join(chunks)

    @unittest.skipIf(os.name == "nt", "requires a Unix PTY")
    def test_agy_mode_sends_the_report_to_its_terminal_and_prints_a_footer_line(self):
        code, output = self.run_agy_under_pty(
            (FIXTURES / "agy_statusline_after_turn.json").read_text())
        self.assertEqual(code, 0, output)
        self.assertIn(b"\x1b]777;notify;DoomTerm Agent Status;", output)
        self.assertIn(b'"agent":"agy"', output)
        self.assertIn("Context: 4%  5h: 10%".encode(), output)

    @unittest.skipIf(os.name == "nt", "requires a Unix PTY")
    def test_agy_mode_survives_malformed_input(self):
        code, output = self.run_agy_under_pty("not json")
        self.assertEqual(code, 0, output)
        self.assertIn("Context: —  5h: —".encode(), output)

    @unittest.skipIf(os.name == "nt", "requires a Unix PTY")
    def test_claude_mode_survives_empty_and_malformed_input(self):
        for text in ("", "not json", "[1, 2]"):
            code, output = self.run_under_pty("claude", text)
            self.assertEqual(code, 0, (text, output))
            self.assertIn("Context: —  Session: —".encode(), output)

    def test_claude_reports_when_its_usage_window_resets(self):
        report = claude_report({"rate_limits": {"five_hour": {
            "used_percentage": 21, "resets_at": 1_900_000_000}}})
        self.assertEqual(report["usage_resets_at"], 1_900_000_000)

    def test_a_reset_time_is_reported_only_with_a_usage_reading_and_only_if_sane(self):
        self.assertNotIn("usage_resets_at", claude_report({"rate_limits": {"five_hour": {
            "resets_at": 1_900_000_000}}}))
        for bad in ("soon", -5, True, None, 10 ** 12):
            self.assertNotIn("usage_resets_at", claude_report({"rate_limits": {"five_hour": {
                "used_percentage": 21, "resets_at": bad}}}), bad)

    def test_agy_reports_when_its_usage_window_resets(self):
        data = agy_fixture("agy_statusline_after_turn.json")
        self.assertEqual(agy_report(data)["usage_resets_at"] is not None, True)
        del data["quota"]["gemini-5h"]["reset_in_seconds"]
        self.assertEqual(agy_report(data)["usage_resets_at"], 1790736706)

    def test_reports_name_their_conversation_so_a_new_one_starts_afresh(self):
        first = claude_report({"session_id": "abc"})["session"]
        self.assertIsInstance(first, int)
        self.assertEqual(first, claude_report({"session_id": "abc"})["session"])
        self.assertNotEqual(first, claude_report({"session_id": "def"})["session"])
        self.assertNotIn("session", claude_report({}))
        self.assertIsNone(session_identity(""))
        self.assertLess(session_identity("abc"), 2 ** 53)

    def test_codex_takes_usage_from_the_newest_event_that_has_a_five_hour_window(self):
        thread_id = "11111111-1111-1111-1111-111111111111"

        def event(total, windows):
            return json.dumps({"payload": {"type": "token_count", "info": {
                "last_token_usage": {"total_tokens": total},
                "model_context_window": 100000,
            }, "rate_limits": {"primary": windows[0], "secondary": windows[1]}}})

        both = ({"used_percent": 37, "window_minutes": 300, "resets_at": 1_900_000_000},
                {"used_percent": 58, "window_minutes": 10080})
        weekly_only = ({"used_percent": 58, "window_minutes": 10080}, None)
        with tempfile.TemporaryDirectory() as directory:
            sessions = Path(directory) / "sessions"
            sessions.mkdir()
            (sessions / f"rollout-{thread_id}.jsonl").write_text(
                event(10000, both) + "\n" + event(12000, weekly_only) + "\n")
            report = codex_report({"type": "agent-turn-complete", "thread-id": thread_id},
                                  Path(directory))
        self.assertEqual(report["context"], 0.12)
        self.assertEqual(report["usage"], 0.37)
        self.assertEqual(report["usage_resets_at"], 1_900_000_000)

    def test_scripts_use_nothing_newer_than_python_3_6(self):
        # Remote hosts such as RHEL 8 still ship Python 3.6; a SyntaxError there would send no
        # report at all and blank Claude's status line.
        banned_attributes = {"isascii", "removeprefix", "removesuffix", "fromisoformat"}
        banned_keywords = {"text", "capture_output"}
        for name in ("in_band_agent_status.py", "remote_agent_status.py"):
            source = (Path(__file__).resolve().parent / name).read_text()
            tree = ast.parse(source, filename=name, feature_version=(3, 6))
            for node in ast.walk(tree):
                if isinstance(node, ast.Attribute):
                    self.assertNotIn(node.attr, banned_attributes, (name, node.lineno))
                if isinstance(node, ast.keyword):
                    self.assertNotIn(node.arg, banned_keywords, (name, node.value.lineno))

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

    @unittest.skipIf(os.name == "nt", "requires a Unix PTY")
    def test_message_reaches_agent_terminal_from_detached_status_line(self):
        import pty
        import subprocess
        import sys

        here = os.path.dirname(os.path.abspath(__file__))
        code = (f"import sys; sys.path.insert(0, {here!r}); "
                "from in_band_agent_status import osc_message, send_to_terminal; "
                "send_to_terminal(osc_message({'agent': 'claude', 'context': 0.2, "
                "'usage': 0.3, 'working': None}))")
        agent, terminal = pty.fork()
        if agent == 0:
            subprocess.run([sys.executable, "-c", code], start_new_session=True)
            os._exit(0)
        try:
            try:
                data = os.read(terminal, 4096)
            except OSError:
                data = b""
            os.waitpid(agent, 0)
            self.assertIn(b"\x1b]777;notify;DoomTerm Agent Status;", data)
            self.assertIn(b'"usage":0.3', data)
        finally:
            os.close(terminal)

    @unittest.skipUnless(sys.platform.startswith("linux"), "requires Linux /proc")
    def test_detached_status_uses_ancestor_controlling_tty_not_redirected_stdout(self):
        import pty
        import select

        other_master, other_slave = pty.openpty()
        agent, terminal = pty.fork()
        if agent == 0:
            os.close(other_master)
            os.dup2(other_slave, 1)
            os.close(other_slave)
            here = os.path.dirname(os.path.abspath(__file__))
            code = (f"import sys; sys.path.insert(0, {here!r}); "
                    "from in_band_agent_status import send_to_terminal; "
                    "send_to_terminal(b'TEST-OSC-ROUTE')")
            result = subprocess.run([sys.executable, "-c", code], start_new_session=True)
            os._exit(result.returncode)
        os.close(other_slave)
        try:
            _, status = os.waitpid(agent, 0)
            self.assertEqual(os.waitstatus_to_exitcode(status), 0)
            ready, _, _ = select.select([terminal, other_master], [], [], 3)
            output = {}
            for descriptor in ready:
                try:
                    output[descriptor] = os.read(descriptor, 4096)
                except OSError:
                    output[descriptor] = b""
            self.assertIn(b"TEST-OSC-ROUTE", output.get(terminal, b""))
            self.assertNotIn(b"TEST-OSC-ROUTE", output.get(other_master, b""))
        finally:
            os.close(terminal)
            os.close(other_master)


if __name__ == "__main__":
    unittest.main()
