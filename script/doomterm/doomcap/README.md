# doomcap

Records gameplay from one of Doom's built-in demos, or from a scripted player, and turns it into the loop of a theme pack: the
[Replay](../../../docs/doom-term/replay-theme.md) and [Big Fucking Replay](../../../docs/doom-term/bfr-theme.md) packs. Nothing
here contains Doom code or Doom data: the engine is an unmodified Chocolate Doom, and the data file is supplied by whoever runs it.

| File | What it does |
| --- | --- |
| `capture.sh` | Plays one demo of a data file in Chocolate Doom with no display and writes the frames it draws |
| `play.sh` | Plays a level with a scripted player on a virtual clock and writes the frames it draws |
| `keys.js` | Writes and reads the key script `play.sh` plays: a timeline of key presses and mouse movements counted in frames |
| `bfr.keys.txt` | The recorded input of the Big Fucking Replay loop |
| `bfr.pwad.js` | Draws the hall that loop is played in, a nave with two Cyberdemons on a stage, and has `bsp` build its nodes |
| `mapkit.js` | The small kit `bfr.pwad.js` draws a level with: sectors, walls, fences and things in, a PWAD out |
| `raise_weapon.js` | Builds the add-on that draws the BFG 9000 higher on screen, from your copy of the game's data |
| `lib.sh` | What `capture.sh` and `play.sh` share |
| `shim/doomcap_shim.c` | A library preloaded into the engine. It copies each frame the engine hands to SDL and lets SDL's dummy video driver run the engine headless |
| `build.js` | Takes a frame stream, adds the screen melt that closes the loop, repeats rows to the 4:3 shape and writes the GIF and `<pack>.manifest.json` |
| `melt.js` | The screen melt, written from how Doom's transition behaves |
| `wad.js`, `frames.js`, `contrast.js` | Readers for the data file and the frame stream, and the contrast measure behind the pack's README |
| `check.js` | CI's check of every pack's committed GIF against its manifest. It needs no game data |
| `doomcap.test.js` | Unit tests, run with `node --test script/doomterm/doomcap/doomcap.test.js` |

## Rebuilding the Replay loop

You need `chocolate-doom` 3.0 or 3.1, `gcc`, the SDL2 development files and Node. Chocolate Doom runs
without a display, so a bare container is enough. The pack was recorded in Fedora 42:

```sh
podman run -d --name doomcap-lab -v "$PWD:/work" registry.fedoraproject.org/fedora-toolbox:42 sleep infinity
podman exec doomcap-lab dnf -y install chocolate-doom gcc make sdl2-compat-devel nodejs
```

The data file is the shareware `DOOM1.WAD`, version 1.9 (4,196,020 bytes, SHA-1
`5b2e249b9c5133ec987b3ea77596381dc0d6bc1d`). Any Doom 1.9 data file works; `build.js` records which one it
was given in `replay.manifest.json`. Then, from the repository root:

```sh
# Frames 910 to 1248 of DEMO2, every second one (a game tic is 1/35 s, so this is 17.5 frames a second)
script/doomterm/doomcap/capture.sh DOOM1.WAD demo2 910 1248 2 target/replay/frames.bin

# The loop, its GIF and its manifest
node script/doomterm/doomcap/build.js --pack replay --frames target/replay/frames.bin --wad DOOM1.WAD --demo demo2 \
  --engine "Chocolate Doom 3.1.1 (Fedora 42 package), SDL dummy video driver" --promise-contrast 9 --promise-holds 45

# What CI runs
node --test script/doomterm/doomcap/doomcap.test.js
node script/doomterm/doomcap/check.js
```

To choose other footage, record a whole demo with a step of 35 (one frame a second) and look through it. A
demo is a list of keypresses, so the same demo always draws the same frames.

## Rebuilding the Big Fucking Replay loop

This pack needs the data file of the full game, `DOOM.WAD` version 1.9 (11,159,840 bytes, SHA-1
`7742089b4468a736cadb659a7deca3320fe6dcbd`), which this repository does not hold, and the `bsp` node builder (BSP 5.2; Fedora:
`dnf install bsp`). From the repository root:

```sh
# The hall, and the add-on that draws the weapon higher (built from your copy of the data file)
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
```

The same script, level and data file draw the same frames every time. A change to `bfr.keys.txt` is caught by the tests, which compare
its hash with the one in `bfr.manifest.json`, and where `bsp` is installed they build the level and compare its hash too.
The key script was recorded by a program that steered the player one game tic at a time from the engine's own state; that program
is not in this repository, only its output.

## Playing a level instead of a demo

A demo only shows what its player did. To put a particular weapon on screen, `play.sh` plays a level with a scripted
player:

```sh
script/doomterm/doomcap/play.sh DOOM.WAD "2 8" 4 target/keys.txt 0 1000 2 target/frames.bin
```

The arguments are the data file, what the engine's `-warp` takes (`"2 8"` is episode 2, map 8; Doom II takes just `"30"`),
the skill (4 is Ultra-Violence), the key script, the first and last frame to keep, the step, and the output. Anything after the
output goes to the engine, such as `-file LEVEL.wad` to play a level of your own or `-merge SPRITES.wad` to replace sprites.
A key script is `FRAME down|up KEY` and `FRAME mouse DX DY` lines, counted in frames drawn, and `keys.js` writes and reads
them. The shim hands those keys to the engine as if they were typed, so the cheat codes work: `iddqd` for survival, `idkfa` for
every weapon, and `idspispopd` (`idclip` in Doom II) to walk through walls. A mouse line moves the mouse by that much on the
game tic that draws that frame, and a positive `DX` turns to the right; one unit turns the view 0.0439 degrees, because
`lib.sh` sets the engine's mouse acceleration to 1 and its threshold to 0. `DOOMCAP_GAMMA` (0 to 4) sets the game's gamma.

`play.sh` also puts the engine on a virtual clock that only its own sleeping advances. The level plays as fast as the
machine allows (hundreds of frames in a second) and every run is identical, so the same script always draws the same
frames. Three things to know when writing a script:

- Frames are counted from the first one drawn, and the level's opening melt takes about the first forty. One frame is drawn
  per game tic after that.
- Walking through walls (noclip) stops the level's walk-over triggers from firing, so a wall that lowers to reveal a boss
  stays up. Switch noclip off, by typing the cheat again, before the stretch that has to trigger something.
- Turning by held keys is open loop: a quarter turn takes `turnTics(90)` tics of a held arrow key, give or take a
  few degrees. The mouse gives finer control, and a smooth movement of it is what looks natural at 17.5 frames a second.
- Never hold `shift` in footage meant to look like a person walking. It is the run key, which doubles the speed, and it makes
  the keyboard turn at its fastest rate.
- Type cheat codes before holding shift. With shift down the engine reads the letters as capitals and takes no code.
- `idkfa` hands over 300 cells, which is seven shots of the BFG. The engine starts lowering the weapon about fifteen frames
  after the seventh launch, so a clip that has to show the BFG in hand ends before that.
- A key event at frame `f` takes effect on the game tic that draws frame `f`. Which tic that is depends on how long the level's
  opening melt lasts, 37 or 38 frames in the maps tried, so measure it instead of assuming it.
- Monsters knock the player about even when it cannot be hurt, which can add fast, jerky motion. A level can hide the player from
  them with a reject table, which `mapkit.js` writes from its `cannotSee` rule.

## How the capture works

Chocolate Doom hands SDL one frame per game tic. `-timedemo` plays a demo as fast as the machine allows
and draws every tic, which makes the stream complete and repeatable. The shim intercepts the two ways the
engine passes a frame to SDL (writing into a locked texture in 3.1, `SDL_UpdateTexture` in 3.0) and appends
the pixels to the file named by `DOOMCAP_OUT`. The first and last frame to keep and the step between kept
frames come from `DOOMCAP_FIRST`, `DOOMCAP_LAST` and `DOOMCAP_STEP`.

The shim also takes `DOOMCAP_VIRTUAL_TIME`, `DOOMCAP_KEYS` and `DOOMCAP_STOP` (end the run after that many frames),
which `play.sh` sets. It hooks `SDL_GetTicks` and `SDL_Delay` for the clock and `SDL_PollEvent` for the keys.

SDL's software renderer, which is all its dummy video driver offers, reports a maximum texture size of 0 for
"no limit". Chocolate Doom reads that as a limit of nothing and exits, so the shim reports a real limit
instead. A timed demo ends through the engine's error path, so its exit status is 255; `capture.sh` looks for
the engine's `timed N gametics` line instead.

Linux only. The shim relies on `LD_PRELOAD`.
