import gzip
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

    def test_a_value_that_comes_back_within_five_seconds_counts_however_long_it_held_before(self):
        states = [plate(1, waiting=0), plate(20, waiting=1), plate(22, waiting=0)]
        self.assertEqual(analysis.plate_flicker(states)["waiting_reversals_5s"], 1)

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


class TwoWindowTests(unittest.TestCase):
    def test_only_the_agent_window_is_scored_when_a_shell_window_shares_the_trace(self):
        # A launch configuration opens a second window next to the default one; both render the
        # plate into one trace, and the default window always shows a shell.
        with tempfile.TemporaryDirectory() as directory:
            run = Path(directory) / "real-ssh-after-old-script"
            run.mkdir()
            trace = []
            for second in range(1, 30):
                trace.append(shown(second, agent="shell", context_pct=None, usage_pct=None, rows=[]))
                trace.append(shown(second + 0.5, context_pct=16, usage_pct=22))
            trace += [dict(e, unix_ms=e["t_ms"]) for e in ticks(0, 40, 100)]
            write_run(run, trace=trace)
            with open(run / "truth.jsonl", "w", encoding="utf-8") as stream:
                stream.write(json.dumps(truth_record(0, event="start", context_pct=16, usage_pct=22)) + "\n")
            metrics = analysis.analyze_run(run, skip_s=5.0, tail_s=2.0)
        self.assertEqual(metrics["plate"]["context_dash_flips"], 0)
        self.assertEqual(metrics["accuracy"]["context_pct"]["match_pct"], 100.0)


class AnimationCadenceTests(unittest.TestCase):
    def paints(self, phases, step_ms=50, working=True):
        return [{"ev": "paint", "t_ms": i * step_ms, "working": working, "phase": phase}
                for i, phase in enumerate(phases)]

    def test_frames_are_paints_whose_animation_phase_changed(self):
        events = self.paints([0.0, 0.0, 0.1, 0.1, 0.1, 0.2])
        cadence = analysis.animation_cadence(events, 0.0, 1.0)
        self.assertEqual(cadence["frames_per_s"], 3.0)

    def test_repaints_at_the_same_phase_are_not_new_frames(self):
        events = self.paints([0.5] * 40)
        self.assertEqual(analysis.animation_cadence(events, 0.0, 2.0)["frames_per_s"], 0.5)

    def test_paints_of_an_idle_plate_are_not_counted(self):
        events = self.paints([0.1, 0.2, 0.3], working=False)
        self.assertEqual(analysis.animation_cadence(events, 0.0, 1.0)["frames_per_s"], 0.0)

    def test_the_interval_between_frames_is_reported_in_milliseconds(self):
        events = self.paints([i / 100 for i in range(20)], step_ms=50)
        self.assertEqual(analysis.animation_cadence(events, 0.0, 1.0)["interval_ms"]["p50"], 50.0)


class CompressedInputTests(unittest.TestCase):
    def test_a_compressed_log_is_read_where_the_plain_one_is_expected(self):
        with tempfile.TemporaryDirectory() as directory:
            with gzip.open(Path(directory) / "trace.jsonl.gz", "wt", encoding="utf-8") as stream:
                stream.write(json.dumps({"ev": "tick", "t_ms": 1.0}) + "\n")
            records = analysis.load_jsonl(Path(directory) / "trace.jsonl")
        self.assertEqual(records, [{"ev": "tick", "t_ms": 1.0}])

    def test_a_missing_log_is_empty(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(analysis.load_jsonl(Path(directory) / "nothing.jsonl"), [])


class CpuTests(unittest.TestCase):
    def test_cpu_is_the_cores_used_between_the_two_hold_markers(self):
        markers = [
            {"name": "hold-start", "wall": 100.0, "cpu_ticks": 1000, "clk_tck": 100},
            {"name": "hold-end", "wall": 160.0, "cpu_ticks": 1600, "clk_tck": 100},
        ]
        self.assertAlmostEqual(analysis.cpu_cores(markers), 0.10, places=3)

    def test_there_is_no_cpu_figure_without_both_markers(self):
        self.assertIsNone(analysis.cpu_cores([
            {"name": "hold-start", "wall": 1.0, "cpu_ticks": 1, "clk_tck": 100}]))
        self.assertIsNone(analysis.cpu_cores([]))


class ScenarioScoringTests(unittest.TestCase):
    def run_named(self, name):
        with tempfile.TemporaryDirectory() as directory:
            run = Path(directory) / name
            run.mkdir()
            trace = [shown(0, agent="shell", context_pct=None, usage_pct=None, rows=[]),
                     shown(1, context_pct=16, usage_pct=22)]
            trace += [dict(e, unix_ms=e["t_ms"]) for e in ticks(0, 40, 100)]
            truth = [truth_record(0, event="start", working=False, context_pct=16, usage_pct=22)]
            write_run(run, trace=trace)
            with open(run / "truth.jsonl", "w", encoding="utf-8") as stream:
                for record in truth:
                    stream.write(json.dumps(record) + "\n")
            return analysis.analyze_run(run, skip_s=5.0, tail_s=2.0)["accuracy"]

    def test_the_waiting_scenario_is_scored_on_the_waiting_count_only(self):
        self.assertEqual(set(self.run_named("waiting")), {"waiting"})

    def test_a_focused_agent_scenario_is_scored_on_its_numbers_not_on_waiting(self):
        self.assertEqual(set(self.run_named("dash-codex")), {"context_pct", "usage_pct"})

    def test_the_accuracy_counts_quick_reversals_in_the_truth_and_in_the_display(self):
        truth = analysis.truth_steps([
            truth_record(0, event="start", working=False),
            truth_record(20, working=True),
            truth_record(23, working=False)], "waiting")
        states = [shown(0, waiting=1), shown(21, waiting=0), shown(22, waiting=1),
                  shown(24, waiting=0), shown(25, waiting=1)]
        score = analysis.accuracy(states, truth, "waiting", 10, 50)
        self.assertEqual(score["truth_reversals_5s"], 1)
        self.assertEqual(score["shown_reversals_5s"], 3)

    def test_a_real_agent_run_is_scored_on_context_and_usage(self):
        self.assertEqual(set(self.run_named("real-ssh-after-new-script")), {"context_pct", "usage_pct"})

    def test_a_real_local_claude_run_is_scored_on_context_only(self):
        self.assertEqual(set(self.run_named("real-local-claude-after")), {"context_pct"})

    def test_a_real_local_codex_run_is_scored_on_context_and_usage(self):
        self.assertEqual(set(self.run_named("real-local-codex-before")), {"context_pct", "usage_pct"})

    def test_the_accuracy_reports_how_often_the_truth_and_the_display_changed(self):
        truth = analysis.truth_steps([
            truth_record(0, event="start", working=False),
            truth_record(20, working=True),
            truth_record(40, working=False)], "waiting")
        states = [shown(0, waiting=1), shown(21, waiting=0), shown(25, waiting=1),
                  shown(26, waiting=0), shown(41, waiting=1)]
        score = analysis.accuracy(states, truth, "waiting", 10, 50)
        self.assertEqual(score["truth_changes"], 2)
        self.assertEqual(score["shown_changes"], 4)


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
