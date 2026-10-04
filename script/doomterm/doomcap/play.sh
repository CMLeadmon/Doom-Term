#!/usr/bin/env bash
# Plays a level with a scripted player in an unmodified Chocolate Doom, with no display and on a virtual
# clock, and records the frames it draws. The script presses keys the way a person would, including the
# cheat codes that hand over a weapon and keep the player alive.
#
#   play.sh IWAD WARP SKILL KEYS FIRST LAST STEP OUT [ENGINE_ARGS...]
#
#   IWAD   the game data file, for example DOOM.WAD
#   WARP   what the engine's -warp takes: "1 8" for episode 1 map 8, or "30" for map 30 of Doom II
#   SKILL  1 to 5; 4 is Ultra-Violence
#   KEYS   a key script (see keys.js): lines of "FRAME down|up KEY" and "FRAME mouse DX DY"
#   FIRST, LAST, STEP   keep frames FIRST to LAST, every STEP-th. Frames are counted from the first one
#          drawn, so a level's opening melt is the first forty or so, and then one is drawn per game tic
#   OUT    the frame stream to write
#   ENGINE_ARGS   anything else the engine takes, such as -file LEVEL.wad to play a level of your own, or
#          -merge SPRITES.wad to replace sprites
#
# Needs chocolate-doom 3.0 or 3.1, gcc and the SDL2 headers. Set CHOCOLATE_DOOM to use another binary.
set -euo pipefail

if [ "$#" -lt 8 ]; then
  sed -n '2,18p' "$0" >&2
  exit 2
fi
iwad=$1 warp=$2 skill=$3 keys=$4 first=$5 last=$6 step=$7 out=$8
shift 8
# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
doomcap_prepare "$work"

mkdir -p "$(dirname "$out")"
export DOOMCAP_OUT="$out" DOOMCAP_FIRST="$first" DOOMCAP_LAST="$last" DOOMCAP_STEP="$step" \
  DOOMCAP_VIRTUAL_TIME=1 DOOMCAP_KEYS="$keys" DOOMCAP_STOP=$((last + 1))
status=0
read -r -a warp_args <<<"$warp"
engine_args=(-iwad "$iwad" -warp "${warp_args[@]}" -skill "$skill" "$@")
# The shim ends the run cleanly once the last frame is drawn; any other status is the engine failing
timeout 600 bash -c '. "$1"; shift; doomcap_run "$@"' _ "$doomcap_dir/lib.sh" "$work" "${engine_args[@]}" || status=$?
if [ "$status" -ne 0 ]; then
  cat "$work/engine.log" >&2
  echo "the engine stopped with status $status before the last frame was drawn" >&2
  exit 1
fi
echo "recorded frames $first to $last, every $step, to $out"
