import { describe, it, expect } from 'vitest';
import {
  openWorkspace, closeWorkspace, activeWorkspace, replaceWorkspace, adoptWorkspace,
} from './workspaceSet';
import { createWorkspaceForFolder } from './sessionStore';
import { WorkspaceSet } from '../types/sessionTree';

const setOf = (...paths: string[]): WorkspaceSet => {
  const workspaces = paths.map((p) => createWorkspaceForFolder(p));
  return { workspaces, activeWorkspaceId: workspaces[0].id };
};

describe('workspace set', () => {
  it('keeps the previous workspace when another is opened', () => {
    const before = setOf('/a');
    const after = openWorkspace(before, createWorkspaceForFolder('/b'));
    expect(after.workspaces).toHaveLength(2);
    expect(after.workspaces.map((w) => w.rootPath)).toEqual(['/a', '/b']);
  });

  it('focuses the newly opened workspace', () => {
    const after = openWorkspace(setOf('/a'), createWorkspaceForFolder('/b'));
    expect(activeWorkspace(after).rootPath).toBe('/b');
  });

  it('re-opening an already-open folder focuses it instead of duplicating', () => {
    const before = openWorkspace(setOf('/a'), createWorkspaceForFolder('/b'));
    const after = openWorkspace(before, createWorkspaceForFolder('/a'));
    expect(after.workspaces).toHaveLength(2);
    expect(activeWorkspace(after).rootPath).toBe('/a');
  });

  it('preserves the sessions of a workspace you switch away from', () => {
    const before = setOf('/a');
    const nodeId = Object.keys(before.workspaces[0].nodes)[0];
    const after = openWorkspace(before, createWorkspaceForFolder('/b'));
    expect(after.workspaces[0].nodes[nodeId]).toBeDefined();
  });

  it('never leaves the set empty', () => {
    const one = setOf('/a');
    expect(closeWorkspace(one, one.workspaces[0].id).workspaces).toHaveLength(1);
  });

  it('moves focus off a workspace that is closed', () => {
    const two = openWorkspace(setOf('/a'), createWorkspaceForFolder('/b'));
    const after = closeWorkspace(two, two.activeWorkspaceId);
    expect(after.workspaces).toHaveLength(1);
    expect(activeWorkspace(after).rootPath).toBe('/a');
  });

  it('adopting a workspace discards the placeholder it replaces', () => {
    // The first run's HOME workspace was never chosen by anyone. Leaving it in
    // the set would put a second session, in a folder nobody asked for, one
    // Ctrl+1 away from the folder the user did choose.
    const after = adoptWorkspace(createWorkspaceForFolder('/home/u/proj'));
    expect(after.workspaces).toHaveLength(1);
    expect(after.workspaces[0].rootPath).toBe('/home/u/proj');
  });

  it('focuses the workspace it adopts', () => {
    const ws = createWorkspaceForFolder('/home/u/proj');
    expect(activeWorkspace(adoptWorkspace(ws)).id).toBe(ws.id);
  });

  it('updates one workspace in place without disturbing the others', () => {
    const two = openWorkspace(setOf('/a'), createWorkspaceForFolder('/b'));
    const edited = { ...two.workspaces[0], name: 'RENAMED' };
    const after = replaceWorkspace(two, edited);
    expect(after.workspaces[0].name).toBe('RENAMED');
    expect(after.workspaces[1].rootPath).toBe('/b');
    expect(after.activeWorkspaceId).toBe(two.activeWorkspaceId);
  });
});
