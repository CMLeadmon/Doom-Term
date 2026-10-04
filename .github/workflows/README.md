# GitHub workflows

## Doom Term

[doomterm-ci.yml](doomterm-ci.yml) is the fork's active build and packaging workflow. Pull requests
and pushes to `main` run policy checks, focused tests, lint, and the Linux x86_64, macOS ARM64,
and Windows x86_64 build matrix. Build jobs have read-only content access. Only the release job
has content write permission, and checkouts do not retain credentials.

Publishing requires a `v*` tag or an explicit manual dispatch with `publish_release=true`.
Routine merges and build dispatches do not publish. The next release is on hold until local theme
work is complete; do not create a tag or use the publication input during routine maintenance.

Actions in the active workflow are pinned to commits. Dependabot proposes bounded public dependency
updates through [dependabot.yml](../dependabot.yml); maintainers review them before merging.

## Retained upstream workflows

Other workflows and `release_configurations.json` are retained from Warp to support provenance
and future upstream merges. Many are guarded for `warpdotdev` or require upstream infrastructure.
They do not define Doom Term's contribution requirements, support channels, or release schedule.
Do not dispatch an upstream release, cloud, or agent workflow to verify the fork.
