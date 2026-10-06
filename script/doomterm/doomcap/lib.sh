#!/usr/bin/env bash
# Helpers shared by capture.sh and play.sh. Source this file; do not run it.

doomcap_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
doomcap_engine=${CHOCOLATE_DOOM:-chocolate-doom}

# doomcap_prepare WORK: builds the shim and writes the engine's settings into WORK.
# The settings give a full-screen view with no status bar, no messages and no disk icon: only the game world.
# DOOMCAP_GAMMA (0 to 4, default 0) sets the game's own gamma correction, and the mouse moves the view one to one.
doomcap_prepare() {
  local work=$1
  # shellcheck disable=SC2046
  gcc -O2 -Wall -Wextra -shared -fPIC -o "$work/doomcap_shim.so" "$doomcap_dir/shim/doomcap_shim.c" $(sdl2-config --cflags) -ldl
  printf 'screenblocks 11\nshow_messages 0\nusegamma %s\n' "${DOOMCAP_GAMMA:-0}" >"$work/default.cfg"
  printf 'show_diskicon 0\nforce_software_renderer 1\nfullscreen 0\ngrabmouse 0\nmouse_acceleration 1.0\nmouse_threshold 0\n' >"$work/chocolate.cfg"
}

# doomcap_run WORK ENGINE_ARGS...: runs the engine with no display and the shim loaded, logging to WORK/engine.log.
# The DOOMCAP_* settings the shim reads come from the caller's environment. Returns the engine's exit status.
doomcap_run() {
  local work=$1
  shift
  HOME="$work" SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy LD_PRELOAD="$work/doomcap_shim.so" \
    "$doomcap_engine" -nosound -nograbmouse -config "$work/default.cfg" -extraconfig "$work/chocolate.cfg" "$@" \
    >"$work/engine.log" 2>&1
}
