import { DoomPicture, DoomPictureColumn, DmxSound, WadHeader, WadLumpInfo } from '../types/wad';

export class WadParser {
  private buffer: ArrayBuffer;
  private dataView: DataView;
  private uint8: Uint8Array;
  public header!: WadHeader;
  public lumps: WadLumpInfo[] = [];

  constructor(arrayBuffer: ArrayBuffer) {
    this.buffer = arrayBuffer;
    this.dataView = new DataView(arrayBuffer);
    this.uint8 = new Uint8Array(arrayBuffer);
    this.parseHeader();
    this.parseDirectory();
  }

  private parseHeader() {
    if (this.buffer.byteLength < 12) {
      throw new Error('Invalid WAD buffer: too short');
    }
    const magic = String.fromCharCode(
      this.uint8[0],
      this.uint8[1],
      this.uint8[2],
      this.uint8[3]
    );
    if (magic !== 'IWAD' && magic !== 'PWAD') {
      throw new Error(`Invalid WAD magic signature: ${magic}`);
    }

    const numLumps = this.dataView.getUint32(4, true);
    const directoryOffset = this.dataView.getUint32(8, true);

    this.header = {
      wad_type: magic,
      num_lumps: numLumps,
      directory_offset: directoryOffset,
    };
  }

  private parseDirectory() {
    this.lumps = [];
    const dirStart = this.header.directory_offset;
    for (let i = 0; i < this.header.num_lumps; i++) {
      const entryOffset = dirStart + i * 16;
      if (entryOffset + 16 > this.buffer.byteLength) break;

      const filePos = this.dataView.getUint32(entryOffset, true);
      const size = this.dataView.getUint32(entryOffset + 4, true);

      let name = '';
      for (let j = 0; j < 8; j++) {
        const charCode = this.uint8[entryOffset + 8 + j];
        if (charCode === 0) break;
        name += String.fromCharCode(charCode);
      }

      this.lumps.push({
        name: name.toUpperCase(),
        file_pos: filePos,
        size,
        index: i,
      });
    }
  }

  public findLump(name: string): WadLumpInfo | undefined {
    const upper = name.toUpperCase();
    return this.lumps.find((l) => l.name === upper);
  }

  public getLumpBytes(lump: WadLumpInfo): Uint8Array {
    return this.uint8.subarray(lump.file_pos, lump.file_pos + lump.size);
  }

  /**
   * Extracts PLAYPAL lump: 14 palettes x 256 colors x 3 RGB bytes = 10,752 bytes
   * Returns array of 14 palettes, each having 256 colors as [r, g, b, a]
   */
  public extractPlaypal(): Uint8Array[] {
    const lump = this.findLump('PLAYPAL');
    if (!lump) {
      throw new Error('PLAYPAL lump not found in WAD');
    }
    const raw = this.getLumpBytes(lump);
    const palettes: Uint8Array[] = [];

    for (let p = 0; p < 14; p++) {
      const pOffset = p * 256 * 3;
      const rgba = new Uint8Array(256 * 4);
      for (let c = 0; c < 256; c++) {
        const r = raw[pOffset + c * 3];
        const g = raw[pOffset + c * 3 + 1];
        const b = raw[pOffset + c * 3 + 2];
        rgba[c * 4] = r;
        rgba[c * 4 + 1] = g;
        rgba[c * 4 + 2] = b;
        rgba[c * 4 + 3] = 255;
      }
      palettes.push(rgba);
    }
    return palettes;
  }

  /**
   * Safely decodes a Doom Picture / Patch lump (e.g. STFST01, STBAR)
   */
  public extractPicture(lumpName: string): DoomPicture {
    const lump = this.findLump(lumpName);
    if (!lump) {
      throw new Error(`Picture lump '${lumpName}' not found`);
    }
    const bytes = this.getLumpBytes(lump);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    const width = view.getUint16(0, true);
    const height = view.getUint16(2, true);
    const leftOffset = view.getInt16(4, true);
    const topOffset = view.getInt16(6, true);

    const columns: DoomPictureColumn[][] = [];

    for (let x = 0; x < width; x++) {
      const colOffset = view.getUint32(8 + x * 4, true);
      const colPosts: DoomPictureColumn[] = [];

      let ptr = colOffset;
      while (ptr < bytes.length) {
        const topDelta = bytes[ptr];
        if (topDelta === 0xff) {
          // 255 marks end of column
          break;
        }

        const length = bytes[ptr + 1];
        // ptr + 2 is unused padding byte
        const pixelStart = ptr + 3;
        const pixelEnd = pixelStart + length;

        if (pixelEnd <= bytes.length) {
          const pixels = bytes.slice(pixelStart, pixelEnd);
          colPosts.push({
            topDelta,
            length,
            pixels,
          });
        }

        // Advance: topDelta (1) + length (1) + pad (1) + pixels (length) + pad (1)
        ptr += length + 4;
      }

      columns.push(colPosts);
    }

    return {
      width,
      height,
      leftOffset,
      topOffset,
      columns,
    };
  }

  /**
   * Safely decodes DMX sound lump (e.g. DSPISTOL, DSSHOTGN, DSOOF)
   * Length-checked dynamic guard byte check to handle commercial & Freedoom formats.
   */
  public extractDmxSound(lumpName: string): DmxSound {
    const lump = this.findLump(lumpName);
    if (!lump) {
      throw new Error(`Sound lump '${lumpName}' not found`);
    }
    const bytes = this.getLumpBytes(lump);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    if (bytes.length < 8) {
      throw new Error(`Sound lump '${lumpName}' is too short`);
    }

    const sampleRate = view.getUint16(2, true);
    const sampleCount = view.getUint32(4, true);

    const actualDataLen = bytes.length - 8;
    let sampleBytes: Uint8Array;

    if (actualDataLen >= sampleCount + 32) {
      // Commercial Doom format with 16 padding bytes
      sampleBytes = bytes.subarray(24, 24 + sampleCount);
    } else {
      // Freedoom format
      sampleBytes = bytes.subarray(8, Math.min(8 + sampleCount, bytes.length));
    }

    // Convert 8-bit unsigned PCM (0..255, 128=center) to 32-bit float (-1.0 .. 1.0)
    const floatSamples = new Float32Array(sampleBytes.length);
    for (let i = 0; i < sampleBytes.length; i++) {
      floatSamples[i] = (sampleBytes[i] - 128) / 128.0;
    }

    return {
      name: lumpName,
      sampleRate,
      sampleCount: floatSamples.length,
      samples: floatSamples,
    };
  }
}
