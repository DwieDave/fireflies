// The process deck's column heads: the processes' (name, CPU, MEM, UP, PID)
// and the ports' (PORT, PROCESS, WHERE). A click on one sorts by it, a second
// turns it (sort.ts); the sorting one is lit with its arrow. While a number
// column sorts the processes, "flat" beside the name switches the tree to one
// list of every process (v).

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import type { Element } from "gpui-kit";
import type { Theme } from "herdr";
import type { Dir, PortCol, ProcCol } from "./sort.ts";
import { arrow, numeric } from "./sort.ts";
import { COLS, NUM_W, numCols } from "./state.ts";
import { isFlat } from "./listing.ts";
import { sortPortsBy, sortProcsBy, toggleFlat } from "./actions.ts";
import type { default as ProcsDeck } from "./main.ts";

/** A head that sorts on a click: its label, lit with its arrow while it sorts. */
function sortHead(v: ProcsDeck, t: Theme, id: string, label: string, on: Dir | null, go: () => void): Element {
  return div().id(id).cursor_pointer().text_color(on ? t.accent : t.ansi8).hover((s) => s.text_color(t.foreground))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => {
      cx.stop_propagation();
      go();
      v.focus();
      cx.notify();
    })
    .child(on ? `${label} ${arrow(on)}` : label);
}

/** The processes' heads: the name's (what's listed), the flat switch, the numbers right-aligned over theirs. */
export function procHeads(v: ProcsDeck, t: Theme): Element {
  const s = v.sorts.procs;
  const dir = (col: ProcCol): Dir | null => (s?.col === col ? s.dir : null);

  const num = (w: number, col: ProcCol, label: string): Element => div().w(w).flex_none().flex().justify_end()
    .child(sortHead(v, t, `h-${col}`, label, dir(col), () => sortProcsBy(v, col)));

  const flat = v.sorts.flat;
  const what = isFlat(v) ? "EVERY PROCESS" : v.all ? `ALL OF ${(v.snap?.me ?? "").toUpperCase()}'S` : "THIS APP'S TERMINALS";

  return h_flex().h(COLS).flex_none().px(12).gap(7).items_center().text_size(9)
    .child(h_flex().flex_1().min_w(0).gap(8).items_center()
      .child(sortHead(v, t, "h-name", what, dir("name"), () => sortProcsBy(v, "name")))
      .when(numeric(s), (el) => el.child(div().id("h-flat").flex_none().px(3).border(1).border_color(flat ? t.accent : t.ansi0)
        .text_color(flat ? t.accent : t.dim).cursor_pointer().hover((st) => st.text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => {
          cx.stop_propagation();
          toggleFlat(v);
          v.focus();
          cx.notify();
        })
        .child("FLAT"))))
    .children(numCols(v.width).map((col) => num(NUM_W[col], col, col.toUpperCase())));
}

/** The ports' heads, over the rows' port, process and where. */
export function portHeads(v: ProcsDeck, t: Theme): Element {
  const s = v.sorts.ports;
  const dir = (col: PortCol): Dir | null => (s?.col === col ? s.dir : null);
  const head = (col: PortCol, label: string): Element => sortHead(v, t, `h-${col}`, label, dir(col), () => sortPortsBy(v, col));

  return h_flex().h(COLS).flex_none().px(12).gap(10).items_center().text_size(9)
    .child(div().w(52).flex_none().child(head("port", "PORT")))
    .child(div().w(110).flex_none().child(head("name", "PROCESS")))
    .child(div().flex_1().min_w(0).child(head("where", "WHERE")));
}
