"""Nocturne's dither art: 1-bit SVG masks, tinted at draw time with svg(...).text_color().

Every mask is a grid of 2 px cells, ordered-dithered with a 4x4 Bayer matrix, so
each one stays one color and the mod picks that color from the theme.

    python3 -I generate.py      (writes next to this file)
"""

import math
import os
import random

CELL = 2
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
OUT = os.path.dirname(os.path.abspath(__file__))


def lit(x, y, density):
    return density > (BAYER[y % 4][x % 4] + 0.5) / 16


def svg(w, h, body):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" shape-rendering="crispEdges">{body}</svg>\n'
    )


def runs(grid):
    """Cells as horizontal runs: one rect per run keeps the files small."""
    out = []
    for y, row in enumerate(grid):
        x = 0
        while x < len(row):
            if row[x]:
                start = x
                while x < len(row) and row[x]:
                    x += 1
                out.append(
                    f'<rect x="{start * CELL}" y="{y * CELL}" width="{(x - start) * CELL}" height="{CELL}"/>'
                )
            else:
                x += 1
    return "".join(out)


def write(name, text):
    with open(os.path.join(OUT, name), "w") as f:
        f.write(text)


# Moon: a lit sphere in nine phases, new (0) to full (8). Lambert shading,
# dithered; the dark side keeps a faint earthshine so the disk always reads.
def moon(phase, n=44):
    f = phase / 8
    alpha = math.acos(2 * f - 1)  # phase angle from the lit fraction
    lx, lz = math.sin(alpha), math.cos(alpha)
    craters = [(-0.35, -0.2, 0.18), (0.25, 0.3, 0.14), (0.05, -0.5, 0.1), (-0.1, 0.45, 0.08)]
    grid = []
    for j in range(n):
        row = []
        for i in range(n):
            u = (i + 0.5) / n * 2 - 1
            v = (j + 0.5) / n * 2 - 1
            r2 = u * u + v * v
            if r2 > 1:
                row.append(False)
                continue
            z = math.sqrt(1 - r2)
            b = max(0.0, u * lx + z * lz)
            light = 0.25 + 0.85 * b ** 0.6 if b > 0 else 0.0
            for cx, cy, cr in craters:
                if (u - cx) ** 2 + (v - cy) ** 2 < cr * cr:
                    light *= 0.55
            if r2 > 0.86:  # limb darkening
                light *= 0.8
            row.append(lit(i, j, max(light, 0.07)))
        grid.append(row)
    return svg(n * CELL, n * CELL, runs(grid))


for p in range(9):
    write(f"moon-{p}.svg", moon(p))


# Hourglass: the usage section's short window. A glass outline and nine sand
# levels (0: all run down, 8: a full top bulb), two masks so each gets its own
# theme color. The sand settles at the neck of the top bulb and heaps up from
# the floor of the bottom one; a grain falls through the neck while it runs.
GLASS = [
    "#########",
    ".#.....#.",
    ".#.....#.",
    "..#...#..",
    "...#.#...",
    "...#.#...",
    "...#.#...",
    "..#...#..",
    ".#.....#.",
    ".#.....#.",
    "#########",
]


def hourglass_glass():
    return svg(9 * CELL, 11 * CELL, runs([[c == "#" for c in row] for row in GLASS]))


def hourglass_sand(level):
    def inside(rows):
        # Each row's open cells, middle first, so a part-filled row heaps up.
        out = []
        for y in rows:
            xs = [x for x in range(9) if GLASS[y][x] == "." and 0 < x < 8 and "#" in GLASS[y][:x] and "#" in GLASS[y][x:]]
            out += [(x, y) for x in sorted(xs, key=lambda x: abs(x - 4))]
        return out

    top, bottom = inside([4, 3, 2, 1]), inside([9, 8, 7, 6])
    n = round(level / 8 * len(top))
    cells = set(top[:n]) | set(bottom[: len(bottom) - n])
    if 0 < level < 8:
        cells.add((4, 5))
    return svg(9 * CELL, 11 * CELL, runs([[(x, y) in cells for x in range(9)] for y in range(11)]))


write("hourglass-glass.svg", hourglass_glass())
for p in range(9):
    write(f"hourglass-{p}.svg", hourglass_sand(p))


# Glow: a firefly's halo, solid core falling off to scattered dots.
def glow(n=20):
    c = (n - 1) / 2
    grid = []
    for j in range(n):
        row = []
        for i in range(n):
            r = math.hypot(i - c, j - c) / (n / 2)
            if r < 0.14:
                row.append(True)
            else:
                row.append(lit(i, j, max(0.0, 1 - r) ** 1.7 * 0.95))
        grid.append(row)
    return svg(n * CELL, n * CELL, runs(grid))


write("glow.svg", glow())


# Lantern: the person's own firefly, the light the pointer carries over the
# sky (glow.js). Wider and fainter than a firefly's halo: no solid core, its
# heart at most 6/16 lit, so a name under it stays readable.
def lantern(n=56, peak=0.375):
    c = (n - 1) / 2
    grid = []
    for j in range(n):
        row = []
        for i in range(n):
            r = math.hypot(i - c, j - c) / (n / 2)
            row.append(lit(i, j, max(0.0, 1 - r) ** 1.6 * peak))
        grid.append(row)
    return svg(n * CELL, n * CELL, runs(grid))


write("lantern.svg", lantern())


# Haze: moonlight thickening toward the horizon, in eight Bayer steps, drawn
# bottom-anchored so the horizon stays at the sidebar's foot at any height.
def haze(w=480, h=1400, ramp=640, peak=0.375):
    # One 4x4-cell pattern per Bayer level, and a band of rows per level:
    # the same pixels as dithering the stepped ramp cell by cell, far smaller.
    steps = round(peak * 16)
    tile = 4 * CELL
    defs, bands = [], []
    band = ramp / steps
    for k in range(1, steps + 1):
        cells = [[lit(i, j, k / 16 + 1e-9) for i in range(4)] for j in range(4)]
        defs.append(
            f'<pattern id="p{k}" width="{tile}" height="{tile}" patternUnits="userSpaceOnUse">{runs(cells)}</pattern>'
        )
        y0 = h - ramp + round((k - 1) * band / CELL) * CELL
        y1 = h if k == steps else h - ramp + round(k * band / CELL) * CELL
        bands.append(f'<rect x="0" y="{y0}" width="{w}" height="{y1 - y0}" fill="url(#p{k})"/>')
    return svg(w, h, f"<defs>{''.join(defs)}</defs>{''.join(bands)}")


write("haze.svg", haze())


# Stars: fixed, sparse, a few with four points; top-anchored.
def stars(w=480, h=900, seed=7):
    rnd = random.Random(seed)
    cols, rows = w // CELL, h // CELL
    grid = [[False] * cols for _ in range(rows)]
    for _ in range(100):
        x, y = rnd.randrange(cols), rnd.randrange(rows)
        grid[y][x] = True
        if rnd.random() < 0.12 and 1 <= x < cols - 1 and 1 <= y < rows - 1:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                grid[y + dy][x + dx] = True
    return svg(w, h, runs(grid))


write("stars.svg", stars())


# Hills: two rolling ridges along the bottom. `hills-fill` is the solid
# ground (painted in the night color, covering the haze); `hills-rim` is the
# moonlit edge with grass tufts and a dithered fade below it.
def ridge(i, cols, a, b, c, base):
    x = i / cols
    return base + a * math.sin(x * 6.1 + 0.8) + b * math.sin(x * 13.7 + 2.1) + c * math.sin(x * 29 + 0.3)


def hills(w=480, h=144):
    cols, rows = w // CELL, h // CELL
    rnd = random.Random(3)
    fill = [[False] * cols for _ in range(rows)]
    rim = [[False] * cols for _ in range(rows)]
    for i in range(cols):
        back = round(ridge(i, cols, 6, 3, 1, rows * 0.42))
        front = round(ridge(i + 37, cols, 5, 2.5, 1.2, rows * 0.7))
        for j in range(rows):
            if j >= back:
                fill[j][i] = True
        # far ridge: a lit edge, then a short fade
        rim[back][i] = True
        for k in range(1, 6):
            if back + k < rows and lit(i, back + k, 0.42 * (1 - k / 6)):
                rim[back + k][i] = True
        # near ridge: brighter edge, grass tufts
        if front < rows:
            rim[front][i] = True
            if front + 1 < rows and lit(i, front + 1, 0.5):
                rim[front + 1][i] = True
            if rnd.random() < 0.16 and front - 1 >= 0:
                rim[front - 1][i] = True
                if rnd.random() < 0.4 and front - 2 >= 0:
                    rim[front - 2][i] = True
    write("hills-fill.svg", svg(w, h, runs(fill)))
    write("hills-rim.svg", svg(w, h, runs(rim)))


hills()

# Status pips: 6 px dithered diamonds, crisp at any zoom.
write(
    "pip.svg",
    svg(6, 6, '<rect x="2" y="0" width="2" height="2"/><rect x="0" y="2" width="6" height="2"/><rect x="2" y="4" width="2" height="2"/>'),
)
