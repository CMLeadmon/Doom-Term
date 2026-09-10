# Sequenced Recovery Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task-by-task, inline. The user explicitly prohibits subagents and has authorized work on main. Checkboxes record verified implementation, not intentions.

**Goal:** Implement safe attachment to surviving processes, exact warm stream continuation, and explicitly discontinuous bounded cold recovery without replaying input.

**Architecture:** A shared PTY journal owns ordered records and bounded retention. Authenticated connection-scoped ownership gates mutations; cursor delivery replaces callback rebinding. The frontend advances its cursor only after parsing and keeps recovered archives outside the live parser.

**Tech Stack:** Rust, parking_lot, serde, Tokio WebSocket transport, TypeScript, React, @xterm/headless, real tmux and Playwright fixtures.

**Spec:** `docs/superpowers/specs/2026-09-09-sequenced-recovery-design.md` (approved by “Implement the written contract”).

## Global constraints

- Inline on main; no subagents or worktrees. Preserve unrelated changes and use only disposable fixture daemons/private tmux sockets.
- Protocol version 2 after authentication; no legacy mutation/discovery fallback.
- Four separate identities: session_id, 128-bit incarnation, 128-bit stream_epoch, 128-bit attachment_id. Sequence numbers are validated decimal-string u64 counters.
- Journal: 8 MiB / 8,192 records per session; 64 MiB daemon-wide; 64 KiB per record/control accumulator. Evict entire oldest records; no skipped cursor gaps.
- Serialized outbound: 4 MiB per connection / 32 MiB globally. Slow consumers lose their connection, not their process.
- Heartbeat every 10 seconds; liveness deadline 30 seconds. Parser drain deadline five seconds. Four concurrent attachments maximum.
- Closed tombstones: five minutes / 256 entries, charged to journal budget. History: 5,000 lines / 8 MiB; helper deadline two seconds; bootstrap deadline ten seconds.
- No offline mutation queue, automatic retry, command rerun, cached-mode paste admission, implicit replacement, or archive-as-checkpoint.
- Preserve the paste contract, terminal pass-through, unknown telemetry, four materials, and existing persistent-chrome restriction.

## Task 1 — Restore a truthful verification baseline

**Files:** `crates/doom-term-pty/src/tmux.rs`, `tools/build-tmux-sidecar.mjs`, `.github/workflows/ci.yml`, `README.md`, `docs/BETA_READINESS.md`.

**Interfaces:** `version_supported(&str) -> bool` determines whether create can use durable tmux; no change to child-side paste admission.

- [x] Reproduce the remote paste refusal and trace the missing format to upstream tmux 3.7 (3.6a has no `bracket_paste_flag`).
- [x] RED: older versions must not be advertised as supporting the required adapter:

  ```rust
  for old in ["tmux 3.3", "tmux 3.4", "tmux 3.5a", "tmux 3.6b"] {
      assert!(!version_supported(old));
  }
  assert!(version_supported("tmux 3.7c"));
  ```

- [x] Set the adapter/sidecar floor to 3.7; install checksum-pinned 3.7c in CI. Document the compatibility change. Attach-only enforcement follows in Task 3.
- [x] Run `cargo test --locked -p doom-term-pty`, sidecar rejection tests, and inspect the next CI result. Baseline commits: `90f5f85`, `4144db9`; CI 34482935923 passes all stages. Sidecar regression also fails under an intentional restoration of the old floor.

## Task 2 — Bounded ordered journal and parser faults

**Files:** create `crates/doom-term-pty/src/stream.rs`, `crates/doom-term-pty/src/stream/tests.rs`; modify `src/lib.rs`, `src/demuxer.rs`, `src/session.rs` in that crate.

**Interfaces:** `Identity` validates/generates opaque 128-bit hex values; `Sequence` serializes validated u64 decimal strings. `JournalHub::open(StreamMetadata) -> StreamJournal`; `append(StreamPayload) -> Result<Sequence, StreamError>`; `snapshot() -> StreamSnapshot`; `read_after(Sequence) -> Result<Option<StreamRecord>, StreamError>`; `wait_for_change(Sequence, Duration)`. `StreamPayload` carries Event, Resize, Closed, and Fault; records carry source monotonic microseconds. The hub enforces global oldest-first retention; dropping the final journal handle releases retained data.

- [x] Add journal regression coverage for boundaries, independent epochs, future/gapped cursors, whole-record eviction, global oldest eviction, closed/fault streams, sequence overflow, malformed decimal values, and wakeups. Initial integration failed for the missing stream API; production-size count/byte/global boundaries are covered:

  ```rust
  let journal = hub.open(metadata()).unwrap();
  for _ in 0..600 { journal.append(output("x")).unwrap(); }
  assert_eq!(journal.snapshot().high_water, Sequence::new(600));
  assert_eq!(journal.read_after(Sequence::new(0)).unwrap().unwrap().sequence, Sequence::new(1));
  ```

- [x] Implement the journal, accounting, source timestamps and cursor API; assert limits with small injected limits and production-size fixtures. No socket I/O or callback runs under its lock.
- [x] RED: split unterminated CSI/OSC beyond 64 KiB produced zero faults. Implemented sticky demux fault; the regression now requires one fault and no fabricated tail. Real child remains alive, input/resize is refused, and fault survives legacy replay.
- [x] Replace the session's 500-event ring with its journal; sequence reader events, alternate-screen polls, successful resizes and closure through one observation lock. Legacy callback compatibility remains until Task 4 cuts transport over; this is not protocol v2.
- [x] Run focused journal/demux and real PTY tests; review lock order and drop accounting. Full local checks and browser regression smoke pass; see the readiness ledger for evidence and remaining limits.

## Task 3 — Exact durable identity and attach-only adapter lifecycle

**Files:** `crates/doom-term-pty/src/tmux.rs`, `src/tmux/durable.rs`, `src/session.rs`, `src/process_io.rs`; create `tests/attachment.rs` in that crate.

**Interfaces:** `PtySession::create(...)` creates only. `PtySession::attach_durable(id, incarnation, cols, rows)` carries no shell/cwd; resolves exact numeric pane and validates Doom-owned pane metadata. `TmuxHandle::capture_archive()` returns typed bounded capture metadata/data, not live events. `retire_adapter()` stops/reaps only owned display client/readers. Incarnation survives adapter recreation; stream epoch does not.

- [x] RED: create twice conflicts; attach missing never creates; prefix neighbors never match; pane recreation invalidates old identity:

  ```rust
  let original_pid = first.shell_pid().unwrap();
  assert!(create_same_id().is_err());
  let attached = attach_exact(first.incarnation()).unwrap();
  assert_eq!(attached.shell_pid(), Some(original_pid));
  assert!(attach_missing().is_err());
  ```

- [ ] Remove `new-session -A`; create detached pane with random pane-scoped identity and open normal attach-only client, validating in tmux's command queue. Explicit legacy recovery assigns metadata to the resolved current pane only.
  - New create/attach APIs now stamp persistent incarnation plus root pid, resolve a numeric pane, and validate identity in the command queue. Explicit legacy adoption checks the observed pane/pid and refuses overwriting an identity. Legacy Spawn/`-A` remains only until Tasks 4+6 cut over together; no new recovery API uses it for attachment.
- [x] Generalize bounded helper I/O with declared byte cap/deadline; capture up to 5,000 lines / 8 MiB with dimensions/truncation. Keep captures out of the live stream and parser.
  - The real missing-prefix regression initially queried/captured/killed its neighbor; it now leaves that neighbor untouched. Identified adapters use numeric identity-fenced targets and typed separate archives. Frontend archive transfer/presentation is still Task 6.
- [x] Verify real shell and alternate-screen repaint, saved editor file, history provenance, cancellation and no accumulated tmux clients across repeated adapter replacement. Seven real isolated adapter tests pass, including server restart with numeric-id reuse and a stalled bootstrap that reaps only its client. Browser recovery comparison remains Task 7, not certified by these Rust fixtures.

## Task 4 — Negotiated transport, ownership and bounded delivery

**Files:** create `backend/src/protocol.rs`, `backend/src/attachments.rs`, `backend/src/outbound.rs`, `backend/src/recovery_tests.rs`; modify `backend/src/main.rs`, `security_tests.rs`, `paste_tests.rs`, `telemetry_tests.rs`.

**Interfaces:** `Create { request_id, id, cols, rows, cwd, shell }`; `Attach { request_id, id, incarnation, resume }`; `StreamApplied { id, incarnation, attachment_id, sequence }`. `Ownership::authorize(socket_id, incarnation, attachment_id, requires_ready)` is rechecked at mutation execution. All mutation envelopes carry incarnation/attachment_id. `StreamBegin`, `StreamRecord`, `StreamCaughtUp`, `AttachmentReady` implement the exact cut exchange. Typed outcomes follow the spec verbatim.

- [ ] RED using real authenticated WebSockets: legacy Spawn/Write and pre-negotiation discovery do not execute; second socket gets busy; disconnect releases only its own lease; stale token and future acknowledgements cannot enable input:

  ```rust
  send(&mut second, attach_request(&created)).await;
  assert_eq!(receive_outcome(&mut second).await, "busy");
  send(&mut first, applied_future_cut()).await;
  assert!(!fixture.received_child_input());
  ```

- [ ] Reserve create ids before spawn and release only matching reservations. Retain closed incarnation tombstones; stale close callbacks cannot remove a replacement.
- [ ] Authenticate, advertise/negotiate v2 and daemon epoch, then allow discovery/attach. Pump one cursor incrementally through captured cut; offered-cut acknowledgement alone grants readiness. Remove rebind/replay and unbounded PTY delivery.
- [ ] Account serialized bytes through socket-send completion; overflow disconnects with reason; no socket I/O under journal/ownership locks. Add heartbeat/liveness expiry and cleanup.
- [ ] Fence Write/Signal/Resize/Paste/Kill at execution; preserve correlated paste uncertainty and permit explicit lifecycle action without screen readiness.
- [ ] Run real two-controller, attach-race, concurrent-create, stale-close, overflow, auth, paste, and tombstone tests. Commit with matching frontend Task 6 (never publish incompatible shells separately).

## Task 5 — Applied frontend cursors and explicit screen lifetime

**Files:** `src/core/terminalScreen.ts`, `xtermScreen.ts`, `emulatorRegistry.ts`; create `src/core/streamProtocol.ts`, `streamApplication.ts` and their tests.

**Interfaces:** `TerminalScreen.writeAndWait(data): Promise<void>` and `drain(): Promise<void>` resolve at parse completion, reject on disposal/deadline. `StreamApplication.apply(record)` orders parse, resize, semantic callbacks and cursor advancement; compares validated bigint sequences. `StreamApplication.resumeCursor()` drains before returning matching epoch/cursor.

- [ ] RED with real xterm: cursor cannot advance at receipt; SGR/Unicode/split escape and queued parser work survive warm reconnect; duplicates have no output/effects; forward jumps stop application:

  ```ts
  const applying = stream.apply(record('1', '\x1b[31m三'));
  expect(stream.appliedSequence).toBe('0');
  await applying;
  expect(stream.appliedSequence).toBe('1');
  await expect(stream.apply(record('3', 'never'))).rejects.toThrow();
  ```

- [x] Add parser completion/drain/disposal handling independent from animation-frame painting. Five new real-xterm tests pass; reset contamination was reproduced and fixed by replacing the parser. Warm-reconnect selection and recorded initial-size replay still require the stream application/transport work below.
  - Foundation CI exposed late SessionMode erasing startup output. Real-parser regressions reproduce it. Legacy reset is now before the Spawn request, never on metadata receipt; this bridge is not exact v2 recovery.
- [ ] Serialize resize confirmations and semantic events; suppress duplicate/catch-up activity effects; carry source clock identity/time and invalidate derived metrics across gaps.
- [ ] Run focused Vitest with real parser including timeout/disposal and reset isolation. Commit independently if no transport behavior changes.

## Task 6 — Frontend handshake, no mutation replay, all-workspace recovery

**Files:** `src/core/ptyClient.ts`, `commandDelivery.ts`, `holdBuffer.ts`, `sessionRecovery.ts`, `sessionStore.ts`; `src/hooks/usePtyEvents.ts`, `useWorkspaceSet.ts`; `src/components/RawTerminalView.tsx`, `StatusPlate.tsx`; `src/types/terminal.ts`; associated tests.

**Interfaces:** PtyClient attachment state owns negotiated daemon epoch, incarnation, token, applied cursor and readiness. Create is explicit/correlated then attaches. Restore discovers and attaches known exact incarnations with concurrency four; it never sends Spawn or a stored command. `inputReadiness(id)` returns a transient accessible refusal reason.

- [ ] RED: offline/catch-up typing and echo-held keys are never delivered later; stale async clipboard reads fail; missing/replaced nodes stay snapshots; parked/background nodes attach before focus:

  ```ts
  client.write('offline text', id);
  await reconnectAndAttach(client);
  expect(childInput).not.toContain('offline text');
  expect(createRequestsAfterReconnect).toHaveLength(0);
  ```

- [ ] Replace legacy message switch with protocol/application modules; remove pendingWrites; cancel deliveries/discard holds on disconnect, epoch or ownership change. Do not replay uncertain creates/pastes/initial commands.
- [ ] Apply caught-up cut then await AttachmentReady; coalesce desired sizes without offline reflow. Preserve session names, slots, tree, parked state and cached snapshots.
- [ ] Restore command/hook state without clocks/counters/notifications replay; unknown timing/marks remain unknown. Add recovery state to existing status/transient surfaces only.
- [ ] Present bounded archive outside live emulator with provenance/discontinuity and transfer-completeness state. A failed live rebuild is read-only; history failure alone is explicit but may allow live use.
- [ ] Run routing, input, workspace, cache/archive and clipboard suites; publish with Task 4 only after version compatibility checks pass.

## Task 7 — Contract verification and readiness ledger

**Files:** `tools/test-frontend-ui.mjs`, a dedicated `tools/test-recovery-ui.mjs` if needed, `package.json`, CI, `docs/BETA_READINESS.md`, spec status.

- [ ] Add real browser fixtures with disposable authenticated daemons and private tmux: socket disconnect, daemon restart, exact process identity, >500 events, split escapes/Unicode/SGR, pending parse, deferred resize, warm scroll position, cold shell/editor and saved files. Compare exact rendered cells/scrollback against uninterrupted control.
- [ ] Exercise production-size retention/global/outbound limits and slow consumers; assert process continues while attachment reports gap/overflow. Verify no replayed input or restarted command.
- [ ] Verify multiple workspaces/parked sessions, daemon-only recovery choices, second controller, missing/replaced process, lost paste/create result, archive failure, auth/version refusal and helper deadlines.
- [ ] Run `npm run typecheck`, `npm test`, `npm run build`, `npm run hud:check`, `cargo check --locked`, `cargo test --locked`, native all-target check in the available container, and production-CSP browser smoke/recovery. Inspect screenshots and record exact artifacts/environment blocks.
- [ ] Review every spec gate against evidence. Mark implemented only when all eleven gates pass; otherwise retain an explicit incomplete checklist. Commit/push and inspect CI. Do not mark the broader beta-readiness goal complete solely because recovery passes.
