# Beta readiness audit

Audit started from origin/main `ec22a2a` on 2026-09-06; continued through 2026-09-08.
This is a working evidence ledger, not a release certification.

## Current verdict

Not ready to depend on as a primary work terminal yet. The basic shell, layout,
and command palette work, and the repository has substantial regression coverage.
However, reconnect history fidelity, telemetry attribution, native notification
routing, and several security and verification gaps need more work.

## Confirmed repairs in this audit

- The daemon rejects foreign/opaque browser origins and unexpected WebSocket
  Host headers, handles fragmented upgrades, and rejects browser hook POSTs.
  Configured `DOOM_AUTH_TOKEN` now gates commands and retained hook delivery.
  The frontend authenticates before binding sessions, with a transient token
  input when required. Tokens remain in window memory, never local storage.
- Remote binds are refused. This is a local terminal protocol without TLS.
  Native local clients without Origin remain trusted when no token is configured;
  use an access token on machines with other untrusted local users.
- Reconnect binds all explicitly bound panes, including background and parked
  panes. Process-exit callbacks move to the new connection with output callbacks.
- PTY and agent events update the owning workspace. Late telemetry updates its
  own session metadata without overwriting the foreground workspace's HUD.
- Saved YOLO preferences no longer type Enter into a potentially different
  process. Automatic approval is visibly unavailable because the existing hook
  protocol does not identify a verifiable prompt or approval response. Optional
  review banners open the agent terminal and do not fabricate approval success.
- Sound and notification controls share application state. The browser notification
  chip reflects permission as well as the saved preference.
- Worktree creation uses a correlated daemon request and Git argv, starts from
  current HEAD, and opens the new sibling checkout only after Git succeeds.
  Errors remain visible; existing branches/checkouts are never forced or removed.
- Removed the misleading “Spawn AI Agent Session” action, which only spawned
  another default shell. Installed agents can still be launched normally inside
  a terminal and detected by foreground process inspection.
- Unit tests cannot accidentally connect to a developer's live PTY daemon.
- Generated shell scripts and tmux configuration use a newly-created 0700
  directory and atomic 0600 files, avoiding predictable-path symlink writes.
- Hook installation validates every existing config before any write, rejects
  malformed/unsupported data, preserves foreign groups, quotes shell paths, and
  atomically replaces complete configurations with a first-change backup.
- Attention, switcher search, and notification selection include all workspaces.
  Session selection updates its owning workspace. Direct-jump numbers are unique
  across workspaces, including a migration for duplicate stored numbers.
- OSC 133 B preserves idle prompt state; only C starts execution. Explicit pane
  trees override legacy layout names, fixing splits collapsing on pane selection.
- Scrollback search uses Ctrl+Shift+F; plain Ctrl+F reaches the child process.
- HUD environment markers no longer claim a verified sandbox; review mode no
  longer claims automatic approval. Shell counter limits remain unknown.
- The desktop minimum width is 960. HiDPI uses 2x instead of 3x when needed
  to fit; narrower browser windows can scroll the plate with keyboard or pointer.
  Canvas drawing and hit testing use the same integer scale.
- Desktop production CSP restricts scripts/assets to local sources and permits
  only Tauri IPC and the loopback daemon for connections. Development CSP permits
  Vite's refresh preamble and HMR. The dev server binds loopback by default.
- Rust dependencies are pinned in the root Cargo.lock. Desktop checks use a
  distinct nonzero environment-block exit. CI now includes backend tests, HUD
  pixel comparison, and real production-bundle browser interactions.
- Claude/Codex transcript hints are scoped to agent, cwd, exact pane, and the
  Linux foreground PID plus kernel start ticks. Another same-agent pane or a
  replacement foreground process cannot reuse the reading. Directory scans are
  diagnostic-only; absent attribution renders unknown. Hint retention is capped
  at 256 entries and expires after 30 minutes.
- Transcript readers reject non-regular files without blocking on FIFO opens.
  Missing/malformed token accounting is unknown; overflowing totals are rejected.
- Switching panes withholds the old pane's model, context, rate, and environment
  while awaiting telemetry. New terminals use their target group's directory,
  not a stale HUD value. Creating a normal terminal preserves existing sibling
  panes; a refused last-workspace close does not kill its sessions.
- Hook deadlines now include an unclosed stdin pipe, cap payloads at 64 KiB,
  preserve trailing newlines, and always return zero. Curl configuration and
  inherited proxies cannot redirect hook payloads. Without GNU timeout/gtimeout,
  the hook skips posting. These repository changes do not rewrite installed user
  hooks automatically; rerun the additive installer to deploy the updated script.
- Ctrl+C and Ctrl+Z no longer combine control-byte input with an out-of-band
  process-group signal. Raw-mode applications receive the byte; cooked terminals
  retain their line-discipline behavior. The palette now calls this “Send Ctrl+C”
  instead of promising an unconditional SIGINT.
- Clipboard CR/CRLF becomes LF before multiline bracketing. Embedded escape and
  other control bytes are removed (tab and LF remain). A real-browser regression
  reproduced CR paste executing its first command before Enter, and passes with
  the initial fix. Further probing disproved frontend-only mode checks: tmux
  enables its outer mode even while its child disables paste support.
- Clipboard now uses an authenticated, correlated Paste/PasteResult exchange.
  The direct PTY observes child mode; tmux admits and delivers in its command
  queue using the exact pane's mode. Multiline input is refused when unsupported.
  Requests are capped at 1 MiB, never queued/replayed, and time out with an unknown
  delivery outcome. Clipboard access failures, stale reads, and daemon refusals
  have visible handling. Tmux buffers use random names and stdin payloads, with
  bounded helper I/O and cleanup that preserves unrelated buffers.
- Quick-select insertion restores terminal keyboard focus. First spawn preserves
  a grid measured before session binding. Split dividers retain their 1px bevel
  but have a usable transparent pointer target; real dragging updates child size.
- Rendered terminal rows now use 17px line boxes, matching the integer PTY row
  calculation. The former 17.875px line height accumulated 37px of overflow and
  scrolled an editor's first row out of view. A real-browser viewport-containment
  regression reproduces that failure and passes with the fix.

## Evidence so far

- Node tests: 86 passing; Vitest: 438 passing across 53 files at the first repair
  checkpoint. Further changes require fresh verification.
- Rust: 58 PTY tests and 76 backend tests passed; three live-account probes are
  deliberately ignored. New network tests exercise actual loopback sockets.
- Frontend typecheck and production build passed. HUD reference comparison:
  15,360 pixels compared, zero mismatches.
- Tauri `cargo check --all-targets` passed in the existing `doom-tauri` development
  container. The host lacks dbus/GTK/WebKit development libraries. This proves
  compilation, not desktop runtime or packaging correctness.
- Chromium/Playwright at `http://127.0.0.1:1420`, with the WebSocket redirected
  only in the test context to an isolated daemon on port 1521: first-run folder
  picker, real shell command result (separate from its echo), palette navigation,
  settings dialog, and disabled automatic approval verified without console
  errors. Captured 1280×840 and 800×600 screenshots outside the repository.
- `npm audit`: no reported vulnerabilities in the installed dependency graph.
  `cargo audit` reports zero vulnerability-class advisories and 18 warnings:
  17 unmaintained dependencies and GLib VariantStrIter unsoundness
  ([RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429)). These
  warnings are not a clean dependency-security bill of health.
- Second checkpoint verification: 95 Node tests and 445 Vitest tests passed;
  Rust 58 unit + 1 integration PTY tests and 76 backend tests passed (three
  live probes ignored). Native Tauri
  all-target compilation passed with CSP in the existing development container.
- The maintained `npm run test:ui` now builds the production bundle, applies
  the desktop CSP (substituting only the disposable daemon port), and exercises
  startup, real shell output, Unicode, Ctrl+C, palette/settings, splits and
  zoom restoration, and narrow-viewport keyboard scrolling. Missing browser/server
  is a failure. Each run uses its own
  temporary runtime/tmux directory, stops its own processes, and retains
  screenshots outside the repository.
- Third checkpoint verification: 101 Node tests; 449 Vitest tests; 58 PTY unit
  tests, 1 PTY integration test, and 83 backend tests passed (3 live probes ignored).
  Typecheck, production build, HUD pixel comparison, and native all-target Tauri
  compilation passed. Real HTTP hooks and disposable agent-named PTY processes
  reproduce same-directory and same-pane-restart telemetry attribution cases.
- The production-CSP browser smoke additionally verifies new sessions preserve
  splits, open in the selected workspace, and can be activated from another
  workspace's attention row. Screenshots were inspected; browser console and
  page-error collectors were empty. These are not real vendor-agent sessions.
- Follow-up palette regression: a stationary pointer generated mouse-enter when
  the palette opened underneath it, stealing the initial attention-first keyboard
  selection. Pointer movement now changes selection; appearance alone does not.
  The component regression and real-browser attention-selection assertion passed.
  Fresh follow-up verification: all 450 Vitest tests and the production build pass.
- Input-safety checkpoint: 101 Node tests and 452 Vitest tests pass; typecheck,
  production build, and the zero-mismatch HUD comparison pass. Rust passes 58 PTY
  unit tests, 2 PTY integration tests, and 83 backend tests (3 live probes ignored).
  The new raw-mode integration fixture rejects forced Ctrl+C/Z signals and checks
  the exact C/Z/D bytes. The Chromium smoke verifies CR paste waits for Enter in
  explicitly enabled Bash bracketed-paste mode, nested-shell Ctrl+D, and cooked
  Ctrl+C. HTTP/browser tests require permission to launch processes and bind local
  sockets in restricted sandboxes. Changed Rust files pass rustfmt; the workspace
  formatting check still finds pre-existing differences in unrelated files.

## MVP evidence and remaining probes

| Capability | Current evidence | Outstanding validation or issue |
| --- | --- | --- |
| Attention queue | Exact-pane hook routing and cross-workspace presentation/activation regression tests | Background panes after cold reload still need binding coverage |
| Notifications | Pure transition policy tested; browser toggle now reflects permission | Native `notify-send` path does not route clicks to sessions |
| Session switcher | Browser keyboard/filter smoke and multi-workspace attention activation; unique slot and stationary-pointer regression tests | Larger-session-count keyboard/scroll stress coverage remains |
| Clipboard and pass-through | Real CR/LF refusal with Bash mode off; CR paste waits for Enter with mode on; direct/tmux literal byte tests; stale-read and protocol lifecycle tests; cooked Ctrl+Z/fg/Ctrl+C and Ctrl+D | Nested multiplexers and unobserved process replacement are not certified; additional TUI keyboard behavior remains |
| Turn navigation | Prompt-shape heuristics covered by tests | Real supported agent sessions and unsupported-agent behavior need review |
| Quick select | Real clipboard copy, insertion without submission, and restored-focus browser checks | Multi-letter labels and large target lists remain to audit |
| Binary splits | Geometry/component tests, live two-pane I/O, divider drag with actual stty size change, and selection/new-terminal regressions | Reload and asymmetric-layout fidelity remain |
| Focus and zoom | Browser zoom/unzoom verifies visibility and mounted sibling counts | Spatial focus and labels need deeper browser probes |
| Park versus kill | Close policy, OSC 133 idle lifecycle and reconnected exit delivery tested | Park/recovery runtime pending |
| Durable recovery | tmux discovery and reconciliation tests | Reset plus bounded replay can lose history; replay ordering and restart fidelity need architectural repair |

## Other confirmed follow-up work

- Non-Linux transcript process attribution is unavailable; context readings stay
  unknown there. Hook attribution is sampled at receipt; delayed hooks spanning
  a process replacement and account overrides need deeper identity validation.
- Filesystem/Git telemetry work still runs synchronously in the request path;
  regular-file validation does not bound slow filesystem or subprocess latency.
- Native runtime/packaging and dependency-maintenance warnings remain to assess.
- First-row editor clipping found during screenshot review is repaired and tested
  for actual viewport containment, not just DOM text. Horizontal cell alignment,
  additional fonts/viewports, function keys, and IME remain to audit.

## Child-checked paste checkpoint (2026-09-08)

- Final checkpoint verification: 101 Node tests,
  475 Vitest tests (55 files), 64 PTY unit tests, 5 PTY integration tests, and 84
  backend tests pass; three live-account probes remain ignored. Typecheck,
  production build, HUD comparison (15,360 pixels, zero mismatches), and native
  Tauri all-target compilation pass. The final refinement verifies that typing
  during an in-flight request does not suppress its refusal notice.
- Chromium production-CSP smoke passes at 1280×840, 960×840, and 800×600 on
  `http://127.0.0.1:1420` with an isolated ephemeral-port daemon. Both CR and LF
  clipboard requests into unsupported Bash insert nothing; supported CR paste
  waits for Enter. The same run verifies job control, quick-select, editor file
  save, live split resizing, zoom, settings, and cross-workspace attention.
  Page identity, meaningful content, absent framework overlays, and empty
  console/page-error collectors are checked. Screenshots were inspected outside
  the repository; editor clipping found here was repaired in the follow-up below.
- The Browser plugin is unavailable; this uses the maintained Playwright runner.
  The build still reports a >500 kB main chunk. Existing jsdom canvas/localStorage
  diagnostics and the deliberate corrupt-storage diagnostic remain in unit output.
  Modified Rust files pass rustfmt; unrelated workspace formatting is not claimed.

### Editor geometry follow-up

The added Chromium containment assertion failed with `rowTop=-24`,
`rowBottom=-6.125`, and viewport top `1`: the first editor line was entirely
above the visible terminal. With whole-pixel line boxes, the same full browser
suite passes and screenshot inspection shows the typed first line and editor
status row together. This closes the observed vertical clipping defect, not
every remaining full-screen terminal compatibility question.

## Trust boundary references

WebSocket origin checking follows [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455):
loopback binding alone does not authenticate browser scripts. Tauri's
[CSP guidance](https://v2.tauri.app/security/csp/) informed the desktop policy.

## Running browser verification

Install Chromium once with `npx playwright install chromium`, then run
`npm run test:ui` with port 1420 free. CI installs Chromium's system dependencies
too. Browser plugin not available in this audit; regular Playwright was used.
This is a smoke suite, not a claim that every MVP scenario has passed.
