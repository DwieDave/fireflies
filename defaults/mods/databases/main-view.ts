// The main view, drawn: its tabs cut into the panel's edge (Rows, a tab per
// query, + for a new one; a right click their menu, a double click renames, a
// drag reorders), the Rows tab (the WHERE line and the ORDER BY the statement
// has, the grid, the pager) and a query tab (the SQL editor over its result:
// the grid, a sort of what came back said as such, the error with its place,
// a run going on with its cancel). The grids' pointer work is handlers().

import { div } from "gpui-kit";
import type { Context, Element } from "gpui-kit";
import { h_flex, v_flex, Input, Editor } from "gpui-base";
import type { Theme } from "herdr";
import type { QueryTab } from "./state.ts";
import { PANEL_KEY } from "./state.ts";
import type { TabMore } from "./kit.ts";
import { chip, dither, empty, panel, pip, titleTabs, unzoom, unzoomSize } from "./kit.ts";
import { divider } from "./dividers.ts";
import { editorDivider } from "./layout.ts";
import { colWidth, grid } from "./grid.ts";
import type { GridHandlers, GridOverlay } from "./grid.ts";
import { changeAt, changesWord, counted, rowChanged } from "./edits.ts";
import { editableNow, liveEdits, settleEdit, startEdit } from "./cell-edit.ts";
import { changesBar } from "./review.ts";
import type { GridNow } from "./act-grid.ts";
import { filterTo, fitColumn, moveTo, openFilter, setLocalSort, setSort, showColumns, shownGrid, showValue, sortColumn } from "./act-grid.ts";
import { atPointer, cellMenu, columnMenu, rowMenu, startRename, tabMenu } from "./menus.ts";
import { loadRows } from "./session.ts";
import { cancelQuery } from "./query.ts";
import { count } from "./panels.ts";
import { resultWords } from "./parse-out.ts";
import { orderSql, quoteName } from "./catalog.ts";
import { setWidth } from "./columns.ts";
import { hasRange, inRange, rangeOf, rowsSelected, stretched, wholeRows } from "./select.ts";
import { dropTarget, pressAt } from "./press.ts";
import { insertName } from "./actions.ts";
import type { default as DbView } from "./main.ts";

/** The grid's handlers for the shown grid (the Rows tab's or a query's). */
function handlers(t: Theme, v: DbView, q: QueryTab | null): GridHandlers {
  const now = () => shownGrid(v);

  const put = (row: number, col: number) => {
    const g = now();

    if (g) g.put({ ...g.at, row, col, anchor: null });
  };

  const focus = () => {
    v.panel = "main";

    if (q) q.inResults = true;

    v.focusSelf();
  };

  const cellOf = (key: string) => /^cell:(\d+):(\d+)$/.exec(key);

  return {
    pick: (row, col, shift, e) => {
      if (!q) settleEdit(v);

      const g = now();

      if (g && shift) g.put(stretched(g.at, row, col));
      else {
        put(row, col);
        // A drag from here selects the cells it passes over.
        pressAt(v, e, {
          kind: "cells", takes: ["cell:"],
          over: (to) => {
            const m = cellOf(to);
            const x = now();

            if (m && x) x.put({ ...x.at, anchor: { row, col }, row: Number(m[1]), col: Number(m[2]) });
          },
        });
      }

      focus();
    },
    // A double click edits a table's cell; anything else shows its whole value.
    open: (row, col) => {
      if (!q) settleEdit(v);

      put(row, col);

      if (q || "why" in editableNow(v) || !startEdit(v)) showValue(v);
    },
    // A right click inside the selection keeps it (its menu copies it).
    menu: (row, col, cx) => {
      const g = now();

      if (!g || !hasRange(g.at) || !inRange(rangeOf(g.at), row, col)) put(row, col);

      focus();
      atPointer(v, () => cellMenu(v, row, col, cx));
    },
    head: (col, edge, e, cx) => {
      const g = now();
      const c = g?.cols[col];

      if (!g || !c) return;

      focus();

      // Its right edge: the width dragged, or fitted back by a double click.
      if (edge) {
        if (e.click_count >= 2) {
          fitColumn(g, col);

          return;
        }

        const from = colWidth(c);

        pressAt(v, e, {
          kind: "width", takes: [],
          move: (dx) => {
            const x = now();

            x?.arrange(setWidth(x.layout, c.name, from + dx), false);
          },
          drop: () => {
            const x = now();

            x?.arrange(x.layout, true);
          },
        });

        return;
      }

      const name = g.set.columns[col] ?? "";
      const kind = v.active?.kind ?? "sqlite";

      // A click sorts; dragged, it moves the column (or its name goes into a query).
      pressAt(v, e, {
        kind: "column", label: name, takes: ["col:", "editor:"],
        click: (x) => sortColumn(v, name, x),
        drop: (to, x) => {
          const at = /^col:(\d+)$/.exec(to ?? "");
          const g2 = now();

          if (at && g2) {
            const target = Number(at[1]);

            // Dropped on a header: it takes that header's place (after it when moving right).
            moveTo(g2, col, col < target ? (target + 1 < g2.set.columns.length ? target + 1 : null) : target);
          } else if (to?.startsWith("editor:")) insertName(v, quoteName(kind, name), x);
        },
      });
      void cx;
    },
    headMenu: (col, cx) => {
      focus();
      atPointer(v, () => columnMenu(v, col, cx));
    },
    gutter: (row, shift, e) => {
      const g = now();

      if (!g) return;

      if (!q) settleEdit(v);

      const r = rangeOf(g.at);
      const from = shift ? (hasRange(g.at) && wholeRows(r, g.set.columns.length) ? g.at.anchor?.row ?? g.at.row : g.at.row) : row;

      g.put(rowsSelected(g.at, g.set, from, row));
      focus();

      if (!shift) {
        pressAt(v, e, {
          kind: "rows", takes: ["row:"],
          over: (to) => {
            const m = /^row:(\d+)$/.exec(to);
            const x = now();

            if (m && x) x.put(rowsSelected(x.at, x.set, row, Number(m[1])));
          },
        });
      }
    },
    gutterMenu: (row, cx) => {
      focus();
      atPointer(v, () => rowMenu(v, row, cx));
    },
    scroll: (by, across, cx) => v.scrollGrid(by, across, cx),
    target: (el, key) => dropTarget(t, el, v, key, key.startsWith("col:")),
  };
}

/** What editing lays over the Rows grid: the staged changes, the rows with some, the edited cell
 *  (the grid's columns are the shown ones; the changes are kept by the rows as read). */
function overlayOf(v: DbView, g: GridNow): GridOverlay {
  const e = liveEdits(v);

  return {
    change: (r, c) => changeAt(e, g.raw, r, g.set.columns[c] ?? ""),
    marked: (r) => rowChanged(e, g.raw, r),
    editing: v.cellEdit,
  };
}

/** A Rows header's hover: its name, type, key, nullability and default (from the structure). */
function headerTips(v: DbView, g: GridNow): string[] {
  const s = v.struct.data;

  return g.set.columns.map((name) => {
    const c = s?.columns.find((x) => x.name === name);

    if (!c) return name;

    return [name, c.type, c.pk ? "primary key" : "", c.nullable ? "" : "not null", c.default !== null ? `default ${c.default}` : ""].filter(Boolean).join(" · ");
  });
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

/** The ORDER BY the page's statement has, as it says it (a click: its column's menu). */
function orderPart(t: Theme, v: DbView): Element | null {
  const b = v.rows.browse;

  if (!b?.sort) return null;

  const sort = b.sort;

  return h_flex().id("rows-order").relative().flex_none().gap(6).items_center().tooltip("the database sorts the rows: this is in the statement the window runs · s on a column, or click its header")
    .child(div().text_color(t.ansi5).child("order by"))
    .child(div().text_color(t.foreground).child(orderSql(v.active?.kind ?? "sqlite", sort).replace(/^order by /, "")))
    .child(chip(t, "rows-order-clear", "✕", false, (cx) => setSort(v, null, cx)));
}

/** The WHERE line over the Rows grid: the input while typing, else the filter as it is; the
 *  ORDER BY after it. */
function filterLine(t: Theme, v: DbView): Element {
  const input = v.filterInput;
  const now = v.rows.browse?.filter ?? "";
  const order = orderPart(t, v);

  const row = h_flex().id("rows-filter").relative().h(24).flex_none().px(10).gap(8).items_center()
    .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(t.ansi0, 1)))
    .child(div().relative().text_color(t.accent).child("/"))
    .child(div().relative().text_color(t.ansi5).child("where"));

  if (v.rows.filtering && input) {
    return row.child(div().relative().flex_1().border(1).border_color(t.accent).px(6).child(Input.new(input).text_size(11).text_color(t.foreground)))
      .child(div().relative().text_color(t.dim).child("enter apply · esc"))
      .when(order !== null, (el) => (order ? el.child(order) : el));
  }

  return row.child(div().id("rows-filter-text").relative().flex_1().truncate().cursor_pointer().text_color(now ? t.foreground : t.dim)
    .tooltip("/ · a WHERE clause, read by the database")
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();
      openFilter(v);
      cx.notify();
    })
    .child(now || "every row · / to filter"))
    .when(Boolean(now), (el) => el.child(h_flex().id("rows-filter-clear-tip").relative().flex_none().tooltip("every row again · T: the tab's menu").child(chip(t, "rows-filter-clear", "✕ clear", false, (cx) => filterTo(v, "", cx)))))
    .when(order !== null, (el) => (order ? el.child(order) : el));
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
    .map((el) => {
      const g = shownGrid(v);
      const hidden = g?.shown.hidden ?? 0;

      return g && hidden ? el.child(h_flex().id("rows-hidden-tip").flex_none().tooltip("O on a column: its menu hides or shows").child(chip(t, "rows-hidden", `${hidden} hidden · show`, false, () => showColumns(g)))) : el;
    })
    .child(h_flex().id("rows-prev-tip").flex_none().tooltip("previous page · <").child(chip(t, "rows-prev", "‹", false, (cx) => page(-1, cx), b.offset > 0 ? t.foreground : t.ansi0)))
    .child(h_flex().id("rows-next-tip").flex_none().tooltip("next page · >").child(chip(t, "rows-next", "›", false, (cx) => page(1, cx), more ? t.foreground : t.ansi0)));
}

function rowsBody(t: Theme, v: DbView, active: boolean): Element {
  if (!v.active) return empty(t, "Nothing open", "[1] connect · [2] pick a table · ctrl-n a query", 8);

  const b = v.rows.browse;

  if (!b) return empty(t, "Pick a table", "in [2]: enter shows its rows here, its structure in [3]", 6);

  const set = v.rows.set;
  const g = shownGrid(v);
  const types = v.columnTypes();

  const body = v.rows.error ? empty(t, "It didn't answer", v.rows.error, 1)
    : !set || !g ? empty(t, "reading…", null, null)
    : !set.rows.length ? empty(t, b.filter ? "No row matches" : "No rows", b.filter ? `where ${b.filter}` : null, null)
    : grid(t, {
      id: "rows-grid", width: v.gridSize.width, height: v.gridSize.height, active, sort: b.sort,
      types: types ? g.shown.cols.map((c) => types[c] ?? "") : undefined, tips: headerTips(v, g), overlay: overlayOf(v, g),
    }, g.set, g.cols, g.at, handlers(t, v, null));

  const changes = changesBar(t, v);

  return v_flex().size_full().child(filterLine(t, v)).child(dropTarget(t, gridBox(t, v, "rows-box", body), v, "tab:0")).when(changes !== null, (el) => (changes ? el.child(changes) : el)).child(pager(t, v));
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
  const sets = o.results.length > 1 ? o.results.map((x, i) => h_flex().id(`result-${i}-tip`).flex_none().tooltip("statement's result · < > step through them").child(chip(t, `result-${i}`, String(x.index + 1), i === q.shown, () => { q.shown = i; }))) : [];

  const sort = q.sort;

  return head
    .when(Boolean(r), (el) => el.child(div().text_color(t.done).child(`✓ ${said}`)))
    // A sort of what came back, said as such: the database's order isn't this.
    .when(sort !== null, (el) => el.child(h_flex().id("result-sort").flex_none().gap(4).items_center()
      .tooltip("sorted in the window, not by the database: only the rows that came back · s again, or ✕, for the order they came in")
      .child(div().text_color(t.ansi5).child(`sorted here by ${sort?.column ?? ""} ${sort?.desc ? "↓" : "↑"}`))
      .child(chip(t, "result-sort-clear", "✕", false, () => setLocalSort(v, q, null)))))
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
  const g = shownGrid(v);
  const split = editorDivider(v.queryBox);
  const edH = v.dividers.size(split);

  const result = !o || q.running ? div().flex_1()
    : set && set.columns.length && g ? grid(t, { id: `q${q.id}-grid`, width: v.gridSize.width, height: v.gridSize.height, active: active && q.inResults, sort: q.sort, types: g.set.types }, g.set, g.cols, g.at, handlers(t, v, q))
    : empty(t, o.error ? "Nothing to show: it stopped at the error" : "No rows", o.error ? "the error is underlined in the statement above; fix it and run it again" : null, null);

  return v_flex().size_full()
    .on_size_change((drawn, cx) => {
      const h = unzoom(drawn.height);

      if (Math.abs(h - v.queryBox) > 1) {
        v.queryBox = h;
        cx.notify();
      }
    })
    // The editor takes a table's or column's name dropped on it (at its caret, quoted).
    .child(dropTarget(t, div().id(`q${q.id}-editor`).relative().h(edH).flex_none().pl(2).text_size(12)
      .on_mouse_down("left", (_e, cx) => {
        q.inResults = false;
        v.panel = "main";
        q.editor.focus();
        cx.notify();
      })
      .child(Editor.new(q.editor).size_full()), v, `editor:${q.id}`))
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

/** Query tab `from` (1-based) moved to the place of tab `to` (0: first), the shown tab with it. */
export function moveQuery(v: DbView, from: number, to: RegExpExecArray | null): void {
  const q = v.queries[from - 1];

  if (!q || !to) return;

  const at = Math.max(0, Number(to[1]) - 1);
  const list = v.queries.filter((x) => x !== q);

  list.splice(Math.min(at, list.length), 0, q);
  v.queries = list;
  v.mainTab = list.indexOf(q) + 1;
  v.queriesDirty = true;
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

  const more: TabMore = {
    // A query tab drags to another place; dropped on Rows, it goes first.
    press: (key, e) => {
      const n = Number(key);
      const tab = v.queries[n - 1];

      if (tab) pressAt(v, e, { kind: "tab", label: tab.name, takes: ["tab:"], drop: (to) => moveQuery(v, n, /^tab:(\d+)$/.exec(to ?? "")) });
    },
    open: (key) => {
      const tab = v.queries[Number(key) - 1];

      if (tab) startRename(v, tab);
    },
    menu: (key, cx) => {
      if (key !== "+") atPointer(v, () => tabMenu(v, Number(key), cx));
    },
    dress: (key, el) => (key === "+" ? el : dropTarget(t, el, v, `tab:${key}`)),
    tip: (key) => (key === "+" ? "new query tab · ctrl-n" : key === "0" ? "the table's rows · drop a table here to open it · T: its menu" : "double click: rename · drag: another place · T: its menu"),
  };

  return panel(t, "p-main", titleTabs(t, "main", PANEL_KEY.main, tabs, String(v.mainTab), active, pick, more), active, body, {
    right: mainRight(t, v, q),
    onPress: () => v.setPanel("main"),
  });
}
