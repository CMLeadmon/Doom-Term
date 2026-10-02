import ast
import errno
import io
import json
import math
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from in_band_agent_status import (
    agy_report,
    claude_report,
    codex_report,
    main,
    osc_message,
    send_to_terminal,
    session_identity,
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



class DeliveryDiagnosticsTests(unittest.TestCase):
    def test_no_terminal_reports_failure_even_with_a_stale_ssh_tty(self):
        with patch("in_band_agent_status.terminals", return_value=iter(["/dev/tty"])), \
                patch("in_band_agent_status.os.open", side_effect=OSError(errno.ENXIO, "no tty")), \
                patch.dict(os.environ, {"SSH_TTY": "/dev/pts/999"}):
            result = send_to_terminal(b"report")
        self.assertIsInstance(result, dict)
        self.assertFalse(result["delivered"])
        self.assertEqual(result["reason"], "no_ancestor_terminal")
        self.assertEqual(result["attempts"][0]["reason"], "no_controlling_terminal")

    def test_permission_denied_is_distinguished_from_missing_terminal(self):
        with patch("in_band_agent_status.terminals", return_value=iter(["/dev/tty", "/dev/pts/9"])), \
                patch("in_band_agent_status.os.open", side_effect=[
                    OSError(errno.ENXIO, "no tty"), PermissionError(errno.EACCES, "denied")]):
            result = send_to_terminal(b"report")
        self.assertIsInstance(result, dict)
        self.assertFalse(result["delivered"])
        self.assertEqual(result["reason"], "permission_denied")
        self.assertEqual(result["attempts"][-1]["terminal"], "/dev/pts/9")

    def test_write_failure_stops_before_another_terminal_can_receive_partial_report(self):
        with patch("in_band_agent_status.terminals", return_value=iter(["/dev/tty", "/dev/pts/9"])), \
                patch("in_band_agent_status.os.open", return_value=10) as opened, \
                patch("in_band_agent_status.os.isatty", return_value=True), \
                patch("in_band_agent_status.os.write", side_effect=OSError(errno.EIO, "lost tty")), \
                patch("in_band_agent_status.os.close"):
            result = send_to_terminal(b"report")
        self.assertIsInstance(result, dict)
        self.assertEqual(result["reason"], "write_failed")
        self.assertEqual(opened.call_count, 1)

    def test_short_writes_send_the_complete_message(self):
        emitted = bytearray()

        def write(descriptor, data):
            self.assertEqual(descriptor, 10)
            chunk = data[:2]
            emitted.extend(chunk)
            return len(chunk)

        with patch("in_band_agent_status.terminals", return_value=iter(["/dev/tty"])), \
                patch("in_band_agent_status.os.open", return_value=10), \
                patch("in_band_agent_status.os.isatty", return_value=True), \
                patch("in_band_agent_status.os.write", side_effect=write), \
                patch("in_band_agent_status.os.close"):
            result = send_to_terminal(b"whole-report")
        self.assertEqual(bytes(emitted), b"whole-report")
        self.assertTrue(result["delivered"])

    def test_zero_byte_write_is_a_failure(self):
        with patch("in_band_agent_status.terminals", return_value=iter(["/dev/tty"])), \
                patch("in_band_agent_status.os.open", return_value=10), \
                patch("in_band_agent_status.os.isatty", return_value=True), \
                patch("in_band_agent_status.os.write", return_value=0), \
                patch("in_band_agent_status.os.close"):
            result = send_to_terminal(b"report")
        self.assertIsInstance(result, dict)
        self.assertFalse(result["delivered"])
        self.assertEqual(result["reason"], "write_failed")

    def test_normal_hook_keeps_footer_but_diagnostic_hook_exposes_failed_delivery(self):
        for agent in ("claude", "agy"):
            for diagnose in (False, True):
                stdout, stderr = io.StringIO(), io.StringIO()
                args = ["reporter", agent] + (["--diagnose"] if diagnose else [])
                with patch.object(sys, "argv", args), patch.object(sys, "stdin", io.StringIO("{}")), \
                        patch.object(sys, "stdout", stdout), patch.object(sys, "stderr", stderr), \
                        patch("in_band_agent_status.terminals", return_value=iter(["/dev/tty"])), \
                        patch("in_band_agent_status.os.open", side_effect=OSError(errno.ENXIO, "no tty")):
                    code = main()
                self.assertEqual(code, 1 if diagnose else 0, (agent, stderr.getvalue()))
                self.assertIn("Context:", stdout.getvalue())
                if diagnose:
                    result = json.loads(stderr.getvalue())
                    self.assertEqual(result["delivery"]["reason"], "no_ancestor_terminal")
                    self.assertEqual(result["client_receipt"], "unverified")
                else:
                    self.assertEqual(stderr.getvalue(), "")

    def test_codex_malformed_notifications_do_not_crash_normal_hook(self):
        for notification in ("not json", "[]", "null"):
            with patch.object(sys, "argv", ["reporter", "codex", notification]):
                self.assertEqual(main(), 0)

    def test_agy_nonfinite_reset_does_not_crash_status_line(self):
        for seconds in (math.inf, math.nan, 10 ** 1000):
            data = {"model": "Gemini", "quota": {"gemini-5h": {
                "remaining_fraction": 0.5, "reset_in_seconds": seconds}}}
            report = agy_report(data)
            self.assertEqual(report["usage"], 0.5)
            self.assertNotIn("usage_resets_at", report)




    def test_diagnostic_codex_reports_daemon_ancestry_even_without_a_rollout(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.object(sys, "argv", ["reporter", "codex", "--diagnose", "{}"]), \
                patch.object(sys, "stdout", stdout), patch.object(sys, "stderr", stderr), \
                patch("in_band_agent_status.codex_daemon_ancestor", return_value=True):
            self.assertEqual(main(), 1)
        result = json.loads(stderr.getvalue())
        self.assertTrue(result["daemon_ancestor"])
        self.assertIn("--no-daemon", result["advice"])

    def test_detached_process_with_no_terminal_anywhere_returns_diagnostic_failure(self):
        if not sys.platform.startswith("linux"):
            self.skipTest("requires Linux /proc")
        with patch.multiple("in_band_agent_status.os", getppid=lambda: 1), \
                patch("in_band_agent_status.os.open", side_effect=OSError(errno.ENXIO, "no tty")):
            result = send_to_terminal(b"report")
        self.assertFalse(result["delivered"])
        self.assertEqual(result["reason"], "no_ancestor_terminal")

    def test_codex_nonfinite_or_boolean_tokens_are_unknown_instead_of_crashing(self):
        thread = "11111111-1111-1111-1111-111111111111"
        with tempfile.TemporaryDirectory() as directory:
            sessions = Path(directory) / "sessions"
            sessions.mkdir()
            rollout = sessions / ("rollout-" + thread + ".jsonl")
            for tokens, window in ((math.nan, 100), (math.inf, 100), (1, math.inf),
                                   (True, 100), (1, True), (10 ** 1000, 100)):
                rollout.write_text(json.dumps({"payload": {"type": "token_count", "info": {
                    "last_token_usage": {"total_tokens": tokens}, "model_context_window": window}}}))
                report = codex_report({"type": "agent-turn-complete", "thread-id": thread}, Path(directory))
                self.assertIsNone(report["context"], (tokens, window))
                osc_message(report)



    def test_permission_denied_on_the_intended_terminal_never_routes_to_an_outer_pane(self):
        emitted = bytearray()
        with patch("in_band_agent_status.terminals", return_value=iter([
                "/dev/tty", "/dev/pts/inner", "/dev/pts/outer"])), \
                patch("in_band_agent_status.os.open", side_effect=[
                    OSError(errno.ENXIO, "detached"), PermissionError(errno.EACCES, "inner denied"), 10]), \
                patch("in_band_agent_status.os.isatty", return_value=True), \
                patch("in_band_agent_status.os.write", side_effect=lambda fd, chunk: (emitted.extend(chunk), len(chunk))[1]), \
                patch("in_band_agent_status.os.close"):
            result = send_to_terminal(b"private-pane-report")
        self.assertFalse(result["delivered"])
        self.assertEqual(result["reason"], "permission_denied")
        self.assertEqual(emitted, b"")



    @unittest.skipUnless(sys.platform.startswith("linux"), "requires Linux /proc and Unix PTYs")
    def test_nested_real_pty_with_denied_inner_terminal_does_not_leak_to_outer(self):
        import pty

        here = str(Path(__file__).resolve().parent)
        outer_child, outer_master = pty.fork()
        if outer_child == 0:
            inner_child, inner_master = pty.fork()
            if inner_child == 0:
                inner_tty = os.ttyname(0)
                code = (
                    "import os, sys, json, errno\n"
                    "from unittest.mock import patch\n"
                    "sys.path.insert(0, " + repr(here) + ")\n"
                    "import in_band_agent_status as helper\n"
                    "original_open = os.open\n"
                    "def denied(path, flags):\n"
                    "    if path == " + repr(inner_tty) + ":\n"
                    "        raise PermissionError(errno.EACCES, 'inner denied')\n"
                    "    return original_open(path, flags)\n"
                    "with patch.object(os, 'open', denied):\n"
                    "    print(json.dumps(helper.send_to_terminal(b'PRIVATE-PANE-OSC')))\n"
                )
                result = subprocess.run([sys.executable, "-c", code], start_new_session=True,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
                os.write(1, result.stdout + result.stderr)
                os._exit(result.returncode)
            data = bytearray()
            while True:
                try:
                    chunk = os.read(inner_master, 4096)
                except OSError:
                    break
                if not chunk:
                    break
                data.extend(chunk)
            os.close(inner_master)
            _, status = os.waitpid(inner_child, 0)
            os.write(1, bytes(data))
            os._exit(os.waitstatus_to_exitcode(status))
        data = bytearray()
        try:
            while True:
                try:
                    chunk = os.read(outer_master, 4096)
                except OSError:
                    break
                if not chunk:
                    break
                data.extend(chunk)
        finally:
            os.close(outer_master)
        _, status = os.waitpid(outer_child, 0)
        self.assertEqual(os.waitstatus_to_exitcode(status), 0, bytes(data))
        self.assertNotIn(b"PRIVATE-PANE-OSC", data)
        result = json.loads(bytes(data))
        self.assertFalse(result["delivered"])
        self.assertEqual(result["reason"], "permission_denied")



    def test_shared_daemon_never_uses_an_inherited_ancestor_terminal(self):
        thread = "11111111-1111-1111-1111-111111111111"
        with tempfile.TemporaryDirectory() as directory:
            sessions = Path(directory) / "sessions"
            sessions.mkdir()
            (sessions / ("rollout-" + thread + ".jsonl")).write_text(json.dumps({
                "payload": {"type": "token_count", "info": {"last_token_usage": {
                    "total_tokens": 20}, "model_context_window": 100}}}))
            for diagnose in (False, True):
                args = ["reporter", "codex", json.dumps({"type": "agent-turn-complete", "thread-id": thread})]
                if diagnose:
                    args.append("--diagnose")
                stderr = io.StringIO()
                with patch.object(sys, "argv", args), patch.object(sys, "stderr", stderr), \
                        patch.dict(os.environ, {"CODEX_HOME": directory}), \
                        patch("in_band_agent_status.codex_daemon_ancestor", return_value=True), \
                        patch("in_band_agent_status.send_to_terminal") as sender:
                    code = main()
                self.assertEqual(code, 1 if diagnose else 0)
                sender.assert_not_called()
                if diagnose:
                    result = json.loads(stderr.getvalue())
                    self.assertEqual(result["report"]["context"], 0.2)
                    self.assertEqual(result["delivery"]["reason"], "shared_daemon")
                    self.assertIn("--no-daemon", result["advice"])



    def test_agy_effort_alone_cannot_select_a_model_quota_bucket(self):
        report = agy_report({"model": {"effort": "high"}, "quota": {
            "3p-5h": {"remaining_fraction": 0.2}}})
        self.assertIsNone(report["usage"])


class SetupCheckTests(unittest.TestCase):
    def run_check(self, agent, config, extra=(), tty_error=None, daemon=False):
        stdout = io.StringIO()
        with patch.object(sys, "argv", ["reporter", "check", agent, "--config", str(config), *extra]), \
                patch.object(sys, "stdout", stdout), \
                patch("in_band_agent_status.terminals", return_value=iter(["/dev/tty"])), \
                patch("in_band_agent_status.os.open", side_effect=tty_error, return_value=10), \
                patch("in_band_agent_status.os.isatty", return_value=True), \
                patch("in_band_agent_status.os.close"), \
                patch("in_band_agent_status.codex_daemon_ancestor", return_value=daemon, create=True):
            code = main()
        return code, json.loads(stdout.getvalue())

    def test_check_reads_config_and_payload_without_overwriting_existing_hooks(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "settings.json"
            payload = Path(directory) / "payload.json"
            original = json.dumps({"statusLine": {"type": "command", "command":
                'python3 "/home/user/my tools/doomterm-agent-status-in-band" claude'},
                "hooks": {"Stop": [{"command": "keep-existing-hook"}]}})
            config.write_text(original)
            payload.write_text(json.dumps({"context_window": {"used_percentage": 34}}))
            code, result = self.run_check("claude", config, ["--payload", str(payload)])
            self.assertEqual(config.read_text(), original)
        self.assertEqual(code, 0)
        self.assertEqual(result["checks"]["configuration"]["status"], "pass")
        self.assertEqual(result["checks"]["measurements"]["report"]["context"], 0.34)
        self.assertIsNone(result["checks"]["measurements"]["report"]["usage"])
        self.assertEqual(result["checks"]["reload"]["status"], "unverified")
        self.assertEqual(result["checks"]["client_receipt"]["status"], "unverified")
        self.assertFalse(result["checks"]["terminal"]["delivery"]["delivered"])

    def test_check_identifies_disabled_agy_statusline(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "settings.json"
            config.write_text(json.dumps({"statusLine": {
                "command": "python3 /home/user/doomterm-agent-status-in-band agy", "enabled": False}}))
            code, result = self.run_check("agy", config)
        self.assertEqual(code, 1)
        self.assertEqual(result["checks"]["configuration"]["status"], "fail")
        self.assertIn("enable", result["checks"]["configuration"]["detail"].lower())

    def test_check_does_not_treat_a_different_agents_hook_as_configured(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "settings.json"
            config.write_text(json.dumps({"statusLine": {
                "command": "python3 /home/user/doomterm-agent-status-in-band claude"}}))
            code, result = self.run_check("agy", config)
        self.assertEqual(code, 1)
        self.assertEqual(result["checks"]["configuration"]["status"], "fail")

    def test_check_explains_terminal_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "settings.json"
            config.write_text(json.dumps({"statusLine": {
                "command": "python3 /home/user/doomterm-agent-status-in-band agy"}}))
            code, result = self.run_check("agy", config, tty_error=PermissionError(errno.EACCES, "denied"))
        self.assertEqual(code, 1)
        self.assertEqual(result["checks"]["terminal"]["delivery"]["reason"], "permission_denied")
        self.assertIn("administrator", result["checks"]["terminal"]["detail"])

    def test_check_detects_daemon_and_never_claims_runtime_config_is_loaded(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "config.toml"
            config.write_text('notify = ["python3", "/home/user/doomterm-agent-status-in-band", "codex"]\n')
            code, result = self.run_check("codex", config, daemon=True)
        self.assertEqual(code, 1)
        self.assertEqual(result["checks"]["daemon"]["status"], "fail")
        self.assertIn("--no-daemon", result["checks"]["daemon"]["detail"])
        self.assertEqual(result["checks"]["reload"]["status"], "unverified")

    def test_check_reports_unknown_measurements_and_hash_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "settings.json"
            config.write_text(json.dumps({"statusLine": {
                "command": "python3 /home/user/doomterm-agent-status-in-band agy"}}))
            code, result = self.run_check("agy", config, ["--expected-sha256", "0" * 64])
        self.assertEqual(code, 1)
        self.assertEqual(result["checks"]["helper"]["status"], "fail")
        self.assertEqual(result["checks"]["measurements"]["status"], "unverified")

    def test_check_rejects_malformed_payload_with_an_explanation(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "settings.json"
            config.write_text(json.dumps({"statusLine": {
                "command": "python3 /home/user/doomterm-agent-status-in-band agy"}}))
            payload = Path(directory) / "payload.json"
            payload.write_text("not json")
            code, result = self.run_check("agy", config, ["--payload", str(payload)])
        self.assertEqual(code, 1)
        self.assertEqual(result["checks"]["measurements"]["status"], "fail")



    def test_invalid_config_shapes_fail_before_command_inspection(self):
        cases = (
            ("codex", 'notify = "python3 /tmp/doomterm-agent-status-in-band codex"'),
            ("claude", json.dumps({"statusLine": {"type": "command", "command": [
                "python3", "/tmp/doomterm-agent-status-in-band", "claude"]}})),
            ("claude", json.dumps({"statusLine": {"type": "invalid", "command":
                "python3 /tmp/doomterm-agent-status-in-band claude"}})),
            ("agy", json.dumps({"statusLine": {"enabled": "false", "command":
                "python3 /tmp/doomterm-agent-status-in-band agy"}})),
        )
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "config"
            for agent, text in cases:
                config.write_text(text)
                code, result = self.run_check(agent, config)
                self.assertEqual(code, 1, (agent, text, result))
                self.assertEqual(result["checks"]["configuration"]["status"], "fail")

    def test_commands_that_only_mention_the_helper_remain_unverified(self):
        commands = ("echo /tmp/doomterm-agent-status-in-band agy",
                    "python3 --version /tmp/doomterm-agent-status-in-band agy",
                    "python3 /tmp/doomterm-agent-status-in-band agy; true")
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "config"
            for command in commands:
                config.write_text(json.dumps({"statusLine": {"command": command}}))
                _, result = self.run_check("agy", config)
                self.assertEqual(result["checks"]["configuration"]["status"], "unverified", command)


if __name__ == "__main__":
    unittest.main()
