# Security policy

## Report privately

Use [GitHub private vulnerability reporting](https://github.com/CMLeadmon/Doom-Term/security/advisories/new)
for suspected vulnerabilities in Doom Term. Do not disclose an unpatched vulnerability in a public
issue, PR, screenshot, or agent transcript.

Include the affected release or commit, platform, reproducible steps or a minimal proof of concept,
expected security boundary, and impact. Redact real credentials and personal data. The maintainer
will assess the report and coordinate a fix and disclosure; this community project does not promise
a response deadline or a paid bug bounty.

## Supported versions

Security fixes target current `main` and the latest published release. Older releases have no
separate maintenance branch. A documented release hold does not prevent evaluating a security report;
any exceptional release requires an explicit maintainer decision.

## Scope

Relevant boundaries include terminal escape handling, local process and filesystem access,
SSH command construction, persistence, update artifacts, and agent-status input. Doom Term excludes
Warp's hosted service implementations from its product build. Independently installed agents and
remote services have their own security policies.

For a vulnerability specific to upstream Warp, use [Warp's security policy](https://github.com/warpdotdev/warp/blob/master/SECURITY.md).
Do not send Doom Term-specific reports to Warp's support team.
