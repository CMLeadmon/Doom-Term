# Big Fucking Replay theme pack

An optional animated theme for Doom Term, in the same form as [Replay](replay-theme.md): a **theme pack** (a YAML file, a GIF
and a short install note), not part of the application. A Doom Term that never installs it is unchanged, and it needs no
application changes. Like Replay, nothing in it is drawn here: it is a recording of the real game. It differs from Replay in
three ways. The run is played by a script instead of replaying a demo built into the game, which is how a weapon the
shareware game lacks gets on screen. The level is a hall made for the recording. And its data file is the full game's,
which, unlike the shareware file, is not freely redistributable.

| Asset | What it shows |
| --- | --- |
| `doomterm-bfr-theme.zip` | About nine seconds of Doom (1993) gameplay, all indoors: a player walks up the aisle of a green stone hall and fires the BFG 9000 as fast as it will go at two Cyberdemons on a stage, until both fall. A screen melt closes the loop. The plate keeps its standard grey. |

The pack id is `bfr`, so no expletive lands in a path, a release asset name or a CI log. The name the theme shows in Settings is
the one the maintainer chose, **Big Fucking Replay**.

## Where the footage comes from

- **A hall made for the recording.** [`bfr.pwad.js`](../../script/doomterm/doomcap/bfr.pwad.js) draws a nave from nothing with the
  level kit [`mapkit.js`](../../script/doomterm/doomcap/mapkit.js) and has the `bsp` node builder (BSP 5.2) finish it: 1024 units
  wide and ten bays of 128 units long, a colonnade and tall green torches down an aisle of eight bays, and a stage two bays deep and 32
  units higher in front of a wall of carved faces. It replaces the first map of the first episode, and it holds none of the game's
  own levels, only the names of textures and flats that the data file supplies when it is played. Two Cyberdemons stand on the
  stage. Two invisible fences and the step up keep them between the columns, and the level's reject table hides the player from the
  stage once it is in the last three bays of the aisle, so they stop shooting at point-blank range. The player cannot be hurt.
- **The player.** [`bfr.keys.txt`](../../script/doomterm/doomcap/bfr.keys.txt) is the recorded input: 350 lines. It types the
  game's own cheat codes for survival, for walking through anything in the way and for every weapon, selects the BFG, holds the
  fire key, and then moves the mouse (242 lines) and holds the strafe keys. A program steered the player one game tic at a
  time, reading the state of the last tic from a copy of the engine built to log it, and wrote down what it pressed. The program
  is not in this repository, only its output, so the same script, level and data file draw the same frames every time. The
  footage itself comes from the unmodified packaged engine, and the logging copy was checked to draw identical frames for this clip.
- **The weapon.** The game draws the BFG at the very bottom of the picture. The app crops the picture to the window and covers
  its lower edge with the status plate, so in the first release of this pack only a few pixels of the weapon's top edge showed.
  [`raise_weapon.js`](../../script/doomterm/doomcap/raise_weapon.js) copies the weapon's five sprites out of your data file with one
  number changed in each header, the offset that places the sprite, so the weapon is drawn 34 pixels higher. No pixel of a
  sprite changes. The engine loads the add-on with `-merge`. About half of the weapon now shows above the plate, in a 1280 by 800
  window and in a wide 1600 by 900 one.
- **Brightness.** The game's own gamma setting is raised to 3 (`DOOMCAP_GAMMA=3`), which lifts the picture's mean brightness from
  about 56 to about 93 out of 255 so the hall reads behind the text.
- **The data file.** `DOOM.WAD`, version 1.9: an IWAD of 11,159,840 bytes with 2,194 lumps, SHA-1
  `7742089b4468a736cadb659a7deca3320fe6dcbd` (episodes 1 to 3, no episode 4). It is not in this repository and not in the pack:
  only the pictures the engine drew from it are. Whoever rebuilds the loop supplies their own copy. Replay's source is the
  freely distributable shareware file, and the shareware engine data cannot run this footage at all: it has no BFG, the
  engine refuses to add one to it, and refuses to select it.
- **An unmodified engine.** Chocolate Doom 3.1.1, run with no display. A small library loaded beside it copies the frames
  it hands to SDL, answers its clock and feeds it the key script and mouse movement; it contains no Doom code. See
  [`script/doomterm/doomcap/`](../../script/doomterm/doomcap/README.md).
- **Whose it is.** The art, textures and sounds belong to id Software. Doom Term is an independent project and is not
  affiliated with, endorsed by or sponsored by id Software or ZeniMax Media. The pack is a separate, optional download:
  deleting its folder removes it, and nothing else in Doom Term uses it. Its pictures come from the full game rather than the
  freely distributable shareware file, which the pack's README says.

## Pace

The first release of this pack held the run key for the whole clip, which made the player move nearly twice as fast as Replay's,
and it turned at the keyboard's fastest rate for a third of its frames. This cut walks, as Replay's player does, and the camera turns in
short movements that ease in and out with pauses between them. Both were measured from the engine's own state, per frame of the
GIF (two game tics), because averages hid the difference:

| Measured over the clip | Replay | First release | This cut |
| --- | --- | --- | --- |
| View turn, median frame | 2.8° | 3.5° | 0.9° |
| View turn, fastest tenth of frames | 9.9° | 14.1° | 9.3° |
| Frames that turn faster than 14° | 7% | 33% | 2% |
| Speed on the ground, median (units per tic) | 4.9 | 9.0 | 4.8 |
| Speed on the ground, fastest tenth | 8.9 | 15.3 | 7.6 |
| Top speed (units per tic) | 11.9 | 31.2 | 9.6 |

Replay's view keeps drifting a little between its turns, so its median is higher than this cut's.

## What is in the clip

Seven BFG launches, at frames 172, 212, 252, 292, 332, 372 and 412, one every 40 game tics. The first Cyberdemon falls at frame 364,
6.4 seconds into the loop, and the second at frame 422, 8.1 seconds in. A Cyberdemon is in view in 96% of frames and in the middle
third of the picture in 91%, and it stands about a quarter of the picture's height.

The clip ends at frame 430, with the last ball just away. `idkfa` hands over 300 cells, which is exactly seven shots, and the engine
starts lowering the weapon about fifteen frames after the seventh launch, so there is no more BFG in hand to show. It starts at 140,
thirty-two frames before the first launch, with the player already walking.

## Install

Download the zip from the release and check it against that release's `SHA256SUMS.txt`. Extract it into Doom Term's
themes folder so a `bfr` folder ends up inside it:

| Platform | Themes folder |
| --- | --- |
| Linux | `~/.local/share/doomterm/themes/` |
| macOS, Windows | not yet verified |

Doom Term watches that folder, so the theme appears without a restart: Settings, Appearance, Themes, **Big Fucking Replay**.
As with the other packs, a theme finds its animation by the path `bfr/bfr.gif` **under the themes folder**; moving only the
YAML elsewhere loads the theme with a flat background and no animation. To remove the pack, delete the `bfr` folder.

## What it looks like

It ships at image opacity **30**. Measured with the same method as the other packs (the foreground against the brightest tenth of
the picture, worst case over **every** frame of the loop):

| Pack | At its shipped opacity | Stays above 7:1 up to | Stays above 4.5:1 up to |
| --- | --- | --- | --- |
| Big Fucking Replay | 7.2:1 at 30 | 31 | 43 |

The frames that set the limit are the moments a ball leaves the weapon. No frame is more than 19% near-white. The supporting
colours are the BFG's own greens, taken from the most common saturated greens in the footage: the accent is `#60cc58` and the
cursor `#78fc70`, the brightest green in the weapon's ramp. The background is a green-black, the text a pale green-white, and the
terminal's green and bright green are the same family. Every terminal colour reads on the background at 4.9:1 or better, except
the two blacks, which are meant to be dim (1.2:1 and 4.0:1). The status plate keeps its standard grey stone.

The blasts are bright and sudden, many in every loop. At the shipped opacity they are muted, but they have not been assessed
against a photosensitivity standard. The README that ships in the pack mentions the flashes and says to lower `opacity` or choose
another theme if they bother you.

## Cost

Measured in the headless KWin lab with private settings, the published v1.1.8 build and the published zip: resident memory rose from
**210.5 MiB to 265.9 MiB**, about **55 MiB**, with the pack active (the v1.1.7 build measured 51 to 53 MiB in the same lab). That is the decoded frames
(320 x 240 x 4 bytes x 162, 47.5 MiB) plus overhead. The GIF is 5.6 MiB. Forty-eight screenshots a fifth of a second apart showed 46 different pictures, so the animation
runs, and the weapon and the terminal text were legible in the ones looked at by eye. Twenty-six more in a 1600 by 900 window
showed 21 to 26 different pictures across runs, as the v1.1.7 build also does. Frame cadence and GPU cost on a real display have not been measured. The picture is scaled up by a linear sampler, so it
looks soft rather than blocky.

## How it is made

You need `chocolate-doom` 3.1, `gcc`, the SDL2 development files, Node and the `bsp` node builder (Fedora: `dnf install bsp`).
From the repository root:

```sh
# The hall, and the add-on that raises the weapon (built from your copy of the data file)
node script/doomterm/doomcap/bfr.pwad.js target/bfr/bfr.pwad
node script/doomterm/doomcap/raise_weapon.js DOOM.WAD target/bfr/bfr.sprites.wad

# Frames 140 to 430 of the run, every second one
DOOMCAP_GAMMA=3 script/doomterm/doomcap/play.sh DOOM.WAD "1 1" 4 script/doomterm/doomcap/bfr.keys.txt 140 430 2 \
  target/bfr/frames.bin -file target/bfr/bfr.pwad -merge target/bfr/bfr.sprites.wad

# The loop, its GIF and its manifest
node script/doomterm/doomcap/build.js --pack bfr --frames target/bfr/frames.bin --wad DOOM.WAD \
  --keys script/doomterm/doomcap/bfr.keys.txt --warp "1 1" --skill 4 --gamma 3 \
  --pwad target/bfr/bfr.pwad --merge target/bfr/bfr.sprites.wad \
  --engine "Chocolate Doom 3.1.1 (Fedora 42 package), SDL dummy video driver" --promise-contrast 7 --promise-holds 30
node script/doomterm/doomcap/check.js
```

- **Frames, colour and shape** are as for Replay: every second game tic, which is 17.5 frames a second; each frame keeps
  its exact palette (the most in any frame is 203 colours); rows are repeated, 40 of them, to turn 320 x 200 into 320 x 240.
- **The seam.** The melt of [`melt.js`](../../script/doomterm/doomcap/melt.js) runs from the last frame of play back to the first.
  The step into it changes 31% of the picture's pixels and the step out of it 0.7%, against 62% for an ordinary step of play.
- **The camera is never still.** `check.js` tests that the melt's first step is smaller than the median step of play, which a long
  still shot would fail.

CI cannot rebuild the loop, because it has neither the engine nor the game data. It checks what it can on every push with
`node script/doomterm/doomcap/check.js`, as for Replay, and the doomcap tests check that `bfr.keys.txt` is the script whose hash
`bfr.manifest.json` recorded and that the level the kit draws is sound. Where `bsp` is installed they also build the level and
check it against the hash the manifest recorded. The pack contract (keys, values, files, no game vocabulary, the source and the
non-affiliation line) is tested in `crates/doomterm_backdrop/tests/pack.rs`.
