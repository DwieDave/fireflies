// The editor pane's tab menu (a right-click on a tab, space b m) and
// dragging a tab along the strip (tabs.ts says where it lands).

import type EditorPane from "./main.ts";
import { basename } from "./logic.ts";
import type { Gap, MenuAct, MenuItem } from "./tabs.ts";
import { DRAG_START, dropIndex, tabMenuItems, tabMenuKey } from "./tabs.ts";
import { h_flex, v_flex } from "gpui-base";
import type { Context, Element, KeyEvent, MouseMoveEvent } from "gpui-kit";
import { div } from "gpui-kit";
import type { Theme } from "herdr";
import type { Doc } from "./pane-kit.ts";
import { dither, focusOn, stop, zoom } from "./pane-kit.ts";
import { closeCard } from "./card.ts";
import { focusText } from "./md-pane.ts";
import { closeTab, moveTab, otherEditor, popIn, popOut, select } from "./pane-tabs.ts";

/** Opens the menu of tab `index` (the shown one by default): a right-click
 *  on it, space b m, the tab-menu command. */
export function openTabMenu(ed: EditorPane, cx: Context, index = ed.docs.indexOf(ed.shown())): void {
  const d = ed.docs[index];

  if (!d) return;

  const items = tabMenuItems({ count: ed.docs.length, index, others: Boolean(otherEditor(ed)), scratch: d.scratch });

  ed.tabMenu = { index, at: 0, items };
  closeCard(ed, cx);
  cx.timer.after(0, () => ed.menuHandle?.focus());
  cx.notify();
}

export function closeTabMenu(ed: EditorPane, cx: Context, refocus = true): void {
  if (!ed.tabMenu) return;

  ed.tabMenu = null;

  if (refocus) focusText(ed);

  cx.notify();
}

/** Runs a tab menu entry on its tab. */
export function tabMenuAct(ed: EditorPane, act: MenuAct, cx: Context): void {
  const m = ed.tabMenu;
  const d = ed.docs[m?.index ?? ed.docs.indexOf(ed.shown())];

  closeTabMenu(ed, cx, act === "move-left" || act === "move-right");

  if (!d) return;

  const i = ed.docs.indexOf(d);

  if (act === "pop-out") popOut(ed, cx, d, "beside");
  else if (act === "pop-out-tab") popOut(ed, cx, d, "tab");
  else if (act === "pop-in") popIn(ed, cx, d);
  else if (act === "move-left") moveTab(ed, i, i - 1, cx);
  else if (act === "move-right") moveTab(ed, i, i + 1, cx);
  else if (act === "close") closeTab(ed, cx, d);
  else closeOthers(ed, cx, d);

  cx.notify();
}

/** Every tab but `d` closes; those with unsaved changes stay (and say so). */
export function closeOthers(ed: EditorPane, cx: Context, d: Doc = ed.shown()): void {
  const kept = ed.docs.filter((x) => x !== d && x.dirty);

  for (const x of ed.docs.filter((x) => x !== d && !x.dirty)) closeTab(ed, cx, x, true);

  if (ed.cur !== d) select(ed, d, cx);

  if (kept.length) ed.say(`${kept.length} kept: unsaved changes (${kept.map((x) => basename(x.path)).join(", ")})`);
}

export function tabMenuKeyDown(ed: EditorPane, e: KeyEvent, cx: Context): void {
  const m = ed.tabMenu;

  if (!m) return;

  const r = tabMenuKey(m.items, m.at, e);

  if (!r.taken) return;

  cx.stop_propagation();
  m.at = r.at;

  if (r.act) return tabMenuAct(ed, r.act, cx);

  if (r.close) return closeTabMenu(ed, cx);

  cx.notify();
}

/** The menu, under its tab on the strip (at the bar's left with one tab). */
export function tabMenuView(ed: EditorPane, t: Theme): Element {
  const m = ed.tabMenu;

  if (!m) return div();

  const z = zoom();
  const x = Math.max(4, Math.min(ed.tabX?.(m.index) ?? 8, ed.size.width / z - 236));

  const row = (it: MenuItem, i: number): Element =>
    h_flex()
      .id(`editor-tab-menu-${it.act}`)
      .relative()
      .h(22)
      .px(10)
      .gap(10)
      .items_center()
      .text_color(i === m.at ? t.foreground : t.muted)
      .when(i === m.at, (el) => el.child(div().absolute().inset_0().opacity(0.6).child(dither(t.ansi0, 1))).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
      .hover((s) => s.text_color(t.foreground))
      .on_mouse_move(() => {
        if (m.at !== i) m.at = i;
      })
      .on_click((_e, cx) => {
        tabMenuAct(ed, it.act, cx);
        cx.notify();
      })
      .child(div().relative().w(14).flex_none().text_color(t.accent).child(it.key))
      .child(div().relative().flex_1().child(it.label));

  return focusOn(div().id("editor-tab-menu").absolute().top(ed.stripH()).left(x).w(228).py(4).bg(t.background).border(1).border_color(t.accent), ed.menuHandle)
    .on_key_down((e, cx) => tabMenuKeyDown(ed, e, cx))
    .on_mouse_down("left", stop)
    .child(div().absolute().left(4).right(-4).top(4).bottom(-4).child(dither(t.ansi0, 1)))
    .child(div().absolute().inset_0().bg(t.background))
    .children(m.items.map(row));
}

/** The pointer moved over a gap with a press down: past DRAG_START it's a
 *  drag, and the gap it's over is where the stake stands. */
export function dragOver(ed: EditorPane, gap: Gap, e: MouseMoveEvent, cx: Context): void {
  const p = ed.tabPress;

  if (!p) return;

  if (!ed.tabDrag) {
    if (Math.abs(e.position.x - p.x) < DRAG_START) return;

    ed.tabDrag = { from: p.index, gap: null, out: false };
  }

  const g = ed.tabDrag.gap;

  if (g && g.index === gap.index && g.after === gap.after && !ed.tabDrag.out) return;

  ed.tabDrag.gap = gap;
  ed.tabDrag.out = false;
  cx.notify();
}

/** The press let go on the strip: a drag drops where its stake stands. */
export function dropTab(ed: EditorPane, cx: Context): void {
  const d = ed.tabDrag;

  ed.tabDrag = null;
  ed.tabPress = null;

  if (!d) return;

  moveTab(ed, d.from, dropIndex(ed.docs.length, d.from, d.gap), cx);
  cx.notify();
}

/** The pointer left the strip with a tab dragged: over the pane it's
 *  dropped out (popped into a pane of its own); off the pane it ends. */
export function leaveStrip(ed: EditorPane, cx: Context): void {
  if (!ed.tabDrag) {
    ed.tabPress = null;

    return;
  }

  ed.tabDrag.out = true;
  ed.tabDrag.gap = null;
  cx.notify();
}

/** A tab dragged off the strip, let go over the pane: popped out beside. */
export function dropOut(ed: EditorPane, cx: Context): void {
  const d = ed.tabDrag ? ed.docs[ed.tabDrag.from] : undefined;

  ed.tabDrag = null;
  ed.tabPress = null;

  if (d) popOut(ed, cx, d, "beside");

  cx.notify();
}

/** Over the pane while a tab is dragged off the strip: where it goes. */
export function dropZone(ed: EditorPane, t: Theme): Element {
  const drag = ed.tabDrag;

  if (!drag) return div();

  const d = ed.docs[drag.from];

  return div()
    .id("editor-drop-out")
    .absolute()
    .left(8)
    .right(8)
    .top(ed.stripH() + 6)
    .bottom(8)
    .border(1)
    .border_color(t.accent)
    .child(div().absolute().inset_0().opacity(0.18).child(dither(t.accent, 1)))
    .child(
      v_flex()
        .absolute()
        .inset_0()
        .items_center()
        .justify_center()
        .gap(4)
        .child(div().text_color(t.foreground).child(`let go: ${basename(d?.path ?? "")} into its own pane`))
        .child(div().text_color(t.dim).child("back on the strip: moves it there · off the pane: nothing")),
    );
}

/** The pointer left the pane: the drag ends where it started. */
export function cancelDrag(ed: EditorPane, cx: Context): void {
  const dragging = Boolean(ed.tabDrag);

  ed.tabDrag = null;
  ed.tabPress = null;

  if (dragging) cx.notify();
}
