# Doom Term — Review Findings (Spec)

**Date:** 2026-08-28
**Method:** Live pass against `npm run dev` (:1420) + `npm run server` (:1421) driven through
Chrome DevTools MCP, cross-referenced against source and against the published design system.
**Baseline health:** `npm run build` clean; 87 frontend tests (79 vitest + 8 node:test) and
19 backend `cargo test` all green. Nothing below is a build or test failure — every defect
is invisible to the current suite.

## Authority documents

The design system is the authority for anything visual. Four published artifacts:

| Artifact | Governs |
|---|---|
| `claude.ai/code/artifact/0f2421b1-6be2-4b50-9ff1-e2e094154286` — *the surface above the plate* | Window structure, tab strip, rail, tool calls, diff, approval, palette, settings, the five states |
| `claude.ai/code/artifact/3074e8ac-a7e2-4672-8f5a-ca3505d23859` — *HUD, seven plates* | Plate geometry, slot meanings, agent marks. Recommendation: ship variation 02 (480×32 widescreen) |
| `claude.ai/code/artifact/b4893fe8-29e0-46df-807e-8de8cadd3b5d` — *Seven Directions* | Why the theme lives in pixels, not copy |
| `claude.ai/code/artifact/042af622-1b02-42ea-beff-00e3e389a21a` — *Terminal Output Fidelity* | The eight already-fixed emulator defects. Do not regress these. |

## Governing principles

1. **Every displayed datum must be observed, never invented.** A slot with no honest source
   shows `--`, not a plausible number.
2. **The Doom reference lives in the pixels, not the copy.** No game vocabulary in UI strings
   (no AMMO / HEALTH / ARMOR / E1M1 / marine / PHOBOS).
3. **Four materials, no fifth:** plate, recess, 1px bevel pair, ink. No border radius, no
   blurred shadow, integer plate scaling only.
4. **Colour carries state, never identity.** Five states, one colour each.
5. **Prefer deletion.** A feature that cannot be made honest should be removed, not dressed up.

---

## F1 — The Verification panel is fabricated and unsafe (CRITICAL)

`App.tsx:579` `handleOpenVerification` hardcodes `verdict: 'APPROVED'` and four lenses that
are *always* `status: 'passed'`, with invented evidence strings: *"29/29 tests passing; 100%
test coverage maintained"*, *"Rendering benchmarks pass; 60 FPS verified"*. Nothing is
measured. `RE-RUN ALL` only calls `audioEngine.playSound`.

Its primary action runs a hardcoded literal command:

```js
onApply={() => { executeFinalCommand('git apply patch.diff'); ... }}
```

`patch.diff` is never produced by any code path. So the panel asserts safety it never
checked, then wires that false confidence to a command that fails.

**Verified live:** opened the panel on a virgin session with zero commands run; all four
lenses read PASS.

**Required:** delete the feature outright.

## F2 — Agent identity and token telemetry are invented (CRITICAL)

`core/agentDetector.ts` decides an agent is running from `node.kind === 'agent'` or from
substring matches on the *tab title* and shell history. It then emits invented model strings
(`OPUS-4-6`, `O3-MINI`, `DEEPSEEK-R1`; Grok is routed to `modelKey: 'gpt-4o'`) and computes a
token count from a fabricated constant:

```ts
const baseSystemChars = 14000;               // "system prompt overhead" — invented
const metrics = TokenMeter.calculateTokens(totalInputChars + baseSystemChars, ...);
```

`credentials` is the literal `[true, true, false]` in three places. `isolation` is the literal
`'sandbox'`, which renders as `SANDBOX FULL` while the process runs unsandboxed on the host.

**Verified live:** Command Palette → *Spawn AI Agent Session* → the plate immediately read
`AGENT CLAUDE CODE · OPUS-4-6`, `CONTEXT 4%`, `USAGE 5%`, `IN 5/200 OUT 0/64 CAC 3/100 TOT
8/200`, `SANDBOX FULL` — on a tab where no command had ever been typed.

**The honest sources already exist and are already being ignored:**
- `backend/src/main.rs` `GetTelemetry` already probes real credentials (`SSH_AUTH_SOCK`,
  `~/.ssh/id_*`, `AWS_ACCESS_KEY_ID`, `~/.aws/credentials`, `~/.config/gcloud`,
  `git config --get user.signingkey`) and real branch (`git -C <cwd> rev-parse`).
- `App.tsx:330-331` then discards them: `isolation: prev.isolation || nextTele.isolation`
  never lets a truthy previous value be replaced.

**Required:** delete the invention; detect the agent from the PTY's real foreground process;
show `--` for anything genuinely unknowable.

## F3 — Three subsystems can never do anything (provably inert)

`links`, `tasks` and `messages` are initialised to `[]` in both workspace factories
(`sessionStore.ts:65-67`, `114-116`) and **written by no code path anywhere in the
repository** — verified by exhaustive grep. Consequently:

| Module | Lines | Reality |
|---|---|---|
| `core/contextGraph.ts` | 104 | Graph with permanently zero edges |
| `core/taskPipeline.ts` | 103 | Evaluates a permanently empty task list on every keystroke of output |
| `core/messageBus.ts` | 98 | Drains a permanently empty queue |

Additionally unreferenced by anything: `core/wadParser.ts` (209), `core/blockStore.ts` (72),
`types/wad.ts` (43), `hud/state.ts::estimateTokensFromBlocks` (37, a second copy of the fake
token maths), `backend/src/wad/mod.rs` (127), `src-tauri/src/wad/mod.rs` (172) and the
`parse_wad_file` command.

**Required:** delete. ~965 lines, recoverable from git.

## F4 — The startup banner advertises all of it

`sessionStore.ts:28` seeds every fresh workspace with a block claiming *"20 Architectural
Improvements from nodeterm & VelaTerm Active"*, a *"Worktree Tree"* deleted in this very
working tree, and the F3 subsystems as *"Ready"* / *"Armed"*. Rendered in five-colour rainbow
ANSI, violating the five-states-one-colour rule.

**Required:** delete. A new session shows the shell, nothing else.

## F5 — Top chrome does not follow the design system

The spec (*the surface above the plate*, §01) defines the entire top edge as **one tab strip**:
tabs are plate segments, the active tab is **pressed in — the bevel inverts**, there are **no
close buttons** ("a tiny ✕ on every tab is 2024 chrome"; close is middle-click and `⌘W`), and
path + branch are right-aligned in plate ink. There is no header row in the design at all.

Shipped instead (`App.tsx:827-878`, `TabBar.tsx`): a bespoke header row (hamburger, `DOOM TERM
v0.2.0` wordmark, `⚖ VERIFY`, `CTRL+P`), tabs as `<div>`s with a **raised** active state, and a
`×` on every tab once more than one exists.

**Required:** delete the header row; bring the strip to spec.

## F6 — Workspace picker: typed paths are decorative, responses are mismatched

`WorkspaceModal.tsx` promises *"type to filter or type full path"* but `inputQuery` is only
ever a substring filter over the currently-listed entries (`:117-119`). The `ACTION` row opens
`currentPath` — wherever you last browsed — regardless of what was typed.

**Verified live:** typed `/var/home/cleadmon/Projects/Doom Term`, pressed Enter, landed in
`/home/cleadmon`.

Compounding it, `ptyClient.browseDirectory` matches replies to requests by FIFO order
(`directoryListingResolvers.shift()`), with no request id; a `send()` while the socket is not
`OPEN` is dropped but still leaves its resolver queued, permanently offsetting every later
browse. `WorkspaceModal`'s effect also re-fires on `currentPath`, which `loadDirectory` itself
sets, issuing overlapping requests.

**Verified live:** after a type → clear → navigate sequence the picker showed zero folders and
zero recents for a directory that has both.

**Root cause of GitHub #4.**

## F7 — Opening a workspace destroys the previous one

`handleOpenWorkspaceFolder` (`App.tsx:442-453`) does `setWorkspace(newWs)` — whole-state
replacement. **Verified live:** switching folders discarded the first workspace's sessions and
scrollback; "Recent" reopens the path as a blank new workspace rather than restoring it.

GitHub #6 asks for folders to be selected from the filesystem and for *additional* workspaces
to repeat the process — i.e. to coexist.

## F8 — Terminal auto-numbering collides with renaming

`handleCreateNode` (`App.tsx:365-372`) derives the next index by regexing `/(\d+)$/` off
*every* existing title of that kind.

**Verified live:** renamed tab 1 to `deploy-2026`, pressed **+ NEW**, got **`Terminal 2027`**.

**Root cause of the second half of GitHub #3** (renaming itself now works).

## F9 — Two hand-mirrored Rust trees, already drifted

`backend/src/pty/` and `src-tauri/src/pty/` are maintained by hand. `demuxer.rs` is currently
byte-identical (491 lines each); `session.rs` differs only in transport. The new 500-event
`scrollback_ring` and its `Reattach` action exist **only in `backend/`**, so
`ptyClient.reattachSession()` silently does nothing in the shipped desktop app. Nothing in CI
checks that the trees agree.

## F10 — The Doom marine mugshot is back

`hud/plate.js:248-294` defines `MARKS.marine`, a pixel Doomguy face, aliased to
`doom`/`terminal`/`shell`/`bash`/`none` — so it is what a plain shell renders in the agent
well. This is the one thing the design system explicitly removed: the well holds *the active
AI agent*, and the theme is not supposed to speak in game vocabulary.

## F11 — The renderer's demo data leaks into production

`hud/plate.js` `DEFAULT_STATE` holds presentation placeholders (`context: '61%'`,
`agentName: 'CLAUDE CODE · OPUS 5'`, a populated fake token table) and `drawPlate` merges it
under every real state. Any field the app fails to supply therefore renders as convincing
fiction rather than as absent. `hud/state.ts::toPlateState` omits `table` entirely when there
is no data, so **the fake `IN 14/128` table is what shows**.

The same constant is what `tools/hud/cli.js` renders the committed reference PNG from, so it
cannot simply be blanked.

## F12 — No settings surface exists

`grep -rln "Settings" src/` returns nothing, though the design system fully specifies one
(§07: segmented plate-key toggles, filled-cell meters, plain-language labels, no save button).
Commit `b501422` claimed to "unify history, palette and settings into one panel" but only added
an audio-mute entry to the palette.

## F13 — Shell prompt duplication (GitHub #1) — unverified

`shell_integration.rs` wraps the user's existing `$PS1` in OSC 133 markers; it never shortens
it, so the shell still prints `user@host:/full/path$` alongside Doom Term's own path chrome.
However `onExecutionStart` already re-marks the block at `emu.mark()` on OSC 133;C, which
should exclude the echoed prompt from block output. **Not reproduced live this session** — the
issue screenshot predates the emulator rewrite. Must be tested before it is fixed.

---

## Out of scope / confirmed healthy

- The canvas plate renderer (`hud/plate.js`, `PLATE_480`) is the most spec-faithful part of the
  app: striation, bevel pairs, red numerals, `SANDBOX` as a tier name rather than a percentage,
  left-truncated branch names. Preserve it.
- `core/terminalEmulator.ts` and the OSC 133 / OSC 7 / query-response work are real, tested and
  load-bearing. Do not regress.
- `core/securityAnalyzer.ts` + `Approval.tsx` genuinely analyse each submitted command.
- `Scratchpad.tsx` genuinely works.
- `audioEngine.ts` is real; its internal sound names are not user-visible copy.
