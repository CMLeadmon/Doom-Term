import pathlib
import re
import tempfile
import unittest
import zipfile

import package_theme as packager


class PackageThemeTest(unittest.TestCase):
    def build(self, pack: str, directory: pathlib.Path, name: str = "pack.zip") -> pathlib.Path:
        out = directory / name
        packager.build(pack, out)
        return out

    def test_the_archive_holds_one_top_level_folder_with_exactly_the_pack_files(self):
        for pack in packager.PACKS:
            with self.subTest(pack=pack), tempfile.TemporaryDirectory() as tmp:
                with zipfile.ZipFile(self.build(pack, pathlib.Path(tmp))) as archive:
                    self.assertEqual(
                        archive.namelist(),
                        [f"{pack}/{pack}.yaml", f"{pack}/{pack}.gif", f"{pack}/README.txt"],
                    )

    def test_two_builds_are_byte_identical(self):
        for pack in packager.PACKS:
            with self.subTest(pack=pack), tempfile.TemporaryDirectory() as tmp:
                first = packager.build(pack, pathlib.Path(tmp) / "a.zip")
                second = packager.build(pack, pathlib.Path(tmp) / "b.zip")
                self.assertEqual(first, second)

    def test_the_yaml_image_path_points_inside_the_archive(self):
        for pack in packager.PACKS:
            with self.subTest(pack=pack), tempfile.TemporaryDirectory() as tmp:
                with zipfile.ZipFile(self.build(pack, pathlib.Path(tmp))) as archive:
                    yaml = archive.read(f"{pack}/{pack}.yaml").decode()
                    path = re.search(r"^\s+path:\s*(\S+)\s*$", yaml, re.MULTILINE).group(1)
                    self.assertIn(path, archive.namelist())

    SIZES = {
        "redsky": (480, 300),
        "bluehighway": (480, 300),
        "canopy": (480, 300),
        "replay": (320, 240),
        "bfr": (320, 240),
    }

    def test_every_pack_is_a_real_gif_the_size_the_design_fixes(self):
        self.assertEqual(set(self.SIZES), set(packager.PACKS))
        for pack in packager.PACKS:
            with self.subTest(pack=pack):
                data = (packager.THEMES_DIR / pack / f"{pack}.gif").read_bytes()
                self.assertEqual(data[:6], b"GIF89a")
                width, height = int.from_bytes(data[6:8], "little"), int.from_bytes(data[8:10], "little")
                self.assertEqual((width, height), self.SIZES[pack])
                self.assertEqual(data[-1], 0x3B)

    def test_a_missing_pack_file_fails_instead_of_shipping_a_partial_archive(self):
        with tempfile.TemporaryDirectory() as tmp:
            empty = pathlib.Path(tmp) / "empty"
            empty.mkdir()
            out = pathlib.Path(tmp) / "pack.zip"
            with self.assertRaises(FileNotFoundError):
                packager.build("redsky", out, pack_dir=empty)
            self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
