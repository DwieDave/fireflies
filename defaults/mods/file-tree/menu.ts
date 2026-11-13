// The files pane's right-click menu: its entries for a row or the empty space
// (the root), run by key or enter, drawn under the pointer.

import { div } from "gpui-kit";
import type { Context, Element, KeyEvent } from "gpui-kit";
import type { Theme } from "herdr";
import { h_flex, v_flex } from "gpui-base";
import type { Row, TreeRow, Act } from "./logic.ts";
import { keyColumn, menuItems, setMenuItems } from "./logic.ts";
import type { Menu } from "./state.ts";
import { viewerFor, tilde, MENU_ROW } from "./state.ts";
import { stop, dither } from "./paint.ts";
import { toggleLook } from "./look.ts";
import { openWeb, reveal } from "./search.ts";
import { closePane, copyPath, copySet, nvim, openPane, openViewer, terminalEdit } from "./opening.ts";
import type { default as Files } from "./main.ts";
import { askDelete, clipNow, cutRow, paste, startDraft, startRename } from "./file-ops.ts";
import { setOf } from "./drag.ts";

/** The empty space's row: the root. */
export function rootRow(v: Files): TreeRow {
  return { path: "", name: v.root, dir: true, depth: 0, ignored: false };
}

export function openMenu(v: Files, row: Row, cx: Context | null): void {
  // On a marked row (with others marked): the set's entries first.
  const set = row.path && v.marked.has(row.path) ? setOf(v, row) : [];
  const clip = Boolean(clipNow(v));

  const all = set.length > 1 ? setMenuItems(row, set.length, { pane: v.alone, clip, look: v.lookState.on })
    : menuItems(row, { pane: v.alone, clip, look: v.lookState.on, web: !v.on, viewer: !row.dir && Boolean(viewerFor(row.path)) });

  const items = row.head ? all.filter((x) => x.act !== "root") : all;

  v.sel = row.path || v.sel;
  v.menu = { row, items, at: { ...v.mouse }, n: 0 };
  v.focus();
  cx?.notify();
}

export function runAct(v: Files, act: Act, row: Row, cx: Context): void {
  const p = row.path;

  switch (act) {
    case "toggle":
      if (row.head) reveal(v, p, cx);
      else v.toggle(p, cx);

      break;
    case "pane": openPane(v, p); break;
    case "root": v.go(p ? `${v.root}/${p}` : v.root, cx); break;
    case "edit": v.edit(p, cx); break;
    case "nvim": nvim(v, row); break;
    case "open": v.openFile(p, cx); break;
    case "viewer": openViewer(v, p, cx); break;
    case "other":
      if (viewerFor(p)?.other === "system") v.openFile(p, cx, true);
      else v.edit(p, cx);

      break;
    case "terminal": terminalEdit(v, p, cx); break;
    case "web": openWeb(v, p, cx); break;
    case "copy": copyPath(v, p, cx); break;
    case "close": closePane(v); break;
    case "new-file": startDraft(v, "file", row, cx); break;
    case "new-folder": startDraft(v, "folder", row, cx); break;
    case "rename": startRename(v, row, cx); break;
    case "cut": cutRow(v, row, cx); break;
    case "paste": paste(v, row, cx); break;
    case "delete": askDelete(v, row, cx); break;
    case "look": toggleLook(v, cx); break;
    case "delete-set": askDelete(v, row, cx); break;
    case "cut-set": cutRow(v, row, cx); break;
    case "copy-set": copySet(v, cx); break;
    case "unmark": v.unmark(); break;
  }
}

export function menuKey(v: Files, e: KeyEvent, cx: Context): void {
  const m = v.menu;

  if (!m) return;

  const k = e.key;
  const char = e.modifiers.shift && /^[a-z]$/.test(k) ? k.toUpperCase() : k;

  if (k === "escape" || k === "m") v.menu = null;
  else if (k === "j" || k === "down") m.n = Math.min(m.items.length - 1, m.n + 1);
  else if (k === "k" || k === "up") m.n = Math.max(0, m.n - 1);
  else if (k === "enter") {
    v.menu = null;

    const it = m.items[m.n];

    if (it) v.act(it.act, m.row, cx);
  } else {
    const it = m.items.find((x) => x.key === char && x.key !== "enter");

    if (!it) return;

    v.menu = null;
    v.act(it.act, m.row, cx);
  }

  cx.stop_propagation();
  cx.notify();
}

export function menuBox(v: Files, t: Theme, m: Menu): Element {
  const w = Math.min(240, v.size.width - 16);
  const h = m.items.length * MENU_ROW + 20;
  // The key column fits its widest key on one line (7 px a character at size 11, as git's menus).
  const keyW = keyColumn(m.items);
  const x = Math.max(8, Math.min(m.at.x, v.size.width - w - 8));
  const y = Math.max(8, Math.min(m.at.y, v.size.height - h - 8));

  const edge = (where: "top" | "bottom"): Element => h_flex().absolute().left(0).right(0).h(13).items_center().text_size(11)
    .when(where === "top", (el) => el.top(-6)).when(where === "bottom", (el) => el.bottom(-6))
    .child(div().h(1).w(8).flex_none().bg(t.accent))
    .when(where === "top", (el) => el.child(div().flex_shrink(1).min_w(0).px(4).truncate().text_color(t.foreground).child(m.row.path ? m.row.name.split("/").pop() ?? "" : tilde(v.root))))
    .child(div().h(1).flex_1().min_w(8).bg(t.accent));

  const rows = m.items.map((it, i) => h_flex().id(`nf-mi-${i}`).relative().h(MENU_ROW).px(10).gap(10).items_center().text_size(11)
    .hover((s) => s.bg(`${t.ansi0}66`))
    .on_mouse_move((_e, cx) => {
      if (m.n !== i) {
        m.n = i;
        cx.notify();
      }
    })
    .on_click((_e, cx) => {
      cx.stop_propagation();
      v.menu = null;
      v.act(it.act, m.row, cx);
      cx.notify();
    })
    .when(i === m.n, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
    .child(div().relative().w(keyW).min_w(keyW).flex_none().overflow_hidden().text_color(t.accent).child(it.key))
    .child(div().relative().flex_1().min_w(0).truncate().text_color(i === m.n ? t.foreground : t.muted).child(it.label)));

  return div().id("nf-menu-layer").absolute().inset_0()
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
      v.menu = null;
      cx.notify();
    })
    .on_mouse_down("right", (_e, cx) => {
      cx.stop_propagation();
      v.menu = null;
      cx.notify();
    })
    .child(v_flex().id("nf-menu").absolute().left(x).top(y).w(w).pt(10).pb(6).bg(t.background).border_l(1).border_r(1).border_color(t.accent)
      .on_mouse_down("left", stop)
      .children(rows)
      .child(edge("top")).child(edge("bottom")));
}
