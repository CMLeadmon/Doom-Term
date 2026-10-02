/* Records the frames Chocolate Doom draws, for the Replay theme pack.

   Chocolate Doom hands SDL one 32-bit frame per game tic, either by locking a streaming texture
   and writing into it (3.1) or by calling SDL_UpdateTexture (3.0). Preloaded into an unmodified
   engine, this library copies those frames to a file and passes every call on. It contains no
   Doom code and no Doom data.

     DOOMCAP_OUT    path of the frame stream to write (nothing is written when unset)
     DOOMCAP_FIRST  first frame to keep, counted from 0 (default 0)
     DOOMCAP_LAST   last frame to keep (default: the end of the demo)
     DOOMCAP_STEP   keep every Nth frame from the first (default 1)

   Each record is a 16-byte header of little-endian uint32 values, the magic 0x4d415246
   ("FRAM"), the frame number, the width and the height, then width * height pixels of four bytes
   each in the order SDL stores ARGB8888 on a little-endian machine: blue, green, red, alpha.

   SDL's software renderer, the only one its dummy video driver offers, reports a maximum texture
   size of 0 to mean "no limit". Chocolate Doom reads that as a limit of nothing and refuses to
   start, so the library also reports a real limit in that case. That is what lets the engine run
   with no display at all. */
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif
#include <SDL2/SDL.h>
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

enum { SCREEN_W = 320, SCREEN_H = 200, UNLIMITED_TEXTURE = 16384 };

static int (*real_update)(SDL_Texture *, const SDL_Rect *, const void *, int);
static int (*real_lock)(SDL_Texture *, const SDL_Rect *, void **, int *);
static void (*real_unlock)(SDL_Texture *);
static int (*real_info)(SDL_Renderer *, SDL_RendererInfo *);

static FILE *out;
static long first, last = -1, step = 1, frame = -1;

static SDL_Texture *locked;
static const void *locked_pixels;
static int locked_pitch;

static long env_long(const char *name, long fallback)
{
    const char *value = getenv(name);
    return value && *value ? strtol(value, NULL, 10) : fallback;
}

__attribute__((constructor)) static void start(void)
{
    const char *path = getenv("DOOMCAP_OUT");

    real_update = (int (*)(SDL_Texture *, const SDL_Rect *, const void *, int))dlsym(RTLD_NEXT, "SDL_UpdateTexture");
    real_lock = (int (*)(SDL_Texture *, const SDL_Rect *, void **, int *))dlsym(RTLD_NEXT, "SDL_LockTexture");
    real_unlock = (void (*)(SDL_Texture *))dlsym(RTLD_NEXT, "SDL_UnlockTexture");
    real_info = (int (*)(SDL_Renderer *, SDL_RendererInfo *))dlsym(RTLD_NEXT, "SDL_GetRendererInfo");
    if (path && *path) {
        out = fopen(path, "wb");
    }
    first = env_long("DOOMCAP_FIRST", 0);
    last = env_long("DOOMCAP_LAST", -1);
    step = env_long("DOOMCAP_STEP", 1);
    if (step < 1) {
        step = 1;
    }
}

static void record(SDL_Texture *texture, const void *pixels, int pitch)
{
    int w = 0;
    int h = 0;

    if (!out || SDL_QueryTexture(texture, NULL, NULL, &w, &h) != 0 || w != SCREEN_W || h != SCREEN_H) {
        return;
    }
    frame++;
    if (frame >= first && (last < 0 || frame <= last) && (frame - first) % step == 0) {
        const uint32_t head[4] = {0x4d415246u, (uint32_t)frame, (uint32_t)w, (uint32_t)h};
        int y;

        fwrite(head, sizeof head, 1, out);
        for (y = 0; y < h; y++) {
            fwrite((const char *)pixels + (size_t)y * (size_t)pitch, 4, (size_t)w, out);
        }
        fflush(out);
    }
}

int SDL_GetRendererInfo(SDL_Renderer *renderer, SDL_RendererInfo *info)
{
    const int result = real_info(renderer, info);

    if (result == 0 && info) {
        if (info->max_texture_width <= 0) {
            info->max_texture_width = UNLIMITED_TEXTURE;
        }
        if (info->max_texture_height <= 0) {
            info->max_texture_height = UNLIMITED_TEXTURE;
        }
    }
    return result;
}

int SDL_UpdateTexture(SDL_Texture *texture, const SDL_Rect *rect, const void *pixels, int pitch)
{
    if (!rect) {
        record(texture, pixels, pitch);
    }
    return real_update(texture, rect, pixels, pitch);
}

int SDL_LockTexture(SDL_Texture *texture, const SDL_Rect *rect, void **pixels, int *pitch)
{
    const int result = real_lock(texture, rect, pixels, pitch);
    const int whole = !rect || (rect->x == 0 && rect->y == 0 && rect->w == SCREEN_W && rect->h == SCREEN_H);

    locked = result == 0 && whole ? texture : NULL;
    locked_pixels = result == 0 && whole ? *pixels : NULL;
    locked_pitch = result == 0 && whole ? *pitch : 0;
    return result;
}

void SDL_UnlockTexture(SDL_Texture *texture)
{
    if (texture == locked && locked_pixels) {
        record(texture, locked_pixels, locked_pitch);
    }
    locked = NULL;
    locked_pixels = NULL;
    real_unlock(texture);
}
