import { describe, it, expect } from 'vitest';
import { createDefaultWorkspace, createWorkspaceForFolder, SessionStore } from './sessionStore';

/**
 * This suite runs under jsdom, but Node's own experimental `localStorage` global
 * shadows jsdom's and is unavailable without `--localstorage-file`, so
 * `window.localStorage` is undefined by default here. That is genuinely one of
 * the two branches `loadRecentWorkspaces` has, so we exercise it as-is and
 * install a minimal in-memory store to reach the other.
 */
function withLocalStorage<T>(seed: Record<string, string>, fn: () => T): T {
  const map = new Map(Object.entries(seed));
  const fake = {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };

  const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', { value: fake, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    if (original) Object.defineProperty(window, 'localStorage', original);
    else delete (window as unknown as Record<string, unknown>).localStorage;
  }
}

describe('workspace seeding', () => {
  it('seeds no fabricated product copy', () => {
    const serialised = JSON.stringify(createDefaultWorkspace());
    expect(serialised).not.toMatch(/Architectural|VelaTerm|nodeterm|Worktree|Messaging Bus|Multi-Lens/i);
  });

  it('opens a new session with no output at all', () => {
    const ws = createDefaultWorkspace();
    const node = Object.values(ws.nodes)[0];
    expect(node.blocks).toEqual([]);
    expect(node.commandHistory).toEqual([]);
  });

  it('names a folder workspace after the folder', () => {
    const ws = createWorkspaceForFolder('/home/u/Projects/thing');
    expect(ws.name).toBe('THING');
    expect(ws.rootPath).toBe('/home/u/Projects/thing');
  });
});

describe('recent workspaces', () => {
  it('invents nothing when storage is unavailable', () => {
    expect(window.localStorage).toBeUndefined();
    expect(SessionStore.loadRecentWorkspaces()).toEqual([]);
  });

  it('invents nothing on a clean machine with empty storage', () => {
    withLocalStorage({}, () => {
      expect(SessionStore.loadRecentWorkspaces()).toEqual([]);
    });
  });

  it('returns what was actually stored', () => {
    const stored = [{ name: 'THING', path: '/home/u/Projects/thing' }];
    withLocalStorage({ DOOM_TERM_RECENT_WORKSPACES_V1: JSON.stringify(stored) }, () => {
      expect(SessionStore.loadRecentWorkspaces()).toEqual(stored);
    });
  });
});
