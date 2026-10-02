# Redsky theme: design

Status: **deliverable A shipped 2026-10-01** (the pack is attached to the v1.1.5 release and installed on the
author's machine; see [`docs/doom-term/redsky-theme.md`](../../doom-term/redsky-theme.md)). Deliverable B (plate stone
tint in the binary) is not started and has no release date. Frame cadence and GPU cost on a real display are not yet
measured. Proposal board: https://claude.ai/artifact/GjvE4hoi7xgrT3qt2MeG7R (private).

## Goal

Ship **Redsky**, an animated, generated theme for Doom Term: a looping background (black sun, storm clouds,
three panning skyline layers, two lightning strikes), its own palette, and a plate whose stone material is a
dull wine-maroon. It must serve three promotional assets from one theme: a hero still, a seamless loop clip and a
live demo. It is optional: users who do not want it never download it.

## Decisions already made

| Decision | Choice | Source |
| --- | --- | --- |
| First direction | Redsky | user, 2026-10-01 |
| Build path | Animated image through the theme's `background_image` first; one effect gets a shader spike afterwards | user |
| Colour reach | Background art, ANSI palette, accent, cursor. No chrome restyling | user |
| Plate | Tint the **stone** material to a dull wine-maroon between `#660033`, `#722F37` and `#550000`. **Do not tint the bevels** | user, revised twice |
| Image opacity | Everything ships at **10** | user |
| Delivery | Theme pack, not bundled in the binary, **attached to the existing v1.1.5 release** | user |
| Promo copy | The opacity-100 copy stays **unshipped** | user |
| Stone tint activation | Explicit `plate_stone` key | recommended in review; not objected to |
| Content rules | Every pixel generated, no id Software assets, no game vocabulary in any label | README non-affiliation line; standing rule |

The earlier idea of registering `ThemeKind::Redsky` in `default_themes.rs` is dropped. A theme pack needs no change
to shared theme code, which keeps the invasive-diff ledger shorter.

## Scope: two deliverables

- **A. The pack on v1.1.5.** The generator crate, the baked GIF, the YAML, the install note and the release asset.
  This needs no change to the v1.1.5 binary and is what ships now.
- **B. Plate support in the binary.** The optional `plate_stone` key and the plate's stone remap. It cannot ship in
  v1.1.5. The pack's YAML carries the key from the start, so the same file lights up the plate when a later binary
  carries B. **On v1.1.5 the plate stays grey.** B has no release date yet.

## Non-goals

The shader spike, the Furnace/Caution/Sigil directions, a Furnace-under-Redsky combination, restyling the tab bar
or borders, tinting the plate's bevels, wells, numerals or labels, and any in-app downloader.

## Facts the design rests on

Read from the code in this repository:

- A theme file is YAML in `themes_dir()` = `data_dir()/themes` (`crates/warp_core/src/paths.rs:335`). Its
  `background_image` takes `path` (relative paths resolve against `themes_dir()`, `~` expands) and `opacity`
  (`crates/warp_core/src/ui/theme/mod.rs:21-80`). `user_config/native.rs:89,102` loads the directory and watches it, and `user_config/util.rs:148` takes the theme's name from the file. No theme type denies unknown keys.
- The workspace draws the image with animation enabled (`app/src/workspace/view.rs:29546`). A pane then paints
  `100 - image.opacity` of the theme background over it (`app/src/workspace/util.rs:398`). At opacity 10 the art is
  a faint ghost, and any darkening under text has to be baked into the artwork.
- Animated GIF and WebP decode in `crates/warpui_core/src/image_cache.rs:345-365`, and every frame is held decoded.
  The source calls animation "fairly experimental" (`elements/gui/image.rs:163`).
- The image sampler magnifies with linear filtering (`crates/warpui/src/rendering/wgpu/renderer/image.rs:113`), so
  low-resolution art scales soft. The board's default, soft scaling, is the faithful preview.
- The shipping plate paints its stone from `colors::STONE` (eight tones) and `STONE_CRACK`
  (`crates/doomterm_plate/src/paint.rs:57-67`), in irregular patches (`Rasterizer::stone`, line 136). The board's
  plate is the archived 32 px reference renderer with lighter stone, so it previews the tint, not the exact pixels.
- **Verified on the real v1.1.5 binary** (`~/.local/bin/doomterm`, headless KWin lab, private profile): the pack
  loads, the Redsky palette applies, the background is drawn and changes between captures (lightning appears in
  some), text is legible at opacity 10, the plate stays grey, and the unknown `plate_stone` key does not stop the
  theme loading. A relative image path resolves against `themes_dir()`, not the YAML's folder
  (`crates/warp_core/src/ui/theme/mod.rs:64-72`), and theme discovery walks subfolders
  (`app/src/user_config/util.rs:218`), which is why the pack ships a `redsky/` folder.
- **Measured:** the baked GIF is 1,907,505 bytes (100 frames, 480×300, 8 cs each) and bakes in 8 s. With the pack
  active the app's resident memory was 256 MiB against 192 MiB on the default theme, a difference of 58 MiB, in line
  with the 55 MiB of decoded frames. CPU time over 30 s was no higher than the baseline (13.4% of a core against
  17.2%, within noise; the headless compositor throttles painting, so this is not proof of low cost).
- Release tags are `v*`; the version string is `GIT_RELEASE_TAG="${GITHUB_REF_NAME#v}"`
  (`.github/workflows/doomterm-ci.yml`). The product does not update itself or send telemetry, and
  `script/doomterm/check-build-policy.py` guards the network surface.

## Design

### 1. The asset: `doomterm_backdrop`

A new workspace crate beside `doomterm_plate`, following its shape: pure deterministic pixel code (no GPU, no clock,
no randomness beyond a fixed integer hash), unit tests in `*_tests.rs`, and an example that bakes the output.

- `redsky_frame(frame, size) -> Rgba8 buffer`, a Rust port of the board's generator: tileable value noise, the
  cloud layer drifting one tile per loop, skyline layers panning at 1x, 2x and 3x, tower-window flicker, the black
  sun, and two lightning bolts. Every time-dependent term is periodic in the loop phase, so frame N equals frame 0.
- A left-weighted scrim is part of the sky (`0.3 + 0.7 * smoothstep(...)^1.5` across the width), so text stays
  readable where the sky is brightest. It is baked in because the pane overlay is flat.
- Baked at **480×300**, **100 frames at 8 cs each (12.5 fps, an 8 s loop)**, lightning on frames 28 and 70.
  Decoded size is 480 × 300 × 4 × 100 ≈ 55 MiB.
- Container: **GIF**, written with the `gif` crate directly (already in the lockfile as a dependency of `image`).
  Each frame carries its own exact palette, so there is no quantiser: the output is deterministic and lossless, and a
  frame with more than 256 colours is an error rather than a silent downgrade. The sampled frames all fit.
  Animated WebP stays an option only if a measured size or quality problem justifies a new encoder dependency.
- The baked GIF is a committed artifact. Tests assert the generator, not the GIF's bytes (the quantiser may differ
  across versions); a separate check decodes the committed GIF and compares each frame to a fresh render.

### 2. The theme pack

Files under `themes/redsky/` in the repository. The release zip holds one top-level `redsky/` folder with the same
three files, so that extracting it into the themes folder puts them in `<themes>/redsky/`, where the YAML's
`redsky/redsky.gif` resolves.

```yaml
name: Redsky
background: '#10060b'
foreground: '#efdcd6'
accent: '#e8294f'
cursor: '#ff9a3c'
details: darker
terminal_colors:
  normal:
    black: '#1c0a10'
    red: '#e8294f'
    green: '#6fbf73'
    yellow: '#e8a23a'
    blue: '#7b82e8'
    magenta: '#c24bd1'
    cyan: '#4fc3d9'
    white: '#e2d2d0'
  bright:
    black: '#6e3a48'
    red: '#ff5b7d'
    green: '#9be08c'
    yellow: '#ffc65c'
    blue: '#a6acff'
    magenta: '#e27cf0'
    cyan: '#7ee3f3'
    white: '#fff0ec'
background_image:
  path: redsky/redsky.gif
  opacity: 10
plate_stone: '#49121f'
```

A test parses this file and checks its contract (the loader's required keys, the agreed values, that the image path
exists inside the pack, and that nothing else is shipped). The real loader is exercised by the live-app check below.

### 3. Plate stone tint (deliverable B)

Only the plate's stone moves. Bevels, wells, grooves, numerals, labels and status colours are unchanged.

- A new optional theme key `plate_stone` holds the **mid stone tone** as a hex colour. Themes without it render the
  plate exactly as today, and a binary that predates the key ignores it (no theme type denies unknown fields), so
  on v1.1.5 the pack simply shows a grey plate.
- The plate derives nine colours from it by lightness-preserving remap: take the key's hue and saturation, and map
  each source tone's lightness, relative to the lightest and darkest of the eight, into the range `L ± 0.04`, where
  `L` is the key's own lightness.
- **The Redsky key is `#49121f`**: hue 346° (the mean hue of `#660033`, `#722F37` and `#550000`), saturation 0.60
  (toned down from their 0.72 mean to read dull), lightness 0.18. Taking the three colours' plain RGB average gives
  `#641023`, which is lighter than the previous tint because `#722F37` is much lighter than the other two; the key
  keeps the lightness the user's two darker colours bracket and takes the hue from all three. To make it darker or
  lighter, change the key's lightness and nothing else.

| Source | Tinted | Source | Tinted |
| --- | --- | --- | --- |
| `STONE[0]` `#505150` | `#49121f` | `STONE[5]` `#4b4c4a` | `#44111c` |
| `STONE[1]` `#595a58` | `#521422` | `STONE[6]` `#5d5e5c` | `#561524` |
| `STONE[2]` `#454645` | `#3e101a` | `STONE[7]` `#404140` | `#390e18` |
| `STONE[3]` `#616260` | `#5a1626` | `STONE_CRACK` `#393a39` | `#320d15` |
| `STONE[4]` `#535452` | `#4c1320` | | |

- Contrast over the mid stone tone: tan labels rise from 4.2:1 to 7.9:1, the red numerals from 1.8:1 to 3.5:1. The
  numerals lose some hue separation from the red-tinged ground, so the live check below must look at them.
- Code touched: an optional field on `WarpTheme` (`crates/warp_core/src/ui/theme/mod.rs`) with a builder-style
  setter so `WarpTheme::new`'s signature does not change; `app/src/doomterm/status_plate.rs` reads it from the active
  theme; `crates/doomterm_plate/src/paint.rs` takes the stone tones as a parameter instead of a constant. The first
  edit is to a file shared with upstream and needs an entry in `docs/doom-term/invasive-diff.json`.

### 4. Distribution

| Option | Cost | Verdict |
| --- | --- | --- |
| **Theme pack as an extra release asset**, installed by unzipping into `themes_dir()` | One small zip per release, no extra build | **Recommended** |
| Bundle in the binary | Adds the GIF (a few MB) to every platform build; the whole bundled asset directory is 4.8 MB today | No |
| Separate build per release, e.g. `v1.1.5.t` | Doubles the three-platform build matrix. A letter suffix reaches the macOS bundle's `--release-tag` and the Windows installer, which expect numeric dotted versions. a `v1.1.2.1` tag exists, so four numeric parts have precedent; a letter suffix is unverified | No |
| In-app downloader | A new network path in a product that promises none, and the build-policy guard exists to stop that | No |

The pack works on **v1.1.5 as it stands**: palette, animation and opacity need no new code, and the plate stays
grey until a binary carries `plate_stone`. **Chosen route:** attach `doomterm-redsky-theme.zip` to the existing
`v1.1.5` release, with its SHA-256 added to that release's `SHA256SUMS.txt`. This is an outward-facing change to a
published release, so the upload is the last step of the plan and happens only after the pack has been verified.

For a later binary release, plain `vX.Y.Z` tags stay the convention. The CI release job would then zip
`themes/redsky/` itself, and the existing `SHA256SUMS.txt` step must cover it. If the art changes with no binary
change, the pack is versioned independently by its asset name (`doomterm-redsky-theme-2.zip`), not by a build.

### 5. Data flow

Unzip into `themes_dir()` (Linux here: `~/.local/share/doomterm/themes`; macOS and Windows locations are confirmed
from `data_dir()` during implementation) → the config watcher reloads → the theme chooser lists "Redsky" → the
workspace decodes `redsky.gif` and animates it behind the panes at opacity 10 → the plate reads `plate_stone` from
the active theme and recolours its stone.

## Error handling

- Missing or unreadable GIF: the theme must still load with its flat background. Confirmed by a test, not assumed.
- A corrupt or oversized GIF: bounded by the 480×300 × 100-frame budget; the generator test fails if the committed
  asset exceeds it.
- Invalid `plate_stone`: the field deserialises leniently (`deserialize_with`, returning `None` on a bad value),
  so the plate renders grey and the rest of the theme still loads. Without that, serde would reject the whole file.
  A test feeds a malformed value and asserts the theme still loads.
- Reduced motion and CPU: the board shows the animation is cheap to draw in a browser; the real cost in the
  renderer is unmeasured and is a verification item, not a claim.

## Verification

Unit and contract tests, in the new crate (CI's policy job gains `-p doomterm_backdrop`):

- The generator is deterministic and its loop closes (phase 1.0 reproduces phase 0.0).
- Lightning frames carry a bolt and calm frames do not; the left of the frame is darker than the right.
- Every sampled baked frame has at most 256 colours; the GIF round trip is lossless; over-palette frames and
  wrong-sized buffers are errors.
- The committed GIF decodes to 100 frames of 480×300 at 8 cs, stays inside the size and memory budgets, and sampled
  frames match a fresh render.
- The pack's YAML satisfies the contract above, and its text contains no game vocabulary.
- The packaged zip has the `redsky/` layout, is byte-for-byte reproducible, and fails rather than ship a partial
  archive (a Python test beside the packaging script).

Live checks with the real v1.1.5 binary in the headless KWin lab (`script/doomterm/kwin-lab`): the theme loads and the
background moves (done once, results above); the app still starts with the pack present but its GIF removed.

Not yet established, and listed as plan tasks rather than claimed:

- **Frame cadence.** Consecutive captures 3 s apart were identical in two of six pairs, so the headless compositor
  cannot show whether the background repaints at the GIF's 12.5 fps. Measure it with `script/doomterm/fb_sampler.py`
  in the Xvfb verify container, or on a real display.
- GPU memory and real CPU cost on a real display.

**Promo captures.** At opacity 10 the art is nearly invisible, so the hero still, the loop clip and the live demo are
captured from a local copy of the YAML at opacity 100. That copy is **not shipped**: it is not in the pack, not on
the release, and not committed under `themes/`.

## Risks and unverified items

- Frame cadence on a real display is unmeasured (see Verification).
- GPU upload cost of 100 decoded frames is unmeasured; resident memory rose by 58 MiB.
- Extracting the zip somewhere other than the themes folder, then moving only the YAML, loads the theme with a flat
  background and no animation, silently. The README says so, and the `redsky/` layout is what makes the normal
  extraction work.
- The board previews the archived reference plate; the shipping plate's patches will look different. Deliverable B
  is not exercised by this plan.
- Red numerals on wine-maroon stone: higher luminance contrast, less hue contrast (deliverable B).
- The macOS and Windows themes folders are not verified. The README states only the Linux path unless they are
  confirmed before release.

## Open questions

1. Container: GIF (recommended) or animated WebP, decided by measured size and quality of the first bake.
2. When deliverable B ships. It needs a new binary after v1.1.5.
