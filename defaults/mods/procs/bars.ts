// The process deck's header (the tabs, the count) and footer (the find line,
// the keys, a note), and the empty states.

import { div, svg } from "gpui-kit";
import type { Color, Context, Element } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import { hint, keysHint } from "./keyhelp.ts";
import { guardOf, address } from "./logic.ts";
import type { Tab, Item } from "./state.ts";
import { ART, FOOT, HEAD } from "./state.ts";
import { vitalLine } from "./vitals.ts";
import { dither } from "./paint.ts";
import { procOf } from "./listing.ts";
import { begin, confirm, copyRow, escapeKey, foldRow, killHard, openPortAt, showTerminal, switchTab, toggleAll } from "./actions.ts";
import { badge } from "./procs-view.ts";
import type { default as ProcsDeck } from "./main.ts";

export function emptyView(v: ProcsDeck, t: Theme, h: number): Element {
  const box = v_flex().h(h).flex_none().items_center().justify_center().gap(8).px(24).text_size(11).text_color(t.dim);

  if (v.failed) return box.child(div().text_color(t.blocked).child("Couldn't read the processes")).child(div().child(v.failed));

  if (!v.snap) return box.child(div().child("reading…"));

  if (v.query) return box.child(div().child(`Nothing matches "${v.query}".`));

  if (v.tab === "ports") {
    return box.child(svg(`${ART}/plug.svg`).size(22).text_color(t.ansi0))
      .child(div().mt(6).text_size(12).text_color(t.muted).child("Nothing of yours listens on a port."))
      .child(div().child("a dev server shows here as it starts"));
  }

  return box.child(div().text_size(12).text_color(t.muted).child("No terminals here on this machine."))
    .child(div().child("a lists every process of yours"));
}

/** The bar along the bottom: what the cursor is on and its keys, each a button too. */
export function footBar(v: ProcsDeck, t: Theme, items: readonly Item[], ci: number): Element {
  const item = items[ci];

  const bar = h_flex().relative().h(FOOT).flex_none().px(12).gap(10).items_center().text_size(11)
    .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)));

  const left = (...kids: (Element | null)[]): Element => h_flex().flex_1().min_w(0).gap(6).items_center().children(kids.flatMap((k) => (k ? [k] : [])));
  const keys = (...caps: (Element | null)[]): Element => h_flex().flex_none().gap(8).items_center().children(caps.flatMap((k) => (k ? [k] : [])));

  // A key's hint, and a click does what the key does.
  const k = (id: string, key: string, what: string, go: (cx: Context) => void): Element => hint(t, id, key, what).px(2).cursor_pointer().hover((s) => s.bg(t.ansi0))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => {
      cx.stop_propagation();
      go(cx);
      v.follow = true;
      v.focus();
      cx.notify();
    });

  const help = keysHint(t, "k-help", v.help, () => {
    v.help = !v.help;
  });

  const arrow = div().flex_none().text_color(t.accent).child("↳");
  const word = (s: string, c: Color | null = null): Element => div().min_w(0).truncate().text_color(c ?? t.muted).child(s);

  const find = k("k-find", "/", "find", () => {
    v.typing = true;
  });

  const all = k("k-all", "a", v.all ? "this app" : "all", () => toggleAll(v));

  const keep = (what: string): Element => k("k-no", "esc", what, () => {
    v.ask = null;
  });

  if (v.help) {
    return bar.child(left(word("every key", t.dim))).child(keys(k("k-esc", "esc", "back", () => {
      v.help = false;
    }), help));
  }

  if (v.ask?.phase === "ask") return bar.child(left(arrow, word(`end ${v.ask.name}`, t.blocked))).child(keys(k("k-yes", "enter", "end", (cx) => confirm(v, cx)), keep("keep")));

  if (v.ask?.phase === "held") return bar.child(left(arrow, word("still running", t.blocked))).child(keys(k("k-kill", "K", "kill -9", (cx) => killHard(v, cx)), keep("leave")));

  if (v.ask) return bar.child(left(arrow, word("ending…", t.dim))).child(keys(keep("hide")));

  if (v.typing) {
    return bar.child(findField(v, t))
      .child(keys(k("k-enter", "enter", "keep", () => {
        v.typing = false;
      }), k("k-esc", "esc", v.query ? "clear" : "back", (cx) => escapeKey(v, cx)), help));
  }

  const note = v.note && Date.now() < v.note.until ? word(v.note.text, t[v.note.tone]) : null;

  // The pointer on a graph: its whole reading, in place of the row's name.
  if (v.hoverVital) return bar.child(left(word(vitalLine(v.hoverVital, v.now, v.sysReading?.sysctl.ncpu ?? null), t.muted))).child(keys(help));

  const q = v.query ? queryChip(v, t) : null;

  if (v.tab === "ports") {
    if (!item || !("port" in item)) return bar.child(left(note ?? word(""), q)).child(keys(k("k-a", "tab", "processes", (cx) => switchTab(v, "procs", cx)), find, help));

    return bar.child(left(arrow, note ?? word(address(item.port)), q))
      .child(keys(k("k-open", "enter", "open", () => openPortAt(v, item)), k("k-copy", "c", "copy", (cx) => copyRow(v, item, cx)),
        item.guard ? null : k("k-end", "x", "end", () => begin(v, item, false)), find, help));
  }

  if (!item || "port" in item) return bar.child(left(note ?? word(""), q)).child(keys(all, find, help));

  const n = item.node;

  if (n.kind === "proc") {
    const p = procOf(v, n.pid);
    const guard = guardOf(p, v.snap?.me);

    if (guard) return bar.child(left(arrow, note ?? word(`${p?.name ?? ""} · ${guard}`, t.dim), q)).child(keys(k("k-show", "enter", "show", () => showTerminal(v, item)), all, help));

    return bar.child(left(arrow, note ?? word(p?.name ?? ""), q))
      .child(keys(k("k-end", "x", "end", () => begin(v, item, false)), n.kids.length ? k("k-tree", "X", "tree", () => begin(v, item, true)) : null, find, help));
  }

  return bar.child(left(arrow, note ?? word(n.name), q))
    .child(keys(n.kind === "term" ? k("k-show", "enter", "show", () => showTerminal(v, item)) : null,
      item.open === null ? null : k("k-fold", "←→", "fold", () => foldRow(v, items, ci, null)), all, help));
}

export function headBar(v: ProcsDeck, t: Theme, nProcs: number, nPorts: number): Element {
  const tabBtn = (id: string, to: Tab, label: string, n: number | string): Element => {
    const on = v.tab === to;

    return h_flex().id(id).relative().h_full().px(8).gap(6).items_center().text_size(11).cursor_pointer()
      .text_color(on ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        switchTab(v, to, cx);
        v.focus();
        cx.notify();
      })
      .child(div().child(label)).child(div().text_color(t.dim).child(String(n)))
      .when(on, (el) => el.child(div().absolute().left(4).right(4).bottom(0).h(2).bg(t.accent)));
  };

  return h_flex().relative().h(HEAD).flex_none().pl(12).pr(12).gap(10).items_center()
    .child(svg(`${ART}/tree.svg`).size(9).flex_none().text_color(t.accent))
    .child(h_flex().h_full().flex_none().child(tabBtn("tab-procs", "procs", "processes", nProcs)).child(tabBtn("tab-ports", "ports", "ports", nPorts)))
    .child(div().flex_1())
    .child(div().id("scope").flex_none().text_size(11).text_color(t.dim).cursor_pointer()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        toggleAll(v);
        v.focus();
        cx.notify();
      })
      .child(v.all ? `all of ${v.snap?.me ?? "yours"}` : "fireflies"))
    .child(badge(v, t, "a", false))
    .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
}

/** A click that puts the find line back to typing. */
function typeAgain(v: ProcsDeck, cx: Context): void {
  cx.stop_propagation();
  v.typing = true;
  v.focus();
  cx.notify();
}

/** The find field: what's typed and a blinking caret; a click on it keeps it taking letters. */
function findField(v: ProcsDeck, t: Theme): Element {
  return h_flex().id("find-field").flex_1().min_w(0).gap(6).items_center().cursor_text()
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => typeAgain(v, cx))
    .child(div().flex_none().text_color(t.accent).child("/"))
    .child(div().min_w(0).truncate().text_color(v.query ? t.foreground : t.dim).child(v.query ? v.query.replace(/ /g, " ") : "type to find"))
    .child(div().flex_none().w(1).h(14).bg(t.accent).loop("opacity", { from: 0, to: 1, period: 1000 }));
}

/** The query, kept after enter: a click on it opens the field again. */
function queryChip(v: ProcsDeck, t: Theme): Element {
  return div().id("find-query").flex_none().text_color(t.accent).cursor_text()
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => typeAgain(v, cx))
    .child(`/${v.query}`);
}

