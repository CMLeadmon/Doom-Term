import unittest

import evidence_charts as charts


class NiceTicksTests(unittest.TestCase):
    def test_ticks_are_round_numbers_inside_the_range(self):
        self.assertEqual(charts.nice_ticks(0, 100, 5), [0, 20, 40, 60, 80, 100])

    def test_a_short_range_uses_a_fine_step(self):
        self.assertEqual(charts.nice_ticks(0, 3, 3), [0, 1, 2, 3])

    def test_a_long_time_axis_uses_a_step_of_twenty_or_so(self):
        ticks = charts.nice_ticks(0, 130, 6)
        self.assertEqual(ticks[:3], [0, 20, 40])
        self.assertLessEqual(ticks[-1], 130)

    def test_a_range_that_does_not_start_at_zero_keeps_its_ticks_inside_it(self):
        ticks = charts.nice_ticks(11.4, 140.3, 6)
        self.assertGreaterEqual(ticks[0], 11.4)
        self.assertLessEqual(ticks[-1], 140.3)


class StepPathTests(unittest.TestCase):
    def plot(self):
        return charts.Plot(100, 50, (0, 10), (0, 10), left=0, right=0, top=0, bottom=0)

    def test_a_step_function_moves_horizontally_then_vertically(self):
        path = charts.step_segments(self.plot(), [(0, 5), (4, 10)], 10)
        self.assertEqual(path, "M0.0 25.0H40.0V0.0H100.0")

    def test_a_missing_value_leaves_a_gap_instead_of_a_line(self):
        path = charts.step_segments(self.plot(), [(0, 5), (4, None), (6, 5)], 10)
        self.assertEqual(path, "M0.0 25.0H40.0M60.0 25.0H100.0")

    def test_a_function_that_never_has_a_value_draws_nothing(self):
        self.assertEqual(charts.step_segments(self.plot(), [(0, None)], 10), "")


class GapSpanTests(unittest.TestCase):
    def test_gaps_are_the_periods_with_no_value(self):
        spans = charts.gap_spans([(0, 5), (4, None), (6, 5), (8, None)], 10, 0)
        self.assertEqual(spans, [(4, 6), (8, 10)])

    def test_gaps_are_clipped_to_the_window(self):
        spans = charts.gap_spans([(0, None), (5, 1)], 10, 2)
        self.assertEqual(spans, [(2, 5)])


class ScaleTests(unittest.TestCase):
    def test_y_grows_upwards_and_x_to_the_right(self):
        plot = charts.Plot(200, 100, (0, 10), (0, 100), left=20, right=20, top=10, bottom=10)
        self.assertEqual(plot.x(0), 20)
        self.assertEqual(plot.x(10), 180)
        self.assertEqual(plot.y(0), 90)
        self.assertEqual(plot.y(100), 10)


if __name__ == "__main__":
    unittest.main()
