// The head's mark that says whether the window is connected, first after
// the title: a hollow dim pip when nothing is, the breathing pip while it
// connects or reads, the lit green pip with "connected · <database> as
// <user>" when the last read answered, red with the reason in its hover when
// it failed, the lock beside it when read only. A click (or C) opens the
// connection's menu: disconnect, reconnect, the server's databases, copy its
// address; a click on the database opens the Databases tab (b). In a narrow
// pane the words go first, the mark stays. connstate.ts says the state; the
// [1] row's pip and the pin's hover draw from the same function.

import { div, svg } from "gpui-kit";
import type { Context, Element } from "gpui-kit";
import { h_flex } from "gpui-base";
import type { Theme } from "herdr";
import type { MenuRow } from "./state.ts";
import type { ConnState } from "./connstate.ts";
import { breathes, connState, stateColor, stateTip, stateWord, whereOf } from "./connstate.ts";
import { databaseWords, hasDatabases, loadDatabases, showDatabases, useDatabase, dbsNow } from "./dbs.ts";
import { ART, lock, pip, stop } from "./kit.ts";
import { atPointer, entry, openMenu } from "./menus.ts";
import { addressOf, disconnect, insertName } from "./actions.ts";
import { copy } from "./act-grid.ts";
import { connect, test } from "./conns.ts";
import { openForm } from "./conn-form.ts";
import { quoteName } from "./catalog.ts";
import type { default as DbView } from "./main.ts";

/** A state's pip: hollow when off, breathing while it works. */
export function statePip(t: Theme, s: ConnState, size = 7): Element {
  if (s.kind === "off") return svg(`${ART}/pip-hollow.svg`).size(size).flex_none().text_color(t.ansi8);

  return pip(stateColor(t, s), size, breathes(s));
}

/** The head's mark (`narrow`: the pip and the lock only, the words in its hover). */
export function stateMark(t: Theme, v: DbView, narrow: boolean): Element {
  const c = v.active;
  const s = connState(v, c);
  const w = whereOf(v, c);
  const ro = Boolean(c?.readonly);
  const live = s.kind === "connected" || s.kind === "reading";
  const color = stateColor(t, s);

  const mark = h_flex().id("db-state").relative().flex_none().h(20).px(4).gap(6).items_center().cursor_pointer()
    .tooltip(stateTip(s, w, ro))
    .hover((x) => x.bg(`${t.ansi0}66`))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      cx.stop_propagation();
      atPointer(v, () => stateMenu(v, cx));
      cx.notify();
    })
    .child(statePip(t, s))
    .when(!narrow, (el) => el.child(div().flex_none().text_color(s.kind === "off" ? t.dim : color).child(stateWord(s))))
    .when(ro, (el) => el.child(lock(t.ansi3)).when(!narrow, (x) => x.child(div().flex_none().text_color(t.ansi3).child("read only"))));

  // Connected: the database (a click lists the server's) and who it is there.
  if (!live || !w || !c) return mark;

  const db = h_flex().id("db-where-db").flex_shrink(1).min_w(0).gap(4).items_center().overflow_hidden().cursor_pointer()
    .tooltip(hasDatabases(c) ? `${databaseWords(w)} · b or a click: the server's databases` : databaseWords(w))
    .on_mouse_down("left", stop)
    .on_click((_e, cx) => {
      cx.stop_propagation();
      showDatabases(v, cx);
      cx.notify();
    })
    .child(div().flex_none().text_color(t.foreground).hover((x) => x.text_color(t.accent)).child(w.database ?? "every database"))
    .when(w.fallback && !narrow, (el) => el.child(div().flex_shrink(1).min_w(0).truncate().text_color(t.dim).child("(the server's default: none was named)")));

  return h_flex().relative().flex_shrink(1).min_w(0).gap(6).items_center().overflow_hidden()
    .child(mark)
    .when(!narrow, (el) => el.child(div().flex_none().text_color(t.dim).child("·")))
    .child(db)
    .when(Boolean(w.user) && !narrow, (el) => el.child(div().flex_none().text_color(t.dim).child("as")).child(div().flex_shrink(2).min_w(0).truncate().text_color(t.muted).child(w.user ?? "")));
}

/** The connection's menu from the head (a click on the mark, C): what can be done with the
 *  connection as it stands. */
export function stateMenu(v: DbView, cx: Context): void {
  const c = v.active;

  if (!c) {
    v.say("nothing is connected: enter on a connection in [1] connects", "failed");
    v.setPanel("conns");

    return;
  }

  const s = connState(v, c);
  const address = addressOf(c);
  const reconnect = entry("conns", null, "Reconnect", () => void connect(v, c, cx), { sub: c.secret === "kubernetes" ? "its secret read again, its forward looked at, its tables read" : "its tables read again from the start" });
  const rows: MenuRow[] = [];

  if (s.kind === "failed") rows.push(reconnect, entry("conns", "conn-edit", "Edit…", () => openForm(v, c, cx), { sub: s.why }));
  else rows.push(entry("window", "refresh", "Read it again", () => v.act("window", "refresh", cx)), reconnect);

  if (hasDatabases(c)) rows.push(entry("window", "databases", "The server's databases…", () => showDatabases(v, cx), { sub: `now ${databaseWords(whereOf(v, c) ?? { database: null, fallback: false, user: null })}` }));

  rows.push(
    entry("conns", "conn-test", "Test", () => void test(v, c, cx)),
    entry("conns", "copy", "Copy its address", () => copy(v, address, cx), { sub: address }),
    entry("conns", "disconnect", "Disconnect", () => disconnect(v), { sub: "its tables close; the query tabs stay" }),
  );

  openMenu(v, `${c.name} · ${stateWord(s)}`, rows);
}

/** A database's menu in [2]'s Databases tab (null: MySQL's "every database"). */
export function dbMenu(v: DbView, name: string | null, cx: Context): void {
  const c = v.active;

  if (!c) return;

  const here = whereOf(v, c)?.database ?? null;

  const rows: MenuRow[] = [
    entry("tables", "open", name === here ? "Read it again" : `Connect to ${name ?? "every database"}`, () => useDatabase(v, name, cx), { sub: c.origin === "saved" ? "kept in its pin" : "kept while this window is open" }),
  ];

  if (name) {
    rows.push(
      entry("tables", "insert", "Its name into the query", () => insertName(v, quoteName(c.kind, name), cx)),
      entry("tables", "copy", "Copy its name", () => copy(v, name, cx)),
    );
  }

  if (!dbsNow(v)?.sized) rows.push(entry("tables", "count", "Their sizes", () => void loadDatabases(v, cx, true), { sub: c.kind === "postgres" ? "reads each database's size from its files: can take a while on a big server" : "summed from information_schema" }));

  openMenu(v, name ?? "every database", rows);
}
