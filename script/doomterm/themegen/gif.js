/* Minimal GIF89a writer: one exact local colour table per frame and no quantiser, which is how the
   shipped baker works. A frame with more than 256 colours throws instead of degrading. */
const GifKit = (() => {
'use strict';

function lzw(indices, minBits) {
  const clear = 1 << minBits, eoi = clear + 1;
  const out = [];
  let acc = 0, nacc = 0;
  const emit = (code, size) => {
    acc |= code << nacc; nacc += size;
    while (nacc >= 8) { out.push(acc & 255); acc >>>= 8; nacc -= 8; }
  };
  let size = minBits + 1, next = eoi + 1;
  let dict = new Map();
  emit(clear, size);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = (prefix << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix, size);
    if (next < 4096) {
      dict.set(key, next++);
      if (next - 1 === (1 << size) && size < 12) size++;
    } else {
      emit(clear, size);
      dict = new Map(); size = minBits + 1; next = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix, size);
  emit(eoi, size);
  if (nacc > 0) out.push(acc & 255);
  return out;
}

/* frames: palette-index buffers; colors: [[r,g,b], ...]; delayCs: hundredths of a second, one number for every
   frame or an array with one entry per frame */
function encode(frames, colors, w, h, delayCs, delta) {
  const bytes = [];
  const push = (...b) => b.forEach((v) => bytes.push(v & 255));
  const word = (v) => push(v, v >> 8);
  push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
  word(w); word(h); push(0, 0, 0);
  push(0x21, 0xff, 0x0b, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);
  let maxUsed = 0;
  for (let fi = 0; fi < frames.length; fi++) {
    const f = frames[fi], prev = delta && fi > 0 ? frames[fi - 1] : null;
    const seen = new Int16Array(colors.length).fill(-1);
    const used = [];
    const remap = new Uint8Array(f.length);
    for (let i = 0; i < f.length; i++) {
      if (prev && prev[i] === f[i]) { remap[i] = 255; continue; }
      const v = f[i];
      if (seen[v] < 0) { seen[v] = used.length; used.push(v); }
      remap[i] = seen[v];
    }
    const transparent = prev ? used.length : -1;
    if (prev) for (let i = 0; i < f.length; i++) if (remap[i] === 255) remap[i] = transparent;
    const total = used.length + (prev ? 1 : 0);
    if (total > 256) throw new Error(`frame uses ${total} colours`);
    maxUsed = Math.max(maxUsed, total);
    const bits = Math.max(2, Math.ceil(Math.log2(Math.max(2, total))));
    push(0x21, 0xf9, 4, prev ? 0x05 : 0x04, 0, 0, transparent >= 0 ? transparent : 0, 0);
    bytes[bytes.length - 5 + 0] = bytes[bytes.length - 5];
    const delay = Array.isArray(delayCs) ? delayCs[fi] : delayCs;
    bytes[bytes.length - 4] = delay & 255; bytes[bytes.length - 3] = delay >> 8;
    push(0x2c); word(0); word(0); word(w); word(h);
    push(0x80 | (bits - 1));
    for (let i = 0; i < (1 << bits); i++) { const c = colors[used[i]] || [0, 0, 0]; push(c[0], c[1], c[2]); }
    push(bits);
    const data = lzw(remap, bits);
    for (let i = 0; i < data.length; i += 255) {
      const n = Math.min(255, data.length - i);
      push(n);
      for (let j = 0; j < n; j++) bytes.push(data[i + j]);
    }
    push(0);
  }
  push(0x3b);
  return { bytes: Uint8Array.from(bytes), maxUsed };
}

/* Decodes GIFs written by `encode`: full-size frames, local colour tables, optional transparency
   that keeps the previous pixel. Returns RGB triples and the delay in hundredths of a second per frame. */
function decode(bytes) {
  const rd16 = (at) => bytes[at] | (bytes[at + 1] << 8);
  const skipBlocks = (at) => {
    while (bytes[at] !== 0) at += bytes[at] + 1;
    return at + 1;
  };
  const w = rd16(6), h = rd16(8);
  const gflags = bytes[10];
  let p = 13;
  if (gflags & 0x80) p += 3 * (1 << ((gflags & 7) + 1));
  const frames = [];
  const delays = [];
  const canvas = new Uint8Array(w * h * 3);
  let transparent = -1;
  let delay = 0;
  while (p < bytes.length) {
    const tag = bytes[p];
    p += 1;
    if (tag === 0x3b) break;
    if (tag === 0x21) {
      const label = bytes[p];
      p += 1;
      if (label === 0xf9) { transparent = bytes[p + 1] & 1 ? bytes[p + 4] : -1; delay = rd16(p + 2); }
      p = skipBlocks(p);
    } else if (tag === 0x2c) {
      const fx = rd16(p), fy = rd16(p + 2), fw = rd16(p + 4), fh = rd16(p + 6), flags = bytes[p + 8];
      p += 9;
      const bits = (flags & 7) + 1;
      const table = bytes.subarray(p, p + 3 * (1 << bits));
      p += 3 * (1 << bits);
      const minBits = bytes[p];
      p += 1;
      const chunks = [];
      while (bytes[p] !== 0) {
        chunks.push(Buffer.from(bytes.subarray(p + 1, p + 1 + bytes[p])));
        p += bytes[p] + 1;
      }
      p += 1;
      const idx = lzwDecode(Buffer.concat(chunks), minBits, fw * fh);
      for (let i = 0; i < fw * fh; i++) {
        if (idx[i] === transparent) continue;
        const o = ((fy + Math.floor(i / fw)) * w + fx + (i % fw)) * 3;
        canvas[o] = table[idx[i] * 3]; canvas[o + 1] = table[idx[i] * 3 + 1]; canvas[o + 2] = table[idx[i] * 3 + 2];
      }
      frames.push(Uint8Array.from(canvas));
      delays.push(delay);
    } else throw new Error(`unexpected GIF block ${tag} at byte ${p - 1}`);
  }
  return { width: w, height: h, frames, delays };
}

function lzwDecode(data, minBits, count) {
  const clear = 1 << minBits, eoi = clear + 1;
  const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), first = new Uint8Array(4096);
  for (let i = 0; i < clear; i++) { suffix[i] = i; first[i] = i; prefix[i] = -1; }
  const out = new Uint8Array(count);
  let n = 0, size = minBits + 1, next = eoi + 1, prev = -1, acc = 0, nacc = 0, pos = 0;
  const stack = new Uint8Array(4097);
  while (n < count) {
    while (nacc < size) { if (pos >= data.length) return out; acc |= data[pos++] << nacc; nacc += 8; }
    const code = acc & ((1 << size) - 1);
    acc >>>= size; nacc -= size;
    if (code === clear) { size = minBits + 1; next = eoi + 1; prev = -1; continue; }
    if (code === eoi) break;
    let cur = code, sp = 0;
    if (code >= next) { stack[sp++] = first[prev]; cur = prev; }
    while (cur >= clear) { stack[sp++] = suffix[cur]; cur = prefix[cur]; }
    stack[sp++] = suffix[cur];
    const head = stack[sp - 1];
    while (sp > 0 && n < count) out[n++] = stack[--sp];
    if (prev >= 0 && next < 4096) {
      prefix[next] = prev; suffix[next] = head; first[next] = first[prev];
      next++;
      if (next === (1 << size) && size < 12) size++;
    }
    prev = code;
  }
  return out;
}

return { encode, decode };
})();
if (typeof module !== 'undefined') module.exports = GifKit;
