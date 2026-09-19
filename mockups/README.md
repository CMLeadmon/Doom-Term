# `mockups/` — design study, not shipped code

> **Nothing in this directory is part of the Doom Term build.** No crate depends
> on it, `cargo build` never sees it, and `./script/presubmit` does not run it.
> It is a static design prototype used to decide what the UI should become.

It answers one question: **what does Warp's shell look like once it is wearing
Doom Term's front panel?** It does that by rebuilding a real Warp screen from a
production screenshot, measuring how close the rebuild got, and then bolting the
archived Doom Term status plate onto it.

---

## Running it

No build step and no dependencies — it is plain ES modules and CSS.

```sh
python3 -m http.server 8777 --directory mockups
```

| Page | What it is |
| --- | --- |
| [`shell.html`](shell.html) | **The mockup.** The interactive app at production density — start here. |
| [`index.html`](index.html) | The design report: the app, the 1:1 parity study, and the measurements. |
| [`selftest.html`](selftest.html) | The behaviour suite as a bare pass/fail table. |
| [`app.html`](app.html) | The 1:1 rebuild alone. `?bare=1` drops the plate and rail — this is what the parity diff measures. |

Re-run the measurements after changing the rebuild:

```sh
python3 mockups/scripts/measure.py mockups/assets/warp-ref.webp <render.png> mockups/evidence
```

---

## What is real, and what is a mockup

This matters, because the point of the study is that the plate is *not* a
drawing of itself.

**Real.** [`plate.js`](plate.js) is the archived tree's reference renderer,
copied **byte for byte** from
[`Doom-Term--deprecated:src/hud/plate.js`](https://github.com/CMLeadmon/Doom-Term--deprecated).
Every plate, agent mark and status glyph on these pages is its output, blitted
to a canvas the way `src/hud/canvas.ts` does it. [`hit.js`](hit.js) computes
click regions from that file's own `plateSpec()` and `waitingRowBox()`, so a row
the renderer declines to paint cannot be clicked.

**Forked, and labelled.** [`plate.doom.js`](plate.doom.js) is a copy of the above
with exactly three changes, each marked `FORK:` at its site and listed in the
file header: the chip lamps and token table are dropped, `MODE` moves to the
plate edge, and the agent queue always splits into two columns. Only
`shell.html` draws through it. Diff the two files to see the whole delta.

**A mockup.** Everything else — the session list, the terminal output, the code
review panel, the icons — is hand-built HTML and CSS standing in for Warp's real
UI. The sessions, diffs and telemetry are plausible fixtures, not live data.

---

## The numbers on the page

`index.html` reports two independent things, both generated rather than typed:

* **Pixel parity** — [`scripts/measure.py`](scripts/measure.py) compares the 1:1
  rebuild against the source screenshot channel by channel and writes
  `evidence/metrics.json`, which becomes `metrics.js`. It runs the *same*
  landmark detectors over both images, so neither column is a value the rebuild
  was built to. The residual is dominated by typeface differences: Warp ships
  its own faces, and these pages use the closest pair available from an allowed
  font host, with size and tracking tuned to match the measured 18.2px advance.
* **Behaviour** — [`selftest.js`](selftest.js) runs in the reader's own browser
  against a second copy of the app mounted off-screen, and prints PASS/FAIL. It
  is executed, not recorded.

The plate and the agent rail are **excluded** from the parity render. They are
additions, and scoring them against a screenshot that never contained them would
report a deficit that is really a feature.

---

## Third-party material

`assets/warp-ref.webp` is a Warp product screenshot published by Warp, retained
here as the reference the rebuild is measured against; `reference-app.webp` is a
crop of it. They are included for comparison and criticism only. **Warp** and
its trade dress are trademarks of Denver Technologies, Inc. / Warp Technologies,
Inc.; Doom Term is unaffiliated. See the trademark and licensing notices in the
[root README](../README.md). If these assets should not live in the repository,
delete `assets/warp-ref.webp` and `assets/reference-app.webp` — the mockup in
`shell.html` still runs; only the parity comparison loses its baseline.
