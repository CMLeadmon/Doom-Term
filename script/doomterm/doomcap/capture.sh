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
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
doomcap_prepare "$work"

mkdir -p "$(dirname "$out")"
export DOOMCAP_OUT="$out" DOOMCAP_FIRST="$first" DOOMCAP_LAST="$last" DOOMCAP_STEP="$step"
# A timed demo ends through the engine's error path, so the engine's exit status says nothing
doomcap_run "$work" -iwad "$iwad" -timedemo "$demo" || true

if ! grep -m1 '^timed ' "$work/engine.log"; then
  cat "$work/engine.log" >&2
  echo "the demo did not play to its end" >&2
  exit 1
fi
