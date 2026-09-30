"""Inline-SVG chart primitives for the release evidence page.

Every chart is drawn from one scale per axis, carries its own data as JSON so the page script can
show a crosshair readout, and uses only the page's colour tokens (CSS variables), so it follows
the page rather than carrying colours of its own.
"""

import html
import json
import math

FONT = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"


def esc(text):
    return html.escape(str(text), quote=True)


def nice_ticks(low, high, target=5):
    """Round tick values, 1, 2 or 5 times a power of ten apart, inside [low, high]."""
    span = max(high - low, 1e-9)
    magnitude = 10 ** math.floor(math.log10(span / target))
    step = min((factor * magnitude for factor in (1, 2, 5, 10)), key=lambda s: abs(span / s - target))
    ticks = []
    value = math.ceil(low / step - 1e-9) * step
    while value <= high + 1e-9:
        ticks.append(round(value, 6))
        value += step
    return ticks


class Plot:
    """A rectangular plot area with linear x and y scales."""

    def __init__(self, width, height, x_domain, y_domain, left=46, right=18, top=10, bottom=30):
        self.width, self.height = width, height
        self.left, self.right, self.top, self.bottom = left, right, top, bottom
        self.x0, self.x1 = x_domain
        self.y0, self.y1 = y_domain

    def x(self, value):
        span = (self.x1 - self.x0) or 1.0
        return self.left + (value - self.x0) / span * (self.width - self.left - self.right)

    def y(self, value):
        span = (self.y1 - self.y0) or 1.0
        return self.height - self.bottom - (value - self.y0) / span * (self.height - self.top - self.bottom)

    @property
    def inner_width(self):
        return self.width - self.left - self.right

    @property
    def inner_height(self):
        return self.height - self.top - self.bottom


def step_segments(plot, steps, x_end):
    """Path data for a step function. A `None` value leaves a gap, which is what a dash means."""
    parts = []
    drawing = False
    for index, (when, value) in enumerate(steps):
        until = steps[index + 1][0] if index + 1 < len(steps) else x_end
        start = max(when, plot.x0)
        end = min(until, plot.x1)
        if value is None or end <= plot.x0 or start >= plot.x1:
            drawing = False
            continue
        y = plot.y(value)
        if drawing:
            parts.append(f"V{y:.1f}H{plot.x(end):.1f}")
        else:
            parts.append(f"M{plot.x(start):.1f} {y:.1f}H{plot.x(end):.1f}")
            drawing = True
    return "".join(parts)


def gap_spans(steps, x_end, x_start):
    """Time spans during which a step function has no value."""
    spans = []
    for index, (when, value) in enumerate(steps):
        until = steps[index + 1][0] if index + 1 < len(steps) else x_end
        start, end = max(when, x_start), min(until, x_end)
        if value is None and end > start:
            if spans and abs(spans[-1][1] - start) < 1e-6:
                spans[-1] = (spans[-1][0], end)
            else:
                spans.append((start, end))
    return spans


def axes(plot, x_label, y_label, x_ticks, y_ticks, y_format=lambda v: f"{v:g}"):
    """Grid, tick labels and axis titles, in the page's muted ink."""
    out = []
    for value in y_ticks:
        y = plot.y(value)
        out.append(
            f'<line class="grid" x1="{plot.left}" x2="{plot.width - plot.right}" y1="{y:.1f}" y2="{y:.1f}"/>'
            f'<text class="tick" x="{plot.left - 8}" y="{y + 4:.1f}" text-anchor="end">{esc(y_format(value))}</text>'
        )
    for value in x_ticks:
        x = plot.x(value)
        out.append(
            f'<line class="grid vertical" x1="{x:.1f}" x2="{x:.1f}" y1="{plot.top}" y2="{plot.height - plot.bottom}"/>'
            f'<text class="tick" x="{x:.1f}" y="{plot.height - plot.bottom + 16}" text-anchor="middle">{value:g}</text>'
        )
    out.append(
        f'<text class="axis-title" x="{plot.left + plot.inner_width / 2:.1f}" y="{plot.height - 4}" '
        f'text-anchor="middle">{esc(x_label)}</text>'
    )
    if y_label:
        out.append(
            f'<text class="axis-title" transform="translate(12 {plot.top + plot.inner_height / 2:.1f}) rotate(-90)" '
            f'text-anchor="middle">{esc(y_label)}</text>'
        )
    return "".join(out)


def chart_frame(inner, width, height, label, data=None):
    payload = f" data-chart='{esc(json.dumps(data, separators=(',', ':')))}'" if data else ""
    return (
        f'<svg class="v115-svg" viewBox="0 0 {width} {height}" role="img" aria-label="{esc(label)}" '
        f'font-family="{FONT}"{payload}>{inner}</svg>'
    )


def step_chart(rows, x_domain, y_domain, x_label, width=560, row_height=84,
               y_ticks=None, y_format=lambda v: f"{v:g}", label="", unit=""):
    """Panels that share one time axis, one per row; each panel overlays step-function lines.

    A row is `{name, note, lines: [{role, label, steps}]}`. Lines are drawn in order, so the real
    value goes first and the displayed value on top. Where the last line has no value the panel
    shades the span: that is where the plate showed a dash.
    """
    left, right, caption, gap, bottom = 44, 14, 20, 10, 36
    height = len(rows) * (caption + row_height + gap) - gap + bottom
    x_ticks = nice_ticks(x_domain[0], x_domain[1], 6)
    out = []
    data_rows = []
    for index, row in enumerate(rows):
        origin = index * (caption + row_height + gap)
        plot = Plot(width, row_height, x_domain, y_domain, left=left, right=right, top=4, bottom=4)
        body = []
        ticks = y_ticks or nice_ticks(y_domain[0], y_domain[1], 3)
        for value in ticks:
            y = plot.y(value)
            body.append(
                f'<line class="grid" x1="{plot.left}" x2="{width - plot.right}" y1="{y:.1f}" y2="{y:.1f}"/>'
                f'<text class="tick" x="{plot.left - 8}" y="{y + 4:.1f}" text-anchor="end">{esc(y_format(value))}</text>'
            )
        for value in x_ticks:
            x = plot.x(value)
            body.append(f'<line class="grid vertical" x1="{x:.1f}" x2="{x:.1f}" y1="{plot.top}" y2="{row_height - plot.bottom}"/>')
        shown = row["lines"][-1]
        for start, end in gap_spans(shown["steps"], x_domain[1], x_domain[0]):
            body.append(
                f'<rect class="gap {shown["role"]}" x="{plot.x(start):.1f}" y="{plot.top}" '
                f'width="{max(plot.x(end) - plot.x(start), 1):.1f}" height="{row_height - plot.top - plot.bottom:.1f}"/>'
            )
        for line in row["lines"]:
            body.append(f'<path class="line {line["role"]}" d="{step_segments(plot, line["steps"], x_domain[1])}"/>')
        out.append(
            f'<g transform="translate(0 {origin})">'
            f'<text class="row-name {shown["role"]}" x="{left}" y="13">{esc(row["name"])}</text>'
            f'<text class="row-note" x="{width - right}" y="13" text-anchor="end">{esc(row.get("note", ""))}</text>'
            f'<g transform="translate(0 {caption})">{"".join(body)}</g></g>'
        )
        data_rows.append({
            "name": row["name"], "top": origin + caption,
            "lines": [{"label": line["label"], "role": line["role"],
                       "steps": [[round(when, 2), value] for when, value in line["steps"]]}
                      for line in row["lines"]],
        })
    plot0 = Plot(width, height, x_domain, y_domain, left=left, right=right)
    axis_y = height - bottom + 14
    for value in x_ticks:
        out.append(f'<text class="tick" x="{plot0.x(value):.1f}" y="{axis_y}" text-anchor="middle">{value:g}</text>')
    out.append(f'<text class="axis-title" x="{left + (width - left - right) / 2:.1f}" y="{height - 4}" text-anchor="middle">{esc(x_label)}</text>')
    out.append(f'<line class="crosshair" x1="0" x2="0" y1="{caption}" y2="{height - bottom}" visibility="hidden"/>')
    data = {"rows": data_rows, "x": [x_domain[0], x_domain[1]], "plotLeft": left, "plotRight": width - right,
            "width": width, "height": height, "rowHeight": row_height, "unit": unit}
    return chart_frame("".join(out), width, height, label, data)


def histogram(series, bin_ms, limit_ms, width=860, height=260, label=""):
    """Overlaid step histograms of inter-frame intervals, one per series.

    `series` are dicts with `name`, `role` and `values` (milliseconds). Counts are shares of that
    series' own intervals, so runs of different length compare fairly.
    """
    left, right, top, bottom = 56, 160, 10, 40
    bins = int(limit_ms / bin_ms)
    shares = []
    for entry in series:
        counts = [0] * bins
        for value in entry["values"]:
            counts[min(int(value // bin_ms), bins - 1)] += 1
        total = max(sum(counts), 1)
        shares.append([100.0 * c / total for c in counts])
    top_share = max((max(s) for s in shares), default=10)
    y_max = max(10, int(top_share / 10 + 1) * 10)
    plot = Plot(width, height, (0, limit_ms), (0, y_max), left=left, right=right, top=top, bottom=bottom)
    out = [axes(plot, "time between changes of the mark (ms)", "share of intervals (%)",
                nice_ticks(0, limit_ms, 8), nice_ticks(0, y_max, 5))]
    for entry, share in zip(series, shares):
        parts = []
        for index, value in enumerate(share):
            x0, x1 = plot.x(index * bin_ms), plot.x((index + 1) * bin_ms)
            y = plot.y(value)
            parts.append(f"M{x0:.1f} {plot.y(0):.1f}V{y:.1f}H{x1:.1f}V{plot.y(0):.1f}")
        out.append(f'<path class="bars {entry["role"]}" d="{"".join(parts)}"/>')
    for index, entry in enumerate(series):
        y = top + 16 + index * 34
        out.append(f'<text class="row-name {entry["role"]}" x="{width - right + 12}" y="{y}">{esc(entry["name"])}</text>'
                   f'<text class="row-note" x="{width - right + 12}" y="{y + 15}">{esc(entry.get("note", ""))}</text>')
    return chart_frame("".join(out), width, height, label)


def paired_bars(rows, width=860, label=""):
    """Horizontal bars, before above after, for values that are percentages."""
    left, right, top, bottom, bar, pair_gap, group_gap = 250, 60, 8, 26, 14, 3, 18
    height = top + len(rows) * (2 * bar + pair_gap + group_gap) + bottom
    plot = Plot(width, height, (0, 100), (0, 1), left=left, right=right, top=top, bottom=bottom)
    out = []
    for value in (0, 25, 50, 75, 100):
        x = plot.x(value)
        out.append(f'<line class="grid vertical" x1="{x:.1f}" x2="{x:.1f}" y1="{top}" y2="{height - bottom}"/>'
                   f'<text class="tick" x="{x:.1f}" y="{height - bottom + 16}" text-anchor="middle">{value}%</text>')
    for index, row in enumerate(rows):
        y = top + index * (2 * bar + pair_gap + group_gap)
        out.append(f'<text class="row-label" x="{left - 12}" y="{y + bar + 2}" text-anchor="end">{esc(row["name"])}</text>')
        for offset, role, key in ((0, "before", "before"), (bar + pair_gap, "after", "after")):
            value = row[key]
            if value is None:
                continue
            w = plot.x(value) - plot.x(0)
            out.append(f'<rect class="bar {role}" x="{plot.x(0):.1f}" y="{y + offset}" width="{max(w, 1):.1f}" height="{bar}"/>'
                       f'<text class="value {role}" x="{plot.x(value) + 6:.1f}" y="{y + offset + bar - 3}">{value:.1f}%</text>')
    return chart_frame("".join(out), width, height, label)
