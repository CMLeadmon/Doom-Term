#!/usr/bin/env bash
# Plays one built-in demo of a Doom data file in an unmodified Chocolate Doom, with no display, and
# records the frames it draws.
#
#   capture.sh IWAD DEMO FIRST LAST STEP OUT
#
#   IWAD   the game data file, for example DOOM1.WAD
#   DEMO   the demo lump to play, for example demo2
#   FIRST, LAST, STEP   keep frames FIRST to LAST, every STEP-th, counted from 0 (one frame per game tic)
#   OUT    the frame stream to write
#
# Needs chocolate-doom 3.0 or 3.1, gcc and the SDL2 headers. Set CHOCOLATE_DOOM to use another binary.
set -euo pipefail

if [ "$#" -ne 6 ]; then
  sed -n '2,12p' "$0" >&2
  exit 2
fi
iwad=$1 demo=$2 first=$3 last=$4 step=$5 out=$6
engine=${CHOCOLATE_DOOM:-chocolate-doom}
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# shellcheck disable=SC2046
gcc -O2 -Wall -Wextra -shared -fPIC -o "$work/doomcap_shim.so" "$here/shim/doomcap_shim.c" $(sdl2-config --cflags) -ldl

# A full-screen view with no status bar, no messages and no disk icon: only the game world
printf 'screenblocks 11\nshow_messages 0\nusegamma 0\n' >"$work/default.cfg"
printf 'show_diskicon 0\nforce_software_renderer 1\nfullscreen 0\ngrabmouse 0\n' >"$work/chocolate.cfg"

mkdir -p "$(dirname "$out")"
log="$work/engine.log"
# A timed demo ends through the engine's error path, so the engine's exit status says nothing
HOME="$work" SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy LD_PRELOAD="$work/doomcap_shim.so" \
  DOOMCAP_OUT="$out" DOOMCAP_FIRST="$first" DOOMCAP_LAST="$last" DOOMCAP_STEP="$step" \
  "$engine" -iwad "$iwad" -timedemo "$demo" -nosound -nograbmouse \
  -config "$work/default.cfg" -extraconfig "$work/chocolate.cfg" >"$log" 2>&1 || true

if ! grep -m1 '^timed ' "$log"; then
  cat "$log" >&2
  echo "the demo did not play to its end" >&2
  exit 1
fi
