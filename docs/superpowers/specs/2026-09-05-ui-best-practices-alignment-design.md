# UI Best-Practices Alignment Design

Approved for uninterrupted execution on 2026-09-05. This design compares Doom
Term's current interface with established keyboard-first desktop products and
implements one focused, reviewable improvement set. It preserves the terminal
pass-through contract, the status plate as the only persistent chrome, the four
material system, zero radius, hard bevels, and measured-only telemetry.

## Decision

Implement a **transient-interaction foundation** centered on the command
palette, workspace picker, and modal gates. Do not restyle the product or add
persistent navigation.

Three approaches were considered:

1. **Aesthetic modernization.** This could improve initial polish, but it would
   imitate other products at the expense of Doom Term's identity and would not
   address keyboard or assistive-technology failures.
2. **Transient-interaction foundation (selected).** Make the existing command
   and modal surfaces predictable, semantic, focus-safe, and fully functional.
   This yields the largest usability improvement without changing the product
   topology.
3. **Full workflow redesign.** Rework session navigation, status, and terminal
   history together. This has the largest theoretical upside but repeats the
   recently completed Reformation work and is too broad for one reviewable PR.

## Benchmark findings

The comparison uses official product guidance rather than visual imitation.

| Reference | Transferable practice | Doom Term today | Decision |
|---|---|---|---|
| Linear | Contextual commands are grouped around the current object, and keyboard shortcuts remain discoverable in the menu. | Categories and shortcuts are visible, but several advertised terminal commands close the palette without doing anything. | Keep the category vocabulary and shortcut display; route every visible command to real behavior. |
| Raycast | Search keeps keyboard focus in one field, arrows move a visible selection, Enter runs the primary action, Escape backs out in layers, and action sections are discoverable. | Arrow and Enter behavior exists, but the search/list relationship is not exposed semantically, selection can move off-screen, and Escape always exits. | Adopt combobox/listbox semantics, selected-row visibility, and clear-then-close Escape behavior. |
| VS Code | Commands are clearly named, shortcuts are shown, and irrelevant commands are hidden instead of filling menus with disabled or inert entries. | Naming and shortcuts are strong; inert view-local commands violate the command contract. | Make the palette an authoritative executable surface and omit actions that cannot run in the current context. |
| Warp | A global palette brings sessions, actions, and terminal capabilities into one search surface while terminal-specific navigation remains keyboard driven. | Doom Term already follows this topology and adds valuable session preview. | Preserve the master-detail palette and terminal-first layout. |
| WAI-ARIA APG | Modal focus enters the dialog, remains contained, and returns to the invoker; editable pickers expose combobox, listbox, option, active-descendant, and result state. | Inputs receive delayed focus, focus is not trapped or restored, and dialog/list semantics are mostly absent. | Add one reusable focus lifecycle and apply standard roles/states to every transient chooser and gate in scope. |

Sources:

- [Linear contextual menus](https://linear.app/now/invisible-details)
- [Raycast Action Panel](https://manual.raycast.com/action-panel)
- [Raycast keyboard shortcuts](https://manual.raycast.com/keyboard-shortcuts)
- [VS Code command palette guidance](https://code.visualstudio.com/api/ux-guidelines/command-palette)
- [VS Code command visibility guidance](https://code.visualstudio.com/api/extension-guides/command)
- [Warp command palette](https://docs.warp.dev/terminal/command-palette)
- [WAI-ARIA modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [WAI-ARIA combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)

## Scope

### 1. Shared dialog focus lifecycle

Add a small React hook that captures the invoking element when a transient
surface opens, focuses the intended initial control before paint, contains Tab
and Shift+Tab within the surface, and restores focus when the surface closes.
The hook owns focus only. Existing component handlers continue to own their
domain keys and dismissal behavior.

Apply the hook and dialog semantics to:

- command palette;
- workspace picker;
- rename-session modal;
- permission-mode modal;
- park/kill prompt.

Each surface receives `role="dialog"` or `role="alertdialog"`,
`aria-modal="true"`, a programmatic name, and a visible close or cancel action.
The safe PARK action remains the initial choice in the destructive close gate.

The modal keyboard stack will accept an optional owning element. Keys from the
underlying terminal remain swallowed, while ordinary browser keyboard behavior
inside the focused surface—especially Tab and Space—can proceed. Pane-selection
mode keeps its current unconditional keyboard ownership.

### 2. Command palette as an authoritative command surface

Keep the current master-detail layout and attention-first session ordering.
Upgrade the search field to an editable combobox controlling a listbox:

- DOM focus stays in the search input while Up/Down, Home/End, and Enter operate
  the active option through `aria-activedescendant`;
- the active option is scrolled into view;
- result count and empty state are announced politely;
- category filters are derived from actual actions, so categories such as
  Recovery, Navigation, Agent, Notes, and Audio cannot silently disappear;
- Escape first clears a non-empty query, then closes the palette;
- list options expose selected and attention state without nesting interactive
  controls inside an option.

Every listed command must execute. Add an explicit request channel from App to
the active `RawTerminalView` for view-local actions such as search, safe paste,
turn navigation, copying, and quick select. Remove a command only when its
preconditions are absent; never leave a visible no-op.

### 3. Workspace and permission pickers

Expose the workspace field/list as a combobox and listbox with busy, error, and
active-option state. Keep typed absolute paths and recent workspaces intact.

Render permission modes as real buttons in a labelled selection group. Route
their Arrow, Enter, Escape, Tab, and Space behavior through the same modal
ownership/focus contract as the close gate. No permission policy changes are in
scope.

### 4. Visible focus

Add a hard, one-pixel focus-visible treatment using existing ink/state tokens.
No radius, blur, glow, new material, or additional color is introduced. Apply
it to the transient controls touched by this change.

## Data and control flow

```text
Ctrl+K -> App opens palette -> focus lifecycle captures terminal
       -> search input owns DOM focus
       -> aria-activedescendant points at selected option
       -> Enter runs CommandPaletteAction
       -> view-local action increments an App request serial
       -> active RawTerminalView executes the request once
       -> palette unmounts -> focus returns to the terminal
```

The request includes a monotonically increasing id, the target session id, and
the existing `ViewAction` union. `RawTerminalView` records the last handled id
so React rerenders cannot repeat clipboard, paste, or navigation effects, and
a later focus change cannot replay the command in another pane.

## Error and edge behavior

- A palette with zero results keeps focus in search, announces zero results,
  and does nothing on Enter.
- A selected option that disappears falls back to the first remaining option.
- If the invoking element was removed, close does not attempt to focus it.
- A modal with no focusable descendants focuses its dialog container.
- Workspace loading preserves the existing explicit loading and error states;
  neither is reported as an empty directory.
- A view-local request is ignored by inactive panes and handled exactly once by
  the active pane.
- Terminal-only actions are absent while a scratchpad owns the active pane.
- Unknown session durability remains `--`; this work does not infer safety.

## Testing

Follow red/green development for each behavior:

- hook tests: initial focus, Tab containment, Shift+Tab containment, restoration;
- command-palette tests: roles/states, dynamic categories, layered Escape,
  Home/End navigation, selected-row visibility, and live result state;
- command-routing tests: each formerly inert view-local action reaches the
  active terminal once and never reaches an inactive pane;
- modal tests: dialog naming, real controls, safe initial focus, and terminal
  isolation;
- workspace tests: combobox/listbox linkage plus busy/error state;
- material tests: focus treatment keeps zero radius and zero soft shadows.

Run the repository's full `npm run agent:verify` gate. Perform rendered desktop
QA against the palette, workspace picker, permission picker, rename modal, and
close gate. The 480px status-plate reference must remain pixel-identical.

## Explicit non-goals

- no tabs, sidebar, title bar, toolbar, toast system, or persistent help;
- no new runtime dependency or icon package;
- no terminal block model or shell-input editor;
- no change to plain Ctrl-letter pass-through;
- no change to permission execution semantics;
- no broad CSS rewrite or visual imitation of benchmark products;
- no mobile layout commitment for this desktop terminal manager.

## Follow-up backlog

Future PRs may evaluate user-configurable shortcuts, command frecency, a
dedicated shortcut reference opened from the palette, and reduced-density
palette layouts for narrow desktop windows. These are deliberately excluded
until the interaction foundation is measured in use.
