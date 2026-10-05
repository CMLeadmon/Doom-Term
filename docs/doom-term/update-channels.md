# Update channels

Doom Term does not update itself and makes no update checks. Each platform has a package channel
that you update with one command. Every channel points at the files of a GitHub release, and the
`SHA256SUMS.txt` on that release is the checksum all three are verified against.

> **Status: not live yet.** This page describes what the release pipeline builds and what the
> maintainer sets up once. It changes to "live" when the first release is promoted to the channels.

## Install and update

| Platform | Install once | Update |
| --- | --- | --- |
| Linux x86_64 | Download `DoomTerm-x86_64.AppImage` from a release, `chmod +x` it, and run it | `appimageupdatetool DoomTerm-x86_64.AppImage` |
| Windows x86_64 | `scoop bucket add doomterm https://github.com/CMLeadmon/scoop-doomterm`, then `scoop install doomterm` | `scoop update doomterm` |
| macOS Apple silicon | `brew install --cask CMLeadmon/doomterm/doomterm` | `brew upgrade --cask doomterm` |

The Linux tarball, the Windows installer and zip, and the macOS DMG and zip stay on every release.

### Linux: AppImage

- The AppImage uses your system's libraries exactly as the tarball does, so it has the same
  Ubuntu 24.04 baseline. It adds updating, not portability.
- AppImages need FUSE 2 (`libfuse2`). Without it, run `APPIMAGE_EXTRACT_AND_RUN=1 ./DoomTerm-x86_64.AppImage`.
- `appimageupdatetool` is the command-line tool of the
  [AppImageUpdate](https://github.com/AppImageCommunity/AppImageUpdate) project. It downloads only the
  blocks that changed. In a test from v1.1.5 to v1.1.6 it reused about 52 MB and fetched about 60 MB
  of a 94 MB file; the saving depends on how much the binary changed.
- The previous file is kept next to the new one as `DoomTerm-x86_64.AppImage.zs-old`, which is your
  rollback.
- The updater warns that the AppImage is not signed. Releases are checksummed, not GPG-signed.
- The AppImage is published from the first release after v1.1.8. Earlier releases have the tarball only.

### Windows: Scoop

- Scoop installs the standalone zip, `doomterm-windows-x64.zip`. It does not run the installer, so
  integrations that only the installer registers, such as the Explorer folder context-menu entries,
  are not set up. Use `DoomTermSetup.exe` if you want them.
- Release builds are unsigned.

### macOS: Homebrew

- Apple silicon only. The app is unsigned and not notarized, so macOS blocks the first launch until
  you approve it in System Settings, Privacy & Security, Open Anyway.
- Doom Term has its own tap because Homebrew announced that the main cask repository would disable
  casks that fail Gatekeeper checks from 2026-09-01.

## How a release reaches the channels

1. A `v*` tag runs `Doom Term CI & Release`, which builds every platform and publishes the release,
   including `DoomTerm-x86_64.AppImage` and its `.zsync` file.
2. When that workflow finishes, `Doom Term Channels` starts. It resolves the release, renders the
   Scoop manifest and Homebrew cask from the release's `SHA256SUMS.txt`, and verifies three things on
   real runners:
   - Linux: the AppImage matches its checksum, carries the update address, has a `.zsync` file for
     itself, and reports the release's version. When an earlier release has an AppImage, the
     updater turns that file into this one.
   - Windows: Scoop installs the manifest and `doomterm.exe --version` reports the release's version.
   - macOS: Homebrew installs the cask and the app's `--version` reports the release's version.
3. `promote` runs in the `channels` environment and waits for the maintainer's approval. It then
   commits the generated manifests to `CMLeadmon/scoop-doomterm` and `CMLeadmon/homebrew-doomterm`.
   It does nothing when a channel is already at the version and refuses to move a channel backwards.
4. A pull request that changes this pipeline runs the checks in step 2 against the latest release and
   promotes nothing.

The channel repositories hold only generated files. To change a manifest, change
`script/doomterm/channel_manifests.py`.

## Maintainer runbook

- **Approve a promotion:** open the `Doom Term Channels` run, choose Review deployments, and approve
  `channels`.
- **Run it again for a tag:** `gh workflow run doomterm-channels.yml -f tag=v1.1.9`. For a release
  made before the AppImage existed, add `-f require_appimage=false`.
- **Rotate the token:** create a fine-grained personal access token owned by `CMLeadmon`, limited to
  the two channel repositories, with Contents set to Read and write, and an expiry date. Store it with
  `gh secret set CHANNELS_TOKEN --env channels --repo CMLeadmon/Doom-Term`. Set a reminder two weeks
  before it expires; an expired token fails the `promote` job, not the release.
- **Roll a channel back:** revert the manifest commit in the channel repository. Do not re-run an
  older tag; `promote` refuses it. The next release promotes normally.
- **Releases marked latest** must carry the AppImage and its `.zsync` file, because the AppImage's
  update address is the latest release. `resolve` fails the run when either is missing.

## Known limits

- The AppImage installs under `/opt/warpdotdev/warp-terminaldoomterm/` inside itself, because the
  upstream packaging script builds that name from the binary name. It is cosmetic, and fixing it means
  editing a shared upstream script.
- The AppImage carries the same static `THIRD_PARTY_LICENSES.txt` fallback text as other builds
  made without `cargo-about`, not a per-build list.
- The Windows and macOS channels are verified on GitHub-hosted runners only. No physical Windows or
  Mac machine is part of the release checks.
- There is no winget package, no Intel macOS build and no code signing.
- The first AppImage release cannot test updating, because no earlier AppImage exists. The second
  one does.
