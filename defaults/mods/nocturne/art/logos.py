"""Firefly logos: Fireflies' own agent icons as 16x16 1-bit dithered masks.

The fireflies wear their agent's mark, tinted by status at draw time
(svg(...).text_color()). Source: the icons Fireflies writes to
~/.config/herdr-app/icons. Needs rsvg-convert and ImageMagick:

    nix shell nixpkgs#librsvg nixpkgs#imagemagick -c python3 -I logos.py
"""

import os
import re
import subprocess
import tempfile

SIZE = 16
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
ICONS = os.path.expanduser("~/.config/herdr-app/icons")
OUT = os.path.dirname(os.path.abspath(__file__))

# key -> how to read the icon. Every fill and stroke is painted white, so
# coverage is the mark; "untile" first drops the icon's backing tile (Codex:
# its body then carries the >_ cut out of it). Hermes isn't here: its mark is
# too fine for 16 1-bit pixels, so the mod draws Fireflies' own icon for it.
LOGOS = {
    "claude": "shape",
    "opencode": "shape",
    "pi": "shape",
    "codex": "untile",
    "agent": "shape",  # any other agent
}


def coverage(name, mode):
    src = open(os.path.join(ICONS, f"{name}.svg")).read()
    if mode == "untile":
        src = re.sub(r"<path[^>]*/?>(</path>)?", "", src, count=1)
    src = re.sub(r'fill="(?!none)[^"]*"', 'fill="#fff"', src)
    src = re.sub(r'stroke="(?!none)[^"]*"', 'stroke="#fff"', src)
    src = src.replace("currentColor", "#fff")
    if "fill=" not in src.split(">", 1)[0] and "<path" in src and 'fill="none"' not in src:
        src = src.replace("<svg ", '<svg fill="#fff" ', 1)
    with tempfile.TemporaryDirectory() as d:
        svg, png = os.path.join(d, "in.svg"), os.path.join(d, "out.png")
        open(svg, "w").write(src)
        # Big first, then trimmed to the mark and scaled into the cell grid:
        # icons carry padding that a 16 px render can't spare.
        subprocess.run(["rsvg-convert", "-w", "256", "-h", "256", "-b", "black", svg, "-o", png], check=True)
        txt = subprocess.run(["magick", png, "-colorspace", "gray", "-trim", "+repage", "-filter", "box",
                              "-resize", f"{SIZE}x{SIZE}", "-background", "black", "-gravity", "center",
                              "-extent", f"{SIZE}x{SIZE}", "-depth", "8", "txt:-"],
                             check=True, capture_output=True, text=True).stdout
    grid = [[0.0] * SIZE for _ in range(SIZE)]
    for line in txt.splitlines()[1:]:
        m = re.match(r"(\d+),(\d+):\s*\((\d+)", line)
        if m:
            x, y, v = int(m[1]), int(m[2]), int(m[3]) / 255
            grid[y][x] = v
    return grid


def lit(grid):
    """Ordered dither of the coverage: soft edges fall on a Bayer pattern."""
    return {(x, y) for y, row in enumerate(grid) for x, v in enumerate(row)
            if v > (BAYER[y % 4][x % 4] + 0.5) / 16}


def svg(cells):
    rects = "".join(f'<rect x="{x}" y="{y}" width="1" height="1"/>' for x, y in sorted(cells))
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" '
        f'viewBox="0 0 {SIZE} {SIZE}" shape-rendering="crispEdges">{rects}</svg>\n'
    )


for key, mode in LOGOS.items():
    with open(os.path.join(OUT, f"logo-{key}.svg"), "w") as f:
        f.write(svg(lit(coverage(key, mode))))
