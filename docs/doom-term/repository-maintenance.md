# Repository maintenance

## October 2026 review

The review found stale product status and build claims, upstream-only contribution requirements,
issue/support/security links routed to Warp, missing documentation navigation, ambiguous presentation
of license boundaries, and no explicit agent contribution policy. The active CI granted write access
to build jobs, used mutable action references, and Dependabot expected Warp's private registry.

The remediation updates the product overview with native screenshots and accurate feature status,
adds install/development/architecture navigation, adapts contribution and reporting templates,
clarifies existing licenses and media attribution, and establishes a review-and-evidence policy
for agent-assisted work. Build jobs use read access; only release publication uses content write
access. Active actions are pinned to commit IDs. Dependabot uses public repository access and
bounded update groups. Doom Term-owned crates inherit the existing workspace license explicitly.

The model for presentation and contributor accountability was
[PostHog's README](https://github.com/PostHog/posthog/blob/master/README.md),
[contribution guide](https://github.com/PostHog/posthog/blob/master/CONTRIBUTING.md),
[license layout](https://github.com/PostHog/posthog/blob/master/LICENSE), and
[AI policy](https://github.com/PostHog/posthog/blob/master/AI_POLICY.md), reviewed October 2026.
The prose is specific to Doom Term; its inherited licenses are retained.

## Keep it accurate

- Keep README claims aligned with release notes and revision-specific evidence.
- Label unreleased captures and features; never use a mockup as a product screenshot.
- Check documentation links, image paths, issue forms, and support routes after moving files.
- Preserve license scope, upstream notices, and separate third-party media rights.
- Record upstream-shared edits in the ledger and run its checker.
- Keep dependency updates bounded and reviewed; do not reintroduce upstream private credentials.
- Pin active workflow actions and keep credentials and write permissions out of build-only jobs.
- Keep secret scanning, push protection, and private vulnerability reporting enabled on GitHub.
- Merge reviewed changes independently of releases; honor the theme-work release hold.

The upstream workflows remain available for provenance and upstream merges. Their internal services
are not prerequisites for contributing to Doom Term. The fork's active CI is
[doomterm-ci.yml](../../.github/workflows/doomterm-ci.yml).
