import hashlib
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest


HERE = pathlib.Path(__file__).resolve().parent
APPIMAGE = "DoomTerm-x86_64.AppImage"
ZSYNC = APPIMAGE + ".zsync"
UPDATE_INFO = "gh-releases-zsync|CMLeadmon|Doom-Term|latest|DoomTerm-x86_64.AppImage.zsync"


class AppImageVerifierTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.image = self.root / APPIMAGE
        self.zsync = self.root / ZSYNC
        self.sums = self.root / "SHA256SUMS.txt"
        self.executed = self.root / "executed"
        self.image.write_text('#!/bin/sh\ntouch "$(dirname "$0")/executed"\necho "Doom Term 1.1.8"\n')
        self.image.chmod(0o755)
        self.header = {
            "zsync": "0.6.2",
            "Filename": APPIMAGE,
            "MTime": "Mon, 05 Oct 2026 12:00:00 +0000",
            "Blocksize": "4096",
            "Length": str(self.image.stat().st_size),
            "Hash-Lengths": "2,2,4",
            "URL": APPIMAGE,
            "SHA-1": hashlib.sha1(self.image.read_bytes()).hexdigest(),
        }
        self.write_header()
        self.write_sums()
        self.readelf_output = self.root / "readelf-output"
        self.readelf_output.write_text(f"\nString dump of section '.upd_info':\n  [     0]  {UPDATE_INFO}\n\n")
        readelf = self.root / "readelf"
        readelf.write_text('#!/bin/sh\ncat "$(dirname "$0")/readelf-output"\n')
        readelf.chmod(0o755)

    def write_header(self):
        header = "\n".join(f"{key}: {value}" for key, value in self.header.items())
        self.zsync.write_bytes(header.encode("ascii") + b"\n\n\x80\xff\x00binary block checksums")

    def write_sums(self, names=(APPIMAGE, ZSYNC)):
        self.sums.write_text("".join(
            f"{hashlib.sha256((self.root / name).read_bytes()).hexdigest()}  {name}\n"
            for name in names
        ))

    def run_cli(self, *, sums=True, version="1.1.8"):
        args = [sys.executable, str(HERE / "verify_appimage.py"), "--dir", str(self.root)]
        if sums:
            args += ["--sums", str(self.sums)]
        if version is not None:
            args += ["--version", version]
        return subprocess.run(args, capture_output=True, text=True, timeout=10,
                              env={**os.environ, "PATH": str(self.root) + os.pathsep + os.environ["PATH"]})

    def assert_rejected_before_execution(self, result, message):
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn(message, result.stderr)
        self.assertFalse(self.executed.exists(), "invalid assets executed before authentication")

    def test_published_pair_with_matching_checksums_and_version_runs(self):
        result = self.run_cli()
        self.assertEqual((result.returncode, result.stdout), (0, "Doom Term 1.1.8\n"), result.stderr)
        self.assertTrue(self.executed.exists())

    def test_missing_appimage_checksum_prevents_execution(self):
        self.write_sums((ZSYNC,))
        self.assert_rejected_before_execution(self.run_cli(), f"has no entry for {APPIMAGE}")

    def test_missing_zsync_checksum_prevents_execution(self):
        self.write_sums((APPIMAGE,))
        self.assert_rejected_before_execution(self.run_cli(), f"has no entry for {ZSYNC}")

    def test_path_alias_does_not_count_as_exact_checksum_entry(self):
        self.sums.write_text(self.sums.read_text().replace(f"  {APPIMAGE}\n", f"  ./{APPIMAGE}\n"))
        self.assert_rejected_before_execution(self.run_cli(), f"has no entry for {APPIMAGE}")

    def test_duplicate_checksum_entries_are_rejected(self):
        self.sums.write_text(self.sums.read_text() + self.sums.read_text().splitlines()[0] + "\n")
        self.assert_rejected_before_execution(self.run_cli(), "duplicate checksum")

    def test_corrupt_appimage_prevents_execution(self):
        self.image.write_bytes(self.image.read_bytes() + b"corruption")
        self.assert_rejected_before_execution(self.run_cli(), f"SHA256 mismatch for {APPIMAGE}")

    def test_corrupt_zsync_prevents_execution(self):
        self.zsync.write_bytes(self.zsync.read_bytes() + b"corruption")
        self.assert_rejected_before_execution(self.run_cli(), f"SHA256 mismatch for {ZSYNC}")

    def test_wrong_embedded_update_address_prevents_execution(self):
        self.readelf_output.write_text("  [     0]  zsync|https://example.com/wrong\n")
        self.assert_rejected_before_execution(self.run_cli(), "update information mismatch")

    def test_wrong_zsync_metadata_prevents_execution_even_with_matching_sha256(self):
        for field, wrong in (("Filename", "other.AppImage"), ("URL", "https://example.com/wrong"),
                             ("Length", "1"), ("SHA-1", "0" * 40)):
            with self.subTest(field=field):
                original = self.header[field]
                self.header[field] = wrong
                self.write_header()
                self.write_sums()
                self.assert_rejected_before_execution(self.run_cli(), f"zsync {field} mismatch")
                self.header[field] = original

    def test_duplicate_zsync_fields_prevent_execution(self):
        self.zsync.write_bytes(self.zsync.read_bytes().replace(b"\n\n", b"\nLength: 1\n\n", 1))
        self.write_sums()
        self.assert_rejected_before_execution(self.run_cli(), "duplicate zsync field")

    def test_unterminated_zsync_header_prevents_execution(self):
        self.zsync.write_bytes(self.zsync.read_bytes().split(b"\n\n")[0])
        self.write_sums()
        self.assert_rejected_before_execution(self.run_cli(), "unterminated zsync header")

    def test_published_binary_version_must_match(self):
        result = self.run_cli(version="9.9.9")
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("version mismatch", result.stderr)
        self.assertTrue(self.executed.exists())

    def test_branch_build_allows_unknown_version_without_release_checksums(self):
        self.image.write_text(self.image.read_text().replace("1.1.8", "unknown"))
        self.header["Length"] = str(self.image.stat().st_size)
        self.header["SHA-1"] = hashlib.sha1(self.image.read_bytes()).hexdigest()
        self.write_header()
        result = self.run_cli(sums=False, version=None)
        self.assertEqual((result.returncode, result.stdout), (0, "Doom Term unknown\n"), result.stderr)

    def test_tag_build_still_requires_exact_version_without_release_checksums(self):
        result = self.run_cli(sums=False, version="1.1.9")
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("version mismatch", result.stderr)


if __name__ == "__main__":
    unittest.main()
