# Replay theme: design

Status: **released as a theme pack with v1.1.7**. Install notes, the measured cost and the rebuild commands are in
[`docs/doom-term/replay-theme.md`](../../doom-term/replay-theme.md). The choice between sources was made from a
side-by-side comparison page; this record starts from that choice.

## Goal

An optional animated theme whose background is a loop of real Doom (1993) gameplay, in the form of Redsky, Blue Highway
and Canopy: a theme pack, a looping background and a palette, with no application change.

## Decisions

| Decision | Choice |
| --- | --- |
| Source of the pixels | **Option B** of the comparison: the real engine drawing the game's own art, from a Doom data file. The alternatives were Freedoom data in the same engine (option A, redistributable art that is not Doom's) and a fully generated renderer (option C) |
| Assets | id Software's art is allowed from this theme on. This is the project owner's decision, made with the comparison in front of them, and replaces the earlier rule that every pixel is generated. The rule against game vocabulary in labels stands, and so does the README's non-affiliation line |
| Data file | The shareware `DOOM1.WAD`, version 1.9, which id Software distributes freely. The tool accepts any Doom 1.9 data file |
| Engine | Chocolate Doom 3.1.1, unmodified, from the Fedora 42 package. Run with no display, through SDL's dummy video driver |
| Footage | The second built-in demo, game tics 910 to 1248, every second tic: 170 frames, 17.5 a second, 9.7 seconds. Chosen from contact sheets of all three demos for a complete arc (a corridor, an explosion, two imps, a charging demon) and for being dark throughout |
| Seam | A screen melt from the last frame back to the first, 16 frames. The demo cannot be made to loop, and a dissolve would need colours a frame cannot hold |
| Shape | 320 x 240: rows repeated from the game's 320 x 200, because the game was meant to be seen at 4:3 |
| Size | 186 frames, 5.1 MiB, 54.5 MiB decoded. The same cost as the other packs |
| Image opacity | **30**, where the others ship at 10. A recording of gameplay that is a faint ghost at 10 reads as a broken theme. The text keeps 9.2:1 against the brightest tenth of the picture there, and 7:1 up to 47 |
| Plate | Untouched. The game's own status bar is grey, and so is the plate |
| Name | **Replay**: neutral, and exactly what a demo is |
| Delivery | A theme pack, packaged by CI from the tag, like the others |

## Design

- **A shim, not a patch.** Chocolate Doom gives SDL one frame per game tic. A library preloaded into the stock binary
  copies those frames to a file. Version 3.1 writes into a locked texture and 3.0 calls `SDL_UpdateTexture`, so the shim
  hooks both. It contains no Doom code, so there is nothing to keep in step with the engine and nothing under the engine's
  licence in this repository.
- **No display.** `-timedemo` plays a demo as fast as the machine allows and draws every tic, which gives a complete,
  repeatable stream: the 3836-tic demo plays in about a second and a half. SDL's dummy driver offers only the software
  renderer, which reports a maximum texture size of 0 to mean "no limit"; Chocolate Doom reads that as a limit of nothing
  and exits with no message. The shim reports a real limit when it sees 0. The first attempt used `SDL_UpdateTexture`
  alone and captured nothing, because 3.1 does not call it; a trace of the engine's SDL bindings found the lock and
  unlock calls.
- **No quantising.** A Doom frame has at most 256 colours and the GIF writer gives each frame an exact colour table, so
  the loop is the game's own pixels. The kit's writer gained a delay per frame, and its decoder returns the delays;
  existing callers pass a number and are unchanged (`bake.js --check` still passes).
- **The melt.** Written from how the transition behaves, not copied: columns two pixels wide start staggered up to 15 tics
  early, wait, then fall 1, 2, 4 and 8 rows and then 8 a tic, uncovering the second screen from the top while the first
  slides down. A fixed-seed generator makes it repeatable. It ends on the frame that is all but the next screen, so the
  loop never holds a repeated frame.
- **Frame timing.** Delays of 6, 6, 6, 6, 6, 5 and 5 hundredths of a second make seven frames last the 14 tics they stand
  for, and never fall below the 50 ms the app allows. The cumulative drift stays within 20 ms of true time.
- **What CI can check.** Not a rebuild, because CI has neither the engine nor the game data. It decodes the committed GIF
  and checks it against `replay.manifest.json` (SHA-256 and shape), the timing, the colours per frame, the memory budget,
  the seam and the contrast. A byte flipped in the GIF fails it.

## Verification

- 15 unit tests for the data-file and demo readers, the frame stream, the melt, the aspect rows, the delays, a GIF
  round trip and the contrast measure. The test that compiles the shim runs where SDL2's headers exist and passed in the
  container.
- `cargo test`, `clippy -D warnings` and `rustfmt` on `doomterm_backdrop` with the pack contract extended to Replay
  (its own opacity, no plate tint, a README that names the source and disclaims affiliation).
- The packager's tests, the build policy and the inventory ledger, which now declares `themes/replay/`.
- Run in an isolated headless KWin lab with the v1.1.5 build: the theme loads from the themes folder, ten screenshots a
  second apart show ten different backgrounds, the text is readable over them, and resident memory rose from 219.8 MB to
  279.7 MB.
- The contrast figures come from the same measure as the Blue Highway and Canopy table. The measure reproduces that table's
  12.1:1 and 13.3:1 (13.2:1 published) at opacity 10, with ceilings within one five-point step.

## Not verified

Frame cadence and GPU cost on a real display; the themes folder on macOS and Windows; builds of Chocolate Doom other than
3.1.1; a full (not shareware) data file.
