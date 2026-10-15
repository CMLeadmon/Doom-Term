Haunted Island for Doom Term
============================

An animated Halloween theme: a pixel-art haunted house on a floating island under a full moon,
with a drifting ghost, bats, jack-o'-lanterns and a slime waterfall, in purples and plum with
pumpkin-orange accents. The colours are a purple-black, and the status plate at the bottom is
tinted to match.

The animation was made from a screen recording of an animated desktop wallpaper (the desktop
icons and taskbar are cropped out). The artwork is not original to this project, so check where
the wallpaper came from before redistributing the pack.

Install
-------
1. Put the folder named "hauntedisland" inside Doom Term's themes folder:

     Windows   %APPDATA%\cmleadmon\DoomTerm\data\themes\
     Linux     ~/.local/share/doomterm/themes/

   Do not move only the .yaml file: the theme finds its animation by the path
   "hauntedisland/hauntedisland.gif" under the themes folder.
2. Doom Term watches that folder, so the theme appears without a restart. Open Settings, then
   Appearance, then Themes, and choose "Haunted Island".

Notes
-----
* The animation is shown at 25 percent over the theme's background, so it stays behind the text.
  Edit "opacity" in hauntedisland/hauntedisland.yaml to change it (100 shows it at full strength).
* The animation is a looping 768x480 image (88 frames, about 7 seconds) and takes about 125 MiB of
  memory while the theme is active.
* The "plate_stone" line recolours the status plate (the bottom rail) on builds that support it
  (v1.1.6 and later).
* To remove the theme, delete the "hauntedisland" folder from the themes folder.
