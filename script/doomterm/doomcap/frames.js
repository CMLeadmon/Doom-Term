'use strict';
/* Reads the frame stream the capture shim writes: records of a 16-byte header (the magic 0x4d415246,
   the frame number, the width and the height, little-endian) followed by width * height pixels in
   blue, green, red, alpha byte order. Pixels come back as 0xRRGGBB. */
const MAGIC = 0x4d415246;

function* frames(buf) {
  let at = 0;
  while (at < buf.length) {
    if (at + 16 > buf.length) throw new Error('the frame stream ends inside a header');
    if (buf.readUInt32LE(at) !== MAGIC) throw new Error(`no frame record at byte ${at}`);
    const index = buf.readUInt32LE(at + 4), width = buf.readUInt32LE(at + 8), height = buf.readUInt32LE(at + 12);
    const size = width * height * 4;
    if (at + 16 + size > buf.length) throw new Error(`frame ${index} is cut short`);
    const pixels = new Uint32Array(width * height);
    for (let i = 0, o = at + 16; i < pixels.length; i++, o += 4) pixels[i] = (buf[o + 2] << 16) | (buf[o + 1] << 8) | buf[o];
    yield { index, width, height, pixels };
    at += 16 + size;
  }
}

/* The inverse, used by the tests */
function record(index, width, height, pixels) {
  const out = Buffer.alloc(16 + width * height * 4);
  out.writeUInt32LE(MAGIC, 0); out.writeUInt32LE(index, 4); out.writeUInt32LE(width, 8); out.writeUInt32LE(height, 12);
  for (let i = 0, o = 16; i < pixels.length; i++, o += 4) {
    out[o] = pixels[i] & 255; out[o + 1] = (pixels[i] >> 8) & 255; out[o + 2] = (pixels[i] >> 16) & 255; out[o + 3] = 255;
  }
  return out;
}

module.exports = { frames, record };
