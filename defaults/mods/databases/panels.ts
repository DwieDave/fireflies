// The Databases window's side panels, drawn: [1] Connections (saved, sent,
// found in the folder), [2] Tables · Views · Schemas, [3] Structure ·
// Indexes · Keys · Value (the picked cell, whole), [4] Log. Every row is a
// click target (a click picks, a double click opens, a right click its menu);
// the cursor's row stays in view.

import { div } from "gpui-kit";
import type { Color, Context, Element } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import type { ScrollHandle } from "gpui-base";
import { home } from "herdr";
import type { Theme } from "herdr";
import type { Conn } from "./kinds.ts";
import { where } from "./kinds.ts";
import type { TableRef } from "./catalog.ts";
import type { PanelId, StructTab, TablesTab } from "./state.ts";
import { PANEL_KEY, schemaWord } from "./state.ts";
import { band, empty, groupRule, kindBadge, lock, panel, pip, titleTabs } from "./kit.ts";
import { connList } from "./conns.ts";
import { cellAt, prettyValue } from "./grid.ts";
import { shownGrid } from "./act-grid.ts";
import type { default as DbView } from "./main.ts";

/** A row's handlers: picked (a click), opened (a double click), its menu (a right click). */
interface RowHandlers {
  readonly pick: (cx: Context) => void;
  readonly open: (cx: Context) => void;
  readonly menu: (cx: Context) => void;
}

/** A list row: its band when it's the cursor's, its parts. */
function listRow(t: Theme, id: string, cursor: boolean, active: boolean, parts: readonly Element[], h: RowHandlers): Element {
  return h_flex().id(id).relative().h(19).flex_none().pl(10).pr(8).gap(8).items_center().overflow_hidden().cursor_pointer()
    .when(cursor, (el) => el.children(band(t, active)))
    .on_mouse_down("left", (e, cx) => {
      cx.stop_propagation();

      if (e.click_count >= 2) h.open(cx);
      else h.pick(cx);

      cx.notify();
    })
    .on_mouse_down("right", (_e, cx) => {
      cx.stop_propagation();
      h.pick(cx);
      h.menu(cx);
      cx.notify();
    })
    .children(parts.map((p) => p.relative()));
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

  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

const text = (_t: Theme, s: string, color: Color) => div().truncate().text_color(color).child(s);

/** The pip of a connection: connected, connecting, failed, or none. */
function connPip(t: Theme, v: DbView, c: Conn): Element {
  if (v.active?.id !== c.id) return pip(t.ansi0);

  if (v.catalog.busy) return pip(t.working, 6, true);

  return pip(v.catalog.error ? t.blocked : t.done);
}

function connRow(t: Theme, v: DbView, c: Conn, i: number, active: boolean): Element {
  const parts = [
    connPip(t, v, c), kindBadge(t, c.kind), text(t, c.name, v.connAt === i && active ? t.foreground : t.muted).flex_shrink(1).min_w(0),
    div().flex_1(), ...(c.readonly ? [lock(t.ansi3)] : []), text(t, where(c, home()), t.dim).flex_shrink(1).min_w(0).max_w(220),
  ];

  return listRow(t, `conn-${i}`, v.connAt === i, active, parts, {
    pick: () => { v.connAt = i; v.panel = "conns"; v.focusSelf(); },
    open: (cx) => v.connectTo(c, cx),
    menu: (cx) => v.act("conns", "menu", cx),
  });
}

/** [1] Connections. */
export function connsPanel(t: Theme, v: DbView): Element {
  const active = v.panel === "conns";
  const all = connList(v);
  const rows: Element[] = [];
  const folder = v.folder ? v.folder.replace(home(), "~") : "";

  all.forEach((c, i) => {
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

  const body = all.length ? list("conns-list", v.scrolls.conns, rows, v.connAt + rowsBefore(all, v.connAt), v.seen.conns)
    : v_flex().size_full().child(empty(t, "No connections yet", "n adds one; a DATABASE_URL in the folder's .env or a *.db file shows up here by itself", null)).child(rows.at(-1) ?? div());

  return panel(t, "p-conns", titleTabs(t, "conns", PANEL_KEY.conns, [["c", "Connections"]], "c", active, () => v.setPanel("conns")), active, body,
    { right: div().text_color(t.dim).child(String(all.length)), onPress: () => v.setPanel("conns") });
}

/** The group rules drawn before row `i` (the list's children count them). */
function rowsBefore(all: readonly Conn[], i: number): number {
  let n = 0;

  for (let k = 0; k <= i && k < all.length; k++) {
    const c = all[k];

    if (c && c.origin !== "saved" && (k === 0 || all[k - 1]?.origin !== c.origin)) n++;
  }

  return n;
}

/** The tables the panel lists: by tab (tables or views), schema and the find line. */
export function shownTables(v: DbView): TableRef[] {
  const find = v.tableFind?.value().trim().toLowerCase() ?? "";
  const type = v.tablesTab === "views" ? "view" : "table";

  return v.catalog.tables.filter((x) => x.type === type && (v.schema === null || x.schema === v.schema) && (!find || x.name.toLowerCase().includes(find)));
}

/** The schemas the tables are in. */
export const schemasOf = (v: DbView): string[] => [...new Set(v.catalog.tables.flatMap((x) => (x.schema ? [x.schema] : [])))];

function tablesBody(t: Theme, v: DbView, active: boolean): Element {
  if (!v.active) return empty(t, "Pick a connection", "in [1], and enter", null);

  if (v.catalog.error) return empty(t, "It didn't answer", v.catalog.error, 1);

  if (v.catalog.busy && !v.catalog.tables.length) return empty(t, "reading the tables…", null, null);

  if (v.tablesTab === "schemas") return schemasBody(t, v, active);

  const many = schemasOf(v).length > 1 && v.schema === null;

  const rows = shownTables(v).map((x, i) => listRow(t, `table-${i}`, v.tableAt === i, active, [
    ...(many && x.schema ? [text(t, `${x.schema}.`, t.dim).flex_none()] : []),
    text(t, x.name, v.tableAt === i && active ? t.foreground : t.muted).flex_shrink(1).min_w(0), div().flex_1(),
    text(t, count(x.rows), t.dim).flex_none(),
  ], {
    pick: () => { v.tableAt = i; v.panel = "tables"; v.focusSelf(); },
    open: (cx) => v.act("tables", "open", cx),
    menu: (cx) => v.act("tables", "menu", cx),
  }));

  const find = v.tableFind;
  const findRow = find ? h_flex().h(22).px(8).gap(6).items_center().child(div().text_color(t.accent).child("/")).child(Input.new(find).flex_1().text_size(11)) : null;

  return v_flex().size_full().when(findRow !== null, (el) => (findRow ? el.child(findRow) : el))
    .child(rows.length ? list("tables-list", v.scrolls.tables, rows, v.tableAt, v.seen.tables) : empty(t, v.tablesTab === "views" ? "No views" : "No tables", null, null));
}

function schemasBody(t: Theme, v: DbView, active: boolean): Element {
  const names = ["every schema", ...schemasOf(v)];

  const rows = names.map((s, i) => listRow(t, `schema-${i}`, v.tableAt === i, active, [
    text(t, s, (i === 0 ? v.schema === null : v.schema === s) ? t.ansi5 : t.muted).flex_1(),
  ], {
    pick: () => { v.tableAt = i; v.panel = "tables"; v.focusSelf(); },
    open: (cx) => v.act("tables", "open", cx),
    menu: () => {},
  }));

  return list("schemas-list", v.scrolls.tables, rows, v.tableAt, v.seen.tables);
}

/** [2] Tables · Views · Schemas. */
export function tablesPanel(t: Theme, v: DbView): Element {
  const active = v.panel === "tables";
  const word = schemaWord(v.active?.kind ?? "postgres");
  const tabs: readonly (readonly [TablesTab, string])[] = [["tables", "Tables"], ["views", "Views"], ["schemas", word[0]?.toUpperCase() + word.slice(1)]];
  const n = v.tablesTab === "schemas" ? schemasOf(v).length : shownTables(v).length;

  return panel(t, "p-tables", titleTabs(t, "tables", PANEL_KEY.tables, tabs, v.tablesTab, active, (k, cx) => v.setTablesTab(k, cx)), active, tablesBody(t, v, active), {
    right: div().text_color(t.dim).child(`${v.schema ?? (v.active ? where(v.active, home()).split("/").at(-1) ?? "" : "")} · ${n}`),
    onPress: () => v.setPanel("tables"),
  });
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

  if (!s) return [];

  if (v.structTab === "columns") {
    return s.columns.map((c) => {
      const fk = s.keys.find((k) => !k.incoming && k.fromColumns.split(", ").includes(c.name));
      const right = `${c.type}${c.default !== null ? ` = ${c.default}` : c.nullable ? " null" : ""}`;

      return { mark: c.pk ? "pk" : fk ? "fk" : "", markColor: c.pk ? "pk" : fk ? "fk" : "", name: c.name, note: fk ? `→ ${fk.to}.${fk.toColumns}` : "", right, table: fk?.to ?? null, copy: c.name };
    });
  }

  if (v.structTab === "indexes") {
    return s.indexes.map((x) => ({ mark: x.kind === "primary" ? "pk" : x.kind === "unique" ? "u" : "", markColor: x.kind === "primary" ? "pk" : "", name: x.name, note: `(${x.columns})`, right: x.method, table: null, copy: x.name }));
  }

  if (v.structTab === "keys") {
    return s.keys.map((k) => (k.incoming
      ? { mark: "←", markColor: "in", name: null, note: `${k.from}.${k.fromColumns}`, right: k.onDelete ?? "", table: k.from, copy: `${k.from}.${k.fromColumns}` }
      : { mark: "→", markColor: "fk", name: k.fromColumns, note: `→ ${k.to}.${k.toColumns}`, right: k.onDelete ?? "", table: k.to, copy: `${k.fromColumns} → ${k.to}.${k.toColumns}` }));
  }

  return [];
}

function structBody(t: Theme, v: DbView, active: boolean): Element {
  if (v.structTab === "value") return valueBody(t, v);

  if (!v.struct.table) return empty(t, "Pick a table", "in [2], and enter", null);

  if (v.struct.error) return empty(t, "Couldn't read it", v.struct.error, null);

  const rows = structRows(v);

  if (!rows.length) return empty(t, v.struct.busy ? "reading…" : v.structTab === "keys" ? "No foreign keys" : v.structTab === "indexes" ? "No indexes" : "No columns", null, null);

  const markColor = { pk: t.ansi3, fk: t.ansi6, in: t.ansi6, "": t.dim } as const;

  return list("struct-list", v.scrolls.structure, rows.map((r, i) => listRow(t, `struct-${i}`, v.structAt === i, active, [
    text(t, r.mark, markColor[r.markColor]).w(16).flex_none(),
    h_flex().flex_shrink(1).min_w(0).gap(6).child(text(t, r.name ?? r.note, v.structAt === i && active ? t.foreground : t.muted)).when(r.name !== null && r.note !== "", (el) => el.child(text(t, r.note, t.dim))),
    div().flex_1(), text(t, r.right, t.ansi10).flex_shrink(1).min_w(0).max_w(200),
  ], {
    pick: () => { v.structAt = i; v.panel = "structure"; v.focusSelf(); },
    open: (cx) => v.act("structure", "open", cx),
    menu: (cx) => v.act("structure", "menu", cx),
  })), v.structAt, v.seen.structure);
}

/** A JSON line's colours: keys cyan, strings yellow-green, numbers yellow. */
function jsonLine(t: Theme, line: string, i: number): Element {
  const parts = line.split(/("(?:[^"\\]|\\.)*"\s*:|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|\btrue\b|\bfalse\b|\bnull\b)/);

  return h_flex().id(`value-${i}`).children(parts.filter((p) => p !== "").map((p) => div().flex_none().text_color(
    p.endsWith(":") && p.startsWith('"') ? t.ansi6 : p.startsWith('"') ? t.ansi11 : /^-?\d/.test(p) ? t.ansi3 : /^(true|false|null)$/.test(p) ? t.ansi5 : t.foreground,
  ).child(p.replace(/ /g, " "))));
}

/** The Value tab: the picked cell of the shown grid, whole (JSON pretty-printed). */
function valueBody(t: Theme, v: DbView): Element {
  const g = shownGrid(v);
  const cell = g ? cellAt(g.set, g.at) : undefined;

  if (!g || cell === undefined) return empty(t, "Pick a cell", "in the rows or a result; enter shows it here", null);

  const column = g.set.columns[g.at.col] ?? "";
  const lines = prettyValue(cell).split("\n").slice(0, 400);

  return v_flex().size_full().px(10).pt(2).gap(4)
    .child(h_flex().gap(8).text_size(10).text_color(t.ansi8).child(div().child(`${column} · row ${g.at.row + 1}`)).child(div().flex_1()).child(div().text_color(t.accent).child("y")).child(div().child("copy")))
    .child(v_flex().id("value-text").relative().flex_1().min_h(0).p(8).overflow_y_scroll().bg(`${t.ansi0}55`)
      .when(cell === null, (el) => el.text_color(t.dim))
      .children(lines.map((l, i) => jsonLine(t, l, i))));
}

/** [3] Structure · Indexes · Keys · Value. */
export function structPanel(t: Theme, v: DbView): Element {
  const active = v.panel === "structure";
  const tabs: readonly (readonly [StructTab, string])[] = [["columns", "Structure"], ["indexes", "Indexes"], ["keys", "Keys"], ["value", "Value"]];
  const s = v.struct;

  return panel(t, "p-structure", titleTabs(t, "struct", PANEL_KEY.structure, tabs, v.structTab, active, (k, cx) => v.setStructTab(k, cx)), active, structBody(t, v, active), {
    right: div().text_color(t.dim).child(s.table ? `${s.table.name}${s.data ? ` · ${s.data.columns.length}` : ""}` : ""),
    onPress: () => v.setPanel("structure"),
  });
}

/** [4] Log: what ran in this window, newest first. */
export function logPanel(t: Theme, v: DbView): Element {
  const active = v.panel === "log";

  const rows = v.log.map((l, i) => listRow(t, `log-${i}`, v.logAt === i, active, [
    text(t, l.ok ? "✓" : "✕", l.ok ? t.done : t.blocked).flex_none(),
    text(t, l.sql.replace(/\s+/g, " "), l.ok ? t.muted : t.foreground).flex_shrink(1).min_w(0),
    ...(l.ok ? [] : [text(t, `— ${l.said}`, t.blocked).flex_shrink(1).min_w(0)]),
    div().flex_1(), text(t, `${l.ok ? `${l.said} · ` : ""}${l.ms} ms`, t.dim).flex_none(),
  ], {
    pick: () => { v.logAt = i; v.panel = "log"; v.focusSelf(); },
    open: (cx) => v.act("log", "open", cx),
    menu: () => {},
  }));

  return panel(t, "p-log", titleTabs(t, "log", PANEL_KEY.log, [["l", "Log"]], "l", active, () => v.setPanel("log")), active,
    rows.length ? list("log-list", v.scrolls.log, rows, v.logAt, v.seen.log) : div().px(10).pt(2).text_color(t.dim).child("What runs here shows here (this window only; the history keeps a saved connection's)."),
    { right: div().text_color(t.dim).child("no secrets"), onPress: () => v.setPanel("log") });
}

/** The panel ids in the order the narrow tab row shows them. */
export const NARROW_ORDER: readonly PanelId[] = ["conns", "tables", "structure", "main", "log"];
