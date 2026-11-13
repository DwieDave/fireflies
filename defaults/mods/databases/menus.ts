// The right-click menus (and `m` on a row: the same menu by keyboard): a
// connection's, a table's, a structure row's, a cell's; the history as a
// menu (ctrl-h); the ask before a connection is removed. Each row says the
// key that does the same, so the menu teaches the keys.

import type { Context } from "gpui-kit";
import type { Conn } from "./kinds.ts";
import type { TableRef } from "./catalog.ts";
import { qualified, quoteName } from "./catalog.ts";
import type { MenuRow } from "./state.ts";
import { connect, remove, saveFound, test } from "./conns.ts";
import { openForm } from "./conn-form.ts";
import { openExport } from "./export-form.ts";
import { cellAt, rowText } from "./grid.ts";
import { exportShown, shownGrid, showValue, sortBy } from "./act-grid.ts";
import { insertName, openTable } from "./actions.ts";
import type { StructRow } from "./panels.ts";
import type { default as DbView } from "./main.ts";

/** Opens a menu over the body. */
export function openMenu(v: DbView, title: string, rows: readonly MenuRow[]): void {
  v.menu = rows.length ? { title, rows, at: 0 } : null;
}

export function connMenu(v: DbView, c: Conn, cx: Context): void {
  const rows: MenuRow[] = [
    { label: "Connect", key: "enter", go: () => void connect(v, c, cx) },
    { label: "Test", key: "t", go: () => void test(v, c, cx) },
    { label: "Edit…", key: "e", go: () => openForm(v, c, cx) },
  ];

  if (c.origin !== "saved") rows.push({ label: "Save it", sub: "kept in connections, its password in the keychain", key: "s", go: () => void saveFound(v, c, cx) });

  rows.push({ label: "New connection…", key: "n", go: () => openForm(v, null, cx) });

  if (c.origin !== "found") rows.push({ label: "Remove…", key: "d", danger: true, go: () => confirmRemove(v, c, cx) });

  openMenu(v, c.name, rows);
}

/** Asks before a connection goes (its keychain item and history with it). */
export function confirmRemove(v: DbView, c: Conn, cx: Context): void {
  const what = c.origin === "saved" ? "Its password leaves the keychain and its history goes too." : "It was never saved.";

  v.ask = { verdict: { risk: "write", verb: "remove", target: null }, text: `Remove ${c.name}? ${what}`, step: 1, input: null, go: () => void remove(v, c, cx) };
}

export function tableMenu(v: DbView, t: TableRef, cx: Context): void {
  const kind = v.active?.kind ?? "sqlite";
  const name = qualified(kind, t);

  openMenu(v, t.name, [
    { label: "Rows and structure", key: "enter", go: () => openTable(v, t, cx) },
    { label: "Select it in a query", key: "s", go: () => void v.addQuery(`select * from ${name} limit 100;`, cx) },
    { label: "Count its rows in a query", go: () => void v.addQuery(`select count(*) from ${name};`, cx) },
    { label: "Its name into the query", key: "i", go: () => insertName(v, name, cx) },
    { label: "Copy its name", key: "y", go: () => cx.write_to_clipboard(t.name) },
    { label: "Export…", key: "e", go: () => openExport(v, { table: t }, cx) },
  ]);
}

export function structMenu(v: DbView, r: StructRow, cx: Context): void {
  const kind = v.active?.kind ?? "sqlite";
  const rows: MenuRow[] = [];

  if (r.name) rows.push({ label: "The name into the query", key: "i", go: () => insertName(v, quoteName(kind, r.name ?? ""), cx) });

  const other = r.table ? v.catalog.tables.find((t) => t.name === r.table) : undefined;

  if (other) rows.push({ label: `Open ${other.name}`, key: "enter", go: () => openTable(v, other, cx) });

  rows.push({ label: "Copy", key: "y", go: () => cx.write_to_clipboard(r.copy) });
  openMenu(v, r.name ?? r.copy, rows);
}

export function cellMenu(v: DbView, row: number, col: number, cx: Context): void {
  const g = shownGrid(v);

  if (!g) return;

  const column = g.set.columns[col] ?? "";

  const rows: MenuRow[] = [
    { label: "Its whole value", key: "enter", go: () => showValue(v) },
    { label: "Copy the cell", key: "y", go: () => cx.write_to_clipboard(cellAt(g.set, { ...g.at, row, col }) ?? "") },
    { label: "Copy the row", key: "Y", go: () => cx.write_to_clipboard(rowText(g.set, row)) },
    { label: "Export…", key: "e", go: () => exportShown(v, cx) },
  ];

  if (!v.shownQuery()) {
    rows.splice(3, 0, { label: `Sort by ${column}`, key: "s", go: () => sortBy(v, column, cx) });
    rows.splice(4, 0, { label: "Filter…", key: "/", go: () => { v.rows.filtering = true; } });
  }

  openMenu(v, `${column} · row ${row + 1}`, rows);
}

/** How long ago, in a few letters. */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));

  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
}

/** The connection's history (ctrl-h): picking one opens it in a new query tab. */
export function historyMenu(v: DbView, cx: Context): void {
  if (!v.active) {
    v.say("connect first: the history is the connection's", "failed");

    return;
  }

  if (!v.history.length) {
    v.say(v.active.origin === "saved" ? "nothing run here yet" : "a connection that isn't saved keeps no history", "working");

    return;
  }

  openMenu(v, `history · ${v.active.name}`, v.history.slice(0, 60).map((h) => ({
    label: h.sql.replace(/\s+/g, " ").slice(0, 160),
    sub: `${ago(h.at)} ago${h.ok === false ? " · failed" : ""}${h.rows !== undefined ? ` · ${h.rows} rows` : ""}${h.ms !== undefined ? ` · ${h.ms} ms` : ""}`,
    go: () => void v.addQuery(`${h.sql}${h.sql.trimEnd().endsWith(";") ? "" : ";"}`, cx),
  })));
}
