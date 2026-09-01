# Spike: can Doom Term tell that an agent is asking a question?

Run 2026-08-31 on this machine (Bazzite, Claude Code / Codex / agy installed).
Gates Tasks 5–7 and 10 of `2026-08-31-direction-b-enhancements.md`.

**Answer: yes, for Claude Code and Codex, via vendor hooks. No for agy.**

Outcome per the plan's Task 1 Step 4: **"Hooks available → build on hooks,
pattern-match only as fallback."** Proceed to Task 5.

---

## 1. What each agent exposes

| Agent | Signal | Confidence | Source |
| --- | --- | --- | --- |
| **Claude Code** | `PermissionRequest` hook event | High | `~/.claude/settings.json` |
| **Claude Code** | `Notification` hook event | High — but broader than "blocked" | same |
| **Codex** | `permission_request` hook event | High | `~/.codex/config.toml`, `~/.codex/hooks.json` |
| **agy / Antigravity** | none found | — | `agy --help` exposes no hook, notify or event flag |

Claude Code also exposes `Stop`, `StopFailure`, `PreToolUse`, `PostToolUse`,
`SessionStart`, `SessionEnd`, `UserPromptSubmit`. Codex mirrors the set with
snake_case names (`session_start`, `user_prompt_submit`, `pre_tool_use`,
`permission_request`, `post_tool_use`, `stop`).

**`PermissionRequest` / `permission_request` is exactly the summons signal** —
the vendor firing an event that says "I have stopped and I need a human". No
prose matching, no locale dependency, no breakage when a prompt is reworded.

`Notification` is a superset and fires for things that are not a block. Use
`PermissionRequest` for the summons and `Stop` to clear it. Do not summon on
`Notification`.

## 2. The conflict nobody planned for

**Both hook slots on this machine are already taken by nodeterm.** Every Claude
Code event points at:

```
if [ -r '/home/cleadmon/.nodeterm/agent-hooks/claude.sh' ]; then
  sh '/home/cleadmon/.nodeterm/agent-hooks/claude.sh';
else cat >/dev/null 2>&1 || :; fi
```

with siblings for `codex.sh`, `copilot.sh`, `gemini.sh` and `grok.sh`, installed
2026-08-23.

Two consequences:

1. **Doom Term must append, never replace.** `settings.json`'s `hooks.<Event>`
   is an *array* of matcher groups, each holding an array of hooks. Adding an
   entry leaves nodeterm's intact and both run. Overwriting the array would
   silently break the user's other terminal — an unacceptable failure mode for
   an installer, and one we would not notice because our own thing would work.
2. **Installation must be idempotent and reversible.** Detect our own entry by a
   marker in the command string, replace only that, and offer removal.

**Licensing note.** nodeterm is BUSL-1.1. Its scripts were confirmed to exist
and their target paths read from the user's own config; **no nodeterm code or
comment was read into or reproduced in Doom Term.** The hook event names and
payload contract are Anthropic's and OpenAI's public API, not nodeterm's IP.

## 3. What Doom Term does not have yet

`backend/src/` contains **no hook handling of any kind** — grep for `hook`
returns nothing. So Tasks 5–7 need, before any UI:

- a hook receiver in the daemon (a local endpoint or a FIFO the script writes to);
- an installer that appends to `~/.claude/settings.json` and Codex's hook config
  without disturbing existing entries;
- a mapping from the hook payload's session identity to a Doom Term session id.

That last one is the real work. The hook fires in the *agent's* process, which
knows its own `session_id` and `cwd` — not our node id. Correlating them is the
same problem `2026-08-29-doom-term-usage-percentage.md` already has to solve for
the CONTEXT slot, so the two should share one mechanism rather than inventing
two.

## 4. Recommendation

- **Build the summons on `PermissionRequest` / `permission_request`.** Clear it
  on `Stop` / `stop`.
- **Ship agy as notify-only.** No hook surface exists, so an agy session appears
  in the waiting list when it goes quiet and never takes the screen. That is the
  honest behaviour and matches the plan's third outcome for one agent rather
  than all three.
- **Do not pattern-match prose as a primary signal.** It was the fallback in the
  plan; with two of three agents covered by hooks it is not worth the
  false-positive risk, and a false positive steals the screen.
- **Answer keys still need capture.** The hook says an agent is blocked; it does
  not say which key answers it. Task 5's answer-key table still requires driving
  each agent to a real prompt and recording what it accepts. That is smaller
  than the detection problem and cannot make the screen flash wrongly.

## 5. Scope consequence

The summons is **larger than the plan assumed**: it needs a daemon endpoint and
a settings installer before any of its UI. Tasks 5–7 should be re-planned as:

- 5a. Daemon hook receiver
- 5b. Idempotent, append-only hook installer for Claude Code and Codex
- 5c. Session correlation (shared with the usage-percentage plan)
- 5d. The answer-key table, from captured prompts
- 6.  The summons view
- 7.  Queueing two at once

Enhancement 1 (reading back) and Tasks 8–9 (the rack as viewer and launcher) are
unaffected and remain the right things to build first.
