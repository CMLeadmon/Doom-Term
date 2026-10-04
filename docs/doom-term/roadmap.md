# Roadmap and release status

This page separates published behavior, merged changes, and work in progress. It is not a release
schedule. The maintainer decides when a verified candidate is ready to publish.

## Published: v1.1.7

The current release provides the local Doom Term desktop build, status plate, supported agent-status
integrations, and optional theme packs. Platform artifacts cover Linux x86_64, macOS ARM64, and
Windows x86_64. [Release notes](../../RELEASE_NOTES.md) record the changes and their limits.

## Merged on main

[PR #11](https://github.com/CMLeadmon/Doom-Term/pull/11) restores group creation and installed-shell
selection, retains empty groups across restart, and adds local/SSH group defaults for future tabs
and splits. It has native Linux evidence and successful builds across the release platform matrix.
These changes are newer than v1.1.7. [Usage](tab-groups.md) · [Evidence](../../evidence/tab-groups/report.html).

## In progress

Local theme work is not complete. The next Doom Term release is on hold until that work is finished
and its candidate is verified. A merge to `main` runs CI and does not publish a release.
Do not create a version tag or dispatch release publication during routine maintenance.

## Propose the next improvement

Use [feature requests](https://github.com/CMLeadmon/Doom-Term/issues/new?template=02_feature_request.yml)
to explain a concrete workflow, alternatives, and expected behavior. Reliability, accessibility,
clear status signals, and preservation of the local product boundary guide review.

Historical milestone plans live in [implementation-plan.md](implementation-plan.md). Retired
material-system mockups describe earlier design exploration, not committed future shipping work.
