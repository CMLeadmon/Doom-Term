let counter = 0;

/**
 * A collision-free id.
 *
 * Ids used to be `${prefix}-${Date.now()}`, which collides whenever two are
 * minted in the same millisecond — opening two folders in quick succession
 * gave both workspaces the same id, so the second could never be focused.
 */
export function uniqueId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}
