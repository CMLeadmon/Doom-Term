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

export function replaceLeaf(
  tree: PaneTree,
  targetSessionId: string,
  newSessionId: string,
): PaneTree {
  if (tree.type === 'leaf') {
    return tree.sessionId === targetSessionId ? paneLeaf(newSessionId) : tree;
  }
  const first = replaceLeaf(tree.first, targetSessionId, newSessionId);
  const second = replaceLeaf(tree.second, targetSessionId, newSessionId);
  if (first === tree.first && second === tree.second) return tree;
  return { ...tree, first, second };
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

export interface PaneRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PaneFocusDirection = 'left' | 'right' | 'up' | 'down';

/** Project the persisted ratios into normalized geometry for focus and labels. */
export function paneRects(tree: PaneTree): Record<string, PaneRect> {
  const out: Record<string, PaneRect> = {};
  const visit = (node: PaneTree, rect: PaneRect) => {
    if (node.type === 'leaf') {
      out[node.sessionId] = rect;
      return;
    }
    if (node.direction === 'row') {
      const firstWidth = rect.width * node.ratio;
      visit(node.first, { ...rect, width: firstWidth });
      visit(node.second, {
        x: rect.x + firstWidth,
        y: rect.y,
        width: rect.width - firstWidth,
        height: rect.height,
      });
      return;
    }
    const firstHeight = rect.height * node.ratio;
    visit(node.first, { ...rect, height: firstHeight });
    visit(node.second, {
      x: rect.x,
      y: rect.y + firstHeight,
      width: rect.width,
      height: rect.height - firstHeight,
    });
  };
  visit(tree, { x: 0, y: 0, width: 1, height: 1 });
  return out;
}

/** Nearest centre in one half-plane, with tree order breaking exact ties. */
export function adjacentPane(
  tree: PaneTree,
  activeSessionId: string,
  direction: PaneFocusDirection,
): string | null {
  const rects = paneRects(tree);
  const source = rects[activeSessionId];
  if (!source) return null;
  const sx = source.x + source.width / 2;
  const sy = source.y + source.height / 2;
  let best: { id: string; score: number } | null = null;

  for (const id of leafSessionIds(tree)) {
    if (id === activeSessionId) continue;
    const rect = rects[id];
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const primary = direction === 'left' && rect.x + rect.width <= source.x
      ? source.x - (rect.x + rect.width)
      : direction === 'right' && rect.x >= source.x + source.width
        ? rect.x - (source.x + source.width)
        : direction === 'up' && rect.y + rect.height <= source.y
          ? source.y - (rect.y + rect.height)
          : direction === 'down' && rect.y >= source.y + source.height
            ? rect.y - (source.y + source.height)
            : -1;
    if (primary < 0) continue;
    const secondary = direction === 'left' || direction === 'right'
      ? Math.abs(cy - sy)
      : Math.abs(cx - sx);
    const score = primary * 100 + secondary;
    if (!best || score < best.score) best = { id, score };
  }
  return best?.id ?? null;
}

/**
 * The geometry that must hold once `nodeId` is the active session.
 *
 * The tree is the visibility authority — `SplitPaneGrid` renders leaves and
 * nothing else — so selecting a session that is not IN the tree used to make it
 * active in state while leaving it in the hidden-node wrapper. The user kept
 * looking at the previous pane, and no terminal took focus.
 *
 * The bug was a membership test against the group's `nodeIds`, which is the
 * list of sessions the group OWNS, not the list it currently shows. In `single`
 * layout every session is owned and only one is shown, so for an already-known
 * id the test passed and the tree was left alone.
 *
 * Split layouts replace the leaf that is losing focus rather than adding one:
 * choosing a session from the switcher is a swap, not a new pane.
 */
export function treeForSelection(
  layout: SplitLayoutMode,
  tree: PaneTree | undefined,
  currentActiveId: string,
  nodeId: string,
): PaneTree {
  if (layout === 'single' || !tree) return paneLeaf(nodeId);
  return leafSessionIds(tree).includes(nodeId)
    ? tree
    : replaceLeaf(tree, currentActiveId, nodeId);
}

const PANE_LABELS = 'asdfghjklqwertyuiopzxcvbnm';

export function paneLabels(tree: PaneTree): Record<string, string> {
  return Object.fromEntries(
    leafSessionIds(tree).map((id, index) => [id, PANE_LABELS[index] ?? String(index + 1)]),
  );
}
