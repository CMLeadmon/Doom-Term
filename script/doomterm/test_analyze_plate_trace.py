import json
import tempfile
import unittest
from pathlib import Path

import analyze_plate_trace as analysis


def plate(t_s, **fields):
    state = {"ev": "plate", "t_ms": t_s * 1000.0, "agent": "claude", "working": True,
             "context_pct": 16, "usage_pct": 22, "waiting": 0, "rows": []}
    state.update(fields)
    return state


def ticks(start_s, end_s, step_ms, name="tick"):
    count = int((end_s - start_s) * 1000 / step_ms)
    return [{"ev": name, "t_ms": start_s * 1000.0 + i * step_ms} for i in range(count)]


def write_run(directory, trace=(), fb=(), markers=()):
    for name, records in (("trace.jsonl", trace), ("fb.jsonl", fb), ("markers.jsonl", markers)):
        with open(Path(directory) / name, "w", encoding="utf-8") as stream:
            for record in records:
                stream.write(json.dumps(record) + "\n")


class IntervalTests(unittest.TestCase):
    def test_regular_ticks_have_a_flat_interval_distribution(self):
        stats = analysis.interval_stats([t["t_ms"] for t in ticks(0, 10, 100)])
        self.assertEqual(stats["n"], 99)
        self.assertEqual(stats["p50"], 100.0)
        self.assertEqual(stats["max"], 100.0)

    def test_too_few_points_give_no_statistics(self):
        self.assertEqual(analysis.interval_stats([5.0])["n"], 0)


class FlickerTests(unittest.TestCase):
    def test_a_value_that_drops_to_a_dash_and_returns_counts_one_flip(self):
        states = [plate(1), plate(2, context_pct=None), plate(3), plate(4, context_pct=None)]
        flicker = analysis.plate_flicker(states)
        self.assertEqual(flicker["context_dash_flips"], 2)
        self.assertEqual(flicker["usage_dash_flips"], 0)

    def test_usage_dashes_are_counted_separately(self):
        states = [plate(1), plate(2, usage_pct=None)]
        self.assertEqual(analysis.plate_flicker(states)["usage_dash_flips"], 1)

    def test_waiting_count_changes_and_quick_reversals(self):
        states = [plate(1, waiting=0), plate(2, waiting=1), plate(3, waiting=0),
                  plate(4, waiting=1), plate(30, waiting=2)]
        flicker = analysis.plate_flicker(states)
        self.assertEqual(flicker["waiting_changes"], 4)
        self.assertEqual(flicker["waiting_reversals_5s"], 2)

    def test_a_slow_change_is_not_a_reversal(self):
        states = [plate(1, waiting=0), plate(20, waiting=1), plate(60, waiting=0)]
        self.assertEqual(analysis.plate_flicker(states)["waiting_reversals_5s"], 0)

    def test_row_renumbering_is_a_row_change(self):
        rows_a = [{"n": "1", "name": "a", "status": "Working"}]
        rows_b = [{"n": "1", "name": "b", "status": "Working"}]
        states = [plate(1, rows=rows_a), plate(2, rows=rows_b), plate(3, rows=rows_b)]
        self.assertEqual(analysis.plate_flicker(states)["rows_changes"], 1)


def shown(wall_s, **fields):
    return plate(wall_s, unix_ms=wall_s * 1000.0, **fields)


def truth_record(wall_s, pid=1, **fields):
    return {"wall": wall_s, "pid": pid, **fields}


class AccuracyTests(unittest.TestCase):
    def test_a_display_that_matches_the_truth_throughout_scores_one_hundred(self):
        truth = analysis.truth_steps(
            [truth_record(0, event="start", context_pct=16)], "context_pct")
        states = [shown(0, context_pct=16)]
        score = analysis.accuracy(states, truth, "context_pct", 10, 110)
        self.assertEqual(score["match_pct"], 100.0)

    def test_a_dash_while_the_truth_is_known_is_a_mismatch(self):
        truth = analysis.truth_steps(
            [truth_record(0, event="start", context_pct=16)], "context_pct")
        states = [shown(0, context_pct=16), shown(60, context_pct=None)]
        score = analysis.accuracy(states, truth, "context_pct", 10, 110)
        self.assertAlmostEqual(score["match_pct"], 50.0, delta=0.5)

    def test_lag_after_a_truth_change_is_forgiven(self):
        truth = analysis.truth_steps([
            truth_record(0, event="start", working=False),
            truth_record(50, working=True)], "waiting")
        states = [shown(0, waiting=1), shown(52, waiting=0)]
        score = analysis.accuracy(states, truth, "waiting", 10, 110, lag_s=4.0)
        self.assertEqual(score["match_pct"], 100.0)

    def test_a_change_shown_later_than_the_lag_is_penalised(self):
        truth = analysis.truth_steps([
            truth_record(0, event="start", working=False),
            truth_record(50, working=True)], "waiting")
        states = [shown(0, waiting=1), shown(60, waiting=0)]
        score = analysis.accuracy(states, truth, "waiting", 10, 110, lag_s=4.0)
        self.assertAlmostEqual(score["match_pct"], 94.0, delta=0.5)

    def test_waiting_counts_only_live_agents_that_are_not_working(self):
        truth = analysis.truth_steps([
            truth_record(0, pid=1, event="start", working=False),
            truth_record(0, pid=2, event="start", working=False),
            truth_record(20, pid=2, working=True),
            truth_record(40, pid=1, event="exit")], "waiting")
        values = [analysis.value_at(truth, at) for at in (10, 30, 50)]
        self.assertEqual(values, [2, 1, 0])

    def test_the_newest_live_agent_supplies_the_focused_values(self):
        truth = analysis.truth_steps([
            truth_record(0, pid=1, event="start", context_pct=10),
            truth_record(30, pid=2, event="start", context_pct=50),
            truth_record(60, pid=2, event="exit")], "context_pct")
        values = [analysis.value_at(truth, at) for at in (10, 40, 70)]
        self.assertEqual(values, [10, 50, 10])


class RunTests(unittest.TestCase):
    def test_the_window_starts_five_seconds_after_the_agent_is_first_shown(self):
        with tempfile.TemporaryDirectory() as directory:
            trace = [plate(0.1, agent="shell", context_pct=None, usage_pct=None, working=False),
                     plate(10, context_pct=16)]
            trace += [plate(12, context_pct=None), plate(14, context_pct=16)]
            trace += ticks(0, 30, 100)
            write_run(directory, trace=trace)
            metrics = analysis.analyze_run(Path(directory), skip_s=5.0, tail_s=2.0)
        self.assertEqual(metrics["window"]["from_s"], 15.0)
        self.assertEqual(metrics["plate"]["context_dash_flips"], 0)

    def test_dashes_inside_the_window_are_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            trace = [plate(1, context_pct=16), plate(8, context_pct=None), plate(9, context_pct=16)]
            trace += ticks(0, 30, 100)
            write_run(directory, trace=trace)
            metrics = analysis.analyze_run(Path(directory), skip_s=5.0, tail_s=2.0)
        self.assertEqual(metrics["plate"]["context_dash_flips"], 1)

    def test_framebuffer_change_rate_is_measured_between_markers(self):
        with tempfile.TemporaryDirectory() as directory:
            fb = [{"t": i * 0.05, "wall": 1000.0 + i * 0.05, "region": "mark", "crc": i}
                  for i in range(400)]
            markers = [{"name": "agent-started", "wall": 1000.0}, {"name": "agent-end", "wall": 1020.0}]
            write_run(directory, trace=[plate(1)], fb=fb, markers=markers)
            metrics = analysis.analyze_run(Path(directory), skip_s=5.0, tail_s=2.0)
        self.assertAlmostEqual(metrics["framebuffer"]["mark_changes_per_s"], 20.0, delta=0.5)
        self.assertEqual(metrics["framebuffer"]["mark_interval_ms"]["p50"], 50.0)


if __name__ == "__main__":
    unittest.main()
