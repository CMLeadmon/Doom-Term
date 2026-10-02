# Blue Highway and Canopy themes: design

Status: **released as theme packs on 2026-10-02**, attached to the v1.1.6 release. Install notes, measured cost and the
regeneration commands are in [`docs/doom-term/blue-highway-and-canopy-themes.md`](../../doom-term/blue-highway-and-canopy-themes.md).
Both were reviewed as a live proposal board before this record was written.

## Goal

Two more optional animated themes in Redsky's form: a looping 480 x 300 background, its own palette, and a tinted
status plate, shipped as theme packs. A blue one built on a fixed tractor-trailer in the West Virginia mountains, and a
green one set in the Amazon rainforest.

## Decisions

| Decision | Choice |
| --- | --- |
| Blue theme | **Blue Highway**: a tractor-trailer that never changes position on a ridge road at misty dawn. Everything else scrolls left; the sun never moves, as in Redsky |
| Branding | Inspired by Blue Ink Tech's colours only (navy `#15295a`, steel `#104673`, bright blue `#2196f3`, orange `#f37327`). The trailer carries no lettering and no pack text names the company |
| Mountains | Dark green, in three layers with mist, not grey |
| Green theme | **Canopy**: the inside of an Amazon forest, drawn from below the leaf ceiling. Busy by request: a scarlet macaw crossing once per loop, a spider monkey swinging, blue morphos, and a floor with a mossy log and frog, mushrooms, ferns and a puddle |
| Image opacity | **10** for both, as Redsky |
| Plate stone | Slate navy `#1a304d` for Blue Highway and deep moss `#1b3c2c` for Canopy, derived with the shipped `plate_stone` recipe; bevels, wells and labels untouched |
| Delivery | Theme packs attached to the existing v1.1.6 release, and packaged by CI from the next tag on |
| Content rules | Every pixel generated; no borrowed assets; no game vocabulary in any label |

## Design

- **Palette-index rendering.** A frame is a buffer of indices into a fixed palette (179 and 165 colours), so it cannot
  exceed what the GIF writer accepts. Measured: at most 155 and 156 colours in any frame.
- **Seamless loops.** Every scrolling layer moves a whole number of its own tiles per loop, and every other motion
  is periodic in the loop phase. Phase terms go through a `fract` rounded to 1e-9, because frame 100 otherwise differed
  from frame 0 by a pixel at a rounding threshold.
- **Silhouettes.** Sprites (the rig, the macaw, the monkey, the morphos) are drawn on a transparent layer and composited
  with a one-pixel dark outline, which is how the pixel vehicles used as references are drawn. The references were an
  animated pixel van (CC BY, measured frame by frame), pixel refuse and delivery trucks, and a CC0 vector set. They were
  studied, not copied. No animated 2-D semi-truck was found.
- **The rig.** Its left and right edges stay at x=84 and x=437 in all 100 frames; only its top row moves, by one pixel,
  on a four-state bob. Wheels turn 18 degrees per frame.
- **Light and mist in Canopy** are static in position and periodic in time: a fan of light shafts slides one spacing per
  loop, and two mist layers drift opposite ways.

## Deviation from the proposal

The board's build plan ported both generators to Rust in `crates/doomterm_backdrop`. They were not ported: the
approved art is the JavaScript that rendered the board, and a port would have to be re-reviewed pixel for pixel for no
change to what ships. The generators are committed in `script/doomterm/themegen/` and the committed GIFs are checked
against them in CI (`bake.js --check`, tolerant of last-bit floating point differences). A Rust port stays possible.

## Verification

- `bake.js --check`: the loop closes, no frame exceeds 256 colours, rendering is deterministic, the rig's extent is
  fixed, and each committed GIF matches a fresh render. Passed 30 runs in a row.
- `crates/doomterm_backdrop/tests/pack.rs`: for all three packs, the keys the loader needs, the agreed values, a readable
  foreground, the image path, the exact file list, no game vocabulary, no third-party branding.
- `test_package_theme.py`: layout, reproducible bytes, and that every pack's GIF is 480 x 300.
- Live, with the **published v1.1.6 build** in the headless KWin lab: both themes load, the palettes apply, the backgrounds
  change between screenshots (about 70 to 76% of background pixels at opacity 100, 4 to 14% at the shipped 10), the plate
  stone is tinted with grey bevels, and text is clearly legible at the shipped opacity. Memory rose by 60 and 61 MiB.

## Not established

- Frame cadence and GPU cost on a real display (the headless compositor cannot show cadence).
- How a pane that is not 16:10 treats the image.
- The themes folder on macOS and Windows.
- Whether delta-frame GIFs decode correctly in the application. They would cut Canopy from 5.57 MB to 2.50 MB, but the
  shipped packs use full frames, the path already proven in the application.
