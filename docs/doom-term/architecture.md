# Architecture

Doom Term is a desktop terminal fork with a shared Rust core. The product is the `doomterm` GUI
binary, built without the default upstream feature set. Retained upstream source also includes
alternate channels and a headless TUI; their presence does not imply they ship in Doom Term.

| Area | Purpose |
| --- | --- |
| `app/src/bin/doomterm.rs`, `app/channels/doomterm/` | Product entry point, channel, icons, and application identity |
| `app/src/terminal/`, `crates/warp_terminal/` | PTY sessions, shell bootstrap, command blocks, and emulation |
| `app/src/workspace/`, `app/src/pane_group/` | Tabs, groups, panes, local/SSH directory defaults, and session lifecycle |
| `crates/warpui/`, `crates/warpui_core/` | Entity/model core and native GUI layout/rendering; MIT-licensed |
| `crates/doomterm_plate/`, `app/src/doomterm/` | Status plate geometry, pixels, and application integration |
| `crates/doomterm_agents/` | Agent observation and supported context/usage signals |
| `crates/doomterm_backdrop/`, `themes/` | Generated backgrounds and optional theme packs |
| `crates/persistence/`, `app/src/persistence/` | SQLite migrations and app-state persistence |
| `script/doomterm/`, `.github/workflows/doomterm-ci.yml` | Fork build policy, evidence tools, verification, and packaging |

## Product boundary

The `doomterm` feature selects the local product, while `warp_services` selects upstream hosted
implementations. Build the GUI with `--no-default-features --features doomterm,gui`; use
`release_bundle` for installed binaries. The policy checker audits the resolved dependency graph.
Retained upstream service source is not the same as an enabled product dependency.

## UI and state

WarpUI uses entity handles and temporary contexts for view/model access. Create mouse-state handles
once and reuse them across renders. Avoid nested locks on the same terminal model. Pass already
locked model references through a call chain rather than acquiring the lock again.

The GUI and headless TUI have separate rendering systems. A native GUI screenshot validates the
GUI; a terminal capture or rendered snapshot validates the TUI. Consult the surface-specific skills
and the detailed shared conventions in [AGENTS.md](../../AGENTS.md).

## Persistence and change ownership

Group configuration flows through workspace state, snapshots, launch templates, and SQLite.
Migrations should preserve existing sessions and configuration. Changes to upstream-shared code
are accounted for in [the fork edit ledger](invasive-diff.json). Verification captures and limits
are recorded in [the evidence dossier](../../evidence.html).
