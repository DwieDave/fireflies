// The process deck's System tab drawn: each reading's graph (bars over the
// history), its meter, a process's sparkline.

import { div, PathBuilder, Background } from "gpui-kit";
import type { Color, Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { Measured } from "./sys.ts";
import { rate, size, scale } from "./sys.ts";
import type { Rect, GraphOptions } from "./state.ts";
import { PORTS_H, SPARK, GRAPH_W, GRAPH_H, SLOT, BAR } from "./state.ts";
import { dither, dotCell } from "./paint.ts";
import type { default as ProcsDeck } from "./main.ts";

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

/** Bars as one layer: `rects` ({ x, y, w, h } in the graph's px) as one path, filled with
 *  `fill`. Percentages of the graph's box, so the zoom never shifts them; one element a
 *  layer instead of three a bar keeps the system tab's frame inside its render budget.
 *  None when there are no bars. */
export function layer(view: ProcsDeck, rects: readonly Rect[], fill: Background, w = GRAPH_W, h = GRAPH_H): Element[] {
  if (!rects.length) return [];

  const px = (v: number): `${number}%` => `${(v / w) * 100}%`;
  const py = (v: number): `${number}%` => `${(v / h) * 100}%`;
  const b = PathBuilder.fill();

  for (const r of rects) b.add_polygon([[px(r.x), py(r.y)], [px(r.x + r.w), py(r.y)], [px(r.x + r.w), py(r.y + r.h)], [px(r.x), py(r.y + r.h)]], true);

  return [window.paint_path(b.build(), fill).absolute().top(0).left(0).size_full()];
}

/** A graph: the history `values` (0..1, null: no reading) as bars, the newest at the right:
 *  dithered columns with a solid 1 px head. `down`: a second series hung under a midline
 *  (network out). `none`: what to say instead. */
export function graph(view: ProcsDeck, t: Theme, id: string, values: readonly (number | null)[], color: Color, { down = null, color2 = null, none = null }: GraphOptions = {}): Element {
  const box = div().id(id).relative().w(GRAPH_W).h(GRAPH_H).flex_none()
    .child(div().absolute().left(0).right(0).bottom(down ? GRAPH_H / 2 : 0).h(1).child(dither(t.ansi0, 1)));

  if (none) return box.child(div().absolute().left(0).right(0).top(0).bottom(0).flex().items_center().justify_center().text_size(11).text_color(t.dim).child(none));

  const x = (i: number, n: number): number => GRAPH_W - (n - i) * SLOT + 1;
  const half = down ? GRAPH_H / 2 : GRAPH_H;
  const tall = (v: number): number => Math.max(1, Math.round(v * (half - 1)));
  const up = values.flatMap((v, i): Rect[] => (v === null ? [] : [{ x: x(i, values.length), y: half - tall(v), w: BAR, h: tall(v) }]));
  const under = (down ?? []).flatMap((v, i, all): Rect[] => (v === null ? [] : [{ x: x(i, all.length), y: half + 1, w: BAR, h: tall(v) }]));
  const cell = dotCell();

  return box
    .children(layer(view, up, Background.checkerboard(color, cell)))
    .children(layer(view, up.map((r) => ({ ...r, h: 1 })), Background.solid(color)))
    .children(layer(view, under, Background.checkerboard(color2 ?? color, cell)))
    .children(layer(view, under.map((r) => ({ ...r, y: r.y + r.h - 1, h: 1 })), Background.solid(color2 ?? color)));
}

/** One graph's block: its name and value now, the graph, a line of detail. */
export function meter(v: ProcsDeck, t: Theme, id: string, name: string, value: string, valueColor: Color, graph: Element, sub: string): Element {
  return v_flex().id(`m-${id}`).flex_none().px(12).pt(10).gap(3)
    .child(h_flex().h(16).gap(8).items_center()
      .child(div().flex_none().text_size(11).text_color(t.ansi8).child(name.toUpperCase()))
      .child(div().flex_1().h(1).relative().opacity(0.6).child(dither(t.ansi8, 1)))
      .child(div().flex_none().text_size(12).text_color(valueColor).child(value)))
    .child(graph)
    .child(div().h(14).flex_none().truncate().text_size(11).text_color(t.dim).child(sub));
}

/** The system tab: CPU, GPU, memory, disk and network. */
export function systemView(view: ProcsDeck, t: Theme): Element {
  const n = view.now;
  const s = view.sys;
  const pct = (v: number | null | undefined): string => (v === null || v === undefined ? "" : `${Math.round(v)}%`);
  const missing = (what: string): string => `no ${what} reading on this machine`;
  // Before the first reading: reading…; then what a source this machine lacks says.
  const none = (has: (m: Measured) => boolean, what: string): string | null => (n === null ? "reading…" : has(n) ? null : missing(what));
  const pressure = n?.mem?.pressure;
  const seen = (list: readonly (number | null)[]): number[] => list.flatMap((v) => (v === null ? [] : [v]));
  const netTop = Math.max(10e3, ...seen(s.rx), ...seen(s.tx));
  const net = n?.net;
  const cores = view.sysReading?.sysctl.ncpu;
  const mbps = n?.disk?.mbps ?? null;

  return v_flex().id("system").h(PORTS_H).flex_none().overflow_hidden()
    .child(meter(view, t, "cpu", "cpu", pct(n?.cpu?.pct), t.accent,
      graph(view, t, "g-cpu", scale(s.cpu, { max: 100 }), t.accent, { none: none((m) => Boolean(m.cpu), "CPU") }),
      n?.cpu ? `user ${n.cpu.us}% · system ${n.cpu.sy}%${cores ? ` · ${cores} cores` : ""}` : ""))
    .child(meter(view, t, "gpu", "gpu", pct(n?.gpu?.pct), t.ansi5,
      graph(view, t, "g-gpu", scale(s.gpu, { max: 100 }), t.ansi5, { none: none((m) => Boolean(m.gpu), "GPU") }),
      n?.gpu ? "busy, as the graphics processor reports it" : ""))
    .child(meter(view, t, "mem", "memory", n?.mem ? `${size(n.mem.used)} of ${size(n.mem.total)}` : "", t.done,
      graph(view, t, "g-mem", scale(s.mem, { max: 100 }), t.done, { none: none((m) => Boolean(m.mem), "memory") }),
      n?.mem ? `${pct(n.mem.pct)} used${pressure ? ` · pressure ${pressure}` : ""}` : ""))
    .child(meter(view, t, "disk", "disk", mbps === null ? "" : `${mbps.toFixed(1)} MB/s`, t.working,
      graph(view, t, "g-disk", scale(s.disk, { floor: 1 }), t.working, { none: none((m) => m.disk?.mbps !== null && m.disk?.mbps !== undefined, "disk") }),
      n?.disk && n.disk.full !== null ? `the startup disk is ${n.disk.full}% full` : ""))
    .child(meter(view, t, "net", "network", net ? `↓ ${rate(net.rx)}  ↑ ${rate(net.tx)}` : "", t.ansi6,
      graph(view, t, "g-net", scale(s.rx, { max: netTop }), t.ansi6, { down: scale(s.tx, { max: netTop }), color2: t.ansi11,
        none: n === null ? "reading…" : !n.netSeen ? missing("network") : s.rx.some((v) => v !== null) ? null : "measuring…" }),
      net ? "in above the line, out below · every interface but loopback" : ""));
}
