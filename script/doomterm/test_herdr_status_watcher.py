import errno
import json
import io
import os
import sys
import tempfile
import socket
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import in_band_agent_status as status


CLAUDE_ID = "11111111-1111-1111-1111-111111111111"
CODEX_ID = "22222222-2222-2222-2222-222222222222"
HERDR_VARIABLES = ("HERDR_ENV", "HERDR_PANE_ID", "HERDR_SOCKET_PATH", "HERDR_SESSION",
                   "DOOMTERM_HERDR_WATCHER")
_ambient_herdr = {}


def setUpModule():
    # Run inside a herdr pane, an unpatched delivery would reach the real attached clients.
    for name in HERDR_VARIABLES:
        if name in os.environ:
            _ambient_herdr[name] = os.environ.pop(name)


def tearDownModule():
    os.environ.update(_ambient_herdr)


def serve_herdr(test, path, state, connections):
    """Answers `connections` herdr API requests for one pane, as herdr's socket does."""
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    test.addCleanup(server.close)
    server.bind(path)
    server.listen()
    errors = []

    def serve():
        try:
            for _ in range(connections):
                connection, _ = server.accept()
                with connection:
                    request = json.loads(connection.makefile("rb").readline())
                    if request["method"] == "session.snapshot":
                        result = {"snapshot": {"focused_pane_id": state["pane_id"],
                                               "panes": [state]}}
                    elif request["method"] == "pane.get":
                        result = {"pane": state}
                    elif request["method"] == "pane.process_info":
                        result = {"process_info": {"foreground_processes": []}}
                    else:
                        raise AssertionError(request)
                    connection.sendall((json.dumps({"result": result}) + "\n").encode())
        except Exception as error:
            errors.append(error)

    worker = threading.Thread(target=serve, daemon=True)
    worker.start()
    return worker, errors


class HerdrWatcherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.pane = {"socket": str(self.home / "herdr.sock"), "pane_id": "w1:p1"}
        self.env = patch.dict(os.environ, {
            "XDG_CACHE_HOME": str(self.home / "cache"),
            "CODEX_HOME": str(self.home / "codex"),
        })
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_switch_to_idle_codex_uses_its_registered_thread(self):
        sessions = self.home / "codex" / "sessions"
        sessions.mkdir(parents=True)
        (sessions / ("rollout-" + CODEX_ID + ".jsonl")).write_text(json.dumps({
            "payload": {"type": "token_count", "info": {
                "last_token_usage": {"total_tokens": 25000},
                "model_context_window": 100000,
            }, "rate_limits": {"primary": {
                "window_minutes": 300, "used_percent": 12,
            }}},
        }) + "\n")
        # A more recent unrelated thread must never be selected.
        (sessions / ("rollout-" + CLAUDE_ID + ".jsonl")).write_text("{}\n")
        info = {"pane_id": "w1:p1", "agent": "codex", "agent_status": "idle",
                "agent_session": {"agent": "codex", "kind": "id", "value": CODEX_ID}}
        report = status.herdr_watch_report(self.pane, info)
        self.assertEqual((report["agent"], report["context"], report["usage"],
                          report["working"]), ("codex", 0.25, 0.12, False))

    def test_background_claude_measurements_are_available_on_focus(self):
        status.cache_herdr_report(self.pane, {
            "agent": "claude", "context": 0.34, "usage": 0.56,
            "working": None, "diff": None,
            "session": status.session_identity(CLAUDE_ID),
        })
        info = {"agent": "claude", "agent_status": "working", "agent_session": {
            "agent": "claude", "kind": "id", "value": CLAUDE_ID}}
        report = status.herdr_watch_report(self.pane, info)
        self.assertEqual((report["context"], report["usage"], report["working"]),
                         (0.34, 0.56, True))

    def test_session_change_does_not_reuse_previous_claude_numbers(self):
        status.cache_herdr_report(self.pane, {
            "agent": "claude", "context": 0.8, "usage": 0.7,
            "working": None, "diff": None,
            "session": status.session_identity(CLAUDE_ID),
        })
        report = status.herdr_watch_report(self.pane, {
            "agent": "claude", "agent_session": {
                "agent": "claude", "kind": "id", "value": CODEX_ID}})
        self.assertIsNone(report["context"])
        self.assertIsNone(report["usage"])

    def test_unbound_codex_is_unknown_instead_of_guessing(self):
        with patch.object(status, "herdr_request", return_value=None):
            report = status.herdr_watch_report(self.pane, {"agent": "codex"})
        self.assertEqual(report["agent"], "codex")
        self.assertIsNone(report["context"])
        self.assertIsNone(report["usage"])

    def test_unbound_panes_have_distinct_session_boundaries_for_the_hud(self):
        with patch.object(status, "herdr_request", return_value=None):
            first = status.herdr_watch_report(self.pane, {"agent": "codex"})
            second = status.herdr_watch_report(
                {"socket": self.pane["socket"], "pane_id": "w1:p2"}, {"agent": "codex"})
        self.assertIsNotNone(first.get("session"))
        self.assertNotEqual(first.get("session"), second.get("session"))

    def test_non_object_cache_is_treated_as_unavailable(self):
        path = status.herdr_cache_path(self.pane)
        path.parent.mkdir(parents=True)
        path.write_text("[]")
        with patch.object(status, "herdr_request", return_value=None):
            report = status.herdr_watch_report(self.pane, {"agent": "claude"})
        self.assertIsNone(report["context"])

    def test_watcher_can_resolve_server_pid_without_being_a_server_descendant(self):
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.addCleanup(server.close)
        server.bind(self.pane["socket"])
        server.listen()
        self.assertEqual(status.herdr_socket_server_pid(self.pane), os.getpid())

    def test_expired_quota_is_not_replayed(self):
        status.cache_herdr_report(self.pane, {
            "agent": "claude", "context": 0.34, "usage": 0.56,
            "working": None, "diff": None, "usage_resets_at": 1,
            "session": status.session_identity(CLAUDE_ID),
        })
        report = status.herdr_watch_report(self.pane, {"agent": "claude", "agent_session": {
            "agent": "claude", "kind": "id", "value": CLAUDE_ID}})
        self.assertEqual(report["context"], 0.34)
        self.assertIsNone(report["usage"])

    def test_hook_caches_background_measurements_without_sending_them(self):
        environment = {"HERDR_ENV": "1", "HERDR_PANE_ID": "w1:p1",
                       "HERDR_SOCKET_PATH": self.pane["socket"]}
        payload = {"session_id": CLAUDE_ID, "context_window": {"used_percentage": 34}}
        with patch.dict(os.environ, environment), \
                patch.object(status.sys, "argv", ["helper", "claude"]), \
                patch.object(status.sys, "stdin", io.StringIO(json.dumps(payload))), \
                patch.object(status, "herdr_pane_info", return_value={"focused": False}), \
                patch.object(status, "herdr_request", return_value=None):
            self.assertEqual(status.main(), 0)
        report = status.herdr_watch_report(self.pane, {"agent": "claude", "agent_session": {
            "agent": "claude", "kind": "id", "value": CLAUDE_ID}})
        self.assertEqual(report["context"], 0.34)

    def test_missing_session_and_process_identity_cannot_reuse_old_readings(self):
        with patch.object(status, "herdr_request", return_value=None):
            status.cache_herdr_report(self.pane, {
                "agent": "claude", "context": 0.8, "usage": 0.7,
                "working": None, "diff": None,
            })
            report = status.herdr_watch_report(self.pane, {"agent": "claude"})
        self.assertIsNone(report["context"])

    def test_same_process_cache_keeps_hook_session_without_herdr_session_metadata(self):
        with patch.object(status, "herdr_process_identity", return_value=[[123, "456"]]):
            status.cache_herdr_report(self.pane, {
                "agent": "claude", "context": 0.34, "usage": 0.56,
                "working": None, "diff": None, "session": 123456,
            })
            report = status.herdr_watch_report(self.pane, {"agent": "claude"})
        self.assertEqual(report["session"], 123456)

    def test_missing_bound_rollout_clears_the_huds_previous_session_values(self):
        reference = {"agent": "codex", "kind": "id", "value": CODEX_ID}
        report = status.herdr_watch_report(self.pane, {"agent": "codex", "agent_session": reference})
        self.assertNotEqual(report["session"], status.session_identity(CODEX_ID))

    def test_focus_switch_during_read_prevents_stale_delivery(self):
        snapshot = {"snapshot": {"focused_pane_id": "w1:p1", "panes": [
            {"pane_id": "w1:p1", "agent": "claude"}]}}
        with patch.object(status, "herdr_request", return_value=snapshot), \
                patch.object(status, "herdr_pane_info", return_value={"focused": False}):
            result = status.herdr_watch_tick(self.pane["socket"])
        self.assertFalse(result["delivery"]["delivered"])
        self.assertEqual(result["delivery"]["reason"], "focus_changed")

    def test_socket_and_pty_receive_only_the_selected_agents_numbers(self):
        # Real API framing and a real PTY exercise the complete watcher delivery path.
        status.cache_herdr_report(self.pane, {
            "agent": "claude", "context": 0.34, "usage": 0.56,
            "working": None, "diff": None, "session": status.session_identity(CLAUDE_ID),
        })
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.addCleanup(server.close)
        server.bind(self.pane["socket"])
        server.listen()
        master, slave = os.openpty()
        self.addCleanup(os.close, master)
        self.addCleanup(os.close, slave)
        target = os.ttyname(slave)
        state = {"agent": "claude", "agent_status": "idle", "pane_id": "w1:p1",
                 "focused": True, "agent_session": {
                     "agent": "claude", "kind": "id", "value": CLAUDE_ID}}
        errors = []

        def serve():
            try:
                for _ in range(2):
                    connection, _ = server.accept()
                    with connection:
                        request = json.loads(connection.makefile("rb").readline())
                        if request["method"] == "session.snapshot":
                            result = {"snapshot": {"focused_pane_id": "w1:p1", "panes": [state]}}
                        elif request["method"] == "pane.get":
                            result = {"pane": state}
                        else:
                            raise AssertionError(request)
                        connection.sendall((json.dumps({"result": result}) + "\n").encode())
            except Exception as error:
                errors.append(error)

        worker = threading.Thread(target=serve, daemon=True)
        worker.start()
        with patch.object(status, "herdr_client_holders",
                          side_effect=lambda pane: iter([(target, os.getpid(), slave)])):
            result = status.herdr_watch_tick(self.pane["socket"])
        worker.join(timeout=2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(errors, [])
        self.assertTrue(result["delivery"]["delivered"])
        message = os.read(master, 4096)
        report = json.loads(message.split(status.TITLE)[1].split(b"\x07")[0])
        self.assertEqual((report["agent"], report["context"], report["usage"]),
                         ("claude", 0.34, 0.56))

    def test_focus_on_a_pane_without_an_agent_clears_the_plate(self):
        state = {"pane_id": "w1:p1", "agent": None, "agent_status": None, "focused": True}
        worker, errors = serve_herdr(self, self.pane["socket"], state, 2)
        master, slave = os.openpty()
        self.addCleanup(os.close, master)
        self.addCleanup(os.close, slave)
        target = os.ttyname(slave)
        with patch.object(status, "herdr_client_holders",
                          side_effect=lambda pane: iter([(target, os.getpid(), slave)])):
            result = status.herdr_watch_tick(self.pane["socket"])
        worker.join(timeout=2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(errors, [])
        self.assertIsNone(result["report"])
        self.assertTrue(result["delivery"]["delivered"])
        self.assertEqual(os.read(master, 4096), status.TITLE + b'{"agent":null}\x07')

    def test_an_agent_herdr_does_not_recognise_is_named_by_its_own_hook(self):
        with patch.object(status, "herdr_process_identity", return_value=[[321, "99"]]):
            status.cache_herdr_report(self.pane, {
                "agent": "claude", "context": 0.4, "usage": 0.2,
                "working": None, "diff": None, "session": 77,
            })
            report = status.herdr_watch_report(self.pane, {"agent": None, "agent_status": "idle"})
        self.assertEqual((report["agent"], report["context"], report["session"], report["working"]),
                         ("claude", 0.4, 77, False))
        # Once another process holds the pane, the hook's numbers describe nothing in it.
        with patch.object(status, "herdr_process_identity", return_value=[[654, "12"]]):
            self.assertIsNone(status.herdr_watch_report(self.pane, {"agent": None}))

    def test_an_unchanged_report_is_written_again_only_when_clients_change_or_on_heartbeat(self):
        snapshot = {"snapshot": {"focused_pane_id": "w1:p1", "panes": [
            {"pane_id": "w1:p1", "agent": None}]}}
        holders = [("/dev/pts/91", 1, 1)]
        sent = []

        def send(message):
            sent.append(message)
            return {"delivered": True, "writable": True, "reason": "sent",
                    "terminal": holders[0][0], "attempts": []}

        with patch.object(status, "herdr_request", return_value=snapshot), \
                patch.object(status, "herdr_pane_info", return_value={"focused": True}), \
                patch.object(status, "terminal_holders", side_effect=lambda: iter(list(holders))), \
                patch.object(status, "send_to_terminal", side_effect=send):
            first = status.herdr_watch_tick(self.pane["socket"], None, now=100.0)
            repeat = status.herdr_watch_tick(self.pane["socket"], first["sent"], now=101.0)
            heartbeat = status.herdr_watch_tick(
                self.pane["socket"], repeat["sent"], now=100.0 + status.WATCH_HEARTBEAT)
            holders.append(("/dev/pts/92", 2, 1))
            attached = status.herdr_watch_tick(
                self.pane["socket"], heartbeat["sent"], now=101.0 + status.WATCH_HEARTBEAT)
        self.assertEqual(repeat["delivery"]["reason"], "unchanged")
        self.assertEqual(repeat["sent"], first["sent"])
        self.assertEqual(heartbeat["delivery"]["reason"], "sent")
        self.assertEqual(attached["delivery"]["reason"], "sent")
        self.assertEqual(attached["sent"]["clients"], ["/dev/pts/91", "/dev/pts/92"])
        self.assertEqual(len(sent), 3)

    @unittest.skipIf(os.name == "nt", "requires flock")
    def test_a_hook_leaves_delivery_to_a_running_watcher(self):
        import fcntl

        directory = status.herdr_cache_directory(self.pane)
        directory.mkdir(parents=True)
        self.assertFalse(status.herdr_watcher_running(self.pane))
        environment = {"HERDR_ENV": "1", "HERDR_PANE_ID": "w1:p1",
                       "HERDR_SOCKET_PATH": self.pane["socket"]}
        payload = {"session_id": CLAUDE_ID, "context_window": {"used_percentage": 34}}
        stderr = io.StringIO()
        with open(directory / "watch.lock", "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertTrue(status.herdr_watcher_running(self.pane))
            with patch.dict(os.environ, environment), \
                    patch.object(status.sys, "argv", ["helper", "claude", "--diagnose"]), \
                    patch.object(status.sys, "stdin", io.StringIO(json.dumps(payload))), \
                    patch.object(status.sys, "stderr", stderr), \
                    patch.object(status, "herdr_pane_info", return_value={"focused": True}), \
                    patch.object(status, "herdr_request", return_value=None), \
                    patch.object(status, "send_to_terminal") as send:
                self.assertEqual(status.main(), 0)
            send.assert_not_called()
        self.assertEqual(json.loads(stderr.getvalue())["delivery"]["reason"], "herdr_watcher")
        self.assertFalse(status.herdr_watcher_running(self.pane))
        report = status.herdr_watch_report(self.pane, {"agent": "claude", "agent_session": {
            "agent": "claude", "kind": "id", "value": CLAUDE_ID}})
        self.assertEqual(report["context"], 0.34)

    @unittest.skipUnless(sys.platform.startswith("linux"), "watch-herdr runs on Linux or macOS")
    def test_the_watcher_waits_out_a_hooks_probe_but_yields_to_another_watcher(self):
        import fcntl

        directory = status.herdr_cache_directory(self.pane)
        directory.mkdir(parents=True)
        path = directory / "watch.lock"
        probe = open(path, "w")
        fcntl.flock(probe, fcntl.LOCK_SH)
        release = threading.Timer(0.3, probe.close)
        release.start()
        self.addCleanup(release.cancel)
        done = {"sent": None, "report": None, "delivery": {"delivered": True}}
        arguments = ["--socket", self.pane["socket"], "--once"]
        with patch.object(status, "herdr_watch_tick", return_value=done) as tick:
            self.assertEqual(status.watch_herdr(arguments), 0)
        tick.assert_called_once()
        with open(path, "w") as other:
            fcntl.flock(other, fcntl.LOCK_EX)
            started = time.monotonic()
            with patch.object(status, "herdr_watch_tick") as tick:
                self.assertEqual(status.watch_herdr(arguments), 0)
            tick.assert_not_called()
            self.assertLess(time.monotonic() - started, 5)

    def test_macos_clients_are_found_from_ps(self):
        uid, stranger = os.getuid(), os.getuid() + 1
        listing = "\n".join(line.format(u=uid, s=stranger) for line in (
            "    1     0 0  ??       /sbin/launchd",
            "  500     1 {u} ??       /Users/u/.local/bin/herdr server",
            "  510   500 {u} ttys004  /bin/zsh -l",
            "  512   510 {u} ttys004  herdr",
            "  520     1 {u} ttys001  -zsh",
            "  521   520 {u} ttys001  /Users/u/.local/bin/herdr",
            "  530     1 {u} ttys002  herdr --session work",
            "  540     1 {s} ttys003  herdr",
            "  550     1 {u} ??       herdr",
        ))
        with patch.object(status.sys, "platform", "darwin"), \
                patch.object(status.subprocess, "check_output", return_value=listing), \
                patch.object(status.os, "getppid", return_value=510):
            holders = list(status.herdr_client_holders(self.pane))
        # 512 runs inside a pane (under the server), 530 is another session, 540 another
        # account and 550 has no terminal.
        self.assertEqual(holders, [("/dev/ttys001", 521, None)])

    def test_macos_process_identity_is_its_start_time(self):
        with patch.object(status.sys, "platform", "darwin"), \
                patch.object(status.subprocess, "check_output",
                             return_value="Mon Oct 12 22:50:20 2026\n") as ps:
            self.assertEqual(status.process_start(4242), "Mon Oct 12 22:50:20 2026")
        self.assertEqual(ps.call_args[0][0], ["ps", "-o", "lstart=", "-p", "4242"])

    def test_native_windows_herdr_panes_are_reported_unsupported(self):
        environment = {"HERDR_ENV": "1", "HERDR_PANE_ID": "w1:p1",
                       "HERDR_SOCKET_PATH": r"\\.\pipe\herdr"}
        with patch.dict(os.environ, environment), \
                patch.object(status.os, "name", "nt"), \
                patch.object(status, "terminal_holders") as holders, \
                patch.object(status.os, "open") as opened:
            result = status.send_to_terminal(b"REPORT")
        holders.assert_not_called()
        opened.assert_not_called()
        self.assertEqual((result["delivered"], result["reason"]), (False, "herdr_unsupported"))
        self.assertIn("Windows", status.delivery_advice(result))


if __name__ == "__main__":
    unittest.main()
