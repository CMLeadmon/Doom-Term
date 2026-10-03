# Big Fucking Replay theme pack

An optional animated theme for Doom Term, in the same form as [Replay](replay-theme.md): a **theme pack** (a YAML file, a GIF
and a short install note), not part of the application. A Doom Term that never installs it is unchanged, and it needs no
application changes. Like Replay, nothing in it is drawn here: it is a recording of the real game. It differs from Replay in
three ways. The run is played by a script instead of replaying a demo built into the game, which is how a weapon the
shareware game lacks gets on screen. The level is a map of the game with a crowd added. And its data file is the full game's,
which, unlike the shareware file, is not freely redistributable.

| Asset | What it shows |
| --- | --- |
| `doomterm-bfr-theme.zip` | About nine seconds of Doom (1993) gameplay, all indoors: a player in an enclosed hall fires the BFG 9000 as fast as it will go into a crowd of two Cyberdemons, four Barons, Demons, Imps, Sergeants, Cacodemons and Lost Souls, running, strafing and whipping round to whatever attacks. A screen melt closes the loop. The plate keeps its standard grey. |

The pack id is `bfr`, so no expletive lands in a path, a release asset name or a CI log. The name the theme shows in Settings is
the one the maintainer chose, **Big Fucking Replay**.

## Where the footage comes from

- **A scripted run of the first hall of episode 2's secret map.** [`bfr.keys.js`](../../script/doomterm/doomcap/bfr.keys.js)
  writes the key script. It types the game's own cheat codes for the weapon and for staying alive, raises the BFG and holds the
  fire key, so the weapon fires as fast as it can, every 40 game tics, while the player runs and strafes and swings round. The
  engine plays it on a virtual clock, so a run takes about a second, and the same script, level and data file draw the same frames
  every time (two recordings of the final clip are byte-for-byte identical). Frames 140 to 430 are kept, every second one.
- **The level.** The map is a closed, ceilinged hall of eight lobes with four Barons already in it and a door the monsters never
  open. [`bfr.pwad.js`](../../script/doomterm/doomcap/bfr.pwad.js) copies it from your `DOOM.WAD` into a small add-on file and
  changes three things. It adds 23 monsters: two Cyberdemons in the north and south bays with four Cacodemons behind them, four
  Demons, four Imps, three Sergeants and six Lost Souls. It removes the pickups, because walking over one flashes the whole screen.
  And it gives the hall a dark mossy floor and brighter lights. The add-on is derived from the data file, so it is built when the
  footage is recorded and is never committed.
- **The player.** A bot found the keys. It replayed the engine in short chunks, read the state of the last tic from a copy of the
  engine built to log it, and chose the next few. Each launch it aimed at the biggest cluster of monsters it could see, favouring
  the Cyberdemons, with the ball clear of anything near enough to white out the screen. Between launches it ran and strafed in runs
  of ten to twenty-five tics and snapped round to whatever was hurting it. The bot is not in this repository: only its output is,
  as the table of key holds in `bfr.keys.js`. The footage itself comes from the unmodified packaged engine, and the logging copy
  was checked to draw identical frames for this clip.
- **Pace.** Replay's player turns 2.3 degrees a game tic on average, spends about a quarter of its tics at the fast turn rate and
  reverses the turn about once a second. This run turns 3.0 degrees a tic, spends 37% of its tics at the fast rate and reverses
  once a second. It moves faster than Replay, 9.9 units a tic against 5.0.
- **The data file.** `DOOM.WAD`, version 1.9: an IWAD of 11,159,840 bytes with 2,194 lumps, SHA-1
  `7742089b4468a736cadb659a7deca3320fe6dcbd` (episodes 1 to 3, no episode 4). It is not in this repository and not in the pack:
  only the pictures the engine drew from it are. Whoever rebuilds the loop supplies their own copy. Replay's source is the
  freely distributable shareware file, and the shareware engine data cannot run this footage at all: it has no BFG, the
  engine refuses to add one to it, and refuses to select it.
- **An unmodified engine.** Chocolate Doom 3.1.1, run with no display. A small library loaded beside it copies the frames
  it hands to SDL, answers its clock and feeds it the key script; it contains no Doom code. See
  [`script/doomterm/doomcap/`](../../script/doomterm/doomcap/README.md).
- **Whose it is.** The art, levels and sounds belong to id Software. Doom Term is an independent project and is not
  affiliated with, endorsed by or sponsored by id Software or ZeniMax Media. The pack is a separate, optional download:
  deleting its folder removes it, and nothing else in Doom Term uses it. Its pictures come from the full game rather than the
  freely distributable shareware file, which the pack's README says.

## What is in the clip

Seven BFG launches, at frames 180, 220, 260, 300, 340, 380 and 420, in 146 frames of play. Thirteen monsters die in it, and
neither Cyberdemon does: by frame 411 one is down to about 1,500 of its 4,000 hit points and the other to about 3,700. A
Cyberdemon is in view within 600 units for about four frames in five, and some monster is in view in almost every frame.

The clip ends at frame 430, with the last ball just away. `idkfa` hands over 300 cells, which is exactly seven shots, and the engine
starts lowering the weapon about fifteen frames after the seventh launch, so there is no more BFG in hand to show. It starts at 140,
forty frames before the first launch, with the crowd already closing in.

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

It ships at image opacity **25**. The weapon's blasts are bright enough that the opacity is lower than Replay's 30. Measured
with the same method as the other packs (the foreground against the brightest tenth of the picture, worst case over **every**
frame of the loop):

| Pack | At its shipped opacity | Stays above 7:1 up to | Stays above 4.5:1 up to |
| --- | --- | --- | --- |
| Big Fucking Replay | 8.5:1 at 25 | 30 | 42 |

The frames that set the limit are the moments a ball leaves the weapon. No frame of the clip is mostly white: more than a third of
the picture is bright in none of them, because the player is kept from launching a ball at something next to it. The supporting
colours are the BFG's own greens, taken from the most common saturated greens in the footage: the accent is `#60cc58` and the
cursor `#78fc70`, the brightest green in the weapon's ramp. The background is a green-black, the text a pale green-white, and the
terminal's green and bright green are the same family. Every terminal colour reads on the background at 4.9:1 or better, except
the two blacks, which are meant to be dim (1.2:1 and 4.0:1). The status plate keeps its standard grey stone.

The blasts are bright and sudden, many in every loop. At the shipped opacity they are muted, but they have not been assessed
against a photosensitivity standard. The README that ships in the pack mentions the flashes and says to lower `opacity` or choose
another theme if they bother you.

## Cost

Measured in the headless KWin lab with private settings and the published v1.1.7 build: resident memory rose from
**196.3 MiB to 251.7 MiB**, about **55 MiB**, with the pack active, a little under Replay's 60. That is the decoded frames
(320 x 240 x 4 bytes x 162, 47.5 MiB) plus overhead. The GIF is 6.5 MiB (Replay's is 5.1). Ten screenshots taken a second
apart showed ten different backgrounds (a run without the pack shows two), so the animation runs, and the terminal text was
legible in the ones looked at by eye. Frame cadence and GPU cost on a real display have not been measured. The picture is
scaled up by a linear sampler, so it looks soft rather than blocky.

## How it is made

```sh
node script/doomterm/doomcap/bfr.keys.js target/bfr/bfr.keys.txt
node script/doomterm/doomcap/bfr.pwad.js DOOM.WAD target/bfr/bfr.pwad
script/doomterm/doomcap/play.sh DOOM.WAD "2 9" 4 target/bfr/bfr.keys.txt 140 430 2 target/bfr/frames.bin target/bfr/bfr.pwad
node script/doomterm/doomcap/build.js --pack bfr --frames target/bfr/frames.bin --wad DOOM.WAD \
  --keys target/bfr/bfr.keys.txt --warp "2 9" --skill 4 --pwad target/bfr/bfr.pwad \
  --engine "Chocolate Doom 3.1.1 (Fedora 42 package), SDL dummy video driver" --promise-contrast 8 --promise-holds 30
node script/doomterm/doomcap/check.js
```

- **Frames, colour and shape** are as for Replay: every second game tic, which is 17.5 frames a second; each frame keeps
  its exact palette (the most in any frame is 223 colours); rows are repeated, 40 of them, to turn 320 x 200 into 320 x 240.
- **The seam.** The melt of [`melt.js`](../../script/doomterm/doomcap/melt.js) runs from the last frame of play back to the first.
  The step into it changes 29% of the picture's pixels and the step out of it 0.7%, against 82% for an ordinary step of play.
- **The camera is never still.** `check.js` tests that the melt's first step is smaller than the median step of play, which a long
  still shot would fail. Here every step of play changes more of the picture than the melt's first.

CI cannot rebuild the loop, because it has neither the engine nor the game data. It checks what it can on every push with
`node script/doomterm/doomcap/check.js`, as for Replay, and the doomcap tests check that `bfr.keys.js` still writes the
script whose hash `bfr.manifest.json` recorded and that `bfr.pwad.js` builds the level it should from a stand-in data file. The
pack contract (keys, values, files, no game vocabulary, the source and the non-affiliation line) is tested in
`crates/doomterm_backdrop/tests/pack.rs`.
