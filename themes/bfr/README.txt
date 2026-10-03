Big Fucking Replay for Doom Term
================================

An animated theme: about nine seconds of real Doom gameplay, replayed and looped behind the terminal
text. A player in an enclosed hall fires the BFG 9000 as fast as it will go into a crowd: two
Cyberdemons, four Barons and a swarm of Demons, Imps, Sergeants, Cacodemons and Lost Souls, running,
strafing and whipping round to whatever is attacking. A screen melt, the game's own transition,
closes the loop.

The footage is id Software's. It is the secret map of episode 2, drawn by the Chocolate Doom engine
from DOOM.WAD, the data file of the full game, version 1.9. That file is not part of this download:
only the pictures the engine drew from it are. The map was changed for the recording: its crowd is
bigger, its pickups are gone and its first hall has a darker floor and brighter lights. The run is
played by a script, not recorded from a person: it types the game's own cheat codes for the weapon
and for staying alive, then runs, turns and fires the way a person would at a keyboard.

Doom Term is an independent project and is not affiliated with, endorsed by or
sponsored by id Software or ZeniMax Media.

Install
-------
1. Extract this archive into Doom Term's themes folder, so that the folder named "bfr" ends up inside
   it:

     Linux     ~/.local/share/doomterm/themes/

   Do not extract it anywhere else and move only the .yaml file: the theme finds its animation by the
   path "bfr/bfr.gif" under the themes folder.
2. Doom Term watches that folder, so the theme appears without a restart. Open Settings, then
   Appearance, then Themes, and choose "Big Fucking Replay".

Notes
-----
* The animation is shown at 25 percent over the theme's background, so it stays behind the text.
  There the text keeps at least 8:1 contrast against the brightest tenth of the picture, and 7:1
  holds up to about 30 percent. To change it, edit "opacity" in bfr/bfr.yaml (100 shows the footage
  at full strength).
* The weapon's blasts are bright flashes, many in every loop. At 25 percent they are muted. If
  flashing bothers you, lower "opacity" or choose another theme.
* The animation is a looping 320x240 image at 17.5 frames a second. While the theme is active Doom Term
  uses about 55 MiB more memory than without it.
* The picture is scaled up with smoothing, so it looks soft rather than blocky.
* To remove the theme, delete the "bfr" folder from the themes folder.
