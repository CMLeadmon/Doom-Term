# Contributing to Doom Term

Help make Doom Term a reliable, local-first terminal. Bug fixes, documentation, accessibility,
performance work, and improvements to supported workflows are welcome.

## Start with the problem

Search [existing issues](https://github.com/CMLeadmon/Doom-Term/issues) before filing a report.
Include the Doom Term version or commit, platform, shell, reproduction steps, and expected result.
Redact credentials, private hosts, paths, and session data from logs and screenshots.
Report vulnerabilities through [SECURITY.md](SECURITY.md).

For a substantial feature, describe the user need and proposed scope in an issue before building.
Small fixes and documentation improvements can go straight to a pull request. There are no Warp
internal readiness labels, paid services, or employee-only tools required to contribute here.

## Develop the fork

Read [the development guide](docs/doom-term/development.md), [architecture](docs/doom-term/architecture.md),
and [AGENTS.md](AGENTS.md). Build the `doomterm` binary with `--no-default-features --features doomterm,gui`.
The default upstream binaries have different feature and service behavior.

Work on a topic branch from current `origin/main`. Keep each PR focused and preserve unrelated
changes in shared checkouts. Use a separate worktree when concurrent work needs isolation.

- Preserve the compile boundary that excludes hosted services from Doom Term.
- Follow the Rust, UI, locking, and comment conventions in AGENTS.md.
- Keep secrets and personal session data out of source, fixtures, logs, and evidence.
- Record edits to upstream-shared files in `docs/doom-term/invasive-diff.json` in the same change.
- Preserve copyright headers, license texts, and third-party asset attribution.

## Verify what changed

Use the smallest relevant check while editing. After implementation and self-review, follow the
validation order in AGENTS.md: relevant tests, relevant lint/build checks, then applicable formatters.
Rerun affected checks when a subsequent code or configuration change changes the candidate.
Run the full `./script/presubmit` only when explicitly requested.

For deterministic logic, cover meaningful behavior and failure paths with focused tests. Use
`cargo nextest` where available. Put Rust unit tests in separate `*_tests.rs` files. UI, PTY,
SSH, and persistence wiring also need evidence at the level where they can actually fail.

For GUI behavior, include screenshots or a short recording of the real application. For the
headless TUI, include terminal captures or rendered snapshots. Documentation-only changes need
link, rendering, and factual checks rather than an application rebuild.

If checks cannot run, report which ones and why. Existing evidence may be used when the task
explicitly asks for that; identify the tested revision and disclose the limits. Never describe
stored output as a fresh test run.

## Submit a reviewable PR

Use [the PR template](.github/pull_request_template.md). Explain the problem, resulting behavior,
validation commands and results, and material limitations. Separate released behavior from changes
only on `main`. Include a changelog marker for a user-visible change, or `CHANGELOG-NONE` otherwise.
Commit messages should explain the change and its purpose.

Agent-assisted work follows [AI_POLICY.md](AI_POLICY.md). The contributor owns the result and
must understand it, review the diff, and provide evidence. Tool output does not substitute for review.

Maintainers review correctness, security, usability, and the fork's product boundary. A merge does
not imply a release. Release publication is a separate maintainer action; the next release remains
on hold while local theme work is incomplete.

## Community and licensing

Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) in project spaces. See [SUPPORT.md](SUPPORT.md)
for help. Contributions retain the license applicable to the files they change; this project does
not require a copyright assignment or a new contributor license agreement. See [LICENSES.md](LICENSES.md).
