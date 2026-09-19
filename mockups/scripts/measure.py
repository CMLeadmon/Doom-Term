#!/usr/bin/env python3
"""Parity measurement for the Warp Sidecar study.

Runs the SAME landmark detectors over the reference screenshot and over the
rebuilt page, so every row of the geometry table is derived from pixels on both
sides rather than asserted on one. Emits evidence/metrics.json plus the diff
images the artifact renders.

  python3 scripts/measure.py <reference.png> <rebuild.png> <outdir>
"""
import json, sys, statistics as st
from PIL import Image
import numpy as np

REF_ORIGIN = (149, 100)          # app window inside the marketing capture
APP = (2100, 1313)               # the region both sides are compared over

REGIONS = {
    'titlebar':      (0, 0, 2100, 54),
    'sidebar':       (0, 54, 302, 1313),
    'centre pane':   (302, 54, 1412, 1313),
    'review panel':  (1412, 54, 2100, 1313),
}

def load(path, origin=(0, 0)):
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(int)
    ox, oy = origin
    return a[oy:oy + APP[1], ox:ox + APP[0]]

# ---------------------------------------------------------------- detectors
def col_steps(a, thr=6):
    """x positions where the column-median colour steps — i.e. panel edges."""
    med = np.median(a, axis=0)
    d = np.abs(np.diff(med, axis=0)).sum(axis=1)
    return [int(x) + 1 for x in np.nonzero(d > thr)[0]]

def first_step_near(steps, target, window=40):
    near = [s for s in steps if abs(s - target) <= window]
    return near[0] if near else None

def row_bands(a, x0, x1, y0, y1, thr=110, gap=2):
    """vertical ink bands — one per line of text."""
    sub = a[y0:y1, x0:x1]
    on = (sub.max(axis=2) > thr).sum(axis=1) > 1
    out, cur, miss = [], None, 0
    for i, v in enumerate(on):
        if v:
            cur = [i, i] if cur is None else [cur[0], i]; miss = 0
        elif cur is not None:
            miss += 1
            if miss > gap:
                out.append((cur[0] + y0, cur[1] + y0)); cur = None
    if cur: out.append((cur[0] + y0, cur[1] + y0))
    return out

def glyph_runs(a, y0, y1, x0, x1, thr=110):
    sub = a[y0:y1 + 1, x0:x1]
    on = (sub.max(axis=2) > thr).sum(axis=0) > 0
    runs, cur = [], None
    for i, v in enumerate(on):
        if v: cur = [i, i] if cur is None else [cur[0], i]
        elif cur is not None: runs.append((cur[0] + x0, cur[1] + x0)); cur = None
    if cur: runs.append((cur[0] + x0, cur[1] + x0))
    return runs

def biggest_rect(a, hexcol, tol=12, min_w=200, min_h=20):
    """Bounding box of the largest solid block of a colour.

    Grows from the widest matching row-run rather than taking the bbox of every
    matching pixel, so scattered antialiasing elsewhere in the image cannot
    inflate the answer — and so the result is a real measurement on each side
    rather than whatever window the search was given.
    """
    t = np.array([int(hexcol[i:i + 2], 16) for i in (1, 3, 5)])
    m = np.abs(a - t).sum(axis=2) <= tol
    best = None
    for y in range(m.shape[0]):
        row = m[y]
        x = 0
        while x < len(row):
            if row[x]:
                x0 = x
                while x < len(row) and row[x]: x += 1
                if x - x0 >= min_w and (best is None or x - x0 > best[2]):
                    best = (x0, y, x - x0)
            else:
                x += 1
    if best is None: return None
    x0, y0, w = best
    # walk up and down while the same span stays filled
    top = y0
    while top > 0 and m[top - 1, x0:x0 + w].mean() > 0.9: top -= 1
    bot = y0
    while bot < m.shape[0] - 1 and m[bot + 1, x0:x0 + w].mean() > 0.9: bot += 1
    h = bot - top + 1
    return None if h < min_h else [int(x0), int(top), int(w), int(h)]

def panel_top(a, hexcol='#151716', x=1700, tol=10):
    """First row where the review panel's own ground actually begins."""
    t = np.array([int(hexcol[i:i + 2], 16) for i in (1, 3, 5)])
    col = np.abs(a[:, x - 60:x + 60] - t).sum(axis=2) <= tol
    frac = col.mean(axis=1)
    for y in range(20, 200):
        if frac[y] > 0.9 and frac[y:y + 30].mean() > 0.9:
            return int(y)
    return None

def landmarks(a):
    steps = col_steps(a)
    L = {}
    L['sidebar divider x']   = first_step_near(steps, 301)
    L['review panel left x'] = first_step_near(steps, 1412)
    # titlebar bottom = top of the review panel's darker ground
    L['titlebar bottom y'] = panel_top(a)
    r = biggest_rect(a, '#2f3133')
    for i, k in enumerate(('message input x', 'message input y', 'message input w', 'message input full-width rows')):
        L[k] = r[i] if r else None
    # terminal metrics
    bands = [b for b in row_bands(a, 330, 1400, 230, 740) if b[1] - b[0] > 15]
    tops = [b[0] for b in bands]
    L['terminal lines found'] = len(tops)
    L['terminal line pitch'] = (round(st.median([tops[i + 1] - tops[i]
                                for i in range(len(tops) - 1)]), 1) if len(tops) > 2 else None)
    L['terminal first ink y'] = tops[0] if tops else None
    # mono advance, measured on the widest terminal line
    if bands:
        b = max(bands, key=lambda b: len(glyph_runs(a, b[0], b[1], 330, 1400)))
        runs = glyph_runs(a, b[0], b[1], 330, 1400)
        starts = [s for s, _ in runs]
        gaps = [starts[i + 1] - starts[i] for i in range(len(starts) - 1)]
        gaps = [g for g in gaps if 12 < g < 24]
        L['mono advance px'] = round(st.median(gaps), 2) if gaps else None
        L['terminal text left x'] = runs[0][0] if runs else None
    # review diff line pitch
    dbands = [b for b in row_bands(a, 1430, 1530, 250, 900) if b[1] - b[0] > 12]
    dtops = [b[0] for b in dbands]
    L['diff line pitch'] = (round(st.median([dtops[i + 1] - dtops[i]
                            for i in range(len(dtops) - 1)]), 1) if len(dtops) > 2 else None)
    return L

def palette(a):
    """modal colour of flat patches that exist in both builds."""
    spots = {
        'app ground':        (600, 700, 660, 760),
        'review ground':     (1950, 1150, 2050, 1230),
        'active tab card':   (120, 120, 260, 150),
        'message input':     (700, 995, 1000, 1035),
        'diff deleted row':  (1900, 470, 2050, 560),
        'diff added row':    (1900, 770, 2050, 830),
    }
    out = {}
    for k, (x0, y0, x1, y1) in spots.items():
        patch = a[y0:y1, x0:x1].reshape(-1, 3)
        vals, counts = np.unique(patch, axis=0, return_counts=True)
        c = vals[counts.argmax()]
        out[k] = '#%02x%02x%02x' % tuple(int(v) for v in c)
    return out

def de76(h1, h2):
    """CIE76 in Lab — good enough to say 'same colour' vs 'visibly off'."""
    def lab(h):
        r, g, b = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
        f = lambda c: c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4
        r, g, b = f(r), f(g), f(b)
        X = (r * .4124 + g * .3576 + b * .1805) / .95047
        Y = (r * .2126 + g * .7152 + b * .0722)
        Z = (r * .0193 + g * .1192 + b * .9505) / 1.08883
        k = lambda t: t ** (1 / 3) if t > .008856 else 7.787 * t + 16 / 116
        X, Y, Z = k(X), k(Y), k(Z)
        return (116 * Y - 16, 500 * (X - Y), 200 * (Y - Z))
    a1, a2 = lab(h1), lab(h2)
    return round(sum((p - q) ** 2 for p, q in zip(a1, a2)) ** .5, 2)

# ---------------------------------------------------------------------- main
ref = load(sys.argv[1], REF_ORIGIN)
got = load(sys.argv[2])
out = sys.argv[3]

d = np.abs(ref - got)
maxch = d.max(axis=2)
mae = float(d.mean())

def region_stats(box):
    x0, y0, x1, y1 = box
    m = maxch[y0:y1, x0:x1]
    n = m.size
    return {
        'within_8':  round(100 * float((m <= 8).sum()) / n, 2),
        'within_16': round(100 * float((m <= 16).sum()) / n, 2),
        'within_32': round(100 * float((m <= 32).sum()) / n, 2),
        'mae':       round(float(np.abs(ref[y0:y1, x0:x1] - got[y0:y1, x0:x1]).mean()), 2),
    }

metrics = {
    'app_region': {'w': APP[0], 'h': APP[1]},
    'overall': {
        'within_8':  round(100 * float((maxch <= 8).sum()) / maxch.size, 2),
        'within_16': round(100 * float((maxch <= 16).sum()) / maxch.size, 2),
        'within_32': round(100 * float((maxch <= 32).sum()) / maxch.size, 2),
        'mae': round(mae, 2),
    },
    'regions': {k: region_stats(v) for k, v in REGIONS.items()},
    'landmarks': {},
    'palette': {},
}

lr, lg = landmarks(ref), landmarks(got)
for k in lr:
    a_, b_ = lr.get(k), lg.get(k)
    delta = None if (a_ is None or b_ is None) else round(b_ - a_, 2)
    metrics['landmarks'][k] = {'reference': a_, 'rebuild': b_, 'delta': delta}

pr, pg = palette(ref), palette(got)
for k in pr:
    metrics['palette'][k] = {'reference': pr[k], 'rebuild': pg[k], 'deltaE': de76(pr[k], pg[k])}

# ---- evidence images
heat = np.zeros((APP[1], APP[0], 3), dtype=np.uint8)
g = (ref.mean(axis=2) * 0.20).astype(np.uint8)
heat[..., 0] = heat[..., 1] = heat[..., 2] = g
sev = np.clip(maxch, 0, 96) / 96.0
heat[..., 0] = np.maximum(heat[..., 0], (sev * 255).astype(np.uint8))
heat[..., 1] = np.maximum(heat[..., 1], (np.clip(sev * 2 - 1, 0, 1) * 200).astype(np.uint8))
Image.fromarray(heat).save(f'{out}/diff-heatmap.png')
Image.fromarray(ref.astype(np.uint8)).save(f'{out}/reference-app.png')
Image.fromarray(got.astype(np.uint8)).save(f'{out}/rebuild-app.png')

json.dump(metrics, open(f'{out}/metrics.json', 'w'), indent=2)
print(json.dumps(metrics, indent=2))
