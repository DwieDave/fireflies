"""Fireflies' app icon: Nocturne's 1-bit night meadow as a Liquid Glass icon.

Writes an Icon Composer bundle (Fireflies.icon: icon.json plus one SVG per
layer) and a flat Fireflies.svg of the same scene. build compiles the
bundle with actool into Fireflies.car (the app's Assets.car, macOS 26+)
and Fireflies.icns (earlier macOS).

The art follows Nocturne's (the Herdr layout mod's art/generate.py): a grid of
cells ordered-dithered with a 4x4 Bayer matrix, every color from the moonfly
palette. Four glass groups, back to front: the sky (stars, moon halo, the
haze rising off the horizon), the moon, the hills, and the fireflies: one
large, with glass wings and a lit lantern, and two small ones, glowing in
Nocturne's agent colors: working amber, done green, needs-you red.

    python3 -I generate.py OUTDIR   (build runs it with assets/icons)
"""

import json
import math
import os
import random
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
GREEN = "#8cc85f"
BRIGHT_RED = "#ff5189"

SIZE = 1024  # Icon Composer's canvas, in points
CELL = 16  # one dither cell: 2 px in a 128 px Dock tile
N = SIZE // CELL
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def lit(x, y, density):
    return density > (BAYER[y % 4][x % 4] + 0.5) / 16


class Layer:
    """A 64x64 grid of cells, each empty or one color."""

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


# The moon: a waxing crescent, lit from the right, in the top right corner.
MOON = (49.5, 13.5, 7.5)  # center x, y and radius, in cells


def moon():
    cx, cy, r = MOON
    phase = 0.38  # lit fraction
    alpha = math.acos(2 * phase - 1)
    lx, lz = math.sin(alpha), math.cos(alpha)
    craters = [(0.45, -0.25, 0.2), (0.6, 0.35, 0.14)]
    layer = Layer()
    for y in range(N):
        for x in range(N):
            u, v = (x + 0.5 - cx) / r, (y + 0.5 - cy) / r
            r2 = u * u + v * v
            if r2 > 1:
                continue
            z = math.sqrt(1 - r2)
            b = max(0.0, u * lx + z * lz)
            light = 0.3 + 0.8 * b**0.5 if b > 0 else 0.0
            for kx, ky, kr in craters:
                if (u - kx) ** 2 + (v - ky) ** 2 < kr * kr:
                    light *= 0.7
            # Every cell of the disk is painted, so the glass sees one round
            # shape; the dither is in its colors: lit cells, and earthshine.
            if lit(x, y, light):
                layer.set(x, y, BRIGHT_WHITE if light > 0.98 else WHITE)
            else:
                layer.set(x, y, DUSK if lit(x, y, 0.06 + light * 0.3) else NIGHT)
    return layer


def ridge(x, a, b, c, base, shift):
    t = (x + shift) / N
    return base + a * math.sin(t * 6.1 + 0.8) + b * math.sin(t * 13.7 + 2.1) + c * math.sin(t * 29 + 0.3)


BACK = [round(ridge(x, 2.6, 1.3, 0.4, 50, 0)) for x in range(N)]
FRONT = [round(ridge(x, 2.0, 1.0, 0.5, 56.5, 37)) for x in range(N)]

# The firefly: center of its body, in cells.
HERO = (27, 27)


def sky():
    """Stars, the moon's halo and the horizon haze: flat dither, no glass."""
    layer = Layer()
    rnd = random.Random(11)
    cx, cy, r = MOON
    hx, hy = HERO
    for _ in range(34):
        x, y = rnd.randrange(N), rnd.randrange(44)
        if math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r + 3 or math.hypot(x - hx, (y - hy) * 0.7) < 15:
            continue
        color = rnd.choice([BRIGHT_BLACK, COMMENT, COMMENT, WHITE, BLUE])
        layer.set(x, y, color)
        if rnd.random() < 0.2:  # a four-pointed one
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                layer.set(x + dx, y + dy, COMMENT)
    for y in range(N):
        for x in range(N):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r
            if 0 < d < 4.5 and lit(x, y, 0.3 * (1 - d / 4.5) ** 1.5):
                layer.set(x, y, DUSK)
            h = BACK[x] - y
            if 0 < h < 10 and lit(x, y, 0.32 * (1 - h / 10) ** 1.4):
                layer.set(x, y, DUSK)
    return layer


def hills():
    """Two ridges: the far one moonlit along its edge, the near one grassy."""
    far, near = Layer(), Layer()
    rnd = random.Random(3)
    for x in range(N):
        for y in range(BACK[x], N):
            k = y - BACK[x]
            if k == 0:
                c = BLUE
            elif k < 5 and lit(x, y, 0.45 * (1 - k / 5)):
                c = DUSK
            else:
                c = NIGHT
            far.set(x, y, c)
        for y in range(FRONT[x], N):
            k = y - FRONT[x]
            if k == 0:
                c = COMMENT
            elif k < 4 and lit(x, y, 0.4 * (1 - k / 4)):
                c = BLACK
            else:
                c = BG
            near.set(x, y, c)
        if rnd.random() < 0.3:  # grass tufts
            near.set(x, FRONT[x] - 1, GREEN if rnd.random() < 0.5 else COMMENT)
            if rnd.random() < 0.3:
                near.set(x, FRONT[x] - 2, GREEN)
    return far, near


# Two more fireflies, the way Nocturne's sky shows agents: (x, y, color, halo radius).
FLIES = [
    (11, 46, GREEN, 4.5),  # done, over the grass
    (52, 40, BRIGHT_RED, 4),  # needs you
]


def ellipse(x, y, cx, cy, rx, ry, tilt=0.0):
    dx, dy = x - cx, y - cy
    c, s = math.cos(tilt), math.sin(tilt)
    u, v = dx * c + dy * s, -dx * s + dy * c
    return (u / rx) ** 2 + (v / ry) ** 2


def halos():
    layer = Layer()
    hx, hy = HERO
    glows = [(hx, hy + 4, YELLOW, 14)] + list(FLIES)
    for fx, fy, color, hr in glows:
        for y in range(N):
            for x in range(N):
                d = math.hypot(x - fx, y - fy) / hr
                if d < 1 and lit(x, y, (1 - d) ** 1.5 * 0.9):
                    layer.set(x, y, color)
    # its trail: a dotted loop back over the meadow
    for i in range(80):
        t = i / 80
        x = round(hx - 3 - 18 * t + 5 * math.sin(t * 8))
        y = round(hy + 12 + 8 * t - 6 * math.sin(t * 6))
        if t > 0.12 and i % (2 + i // 25) == 0:
            layer.set(x, y, YELLOW if t < 0.6 else COMMENT)
    return layer


def wings():
    """Four wings, outlined in moonlight with a dithered membrane."""
    layer = Layer()
    hx, hy = HERO
    for s in (-1, 1):
        for cx, cy, rx, ry, tilt in ((hx + s * 6.5, hy - 3.5, 7, 3.6, s * 0.5), (hx + s * 5, hy + 1.5, 5, 2.6, -s * 0.35)):
            for y in range(N):
                for x in range(N):
                    e = ellipse(x, y, cx, cy, rx, ry, tilt)
                    if e <= 1:
                        edge = any(ellipse(x + dx, y + dy, cx, cy, rx, ry, tilt) > 1 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
                        if edge:
                            c = WHITE
                        elif lit(x, y, 0.35 * (1 - e) + 0.1):
                            c = BRIGHT_BLACK
                        else:
                            c = DUSK
                        if layer.get(x, y) != WHITE:
                            layer.set(x, y, c)
    return layer


def bodies():
    """The firefly's body: dark head and thorax, the lantern lit below it."""
    layer = Layer()
    hx, hy = HERO
    for y in range(N):
        for x in range(N):
            if ellipse(x, y, hx, hy - 6.6, 2.2, 1.9) <= 1:  # head
                layer.set(x, y, BLACK)
            elif ellipse(x, y, hx, hy - 2.5, 2.4, 2.6) <= 1:  # thorax
                layer.set(x, y, BLACK if lit(x, y, 0.85) else COMMENT)
            elif (e := ellipse(x, y, hx, hy + 4, 3.1, 5.2)) <= 1:  # lantern
                glow = 1 - e
                layer.set(x, y, BRIGHT_WHITE if lit(x, y, glow * 1.3) else YELLOW)
    for s in (-1, 1):
        layer.set(hx + s, hy - 6, BRIGHT_WHITE)  # eyes
        for k, (dx, dy) in enumerate(((1, -9), (2, -10), (3, -11), (4, -11))):
            layer.set(hx + s * dx, hy + dy, COMMENT if k < 3 else BRIGHT_BLACK)
    for fx, fy, color, hr in FLIES:
        for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
            layer.set(fx + dx, fy + dy, color)
        layer.set(fx, fy, BRIGHT_WHITE)
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
            group([layer("bodies", True), layer("wings", True), layer("halos", False)], shadow=0.4, translucency=0.25),
            group([layer("near", True), layer("far", True)], shadow=0.6, translucency=0.15),
            group([layer("moon", True)], shadow=0.5, translucency=0.2),
            group([layer("sky", False)], shadow=0.0, specular=False),
        ],
        "supported-platforms": {"squares": ["macOS"]},
    }


def main(out):
    bundle = os.path.join(out, "Fireflies.icon")
    os.makedirs(os.path.join(bundle, "Assets"), exist_ok=True)
    far, near = hills()
    art = {"sky": sky(), "moon": moon(), "far": far, "near": near, "halos": halos(), "wings": wings(), "bodies": bodies()}
    for name, l in art.items():
        with open(os.path.join(bundle, "Assets", f"{name}.svg"), "w") as f:
            f.write(l.svg())
    with open(os.path.join(bundle, "icon.json"), "w") as f:
        json.dump(icon_json(), f, indent=2)
        f.write("\n")
    with open(os.path.join(out, "Fireflies.svg"), "w") as f:
        f.write(flat(list(art.values())))


main(sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
