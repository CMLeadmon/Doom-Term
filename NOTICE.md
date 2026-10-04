# Attribution and third-party notices

## Upstream

Doom Term is an independent fork of [Warp](https://github.com/warpdotdev/warp), originally developed
by Denver Technologies, Inc. Existing upstream copyright notices, including the notice in
[LICENSE-MIT](LICENSE-MIT), are retained. [The upstream baseline](docs/doom-term/upstream-base.txt)
and [merge procedure](docs/doom-term/upstream-merge.md) record the fork's provenance.

Doom Term uses its own application name, channel, icons, and bundle identity. References to Warp
identify the upstream project or retained implementation. This project is not affiliated with or
endorsed by Warp, id Software, or ZeniMax Media. Their names and marks remain with their owners.

## Notices retained in the tree

This list is a navigation aid, not an exhaustive dependency bill of materials:

- [Alacritty terminal-model notice](crates/warp_terminal/src/model/LICENSE-ALACRITTY)
- [GitHub Desktop notice used by code-review assets](app/src/code_review/GITHUB-DESKTOP-LICENSE)
- [Windows Terminal notice](app/assets/windows/LICENSE-WINDOWS-TERMINAL)
- [DirectX Shader Compiler notice](app/assets/windows/LICENSE-DXC)
- [Roboto font license](app/assets/bundled/fonts/roboto/LICENSE.txt)
- [Hack font license](app/assets/bundled/fonts/hack/LICENSE.md)
- [bash-preexec notice](app/assets/bundled/bootstrap/bash-preexec-LICENSE.md)

Dependencies and other bundled material retain their own license terms, including notices in their
source and distributions. Preserve those notices when packaging or redistributing affected material.

## Optional theme media

Redsky, Blue Highway, and Canopy are generated theme artwork. Replay and BFR include recordings of
Doom gameplay. The game art and levels are third-party material belonging to id Software; those
recordings are not represented as AGPL or MIT assets.

[Replay's asset note](themes/replay/README.txt) identifies its shareware source.
[BFR's asset note](themes/bfr/README.txt) identifies its full-game source and explains that the WAD
is not bundled. The application license does not license the game's data or trademarks. Any reuse
of third-party media must be assessed separately against the rights in that material.
