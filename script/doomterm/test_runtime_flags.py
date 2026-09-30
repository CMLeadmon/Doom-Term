"""Pins the runtime feature allowlist, `DOOMTERM_FEATURES` in app/src/features.rs.

The app crate's own unit tests cannot be built with the Doom Term feature set, so the allowlist is
checked from its source. Each entry names the acceptance run that shows the capability works in a
Doom Term build.
"""

import re
import unittest
from pathlib import Path

FEATURES_RS = Path(__file__).resolve().parents[2] / "app" / "src" / "features.rs"

# flag -> what demonstrates it works in a Doom Term build
ACCEPTANCE = {
    "VerticalTabs": "the vertical tab layout is selectable in Settings > Appearance",
    "VerticalTabsSummaryMode": "the vertical tab panel's summary mode",
    "DragTabsToWindows": "script/doomterm/drag-smoke: a tab dragged out of the window opens a new one",
}


def allowlist(source):
    block = re.search(
        r"pub const DOOMTERM_FEATURES: &\[FeatureFlag\] = &\[(.*?)\];", source, re.S)
    assert block, "DOOMTERM_FEATURES not found"
    return re.findall(r"^\s*FeatureFlag::(\w+),", block.group(1), re.M)


class RuntimeFlagTests(unittest.TestCase):
    def test_allowlist_is_exactly_the_flags_with_an_acceptance_run(self):
        self.assertEqual(sorted(allowlist(FEATURES_RS.read_text())), sorted(ACCEPTANCE))

    def test_cross_window_tab_drag_is_enabled(self):
        self.assertIn("DragTabsToWindows", allowlist(FEATURES_RS.read_text()))

    def test_a_commented_out_entry_does_not_count(self):
        source = FEATURES_RS.read_text().replace(
            "    FeatureFlag::DragTabsToWindows,\n];", "    // FeatureFlag::DragTabsToWindows,\n];", 1)
        self.assertNotIn("DragTabsToWindows", allowlist(source))


if __name__ == "__main__":
    unittest.main()
