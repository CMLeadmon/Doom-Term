import { describe, expect, it } from 'vitest';
import {
  adjacentPane, equalizeTree, leafSessionIds, paneLabels, paneRects, removeLeaf,
  setSplitRatio, splitLeaf, treeFromLayout,
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
