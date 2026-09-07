# Beta readiness audit

Audit started from origin/main `ec22a2a` on 2026-09-06; continued 2026-09-07.
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
  Rust dependency advisory review is still pending.

## MVP evidence and remaining probes

| Capability | Current evidence | Outstanding validation or issue |
| --- | --- | --- |
| Attention queue | Unit coverage; exact-pane hook routing reviewed and repaired | Cross-workspace presentation and activation still need runtime coverage |
| Notifications | Pure transition policy tested; browser toggle now reflects permission | Native `notify-send` path does not route clicks to sessions |
| Session switcher | Browser keyboard/filter smoke and unit tests | Multi-workspace discovery/activation needs completion |
| Clipboard and pass-through | Unit coverage | Real bracketed paste, Ctrl+C/Z/D, Unicode and TUIs need deeper runtime probes; Ctrl+F contradicts the universal pass-through claim |
| Turn navigation | Prompt-shape heuristics covered by tests | Real supported agent sessions and unsupported-agent behavior need review |
| Quick select | Extraction and component tests | Browser copy/insert flow pending |
| Binary splits | Geometry/component tests | Real resize, reload and asymmetric layouts pending |
| Focus and zoom | Geometry/component tests | Browser focus ownership and mounted sibling checks pending |
| Park versus kill | Close policy tested; reconnected exit delivery fixed | OSC 133 B currently clears idle-prompt state; park/recovery runtime pending |
| Durable recovery | tmux discovery and reconciliation tests | Reset plus bounded replay can lose history; replay ordering and restart fidelity need architectural repair |

## Other confirmed follow-up work

- Predictable runtime script/config paths follow symlinks before chmod when
  falling back to a shared temporary directory.
- Transcript hints use `(agent, cwd)` instead of pane identity, so two instances
  of the same agent in one repository can borrow each other's telemetry.
- HUD shell metrics show invented limits, and container markers are insufficient
  evidence for a “FULL” sandbox claim.
- The desktop check exits zero for missing libraries. The UI verifier skips an
  unreachable server and still prints success. CI omits backend tests, HUD pixel
  comparison, and actual browser interaction tests.
- Rust's application lockfile is ignored, so dependency resolution is not pinned.
- The hook installer treats malformed existing JSON as empty configuration and
  can overwrite other tools' settings.
- At 800 pixels wide the fixed-scale HUD clips controls; the declared desktop
  minimum width currently permits this.

## Trust boundary references

WebSocket origin checking follows [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455):
loopback binding alone does not authenticate browser scripts. Tauri's
[CSP guidance](https://v2.tauri.app/security/csp/) remains relevant to desktop
hardening; the current application configuration has no CSP.
