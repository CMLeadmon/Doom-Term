import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

import channel_manifests as channels

HERE = pathlib.Path(__file__).resolve().parent
SUMS = (HERE / "fixtures" / "SHA256SUMS.v1.1.8.txt").read_text()
WINDOWS_SHA = "860ea9e0b9adfafd1b775edd4c5be906f8edd87bfe53b35257d2a15497e14524"
MACOS_SHA = "4cd3ee9a34c133eeb6332281686d1ea16a5cada27de49885c33a8f1f5be19bcb"


class ChecksumTest(unittest.TestCase):
    def test_reads_the_published_checksum_file(self):
        sums = channels.parse_sha256sums(SUMS)
        self.assertEqual(sums["doomterm-windows-x64.zip"], WINDOWS_SHA)
        self.assertEqual(sums["doomterm-macos-arm64.zip"], MACOS_SHA)

    def test_skips_comments_and_blank_lines_and_accepts_binary_mode_markers(self):
        text = f"# header\n\n{WINDOWS_SHA.upper()} *a.zip\n{MACOS_SHA}  b.zip\n"
        self.assertEqual(channels.parse_sha256sums(text), {"a.zip": WINDOWS_SHA, "b.zip": MACOS_SHA})

    def test_rejects_a_line_that_is_not_a_sha256_digest(self):
        with self.assertRaises(ValueError):
            channels.parse_sha256sums("abc123  a.zip\n")

    def test_a_missing_asset_is_an_error_not_an_empty_hash(self):
        with self.assertRaises(ValueError):
            channels.asset_hash({"other.zip": WINDOWS_SHA}, "doomterm-windows-x64.zip")


class VersionTest(unittest.TestCase):
    def test_strips_the_v_from_a_release_tag(self):
        self.assertEqual(channels.normalize_version("v1.1.8"), "1.1.8")

    def test_accepts_the_four_part_tags_the_project_has_shipped(self):
        self.assertEqual(channels.normalize_version("v1.1.2.1"), "1.1.2.1")

    def test_rejects_prerelease_and_non_release_names(self):
        for tag in (
            "v1.2.0-rc1", "latest", "main", "v1.2", "V1.1.8", "",
            "1.1.8", "1.1.2.1", "v١.١.٨", "v1.1.8\n", "v1.1.2.1\n",
        ):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                channels.normalize_version(tag)

    def test_orders_versions_numerically_not_alphabetically(self):
        order = ["1.0.3", "1.1.0", "1.1.2", "1.1.2.1", "1.1.8", "1.1.10"]
        self.assertEqual(sorted(order, key=channels.version_key), order)

    def test_a_missing_fourth_part_equals_zero(self):
        self.assertEqual(channels.version_key("1.1.2"), channels.version_key("1.1.2.0"))


class ScoopManifestTest(unittest.TestCase):
    def test_points_at_the_tagged_windows_zip_with_its_hash(self):
        manifest = json.loads(channels.scoop_manifest("1.1.8", WINDOWS_SHA))
        self.assertEqual(manifest["version"], "1.1.8")
        self.assertEqual(
            manifest["architecture"]["64bit"],
            {
                "url": "https://github.com/CMLeadmon/Doom-Term/releases/download/v1.1.8/doomterm-windows-x64.zip",
                "hash": WINDOWS_SHA,
            },
        )

    def test_installs_the_executable_the_zip_holds_at_its_root(self):
        manifest = json.loads(channels.scoop_manifest("1.1.8", WINDOWS_SHA))
        self.assertEqual(manifest["bin"], "doomterm.exe")
        self.assertEqual(manifest["shortcuts"], [["doomterm.exe", "Doom Term"]])

    def test_ends_with_a_newline(self):
        self.assertTrue(channels.scoop_manifest("1.1.8", WINDOWS_SHA).endswith("}\n"))

    def test_refuses_a_hash_that_is_not_sha256(self):
        with self.assertRaises(ValueError):
            channels.scoop_manifest("1.1.8", "abc")

    def test_refuses_a_version_that_is_not_a_release_version(self):
        with self.assertRaises(ValueError):
            channels.scoop_manifest("1.2.0-rc1", WINDOWS_SHA)


class CaskTest(unittest.TestCase):
    def setUp(self):
        self.cask = channels.cask("1.1.8", MACOS_SHA)

    def test_pins_version_and_hash(self):
        self.assertIn('version "1.1.8"', self.cask)
        self.assertIn(f'sha256 "{MACOS_SHA}"', self.cask)

    def test_downloads_the_tagged_apple_silicon_zip(self):
        self.assertIn(
            'url "https://github.com/CMLeadmon/Doom-Term/releases/download/v#{version}/doomterm-macos-arm64.zip"',
            self.cask,
        )
        self.assertIn("depends_on arch: :arm64", self.cask)

    def test_installs_the_app_from_the_osx_folder_the_zip_holds(self):
        self.assertIn('app "osx/DoomTerm.app"', self.cask)

    def test_leaves_no_template_placeholder_behind(self):
        self.assertNotIn("$", self.cask)

    def test_refuses_a_hash_that_is_not_sha256(self):
        with self.assertRaises(ValueError):
            channels.cask("1.1.8", "")


class ManifestValidationTest(unittest.TestCase):
    def test_renderers_reject_non_ascii_and_trailing_newline_versions(self):
        for render in (channels.scoop_manifest, channels.cask):
            for version in ("١.١.٨", "1.1.8\n", "1.1.2.1\n", "v1.1.8", "1.2"):
                with self.subTest(render=render.__name__, version=version):
                    with self.assertRaises(ValueError):
                        render(version, WINDOWS_SHA)

    def test_renderers_reject_digests_with_trailing_newlines(self):
        for render in (channels.scoop_manifest, channels.cask):
            with self.subTest(render=render.__name__), self.assertRaises(ValueError):
                render("1.1.8", WINDOWS_SHA + "\n")

    def test_renderers_accept_plain_three_and_four_part_version_strings(self):
        for version in ("1.1.8", "1.1.2.1"):
            with self.subTest(version=version):
                manifest = json.loads(channels.scoop_manifest(version, WINDOWS_SHA))
                self.assertEqual(manifest["version"], version)
                self.assertIn(f'version "{version}"', channels.cask(version, MACOS_SHA))


class RenderChannelsTest(unittest.TestCase):
    def test_writes_both_manifests_for_the_published_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            written = channels.render_channels("v1.1.8", SUMS, pathlib.Path(tmp))
            names = sorted(path.relative_to(tmp).as_posix() for path in written)
            self.assertEqual(
                names, ["homebrew-doomterm/Casks/doomterm.rb", "scoop-doomterm/bucket/doomterm.json"]
            )
            scoop = json.loads((pathlib.Path(tmp) / "scoop-doomterm/bucket/doomterm.json").read_text())
            self.assertEqual(scoop["architecture"]["64bit"]["hash"], WINDOWS_SHA)

    def test_writes_nothing_when_an_asset_has_no_checksum(self):
        without_macos = "\n".join(line for line in SUMS.splitlines() if "macos" not in line)
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                channels.render_channels("v1.1.8", without_macos, pathlib.Path(tmp))
            self.assertEqual(list(pathlib.Path(tmp).iterdir()), [])

    def test_refuses_a_prerelease_tag(self):
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(ValueError):
            channels.render_channels("v1.2.0-rc1", SUMS, pathlib.Path(tmp))

    def test_invalid_release_tags_leave_no_output(self):
        for tag in ("1.1.8", "v١.١.٨", "v1.1.8\n"):
            with self.subTest(tag=tag), tempfile.TemporaryDirectory() as tmp:
                out = pathlib.Path(tmp) / "out"
                with self.assertRaises(ValueError):
                    channels.render_channels(tag, SUMS, out)
                self.assertFalse(out.exists())

    def test_invalid_asset_digests_leave_no_output(self):
        for digest in ("bad-digest", "١" * 64, WINDOWS_SHA + "x"):
            with self.subTest(digest=digest), tempfile.TemporaryDirectory() as tmp:
                out = pathlib.Path(tmp) / "out"
                with self.assertRaises(ValueError):
                    channels.render_channels("v1.1.8", SUMS.replace(MACOS_SHA, digest), out)
                self.assertFalse(out.exists())


class DecideTest(unittest.TestCase):
    def test_a_channel_with_no_manifest_takes_the_release(self):
        self.assertEqual(channels.decide(None, "1.1.8"), "update")

    def test_a_newer_release_updates(self):
        self.assertEqual(channels.decide("1.1.7", "1.1.8"), "update")
        self.assertEqual(channels.decide("1.1.2", "1.1.2.1"), "update")

    def test_the_same_release_is_a_no_op(self):
        self.assertEqual(channels.decide("1.1.8", "1.1.8"), "same")

    def test_an_older_release_never_moves_the_channel_backwards(self):
        self.assertEqual(channels.decide("1.1.8", "1.1.7"), "older")
        self.assertEqual(channels.decide("1.1.10", "1.1.9"), "older")

    def test_a_channel_version_it_cannot_read_is_an_error(self):
        with self.assertRaises(ValueError):
            channels.decide("garbage", "1.1.8")

    def test_invalid_candidates_are_rejected_before_a_promotion_verdict(self):
        for current in (None, "1.1.8"):
            for candidate in (
                "bad-version", "1.2", "1.1.2.1.0", "v1.1.8", "١.١.٨", "1.1.8\n",
            ):
                with self.subTest(current=current, candidate=candidate):
                    with self.assertRaises(ValueError):
                        channels.decide(current, candidate)


class ManifestVersionTest(unittest.TestCase):
    def test_reads_the_version_back_from_what_it_renders(self):
        self.assertEqual(
            channels.read_scoop_version(channels.scoop_manifest("1.1.8", WINDOWS_SHA)), "1.1.8"
        )
        self.assertEqual(channels.read_cask_version(channels.cask("1.1.8", MACOS_SHA)), "1.1.8")

    def test_unreadable_manifests_have_no_version(self):
        self.assertIsNone(channels.read_scoop_version("not json"))
        self.assertIsNone(channels.read_scoop_version("[]"))
        self.assertIsNone(channels.read_cask_version('cask "x" do\nend\n'))


class AssetCheckTest(unittest.TestCase):
    BASE = ["SHA256SUMS.txt", "doomterm-windows-x64.zip", "doomterm-macos-arm64.zip"]

    def test_a_release_without_the_appimage_passes_only_when_it_is_not_required(self):
        self.assertEqual(channels.missing_assets(self.BASE, require_appimage=False), [])
        self.assertEqual(
            channels.missing_assets(self.BASE, require_appimage=True),
            ["DoomTerm-x86_64.AppImage", "DoomTerm-x86_64.AppImage.zsync"],
        )

    def test_a_release_with_the_appimage_but_no_zsync_file_is_incomplete(self):
        names = [*self.BASE, "DoomTerm-x86_64.AppImage"]
        self.assertEqual(
            channels.missing_assets(names, require_appimage=True), ["DoomTerm-x86_64.AppImage.zsync"]
        )

    def test_names_every_missing_asset(self):
        self.assertEqual(channels.missing_assets([], require_appimage=False), self.BASE)


class UpdateInformationTest(unittest.TestCase):
    def test_points_the_appimage_at_the_latest_release_zsync_file(self):
        self.assertEqual(
            channels.APPIMAGE_UPDATE_INFORMATION,
            "gh-releases-zsync|CMLeadmon|Doom-Term|latest|DoomTerm-x86_64.AppImage.zsync",
        )


class CommandLineTest(unittest.TestCase):
    def run_cli(self, *args, stdin=""):
        return subprocess.run(
            [sys.executable, str(HERE / "channel_manifests.py"), *args],
            input=stdin,
            capture_output=True,
            text=True,
        )

    def test_version_prints_the_version(self):
        result = self.run_cli("version", "--tag", "v1.1.8")
        self.assertEqual((result.returncode, result.stdout), (0, "1.1.8\n"))

    def test_version_exits_2_for_a_tag_that_is_not_a_release(self):
        self.assertEqual(self.run_cli("version", "--tag", "v1.2.0-rc1").returncode, 2)

    def test_render_writes_the_manifests(self):
        with tempfile.TemporaryDirectory() as tmp:
            sums = pathlib.Path(tmp) / "SHA256SUMS.txt"
            sums.write_text(SUMS)
            out = pathlib.Path(tmp) / "out"
            result = self.run_cli("render", "--tag", "v1.1.8", "--sums", str(sums), "--out", str(out))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((out / "scoop-doomterm/bucket/doomterm.json").is_file())
            self.assertTrue((out / "homebrew-doomterm/Casks/doomterm.rb").is_file())

    def test_render_failures_exit_2_without_output(self):
        without_macos = "\n".join(line for line in SUMS.splitlines() if "macos" not in line)
        cases = [(tag, SUMS) for tag in ("1.1.8", "v١.١.٨", "v1.1.8\n")]
        cases += [("v1.1.8", without_macos), ("v1.1.8", SUMS.replace(MACOS_SHA, "bad-digest"))]
        for case, (tag, sums_text) in enumerate(cases):
            with self.subTest(case=case, tag=tag), tempfile.TemporaryDirectory() as tmp:
                sums = pathlib.Path(tmp) / "SHA256SUMS.txt"
                sums.write_text(sums_text)
                out = pathlib.Path(tmp) / "out"
                result = self.run_cli("render", "--tag", tag, "--sums", str(sums), "--out", str(out))
                self.assertEqual((result.returncode, result.stdout), (2, ""))
                self.assertIn("error:", result.stderr)
                self.assertFalse(out.exists())

    def test_decide_says_update_when_the_channel_has_no_manifest_yet(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = pathlib.Path(tmp) / "none.json"
            result = self.run_cli(
                "decide", "--kind", "scoop", "--manifest", str(missing), "--version", "1.1.8"
            )
            self.assertEqual((result.returncode, result.stdout), (0, "update\n"))

    def test_decide_says_older_when_the_channel_is_already_ahead(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = pathlib.Path(tmp) / "doomterm.json"
            manifest.write_text(channels.scoop_manifest("1.1.9", WINDOWS_SHA))
            result = self.run_cli(
                "decide", "--kind", "scoop", "--manifest", str(manifest), "--version", "1.1.8"
            )
            self.assertEqual((result.returncode, result.stdout), (0, "older\n"))

    def test_decide_says_same_for_an_unchanged_scoop_or_cask(self):
        for kind, render in (("scoop", channels.scoop_manifest), ("cask", channels.cask)):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                manifest = pathlib.Path(tmp) / "manifest"
                manifest.write_text(render("1.1.8", WINDOWS_SHA))
                result = self.run_cli(
                    "decide", "--kind", kind, "--manifest", str(manifest), "--version", "1.1.8"
                )
                self.assertEqual((result.returncode, result.stdout), (0, "same\n"), result.stderr)

    def test_decide_cask_preserves_update_and_downgrade_verdicts(self):
        for current, expected in (("1.1.7", "update\n"), ("1.1.9", "older\n")):
            with self.subTest(current=current), tempfile.TemporaryDirectory() as tmp:
                manifest = pathlib.Path(tmp) / "doomterm.rb"
                manifest.write_text(channels.cask(current, MACOS_SHA))
                result = self.run_cli(
                    "decide", "--kind", "cask", "--manifest", str(manifest), "--version", "1.1.8"
                )
                self.assertEqual((result.returncode, result.stdout), (0, expected), result.stderr)

    def test_decide_fails_on_a_manifest_it_cannot_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = pathlib.Path(tmp) / "doomterm.json"
            manifest.write_text("not json")
            result = self.run_cli(
                "decide", "--kind", "scoop", "--manifest", str(manifest), "--version", "1.1.8"
            )
            self.assertEqual(result.returncode, 2)

    def test_check_assets_lists_what_is_missing_and_fails(self):
        result = self.run_cli(
            "check-assets", "--require-appimage", stdin="SHA256SUMS.txt\ndoomterm-windows-x64.zip\n"
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(
            result.stdout.split(),
            ["doomterm-macos-arm64.zip", "DoomTerm-x86_64.AppImage", "DoomTerm-x86_64.AppImage.zsync"],
        )

    def test_check_assets_is_silent_when_nothing_is_missing(self):
        result = self.run_cli("check-assets", stdin="SHA256SUMS.txt doomterm-windows-x64.zip doomterm-macos-arm64.zip")
        self.assertEqual((result.returncode, result.stdout), (0, ""))

    def test_appimage_update_info_prints_the_embedded_address(self):
        result = self.run_cli("appimage-update-info")
        self.assertEqual(
            (result.returncode, result.stdout),
            (0, "gh-releases-zsync|CMLeadmon|Doom-Term|latest|DoomTerm-x86_64.AppImage.zsync\n"),
        )

    def test_previous_appimage_selects_highest_strictly_older_complete_release(self):
        pair = [{"name": "DoomTerm-x86_64.AppImage"}, {"name": "DoomTerm-x86_64.AppImage.zsync"}]
        releases = [
            {"tag_name": "v1.2.0", "assets": pair},
            {"tag_name": "v1.1.9", "assets": pair},
            {"tag_name": "v1.1.2.1", "assets": pair},
            {"tag_name": "v1.1.8", "assets": pair},
            {"tag_name": "v1.1.8.1", "assets": pair[:1]},
            {"tag_name": "v1.1.8.2", "assets": pair[1:]},
            {"tag_name": "latest", "assets": pair},
            {"tag_name": "v1.1.8.3-rc1", "assets": pair},
            {"tag_name": "v1.1.8.4", "assets": pair, "draft": True},
            {"tag_name": "v1.1.8.5", "assets": pair, "prerelease": True},
        ]
        for order in (releases, list(reversed(releases))):
            with self.subTest(order=order):
                result = self.run_cli("previous-appimage", "--tag", "v1.1.9", stdin=json.dumps(order))
                self.assertEqual((result.returncode, result.stdout), (0, "v1.1.8\n"), result.stderr)

    def test_previous_appimage_orders_four_part_versions_numerically(self):
        pair = [{"name": "DoomTerm-x86_64.AppImage"}, {"name": "DoomTerm-x86_64.AppImage.zsync"}]
        releases = [{"tag_name": tag, "assets": pair} for tag in
                    ("v1.1.9", "v1.1.10", "v1.1.10.1", "v1.1.11", "v1.1.11.0")]
        result = self.run_cli("previous-appimage", "--tag", "v1.1.11", stdin=json.dumps(releases))
        self.assertEqual((result.returncode, result.stdout), (0, "v1.1.10.1\n"), result.stderr)

    def test_previous_appimage_is_silent_when_no_older_pair_exists(self):
        result = self.run_cli("previous-appimage", "--tag", "v1.1.8", stdin="[]")
        self.assertEqual((result.returncode, result.stdout), (0, ""), result.stderr)

    def test_previous_appimage_rejects_an_invalid_target(self):
        result = self.run_cli("previous-appimage", "--tag", "latest", stdin="[]")
        self.assertEqual(result.returncode, 2)
        self.assertIn("not a release tag", result.stderr)


if __name__ == "__main__":
    unittest.main()
