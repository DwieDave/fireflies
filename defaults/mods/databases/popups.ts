// What's over the Databases view and has the keyboard first: a connection's
// form, the export, the password asked before connecting, a query tab's new
// name, the ask in the bar
// (y; for a destructive statement then its name typed), a menu (over the whole
// view: at the press for a right click, at the cursor's cell for a key, else in
// the middle: menuLayer, menu-place.ts), the keys
// overview, the filter and find lines. modalKey() hands a key to whichever is
// up; overBody() and askBar() draw them.
//
// A key a text field types is answered "typing": the window must leave it
// unclaimed (no stop_propagation, none of its own keys), or GPUI counts it as
// handled and never hands its character to the focused input.

import { div } from "gpui-kit";
import type { Color, Context, Element, KeyEvent } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import type { Theme } from "herdr";
import type { Ask, Menu, Taken } from "./state.ts";
import { band, chip, dither, popupScrim, stop } from "./kit.ts";
import { keysKey, keysView } from "./keyhelp.ts";
import { helpSections, keyName, shown } from "./keys.ts";
import { keepRename } from "./menus.ts";
import { applyFilter } from "./act-grid.ts";
import { editKey } from "./cell-edit.ts";
import { reviewKey, reviewPanel } from "./review.ts";
import { forwardAskKey, forwardAskPanel } from "./forward-view.ts";
import type { default as DbView } from "./main.ts";
import type { Box } from "./menu-place.ts";
import { placeMenu } from "./menu-place.ts";
import { keyedAnchor } from "./menu-anchor.ts";

/** The ask's answer to a key: always taken, but the name typed at step 2 is its input's. */
function askKey(v: DbView, ask: Ask, e: KeyEvent): Taken {
  const k = e.key;

  if (k === "escape" || (ask.step === 1 && k === "n")) {
    v.ask = null;
    v.focusShown();

    return true;
  }

  if (ask.step === 1 && (k === "y" || k === "enter")) {
    if (ask.verdict.risk === "destructive" && ask.input) {
      ask.step = 2;
      ask.input.focus();

      return true;
    }

    v.ask = null;
    v.focusShown();
    ask.go();

    return true;
  }

  if (ask.step !== 2) return true;

  if (k !== "enter") return "typing";

  const want = ask.verdict.target ?? "yes";

  if ((ask.input?.value() ?? "").trim() !== want) {
    v.say(`type ${want} to go on, or esc`, "failed");

    return true;
  }

  v.ask = null;
  v.focusShown();
  ask.go();

  return true;
}

/** Each menu row's digit: a row with a key of its own shows that key alone; the others take 1-9 in
 *  order (one shortcut per row, of one kind or the other). */
export function digitsOf(rows: Menu["rows"]): (number | null)[] {
  let n = 0;

  return rows.map((r) => (r.key || n >= 9 ? null : ++n));
}

function menuKey(v: DbView, m: Menu, e: KeyEvent): void {
  const k = shown(keyName(e));
  const n = Number(k);

  if (k === "esc" || k === "q") v.menu = null;
  else if (k === "j" || k === "↓") m.at = Math.min(m.rows.length - 1, m.at + 1);
  else if (k === "k" || k === "↑") m.at = Math.max(0, m.at - 1);
  else if (k === "enter" || (n >= 1 && n <= 9 && digitsOf(m.rows).includes(n))) {
    const row = m.rows[k === "enter" ? m.at : digitsOf(m.rows).indexOf(n)];

    v.menu = null;
    row?.go();
  } else {
    // A row's own key (as the panel has it) runs it from the menu too.
    const row = m.rows.find((r) => r.key === k);

    if (row) {
      v.menu = null;
      row.go();
    }
  }
}

/** A line input's keys (the filter, the find): enter keeps it, esc drops it; the rest is typing. */
function lineKey(v: DbView, e: KeyEvent, cx: Context): Taken {
  if (v.rows.filtering) {
    if (e.key === "enter") applyFilter(v, cx);
    else if (e.key === "escape") {
      v.rows.filtering = false;
      v.filterInput = null;
      v.focusSelf();
    } else return "typing";

    return true;
  }

  const find = v.tableFind;

  if (!find) return false;

  if (e.key === "enter" || e.key === "down") {
    v.findTyping = false;
    v.focusSelf();

    return e.key === "enter";
  }

  if (e.key === "escape") {
    v.tableFind = null;
    v.findTyping = false;
    v.focusSelf();

    return true;
  }

  if (!v.findTyping) return false;

  v.tableAt = 0;

  return "typing";
}

/** A query tab's new name: enter keeps it, esc leaves it; the rest is typed. */
function renameKey(v: DbView, e: KeyEvent): Taken {
  if (e.key === "enter") keepRename(v);
  else if (e.key === "escape") {
    v.rename = null;
    v.focusShown();
  } else return "typing";

  return true;
}

/** The password asked before connecting: enter takes it, esc drops it; the rest is typed. */
function passwordKey(v: DbView, e: KeyEvent): Taken {
  if (e.key === "enter") v.password?.done();
  else if (e.key === "escape") {
    v.password = null;
    v.focusShown();
  } else return "typing";

  return true;
}

/** Hands a key to what's over the view: taken, "typing" (the focused field's), or not. */
export function modalKey(v: DbView, e: KeyEvent, cx: Context): Taken {
  if (v.forwardAsk) return forwardAskKey(v, v.forwardAsk, e, cx);

  if (v.form) return v.form.key(e, cx);

  if (v.exporting) return v.exporting.key(e, cx);

  if (v.password) return passwordKey(v, e);

  if (v.rename) return renameKey(v, e);

  if (v.review) {
    reviewKey(v, e, cx);

    return true;
  }

  const ask = v.ask;

  if (ask) return askKey(v, ask, e);

  const m = v.menu;

  if (m) {
    menuKey(v, m, e);

    return true;
  }

  const edit = editKey(v, e);

  if (edit) return edit;

  // The SQL editor has the keyboard: its typing (a ? too) is its own, not the window's.
  if (!v.help && v.place() === "editor" && v.shownQuery()?.editor.focused()) return "typing";

  // A line being typed in (the WHERE filter, the find) takes its ? too.
  if (v.rows.filtering || v.findTyping) return lineKey(v, e, cx);

  const help = keysKey(e, v.help);

  if (help || v.help) {
    if (help) v.help = help === "toggle" ? !v.help : false;

    return true;
  }

  return lineKey(v, e, cx);
}

/** The ask, in the bar over the keys: y / esc, then for a destructive one the name typed. */
export function askBar(t: Theme, v: DbView, ask: Ask): Element {
  const danger = ask.verdict.risk === "destructive";
  const tint: Color = danger ? `${t.ansi1}44` : `${t.ansi3}44`;

  const bar = h_flex().id("db-ask").relative().h(32).flex_none().px(12).gap(12).items_center().text_size(12)
    .child(div().absolute().inset_0().child(dither(tint, 1)))
    .child(div().relative().text_color(danger ? t.ansi1 : t.ansi3).child(danger ? "✕" : "!"))
    .child(div().relative().flex_1().min_w(0).truncate().text_color(t.foreground).child(ask.text));

  if (ask.step === 2 && ask.input) {
    return bar.child(div().relative().text_color(t.dim).child(`type ${ask.verdict.target ?? "yes"}`))
      .child(div().relative().w(180).border(1).border_color(t.ansi1).px(6).child(Input.new(ask.input).text_size(12).text_color(t.foreground)))
      .child(chip(t, "db-ask-no", "esc  no", false, () => { v.ask = null; }));
  }

  return bar
    .child(chip(t, "db-ask-yes", danger ? "y  yes, then its name" : "y  run", false, () => {
      if (danger && ask.input) {
        ask.step = 2;
        ask.input.focus();
      } else {
        v.ask = null;
        ask.go();
      }
    }, danger ? t.ansi1 : t.ansi3))
    .child(chip(t, "db-ask-no", "esc  no", false, () => { v.ask = null; }));
}

/** The dim over the body or the view: a press on it (either button) closes what's on it. */
function dimLayer(id: string, close: (cx: Context) => void): Element {
  return div().id(id).absolute().inset_0().text_size(12)
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
      close(cx);
      cx.notify();
    })
    .on_mouse_down("right", (_e, cx) => {
      cx.stop_propagation();
      close(cx);
      cx.notify();
    })
    .child(popupScrim(`${id}-scrim`));
}

/** A box over the dim, in the middle of the body. */
function centered(id: string, box: Element, close: (cx: Context) => void): Element {
  return dimLayer(id, close).flex().items_center().justify_center().child(box.relative().on_mouse_down("left", stop));
}

/** The menu's size: narrower when it stands at something (a press, a cell), as tall as its rows. */
export function menuSize(v: DbView, m: Menu): Box {
  return {
    width: Math.min(m.near || keyedAnchor(v) ? 380 : 560, v.size.width - 40),
    height: Math.min(440, v.size.height - 80, 26 + m.rows.reduce((n, r) => n + (r.sub ? 34 : 24), 0)),
  };
}

/** The menu over the whole view (its top left corner is the view's, where presses and cells are
 *  measured from): at the press, at the cursor's cell, or in the middle (menu-place.ts). */
export function menuLayer(t: Theme, v: DbView): Element | null {
  const m = v.menu;

  if (!m) return null;

  const digits = digitsOf(m.rows);
  const { width: w, height: h } = menuSize(v, m);
  // The cursor's cell is found now, not when the menu opened: the window may have been resized since.
  const at = placeMenu({ width: w, height: h }, v.size, m.near ?? keyedAnchor(v));

  const rows = m.rows.map((r, i) => h_flex().id(`menu-${i}`).relative().h(r.sub ? 34 : 24).flex_none().px(10).gap(10).items_center().cursor_pointer()
    .hover((s) => s.bg(`${t.ansi0}55`))
    .when(i === m.at, (el) => el.children(band(t, true)))
    .on_click((_e, cx) => {
      v.menu = null;
      r.go();
      cx.notify();
    })
    .child(div().relative().w(14).flex_none().text_color(i === m.at ? t.accent : t.dim).child(digits[i] ? String(digits[i]) : ""))
    .child(v_flex().relative().flex_1().min_w(0)
      .child(div().truncate().text_color(r.danger ? t.blocked : i === m.at ? t.foreground : t.muted).child(r.label))
      .when(Boolean(r.sub), (el) => el.child(div().truncate().text_size(10).text_color(t.dim).child(r.sub ?? ""))))
    .when(Boolean(r.key), (el) => el.child(div().relative().flex_none().text_color(t.accent).child(r.key ?? ""))));

  return dimLayer("db-menu", () => { v.menu = null; })
    .child(v_flex().id("db-menu-box").absolute().left(at.x).top(at.y).w(w).max_h(h).bg(t.background).border(1).border_color(t.accent).py(4).overflow_y_scroll()
      .on_mouse_down("left", stop)
      .child(div().px(10).pb(4).text_size(10).text_color(t.ansi8).truncate().child(m.title))
      .children(rows));
}

/** A query tab's name asked for. */
function renamePanel(t: Theme, v: DbView): Element {
  const r = v.rename;

  if (!r) return div();

  return centered("db-rename", v_flex().id("db-rename-box").w(Math.min(380, v.size.width - 40)).bg(t.background).border(1).border_color(t.accent).p(14).gap(10)
    .child(div().text_color(t.foreground).child(`Rename ${r.tab.name}`))
    .child(div().border(1).border_color(t.accent).px(8).py(4).child(Input.new(r.input).text_size(12).text_color(t.foreground)))
    .child(h_flex().gap(8).justify_end()
      .child(chip(t, "db-rename-ok", "enter  rename", false, () => keepRename(v), t.accent))
      .child(chip(t, "db-rename-no", "esc  leave it", false, () => { v.rename = null; }))), () => { v.rename = null; });
}

function passwordPanel(t: Theme, v: DbView): Element {
  const pw = v.password;

  if (!pw) return div();

  const c = [...v.saved, ...v.sent, ...v.found.map((f) => f.conn)].find((x) => x.id === pw.conn);

  return centered("db-password", v_flex().id("db-password-box").w(Math.min(420, v.size.width - 40)).bg(t.background).border(1).border_color(t.accent).p(14).gap(10)
    .child(div().text_color(t.foreground).child(`Password for ${c?.name ?? "the connection"}`))
    .map((el) => {
      // Asked because a cluster's secret couldn't be read (or was refused): why, in words.
      const read = c ? v.sourced.get(c.id) : undefined;

      return read && !read.ok ? el.child(div().id("db-pw-why").text_size(10).text_color(t.blocked).child(read.text)) : el;
    })
    .child(div().border(1).border_color(t.accent).px(8).py(4).child(Input.new(pw.input).text_size(12).text_color(t.foreground)))
    .child(div().text_size(10).text_color(t.dim).child(c?.secret === "keychain" ? "kept in the system keychain" : "kept in this window's memory until it closes; never written anywhere"))
    .child(h_flex().gap(8).justify_end()
      .child(chip(t, "db-pw-ok", "enter  connect", false, () => pw.done(), t.accent))
      .child(chip(t, "db-pw-no", "esc  cancel", false, () => { v.password = null; }))), () => { v.password = null; });
}

/** What's drawn over the body, top last. */
export function overBody(t: Theme, v: DbView): Element[] {
  const out: Element[] = [];

  if (v.help) {
    out.push(keysView(t, { id: "db-help", title: "Databases", list: helpSections(v.place()), close: () => { v.help = false; } }));
  }

  if (v.review) out.push(reviewPanel(t, v));

  if (v.password) out.push(passwordPanel(t, v));

  if (v.rename) out.push(renamePanel(t, v));

  if (v.form) out.push(v.form.draw(t));

  if (v.exporting) out.push(v.exporting.draw(t));

  if (v.forwardAsk) out.push(forwardAskPanel(t, v, v.forwardAsk, (id, box, close) => centered(id, box, close)));

  return out;
}
