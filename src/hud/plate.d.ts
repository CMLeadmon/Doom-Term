export interface PlateSpec {
  width: number;
  height: number;
  valueChars: number;
  zoneX: number;
  zoneW: number;
  sandboxX?: number;
  cardsX?: number;
  [key: string]: unknown;
}

export interface PlateRenderResult {
  w: number;
  h: number;
  data: Uint8Array;
}

export const PLATE_480: PlateSpec;
export const WAITING_ROWS: number;
export const WAITING_ROWS_MIN_W: number;
export const WAITING_MIN_W: number;

/**
 * Whether drawWaiting() actually paints a row with this tail. The renderer and
 * the hit test share this so a row cannot be clickable where nothing was drawn.
 */
export function waitingRowIsRendered(spec: PlateSpec, tail: string): boolean;

/** Characters of name a row can honestly show, given its own tail. */
export function waitingNameRoom(spec: PlateSpec, tail: string): number;

/** Column geometry for a plate of any width. plateSpec(480) === PLATE_480. */
export function plateSpec(width: number): PlateSpec;

export function renderPlate(
  state: Record<string, unknown>,
  scale?: number,
  spec?: PlateSpec,
): PlateRenderResult;

export function truncateLeft(str: string, maxLen: number): string;

/** One colour per agent key. Missing keys fall back to the plate's tan. */
export const AGENT_COLORS: Record<string, string>;

export interface MarkTones {
  core: number[];
  dim: number[];
  ring: { phase: number; base: string } | null;
}

/** The mark's colour ladder for one phase. `pulse === undefined` = halted. */
export function markTones(agentKey: string, pulse?: number): MarkTones;

export function mix(from: string | number[], to: string | number[], t: number): number[];
