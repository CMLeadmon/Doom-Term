import hashlib
import struct
import subprocess
import sys
import unittest
import zlib
from pathlib import Path

import generate_icons as icons

# SHA-256 of the 32x32 RGBA master of candidate A ("Plate tile") as approved from the proposals.
APPROVED_MASTER32_SHA256 = "f9d26033db881d1d9a006a2f866ecba1b78e8aa07145e0a91e7f7d5143cc9ac3"


def decode_png(data):
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos, idat, size = 8, b"", None
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color = struct.unpack(">IIBB", body[:10])
            assert (depth, color) == (8, 6), "icons are 8-bit RGBA"
            size = (width, height)
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length
    raw = zlib.decompress(idat)
    width, height = size
    stride = width * 4
    rows = []
    for y in range(height):
        line = raw[y * (stride + 1):(y + 1) * (stride + 1)]
        assert line[0] == 0, "generator writes unfiltered rows"
        rows.append(line[1:])
    return width, [
        [tuple(row[x * 4:x * 4 + 4]) for x in range(width)] for row in rows
    ]


class GeneratedIconTests(unittest.TestCase):
    def test_master_is_the_approved_plate_tile(self):
        digest = hashlib.sha256(icons.master32().rgba()).hexdigest()
        self.assertEqual(digest, APPROVED_MASTER32_SHA256)

    def test_committed_icons_match_the_generator(self):
        result = subprocess.run([sys.executable, str(Path(icons.__file__)), "--check"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_every_size_is_a_whole_multiple_of_a_master_with_no_smoothing(self):
        masters = {16: icons.master16(), 32: icons.master32()}
        for size, (source, factor) in {**icons.PNG_SIZES, **icons.ICO_SIZES}.items():
            drawn, rgba = icons.scaled(masters[source], factor)
            self.assertEqual(drawn, size)
            width, rows = decode_png(icons.png(size, rgba))
            self.assertEqual(width, size)
            for y in range(size):
                for x in range(size):
                    self.assertEqual(rows[y][x], tuple(masters[source].pixels[(y // factor) * source + x // factor]))

    def test_pixels_are_opaque_or_fully_transparent_and_corners_are_cut(self):
        for master in (icons.master16(), icons.master32()):
            self.assertEqual({p[3] for p in master.pixels}, {0, 255})
            self.assertEqual(master.pixels[0][3], 0)
            self.assertEqual(master.pixels[-1][3], 0)
            centre = master.size // 2
            self.assertEqual(master.pixels[centre * master.size + centre][3], 255)

    def test_the_windows_icon_carries_every_size_a_shell_asks_for(self):
        data = (icons.ICON_DIR / "icon.ico").read_bytes()
        reserved, kind, count = struct.unpack("<HHH", data[:6])
        self.assertEqual((reserved, kind), (0, 1))
        sizes = []
        for i in range(count):
            width, height, _, _, _, bits, length, offset = struct.unpack(
                "<BBBBHHII", data[6 + 16 * i:22 + 16 * i])
            size = width or 256
            sizes.append(size)
            self.assertEqual(height or 256, size)
            self.assertEqual(bits, 32)
            decoded, _ = decode_png(data[offset:offset + length])
            self.assertEqual(decoded, size)
        self.assertEqual(sizes, [16, 32, 48, 64, 128, 256])

    def test_the_linux_hicolor_sizes_and_the_bundle_master_exist(self):
        for size in (16, 32, 64, 128, 256, 512):
            path = icons.ICON_DIR / f"{size}x{size}.png"
            self.assertEqual(decode_png(path.read_bytes())[0], size, path.name)


if __name__ == "__main__":
    unittest.main()
