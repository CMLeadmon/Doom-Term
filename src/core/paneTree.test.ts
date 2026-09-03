import { describe, expect, it } from 'vitest';
import {
  adjacentPane, equalizeTree, leafSessionIds, paneLabels, paneLeaf, paneRects, removeLeaf,
  setSplitRatio, splitLeaf, treeForSelection, treeFromLayout,
} from './paneTree';

describe('pane tree migration', () => {
  it('maps legacy vertical and grid layouts without losing leaf order', () => {
    expect(leafSessionIds(treeFromLayout('split-v', ['a', 'b'])!)).toEqual(['a', 'b']);
    const grid = treeFromLayout('grid-2x2', ['a', 'b', 'c', 'd'])!;
    expect(grid).toMatchObject({ type: 'split', direction: 'column' });
    expect(leafSessionIds(grid)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('pane tree edits', () => {
  it('splits one leaf and leaves the rest in place', () => {
    const base = treeFromLayout('split-v', ['a', 'b'])!;
    const next = splitLeaf(base, 'a', 'c', 'column');
    expect(leafSessionIds(next)).toEqual(['a', 'c', 'b']);
    expect(base).not.toBe(next);
  });

  it('collapses a parent when one leaf is removed', () => {
    const base = splitLeaf(treeFromLayout('single', ['a'])!, 'a', 'b', 'row');
    expect(removeLeaf(base, 'a')).toMatchObject({ type: 'leaf', sessionId: 'b' });
  });

  it('clamps resize ratios and equalizes every nested split', () => {
    const nested = splitLeaf(
      splitLeaf(treeFromLayout('single', ['a'])!, 'a', 'b', 'row'),
      'a', 'c', 'column',
    );
    const rootId = nested.id;
    expect(setSplitRatio(nested, rootId, 4)).toMatchObject({ ratio: 0.9 });
    const equal = equalizeTree(setSplitRatio(nested, rootId, 0.2));
    expect(JSON.stringify(equal).match(/"ratio":0.5/g)?.length).toBe(2);
  });
});

describe('pane geometry', () => {
  const tree = splitLeaf(
    splitLeaf(treeFromLayout('single', ['a'])!, 'a', 'b', 'row'),
    'a', 'c', 'column',
  );

  it('projects ratios into stable normalized rectangles', () => {
    expect(paneRects(tree)).toEqual({
      a: { x: 0, y: 0, width: 0.5, height: 0.5 },
      c: { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      b: { x: 0.5, y: 0, width: 0.5, height: 1 },
    });
  });

  it('selects the nearest pane in the requested spatial direction', () => {
    expect(adjacentPane(tree, 'a', 'right')).toBe('b');
    expect(adjacentPane(tree, 'a', 'down')).toBe('c');
    expect(adjacentPane(tree, 'c', 'up')).toBe('a');
    expect(adjacentPane(tree, 'a', 'left')).toBeNull();
  });

  it('labels leaves in stable tree order', () => {
    expect(paneLabels(tree)).toEqual({ a: 'a', c: 's', b: 'd' });
  });
});

describe('selecting a session that the tree does not show', () => {
  it('brings it into view in single layout, even though the group already owns it', () => {
    // The committed bug. Creating a session in `single` layout replaces the
    // pane-tree leaf but keeps the older ids in `nodeIds`. Selecting one of
    // those older ids tested membership in `nodeIds` — which passed, because
    // the group owns every session it has ever created — so `activeNodeId`
    // moved and the tree did not. SplitPaneGrid renders from the tree, so the
    // chosen session became active while remaining in the hidden-node wrapper:
    // the user kept looking at the previous pane and nothing took focus.
    const showing = paneLeaf('new');
    expect(treeForSelection('single', showing, 'new', 'older')).toEqual(paneLeaf('older'));
  });

  it('is a no-op in single layout when it is already the visible leaf', () => {
    expect(leafSessionIds(treeForSelection('single', paneLeaf('a'), 'a', 'a'))).toEqual(['a']);
  });

  it('swaps the pane losing focus rather than adding one, in a split layout', () => {
    // Choosing from the switcher is a swap. Adding a leaf would let the
    // geometry grow every time the operator changed their mind.
    const split = splitLeaf(paneLeaf('a'), 'a', 'b', 'row');
    const after = treeForSelection('split-v', split, 'b', 'c');
    expect(leafSessionIds(after)).toEqual(['a', 'c']);
  });

  it('leaves a split tree untouched when the session is already a leaf', () => {
    const split = splitLeaf(paneLeaf('a'), 'a', 'b', 'row');
    expect(treeForSelection('split-v', split, 'a', 'b')).toBe(split);
  });

  it('builds a leaf when there is no tree yet', () => {
    // Pre-reformation data has no paneTree at all.
    expect(treeForSelection('split-v', undefined, 'a', 'b')).toEqual(paneLeaf('b'));
  });
});
