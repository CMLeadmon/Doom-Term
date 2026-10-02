/* Records the frames Chocolate Doom draws, and can play the game for it, for the Replay theme packs.

   Chocolate Doom hands SDL one 32-bit frame per game tic, either by locking a streaming texture
   and writing into it (3.1) or by calling SDL_UpdateTexture (3.0). Preloaded into an unmodified
   engine, this library copies those frames to a file and passes every call on. It contains no
   Doom code and no Doom data.

     DOOMCAP_OUT           path of the frame stream to write (nothing is written when unset)
     DOOMCAP_FIRST         first frame to keep, counted from 0 (default 0)
     DOOMCAP_LAST          last frame to keep (default: the end of the run)
     DOOMCAP_STEP          keep every Nth frame from the first (default 1)
     DOOMCAP_VIRTUAL_TIME  when set, the engine runs on a virtual clock that only its own sleeping
                           advances, so a level plays as fast as the machine allows and every run
                           is identical
     DOOMCAP_KEYS          path of a key script: lines of "FRAME down|up KEY", where FRAME counts
                           the frames drawn so far. A key is a letter, a digit, or one of up, down,
                           left, right, ctrl, shift, alt, space, enter, esc, tab, comma, period
     DOOMCAP_STOP          exit after this many frames have been drawn

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
#include <ctype.h>
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

enum { SCREEN_W = 320, SCREEN_H = 200, UNLIMITED_TEXTURE = 16384, FIRST_CLOCK_MS = 1000 };

typedef struct {
    long frame;
    int down;
    SDL_Scancode scancode;
    SDL_Keycode key;
} ScriptedKey;

static int (*real_update)(SDL_Texture *, const SDL_Rect *, const void *, int);
static int (*real_lock)(SDL_Texture *, const SDL_Rect *, void **, int *);
static void (*real_unlock)(SDL_Texture *);
static int (*real_info)(SDL_Renderer *, SDL_RendererInfo *);
static int (*real_poll)(SDL_Event *);
static Uint32 (*real_ticks)(void);
static void (*real_delay)(Uint32);

static FILE *out;
static long first, last = -1, step = 1, stop_after = -1;
static long shown;
static int virtual_time;
static Uint32 clock_ms = FIRST_CLOCK_MS;

static SDL_Texture *locked;
static const void *locked_pixels;
static int locked_pitch;

static ScriptedKey *script;
static size_t script_len, script_next;

static long env_long(const char *name, long fallback)
{
    const char *value = getenv(name);
    return value && *value ? strtol(value, NULL, 10) : fallback;
}

static int lookup_key(const char *name, SDL_Scancode *scancode, SDL_Keycode *key)
{
    static const struct {
        const char *name;
        SDL_Scancode scancode;
        SDL_Keycode key;
    } named[] = {
        {"up", SDL_SCANCODE_UP, SDLK_UP},          {"down", SDL_SCANCODE_DOWN, SDLK_DOWN},
        {"left", SDL_SCANCODE_LEFT, SDLK_LEFT},    {"right", SDL_SCANCODE_RIGHT, SDLK_RIGHT},
        {"ctrl", SDL_SCANCODE_RCTRL, SDLK_RCTRL},  {"shift", SDL_SCANCODE_RSHIFT, SDLK_RSHIFT},
        {"alt", SDL_SCANCODE_RALT, SDLK_RALT},     {"space", SDL_SCANCODE_SPACE, SDLK_SPACE},
        {"enter", SDL_SCANCODE_RETURN, SDLK_RETURN}, {"esc", SDL_SCANCODE_ESCAPE, SDLK_ESCAPE},
        {"tab", SDL_SCANCODE_TAB, SDLK_TAB},       {"comma", SDL_SCANCODE_COMMA, SDLK_COMMA},
        {"period", SDL_SCANCODE_PERIOD, SDLK_PERIOD},
    };
    size_t i;

    for (i = 0; i < sizeof named / sizeof named[0]; i++) {
        if (strcmp(name, named[i].name) == 0) {
            *scancode = named[i].scancode;
            *key = named[i].key;
            return 1;
        }
    }
    if (name[0] && !name[1] && islower((unsigned char)name[0])) {
        *scancode = (SDL_Scancode)(SDL_SCANCODE_A + (name[0] - 'a'));
        *key = (SDL_Keycode)name[0];
        return 1;
    }
    if (name[0] && !name[1] && isdigit((unsigned char)name[0])) {
        *scancode = name[0] == '0' ? SDL_SCANCODE_0 : (SDL_Scancode)(SDL_SCANCODE_1 + (name[0] - '1'));
        *key = (SDL_Keycode)name[0];
        return 1;
    }
    return 0;
}

static void load_script(const char *path)
{
    FILE *file = fopen(path, "r");
    char line[128];
    size_t capacity = 0;

    if (!file) {
        fprintf(stderr, "doomcap: cannot read key script %s\n", path);
        exit(2);
    }
    while (fgets(line, sizeof line, file)) {
        long frame;
        char action[8];
        char name[16];
        ScriptedKey entry;

        if (line[0] == '#' || line[0] == '\n') {
            continue;
        }
        if (sscanf(line, "%ld %7s %15s", &frame, action, name) != 3 || (strcmp(action, "down") && strcmp(action, "up")) ||
            !lookup_key(name, &entry.scancode, &entry.key)) {
            fprintf(stderr, "doomcap: bad key script line: %s", line);
            exit(2);
        }
        entry.frame = frame;
        entry.down = strcmp(action, "down") == 0;
        if (script_len == capacity) {
            capacity = capacity ? capacity * 2 : 256;
            script = realloc(script, capacity * sizeof *script);
            if (!script) {
                exit(2);
            }
        }
        script[script_len++] = entry;
    }
    fclose(file);
}

__attribute__((constructor)) static void start(void)
{
    const char *path = getenv("DOOMCAP_OUT");
    const char *keys = getenv("DOOMCAP_KEYS");

    real_update = (int (*)(SDL_Texture *, const SDL_Rect *, const void *, int))dlsym(RTLD_NEXT, "SDL_UpdateTexture");
    real_lock = (int (*)(SDL_Texture *, const SDL_Rect *, void **, int *))dlsym(RTLD_NEXT, "SDL_LockTexture");
    real_unlock = (void (*)(SDL_Texture *))dlsym(RTLD_NEXT, "SDL_UnlockTexture");
    real_info = (int (*)(SDL_Renderer *, SDL_RendererInfo *))dlsym(RTLD_NEXT, "SDL_GetRendererInfo");
    real_poll = (int (*)(SDL_Event *))dlsym(RTLD_NEXT, "SDL_PollEvent");
    real_ticks = (Uint32 (*)(void))dlsym(RTLD_NEXT, "SDL_GetTicks");
    real_delay = (void (*)(Uint32))dlsym(RTLD_NEXT, "SDL_Delay");
    if (path && *path) {
        out = fopen(path, "wb");
    }
    first = env_long("DOOMCAP_FIRST", 0);
    last = env_long("DOOMCAP_LAST", -1);
    step = env_long("DOOMCAP_STEP", 1);
    stop_after = env_long("DOOMCAP_STOP", -1);
    virtual_time = getenv("DOOMCAP_VIRTUAL_TIME") != NULL;
    if (step < 1) {
        step = 1;
    }
    if (keys && *keys) {
        load_script(keys);
    }
}

static void record(SDL_Texture *texture, const void *pixels, int pitch)
{
    int w = 0;
    int h = 0;
    long index;

    if (SDL_QueryTexture(texture, NULL, NULL, &w, &h) != 0 || w != SCREEN_W || h != SCREEN_H) {
        return;
    }
    index = shown++;
    if (out && index >= first && (last < 0 || index <= last) && (index - first) % step == 0) {
        const uint32_t head[4] = {0x4d415246u, (uint32_t)index, (uint32_t)w, (uint32_t)h};
        int y;

        fwrite(head, sizeof head, 1, out);
        for (y = 0; y < h; y++) {
            fwrite((const char *)pixels + (size_t)y * (size_t)pitch, 4, (size_t)w, out);
        }
        fflush(out);
    }
    if (stop_after >= 0 && shown >= stop_after) {
        if (out) {
            fflush(out);
        }
        _exit(0);
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

Uint32 SDL_GetTicks(void)
{
    return virtual_time ? clock_ms : real_ticks();
}

void SDL_Delay(Uint32 ms)
{
    if (virtual_time) {
        clock_ms += ms;
    } else {
        real_delay(ms);
    }
}

int SDL_PollEvent(SDL_Event *event)
{
    if (event && script_next < script_len && script[script_next].frame <= shown) {
        const ScriptedKey *entry = &script[script_next++];

        memset(event, 0, sizeof *event);
        event->type = entry->down ? SDL_KEYDOWN : SDL_KEYUP;
        event->key.type = event->type;
        event->key.timestamp = clock_ms;
        event->key.windowID = 1;
        event->key.state = entry->down ? SDL_PRESSED : SDL_RELEASED;
        event->key.repeat = 0;
        event->key.keysym.scancode = entry->scancode;
        event->key.keysym.sym = entry->key;
        event->key.keysym.mod = KMOD_NONE;
        return 1;
    }
    return real_poll(event);
}
