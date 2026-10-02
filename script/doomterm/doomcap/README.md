# doomcap

Records gameplay from one of Doom's built-in demos and turns it into the loop of the
[Replay theme pack](../../../docs/doom-term/replay-theme.md). Nothing here contains Doom code or Doom
data: the engine is an unmodified Chocolate Doom, and the data file is supplied by whoever runs it.

| File | What it does |
| --- | --- |
| `capture.sh` | Plays one demo of a data file in Chocolate Doom with no display and writes the frames it draws |
| `shim/doomcap_shim.c` | A library preloaded into the engine. It copies each frame the engine hands to SDL and lets SDL's dummy video driver run the engine headless |
| `build.js` | Takes a frame stream, adds the screen melt that closes the loop, repeats rows to the 4:3 shape and writes the GIF and `replay.manifest.json` |
| `melt.js` | The screen melt, written from how Doom's transition behaves |
| `wad.js`, `frames.js`, `contrast.js` | Readers for the data file and the frame stream, and the contrast measure behind the pack's README |
| `check.js` | CI's check of the committed GIF against the manifest. It needs no game data |
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
node script/doomterm/doomcap/build.js --frames target/replay/frames.bin --wad DOOM1.WAD --demo demo2 \
  --engine "Chocolate Doom 3.1.1 (Fedora 42 package), SDL dummy video driver"

# What CI runs
node --test script/doomterm/doomcap/doomcap.test.js
node script/doomterm/doomcap/check.js
```

To choose other footage, record a whole demo with a step of 35 (one frame a second) and look through it. A
demo is a list of keypresses, so the same demo always draws the same frames.

## How the capture works

Chocolate Doom hands SDL one frame per game tic. `-timedemo` plays a demo as fast as the machine allows
and draws every tic, which makes the stream complete and repeatable. The shim intercepts the two ways the
engine passes a frame to SDL (writing into a locked texture in 3.1, `SDL_UpdateTexture` in 3.0) and appends
the pixels to the file named by `DOOMCAP_OUT`. The first and last frame to keep and the step between kept
frames come from `DOOMCAP_FIRST`, `DOOMCAP_LAST` and `DOOMCAP_STEP`.

SDL's software renderer, which is all its dummy video driver offers, reports a maximum texture size of 0 for
"no limit". Chocolate Doom reads that as a limit of nothing and exits, so the shim reports a real limit
instead. A timed demo ends through the engine's error path, so its exit status is 255; `capture.sh` looks for
the engine's `timed N gametics` line instead.

Linux only. The shim relies on `LD_PRELOAD`.
