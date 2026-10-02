import pathlib
import re
import tempfile
import unittest
import zipfile

import package_redsky_theme as packager


class PackageRedskyThemeTest(unittest.TestCase):
    def build(self, directory: pathlib.Path, name: str = "pack.zip") -> pathlib.Path:
        out = directory / name
        packager.build(out)
        return out

    def test_the_archive_holds_one_top_level_folder_with_exactly_the_pack_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            with zipfile.ZipFile(self.build(pathlib.Path(tmp))) as archive:
                self.assertEqual(
                    archive.namelist(),
                    ["redsky/redsky.yaml", "redsky/redsky.gif", "redsky/README.txt"],
                )

    def test_two_builds_are_byte_identical(self):
        with tempfile.TemporaryDirectory() as tmp:
            first = packager.build(pathlib.Path(tmp) / "a.zip")
            second = packager.build(pathlib.Path(tmp) / "b.zip")
            self.assertEqual(first, second)

    def test_the_yaml_image_path_points_inside_the_archive(self):
        with tempfile.TemporaryDirectory() as tmp:
            with zipfile.ZipFile(self.build(pathlib.Path(tmp))) as archive:
                yaml = archive.read("redsky/redsky.yaml").decode()
                path = re.search(r"^\s+path:\s*(\S+)\s*$", yaml, re.MULTILINE).group(1)
                self.assertIn(path, archive.namelist())

    def test_a_missing_pack_file_fails_instead_of_shipping_a_partial_archive(self):
        with tempfile.TemporaryDirectory() as tmp:
            empty = pathlib.Path(tmp) / "empty"
            empty.mkdir()
            out = pathlib.Path(tmp) / "pack.zip"
            with self.assertRaises(FileNotFoundError):
                packager.build(out, pack_dir=empty)
            self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
