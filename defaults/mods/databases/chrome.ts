// The Databases view's frame: the top bar (the moon, the connection, read
// only, how it's going, the move chip ◧ / ⧉, ↻, and in a window ✕), the
// body (wide: the three side panels left, the main view and the log right;
// narrow, under NARROW: one panel, the others folded into a row of numbered
// tabs), the ask bar and the key bar. What only a window has is here alone.
// The gaps between the wide view's panels are dividers (layout.ts): dragged,
// they resize the panels.

import { div, svg } from "gpui-kit";
import type { Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { home } from "herdr";
import type { Theme } from "herdr";
import { where } from "./kinds.ts";
import type { PanelId } from "./state.ts";
import { PANEL_KEY, PANEL_NAME } from "./state.ts";
import { ART, chip, dither, kindBadge, lock, pip, toneColor, unzoom } from "./kit.ts";
import { hint, keysHint } from "./keyhelp.ts";
import { barHints } from "./keys.ts";
import { connsPanel, logPanel, structPanel, tablesPanel, NARROW_ORDER } from "./panels.ts";
import { mainPanel } from "./main-view.ts";
import { askBar, overBody } from "./popups.ts";
import { divider } from "./dividers.ts";
import { GAP_X, GAP_Y, NARROW, wideDividers } from "./layout.ts";
import type { default as DbView } from "./main.ts";

/** The top bar: where the window drags from (presses on it aren't stopped). */
function header(t: Theme, v: DbView): Element {
  const c = v.active;

  const status = v.catalog.busy ? h_flex().gap(5).items_center().child(pip(t.working, 6, true)).child(div().text_color(t.dim).child("reading…"))
    : c && v.catalog.error ? h_flex().gap(5).items_center().child(pip(t.blocked, 6)).child(div().text_color(t.dim).truncate().max_w(240).child("didn't answer"))
    : c ? h_flex().gap(5).items_center().child(pip(t.done, 6)).child(div().text_color(t.dim).child(`${v.catalog.tables.length} tables`)) : div();

  const narrow = v.size.width < NARROW;

  return h_flex().id("db-head").relative().h(34).flex_none().pl(12).pr(6).gap(10).items_center().text_size(11)
    .child(div().absolute().inset_0().opacity(0.5).child(dither(t.ansi0, 2)))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi8, 1)))
    .child(h_flex().relative().flex_none().gap(8).items_center()
      .child(svg(`${ART}/moon-6.svg`).size(16).text_color(t.foreground))
      .when(!narrow, (el) => el.child(div().text_color(t.foreground).child("DATABASES"))))
    .when(c !== null, (el) => el.child(h_flex().relative().flex_shrink(1).min_w(0).gap(8).items_center()
      .child(div().flex_none().text_color(t.muted).child(c?.name ?? ""))
      .child(c ? kindBadge(t, c.kind) : div())
      .when(!narrow, (x) => x.child(div().flex_shrink(1).min_w(0).truncate().text_color(t.dim).child(c ? where(c, home()) : "")))
      .when(Boolean(c?.from), (x) => x.child(div().flex_shrink(1).min_w(0).truncate().text_color(t.ansi8).child(`· ${c?.from ?? ""}`)))))
    .when(Boolean(c?.readonly), (el) => el.child(chip(t, "db-ro", h_flex().gap(5).items_center().child(lock(t.ansi3)).child(div().child("read only")), false, (cx) => v.act("conns", "conn-edit", cx), t.ansi3)))
    .child(div().flex_1())
    .child(div().relative().flex_none().child(status))
    // Where the window's ✕ is, the move (opening.ts): ◧ into a pane, from a pane ⧉ out to a window.
    .child(h_flex().id("db-move-tip").relative().flex_none().tooltip(v.overlay ? "Into a pane · ctrl-t" : "Out to a window · ctrl-t")
      .child(chip(t, "db-move", v.overlay ? "◧" : "⧉", false, (cx) => v.move(cx))))
    .child(chip(t, "db-refresh", "↻", false, (cx) => v.act("window", "refresh", cx)))
    .when(Boolean(v.overlay), (el) => el.child(chip(t, "db-close", "✕", false, () => v.closeWindow())));
}

/** The key bar: what the focused place's keys do, the note, ? keys. */
function keyBar(t: Theme, v: DbView): Element {
  const note = v.note;
  const place = v.place();
  const list = v.help ? [["esc", "close keys"] as const] : barHints(place);
  const word = place === "rows" ? "ROWS" : place === "results" ? "RESULT" : place === "editor" ? "QUERY" : PANEL_NAME[v.panel].toUpperCase();

  return h_flex().id("db-keys").relative().h(22).flex_none().px(10).gap(12).items_center().text_size(11).overflow_hidden()
    .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
    .child(div().relative().flex_none().text_color(t.dim).child(word))
    .children(list.map(([k, what], i) => hint(t, `db-hint-${i}`, k, what).relative()))
    .child(div().flex_1())
    .when(note !== null, (el) => el.child(div().relative().flex_shrink(1).min_w(0).truncate().text_color(toneColor(t, note?.tone ?? "working")).child(note?.text ?? "")))
    .when(v.size.width >= NARROW, (el) => el.child(hint(t, "db-hint-panels", "1-4 0", "panels").relative()))
    .child(keysHint(t, "db-hint-keys", v.help, () => {
      v.help = !v.help;
    }).relative());
}

/** The narrow view's row of panels: each its number and name, the shown one bright. */
function panelTabs(t: Theme, v: DbView): Element {
  return h_flex().id("db-panel-tabs").relative().h(24).flex_none().px(6).gap(2).items_center()
    .children(NARROW_ORDER.map((p) => chip(t, `db-ptab-${p}`, `${PANEL_KEY[p]} ${PANEL_NAME[p]}`, v.panel === p, () => v.setPanel(p))));
}

/** One panel by its id. */
function panelOf(t: Theme, v: DbView, p: PanelId): Element {
  switch (p) {
    case "conns": return connsPanel(t, v);
    case "tables": return tablesPanel(t, v);
    case "structure": return structPanel(t, v);
    case "main": return mainPanel(t, v);
    case "log": return logPanel(t, v);
  }
}

/** The body: wide, the git window's layout with a divider in each gap; narrow, one panel. */
function body(t: Theme, v: DbView): Element {
  const { width } = v.size;

  if (width < NARROW) {
    return v_flex().size_full().child(panelTabs(t, v)).child(div().flex_1().min_h(0).pt(8).px(4).pb(4).flex().flex_col().child(panelOf(t, v, v.panel).flex_1()));
  }

  const ds = v.dividers;
  const w = wideDividers(v.room(), (d) => ds.size(d));
  const log = w.log;

  return h_flex().size_full().p(6).pt(12)
    .child(v_flex().w(ds.size(w.left)).flex_none().h_full()
      .child(connsPanel(t, v).h(ds.size(w.conns)).flex_none())
      .child(divider(t, "db-split-conns", w.conns, ds, GAP_Y))
      .child(tablesPanel(t, v).flex_1())
      .child(divider(t, "db-split-struct", w.struct, ds, GAP_Y))
      .child(structPanel(t, v).h(ds.size(w.struct)).flex_none()))
    .child(divider(t, "db-split-left", w.left, ds, GAP_X))
    .child(v_flex().flex_1().min_w(0).h_full()
      .child(mainPanel(t, v).flex_1())
      .when(log !== null, (el) => (log ? el.child(divider(t, "db-split-log", log, ds, GAP_Y)).child(logPanel(t, v).h(ds.size(log)).flex_none()) : el)));
}

/** The view's children: the top bar, the body (with what's over it), the ask, the key bar. */
export function frame(v: DbView, t: Theme): Element[] {
  const ask = v.ask;

  return [
    header(t, v),
    div().id("db-body").relative().flex_1().min_h(0)
      .on_size_change((drawn, cx) => {
        const h = unzoom(drawn.height);

        if (Math.abs(h - v.bodyH) > 1) {
          v.bodyH = h;
          cx.notify();
        }
      })
      .on_mouse_down("left", (_e, cx) => {
        v.focusShown();
        cx.stop_propagation();
      })
      .child(body(t, v))
      .children(overBody(t, v)),
    ...(ask ? [askBar(t, v, ask)] : []),
    keyBar(t, v),
  ];
}
