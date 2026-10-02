Replay for Doom Term
====================

An animated theme: about eleven seconds of real Doom gameplay, replayed and looped behind the
terminal text. It is a recording of the second demo built into the shareware version of the game,
played back by the Chocolate Doom engine: a long corridor, a pistol fight, an explosion, an imp
that walks at you and a demon that charges. A screen melt, the game's own transition, closes the
loop.

The footage is id Software's. It comes from DOOM1.WAD, the freely distributable shareware data
file, version 1.9. Doom Term is an independent project and is not affiliated with, endorsed by or
sponsored by id Software or ZeniMax Media.

Install
-------
1. Extract this archive into Doom Term's themes folder, so that the folder named "replay" ends up
   inside it:

     Linux     ~/.local/share/doomterm/themes/

   Do not extract it anywhere else and move only the .yaml file: the theme finds its animation by
   the path "replay/replay.gif" under the themes folder.
2. Doom Term watches that folder, so the theme appears without a restart. Open Settings, then
   Appearance, then Themes, and choose "Replay".

Notes
-----
* The animation is shown at 30 percent over the theme's background, so it stays behind the text.
  There the text keeps at least 9:1 contrast against the brightest tenth of the picture, and 7:1
  holds up to about 45 percent. To change it, edit "opacity" in replay/replay.yaml (100 shows the
  footage at full strength).
* The animation is a looping 320x240 image at 17.5 frames a second and takes about 55 MiB of memory
  while the theme is active.
* The picture is scaled up with smoothing, so it looks soft rather than blocky.
* To remove the theme, delete the "replay" folder from the themes folder.
