# UI Best-Practices Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Doom Term's transient UI keyboard-complete, accessible, and behaviorally consistent with world-class command-driven desktop interfaces.

**Architecture:** A focused `useDialogFocus` hook owns modal focus entry, containment, and restoration, while the existing modal keyboard stack continues to protect the PTY. The command palette remains the central master-detail surface, gains standard combobox/listbox semantics, and sends typed `ViewActionRequest` values through App to the active terminal so every advertised action executes exactly once.

**Tech Stack:** React 19, TypeScript 5.7, Vitest, Testing Library, Tailwind utility classes, project-native material CSS

**Spec:** `docs/superpowers/specs/2026-09-05-ui-best-practices-alignment-design.md`

## Global Constraints

- Preserve plain Ctrl-letter pass-through except the documented view-local `Ctrl+F` search behavior.
- Preserve the status plate as the only persistent chrome.
- Use only Plate, Recess, 1px bevel pairs, and Ink; add no radius, blur, glow, shadow, or new state color.
- Missing telemetry and durability remain `--`; never infer a value.
- Add no runtime dependency or icon package.
- Keep the existing master-detail command palette and attention-first session order.
- Every production behavior change begins with a failing automated test.

---

### Task 1: Shared transient-dialog focus and keyboard ownership

**Files:**
- Create: `src/hooks/useDialogFocus.ts`
- Create: `src/hooks/useDialogFocus.test.tsx`
- Modify: `src/core/modalKeyboard.ts`
- Modify: `src/components/ModalKeyboardOwnership.test.tsx`

**Interfaces:**
- Produces: `useDialogFocus<T extends HTMLElement>(isOpen: boolean, initialFocusRef?: RefObject<HTMLElement | null>): RefObject<T | null>`
- Produces: `useModalKeys(handler: ModalKeyHandler, rootRef?: RefObject<HTMLElement | null>): void`
- Preserves: `pushModalKeyboardOwner(handler)` and unconditional PTY protection for callers without a root element.

- [ ] **Step 1: Write failing focus-lifecycle tests**

Add a small fixture to `useDialogFocus.test.tsx` with an outside trigger, a
dialog container, and two buttons. Assert initial focus lands on the requested
button, forward Tab on the final button wraps to the first, Shift+Tab on the
first wraps to the final button, and unmounting the dialog restores the trigger:

```tsx
function Fixture({ open }: { open: boolean }) {
  const firstRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogFocus<HTMLDivElement>(open, firstRef);
  return open ? (
    <div ref={dialogRef} role="dialog" tabIndex={-1}>
      <button ref={firstRef}>FIRST</button>
      <button>LAST</button>
    </div>
  ) : null;
}
```

Use `fireEvent.keyDown(last, { key: 'Tab' })` and
`fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })` for the two explicit
wrap boundaries.

- [ ] **Step 2: Run the focus tests and verify red**

Run: `npx vitest run src/hooks/useDialogFocus.test.tsx`

Expected: FAIL because `useDialogFocus` does not exist.

- [ ] **Step 3: Implement the minimal focus lifecycle**

In `useDialogFocus.ts`, use `useLayoutEffect` to save the active `HTMLElement`,
focus `initialFocusRef.current` or the first focusable descendant or the dialog
container, register a capture-phase Tab handler, and restore the saved element
only when `isConnected`:

```ts
const FOCUSABLE = [
  'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  'a[href]', '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useDialogFocus<T extends HTMLElement>(
  isOpen: boolean,
  initialFocusRef?: RefObject<HTMLElement | null>,
): RefObject<T | null> {
  const dialogRef = useRef<T>(null);
  useLayoutEffect(() => {
    if (!isOpen || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement : null;
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
      .filter((item) => !item.hidden && item.tabIndex >= 0);
    (initialFocusRef?.current ?? focusable()[0] ?? dialog).focus();
    const contain = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) { event.preventDefault(); dialog.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', contain, true);
    return () => {
      document.removeEventListener('keydown', contain, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [isOpen, initialFocusRef]);
  return dialogRef;
}
```

- [ ] **Step 4: Write failing modal-owner tests for inside versus outside keys**

Extend `ModalKeyboardOwnership.test.tsx` with a focusable PARK button. Assert Tab
from that button is not propagation-stopped, Space reaches the button's click
behavior, and an unrecognized key dispatched from the underlying terminal is
still stopped. Preserve the pane-label tests as proof that callers without a
root retain unconditional ownership.

- [ ] **Step 5: Run the modal-owner tests and verify red**

Run: `npx vitest run src/components/ModalKeyboardOwnership.test.tsx`

Expected: FAIL because `useModalKeys` cannot distinguish keys originating
inside the owning surface.

- [ ] **Step 6: Extend modal ownership with an optional root**

Store owners as `{ handler, rootRef }`. In the capture listener, invoke the
top handler first, then stop propagation when the handler called
`preventDefault`, when no root was supplied, or when the event target is not a
descendant of `rootRef.current`. Pass no root from `PaneSelectOverlay`, keeping
its behavior unchanged.

- [ ] **Step 7: Run focused tests and commit**

Run:
`npx vitest run src/hooks/useDialogFocus.test.tsx src/components/ModalKeyboardOwnership.test.tsx`

Expected: PASS.

Commit:

```bash
git add src/hooks/useDialogFocus.ts src/hooks/useDialogFocus.test.tsx src/core/modalKeyboard.ts src/components/ModalKeyboardOwnership.test.tsx
git commit -m "feat(ui): add transient dialog focus lifecycle"
```

### Task 2: Command palette semantics and navigation

**Files:**
- Modify: `src/components/CommandPalette.tsx`
- Modify: `src/components/CommandPalette.test.tsx`
- Modify: `src/components/ArchitecturalComponents.test.tsx`

**Interfaces:**
- Consumes: `useDialogFocus<HTMLDivElement>(isOpen, inputRef)` from Task 1.
- Preserves: `CommandPaletteAction`, `onRenameSession`, fuzzy scoring, selected-id stability, and the master-detail preview.
- Produces: input `role="combobox"` controlling `#command-palette-results`, options identified as `command-palette-option-${index}`.

- [ ] **Step 1: Write failing command-palette contract tests**

Add tests that assert:

```tsx
const dialog = screen.getByRole('dialog', { name: 'Command palette' });
const search = screen.getByRole('combobox', { name: 'Search commands and sessions' });
const list = screen.getByRole('listbox', { name: 'Commands and sessions' });
expect(dialog.getAttribute('aria-modal')).toBe('true');
expect(search.getAttribute('aria-controls')).toBe(list.id);
expect(search.getAttribute('aria-activedescendant')).toBe(
  screen.getAllByRole('option')[0].id,
);
```

Also assert that actual action categories `RECOVERY`, `NAVIGATION`, `AGENT`,
`NOTES`, and `AUDIO` appear as filter buttons; End selects the final option;
Home returns to the first; changing the query announces `1 RESULT`; the first
Escape clears a non-empty query without calling `onClose`; and the second
Escape calls `onClose`.

- [ ] **Step 2: Run palette tests and verify red**

Run:
`npx vitest run src/components/CommandPalette.test.tsx src/components/ArchitecturalComponents.test.tsx`

Expected: FAIL because the dialog, combobox/listbox roles, dynamic filters, and
layered Escape behavior are absent.

- [ ] **Step 3: Implement semantic search and dynamic filters**

Replace the static category list with a stable derivation:

```ts
const categories = useMemo(
  () => ['ALL', ...new Set(actions.map((action) => action.category.toUpperCase()))],
  [actions],
);
```

Filter categories by exact case-insensitive equality. Attach `useDialogFocus`
to the panel, add the named dialog and explicit close button, and expose the
input/list relationship through `role`, `aria-controls`, `aria-expanded`,
`aria-autocomplete`, and `aria-activedescendant`. Render rows as
`div role="option" tabIndex={-1}` so options do not contain nested buttons.
Keep click and hover behavior.

- [ ] **Step 4: Implement complete list navigation and announcements**

Handle ArrowUp/ArrowDown with the existing wrap behavior, Home/End as absolute
movement, and Escape as:

```ts
if (e.key === 'Escape') {
  e.preventDefault();
  if (query) setQuery('');
  else onClose();
}
```

Keep a ref for the selected option and call
`scrollIntoView({ block: 'nearest' })` when `selectedId` or `selectedIndex`
changes. Add a visually present footer count and an `aria-live="polite"`
status string with singular/plural grammar.

- [ ] **Step 5: Run palette tests and commit**

Run:
`npx vitest run src/components/CommandPalette.test.tsx src/components/ArchitecturalComponents.test.tsx`

Expected: PASS.

Commit:

```bash
git add src/components/CommandPalette.tsx src/components/CommandPalette.test.tsx src/components/ArchitecturalComponents.test.tsx
git commit -m "feat(palette): align search navigation and semantics"
```

### Task 3: Execute every advertised view-local palette command

**Files:**
- Modify: `src/core/keymap.ts`
- Modify: `src/core/keymap.test.ts`
- Modify: `src/core/paletteActions.ts`
- Create: `src/core/paletteActions.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/RawTerminalView.tsx`
- Modify: `src/components/RawTerminalView.test.tsx`

**Interfaces:**
- Produces in `keymap.ts`: `ViewAction` including `searchScrollback`.
- Produces in `keymap.ts`: `interface ViewActionRequest { id: number; action: ViewAction }`.
- Adds to `PaletteContext`: `onViewAction: (action: ViewAction) => void`.
- Adds to `RawTerminalViewProps`: `viewActionRequest?: ViewActionRequest | null`.

- [ ] **Step 1: Write failing keymap and palette-action tests**

Assert `matchViewAction` maps Ctrl+F to `searchScrollback`. Build palette actions
with an `onViewAction` spy, find the actions by id, run them, and assert this
exact map:

```ts
const routes = {
  'quick-select': 'quickSelect',
  'copy-turn': 'copyTurn',
  'previous-turn': 'previousTurn',
  'next-turn': 'nextTurn',
  'search-scrollback': 'searchScrollback',
  'copy-selection': 'copySelection',
  'paste-clipboard': 'pasteClipboard',
} as const;
```

- [ ] **Step 2: Run keymap/action tests and verify red**

Run: `npx vitest run src/core/keymap.test.ts src/core/paletteActions.test.ts`

Expected: FAIL because search is not a typed view action and most palette rows
have inert `run` functions.

- [ ] **Step 3: Add the typed request contract and real palette callbacks**

Add `searchScrollback` to `ViewAction`, give the Ctrl+F entry in
`VIEW_BINDINGS` a chord and action, and export `ViewActionRequest`. Require
`onViewAction` in `PaletteContext`; replace each view-local `run` body with the
corresponding `onViewAction(...)` call. Keep SIGINT, EOF, notifications,
transcript copy, and audio on their existing direct callbacks.

- [ ] **Step 4: Write failing active-pane delivery tests**

In `RawTerminalView.test.tsx`, rerender an active terminal with
`viewActionRequest={{ id: 1, action: 'searchScrollback' }}` and assert the
search readout appears. Rerender with the same id and assert the action is not
repeated. Render an inactive terminal with a new request and assert it ignores
the request. Add a safe-paste case that mocks `navigator.clipboard.readText`
and expects one bracketed `onWrite` call.

- [ ] **Step 5: Run terminal tests and verify red**

Run: `npx vitest run src/components/RawTerminalView.test.tsx`

Expected: FAIL because `RawTerminalView` has no request prop.

- [ ] **Step 6: Refactor view action execution and connect App**

Extract the existing branch beginning at `if (viewAction ===
'copySelection')` into a `runViewAction(action: ViewAction)` callback and call
it from both keyboard handling and a request effect. The effect checks
`isActive`, compares the request id with `lastHandledViewActionRef`, records the
id before execution, and runs once.

In App, keep:

```ts
const nextViewActionId = useRef(0);
const [viewActionRequest, setViewActionRequest] = useState<ViewActionRequest | null>(null);
const requestViewAction = (action: ViewAction) => {
  nextViewActionId.current += 1;
  setViewActionRequest({ id: nextViewActionId.current, action });
};
```

Pass `requestViewAction` into `buildPaletteActions` and pass the request only to
the active `RawTerminalView`.

- [ ] **Step 7: Run focused tests and commit**

Run:
`npx vitest run src/core/keymap.test.ts src/core/paletteActions.test.ts src/components/RawTerminalView.test.tsx src/components/CommandPalette.test.tsx`

Expected: PASS.

Commit:

```bash
git add src/core/keymap.ts src/core/keymap.test.ts src/core/paletteActions.ts src/core/paletteActions.test.ts src/App.tsx src/components/RawTerminalView.tsx src/components/RawTerminalView.test.tsx
git commit -m "fix(palette): execute terminal-local commands"
```

### Task 4: Apply the transient-surface contract to every modal in scope

**Files:**
- Modify: `src/components/WorkspaceModal.tsx`
- Create: `src/components/WorkspaceModal.test.tsx`
- Modify: `src/components/RenameSessionModal.tsx`
- Modify: `src/components/PermissionModeModal.tsx`
- Modify: `src/components/CloseSessionPrompt.tsx`
- Create: `src/components/TransientSurfaceSemantics.test.tsx`
- Modify: `src/components/ModalKeyboardOwnership.test.tsx`

**Interfaces:**
- Consumes: `useDialogFocus` and the root-aware `useModalKeys` from Task 1.
- Produces: workspace combobox controlling `#workspace-results`.
- Produces: permission `role="radiogroup"` with mode buttons exposing `aria-checked`.
- Preserves: existing callbacks, safe PARK default, workspace typed-path behavior, and permission persistence in App.

- [ ] **Step 1: Write failing semantic and focus tests**

In `TransientSurfaceSemantics.test.tsx`, assert rename and permission surfaces
are named modal dialogs; permission options are real buttons in a labelled
radiogroup; the current mode exposes `aria-checked="true"`; and PARK receives
initial focus in an `alertdialog`. Assert the permission surface captures Enter
from a focused underlying terminal and ordinary Tab from an option remains
available to the dialog.

In `WorkspaceModal.test.tsx`, mock `ptyClient.browseDirectory` with a resolved
listing and assert the named dialog contains a combobox controlling a listbox,
the selected option id matches `aria-activedescendant`, `aria-busy` changes
from true to false, and a rejected browse is announced with `role="alert"`.

- [ ] **Step 2: Run transient-surface tests and verify red**

Run:
`npx vitest run src/components/TransientSurfaceSemantics.test.tsx src/components/WorkspaceModal.test.tsx src/components/ModalKeyboardOwnership.test.tsx`

Expected: FAIL because roles, focus behavior, and semantic selection state are
absent.

- [ ] **Step 3: Upgrade workspace and rename surfaces**

Use `useDialogFocus` with each input. Add title ids, `role="dialog"`,
`aria-modal="true"`, and `aria-labelledby`. For Workspace, add combobox and
listbox attributes mirroring Task 2, option roles/ids, `aria-busy`, a polite
result-count status, `role="alert"` on load errors, and a labelled close button
in the header. Keep DOM focus in the input while arrow keys move
`aria-activedescendant`.

Remove `backdrop-blur-xs` and `shadow-2xl` from Workspace because they violate
the four-material contract; the existing plate and bevel remain its depth cue.

- [ ] **Step 4: Upgrade permission and close gates**

Give Permission a dialog ref from `useDialogFocus`, initially focus the current
mode button, pass the ref to `useModalKeys`, and replace option divs with
`button type="button" role="radio" aria-checked={isCurrent}`. Keep arrows as
selection preview, Enter as apply, Escape as dismiss, and pointer click as
apply.

Give CloseSessionPrompt an `alertdialog` ref, initially focus PARK, pass the ref
to `useModalKeys`, add `aria-pressed` to the previewed choice, and keep PARK as
the Enter default. The visible buttons remain the close mechanism required by
the dialog pattern.

- [ ] **Step 5: Run transient-surface tests and commit**

Run:
`npx vitest run src/components/TransientSurfaceSemantics.test.tsx src/components/WorkspaceModal.test.tsx src/components/ModalKeyboardOwnership.test.tsx src/components/CloseSessionPrompt.test.tsx`

Expected: PASS.

Commit:

```bash
git add src/components/WorkspaceModal.tsx src/components/WorkspaceModal.test.tsx src/components/RenameSessionModal.tsx src/components/PermissionModeModal.tsx src/components/CloseSessionPrompt.tsx src/components/TransientSurfaceSemantics.test.tsx src/components/ModalKeyboardOwnership.test.tsx
git commit -m "feat(ui): standardize transient surface behavior"
```

### Task 5: Hard focus treatment, conformance guard, and complete verification

**Files:**
- Modify: `src/styles/material.css`
- Modify: `src/styles/material.test.js`
- Modify: transient components touched in Tasks 2 and 4 to add `dt-focus-ring`.

**Interfaces:**
- Produces: `.dt-focus-ring:focus-visible`, a one-pixel hard outline using `var(--st-live)`.
- Produces: a source-level material test rejecting `rounded-*`, `shadow-*`, `blur-*`, and `drop-shadow-*` utilities in `src/`.

- [ ] **Step 1: Write failing material conformance tests**

Extend `material.test.js` to read all `.tsx` and `.css` files below `src/` and
assert the joined source contains none of:

```js
/\brounded(?:-|\b)/
/\bshadow(?:-|\b)/
/\b(?:backdrop-)?blur(?:-|\b)/
/\bdrop-shadow(?:-|\b)/
```

Also assert `material.css` contains a focus-visible rule with a `1px` outline
and no positive outline offset.

- [ ] **Step 2: Run material tests and verify red**

Run: `node --test src/styles/material.test.js`

Expected: FAIL until the focus rule exists; it also catches the Workspace blur
and shadow if Task 4 did not remove them.

- [ ] **Step 3: Add and apply the hard focus treatment**

Add:

```css
.dt-focus-ring:focus-visible {
  outline: 1px solid var(--st-live);
  outline-offset: -2px;
}
```

Apply `dt-focus-ring` to search inputs, category buttons, palette options,
close/cancel controls, workspace options, permission buttons, rename controls,
and PARK/KILL buttons. Retain component-specific selected treatments.

- [ ] **Step 4: Run frontend and material verification**

Run:

```bash
node --test src/styles/material.test.js
npm run typecheck
npm test
npm run build
npm run hud:check
```

Expected: all pass and the HUD diff reports zero changed pixels.

- [ ] **Step 5: Commit the focus and conformance work**

```bash
git add src/styles/material.css src/styles/material.test.js src/components/CommandPalette.tsx src/components/WorkspaceModal.tsx src/components/RenameSessionModal.tsx src/components/PermissionModeModal.tsx src/components/CloseSessionPrompt.tsx
git commit -m "style(ui): add hard focus visibility guard"
```

- [ ] **Step 6: Run repository-wide verification**

Run: `npm run agent:verify`

Expected: TypeScript, Node/Vitest, production build, HUD pixel diff, Cargo
check, and Cargo tests pass. `check:tauri` may report the documented
`ENVIRONMENT BLOCK` only when GTK/WebKit development packages are absent; a
compile failure is not acceptable.

- [ ] **Step 7: Run rendered desktop QA**

Start the Vite app, connect through the available browser tooling, and verify:

1. Ctrl+K opens with search focused and a visible selected row.
2. Arrow, Home, End, Enter, and layered Escape behavior match the tests.
3. A terminal-local palette command executes after the palette closes.
4. Workspace, permission, rename, and close surfaces contain focus and return
   it to the terminal.
5. No console error appears and narrow desktop windows retain usable controls.

Capture the browser/tooling availability and observed result in the PR body.

- [ ] **Step 8: Review the branch diff**

Run:

```bash
git diff --check main...HEAD
git status --short
git log --oneline main..HEAD
```

Expected: no whitespace errors, no uncommitted changes, and only the spec,
plan, tests, and focused transient-UI implementation appear.
