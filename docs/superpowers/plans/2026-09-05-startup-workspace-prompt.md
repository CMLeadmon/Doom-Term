# Startup Workspace Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a run with nothing to restore, ask the user which folder the first terminal opens in, and spawn nothing until they answer.

**Architecture:** `SessionStore` gains an honest answer to "was anything actually restored from disk?", which is different from "what should I show" — today a synthesized HOME default is indistinguishable from a real restore. `useWorkspaceSet` turns that answer into a `needsWorkspaceChoice` gate: while it is true nothing spawns and nothing is written to storage, and resolving it either adopts the chosen folder as the only workspace or keeps the HOME placeholder. `App` opens the existing `WorkspaceModal` on that gate — no new UI, no new keyboard contract.

**Tech Stack:** TypeScript, React 19, Vitest + jsdom + @testing-library/react (`renderHook`), localStorage.

**Spec:** None. This is a bounded change; the design was agreed in conversation and is restated in full here. Behaviour was settled as: prompt **only** when there is nothing to restore; **Esc opens HOME (`~`)**; **reuse `WorkspaceModal` as-is**.

## Global Constraints

- Never invent telemetry: a synthesized workspace must not be presented as a restored one (AGENTS.md Axiom 3).
- The Status Plate is the only persistent chrome; every picker is transient and Esc-dismissible (Axiom 2).
- No new components, no icon libraries, no `rounded-*`, no soft shadows — this change adds no markup at all.
- Existing keyboard contract unchanged: `Ctrl+Shift+O` still *adds* a workspace beside the current one.
- Verification gate: `npm run agent:verify` must pass (typecheck, node + vitest tests, build, HUD pixel check, cargo check/test, tauri check).
- Work happens in the worktree `.worktrees/startup-workspace-prompt` on branch `feat/startup-workspace-prompt`, cut from `main` at `661478f`.

---

### Task 1: Tell a restore apart from a synthesized default

`SessionStore.loadWorkspaceSet()` returns a `WorkspaceSet` either way, so no caller can tell whether the user ever chose anything. Extract the parse into `readStoredWorkspaceSet()`, which returns `null` when storage holds nothing usable, and express the two existing callers in terms of it.

**Files:**
- Modify: `src/core/sessionStore.ts:147-181` (add `readStoredWorkspaceSet`, `defaultWorkspaceSet`, `hasStoredWorkspaceSet`; reduce `loadWorkspaceSet` to a fallback)
- Test: `src/core/sessionStore.test.ts` (new `describe('stored workspaces')` block)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export function readStoredWorkspaceSet(): WorkspaceSet | null`
  - `export function defaultWorkspaceSet(): WorkspaceSet`
  - `SessionStore.hasStoredWorkspaceSet(): boolean`
  - `SessionStore.loadWorkspaceSet(): WorkspaceSet` (unchanged signature and behaviour)

- [ ] **Step 1: Write the failing tests**

Append to `src/core/sessionStore.test.ts`. Note the file already defines `withLocalStorage` at the top — reuse it, do not redefine it. Update the import line at the top of the file to add the new names:

```ts
import {
  createDefaultWorkspace, createWorkspaceForFolder, SessionStore, backfillPaneTrees,
  backfillSessionNumbers, readStoredWorkspaceSet,
} from './sessionStore';
```

```ts
describe('stored workspaces', () => {
  const V2 = 'DOOM_TERM_WORKSPACES_V2';
  const V1 = 'DOOM_TERM_WORKSPACE_V1';
  const storedSet = (path: string) => {
    const ws = createWorkspaceForFolder(path);
    return JSON.stringify({ workspaces: [ws], activeWorkspaceId: ws.id });
  };

  it('reports nothing stored when storage is unavailable', () => {
    // Same branch loadRecentWorkspaces has: no storage is not a restore.
    expect(window.localStorage).toBeUndefined();
    expect(SessionStore.hasStoredWorkspaceSet()).toBe(false);
  });

  it('reports nothing stored on a clean machine', () => {
    withLocalStorage({}, () => {
      expect(readStoredWorkspaceSet()).toBeNull();
      expect(SessionStore.hasStoredWorkspaceSet()).toBe(false);
    });
  });

  it('still hands back a workspace to show when nothing was stored', () => {
    withLocalStorage({}, () => {
      expect(SessionStore.loadWorkspaceSet().workspaces[0].rootPath).toBe('~');
    });
  });

  it('reports a stored set, and returns it', () => {
    withLocalStorage({ [V2]: storedSet('/home/u/proj') }, () => {
      expect(SessionStore.hasStoredWorkspaceSet()).toBe(true);
      expect(readStoredWorkspaceSet()?.workspaces[0].rootPath).toBe('/home/u/proj');
    });
  });

  it('reports a legacy single workspace as stored', () => {
    // A V1 user has chosen a folder before; a first-run prompt would be a lie.
    withLocalStorage({ [V1]: JSON.stringify(createWorkspaceForFolder('/legacy')) }, () => {
      expect(SessionStore.hasStoredWorkspaceSet()).toBe(true);
      expect(readStoredWorkspaceSet()?.workspaces[0].rootPath).toBe('/legacy');
    });
  });

  it('treats corrupt storage as nothing stored', () => {
    withLocalStorage({ [V2]: '{{{not json' }, () => {
      expect(readStoredWorkspaceSet()).toBeNull();
      expect(SessionStore.loadWorkspaceSet().workspaces[0].rootPath).toBe('~');
    });
  });

  it('treats an empty workspace list as nothing stored', () => {
    withLocalStorage({ [V2]: JSON.stringify({ workspaces: [], activeWorkspaceId: '' }) }, () => {
      expect(readStoredWorkspaceSet()).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/core/sessionStore.test.ts`
Expected: FAIL — `readStoredWorkspaceSet` is not exported, `hasStoredWorkspaceSet` is not a function.

- [ ] **Step 3: Write the implementation**

In `src/core/sessionStore.ts`, insert directly above `export class SessionStore` (after `singleton`):

```ts
/**
 * The workspaces actually on disk, or null when there are none.
 *
 * Extracted from `loadWorkspaceSet` so the first-run gate can ask whether
 * anything was restored without a second parser to keep in step with this one.
 * A workspace this module synthesized is not a restore, and the difference is
 * the whole question the startup picker exists to ask.
 */
export function readStoredWorkspaceSet(): WorkspaceSet | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;

  try {
    const saved = window.localStorage.getItem(SET_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as WorkspaceSet;
      if (parsed.workspaces?.length) return migrateWorkspaceSet(parsed);
    }

    // Migrate a V1 single workspace rather than dropping the user's sessions.
    const legacy = window.localStorage.getItem(STORAGE_KEY);
    if (legacy) {
      const ws = JSON.parse(legacy) as ProjectWorkspace;
      if (ws.groups && ws.nodes && Object.keys(ws.nodes).length > 0) {
        return migrateWorkspaceSet(singleton(ws));
      }
    }
  } catch (e) {
    console.warn('⚡ Failed to restore Doom Term workspaces from storage, starting fresh:', e);
  }

  return null;
}

/** What a run with nothing on disk starts from: one synthesized workspace at HOME. */
export function defaultWorkspaceSet(): WorkspaceSet {
  return singleton(createDefaultWorkspace());
}
```

Then replace the body of `loadWorkspaceSet` and add `hasStoredWorkspaceSet` inside the class:

```ts
  public static loadWorkspaceSet(): WorkspaceSet {
    return readStoredWorkspaceSet() ?? defaultWorkspaceSet();
  }

  /**
   * Whether anything was actually restored from disk.
   *
   * False on a first run, and on one whose storage was cleared or corrupted:
   * exactly the cases where the workspace handed back above was synthesized
   * here rather than chosen by anyone. The startup picker asks this, and
   * nothing spawns until it is answered.
   */
  public static hasStoredWorkspaceSet(): boolean {
    return readStoredWorkspaceSet() !== null;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/core/sessionStore.test.ts`
Expected: PASS, including the pre-existing suites in that file.

- [ ] **Step 5: Commit**

```bash
git add src/core/sessionStore.ts src/core/sessionStore.test.ts
git commit -m "feat(startup): tell a restored workspace from a synthesized one"
```

---

### Task 2: Adopt one workspace in place of the whole set

The folder chosen at startup must *replace* the HOME placeholder, not open beside it. `openWorkspace` adds and `replaceWorkspace` edits in place; neither says "this is now the only one".

**Files:**
- Modify: `src/core/workspaceSet.ts` (add `adoptWorkspace` after `openWorkspace`)
- Test: `src/core/workspaceSet.test.ts`

**Interfaces:**
- Consumes: `createWorkspaceForFolder` from `src/core/sessionStore.ts` (existing).
- Produces: `export function adoptWorkspace(ws: ProjectWorkspace): WorkspaceSet`

- [ ] **Step 1: Write the failing tests**

Add to the `describe('workspace set', ...)` block in `src/core/workspaceSet.test.ts`, and add `adoptWorkspace` to the import from `./workspaceSet`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/core/workspaceSet.test.ts`
Expected: FAIL — `adoptWorkspace` is not exported.

- [ ] **Step 3: Write the implementation**

In `src/core/workspaceSet.ts`, after `openWorkspace`:

```ts
/**
 * Keep only this workspace, discarding whatever the set held.
 *
 * For the first run, and only the first run: the set at that point is a single
 * placeholder at HOME that nobody chose, and the folder the user picks stands
 * in its place. `openWorkspace` is the wrong tool — it adds, which would leave
 * the placeholder and its session behind.
 */
export function adoptWorkspace(ws: ProjectWorkspace): WorkspaceSet {
  return { workspaces: [ws], activeWorkspaceId: ws.id };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/core/workspaceSet.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/workspaceSet.ts src/core/workspaceSet.test.ts
git commit -m "feat(workspace): adopt a chosen folder in place of the whole set"
```

---

### Task 3: Gate the first spawn on the user's choice

`useWorkspaceSet` learns three things: whether a choice is still owed, how to record one, and how to decline. Two existing behaviours have to change with it, both because a synthesized workspace was being treated as a restored one:

1. `restoredIds` (`useWorkspaceSet.ts:56`) is seeded from the *loaded* set, so on a first run the placeholder `node-1` is marked as having come off disk. Reconciliation then finds no such session in the daemon and classifies it as a snapshot, so a first launch renders `SNAPSHOT · Terminal 1` with a Start button instead of a shell. Seed from the *stored* set only.
2. `saveWorkspaceSet` runs on every set change, so the placeholder is written to storage within 400ms of launch. Quitting at the picker would then look like a restore on the next launch and the prompt would never appear again. Do not persist while the choice is owed.

**Files:**
- Modify: `src/hooks/useWorkspaceSet.ts:1-18` (imports), `:34-60` (boot state, gate, `restoredIds`), `:79-81` (persistence), `:211-223` (new handlers beside `handleOpenWorkspaceFolder`), `:493-517` (returns)
- Test: `src/hooks/useWorkspaceSet.test.ts` (create)

**Interfaces:**
- Consumes: `readStoredWorkspaceSet`, `defaultWorkspaceSet` (Task 1); `adoptWorkspace` (Task 2).
- Produces, added to the hook's return object:
  - `needsWorkspaceChoice: boolean`
  - `chooseStartupWorkspace: (folderPath: string, name?: string) => void`
  - `dismissStartupChoice: () => void`

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/useWorkspaceSet.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useWorkspaceSet } from './useWorkspaceSet';

/**
 * jsdom's `localStorage` is shadowed here by Node's own experimental global,
 * which is unavailable without `--localstorage-file`, so `window.localStorage`
 * is undefined by default. The hook reads storage at mount, so every case
 * needs a real one — see the same workaround in core/sessionStore.test.ts.
 */
const V2 = 'DOOM_TERM_WORKSPACES_V2';
let store: Map<string, string>;
let original: PropertyDescriptor | undefined;

beforeEach(() => {
  store = new Map();
  original = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
});

afterEach(() => {
  if (original) Object.defineProperty(window, 'localStorage', original);
  else delete (window as unknown as Record<string, unknown>).localStorage;
  vi.useRealTimers();
});

/** A stored set, as a previous run would have left it. */
const storedSet = () => JSON.stringify({
  workspaces: [{
    id: 'w', name: 'PROJ', rootPath: '/home/u/proj', activeGroupId: 'g',
    groups: [{
      id: 'g', projectId: 'w', name: 'Main Workstream', layout: 'single',
      activeNodeId: 'n1', nodeIds: ['n1'], paneTree: { type: 'leaf', sessionId: 'n1' },
      createdAt: 1,
    }],
    nodes: {
      n1: {
        id: 'n1', groupId: 'g', title: 'Terminal 1', number: 1, kind: 'terminal',
        cwd: '/home/u/proj', gitBranch: '', activeBlockId: null, isTuiActive: false,
        agentState: 'idle', tuiLines: [], commandHistory: [], createdAt: 1,
      },
    },
  }],
  activeWorkspaceId: 'w',
});

describe('first-run workspace choice', () => {
  it('asks where to open when there is nothing to restore', () => {
    const { result } = renderHook(() => useWorkspaceSet({}));
    expect(result.current.needsWorkspaceChoice).toBe(true);
  });

  it('does not ask when a workspace was restored', () => {
    // The folder was chosen once already; asking again every launch would be
    // a gate in front of work that is still running.
    store.set(V2, storedSet());
    const { result } = renderHook(() => useWorkspaceSet({}));
    expect(result.current.needsWorkspaceChoice).toBe(false);
    expect(result.current.workspace.rootPath).toBe('/home/u/proj');
  });

  it('opens the chosen folder as the only workspace', () => {
    const { result } = renderHook(() => useWorkspaceSet({}));
    act(() => result.current.chooseStartupWorkspace('/home/u/proj'));
    expect(result.current.needsWorkspaceChoice).toBe(false);
    expect(result.current.workspaceSet.workspaces).toHaveLength(1);
    expect(result.current.workspace.rootPath).toBe('/home/u/proj');
  });

  it('gives the chosen folder a session that may be bound', () => {
    // Nothing about it came off disk, so it must not wait on recovery and must
    // never be drawn as a snapshot of a session that never existed.
    const { result } = renderHook(() => useWorkspaceSet({}));
    act(() => result.current.chooseStartupWorkspace('/home/u/proj'));
    expect(result.current.bindingFor(result.current.activeNode.id)).toBe('ready');
  });

  it('opens HOME with a live session when the picker is dismissed', () => {
    // Esc is the documented way out, and it has to leave somewhere to type.
    const { result } = renderHook(() => useWorkspaceSet({}));
    act(() => result.current.dismissStartupChoice());
    expect(result.current.needsWorkspaceChoice).toBe(false);
    expect(result.current.workspace.rootPath).toBe('~');
    expect(result.current.bindingFor(result.current.activeNode.id)).toBe('ready');
  });

  it('remembers nothing while the choice is owed', () => {
    // Persisting the placeholder would make the next launch look like a
    // restore, and the prompt would never appear again.
    vi.useFakeTimers();
    renderHook(() => useWorkspaceSet({}));
    act(() => void vi.advanceTimersByTime(1000));
    expect(store.get(V2)).toBeUndefined();
  });

  it('remembers the workspace once the choice is made', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorkspaceSet({}));
    act(() => result.current.chooseStartupWorkspace('/home/u/proj'));
    act(() => void vi.advanceTimersByTime(1000));
    expect(store.get(V2)).toContain('/home/u/proj');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hooks/useWorkspaceSet.test.ts`
Expected: FAIL — `result.current.needsWorkspaceChoice` is `undefined`, `chooseStartupWorkspace` is not a function.

- [ ] **Step 3: Write the implementation**

In `src/hooks/useWorkspaceSet.ts`, change the two imports:

```ts
import { SessionStore, createWorkspaceForFolder, defaultWorkspaceSet, readStoredWorkspaceSet } from '../core/sessionStore';
import { activeWorkspace, adoptWorkspace, closeWorkspace, openWorkspace, replaceWorkspace } from '../core/workspaceSet';
```

Replace the `workspaceSet` state declaration (currently `useState(() => SessionStore.loadWorkspaceSet())`) with:

```ts
  /**
   * One read of storage at mount, so what is shown and whether any of it was
   * restored cannot disagree.
   */
  const [boot] = useState(() => {
    const stored = readStoredWorkspaceSet();
    return { set: stored ?? defaultWorkspaceSet(), restored: stored !== null };
  });
  const [workspaceSet, setWorkspaceSet] = useState<WorkspaceSet>(boot.set);
  /**
   * Whether the user still has to say where the first terminal opens.
   *
   * Only a run with nothing on disk asks: a restored workspace was chosen once
   * already. While this is true nothing is spawned and nothing is written to
   * storage, so quitting at the picker leaves the next launch just as fresh.
   */
  const [needsWorkspaceChoice, setNeedsWorkspaceChoice] = useState(!boot.restored);
```

Replace the `restoredIds` initialiser:

```ts
  /**
   * The ids that came off disk at boot, captured before anything can add to
   * them. A session created later in this run has no stored state to lose and
   * must not be made to wait on recovery.
   *
   * Seeded from what was STORED, not from what is shown: a workspace this run
   * synthesized never came off disk, and calling its placeholder session
   * restored made a first launch wait for reconciliation and then draw its own
   * brand-new session as a SNAPSHOT of something that never ran.
   */
  const restoredIds = useRef<Set<string>>(
    new Set(
      (boot.restored ? boot.set.workspaces : []).flatMap((candidate) => Object.keys(candidate.nodes)),
    ),
  );
```

Guard the persistence effect:

```ts
  useEffect(() => {
    // Nothing has been chosen yet, so there is nothing to remember. Writing the
    // placeholder would make the next launch look like a restore.
    if (needsWorkspaceChoice) return;
    SessionStore.saveWorkspaceSet(workspaceSet);
  }, [workspaceSet, needsWorkspaceChoice]);
```

Add the two handlers immediately after `handleOpenWorkspaceFolder`:

```ts
  /**
   * The folder picked at startup becomes the workspace.
   *
   * It replaces the placeholder rather than opening beside it. Binding is left
   * to the effect in App that binds whatever is on screen: one path to the
   * daemon, so there is one place where a session can be started.
   */
  const chooseStartupWorkspace = (folderPath: string, name?: string) => {
    setWorkspaceSet(adoptWorkspace(createWorkspaceForFolder(folderPath, name)));
    setNeedsWorkspaceChoice(false);
    audioEngine.playSound('door', 2);
  };

  /** Esc at the picker: keep the HOME placeholder and open it, as before. */
  const dismissStartupChoice = () => setNeedsWorkspaceChoice(false);
```

Add to the returned object, next to `handleOpenWorkspaceFolder`:

```ts
    needsWorkspaceChoice,
    chooseStartupWorkspace,
    dismissStartupChoice,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hooks/useWorkspaceSet.test.ts src/core/sessionStore.test.ts src/core/workspaceSet.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useWorkspaceSet.ts src/hooks/useWorkspaceSet.test.ts
git commit -m "feat(startup): owe a workspace choice before the first spawn"
```

---

### Task 4: Ask at startup, and spawn nothing until answered

`App` already owns the single path to the daemon (`App.tsx:98`) and already renders `WorkspaceModal`. Both learn about the gate; no new component, no new binding.

**Files:**
- Modify: `src/App.tsx:45-64` (destructure), `:98-107` (bind effect), `:410-415` (modal)

**Interfaces:**
- Consumes: `needsWorkspaceChoice`, `chooseStartupWorkspace`, `dismissStartupChoice` (Task 3); `WorkspaceModal`'s existing `isOpen` / `onClose` / `onSelectWorkspace` props.
- Produces: nothing further.

- [ ] **Step 1: Add the gate to the destructured hook result**

In the `useWorkspaceSet(telemetry)` destructuring, add beside `handleOpenWorkspaceFolder`:

```ts
    needsWorkspaceChoice,
    chooseStartupWorkspace,
    dismissStartupChoice,
```

- [ ] **Step 2: Gate the bind effect**

```ts
  useEffect(() => {
    if (!activeNode) return;
    if (activeNode.kind === 'scratchpad') return;
    // Nobody has said where the first terminal opens yet. Spawning HOME behind
    // the picker would leave a shell running in a folder no one chose, and the
    // chosen folder would then be the second session rather than the first.
    if (needsWorkspaceChoice) return;
    // Spawn is attach-or-create, so a restored id must not reach it until the
    // daemon has said whether it still holds that session. It did before, and
    // a cold start against an empty daemon created a fresh shell under the
    // stored id — cached scrollback with a brand new process behind it.
    if (bindingFor(activeNode.id) !== 'ready') return;
    ptyClient.ensureSession(activeNode.id, activeNode.cwd);
  }, [activeNode?.id, activeNode?.kind, activeNode?.cwd, bindingFor, needsWorkspaceChoice]);
```

- [ ] **Step 3: Open the picker on the gate**

Replace the `WorkspaceModal` element. The startup case adopts the folder; `Ctrl+Shift+O` keeps adding one beside the current workspace. `WorkspaceModal` calls `onSelectWorkspace` and then `onClose`, so `onClose` must tolerate being called once the choice is already made — `dismissStartupChoice` only clears a flag, so it does.

```tsx
      {/* Workspace Folder Picker Modal. On a run with nothing to restore this
          opens itself: the first terminal belongs in a folder someone chose,
          and Esc still means HOME. */}
      <WorkspaceModal
        isOpen={isWorkspaceModalOpen || needsWorkspaceChoice}
        onClose={() => {
          if (needsWorkspaceChoice) dismissStartupChoice();
          setIsWorkspaceModalOpen(false);
        }}
        onSelectWorkspace={(path, name) => {
          if (needsWorkspaceChoice) chooseStartupWorkspace(path, name);
          else handleOpenWorkspaceFolder(path, name);
        }}
      />
```

- [ ] **Step 4: Run the full gate**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(startup): ask for a workspace before opening the first terminal"
```

---

### Task 5: Verify and document

**Files:**
- Modify: `README.md` (the startup behaviour, if it describes first launch)
- Verify: whole repo

- [ ] **Step 1: Run the full verification gate**

Run: `npm run agent:verify`
Expected: PASS. `hud:check` and the cargo suites are untouched by this change; if they fail, the failure is environmental and must be reported as such, not worked around.

- [ ] **Step 2: Check the docs for a claim this change makes false**

Run: `grep -rn "first launch\|on startup\|HOME workspace" README.md AGENTS.md docs/README.md`
Update any sentence that describes the old silent HOME start. If none exists, add one line to the README's quickstart describing the first-run picker and that Esc opens HOME.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: describe the first-run workspace picker"
```

- [ ] **Step 4: Open the pull request**

The body states what changed, the bug found on the way, and both the automated
gate and the manual checks below — reviewers should not have to reconstruct
either:

```bash
git push -u origin feat/startup-workspace-prompt
gh pr create --base main \
  --title "feat(startup): ask which folder the first terminal opens in" \
  --body-file .artifacts/pr-body.md
```

---

## Manual verification (not automated)

The picker's own behaviour is covered by its existing suites; what this change adds and no test asserts is the composition. Before opening the PR, with `npm run dev` and the daemon running, in a browser profile with no Doom Term storage:

1. Launch → the picker is on screen, and no shell has spawned behind it (the plate shows no session activity).
2. Pick a folder → one session opens in it, and it is session 1. There is no second session at HOME.
3. Relaunch → no picker; the workspace is restored.
4. Clear storage, relaunch, press Esc → a live shell at HOME, not `SNAPSHOT · Terminal 1`.
5. `Ctrl+Shift+O` after all of the above still *adds* a workspace rather than replacing one.
