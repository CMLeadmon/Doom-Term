Blue Highway for Doom Term
==========================

An animated theme: a tractor-trailer holds its place on a mountain road while a misty West
Virginia dawn runs past. Dark green ridges, a steel arch bridge that crosses the sun, a barn and
silo, utility poles and the road itself all move behind a rig that never changes position. Every
pixel is generated; nothing is taken from a game.

Install
-------
1. Extract this archive into Doom Term's themes folder, so that the folder named "bluehighway" ends up
   inside it:

     Linux     ~/.local/share/doomterm/themes/

   Do not extract it anywhere else and move only the .yaml file: the theme finds its animation by
   the path "bluehighway/bluehighway.gif" under the themes folder.
2. Doom Term watches that folder, so the theme appears without a restart. Open Settings, then
   Appearance, then Themes, and choose "Blue Highway".

Notes
-----
* The animation is shown at 10 percent over the theme's background, so it stays behind the text.
  To make it stronger, edit "opacity" in bluehighway/bluehighway.yaml (100 shows it at full strength). Above
  opacity 40 or so the art starts to compete with the text.
* The animation is a looping 480x300 image and takes about 60 MiB of memory while the theme is active.
* The "plate_stone" line recolours the status plate on Doom Term v1.1.6 and later. Older builds,
  including v1.1.5, ignore it and keep the grey plate.
* To remove the theme, delete the "bluehighway" folder from the themes folder.
