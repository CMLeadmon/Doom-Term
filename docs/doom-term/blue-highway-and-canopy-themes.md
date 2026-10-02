# Blue Highway and Canopy theme packs

Two optional animated themes for Doom Term, in the same form as [Redsky](redsky-theme.md): a **theme pack** (a YAML
file, a GIF and a short install note), not part of the application. A Doom Term that never installs them is unchanged,
and they need no application changes: the loader, the background-image path and the `plate_stone` key all shipped by
v1.1.6. Everything in them is generated here; nothing is taken from a game or another project.

Design and decisions: [`docs/superpowers/specs/2026-10-02-blue-highway-canopy-themes-design.md`](../superpowers/specs/2026-10-02-blue-highway-canopy-themes-design.md).

| Pack | Asset | What it shows |
| --- | --- | --- |
| Blue Highway | `doomterm-bluehighway-theme.zip` | A tractor-trailer holds its place on a mountain road while a misty West Virginia dawn runs past: dark green ridges, a steel arch bridge that crosses the sun, a barn and silo, utility poles, a flock of birds. The rig and the sun never move. |
| Canopy | `doomterm-canopy-theme.zip` | The inside of an Amazon forest: trunks in mist under a leaf ceiling, light shafts sliding through a gap, a scarlet macaw crossing once per loop, a spider monkey swinging, blue morphos, and a floor with a mossy log and frog, mushrooms, ferns and a puddle. |

## Install

Download the zip from the release and check it against that release's `SHA256SUMS.txt`. Extract it into Doom Term's
themes folder so a `bluehighway` or `canopy` folder ends up inside it:

| Platform | Themes folder |
| --- | --- |
| Linux | `~/.local/share/doomterm/themes/` |
| macOS, Windows | not yet verified |

Doom Term watches that folder, so the theme appears without a restart: Settings, Appearance, Themes, **Blue Highway** or
**Canopy**. As with Redsky, a theme finds its animation by the path `<pack>/<pack>.gif` **under the themes folder**;
moving only the YAML elsewhere loads the theme with a flat background and no animation. To remove a pack, delete its
folder.

## What they look like

Both ship at image opacity **10**, a faint ghost behind the text. Edit `opacity` in the YAML to change it. Measured
worst-case contrast of the foreground against the brightest tenth of the art, over ten sampled frames of the loop:

| Pack | At opacity 10 | Stays above 7:1 up to | Stays above 4.5:1 up to |
| --- | --- | --- | --- |
| Blue Highway | 12.1:1 | 25 | 40 |
| Canopy | 13.2:1 | 35 | 55 |

The YAML carries a `plate_stone` key that recolours the status plate's stone (`#1a304d`, a slate navy, for Blue Highway;
`#1b3c2c`, a deep moss, for Canopy). It needs Doom Term v1.1.6 or later; earlier builds ignore it and keep the grey plate.

## Cost

Measured with the published v1.1.6 build in the headless KWin lab: resident memory rose by about **60 MiB** with Blue
Highway and **61 MiB** with Canopy over the default theme (212 MiB), in line with the decoded frames
(480 x 300 x 4 bytes x 100). The GIFs are 3.99 MB and 5.57 MB. Frame cadence and GPU cost on a real display have not been
measured.

## How they are made

Each background is a pure function of the loop frame, written in `script/doomterm/themegen/` (no GPU, no clock, no
randomness beyond a fixed integer hash). A frame is rendered into palette indices, so it can never hold more than the
palette's colours; the GIF writer gives every frame its own exact colour table and refuses a frame over 256 colours.
Every time-dependent term is periodic in the loop phase, so frame 100 equals frame 0.

```sh
node script/doomterm/themegen/bake.js            # writes themes/bluehighway/bluehighway.gif and themes/canopy/canopy.gif
node script/doomterm/themegen/bake.js --check    # what CI runs: loop closes, 256 colours, rig fixed, committed GIFs match
python3 script/doomterm/package_theme.py canopy  # writes target/canopy/doomterm-canopy-theme.zip, prints its SHA-256
```

`--check` also decodes each committed GIF and compares it with a fresh render, allowing 0.2% of a frame's pixels to
differ so that last-bit floating point differences between JavaScript engines cannot fail the build. The zips are
reproducible: building one twice gives identical bytes. The pack contract (keys, values, files, no game vocabulary,
no third-party branding) is tested for all three packs in `crates/doomterm_backdrop/tests/pack.rs`.

These generators are JavaScript, not Rust like Redsky's, because they were designed and approved as a live preview. A
Rust port into `crates/doomterm_backdrop` is possible but is not needed to ship them.
