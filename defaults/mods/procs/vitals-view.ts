// The readings strip drawn, at the deck's top under its tabs: CPU, memory,
// network and disk as small line graphs over the last minute and a half, a 1 px
// line with a dithered fill under it on the night ground, each with its name
// and its number now (vitals.ts has the numbers). The pointer on a graph puts
// its whole reading in the foot. Also a process's own sparkline and the
// one-path layer both draw with.

import { div, PathBuilder, Background } from "gpui-kit";
import type { Color, Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { Point, Vital } from "./vitals.ts";
import { VITALS, areaOf, topOf, cellText, stripLayout, layoutWidth, STRIP_PAD, STRIP_GAP, STRIP_TOP, NAME_H, GRAPH_GAP, LINE_H } from "./vitals.ts";
import { scale } from "./sys.ts";
import type { Rect } from "./state.ts";
import { SPARK } from "./state.ts";
import { dither, dotCell, zoom } from "./paint.ts";
import type { default as ProcsDeck } from "./main.ts";

const pc = (v: number): `${number}%` => `${v}%`;

/** A process's own readings since the deck opened: SPARK thin dithered bars, 12 px tall. */
export function spark(view: ProcsDeck, t: Theme, id: string, values: readonly number[] | undefined, color: Color, max: number | null): Element {
  const v = values ?? [];
  // Memory (no max) against a quarter more than its peak, so a steady one reads as a level, not a block.
  const hs = scale(v, { max: max === null ? Math.max(1, ...v) * 1.25 : Math.max(max, ...v), floor: 1 });

  return div().id(id).relative().w(SPARK * 2).h(12).flex_none()
    .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(t.ansi0, 1)))
    .children(layer(view, hs.map((h, i) => {
      const tall = Math.max(1, Math.round((h ?? 0) * 12));

      return { x: (SPARK - hs.length + i) * 2, y: 12 - tall, w: 2, h: tall };
    }), Background.checkerboard(color, dotCell()), SPARK * 2, 12));
}

/** Bars as one layer: `rects` ({ x, y, w, h } in a `w` × `h` box's px) as one path, filled
 *  with `fill`. Percentages of the box, so the zoom never shifts them; one element a layer
 *  keeps a frame inside its render budget. None when there are no bars. */
export function layer(view: ProcsDeck, rects: readonly Rect[], fill: Background, w: number, h: number): Element[] {
  if (!rects.length) return [];

  const px = (v: number): `${number}%` => `${(v / w) * 100}%`;
  const py = (v: number): `${number}%` => `${(v / h) * 100}%`;
  const b = PathBuilder.fill();

  for (const r of rects) b.add_polygon([[px(r.x), py(r.y)], [px(r.x + r.w), py(r.y)], [px(r.x + r.w), py(r.y + r.h)], [px(r.x), py(r.y + r.h)]], true);

  return [window.paint_path(b.build(), fill).absolute().top(0).left(0).size_full()];
}

/** How a series draws: its colour, dotted (no fill: the network's out), and its fill's strength. */
interface Series {
  readonly runs: readonly (readonly Point[])[];
  readonly color: Color;
  readonly dotted?: boolean;
}

/** A series' paths: the area under its line dithered (one path), then the line (one path). */
function seriesPaths(s: Series): Element[] {
  if (!s.runs.length) return [];

  const out: Element[] = [];

  if (!s.dotted) {
    const fill = PathBuilder.fill();

    for (const r of s.runs) fill.add_polygon(areaOf(r).map((p) => [pc(p.x), pc(p.y)]), true);

    out.push(window.paint_path(fill.build(), Background.checkerboard(s.color, dotCell()).opacity(0.55)).absolute().top(0).left(0).size_full());
  }

  const line = PathBuilder.stroke(1);

  if (s.dotted) line.dash_array([1, 2]);

  for (const r of s.runs) {
    r.forEach((p, i) => {
      if (i === 0) line.move_to(pc(p.x), pc(p.y));
      else line.line_to(pc(p.x), pc(p.y));
    });
  }

  out.push(window.paint_path(line.build(), Background.solid(s.color)).absolute().top(0).left(0).size_full());

  return out;
}

/** The memory line's colour: the pressure's (normal green, warning amber, critical red). */
function memColor(t: Theme, v: ProcsDeck): Color {
  const p = v.now?.mem?.pressure;

  return p === "critical" ? t.blocked : p === "warning" ? t.working : t.done;
}

/** A graph's series: what each reading draws, against what top. */
function seriesOf(v: ProcsDeck, t: Theme, k: Vital): Series[] {
  const h = v.sys;
  const fit = { h: LINE_H };

  switch (k) {
    case "cpu": return [{ runs: v.points(h.cpu, { ...fit, max: 100 }), color: t.accent }];
    case "mem": return [{ runs: v.points(h.mem, { ...fit, max: 100 }), color: memColor(t, v) }];
    case "disk": return [{ runs: v.points(h.disk, { ...fit, floor: 1 }), color: t.ansi5 }];
    case "net": {
      // In and out on one scale: the larger of the two peaks, at least 10 KB/s.
      const top = topOf([...h.rx, ...h.tx], { floor: 10e3 });

      return [{ runs: v.points(h.rx, { ...fit, max: top }), color: t.ansi6 }, { runs: v.points(h.tx, { ...fit, max: top }), color: t.ansi11, dotted: true }];
    }
  }
}

/** One reading's cell: its name (the memory pressure's word beside it), its number, its graph. */
function cell(v: ProcsDeck, t: Theme, k: Vital, w: number): Element {
  const c = cellText(k, v.now);
  const tone = k === "mem" ? memColor(t, v) : null;
  const on = v.hoverVital === k;

  return v_flex().id(`vital-${k}`).w(w).flex_none().gap(GRAPH_GAP)
    .on_hover((h, cx) => {
      const to = h ? k : v.hoverVital === k ? null : v.hoverVital;

      if (to !== v.hoverVital) {
        v.hoverVital = to;
        cx.notify();
      }
    })
    .child(h_flex().h(NAME_H).gap(6).items_center().text_size(10)
      .child(div().flex_none().text_color(on ? t.foreground : t.ansi8).child(c.name.toUpperCase()))
      .children(c.flag ? [div().flex_none().text_color(tone ?? t.working).child(c.flag.toUpperCase())] : [])
      .child(div().flex_1())
      .child(div().flex_none().text_size(11).text_color(c.value === "none" || c.value === "…" ? t.dim : on ? t.foreground : t.muted).child(c.value)))
    .child(div().id(`g-${k}`).relative().w_full().h(LINE_H).flex_none()
      .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(t.ansi0, 1)))
      .children(seriesOf(v, t, k).flatMap(seriesPaths)));
}

/** The strip: four across, or two by two where the deck is too narrow for four; a dithered
 *  rule under it. Its width is measured as it draws (the layout follows it). */
export function vitalsStrip(v: ProcsDeck, t: Theme): Element {
  const lay = stripLayout(v.width);
  const rows: Element[] = [];

  for (let r = 0; r < lay.rows; r++) {
    rows.push(h_flex().gap(STRIP_GAP).pt(STRIP_TOP)
      .children(VITALS.slice(r * lay.cols, (r + 1) * lay.cols).map((k) => cell(v, t, k, lay.cell))));
  }

  return v_flex().id("vitals").relative().h(lay.h).flex_none().px(STRIP_PAD)
    .on_size_change((size, cx) => {
      const w = layoutWidth(size.width, zoom());

      if (w !== v.width) {
        v.width = w;
        cx.notify();
      }
    })
    .children(rows)
    .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
}
