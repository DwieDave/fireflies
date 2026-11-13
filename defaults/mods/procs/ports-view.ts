// The process deck's Ports tab drawn: a port's row, the list.

import { div, svg } from "gpui-kit";
import type { Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { PortItem } from "./state.ts";
import { PROW, ART, CONFIRM, HEAD } from "./state.ts";
import { moveTo } from "./listing.ts";
import { begin, copyRow, openPortAt } from "./actions.ts";
import { clickRow, scrollbar, wheelList } from "./pointer.ts";
import { actionChip, band, confirmBand } from "./procs-view.ts";
import type { default as ProcsDeck } from "./main.ts";
import { emptyView } from "./bars.ts";

export function portRow(v: ProcsDeck, t: Theme, x: PortItem, i: number, on: boolean): Element {
  const show = on || v.hover === x.key;

  return band(v, h_flex().id(`port-${i}`).relative().h(PROW).flex_none().px(12).gap(10).items_center().text_size(12)
    .text_color(on ? t.foreground : x.term ? t.muted : t.dim)
    .cursor_pointer()
    .on_click((e, cx) => clickRow(v, e, i, cx))
    // The deck's own right press comes after this and opens the row's menu at the pointer.
    .on_mouse_down("right", () => {
      v.pressed = x.key;
    })
    .on_hover((h, cx) => {
      const k = h ? x.key : v.hover === x.key ? null : v.hover;

      if (k !== v.hover) {
        v.hover = k;
        cx.notify();
      }
    }), t, on)
    .child(div().relative().w(52).flex_none().text_color(x.term ? t.ansi6 : t.dim).child(`:${x.port}`))
    .child(div().relative().flex_none().max_w(110).truncate().child(x.name))
    .when(Boolean(x.guard), (el) => el.child(svg(`${ART}/shield.svg`).size(8).flex_none().text_color(t.dim)))
    .child(div().relative().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim)
      .child(`${x.where ?? "not from this app"} · ${x.hosts.join(" ")}`))
    .child(h_flex().relative().flex_none().gap(2).justify_end()
      .when(show, (el) => el
        .child(actionChip(v, t, `o-${i}`, "open ↗", null, () => openPortAt(v, x)))
        .child(actionChip(v, t, `c-${i}`, "copy", null, (cx) => copyRow(v, x, cx)))
        .when(!x.guard, (el) => el.child(actionChip(v, t, `x-${i}`, "end", t.blocked, () => {
          moveTo(v, v.list(), i);
          begin(v, x, false);
        })))));
}

export function portsView(v: ProcsDeck, t: Theme, items: readonly PortItem[], ci: number): Element {
  const listHt = v.listH();
  const ask = v.ask;
  const asked = (x: PortItem): boolean => ask?.tab === "ports" && ask.key === x.key;
  const tops: number[] = [];
  let y = 0;

  for (const x of items) {
    tops.push(y);
    y += PROW + (asked(x) ? CONFIRM : 0);
  }

  const sel = items[ci];
  const top = tops[ci];

  if (sel && top !== undefined && v.follow) {
    const b = top + PROW + (ask?.key === sel.key ? CONFIRM : 0);

    if (top < v.scroll.ports) v.scroll.ports = top;

    if (b > v.scroll.ports + listHt) v.scroll.ports = b - listHt;
  }

  const max = Math.max(0, y - listHt);

  // Where m opens the menu: under the selected row.
  v.selY = HEAD + v.stripH() + (top ?? 0) - v.scroll.ports + PROW;

  v.scroll.ports = Math.max(0, Math.min(v.scroll.ports, max));

  if (!items.length) return emptyView(v, t, listHt);

  return div().id("ports-list").relative().h(listHt).flex_none().overflow_hidden()
    .on_scroll_wheel((e, cx) => wheelList(v, "ports", e, PROW, max, cx))
    .children(items.map((x, i) => v_flex().id(`pslot-${x.key}`).absolute().left(0).right(0).top((tops[i] ?? 0) - v.scroll.ports)
      .child(portRow(v, t, x, i, i === ci))
      .children(ask && asked(x) ? [confirmBand(v, t, ask)] : [])))
    .children(scrollbar(v, t, "ports", y, listHt));
}
