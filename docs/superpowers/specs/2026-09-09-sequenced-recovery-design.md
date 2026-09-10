# Sequenced session attachment and bounded recovery

Status: approved for inline implementation, 2026-09-10. Implementation in progress;
the verification gates below have not yet been satisfied. Tracked in the
[implementation plan](../plans/2026-09-10-sequenced-recovery.md).
Baseline: `7313b9b`. This follows the beta audit and leaves the approved
child-checked paste contract intact. Work stays inline on main, without subagents.

## Evidence and objective

The current transport conflates creation, attachment, and reconstruction:

- `PtyClient.restoreBindings()` sends Spawn for every bound id, then drains
  `pendingWrites`. After a daemon restart, an absent id can become a new shell
  receiving input intended for the old process.
- Every SessionMode resets the frontend emulator. The daemon's 500-event ring
  is only a tail, not a terminal checkpoint; resetting loses earlier scrollback,
  parser modes, and possibly the beginning of an escape sequence.
- The daemon replaces live callbacks before sending SessionMode and replay.
  Live output can therefore precede the reset or overlap the replay.
- Cold tmux history is emitted inside PtySession construction, before the
  daemon sends SessionMode. That later reset can erase the captured history.
- Output, alternate-screen polling, resize, and close do not share one ordered
  event history. Replayed command completions can increment counters again.
- `TerminalScreen.write()` parses asynchronously. Receiving a WebSocket message
  does not prove that the screen has incorporated it. Cached AnsiLine arrays
  contain neither a complete emulator checkpoint nor a valid resume cursor.
- Startup automatically binds only the selected stored pane, leaving matching
  background/parked sessions without a live stream until selected.

The objective is safe, ordered reconnection with explicit retention limits:
preserve a continuous terminal stream exactly when the evidence permits it;
otherwise recover the surviving process and a fresh view without presenting
incomplete history as a continuous transcript. Recovery must never execute a
stored command, create a replacement process implicitly, or replay typing.

## Decision and alternatives

Use an in-memory, byte-bounded sequenced journal, explicit create versus attach,
process-incarnation checks, and connection-scoped input ownership. Keep the
existing direct PTY and normal tmux-client transports; do not introduce a second
terminal parser, tmux control-mode replacement, or disk transcript journal here.

An enlarged unsequenced ring still cannot reconstruct missing parser state or
prevent duplicate events. A persistent journal could retain more across daemon
restarts, but adds sensitive disk content, retention policy, and checkpoint work.
A new daemon-side emulator would provide stronger general checkpoints but changes
the emulation architecture; it is not hidden inside this protocol repair.

No-new-journal does not mean no persistence: the existing workspace/localStorage
screen cache and tmux's bounded in-memory history remain. Neither becomes an
authoritative emulator checkpoint merely because it was saved.

## Identities and wire compatibility

Four values have different jobs:

| Value | Meaning and lifetime |
| --- | --- |
| session_id | Logical workspace node; not proof of process identity |
| incarnation | Opaque random identity for one owned root PTY/tmux pane |
| stream_epoch | Opaque random identity for one adapter's ordered rendering stream |
| attachment_id | Opaque input-ownership token, bound to one authenticated socket |

Use 128-bit cryptographically random identities. Sequence numbers are unsigned
64-bit counters encoded as decimal strings, not lossy JavaScript numbers.
Validate them before comparison; overflow ends the stream rather than wrapping.

An incarnation survives detaching/recreating our tmux display client, but not
destroying/recreating the actual pane. Store it as Doom-owned tmux pane metadata
when creating a durable pane. A stream_epoch changes whenever the adapter/parser
is replaced, including daemon restart. A direct PTY's incarnation cannot survive
loss of the daemon that owns it. Foreground programs may change within the same
PTY; these identities do not claim transactional foreground-agent identity.

Advertise protocol version 2 and a daemon epoch after authentication. New clients
must not fall back to legacy Spawn/Write/replay when the handshake is missing or
incompatible. Old mutating messages receive an explicit incompatibility refusal
and do not run. Update both shells' frontend/daemon together. Version 2 discovery
requires negotiation and authentication too; there is no legacy readiness path.

## Creation, attachment, and ownership

Create is explicit and correlated: request_id, new session_id, dimensions, cwd,
and optional shell. It creates only; an existing id is a conflict, never an
implicit attach. Reserve an id before starting its process so concurrent creates
cannot launch twice. Failure releases only that reservation. A lost result has
an unknown outcome: discovery may locate the process, but reconnect never retries
creation or its initial command automatically.

CreateResult returns the created incarnation or a typed error; creation alone
does not grant input ownership. The client then uses the same Attach handshake
as other sessions, while the new process's initial output is already journaled.

Attach is correlated and carries session_id, expected incarnation, and an
optional resume cursor `{ stream_epoch, after_sequence }`. It carries no cwd,
shell, or command to execute. An absent, exited, or replaced process returns a
typed result. Never use `new-session -A` as attachment or fall back to a direct
shell when durable attachment fails. Resolve the exact tmux session and numeric
pane, then use attach-only operations; no prefix matching or server auto-start.

AttachResult names one outcome: resume, replay-from-start, rebuild,
unreconstructable, missing, closed, replaced, busy, incompatible, or failed.
Successful outcomes identify
the granted attachment and stream. An after_sequence greater than the current
high-water value is invalid, not a request to skip output. A cursor older than
the retained contiguous suffix requires rebuild handling.
An unreconstructable but verified live process can grant ownership without input
readiness, so explicit lifecycle controls remain usable while its view is stale.

Session listings carry incarnation and stream information where known. Existing
legacy tmux panes without identity metadata are explicit recovery choices, never
automatic matches for a cached resume cursor. Explicit recovery resolves the
current exact pane and assigns its identity in the tmux command queue before
opening a fresh view. It does not claim continuity with an unidentified cache.

Keep one controlling attachment per session. A second socket cannot silently
replace a live owner; it receives busy. Disconnect releases that socket's
ownership without killing the process. A stale connection is expired by a
10-second transport heartbeat with a 30-second liveness deadline. Automatic
reconnect does not steal another live window's attachment. Multi-controller
editing and an explicit takeover UI are outside this change.

Write, Signal, Resize, Paste, and Kill must name the expected incarnation and
attachment_id. Validate both against the originating authenticated socket at
execution, not merely when scheduling work. Old callbacks may close/remove only
the incarnation they belong to, never a replacement under the same logical id.
Ownership is an accidental-stale-input fence, not a substitute for local-client
authentication or protection from a malicious authorized client.

## Ordered stream and exact continuation

A per-session stream owner sequences Output, accepted grid-size changes,
semantic command events, TUI-state observations, and terminal closure. Records
include source timestamps for observed state transitions. Initial dimensions and
durability are stream metadata, not instructions to reset an existing screen.

The journal and its cursor subscriptions replace callback swapping plus a
separate replay loop. Attachment captures a high-water sequence under the same
short lock used to append records. One delivery pump emits:

1. StreamBegin: identities, initial dimensions, recovery kind, and replay cut.
2. Contiguous records through that cut, labeled catch-up.
3. StreamCaughtUp at that cut, followed by later live records in sequence.

Every record carries session_id, incarnation, stream_epoch, sequence, and its
typed payload. After applying the cut, the client sends StreamApplied with that
attachment_id and sequence. The daemon replies AttachmentReady only if ownership
is still current, no gap/closure has invalidated it, and that exact cut was
offered to this attachment. Input stays
closed until this exchange completes. Duplicate acknowledgements are idempotent;
an invented or future cut is refused.

Socket writes and subprocess work never run under the journal lock. Readers
continue draining the PTY even without subscribers. Delivery reads by cursor
from the journal, so replay is not copied into another unbounded queue. Eviction
overtaking a subscriber is a gap, not permission to silently skip ahead.

On a warm reconnect, the frontend first drains already-submitted parser work,
then supplies the last fully applied sequence with its still-live emulator.
It must not acknowledge receipt as application. Per-session processing orders
output parse completion, resize, and semantic state updates. Frame-coalesced
painting is separate from this application boundary. Late callbacks from a
disposed emulator cannot advance a replacement's cursor or state.
Parser draining has a five-second deadline; failure leaves the pane read-only
and selects explicit reconstruction handling instead of pretending it resumed.

Matching epoch plus a complete suffix means reuse the same emulator, cursor,
scrollback, marks, and scroll position. Drop duplicate sequence numbers before
any output, counters, activity, or notification handling. Unexpected forward
jumps stop application and initiate gap handling; do not feed a raw tail into a
reset parser. A new frontend may reconstruct from sequence 1 only if the entire
stream from its initial dimensions is retained. Cached lines alone cannot resume.

Resize follows stream order. Retain the latest measured desired grid while
disconnected or catching up; do not reflow the saved emulator before replaying
records produced at its previous size. After catch-up, request the new size and
apply its ordered confirmation before later output. Serialize the adapter's
resize observations with its output observations; replay must reproduce that
same observed order, not pretend to know when the child generated queued bytes.

Catch-up restores state, but is not new foreground activity. It must not restart
command clocks, double completion counts, or replay sounds/desktop notifications.
Use source timestamps and stable event identities; elapsed values remain unknown
when their endpoints were not observed. Current attention state is still shown.
Compute durations only from observations in the same monotonic daemon clock
domain; never subtract timestamps across daemon epochs to invent elapsed time.
An incomplete history invalidates derived counts/marks rather than guessing them.
Retained hook state is restored idempotently, not counted as a new permission ask.

## Retention, gaps, and cold reconstruction

Bound journal payloads to 8 MiB and 8,192 records per session, and 64 MiB across
the daemon, evicting oldest retained records when a limit is reached. A complete
record is kept or removed; do not truncate escape-sequence bytes to fit. Bound
individual stream records to 64 KiB and the corresponding demux accumulators;
an overlong malformed control record yields an explicit stream fault, not an
unbounded allocation or a fabricated continuation.

Bound pending serialized outbound data to 4 MiB per connection and 32 MiB across
connections. A slow consumer is disconnected with an overflow reason while the
process continues. Catch-up pumps incrementally rather than trying to queue an
entire journal. Closed-session tombstones retain known exit outcomes for up to
five minutes, capped at 256 entries and charged to the journal budget. After
expiry, missing is unknown, never inferred success.

| Situation | Required behavior |
| --- | --- |
| Same epoch, complete suffix, live emulator | Exact continuation; no reset or duplicate effects |
| Fresh frontend, complete stream from sequence 1 | Reconstruct at recorded sizes, then attach live |
| Missing suffix or different epoch, durable pane survives | Preserve old cache separately; open fresh tmux view with disclosed discontinuity |
| Direct PTY survives but neither checkpoint nor complete stream exists | Preserve cached view read-only; report reconstruction unavailable; do not restart or kill it |
| Stored process is absent or incarnation changed | Keep a labeled snapshot; offer discovered replacement separately |
| Discovery/attachment fails or times out | Stay unbound/read-only with a reason; never create as fallback |

Tmux reconstruction is a fresh rendering stream, not an exact resume. Capture
up to its configured 5,000 history lines and 8 MiB from the exact pane with bounded
helper I/O. Treat this as a separate historical snapshot, with observed capture
dimensions and explicit truncation metadata. It is not parser initialization.
If capture fails, retain the available cache and report unavailable history; do
not disguise an empty result as proof that there was no history.
History payloads travel in bounded chunks, identified by their capture id and
ordinal; an incomplete transfer is not a complete archive. Each helper has a
two-second deadline and a declared byte limit, and the bootstrap operation has
a ten-second overall deadline. A timeout stops/reaps only owned helper/client
processes. History-transfer failure alone can leave a verified live view usable
with an explicit history-unavailable result; live reconstruction failure cannot.

Open a normal attach-only tmux client for the surviving pane, producing a fresh
current-screen repaint. Establish StreamBegin before any callback can publish
history or live bytes. On a stream-gap rebuild, retire only our old display
client, not its pane or the private server; wait for its owned reader to stop,
then create the new stream_epoch. Never accumulate duplicate tmux clients.

Recovered/cached history is presented separately from the new live emulator,
with a visible discontinuity and provenance in the scrollback presentation.
Keep at most 5,000 archive lines and 8 MiB combined per pane. Do not silently
deduplicate similar text, infer a loss count, or claim a precise seam between
the history capture and the new client's repaint. Output can occur between
those observations. Show the archive as potentially overlapping/incomplete;
never feed it through the live parser or treat its text as semantic events.

Current-screen repaint and subsequent typing must work for both shell and
alternate-screen applications. History remains available without becoming rows
inside a full-screen editor. This is a required real-tmux verification gate,
not an assumption justified by a successful attach command. Failed reconstruction
stays explicit and read-only; it cannot count as a completed recovery feature.

## Input safety and frontend integration

Input becomes available only after version negotiation, successful attachment,
application of StreamCaughtUp, and confirmation of the current attachment token.
Disconnected, busy, incompatible, and resynchronizing panes refuse typing with
a transient accessible reason. Do not persist or log refused input contents.
Application chords and copying a snapshot remain available.
Read-only here prohibits terminal input, not an explicit PARK/KILL decision.
Kill remains correlated and requires the current incarnation/attachment even
when screen reconstruction failed. Removing a cached-only node is a local
presentation action, not a kill request against an absent or replaced process.

Remove reconnect typing queues. On disconnect or ownership/epoch change, cancel
echo-delivery timers and discard held keystrokes. Never re-run the command or
flush those keys after attachment. Commands/input accepted immediately before
a lost connection may have run: report unknown delivery where applicable; never
label them unsent or retry them automatically. Coalescing desired sizes and
reissuing read-only discovery are allowed; mutation replay is not.

Paste retains its separate correlated operation, original 1 MiB UTF-8 limit,
child-side admission, normalization, cleanup, and unknown-delivery behavior.
Add the ownership fence without replacing child mode checks. A stream rebuild
must not authorize paste from an old cached mode or stale asynchronous clipboard
read. In-flight accepted operations may already have reached the child; revoking
an attachment is not a claim that already-written bytes were recalled.

At startup/reconnect, reconcile and bind every known matching terminal node
across all workspaces, including parked nodes; scratchpads have no PTY binding.
Use bounded attachment concurrency (four), keep unknown daemon-only sessions as
explicit recovery choices, and do not wait for focus before routing background
output. Preserve names, slots, pane trees, parked state, and cached-only snapshots.
Recovery never submits the reported command name or a stored launch command.

The status plate remains the only persistent chrome. Connection/recovery state
belongs there; details and refusals use existing transient surfaces. Historical
discontinuity annotations are presentation metadata, not bytes sent to the PTY.
No new sidebar, toolbar, icon dependency, soft shadow, or fractional cell metric.

## Implementation boundaries

- The shared Rust PTY crate owns incarnation identity, the bounded stream journal,
  cursor subscriptions, adapter lifetime, and exact attach-only tmux operations.
- The daemon owns authenticated protocol negotiation, correlated lifecycle
  responses, input ownership, discovery, and bounded socket delivery.
- PtyClient owns per-session attachment state, ordered application cursors,
  reconnection, and cancellation. Split protocol/state logic into focused modules
  rather than extending the current monolithic message switch indefinitely.
- TerminalScreen exposes parse completion needed for cursor advancement;
  emulatorRegistry preserves a warm emulator or replaces one explicitly for a
  new stream. Presentation caches are never promoted to checkpoints.
- Workspace/event hooks apply catch-up without duplicate effects, bind background
  nodes, and expose snapshots/discontinuities without changing terminal input.

## Verification gates

The implementation is not complete until all of the following pass:

1. Real direct-PTY and tmux runs survive a socket disconnect with the same root
   process. Inject output during the attach boundary; sequences have no gaps or
   duplicates, and every final rendered cell matches the uninterrupted control.
2. Establish SGR, cursor position, Unicode, and an escape split before disconnect;
   resume without losing parser state. Include resize during disconnection and
   asynchronous output already queued when the socket closes.
3. Exceed the old 500-event count while remaining within the new bounds. Preserve
   earlier local history, marks, cursor, and scroll position on exact continuation.
4. Force each byte/count/global journal limit and a slow consumer. Verify bounded
   retention, explicit gaps, continued child execution, and no raw-tail reset.
5. Cold frontend reconstruction from a retained complete stream matches control.
   Cold daemon recovery attaches the original exact tmux pane, restores a working
   shell/editor viewport and separated history, and never starts its command again.
6. Kill/recreate a pane or restart the private tmux server under the same logical
   id. Old attachment tokens, input, close callbacks, and resume cursors cannot
   affect the replacement. Prefix-neighbor sessions are never targets.
7. Type while offline or catching up, interrupt an echo-delivery attempt, and lose
   a paste result. Reconnect delivers none of the held/refused input, retries no
   mutation, and reports uncertainty for accepted-but-unconfirmed operations.
8. Replay command completion/permission state twice. Counts, timings, attention,
   sounds, and notifications obey the idempotence and unknown-value rules.
9. Reload with multiple workspaces and parked/background panes. All known matching
   sessions receive output before selection; daemon-only sessions remain explicit
   choices. A second live controller is refused without stealing the first.
10. Authentication failure, incompatible daemon, helper timeout, process exit
    during attach, and missing history never create fallback shells or false
    ready/success states. Fixtures use only owned processes and private sockets.
11. Typecheck, Node/Vitest, production build, HUD comparison, Rust checks/tests,
    native all-target compilation where available, and production-CSP browser
    smoke pass. Add real browser disconnect/restart tests with process identities,
    saved editor files, cell/scrollback comparisons, and inspected screenshots;
    mocks alone cannot certify recovery. Record environmental blocks explicitly.

This contract does not certify arbitrary nested multiplexers, unbounded history,
direct-PTY reconstruction after lost parser state, native notification click
routing, or every remaining beta-audit issue. Those limits do not waive any gate
above or redefine the broader readiness goal as complete.

## Primary reference

The [tmux manual](https://man.openbsd.org/tmux) distinguishes attach-only from
create-or-attach, exact targets, history capture with attributes, and current
client redraw. Capture is not documented as a complete emulator checkpoint.
The separation of captured history from a fresh live parser is our design
inference, not a claim of lossless snapshot semantics from tmux.
