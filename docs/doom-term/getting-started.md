# Getting started

## Choose a build

[GitHub Releases](https://github.com/CMLeadmon/Doom-Term/releases/latest) is the source for published
installers, archives, theme packs, agent-status helpers, and checksums. The latest published release
is v1.1.8. It includes persistent tab groups, shell selection, and local/SSH group defaults.

| Platform | Published package | Requirements |
| --- | --- | --- |
| Linux x86_64 | `doomterm-linux-x86_64.tar.gz` | Ubuntu 24.04 ABI baseline; a graphical desktop and required system libraries |
| macOS Apple silicon | `doomterm-macos-arm64.dmg` or `.zip` | Apple silicon; see the release for signing and platform limitations |
| Windows x86_64 | `DoomTermSetup.exe` or `doomterm-windows-x64.zip` | Windows x86_64; see the release for platform limitations |

There is no published Intel macOS package in the current release matrix. Native execution coverage
varies by feature; successful platform builds do not imply every GUI interaction was tested there.

## Install

Download the package and `SHA256SUMS.txt` from the same release. Compare the package's SHA-256
with its entry in that file. On Linux use `sha256sum`; on macOS use `shasum -a 256`; on Windows
use PowerShell `Get-FileHash -Algorithm SHA256`.

- **Linux:** extract the tarball and run the included `doomterm` binary. The archive also contains
  the desktop entry and icon for manual integration. Install missing runtime libraries if the
  loader reports them; the source build container lists the Ubuntu baseline dependencies.
- **macOS:** open the DMG and install DoomTerm.app, or extract the application ZIP. Follow the
  release's instructions for an unsigned application if applicable; verify the source and checksum
  before approving a downloaded binary.
- **Windows:** run the installer, or extract the entire standalone ZIP and run `doomterm.exe`.
  Keep the accompanying files next to the executable.

Open the app and start a terminal. No Warp account is required. Select your shell and theme through
Settings. Your shell configuration and external tools remain your own.

## Add agent status

[Remote agent status](remote-agent-status.md) explains the optional helpers and integrations.
Only supported agents with the required status setup expose all fields. Empty or unavailable
fields are not evidence that an agent has no usage or no work in progress.

## Add themes

See [the theme guides](README.md#themes). Theme archives are separate from the application and
can be removed independently. Gameplay packs carry separate third-party media rights.

## Try changes on main

Build from source using [the development guide](development.md). For persistent groups and
configured directories, follow [the tab-group guide](tab-groups.md). Real SSH authentication remains
interactive in the terminal; group configuration does not store your password.

For troubleshooting, use [SUPPORT.md](../../SUPPORT.md). For private vulnerability reporting, use
[SECURITY.md](../../SECURITY.md).
