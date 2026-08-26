export interface PlateSpec {
  width: number;
  height: number;
  valueChars: number;
  [key: string]: unknown;
}

export interface PlateRenderResult {
  w: number;
  h: number;
  data: Uint8Array;
}

export const PLATE_480: PlateSpec;

export function renderPlate(
  state: Record<string, unknown>,
  scale?: number,
  spec?: PlateSpec,
): PlateRenderResult;

export function truncateLeft(str: string, maxLen: number): string;
