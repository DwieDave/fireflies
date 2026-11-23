// The Databases window's side panels, drawn: [1] Connections (saved, sent,
// found in the folder), [2] Tables · Views · Schemas · Databases (an empty
// database offers the server's others), [3] Structure · Indexes · Keys ·
// Value (the picked cell, whole), [4] Log. Every row is a click target (a
// click picks, a double click opens, a right click its menu at the pointer)
// and says more on hover; a table's or column's name drags into a query, a
// saved connection to another place; the cursor's row stays in view.

import { div, svg } from "gpui-kit";
import type { Color, Context, Element, MouseButtonEvent } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import type { ScrollHandle } from "gpui-base";
import { home } from "herdr";
import type { Theme } from "herdr";
import { Array as Arr, Option, String as Str } from "effect";
import type { Conn } from "./kinds.ts";
import { KIND_NAME, onFile, where } from "./kinds.ts";
import type { TableRef } from "./catalog.ts";
import type { LogLine, PanelId, StructTab, TablesTab } from "./state.ts";
import { PANEL_KEY, tablesTabsOf } from "./state.ts";
import { ART, band, chip, empty, groupRule, kindBadge, lock, panel, pip, titleTabs } from "./kit.ts";
import { connState, stateTip, stateWord, whereOf } from "./connstate.ts";
import { statePip } from "./connmark.ts";
import type { EmptyWords } from "./dbs.ts";
import { dbRows, dbsNow, emptyWords, hasDatabases, showDatabases, useDatabase, whereNow } from "./dbs.ts";
import { connList } from "./conns.ts";
import { cellAt, prettyValue } from "./grid.ts";
import { shownGrid } from "./act-grid.ts";
import { changeAt } from "./edits.ts";
import { liveEdits, settleEdit } from "./cell-edit.ts";
import { atPointer } from "./menus.ts";
import { addressOf, insertName, openTable, placeConn } from "./actions.ts";
import { dropTarget, pressAt } from "./press.ts";
import { qualified, quoteName } from "./catalog.ts";
import { readIn } from "./reads.ts";
import { PROGRAMS } from "./clients.ts";
import { RUNNING } from "./session.ts";
import { clientFrom } from "./session.ts";
import { togglePin } from "./pinned.ts";
import { forwardShown } from "./forward.ts";
import { missingView, readingView } from "./read-view.ts";
import type { default as DbView } from "./main.ts";
import { edge } from "@fireflies/tones";

/** A row's handlers: picked (a click), opened (a double click), its menu (a right click, at the
 *  pointer); a press that may become a drag (press.ts), the drop target it is, its hover. */
interface RowHandlers {
  readonly pick: (cx: Context) => void;
  readonly open: (cx: Context) => void;
  readonly menu: (cx: Context) => void;
  readonly press?: ((e: MouseButtonEvent, cx: Context) => void) | undefined;
  readonly target?: string | undefined;
  readonly tip?: string | undefined;
}

/** A list row: its band when it's the cursor's, its parts. */
function listRow(t: Theme, v: DbView, id: string, cursor: boolean, active: boolean, parts: readonly Element[], h: RowHandlers): Element {
  const row = h_flex().id(id).relative().h(19).flex_none().pl(10).pr(8).gap(8).items_center().overflow_hidden().cursor_pointer()
    .when(cursor, (el) => el.children(band(t, active)))
    .when(Boolean(h.tip), (el) => el.tooltip(h.tip ?? ""))
    .on_mouse_down("left", (e, cx) => {
      cx.stop_propagation();

      // A cell being edited: kept if it can be (else dropped), as the keyboard leaves the grid.
      if (v.cellEdit) settleEdit(v);

      if (e.click_count >= 2) h.open(cx);
      else {
        h.pick(cx);
        h.press?.(e, cx);
      }

      cx.notify();
    })
    .on_mouse_down("right", (e, cx) => {
      cx.stop_propagation();
      h.pick(cx);
      atPointer(v, () => h.menu(cx), e);
      cx.notify();
    })
    .children(Arr.map(parts, (p) => p.relative()));

  return h.target !== undefined && Str.isNonEmpty(h.target) ? dropTarget(t, row, v, h.target) : row;
}

/** Where a connection's password comes from, in words (never the password). */
function secretWords(c: Conn): string {
  switch (c.secret) {
    case "keychain": return "password in the keychain";
    case "ask": return "password asked, kept in memory";
    case "pgpass": return "password from ~/.pgpass";
    case "kubernetes": return c.source !== undefined ? `password read from secret ${c.source.name} at each connect` : "password from a cluster's secret";
    case "none": return "";
  }
}

/** A connection's hover: where it is, what it is, where it came from and its password. */
function connTip(c: Conn): string {
  return Arr.join(Arr.filter([addressOf(c), KIND_NAME[c.kind], c.readonly ? "read only" : "", c.from !== undefined && Str.isNonEmpty(c.from) ? `sent by ${c.from}` : c.origin === "found" ? "found in the folder" : "", secretWords(c)], Boolean), " · ");
}

/** A list in a scrolled column, the cursor's row kept in view once per move. */
function list(id: string, scroll: ScrollHandle, rows: readonly Element[], cursor: number, seen: { at: number }): Element {
  if (seen.at !== cursor) {
    seen.at = cursor;
    scroll.scroll_to_item(cursor);
  }

  return v_flex().id(id).size_full().overflow_y_scroll().track_scroll(scroll).children(rows);
}

/** A count in a few characters: "1 204", "88 k", "1.2 M". */
export function count(n: number | null): string {
  if (n === null) return "";

  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} M`;

  if (n >= 1e5) return `${Math.round(n / 1000)} k`;

  return Str.replace(/\B(?=(\d{3})+(?!\d))/g, " ")(String(n));
}

const text = (_t: Theme, s: string, color: Color) => div().truncate().text_color(color).child(s);

/** The pip of a connection: its state as the head's mark says it (connstate.ts), small. */
function connPip(t: Theme, v: DbView, c: Conn): Element {
  const s = connState(v, c);

  return h_flex().id(`conn-state-${c.id}`).flex_none().tooltip(stateTip(s, whereOf(v, c), c.readonly, v.now)).child(s.kind === "off" ? pip(edge(t)) : statePip(t, s, 6));
}

/** A cluster-secret connection's mark: the secret it reads its password from (red when the read failed). */
function secretMark(t: Theme, v: DbView, c: Conn, name: string): Element {
  const read = v.sourced.get(c.id);

  const color = read !== undefined && !read.ok ? t.blocked : t.ansi6;

  return h_flex().flex_shrink(2).min_w(0).max_w(180).gap(4).items_center()
    .child(svg(`${ART}/shield.svg`).size(9).flex_none().text_color(color)).child(text(t, name, color).min_w(0));
}

/** A connection whose client isn't on this machine: "no psql" on its row (said before connecting). */
function clientMark(t: Theme, v: DbView, c: Conn): Element[] {
  const f = v.clients.get(c.kind);

  if (f === undefined || !("missing" in f) || (c.kind === "libsql" && c.url)) return [];

  return [h_flex().id(`conn-noclient-${c.id}`).flex_none().tooltip(f.missing).child(text(t, `no ${PROGRAMS[c.kind][0]}`, t.ansi3))];
}

/** The pin: a pinned one's (lit; a click asks to unpin it), a sent one's (dim; a click pins it). */
function pinMark(t: Theme, v: DbView, c: Conn): Element[] {
  if (c.origin === "found") return [];

  const pinned = c.origin === "saved";

  return [h_flex().id(`conn-pin-${c.id}`).flex_none().w(11).h(14).items_center().justify_center().cursor_pointer()
    .tooltip(`${pinned ? "Pinned: every Databases window lists it · P or a click unpins it" : "P or a click pins it: every Databases window lists it"}${pinState(v, c)}`)
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
      togglePin(v, c);
      cx.notify();
    })
    .child(svg(`${ART}/pin.svg`).size(7).text_color(pinned ? t.accent : t.muted).opacity(pinned ? 1 : 0.7))];
}

/** The state a pin's hover adds for the active connection ("· connected · in lantern as app"). */
function pinState(v: DbView, c: Conn): string {
  const s = connState(v, c);

  if (s.kind === "off") return "";

  const w = whereOf(v, c);

  return ` · ${stateWord(s)}${w !== null && (s.kind === "connected" || s.kind === "reading") ? ` · in ${w.database ?? "every database"}${w.user !== null && Str.isNonEmpty(w.user) ? ` as ${w.user}` : ""}` : s.kind === "failed" ? `: ${s.why}` : ""}`;
}

/** A forward's connection: its forward running (localhost:15432), or down. */
function forwardMark(t: Theme, c: Conn): Element[] {
  const f = c.forward;

  if (f === undefined) return [];

  const live = forwardShown(f)?.live === true;

  return [h_flex().id(`conn-fwd-${c.id}`).flex_none().tooltip(`${f.target} :${f.remote} in ${f.context}/${f.namespace} → localhost:${f.local}${live ? " · the forward runs (m stops it)" : " · started again when you connect (asked first)"}`)
    .child(text(t, live ? `↔ :${f.local}` : "↮ forward", live ? t.ansi6 : t.muted))];
}

function connRow(t: Theme, v: DbView, c: Conn, i: number, active: boolean): Element {
  const parts = [
    connPip(t, v, c), ...pinMark(t, v, c), kindBadge(t, c.kind), text(t, c.name, v.connAt === i && active ? t.foreground : t.muted).flex_shrink(1).min_w(0),
    ...(c.secret === "kubernetes" && c.source !== undefined ? [secretMark(t, v, c, c.source.name)] : []),
    ...forwardMark(t, c),
    ...clientMark(t, v, c),
    div().flex_1(), ...(c.readonly ? [lock(t.ansi3)] : []), text(t, where(c, home()), t.dim).flex_shrink(1).min_w(0).max_w(220),
  ];

  const saved = c.origin === "saved";

  return listRow(t, v, `conn-${i}`, v.connAt === i, active, parts, {
    pick: () => { v.connAt = i; v.panel = "conns"; v.focusSelf(); },
    open: () => v.connectTo(c),
    menu: (cx) => v.act("conns", "menu", cx),
    tip: connTip(c),
    // A saved one drags to another place among the saved (kept in connections.json).
    press: saved ? (e) => pressAt(v, e, {
      kind: "conn", label: c.name, takes: ["conn:"],
      drop: (to) => {
        const at = to !== null && Str.isNonEmpty(to) ? Option.getOrElse(Arr.findFirstIndex(v.saved, (s) => `conn:${s.id}` === to), () => -1) : -1;

        if (at >= 0) placeConn(v, c, at);
      },
    }) : undefined,
    target: saved ? `conn:${c.id}` : undefined,
  });
}

/** [1] Connections. */
export function connsPanel(t: Theme, v: DbView): Element {
  const active = v.panel === "conns";
  const all = connList(v);
  const rows: Element[] = [];
  const folder = v.folder !== null && Str.isNonEmpty(v.folder) ? Str.replace(home(), "~")(v.folder) : "";

  Arr.forEach(all, (c, i) => {
    if (c.origin === "saved" && i === 0) rows.push(groupRule(t, "g-pinned", "pinned · every window"));

    if (c.origin === "sent" && (i === 0 || all[i - 1]?.origin !== "sent")) rows.push(groupRule(t, "g-sent", "sent here"));

    if (c.origin === "found" && (i === 0 || all[i - 1]?.origin !== "found")) rows.push(groupRule(t, "g-found", `found in ${folder}`));

    rows.push(connRow(t, v, c, i, active));
  });

  rows.push(h_flex().id("conn-new").h(19).px(10).gap(8).items_center().cursor_pointer().text_color(t.dim).hover((s) => s.text_color(t.foreground))
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
      v.act("conns", "conn-new", cx);
      cx.notify();
    })
    .child(div().w(10).child("+")).child(div().flex_1().child("new connection")).child(div().text_color(t.accent).child("n")));

  const body = all.length !== 0 ? list("conns-list", v.scrolls.conns, rows, v.connAt + rowsBefore(all, v.connAt), v.seen.conns)
    : v_flex().size_full().child(empty(t, "No connections yet", "n adds one; a DATABASE_URL in the folder's .env or a *.db file shows up here by itself", null)).child(rows.at(-1) ?? div());

  return panel(t, "p-conns", titleTabs(t, "conns", PANEL_KEY.conns, [["c", "Connections"]], "c", active, () => v.setPanel("conns")), active, body,
    { right: div().text_color(t.dim).child(String(all.length)), onPress: () => v.setPanel("conns") });
}

/** The group rules drawn before row `i` (the list's children count them). */
export function rowsBefore(all: readonly Conn[], i: number): number {
  let n = 0;

  for (let k = 0; k <= i && k < all.length; k++) {
    const c = all[k];

    if (c !== undefined && (k === 0 || all[k - 1]?.origin !== c.origin)) n++;
  }

  return n;
}

/** The tables the panel lists: by tab (tables or views), schema and the find line. */
export function shownTables(v: DbView): TableRef[] {
  const find = v.tableFind?.value().trim().toLowerCase() ?? "";
  const type = v.tablesTab === "views" ? "view" : "table";

  return Arr.filter(v.catalog.tables, (x) => x.type === type && (v.schema === null || x.schema === v.schema) && (Str.isEmpty(find) || Str.includes(find)(Str.toLowerCase(x.name))));
}

/** The schemas the tables are in. */
export const schemasOf = (v: DbView): string[] => [...new Set(Arr.flatMap(v.catalog.tables, (x) => (x.schema !== null && Str.isNonEmpty(x.schema) ? [x.schema] : [])))];

/** [2]'s cursor in a list of `n` tables: a list read again shorter has it on its last row. */
export const tableCursor = (v: DbView, n: number): number => Math.min(v.tableAt, Math.max(0, n - 1));

function tablesBody(t: Theme, v: DbView, active: boolean): Element {
  if (v.active === null) return empty(t, "Pick a connection", "in [1], and enter", null);

  const read = readIn(v, "tables");

  if (read !== null && v.catalog.tables.length === 0) return readingView(t, "tables-read", read, v.now);

  const missing = v.clients.get(v.active.kind);

  if ((v.catalog.error !== null && Str.isNonEmpty(v.catalog.error)) && missing !== undefined && "missing" in missing) return missingView(t, v, "tables-missing", v.active.kind, clientFrom(v, missing));

  if (v.catalog.error !== null && Str.isNonEmpty(v.catalog.error)) return empty(t, "It didn't answer", v.catalog.error, 1);

  if (v.tablesTab === "databases") return databasesBody(t, v, active);

  if (v.catalog.busy && v.catalog.tables.length === 0) return empty(t, "reading the tables…", null, null);

  if (v.tablesTab === "schemas") return schemasBody(t, v, active);

  // An empty database: which one, the server's others, enter's way on (dbs.ts).
  const none = emptyWords(v);

  if (none !== null && v.tablesTab !== "views") return emptyDbView(t, v, none);

  const many = schemasOf(v).length > 1 && v.schema === null;

  const kind = v.active.kind;

  const shown = shownTables(v);
  const at = tableCursor(v, shown.length);

  const rows = Arr.map(shown, (x, i) => listRow(t, v, `table-${i}`, at === i, active, [
    ...(many && (x.schema !== null && Str.isNonEmpty(x.schema)) ? [text(t, `${x.schema}.`, t.dim).flex_none()] : []),
    text(t, x.name, at === i && active ? t.foreground : t.muted).flex_shrink(1).min_w(0), div().flex_1(),
    text(t, count(x.rows), t.dim).flex_none(),
  ], {
    pick: () => { v.tableAt = i; v.panel = "tables"; v.focusSelf(); },
    open: (cx) => v.act("tables", "open", cx),
    menu: (cx) => v.act("tables", "menu", cx),
    tip: `${x.schema !== null && Str.isNonEmpty(x.schema) ? `${x.schema}.` : ""}${x.name} · ${x.type}${x.rows !== null ? ` · ${count(x.rows)} rows` : ""} · drag it into a query`,
    // Its name drags into a query's editor (quoted); onto the Rows tab, it opens there.
    press: (e) => pressAt(v, e, {
      kind: "name", label: qualified(kind, x), takes: ["editor:", "rows-tab"],
      drop: (to) => {
        if (to?.startsWith("editor:") === true) insertName(v, qualified(kind, x));
        else if (to === "rows-tab") openTable(v, x);
      },
    }),
  }));

  const find = v.tableFind;
  const findRow = find !== null ? h_flex().h(22).px(8).gap(6).items_center().child(div().text_color(t.accent).child("/")).child(Input.new(find).flex_1().text_size(11)) : null;

  return v_flex().size_full().when(findRow !== null, (el) => (findRow !== null ? el.child(findRow) : el))
    .child(rows.length !== 0 ? list("tables-list", v.scrolls.tables, rows, at, v.seen.tables) : empty(t, v.tablesTab === "views" ? "No views" : "No tables", null, null));
}

function schemasBody(t: Theme, v: DbView, active: boolean): Element {
  const names = ["every schema", ...schemasOf(v)];

  const rows = Arr.map(names, (s, i) => listRow(t, v, `schema-${i}`, v.tableAt === i, active, [
    text(t, s, (i === 0 ? v.schema === null : v.schema === s) ? t.ansi5 : t.muted).flex_1(),
  ], {
    pick: () => { v.tableAt = i; v.panel = "tables"; v.focusSelf(); },
    open: (cx) => v.act("tables", "open", cx),
    menu: (cx) => v.act("tables", "menu", cx),
  }));

  return list("schemas-list", v.scrolls.tables, rows, v.tableAt, v.seen.tables);
}

/** The tabs' names. */
const TAB_NAME = { tables: "Tables", views: "Views", schemas: "Schemas", databases: "Databases" } as const satisfies { readonly [K in TablesTab]: string };

/** [2]'s count (top edge) and where it is (bottom edge: the database it's in, its schema when
 *  one is picked; the fallback is said in the head and the empty words). The four tabs keep the
 *  top edge's room. */
export interface TablesCaption {
  readonly count: string;
  readonly where: string;
}

export function tablesCaption(v: DbView): TablesCaption {
  const c = v.active;
  const n = v.tablesTab === "schemas" ? schemasOf(v).length : v.tablesTab === "databases" ? dbsNow(v)?.list.length ?? 0 : shownTables(v).length;

  if (c === null) return { count: String(n), where: "" };

  if (onFile(c) || (c.kind === "libsql" && c.url)) return { count: String(n), where: Str.split(where(c, home()), "/").at(-1) ?? "" };

  const db = whereNow(c, v.catalog.here).database ?? "every database";

  return { count: String(n), where: `in ${v.schema !== null && Str.isNonEmpty(v.schema) ? `${db} · ${v.schema}` : db}` };
}

/** [2] Tables · Views · Schemas · Databases (by kind: state.ts tablesTabsOf). */
export function tablesPanel(t: Theme, v: DbView): Element {
  const active = v.panel === "tables";
  const tabs = Arr.map(tablesTabsOf(v.active?.kind ?? "postgres"), (k) => [k, TAB_NAME[k]] as const);

  const caption = tablesCaption(v);

  return panel(t, "p-tables", titleTabs(t, "tables", PANEL_KEY.tables, tabs, v.tablesTab, active, (k, cx) => v.setTablesTab(k, cx)), active, tablesBody(t, v, active), {
    right: div().min_w(0).truncate().text_color(t.dim).child(caption.count),
    foot: caption.where || null,
    onPress: () => v.setPanel("tables"),
  });
}

/** An empty database's words in [2]: which database, the server's others as chips (a click
 *  connects to one), enter's way on, and the list one click away. */
function emptyDbView(t: Theme, v: DbView, e: EmptyWords): Element {
  return v_flex().size_full().items_center().justify_center().gap(8).px(16).text_size(11)
    .child(svg(`${ART}/moon-1.svg`).w(40).h(40).text_color(t.muted).opacity(0.6).loop("opacity", { from: 0.35, to: 0.7, period: 5200 }))
    .child(div().text_center().text_color(t.muted).child(e.title))
    .child(div().text_center().max_w(460).text_color(t.dim).child(e.note))
    .when(e.others.length > 0, (el) => el.child(h_flex().flex_wrap().justify_center().gap(4).max_w(460)
      .children(Arr.map(e.others, (name, i) => chip(t, `tables-empty-db-${i}`, h_flex().gap(5).items_center().child(pip(t.muted, 5)).child(div().child(name)), false, () => useDatabase(v, name), t.ansi5)))
      .child(chip(t, "tables-empty-list", "the list · b", false, (cx) => showDatabases(v, cx)))));
}

/** A size in bytes, short: "8.1 MB". */
export function bytes(n: number | null): string {
  if (n === null) return "";

  const units = ["B", "kB", "MB", "GB", "TB"];
  let x = n;
  let u = 0;

  while (x >= 1024 && u < units.length - 1) {
    x /= 1024;
    u++;
  }

  return `${x >= 100 || u === 0 ? Math.round(x) : x.toFixed(1)} ${units[u]}`;
}

/** [2]'s Databases tab: the server's databases (the one it's in lit), a pick connects to it. */
function databasesBody(t: Theme, v: DbView, active: boolean): Element {
  const c = v.active;
  const d = dbsNow(v);

  if (c === null || !hasDatabases(c)) return empty(t, "A file has no other databases", null, null);

  const read = readIn(v, "tables");

  if (read !== null && (d?.list.length === undefined || d?.list.length === 0)) return readingView(t, "dbs-read", read, v.now);

  if ((d?.error !== null && d?.error !== undefined && Str.isNonEmpty(d?.error)) && d.list.length === 0) return empty(t, "The server's databases couldn't be read", d.error, null);

  const here = whereNow(c, v.catalog.here).database;
  const names = dbRows(v);

  if (names.length === 0) return empty(t, d?.busy === true || d === null ? "reading the server's databases…" : "No databases this connection may use", null, null);

  const rows = Arr.map(names, (name, i) => {
    const on = name === here;
    const size = name === null ? null : d?.list.find((x) => x.name === name)?.size ?? null;

    return listRow(t, v, `db-${i}`, v.tableAt === i, active, [
      on ? pip(t.done, 6) : pip(edge(t), 6),
      text(t, name ?? "every database", on ? t.ansi5 : v.tableAt === i && active ? t.foreground : t.muted).flex_shrink(1).min_w(0),
      ...(on ? [text(t, "connected here", t.dim).flex_none()] : []),
      div().flex_1(),
      text(t, bytes(size), t.dim).flex_none(),
    ], {
      pick: () => { v.tableAt = i; v.panel = "tables"; v.focusSelf(); },
      open: (cx) => v.act("tables", "open", cx),
      menu: (cx) => v.act("tables", "menu", cx),
      tip: on ? `${name ?? "every database"} · connected here` : `${name ?? "every database (none named)"} · enter or a double click connects to it${c.origin === "saved" ? " (kept in its pin)" : ""}`,
    });
  });

  const foot = d?.sized === true ? null : h_flex().h(20).px(10).gap(6).items_center().text_color(t.dim).child(div().child("# their sizes"));

  return v_flex().size_full().child(list("dbs-list", v.scrolls.tables, rows, v.tableAt, v.seen.tables).flex_1()).when(foot !== null, (el) => (foot !== null ? el.child(foot) : el));
}

/** A Structure row: its parts, the name it puts into a query, the table it leads to, what's copied. */
export interface StructRow {
  readonly mark: string;
  readonly markColor: "pk" | "fk" | "in" | "";
  readonly name: string | null;
  readonly note: string;
  readonly right: string;
  readonly table: string | null;
  readonly copy: string;
}

/** The Structure tab's rows (the Value tab has none). */
export function structRows(v: DbView): StructRow[] {
  const s = v.struct.data;

  if (s === null) return [];

  if (v.structTab === "columns") {
    return Arr.map(s.columns, (c) => {
      const fk = Option.getOrUndefined(Arr.findFirst(s.keys, (k) => !k.incoming && Str.split(k.fromColumns, ", ").includes(c.name)));
      const right = `${c.type}${c.default !== null ? ` = ${c.default}` : c.nullable ? " null" : ""}`;

      return { mark: c.pk ? "pk" : fk !== undefined ? "fk" : "", markColor: c.pk ? "pk" : fk !== undefined ? "fk" : "", name: c.name, note: fk !== undefined ? `→ ${fk.to}.${fk.toColumns}` : "", right, table: fk?.to ?? null, copy: c.name };
    });
  }

  if (v.structTab === "indexes") {
    return Arr.map(s.indexes, (x) => ({ mark: x.kind === "primary" ? "pk" : x.kind === "unique" ? "u" : "", markColor: x.kind === "primary" ? "pk" : "", name: x.name, note: `(${x.columns})`, right: x.method, table: null, copy: x.name }));
  }

  if (v.structTab === "keys") {
    return Arr.map(s.keys, (k) => (k.incoming
      ? { mark: "←", markColor: "in", name: null, note: `${k.from}.${k.fromColumns}`, right: k.onDelete ?? "", table: k.from, copy: `${k.from}.${k.fromColumns}` }
      : { mark: "→", markColor: "fk", name: k.fromColumns, note: `→ ${k.to}.${k.toColumns}`, right: k.onDelete ?? "", table: k.to, copy: `${k.fromColumns} → ${k.to}.${k.toColumns}` }));
  }

  return [];
}

function structBody(t: Theme, v: DbView, active: boolean): Element {
  if (v.structTab === "value") return valueBody(t, v);

  if (v.struct.table === null) return empty(t, "Pick a table", "in [2], and enter", null);

  if (v.struct.error !== null && Str.isNonEmpty(v.struct.error)) return empty(t, "Couldn't read it", v.struct.error, null);

  const rows = structRows(v);

  const read = readIn(v, "structure");

  if (read !== null && rows.length === 0) return readingView(t, "struct-read", read, v.now);

  if (rows.length === 0) return empty(t, v.struct.busy ? "reading…" : v.structTab === "keys" ? "No foreign keys" : v.structTab === "indexes" ? "No indexes" : "No columns", null, null);

  const markColor = { pk: t.ansi3, fk: t.ansi6, in: t.ansi6, "": t.dim } as const;

  const kind = v.active?.kind ?? "sqlite";

  return list("struct-list", v.scrolls.structure, Arr.map(rows, (r, i) => listRow(t, v, `struct-${i}`, v.structAt === i, active, [
    text(t, r.mark, markColor[r.markColor]).w(16).flex_none(),
    h_flex().flex_shrink(1).min_w(0).gap(6).child(text(t, r.name ?? r.note, v.structAt === i && active ? t.foreground : t.muted)).when(r.name !== null && r.note !== "", (el) => el.child(text(t, r.note, t.dim))),
    div().flex_1(), text(t, r.right, t.ansi10).flex_shrink(1).min_w(0).max_w(200),
  ], {
    pick: () => { v.structAt = i; v.panel = "structure"; v.focusSelf(); },
    open: (cx) => v.act("structure", "open", cx),
    menu: (cx) => v.act("structure", "menu", cx),
    // A column's (an index's, a key's) name drags into a query's editor, quoted.
    press: r.name !== null && Str.isNonEmpty(r.name) ? (e) => pressAt(v, e, {
      kind: "name", label: quoteName(kind, r.name ?? ""), takes: ["editor:"],
      drop: (to) => {
        if (to?.startsWith("editor:") === true) insertName(v, quoteName(kind, r.name ?? ""));
      },
    }) : undefined,
  })), v.structAt, v.seen.structure);
}

/** A JSON line's colours: keys cyan, strings yellow-green, numbers yellow. */
function jsonLine(t: Theme, line: string, i: number): Element {
  const parts = Str.split(line, /("(?:[^"\\]|\\.)*"\s*:|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|\btrue\b|\bfalse\b|\bnull\b)/);

  return h_flex().id(`value-${i}`).children(Arr.map(Arr.filter(parts, (p) => p !== ""), (p) => div().flex_none().text_color(
    Str.endsWith(":")(p) && Str.startsWith('"')(p) ? t.ansi6 : Str.startsWith('"')(p) ? t.ansi11 : /^-?\d/.test(p) ? t.ansi3 : /^(true|false|null)$/.test(p) ? t.ansi5 : t.foreground,
  ).child(Str.replace(/ /g, " ")(p))));
}

/** The Value tab: the picked cell of the shown grid, whole (JSON pretty-printed). */
function valueBody(t: Theme, v: DbView): Element {
  const g = shownGrid(v);
  const read = g !== null ? cellAt(g.set, g.at) : undefined;

  if (g === null || read === undefined) return empty(t, "Pick a cell", "in the rows or a result; enter shows it here", null);

  const column = g.set.columns[g.at.col] ?? "";
  // A staged change shows its new value, and what was read under the title.
  const change = g.place === "results" ? null : changeAt(liveEdits(v), g.raw, g.at.row, column);
  const cell = change !== null ? change.now : read;
  const lines = Str.split(prettyValue(cell), "\n").slice(0, 400);

  return v_flex().size_full().px(10).pt(2).gap(4)
    .child(h_flex().gap(8).text_size(10).text_color(t.muted).child(div().child(`${column} · row ${g.at.row + 1}`)).child(div().flex_1()).child(div().text_color(t.accent).child("y")).child(div().child("copy")))
    .when(change !== null, (el) => el.child(h_flex().gap(6).text_size(10).child(div().flex_none().text_color(t.ansi3).child("changed · was")).child(div().min_w(0).truncate().text_color(t.muted).child(change?.was === null ? "NULL" : change?.was === "" ? "'' (empty)" : change?.was ?? ""))))
    .child(v_flex().id("value-text").relative().flex_1().min_h(0).p(8).overflow_y_scroll().bg(`${edge(t)}55`)
      .when(cell === null, (el) => el.text_color(t.dim))
      .children(Arr.map(lines, (l, i) => jsonLine(t, l, i))));
}

/** [3] Structure · Indexes · Keys · Value. */
export function structPanel(t: Theme, v: DbView): Element {
  const active = v.panel === "structure";
  const tabs: readonly (readonly [StructTab, string])[] = [["columns", "Structure"], ["indexes", "Indexes"], ["keys", "Keys"], ["value", "Value"]];
  const s = v.struct;

  return panel(t, "p-structure", titleTabs(t, "struct", PANEL_KEY.structure, tabs, v.structTab, active, (k, cx) => v.setStructTab(k, cx)), active, structBody(t, v, active), {
    right: div().text_color(t.dim).child(s.data !== null ? String(s.data.columns.length) : ""),
    onPress: () => v.setPanel("structure"),
  });
}

/** [4] Log: what ran in this window, newest first. */
export function logPanel(t: Theme, v: DbView): Element {
  const active = v.panel === "log";

  const rows = Arr.map(v.log, (l, i) => listRow(t, v, `log-${i}`, v.logAt === i, active, [
    // A run still going (its line written as it started): a working pip, not a ✓.
    l.said === RUNNING ? pip(t.working, 6, true) : text(t, l.ok ? "✓" : "✕", l.ok ? t.done : t.blocked).flex_none(),
    // A read's label is short ("the tables"): kept whole beside its run's line.
    text(t, Str.replace(/\s+/g, " ")(l.sql), l.ok ? t.muted : t.foreground).flex_shrink(l.run !== undefined && Str.isNonEmpty(l.run) ? 0 : 1).min_w(0),
    ...(l.ok ? [] : [text(t, `— ${l.said}`, t.blocked).flex_shrink(l.said.length < 24 ? 0 : 1).min_w(0)]),
    // The client run behind it: the program, its arguments, where it came from, its exit.
    ...(l.run !== undefined && Str.isNonEmpty(l.run) ? [text(t, l.run, t.muted).flex_shrink(3).min_w(0)] : []),
    div().flex_1(), text(t, `${l.ok ? `${l.said} · ` : ""}${l.ms} ms`, t.dim).flex_none(),
  ], {
    pick: () => { v.logAt = i; v.panel = "log"; v.focusSelf(); },
    open: (cx) => v.act("log", "open", cx),
    menu: (cx) => v.act("log", "menu", cx),
    tip: logTip(l),
  }));

  return panel(t, "p-log", titleTabs(t, "log", PANEL_KEY.log, [["l", "Log"]], "l", active, () => v.setPanel("log")), active,
    rows.length !== 0 ? list("log-list", v.scrolls.log, rows, v.logAt, v.seen.log) : div().px(10).pt(2).text_color(t.dim).child("What runs here shows here (this window only; the history keeps a saved connection's)."),
    { right: div().text_color(t.dim).child("no secrets"), onPress: () => v.setPanel("log") });
}

/** The panel ids in the order the narrow tab row shows them. */
export const NARROW_ORDER: readonly PanelId[] = ["conns", "tables", "structure", "main", "log"];

/** A Log line's hover: what it said when it failed, and the client run behind it. */
function logTip(l: LogLine): string | undefined {
  const tip = Arr.join(Arr.filter([l.ok ? "" : l.said, l.run ?? ""], Str.isNonEmpty), "\n");

  return Str.isEmpty(tip) ? undefined : tip;
}
