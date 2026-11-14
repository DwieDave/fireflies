// What's over the Databases view and has the keyboard first: a connection's
// form, the export, the password asked before connecting, the ask in the bar
// (y; for a destructive statement then its name typed), a menu, the keys
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
import { helpSections } from "./keys.ts";
import { applyFilter } from "./act-grid.ts";
import { editKey } from "./cell-edit.ts";
import { reviewKey, reviewPanel } from "./review.ts";
import type { default as DbView } from "./main.ts";

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

function menuKey(v: DbView, m: Menu, e: KeyEvent): void {
  const k = e.key_char && e.key_char.length === 1 ? e.key_char : e.key;
  const n = Number(k);

  if (k === "escape" || k === "q") v.menu = null;
  else if (k === "j" || k === "down") m.at = Math.min(m.rows.length - 1, m.at + 1);
  else if (k === "k" || k === "up") m.at = Math.max(0, m.at - 1);
  else if (k === "enter" || (n >= 1 && n <= 9 && n <= m.rows.length)) {
    const row = m.rows[k === "enter" ? m.at : n - 1];

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
  if (v.form) return v.form.key(e, cx);

  if (v.exporting) return v.exporting.key(e, cx);

  if (v.password) return passwordKey(v, e);

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

/** A box in the middle of the body over the dim (a menu, the password ask). */
function centered(id: string, box: Element, close: (cx: Context) => void): Element {
  return div().id(id).absolute().inset_0().flex().items_center().justify_center().text_size(12)
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
      close(cx);
      cx.notify();
    })
    .child(popupScrim(`${id}-scrim`))
    .child(box.relative().on_mouse_down("left", stop));
}

function menuPanel(t: Theme, v: DbView, m: Menu): Element {
  const rows = m.rows.map((r, i) => h_flex().id(`menu-${i}`).relative().h(r.sub ? 34 : 24).flex_none().px(10).gap(10).items_center().cursor_pointer()
    .hover((s) => s.bg(`${t.ansi0}55`))
    .when(i === m.at, (el) => el.children(band(t, true)))
    .on_click((_e, cx) => {
      v.menu = null;
      r.go();
      cx.notify();
    })
    .child(div().relative().w(14).flex_none().text_color(i === m.at ? t.accent : t.dim).child(i < 9 ? String(i + 1) : ""))
    .child(v_flex().relative().flex_1().min_w(0)
      .child(div().truncate().text_color(r.danger ? t.blocked : i === m.at ? t.foreground : t.muted).child(r.label))
      .when(Boolean(r.sub), (el) => el.child(div().truncate().text_size(10).text_color(t.dim).child(r.sub ?? ""))))
    .when(Boolean(r.key), (el) => el.child(div().relative().flex_none().text_color(t.accent).child(r.key ?? ""))));

  return centered("db-menu", v_flex().id("db-menu-box").w(Math.min(560, v.size.width - 40)).max_h(Math.min(440, v.size.height - 80)).bg(t.background).border(1).border_color(t.accent).py(4).overflow_y_scroll()
    .child(div().px(10).pb(4).text_size(10).text_color(t.ansi8).truncate().child(m.title))
    .children(rows), () => { v.menu = null; });
}

function passwordPanel(t: Theme, v: DbView): Element {
  const pw = v.password;

  if (!pw) return div();

  const c = [...v.saved, ...v.sent, ...v.found.map((f) => f.conn)].find((x) => x.id === pw.conn);

  return centered("db-password", v_flex().id("db-password-box").w(Math.min(420, v.size.width - 40)).bg(t.background).border(1).border_color(t.accent).p(14).gap(10)
    .child(div().text_color(t.foreground).child(`Password for ${c?.name ?? "the connection"}`))
    .child(div().border(1).border_color(t.accent).px(8).py(4).child(Input.new(pw.input).text_size(12).text_color(t.foreground)))
    .child(div().text_size(10).text_color(t.dim).child(c?.secret === "keychain" ? "kept in the system keychain" : "kept in this window's memory until it closes; never written anywhere"))
    .child(h_flex().gap(8).justify_end()
      .child(chip(t, "db-pw-ok", "enter  connect", false, () => pw.done(), t.accent))
      .child(chip(t, "db-pw-no", "esc  cancel", false, () => { v.password = null; }))), () => { v.password = null; });
}

/** What's drawn over the body, top last. */
export function overBody(t: Theme, v: DbView): Element[] {
  const out: Element[] = [];
  const menu = v.menu;

  if (v.help) {
    out.push(keysView(t, { id: "db-help", title: "Databases", list: helpSections(v.place()), close: () => { v.help = false; } }));
  }

  if (menu) out.push(menuPanel(t, v, menu));

  if (v.review) out.push(reviewPanel(t, v));

  if (v.password) out.push(passwordPanel(t, v));

  if (v.form) out.push(v.form.draw(t));

  if (v.exporting) out.push(v.exporting.draw(t));

  return out;
}
