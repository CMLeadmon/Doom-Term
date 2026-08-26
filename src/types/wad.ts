export interface WadHeader {
  wad_type: string;
  num_lumps: number;
  directory_offset: number;
}

export interface WadLumpInfo {
  name: string;
  file_pos: number;
  size: number;
  index: number;
}

export interface DoomPictureColumn {
  topDelta: number;
  length: number;
  pixels: Uint8Array;
}

export interface DoomPicture {
  width: number;
  height: number;
  leftOffset: number;
  topOffset: number;
  columns: DoomPictureColumn[][];
}

export interface DmxSound {
  name: string;
  sampleRate: number;
  sampleCount: number;
  samples: Float32Array;
}

export type SoundEffectType =
  | 'shotgun'
  | 'pickup'
  | 'oof'
  | 'door'
  | 'teleport'
  | 'pistol'
  | 'click'
  | 'bfg';
