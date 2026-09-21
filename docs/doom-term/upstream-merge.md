# Upstream merge procedure

Doom Term tracks `warpdotdev/warp` rather than snapshotting it. This document is
the operating procedure for that: who runs a merge, how often, what has to be
inspected by hand even when Git reports no conflict, and which gates must pass
before the recorded baseline may be moved forward.

It is deliberately not automated. Nothing here runs unattended.

## Remotes and branch names

| Remote | URL | Default branch |
| --- | --- | --- |
| `origin` | `https://github.com/CMLeadmon/Doom-Term.git` | `main` |
| `upstream` | `https://github.com/warpdotdev/warp.git` | `master` |

**The two default branches have different names.** Upstream's is `master`; the
fork's is `main`. Resolve it rather than assuming it:

```sh
git remote show upstream | grep 'HEAD branch'
```

`upstream/main` does not exist. A merge command that names it will fail, and a
script that silently falls back to `origin/main` would merge the fork into
itself and report success.

## Cadence and ownership

| | |
| --- | --- |
| **Owner** | The Doom Term maintainer runs the merge. |
| **Reviewers** | The implementer of each ledger seam whose files conflict reviews that seam's resolution. With a single maintainer, that review is still a separate pass over the conflict diff, recorded below, not the same act as resolving it. |
| **Cadence** | Weekly during active development, before each release candidate, and promptly for upstream security fixes. |
| **Unattended merges** | Never. No auto-merge, no scheduled merge job, no bot. |

## Procedure

### 1. Fetch and branch

```sh
git fetch upstream
git switch -c "merge/upstream-$(date +%Y-%m-%d)" origin/main
git merge --no-ff upstream/master
```

Always branch from the maintained fork branch and merge upstream *into* it.
Never reset `main` to upstream, and never merge with `-X ours`/`-X theirs`:
both discard one side's intent wholesale, which is exactly what the ledger
exists to prevent.

### 2. Inspect every ledger file, conflict or not

A clean automatic merge is not evidence that the fork's invariant survived.
Upstream can move the code a fork edit depended on without touching the same
lines. Before resolving anything, list what upstream changed under every path
the ledger tracks:

```sh
BASE=$(python3 -c "import json;print(json.load(open('docs/doom-term/invasive-diff.json'))['upstream_base'])")
python3 -c "
import json
rows = json.load(open('docs/doom-term/invasive-diff.json'))['rows']
print('\n'.join(r['path'] for r in rows if r['status'] != 'planned'))
" | xargs -r git diff --stat "$BASE" upstream/master --
```

For each path that moved, reapply the **invariant named in its ledger row**, not
the old diff text. Then audit the four places upstream most often reintroduces
what this fork removes:

- **New startup constructors** in `app/src/lib.rs` and `RootView`. A new service
  client built at startup defeats the compile boundary from inside it.
- **Cargo feature edges.** A dependency that becomes non-optional, a new default
  feature, or a new `dep/feature` forward can pull a hosted crate back into the
  local graph.
- **Release flags.** `RELEASE_FLAGS` is unioned into the enabled set; a flag
  added upstream arrives enabled unless `DOOMTERM_FEATURES` filters it.
- **Package resource copies.** Bundle scripts that copy a new upstream asset
  will copy upstream marks into a Doom Term package.

New `Channel` match sites also appear with upstream features. They are caught by
the compiler only because no arm uses a catch-all pattern. Keep it that way.

### 3. Record each conflict

Add one entry per conflicted or hand-reapplied path to the merge PR body:

```
path:              crates/warp_core/src/channel/state.rs
upstream change:   <what upstream did, in one line>
fork behavior:     <the invariant kept, quoting the ledger row's reason>
resolution:        <what the merged file now does>
test evidence:     <the command run and its result>
```

Then refresh the ledger rows you touched: update `last_merge_review` to the
merge date, and correct `reason` or `validation` if the seam actually changed
shape. A row whose file moved but whose review date did not is a row nobody read.

### 4. Gates before the baseline moves

`docs/doom-term/upstream-base.txt` records the fork's truth. Update it **only
after** all of the following pass on the merge branch:

1. `python3 script/doomterm/check-inventory.py`
2. The Doom Term production dependency-graph audit (`check-build-policy.py`), on
   every release target — not the workspace-unified graph.
3. Local terminal regression tests: blocks, history, workflows, themes, tabs,
   splits, session restore.
4. Renderer tests, including the chrome-policy submission tests.
5. Fork CI, green, with no required job skipped.
6. An explicit upstream-default-channel compile smoke build. This is what
   detects a fork edit that quietly broke a seam other channels still use.

For channel, config, renderer or packaging changes, run all three desktop
builds. A fork-local documentation merge does not need that fan-out.

### 5. Merge through a reviewed PR

Open a PR from the merge branch into `main`. Never push the merge directly.

Keep the conflict-resolution commit clean: no dependency upgrades, no
reformatting, no drive-by refactors, no "while I was in here". Those hide a
behavioural change inside a diff reviewers are already reading structurally.

If a release blocker surfaces and cannot be resolved, revert the merge commit
and keep the fork on the previous baseline. A fork that is a week behind
upstream is in better shape than one carrying an unreviewed regression.

## Inherited upstream automation

The fork inherits upstream's workflow files. Most are inert here because they
are guarded on the repository owner:

```yaml
if: github.repository_owner == 'warpdotdev'
```

Verified on 2026-09-20 in this fork's own run history: `Feature Flag Cleanup`,
`Stale Requested-Changes PRs`, `Close Stale Fix PRs`, `Cut New Releases`,
`Check Approvals`, `Sync PR Checks` and `Label External Contributors` all
executed and reported **skipped**. `repo-sync.yml` is guarded the same way and
additionally triggers only on `master`, a branch this fork does not develop on.

Leave those guards in place. Do not strip `warpdotdev` checks globally — they
are what keeps upstream's private infrastructure from being addressed from here.
T9 replaces the owner guard only inside the one workflow the fork reclaims.

Two things need attention and are owned by T9:

- **`publish-agent-dev-image.yml` is not owner-guarded** and is scheduled for
  the 1st and 15th of each month. In this repository it would attempt a Docker
  Hub login with absent secrets and fail. It is an outward-facing attempt from
  the fork's account and should be disabled here.
- **Dependabot is opening pull requests** against this fork. Those PRs are
  dependency upgrades; they must not be merged into a release candidate's
  lockfile without going through the same graph audit as any other change.

Note also that this repository is **not** a GitHub fork (`isFork: false`). The
protection that stops scheduled workflows from running in forked repositories
therefore does not apply: inherited cron workflows really do fire here, and only
their owner guards make them harmless.

## State at the time of writing

At the recorded baseline the local `upstream/master` ref is exactly
`a0f5eb31a2ba46e46898f41d8c0e256ae7d20dda`, the same commit recorded as
`upstream_base`. A dry-run merge is therefore clean because it is a no-op, and
that says nothing about how the first real merge will go:

```sh
$ git merge-tree --write-tree HEAD a0f5eb31a   # clean, already contained
```

The local `upstream` ref has not been re-fetched since the baseline was taken.
This is deliberate: fetching would move `upstream/master` past the baseline the
ledger was written against. The first genuine exercise of this procedure is the
first scheduled merge, and it must follow the gates in step 4 before
`upstream-base.txt` is rewritten.
