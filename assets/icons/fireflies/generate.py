"""Fireflies' app icon: Nocturne's 1-bit night meadow as a Liquid Glass icon.

Writes an Icon Composer bundle (Fireflies.icon: icon.json plus one SVG per
layer) and a flat Fireflies.svg of the same scene. build compiles the
bundle with actool into Fireflies.car (the app's Assets.car, macOS 26+)
and Fireflies.icns (earlier macOS).

The art follows Nocturne's (the Fireflies layout mod's art/generate.py): a grid of
cells ordered-dithered with a 4x4 Bayer matrix, every color from the moonfly
palette, kept to one shape so it reads in the Dock: a firefly, glass wings and
its lantern lit, under a crescent moon over one moonlit hill. Four glass
groups, back to front: the sky (a few stars, the lantern's dithered glow),
the moon, the hill, the firefly.

    python3 -I generate.py OUTDIR   (build runs it with assets/icons)
"""

import json
import math
import os
import sys

# moonfly (github.com/bluz71/vim-moonfly-colors), as modules/moonfly.nix has it
BG = "#080808"
NIGHT = "#13203a"
DUSK = "#3a4a6e"
BLACK = "#323437"
COMMENT = "#5f6d6d"
WHITE = "#c6c6c6"
BRIGHT_WHITE = "#e4e4e4"
BRIGHT_BLACK = "#949494"
BLUE = "#80a0ff"
YELLOW = "#e3c78a"

SIZE = 1024  # Icon Composer's canvas, in points
CELL = 32  # one dither cell: 4 px in a 128 px Dock tile, so it reads there
N = SIZE // CELL
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def lit(x, y, density):
    return density > (BAYER[y % 4][x % 4] + 0.5) / 16


class Layer:
    """A 32x32 grid of cells, each empty or one color."""

    def __init__(self):
        self.cells = [[None] * N for _ in range(N)]

    def set(self, x, y, color):
        if 0 <= x < N and 0 <= y < N:
            self.cells[y][x] = color

    def get(self, x, y):
        return self.cells[y][x] if 0 <= x < N and 0 <= y < N else None

    def rects(self):
        out = []
        for y, row in enumerate(self.cells):
            x = 0
            while x < N:
                c = row[x]
                end = x + 1
                while end < N and row[end] == c:
                    end += 1
                if c:
                    out.append(
                        f'<rect x="{x * CELL}" y="{y * CELL}" width="{(end - x) * CELL}" height="{CELL}" fill="{c}"/>'
                    )
                x = end
        return "".join(out)

    def svg(self):
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" '
            f'viewBox="0 0 {SIZE} {SIZE}" shape-rendering="crispEdges">{self.rects()}</svg>\n'
        )


# One firefly, its lantern lit, under a crescent moon over one hill: a single
# shape that reads at Dock size, the rest of Nocturne's sky left out.

# The moon: a thin crescent, lit from the right, in the top right corner.
MOON = (25.5, 6.5, 3.6)  # center x, y and radius, in cells


def moon():
    cx, cy, r = MOON
    layer = Layer()
    for y in range(N):
        for x in range(N):
            if math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r:
                continue
            # lit where the disk clears a second disk shifted left
            shade = math.hypot(x + 0.5 - cx + 1.8, y + 0.5 - cy + 0.4) < r
            # Every cell of the disk is painted, so the glass sees one round shape.
            layer.set(x, y, NIGHT if shade else WHITE)
    return layer


# The firefly: center of its body, in cells.
HERO = (14, 13)


def ellipse(x, y, cx, cy, rx, ry, tilt=0.0):
    dx, dy = x - cx, y - cy
    c, s = math.cos(tilt), math.sin(tilt)
    u, v = dx * c + dy * s, -dx * s + dy * c
    return (u / rx) ** 2 + (v / ry) ** 2


HILL = [round(25 + 1.6 * math.sin(x / N * 5.2 + 0.9) + 0.6 * math.sin(x / N * 11 + 2)) for x in range(N)]


def sky():
    """A few stars and the lantern's dithered glow: flat, no glass."""
    layer = Layer()
    for x, y, c in ((4, 4, BRIGHT_BLACK), (10, 2, COMMENT), (19, 3, BRIGHT_BLACK), (29, 13, COMMENT), (3, 17, COMMENT), (25, 19, BRIGHT_BLACK)):
        layer.set(x, y, c)
    hx, hy = HERO
    for y in range(N):
        for x in range(N):
            d = math.hypot(x - hx, (y - hy - 3) * 1.1) / 8.5
            if d < 1 and lit(x, y, (1 - d) ** 1.1 * 0.95):
                layer.set(x, y, YELLOW)
    return layer


def hills():
    """One hill, moonlit along its edge."""
    layer = Layer()
    for x in range(N):
        for y in range(HILL[x], N):
            k = y - HILL[x]
            layer.set(x, y, BLUE if k == 0 else DUSK if k < 3 and lit(x, y, 0.5 * (1 - k / 3)) else NIGHT)
    return layer


def wings():
    """Two wings, outlined in moonlight with a dithered membrane."""
    layer = Layer()
    hx, hy = HERO
    for s in (-1, 1):
        cx, cy, rx, ry, tilt = hx + s * 4.6, hy - 2.2, 4.6, 2.5, s * 0.45
        for y in range(N):
            for x in range(N):
                e = ellipse(x, y, cx, cy, rx, ry, tilt)
                if e > 1:
                    continue
                edge = any(ellipse(x + dx, y + dy, cx, cy, rx, ry, tilt) > 1 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
                layer.set(x, y, WHITE if edge else BRIGHT_BLACK if lit(x, y, 0.3) else DUSK)
    return layer


def bodies():
    """The firefly's body: dark head and thorax, the lantern lit below it."""
    layer = Layer()
    hx, hy = HERO
    for y in range(N):
        for x in range(N):
            if ellipse(x, y, hx, hy - 4, 1.3, 1.1) <= 1:  # head
                layer.set(x, y, BLACK)
            elif ellipse(x, y, hx, hy - 1.5, 1.4, 1.5) <= 1:  # thorax
                layer.set(x, y, BLACK)
            elif (e := ellipse(x, y, hx, hy + 3, 2.7, 3.7)) <= 1:  # lantern
                layer.set(x, y, BRIGHT_WHITE if lit(x, y, (1 - e) * 1.15) else YELLOW)
    for s in (-1, 1):  # antennae
        layer.set(hx + s, hy - 6, COMMENT)
        layer.set(hx + 2 * s, hy - 7, BRIGHT_BLACK)
    return layer


def flat(layers):
    """Every layer on the night gradient, in the macOS rounded square."""
    body = "".join(l.rects() for l in layers)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">'
        f'<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">'
        f'<stop stop-color="{BG}"/><stop offset="1" stop-color="{NIGHT}"/></linearGradient>'
        f'<clipPath id="tile"><rect x="100" y="100" width="824" height="824" rx="185"/></clipPath></defs>'
        f'<g clip-path="url(#tile)"><rect width="{SIZE}" height="{SIZE}" fill="url(#sky)"/>'
        f'<g transform="translate(100 100) scale({824 / SIZE})" shape-rendering="crispEdges">{body}</g></g></svg>\n'
    )


def srgb(hex_):
    r, g, b = (int(hex_[i : i + 2], 16) / 255 for i in (1, 3, 5))
    return f"srgb:{r:.5f},{g:.5f},{b:.5f},1.00000"


def layer(name, glass, **extra):
    return {"image-name": f"{name}.svg", "name": name, "glass": glass, **extra}


def group(layers, shadow=0.5, translucency=None, specular=True):
    g = {"layers": layers, "shadow": {"kind": "neutral", "opacity": shadow}, "specular": specular}
    g["translucency"] = {"enabled": translucency is not None, "value": translucency or 0.0}
    return g


SKY = {"linear-gradient": [srgb(BG), srgb(NIGHT)], "orientation": {"start": {"x": 0.5, "y": 0.05}, "stop": {"x": 0.5, "y": 0.8}}}


def icon_json():
    # Icon Composer lists groups front to back.
    return {
        # The same night in every appearance: left unspecialized, dark mode
        # would swap in the system's grey.
        "fill-specializations": [{"value": SKY}, {"appearance": "dark", "value": SKY}],
        "groups": [
            group([layer("bodies", True), layer("wings", True)], shadow=0.5, translucency=0.25),
            group([layer("hill", True)], shadow=0.6, translucency=0.15),
            group([layer("moon", True)], shadow=0.5, translucency=0.2),
            group([layer("sky", False)], shadow=0.0, specular=False),
        ],
        "supported-platforms": {"squares": ["macOS"]},
    }


def main(out):
    bundle = os.path.join(out, "Fireflies.icon")
    os.makedirs(os.path.join(bundle, "Assets"), exist_ok=True)
    art = {"sky": sky(), "moon": moon(), "hill": hills(), "wings": wings(), "bodies": bodies()}
    for name, l in art.items():
        with open(os.path.join(bundle, "Assets", f"{name}.svg"), "w") as f:
            f.write(l.svg())
    with open(os.path.join(bundle, "icon.json"), "w") as f:
        json.dump(icon_json(), f, indent=2)
        f.write("\n")
    with open(os.path.join(out, "Fireflies.svg"), "w") as f:
        f.write(flat(list(art.values())))


main(sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
