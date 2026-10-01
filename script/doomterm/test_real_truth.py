import json
import tempfile
import unittest
from pathlib import Path

import real_truth


def write_lines(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in records), encoding="utf-8")


def assistant(timestamp, model="claude-opus-5-5", tokens=160_000, sidechain=False):
    return {"type": "assistant", "timestamp": timestamp, "isSidechain": sidechain,
            "message": {"model": model, "usage": {"input_tokens": 2, "cache_creation_input_tokens": 0,
                                                  "cache_read_input_tokens": tokens - 2}}}


class TimestampTests(unittest.TestCase):
    def test_an_iso_timestamp_with_fraction_becomes_unix_seconds(self):
        self.assertAlmostEqual(real_truth.iso_to_unix("2026-09-30T20:00:00.500Z"), 1790798400.5, places=3)

    def test_an_unreadable_timestamp_is_none(self):
        self.assertIsNone(real_truth.iso_to_unix("yesterday"))
        self.assertIsNone(real_truth.iso_to_unix(None))


class ClaudeTruthTests(unittest.TestCase):
    def test_each_real_turn_states_the_context_fill_at_its_own_time(self):
        with tempfile.TemporaryDirectory() as directory:
            transcript = Path(directory) / "project" / "s.jsonl"
            write_lines(transcript, [
                {"type": "user", "timestamp": "2026-09-30T20:00:00Z"},
                assistant("2026-09-30T20:00:05Z", tokens=100_000),
                assistant("2026-09-30T20:00:09Z", model="<synthetic>", tokens=2),
                assistant("2026-09-30T20:00:20Z", tokens=250_000),
                assistant("2026-09-30T20:00:21Z", tokens=900_000, sidechain=True),
            ])
            truth = real_truth.claude_truth(Path(directory), since=0)
        self.assertEqual([round(pct) for _, pct in truth], [10, 25])

    def test_files_not_touched_since_the_run_began_are_ignored(self):
        with tempfile.TemporaryDirectory() as directory:
            transcript = Path(directory) / "project" / "old.jsonl"
            write_lines(transcript, [assistant("2026-09-30T20:00:05Z")])
            self.assertEqual(real_truth.claude_truth(Path(directory), since=4_000_000_000), [])


class CodexTruthTests(unittest.TestCase):
    def test_context_and_five_hour_usage_come_from_the_events_that_state_them(self):
        def event(timestamp, total, windows):
            return {"timestamp": timestamp, "payload": {"type": "token_count", "info": {
                "last_token_usage": {"total_tokens": total}, "model_context_window": 100_000},
                "rate_limits": {"primary": windows[0], "secondary": windows[1]}}}

        five = {"used_percent": 40.0, "window_minutes": 300}
        week = {"used_percent": 60.0, "window_minutes": 10080}
        with tempfile.TemporaryDirectory() as directory:
            rollout = Path(directory) / "2026" / "09" / "30" / "rollout-x.jsonl"
            write_lines(rollout, [event("2026-09-30T20:00:05Z", 10_000, (five, week)),
                                  event("2026-09-30T20:00:15Z", 12_000, (week, None))])
            truth = real_truth.codex_truth(Path(directory), since=0)
        self.assertEqual([(round(c), u) for _, c, u in truth], [(10, 40), (12, 40)])

    def test_a_running_older_session_does_not_enter_a_new_runs_ground_truth(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            old = root / "rollout-old.jsonl"
            new = root / "rollout-new.jsonl"
            def event(timestamp, tokens, usage):
                return {"timestamp": timestamp, "payload": {"type": "token_count",
                        "info": {"last_token_usage": {"total_tokens": tokens},
                                 "model_context_window": 100_000},
                        "rate_limits": {"primary": {"used_percent": usage,
                                                     "window_minutes": 300}}}}
            write_lines(old, [event("2026-09-30T20:00:00Z", 50_000, 80)])
            write_lines(new, [event("2026-09-30T20:10:00Z", 10_000, 20)])
            since = real_truth.iso_to_unix("2026-09-30T20:05:00Z")
            truth = real_truth.codex_truth(root, since)
        self.assertEqual([(round(c), u) for _, c, u in truth], [(10, 20)])


if __name__ == "__main__":
    unittest.main()
