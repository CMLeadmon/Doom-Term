import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("build_policy", Path(__file__).with_name("check-build-policy.py"))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class BuildPolicyTests(unittest.TestCase):
    def test_remote_asset_feature_is_rejected_without_prohibited_package(self):
        self.assertEqual(
            policy.prohibited_features({"asset_cache": {"remote-fetch"}}),
            ["asset_cache/remote-fetch"],
        )

    def test_local_assets_are_allowed(self):
        self.assertEqual(policy.prohibited_features({"asset_cache": set()}), [])

    def test_empty_graph_cannot_pass_policy(self):
        with self.assertRaises(ValueError):
            policy.parse_tree("")

    def test_unrecognized_graph_cannot_pass_policy(self):
        with self.assertRaises(ValueError):
            policy.parse_tree("warp v0.1.0\n")

    def test_graph_parser_preserves_features_and_paths_with_spaces(self):
        self.assertEqual(
            policy.parse_tree("asset_cache v0.0.0 (/repo/Doom Term)|remote-fetch|\n"
                              "asset_cache v0.0.0 (/repo/Doom Term)|remote-fetch| (*)\n"
                              "warp v0.1.0 (/repo/Doom Term/app)|doomterm,gui|\n"),
            {"asset_cache": {"remote-fetch"}, "warp": {"doomterm", "gui"}},
        )


if __name__ == "__main__":
    unittest.main()
