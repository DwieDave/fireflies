"""Nocturne usage art: 1-bit SVG masks, tinted at draw time with svg(...).text_color().

Same 2 px cells as ../../nocturne/art/generate.py, so the candle and the sheep
sit with the sky's moon and stars (the moon itself comes from Nocturne's art
folder). These are small enough to draw by hand: each sprite below is a grid
where one letter is one mask, so a sheep's wool and face tint apart.

    python3 -I generate.py      (writes next to this file)
"""

import os

CELL = 2
OUT = os.path.dirname(os.path.abspath(__file__))


def write(name, rows, mark):
    w, h = len(rows[0]), len(rows)
    rects = []
    for y, row in enumerate(rows):
        x = 0
        while x < w:
            if row[x] == mark:
                start = x
                while x < w and row[x] == mark:
                    x += 1
                rects.append(f'<rect x="{start * CELL}" y="{y * CELL}" width="{(x - start) * CELL}" height="{CELL}"/>')
            else:
                x += 1
    with open(os.path.join(OUT, name), "w") as f:
        f.write(
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{w * CELL}" height="{h * CELL}" '
            f'viewBox="0 0 {w * CELL} {h * CELL}" shape-rendering="crispEdges">{"".join(rects)}</svg>\n'
        )


# The flame, in two leans (the pane fades between them, out of step, so it
# flickers) and its bright heart (C).
FLAME_A = """
...F...
...F...
..FFF..
..FFF..
.FFCFF.
.FFCFF.
FFCCCFF
FFCCCFF
FFFCFFF
.FFFFF.
..FFF..
"""
FLAME_B = """
....F..
...F...
...FF..
..FFF..
.FFCF..
.FFCFF.
FFCCCF.
FFCCCFF
FFFCFFF
.FFFFF.
..FFF..
"""

# The sheep, facing right: W wool, F face, ear and legs. Awake it stands;
# asleep it lies in the grass with its eye shut.
SHEEP_AWAKE = """
.....WW.WW.........
...WWWWWWWWWW......
..WWWW.WWWWWWW.FF..
.WWWWWWWWW.WWWFFFF.
WWW.WWWWWWWWWFF.FFF
.WWWWWWW.WWWWWFFFFF
WWWWWWWWWWW.W.FFFF.
.WWWW.WWWWWWW..FF..
..WW.WWWWW.WW......
...F.F...F.F.......
...F.F...F.F.......
...F.F...F.F.......
"""
SHEEP_ASLEEP = """
...................
...................
...................
.....WW.WW.........
...WWWWWWWWWW......
..WWWW.WWWWWWW.....
.WWWWWWWWW.WWWFF...
WWW.WWWWWWWWWFFFFF.
.WWWWWWW.WWWWF..FFF
WWWWWWWWWWW.WFFFFFF
.WWWW.WWWWWWW.FFFF.
..WWWWWWWWWW.......
"""


def rows(art):
    return [line for line in art.strip().splitlines()]


write("flame-a.svg", rows(FLAME_A.replace("C", "F")), "F")
write("flame-b.svg", rows(FLAME_B.replace("C", "F")), "F")
write("flame-core.svg", rows(FLAME_A), "C")
for name, art in (("awake", SHEEP_AWAKE), ("asleep", SHEEP_ASLEEP)):
    write(f"sheep-{name}-wool.svg", rows(art), "W")
    write(f"sheep-{name}-face.svg", rows(art), "F")
