# Roadmap and release status

This page records release content and the publication process. It is not a release schedule.
The GitHub releases page is the source of truth for published versions and downloads.

## v1.1.8 baseline

v1.1.8 provides the local Doom Term desktop build, status plate, supported agent-status
integrations, and optional theme packs. Platform artifacts cover Linux x86_64, macOS ARM64, and
Windows x86_64. [Release notes](../../RELEASE_NOTES.md) record the changes and their limits.

[PR #11](https://github.com/CMLeadmon/Doom-Term/pull/11) restores group creation and installed-shell
selection, retains empty groups across restart, and adds local/SSH group defaults for future tabs
and splits. It has native Linux evidence and successful builds across the release platform matrix.
It shipped in v1.1.8. [Usage](tab-groups.md) · [Evidence](../../evidence/tab-groups/report.html).

## v1.1.9 additions

[PR #18](https://github.com/CMLeadmon/Doom-Term/pull/18) adds Linux x86_64 AppImage packaging and
matching zsync update metadata alongside the tarball, with both included in release checksums. It
also adds checksum-derived Scoop and Homebrew manifests, native installation/version checks, and
approval-gated promotion. Doom Term still makes no update checks and does not update itself.
[Update channels](update-channels.md) explains the external tools and platform limits.

The public Scoop bucket and Homebrew tap are live at v1.1.8. Token setup and the first protected
promotion are complete. v1.1.8 has no AppImage; v1.1.9 is the first AppImage release. A real upgrade
between published AppImages requires a later release and remains unverified.

## Publication process

v1.1.9 release notes are finalized for the maintainer-authorized release. The tag workflow rebuilds
Linux, macOS and Windows packages and publishes after the complete matrix passes; the channel
workflow checks the published packages before protected promotion. The GitHub release page is the
source of truth for publication and downloads.

A merge to `main` runs CI and does not publish a release.
Do not create a version tag or dispatch release publication during routine maintenance.

## Propose the next improvement

Use [feature requests](https://github.com/CMLeadmon/Doom-Term/issues/new?template=02_feature_request.yml)
to explain a concrete workflow, alternatives, and expected behavior. Reliability, accessibility,
clear status signals, and preservation of the local product boundary guide review.

Historical milestone plans live in [implementation-plan.md](implementation-plan.md). Retired
material-system mockups describe earlier design exploration, not committed future shipping work.
