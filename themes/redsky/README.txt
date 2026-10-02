Redsky for Doom Term
====================

An animated theme: a black sun behind drifting storm clouds, a panning skyline and two lightning
strikes, with its own colours. Every pixel is generated; nothing is taken from a game.

Install
-------
1. Extract this archive into Doom Term's themes folder, so that the folder named "redsky" ends up
   inside it:

     Linux     ~/.local/share/doomterm/themes/

   Do not extract it anywhere else and move only the .yaml file: the theme finds its animation by
   the path "redsky/redsky.gif" under the themes folder.
2. Doom Term watches that folder, so the theme appears without a restart. Open Settings, then
   Appearance, then Themes, and choose "Redsky".

Notes
-----
* The animation is shown at 10 percent over the theme's background, so it stays behind the text.
  To make it stronger, edit "opacity" in redsky/redsky.yaml (100 shows it at full strength).
* The animation is a looping 480x300 image and takes about 55 MiB of memory while the theme is active.
* The "plate_stone" line recolours the status plate on Doom Term builds that support it. Older
  builds, including v1.1.5, ignore it and keep the grey plate.
* To remove the theme, delete the "redsky" folder from the themes folder.
