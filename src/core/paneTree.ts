import type { PaneDirection, PaneTree, SplitLayoutMode } from '../types/sessionTree';

export const paneLeaf = (sessionId: string): PaneTree => ({
  type: 'leaf',
  id: `pane-${sessionId}`,
  sessionId,
});

const split = (
  direction: PaneDirection,
  first: PaneTree,
  second: PaneTree,
  ratio = 0.5,
): PaneTree => ({
  type: 'split',
  id: `split-${first.id}-${second.id}`,
  direction,
  ratio,
  first,
  second,
});

function balanced(ids: string[], direction: PaneDirection): PaneTree | null {
  if (!ids.length) return null;
  if (ids.length === 1) return paneLeaf(ids[0]);
  const middle = Math.ceil(ids.length / 2);
  return split(
    direction,
    balanced(ids.slice(0, middle), direction)!,
    balanced(ids.slice(middle), direction)!,
  );
}

/** Convert the old four layout names once, then persist edits as a real tree. */
export function treeFromLayout(layout: SplitLayoutMode, sessionIds: string[]): PaneTree | null {
  if (!sessionIds.length) return null;
  if (layout === 'single') return paneLeaf(sessionIds[0]);
  if (layout === 'split-v') return balanced(sessionIds, 'row');
  if (layout === 'split-h') return balanced(sessionIds, 'column');

  // A grid is rows stacked vertically. Additional rows stay balanced rather
  // than disappearing when a legacy workspace happened to contain >4 panes.
  const rows: PaneTree[] = [];
  for (let i = 0; i < sessionIds.length; i += 2) {
    rows.push(balanced(sessionIds.slice(i, i + 2), 'row')!);
  }
  if (rows.length === 1) return rows[0];
  const combine = (items: PaneTree[]): PaneTree => {
    if (items.length === 1) return items[0];
    const middle = Math.ceil(items.length / 2);
    return split('column', combine(items.slice(0, middle)), combine(items.slice(middle)));
  };
  return combine(rows);
}

export function leafSessionIds(tree: PaneTree): string[] {
  return tree.type === 'leaf'
    ? [tree.sessionId]
    : [...leafSessionIds(tree.first), ...leafSessionIds(tree.second)];
}

export function splitLeaf(
  tree: PaneTree,
  targetSessionId: string,
  newSessionId: string,
  direction: PaneDirection,
): PaneTree {
  if (tree.type === 'leaf') {
    return tree.sessionId === targetSessionId
      ? split(direction, tree, paneLeaf(newSessionId))
      : tree;
  }
  const first = splitLeaf(tree.first, targetSessionId, newSessionId, direction);
  if (first !== tree.first) return { ...tree, first };
  const second = splitLeaf(tree.second, targetSessionId, newSessionId, direction);
  return second === tree.second ? tree : { ...tree, second };
}

export function removeLeaf(tree: PaneTree, sessionId: string): PaneTree | null {
  if (tree.type === 'leaf') return tree.sessionId === sessionId ? null : tree;
  const first = removeLeaf(tree.first, sessionId);
  const second = removeLeaf(tree.second, sessionId);
  if (!first) return second;
  if (!second) return first;
  return first === tree.first && second === tree.second ? tree : { ...tree, first, second };
}

const clampRatio = (ratio: number): number => Math.max(0.1, Math.min(0.9, ratio));

export function setSplitRatio(tree: PaneTree, splitId: string, ratio: number): PaneTree {
  if (tree.type === 'leaf') return tree;
  if (tree.id === splitId) return { ...tree, ratio: clampRatio(ratio) };
  const first = setSplitRatio(tree.first, splitId, ratio);
  const second = setSplitRatio(tree.second, splitId, ratio);
  return first === tree.first && second === tree.second ? tree : { ...tree, first, second };
}

export function equalizeTree(tree: PaneTree): PaneTree {
  return tree.type === 'leaf'
    ? tree
    : { ...tree, ratio: 0.5, first: equalizeTree(tree.first), second: equalizeTree(tree.second) };
}
