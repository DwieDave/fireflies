// The main view, drawn: its tabs cut into the panel's edge (Rows, a tab per
// query, + for a new one), the Rows tab (the WHERE line, the grid, the pager)
// and a query tab (the SQL editor over its result: the grid, the error with
// its place, a run going on with its cancel).

import { div } from "gpui-kit";
import type { Context, Element } from "gpui-kit";
import { h_flex, v_flex, Input, Editor } from "gpui-base";
import type { Theme } from "herdr";
import type { QueryTab } from "./state.ts";
import { PANEL_KEY } from "./state.ts";
import { chip, dither, empty, panel, pip, titleTabs, unzoom, unzoomSize } from "./kit.ts";
import { divider } from "./dividers.ts";
import { editorDivider } from "./layout.ts";
import { grid } from "./grid.ts";
import type { GridHandlers, GridOverlay } from "./grid.ts";
import type { ResultSet } from "./parse-out.ts";
import { changeAt, changesWord, counted, rowChanged } from "./edits.ts";
import { editableNow, liveEdits, settleEdit, startEdit } from "./cell-edit.ts";
import { changesBar } from "./review.ts";
import { colsOf, openFilter, showValue, sortBy } from "./act-grid.ts";
import { cellMenu } from "./menus.ts";
import { loadRows } from "./session.ts";
import { cancelQuery } from "./query.ts";
import { count } from "./panels.ts";
import { resultWords } from "./parse-out.ts";
import type { default as DbView } from "./main.ts";

/** The grid's handlers for the shown grid (the Rows tab's or a query's). */
function handlers(v: DbView, q: QueryTab | null): GridHandlers {
  const put = (row: number, col: number) => {
    if (q) q.at = { ...q.at, row, col };
    else v.rows.at = { ...v.rows.at, row, col };
  };

  return {
    pick: (row, col) => {
      if (!q) settleEdit(v);

      put(row, col);
      v.panel = "main";

      if (q) q.inResults = true;

      v.focusSelf();
    },
    // A double click edits a table's cell; anything else shows its whole value.
    open: (row, col) => {
      if (!q) settleEdit(v);

      put(row, col);

      if (q || "why" in editableNow(v) || !startEdit(v)) showValue(v);
    },
    menu: (row, col, cx) => {
      put(row, col);
      cellMenu(v, row, col, cx);
    },
    sort: q ? null : (col, cx) => sortBy(v, v.rows.set?.columns[col] ?? null, cx),
    scroll: (by, across, cx) => v.scrollGrid(by, across, cx),
  };
}

/** What editing lays over the Rows grid: the staged changes, the rows with some, the edited cell. */
function overlayOf(v: DbView, set: ResultSet): GridOverlay {
  const e = liveEdits(v);

  return {
    change: (r, c) => changeAt(e, set, r, set.columns[c] ?? ""),
    marked: (r) => rowChanged(e, set, r),
    editing: v.cellEdit,
  };
}

/** A grid in a box that measures itself (the keys move the cursor by its rows). */
function gridBox(t: Theme, v: DbView, id: string, el: Element): Element {
  return div().id(id).relative().flex_1().min_h(0).min_w(0).overflow_hidden()
    .on_size_change((drawn, cx) => {
      const s = unzoomSize(drawn);

      if (Math.abs(s.width - v.gridSize.width) > 1 || Math.abs(s.height - v.gridSize.height) > 1) {
        v.gridSize = s;
        cx.notify();
      }
    })
    .child(el)
    .when(false, (x) => x.bg(t.background));
}

/** The WHERE line over the Rows grid: the input while typing, else the filter as it is. */
function filterLine(t: Theme, v: DbView): Element {
  const input = v.filterInput;
  const now = v.rows.browse?.filter ?? "";

  const row = h_flex().id("rows-filter").relative().h(24).flex_none().px(10).gap(8).items_center()
    .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(t.ansi0, 1)))
    .child(div().relative().text_color(t.accent).child("/"))
    .child(div().relative().text_color(t.ansi5).child("where"));

  if (v.rows.filtering && input) {
    return row.child(div().relative().flex_1().border(1).border_color(t.accent).px(6).child(Input.new(input).text_size(11).text_color(t.foreground)))
      .child(div().relative().text_color(t.dim).child("enter apply · esc"));
  }

  return row.child(div().id("rows-filter-text").relative().flex_1().truncate().cursor_pointer().text_color(now ? t.foreground : t.dim)
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
      openFilter(v);
      cx.notify();
    })
    .child(now || "every row · / to filter"))
    .when(Boolean(now), (el) => el.child(chip(t, "rows-filter-clear", "✕ clear", false, (cx) => {
      const b = v.rows.browse;

      if (!b) return;

      v.rows.browse = { ...b, filter: "", offset: 0 };
      void loadRows(v, cx);
    })));
}

/** The pager under the Rows grid: which rows, of how many, ‹ ›. */
function pager(t: Theme, v: DbView): Element {
  const b = v.rows.browse;
  const n = v.rows.set?.rows.length ?? 0;

  if (!b) return div();

  const from = n ? b.offset + 1 : 0;
  const total = v.rows.total;
  const more = n >= b.limit;

  const page = (by: number, cx: Context) => {
    v.rows.browse = { ...b, offset: Math.max(0, b.offset + by * b.limit) };
    void loadRows(v, cx);
  };

  return h_flex().id("rows-pager").h(22).flex_none().px(10).gap(10).items_center().text_color(t.dim)
    .child(div().child(`rows ${count(from)}–${count(b.offset + n)}${total !== null ? ` of ${count(total)}` : more ? " of more" : ""}`))
    .when(v.rows.busy, (el) => el.child(pip(t.working, 6, true)))
    .child(div().flex_1())
    .when(Boolean(b.sort), (el) => el.child(div().child(`sorted by ${b.sort?.column ?? ""} ${b.sort?.desc ? "↓" : "↑"}`)))
    .child(chip(t, "rows-prev", "‹", false, (cx) => page(-1, cx), b.offset > 0 ? t.foreground : t.ansi0))
    .child(chip(t, "rows-next", "›", false, (cx) => page(1, cx), more ? t.foreground : t.ansi0));
}

function rowsBody(t: Theme, v: DbView, active: boolean): Element {
  if (!v.active) return empty(t, "Nothing open", "[1] connect · [2] pick a table · ctrl-n a query", 8);

  const b = v.rows.browse;

  if (!b) return empty(t, "Pick a table", "in [2]: enter shows its rows here, its structure in [3]", 6);

  const set = v.rows.set;

  const body = v.rows.error ? empty(t, "It didn't answer", v.rows.error, 1)
    : !set ? empty(t, "reading…", null, null)
    : !set.rows.length ? empty(t, b.filter ? "No row matches" : "No rows", b.filter ? `where ${b.filter}` : null, null)
    : grid(t, { id: "rows-grid", width: v.gridSize.width, height: v.gridSize.height, active, sort: b.sort, types: v.columnTypes(), overlay: overlayOf(v, set) }, set, colsOf(set), v.rows.at, handlers(v, null));

  const changes = changesBar(t, v);

  return v_flex().size_full().child(filterLine(t, v)).child(gridBox(t, v, "rows-box", body)).when(changes !== null, (el) => (changes ? el.child(changes) : el)).child(pager(t, v));
}

/** The line between a query's editor and its result: how it went. */
function resultHead(t: Theme, v: DbView, q: QueryTab): Element {
  const head = h_flex().id("result-head").relative().h(22).flex_none().px(10).gap(10).items_center()
    .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)));

  const o = q.outcome;

  if (q.running) {
    return head.child(pip(t.working, 6, true)).child(div().text_color(t.working).child("running…"))
      .child(div().flex_1()).child(chip(t, "result-cancel", "esc  cancel", false, (cx) => void cancelQuery(v, q, cx), t.blocked));
  }

  if (!o) return head.child(div().text_color(t.dim).child("ctrl-enter runs the statement under the caret (or the selection) · ctrl-shift-enter every one"));

  const r = o.results[q.shown];
  const said = resultWords(r, (q.verdicts[r?.index ?? 0] ?? "read") !== "read");
  const sets = o.results.length > 1 ? o.results.map((x, i) => chip(t, `result-${i}`, String(x.index + 1), i === q.shown, () => { q.shown = i; })) : [];

  return head
    .when(Boolean(r), (el) => el.child(div().text_color(t.done).child(`✓ ${said}`)))
    .when(o.cut, (el) => el.child(div().text_color(t.ansi3).child("cut: the first rows only")))
    .when(o.error !== null, (el) => el.child(div().flex_shrink(1).min_w(0).truncate().text_color(t.blocked)
      .child(`✕ ${o.error?.message ?? ""}${o.error?.line ? ` · line ${o.error.line}${o.error.col ? `, col ${o.error.col}` : ""}` : ""}${o.error?.hint ? ` · ${o.error.hint}` : ""}`)))
    .child(div().flex_1())
    .children(sets)
    .child(div().text_color(t.dim).child(`${q.ms ?? 0} ms`));
}

function queryBody(t: Theme, v: DbView, q: QueryTab, active: boolean): Element {
  const o = q.outcome;
  const set = o?.results[q.shown]?.set ?? null;
  const split = editorDivider(v.queryBox);
  const edH = v.dividers.size(split);

  const result = !o || q.running ? div().flex_1()
    : set && set.columns.length ? grid(t, { id: `q${q.id}-grid`, width: v.gridSize.width, height: v.gridSize.height, active: active && q.inResults, sort: null, types: set.types }, set, colsOf(set), q.at, handlers(v, q))
    : empty(t, o.error ? "Nothing to show: it stopped at the error" : "No rows", o.error ? "the error is underlined in the statement above; fix it and run it again" : null, null);

  return v_flex().size_full()
    .on_size_change((drawn, cx) => {
      const h = unzoom(drawn.height);

      if (Math.abs(h - v.queryBox) > 1) {
        v.queryBox = h;
        cx.notify();
      }
    })
    .child(div().id(`q${q.id}-editor`).relative().h(edH).flex_none().pl(2).text_size(12)
      .on_mouse_down("left", (_e, cx) => {
        q.inResults = false;
        v.panel = "main";
        q.editor.focus();
        cx.notify();
      })
      .child(Editor.new(q.editor).size_full()))
    .child(divider(t, `q${q.id}-split`, split, v.dividers, 0))
    .child(resultHead(t, v, q))
    .child(gridBox(t, v, `q${q.id}-box`, result));
}

/** The main view's right label: what's shown and how to run. */
function mainRight(t: Theme, v: DbView, q: QueryTab | null): Element {
  if (q) return div().text_color(t.dim).child(q.running ? "running · esc cancels" : `${v.active?.name ?? "not connected"} · ctrl-enter run`);

  const b = v.rows.browse;
  const n = counted(liveEdits(v)).cells;
  const name = div().text_color(t.dim).child(b ? `${b.table.schema ? `${b.table.schema}.` : ""}${b.table.name}` : "");

  return n ? h_flex().gap(6).items_center().child(name).child(div().text_color(t.ansi3).child(`· ${changesWord(n)}`)) : name;
}

/** [0] the main view. */
export function mainPanel(t: Theme, v: DbView): Element {
  const active = v.panel === "main";
  const q = v.shownQuery();
  const tabs: (readonly [string, string])[] = [["0", "Rows"], ...v.queries.map((x, i) => [String(i + 1), x.name] as const), ["+", "+"]];

  const pick = (key: string, cx: Context) => {
    if (key === "+") v.addQuery("", cx);
    else {
      v.mainTab = Number(key);
      v.panel = "main";
      v.focusShown();
    }
  };

  const body = q ? queryBody(t, v, q, active) : rowsBody(t, v, active);

  return panel(t, "p-main", titleTabs(t, "main", PANEL_KEY.main, tabs, String(v.mainTab), active, pick), active, body, {
    right: mainRight(t, v, q),
    onPress: () => v.setPanel("main"),
  });
}
