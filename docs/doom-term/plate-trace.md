# Recording what the status plate shows

Set `DOOMTERM_PLATE_TRACE` to a file path before starting Doom Term and the application appends one JSON line for each thing the status plate does. Nothing is recorded when the variable is not set, and a file that cannot be written never disturbs the application.

```sh
# Linux and macOS
DOOMTERM_PLATE_TRACE=$HOME/plate-trace.jsonl doomterm

# Windows PowerShell
$env:DOOMTERM_PLATE_TRACE = "$env:USERPROFILE\plate-trace.jsonl"; doomterm
```

Use it when a value on the plate looks wrong or the mark looks slow. Reproduce the problem, close Doom Term, and keep the file. It contains the pane names the plate displays, so read it before you share it.

## Lines

Every line carries `t_ms` (milliseconds since the trace opened), `unix_ms` (the wall clock) and `ev`, the name of the event.

| `ev` | When | Fields |
| --- | --- | --- |
| `plate` | The displayed state changed | `agent`, `working`, `context_pct`, `usage_pct`, `waiting`, `rows` (number, name and status of each queued pane). A missing percentage is a dash on the plate. |
| `plate_render` | The workspace rebuilt the plate's state | none |
| `paint` | The plate was painted | `working`, `phase` (position in the mark's 1.4 s pulse) |
| `tick` | The monitor sampled output activity, every 100 ms | none |
| `probe_start`, `probe` | A once-a-second look at every pane, and how long it took | `lock_ms`, `panes`, `ms` |
| `panes` | What the monitor believes about each pane changed | `agent`, `working`, `context_pct`, `usage_pct` as shown, and `raw_*` as the latest probe saw them |

## Reading a trace

- The mark's animation rate is the number of `paint` lines per second in which `working` is true and `phase` differs from the line before.
- A value that flickers shows up as alternating `plate` lines with and without `context_pct` or `usage_pct`.
- `raw_working` and `raw_context_pct` in a `panes` line are what the latest probe saw; `working` and `context_pct` are what the plate was told. The difference is the steadying: a value is held until the agent or conversation changes, the agent is gone, or its usage window has ended.

`script/doomterm/analyze_plate_trace.py` turns a trace into the figures reported in the release evidence.
