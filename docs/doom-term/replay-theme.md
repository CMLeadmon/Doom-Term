# Replay theme pack

An optional animated theme for Doom Term, in the same form as [Redsky](redsky-theme.md) and the
[Blue Highway and Canopy](blue-highway-and-canopy-themes.md) packs: a **theme pack** (a YAML file, a GIF and a short
install note), not part of the application. A Doom Term that never installs it is unchanged, and it needs no
application changes. It differs from the others in one way: nothing in it is drawn here. It is a recording of real
gameplay.

Design and decisions: [`docs/superpowers/specs/2026-10-02-replay-theme-design.md`](../superpowers/specs/2026-10-02-replay-theme-design.md).

| Asset | What it shows |
| --- | --- |
| `doomterm-replay-theme.zip` | About eleven seconds of Doom (1993) gameplay: a long corridor of steps, a pistol fight, an explosion, an imp that walks at the player and a demon that charges. A screen melt closes the loop. The plate keeps its standard grey. |

## Where the footage comes from

- **The game's own demo.** The footage is the second demo built into the shareware version of Doom, frames 910 to 1248
  of 3836. A demo is a list of keypresses, so an engine that follows the Doom 1.9 rules draws exactly the frames the
  game drew in 1993. The data file is `DOOM1.WAD`, the freely distributable shareware release, version 1.9 (4,196,020
  bytes, SHA-1 `5b2e249b9c5133ec987b3ea77596381dc0d6bc1d`).
- **An unmodified engine.** The engine is Chocolate Doom 3.1.1, run with no display. A small library loaded beside it
  copies the frames it hands to SDL; it contains no Doom code. See
  [`script/doomterm/doomcap/`](../../script/doomterm/doomcap/README.md).
- **Whose it is.** The art, levels and demo belong to id Software. Doom Term is an independent project and is not
  affiliated with, endorsed by or sponsored by id Software or ZeniMax Media. The pack is a separate, optional download:
  deleting its folder removes it, and nothing else in Doom Term uses it.

## Install

Download the zip from the release and check it against that release's `SHA256SUMS.txt`. Extract it into Doom Term's
themes folder so a `replay` folder ends up inside it:

| Platform | Themes folder |
| --- | --- |
| Linux | `~/.local/share/doomterm/themes/` |
| macOS, Windows | not yet verified |

Doom Term watches that folder, so the theme appears without a restart: Settings, Appearance, Themes, **Replay**. As
with the other packs, a theme finds its animation by the path `replay/replay.gif` **under the themes folder**; moving only
the YAML elsewhere loads the theme with a flat background and no animation. To remove the pack, delete the `replay`
folder.

## What it looks like

It ships at image opacity **30**, so the footage is clearly visible and stays behind the text. Edit `opacity` in the YAML
to change it. Measured with the same method as the Blue Highway and Canopy table (the foreground against the brightest
tenth of the picture, worst case over **every** frame of the loop):

| Pack | At its shipped opacity | Stays above 7:1 up to | Stays above 4.5:1 up to |
| --- | --- | --- | --- |
| Replay | 9.2:1 at 30 | 47 | 73 |

The colours come from the footage: a warm near-black background, bone-coloured text, a red accent and an amber cursor.
Every terminal colour reads on the background at 4.6:1 or better, except the two blacks, which are meant to be dim.

## Cost

Measured in the headless KWin lab with private settings. With the v1.1.5 build, resident memory rose from **219.8 MB to
279.7 MB**, about 58.5 MiB, with the pack active; with the published v1.1.7 build and the published zip it rose from
**217.6 MB to 280.0 MB**, about **60.9 MiB**, in line with the other packs. That is the decoded frames
(320 x 240 x 4 bytes x 186, 54.5 MiB) plus overhead. The GIF is 5.1 MiB. With each build, ten screenshots taken a second
apart showed ten different backgrounds, so the animation runs. Frame cadence and GPU cost on a real display have not
been measured. The picture is scaled up by a linear sampler, so it looks soft rather than blocky.

## How it is made

```sh
script/doomterm/doomcap/capture.sh DOOM1.WAD demo2 910 1248 2 target/replay/frames.bin
node script/doomterm/doomcap/build.js --frames target/replay/frames.bin --wad DOOM1.WAD --demo demo2 \
  --engine "Chocolate Doom 3.1.1 (Fedora 42 package), SDL dummy video driver"
node script/doomterm/doomcap/check.js
```

- **Frames.** Every second game tic is kept, which is 17.5 frames a second. The app clamps a frame's delay to 50 ms, so
  20 is the most it can show. The delays alternate 6, 6, 6, 6, 6, 5 and 5 hundredths of a second so that seven frames
  last exactly the 14 tics they stand for.
- **Colour.** A Doom frame has at most 256 colours, and the GIF writer gives each frame its own exact colour table, so no
  frame is quantised or dithered. The most in any frame is 200.
- **Shape.** The game draws 320 x 200 and was meant to be seen at 4:3. Rows are repeated, 40 of them, to give 320 x 240
  without making a new colour.
- **The seam.** A screen melt, the transition the game plays between a level and its intermission, runs from the last
  frame of play back to the first, so the loop closes without a cut. It is written from how the transition behaves, in
  [`melt.js`](../../script/doomterm/doomcap/melt.js). The step into the melt changes 13% of the picture's pixels and the
  step out of it 0.7%, against 76% for an ordinary step of play.

CI cannot rebuild the loop, because it has neither the engine nor the game data. It checks what it can on every push with
`node script/doomterm/doomcap/check.js`: the committed GIF is the one `replay.manifest.json` recorded (by SHA-256), it is
320 x 240 with the 17.5 frames a second delays, loops forever, has at most 256 colours in a frame, decodes to under 60 MiB,
has a seam smoother than the play on either side of it, and keeps the contrast the pack's README promises. The pack
contract (keys, values, files, no game vocabulary, the non-affiliation line) is tested in
`crates/doomterm_backdrop/tests/pack.rs`.
