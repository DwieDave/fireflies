// Editing the Rows grid's cells: an edit starts on the cursor's cell (c, a
// double click) as an input holding its value; enter keeps it, esc drops it,
// tab / shift-tab keep it and edit the next / previous cell, ctrl-n makes it
// NULL (again: a text). A kept value is staged, not written (edits.ts): N
// stages NULL, u undoes the cursor's cell, U discards every change. w (and
// cmd-s, ctrl-s) opens the review of the statements a save runs (save-sql.ts)
// and y runs them in one transaction; an error keeps every change staged.
// Leaving the table, reading it again or closing the window with changes
// staged asks first: save, discard or stay.

import type { Context, KeyEvent } from "gpui-kit";
import { InputState } from "gpui-base";
import type { Editability, GridFacts } from "./edits.ts";
import { cellRefusal, changeAt, changesWord, counted, editability, noEdits, shownCell, stage, unstage } from "./edits.ts";
import { refusal, typeOf } from "./quote.ts";
import { saveError, saveStatements } from "./save-sql.ts";
import type { SaveStatement } from "./save-sql.ts";
import type { CellEdit, Taken } from "./state.ts";
import type { ColumnInfo } from "./catalog.ts";
import { rawCol, shownGrid } from "./act-grid.ts";
import { moveGrid, rowsIn } from "./grid.ts";
import { loadRows, needsPassword, runOn } from "./session.ts";
import { openMenu } from "./menus.ts";
import type { default as DbView } from "./main.ts";

/** The facts the Rows grid's editability is worked out from. */
export function gridFacts(v: DbView): GridFacts {
  const c = v.active;
  const b = v.rows.browse;
  const t = b ? v.catalog.tables.find((x) => x.name === b.table.name && x.schema === b.table.schema) ?? null : null;
  const columns = b && v.struct.data && v.struct.table?.name === b.table.name && v.struct.table.schema === b.table.schema ? v.struct.data.columns : null;

  return {
    kind: c?.kind ?? "sqlite", connName: c?.name ?? "", readonly: c?.readonly ?? false, grid: v.shownQuery() ? "results" : "rows",
    browse: b, table: t, columns, set: v.rows.set,
  };
}

/** Whether the shown grid's rows can be edited now. */
export const editableNow = (v: DbView): Editability => (v.active ? editability(gridFacts(v)) : { why: "connect first" });

/** The changes staged on the shown table (null when there are none, or they're another table's). */
export function liveEdits(v: DbView): DbView["edits"] {
  const e = v.edits;
  const b = v.rows.browse;

  return e && b && v.active?.id === e.conn && e.table.name === b.table.name && e.table.schema === b.table.schema ? e : null;
}

/** The cursor's cell: why it can't be edited, or its column and value. */
function cursorCell(v: DbView): { readonly why: string } | { readonly column: string; readonly value: string | null; readonly keyCols: readonly string[] } {
  const e = editableNow(v);
  const set = v.rows.set;

  if ("why" in e || !set) return { why: "why" in e ? e.why : "no rows to edit" };

  // The cursor is on a shown column (some may be hidden or moved): its name and place as read.
  const g = shownGrid(v);
  const column = g?.set.columns[v.rows.at.col] ?? "";
  const value = shownCell(liveEdits(v), set, v.rows.at.row, g ? rawCol(g, v.rows.at.col) : v.rows.at.col);
  const why = cellRefusal(e, gridFacts(v).columns, column, value);

  return why ? { why } : { column, value, keyCols: e.keyCols };
}

/** c, a double click: the cursor's cell becomes an input holding its value. */
export function startEdit(v: DbView): boolean {
  const cell = cursorCell(v);

  if ("why" in cell) {
    v.say(cell.why, "failed");

    return false;
  }

  const input = InputState.new({ placeholder: "NULL", value: cell.value ?? "" });
  const edit: CellEdit = { row: v.rows.at.row, col: v.rows.at.col, column: cell.column, input, isNull: cell.value === null };

  input.on("change", () => {
    if (input.value() !== "") edit.isNull = false;
  });
  v.cellEdit = edit;
  v.panel = "main";
  input.focus();

  return true;
}

/** The column as the structure has it (its declared type, whether it takes NULL). */
const columnOf = (v: DbView, column: string): ColumnInfo | undefined => gridFacts(v).columns?.find((x) => x.name === column);

/** A value staged on a shown cell (the edits made for this table when there are none yet). */
function stageCell(v: DbView, row: number, column: string, value: string | null): string | null {
  const set = v.rows.set;
  const c = v.active;
  const b = v.rows.browse;
  const e = editableNow(v);

  if (!set || !c || !b || "why" in e) return "why" in e ? e.why : "no rows to edit";

  const col = columnOf(v, column);
  const why = value === null && col?.nullable === false ? "it can't be NULL (NOT NULL)" : refusal(value, typeOf(col?.type ?? ""));

  if (why) return `${column}: ${why}`;

  v.edits = stage(liveEdits(v) ?? noEdits(c.id, b.table, e.keyCols), set, row, column, value);

  return null;
}

/** enter: the input's value staged; false (and said) when the column can't take it. */
export function keepEdit(v: DbView): boolean {
  const edit = v.cellEdit;

  if (!edit) return true;

  const why = stageCell(v, edit.row, edit.column, edit.isNull && edit.input.value() === "" ? null : edit.input.value());

  if (why) {
    v.say(why, "failed");

    return false;
  }

  v.cellEdit = null;
  v.focusSelf();

  return true;
}

/** esc: the input goes, nothing staged. */
export function dropEdit(v: DbView): void {
  v.cellEdit = null;
  v.focusSelf();
}

/** The rows are read again: an edit going on is kept if it can be, else dropped. */
export function settleEdit(v: DbView): void {
  if (v.cellEdit && !keepEdit(v)) dropEdit(v);
}

/** tab / shift-tab: kept, then the next (previous) cell that can be edited, wrapping to the next row. */
export function nextEdit(v: DbView, by: 1 | -1): void {
  const g = shownGrid(v);
  const set = g?.set;

  if (!g || !set || !keepEdit(v)) return;

  const width = set.columns.length;

  for (let i = 1; i < width * 2; i++) {
    const flat = v.rows.at.row * width + v.rows.at.col + by;

    if (flat < 0 || flat >= set.rows.length * width) return;

    const row = Math.floor(flat / width);

    v.rows.at = moveGrid(v.rows.at, set, g.cols, row - v.rows.at.row, (flat % width) - v.rows.at.col, rowsIn(v.gridSize.height), v.gridSize.width);

    if (!("why" in cursorCell(v))) {
      startEdit(v);

      return;
    }
  }
}

/** A key while a cell is edited: the input has typed it; the edit's own keys act here. Every key
 *  stays with the edit (q types a q). */
export function editKey(v: DbView, e: KeyEvent): Taken {
  const edit = v.cellEdit;

  if (!edit) return false;

  const m = e.modifiers;

  if (e.key === "enter") keepEdit(v);
  else if (e.key === "escape") dropEdit(v);
  else if (e.key === "tab") nextEdit(v, m.shift ? -1 : 1);
  else if (m.control && e.key === "n") toggleNull(v);
  else return "typing";

  return true;
}

/** ctrl-n while editing: the cell stands for NULL (the input emptied), or again for a text. */
export function toggleNull(v: DbView): void {
  const edit = v.cellEdit;

  if (!edit) return;

  edit.isNull = !edit.isNull;

  if (edit.isNull) edit.input.set_value("");

  edit.input.focus();
}

/** databases.set:<text>: the edited cell's input holds `text`; with none edited, the cursor's
 *  cell is staged as `text` (as typed: its column's checks apply). */
export function setCell(v: DbView, text: string): void {
  const edit = v.cellEdit;

  if (edit) {
    edit.input.set_value(text);
    edit.isNull = false;

    return;
  }

  const cell = cursorCell(v);
  const why = "why" in cell ? cell.why : stageCell(v, v.rows.at.row, cell.column, text);

  if (why) v.say(why, "failed");
}

/** N: the cursor's cell staged as NULL. */
export function stageNull(v: DbView): void {
  const cell = cursorCell(v);
  const why = "why" in cell ? cell.why : stageCell(v, v.rows.at.row, cell.column, null);

  if (why) v.say(why, "failed");
}

/** u: the cursor's cell back to what was read. */
export function undoCell(v: DbView): void {
  const e = liveEdits(v);
  const set = v.rows.set;
  const column = shownGrid(v)?.set.columns[v.rows.at.col] ?? "";

  if (!e || !set || !changeAt(e, set, v.rows.at.row, column)) {
    v.say("no change on this cell", "failed");

    return;
  }

  v.edits = unstage(e, set, v.rows.at.row, column);
  v.say(`${column} back to what was read`, "done");
}

/** U: every change discarded, after asking. */
export function discardAll(v: DbView): void {
  const n = counted(v.edits).cells;

  if (!n) {
    v.say("no changes to discard", "failed");

    return;
  }

  openMenu(v, `Discard ${changesWord(n)} to ${v.edits?.table.name ?? "the table"}?`, [
    { label: "Discard them", sub: "the rows go back to what was read", key: "d", danger: true, go: () => { v.edits = null; v.say(`discarded ${changesWord(n)}`, "done"); } },
    { label: "Keep them", key: "esc", go: () => {} },
  ]);
}

/** w, cmd-s: the review of what a save runs (a kept edit first). `then` runs once it's saved. */
export function openReview(v: DbView, then: (() => void) | null = null): void {
  const c = v.active;
  const e = v.edits;

  if (v.cellEdit && !keepEdit(v)) return;

  if (!c || !e || !counted(e).cells) {
    v.say("nothing to save: c changes a cell", "failed");

    return;
  }

  if (c.readonly) {
    v.say(`${c.name} is read only: nothing is saved`, "failed");

    return;
  }

  const types = new Map((v.struct.table?.name === e.table.name ? v.struct.data?.columns ?? [] : []).map((x) => [x.name, x.type] as const));
  const built = saveStatements({ kind: c.kind, bind: c.kind === "libsql" && Boolean(c.url), types }, e);

  if ("refused" in built) {
    v.say(built.refused, "failed");

    return;
  }

  v.review = { statements: built.statements, table: e.table.name, cells: counted(e).cells, busy: false, error: null, after: then };
}

/** y in the review: the statements run; saved, the rows are read again and the marks go. */
export function runSave(v: DbView, cx: Context): void {
  const r = v.review;
  const c = v.active;

  if (!r || r.busy || !c) return;

  const go = () => void save(v, r.statements, cx);

  if (needsPassword(v, c)) v.askPassword(c, false, cx, go);
  else go();
}

async function save(v: DbView, statements: readonly SaveStatement[], cx: Context): Promise<void> {
  const r = v.review;
  const c = v.active;

  if (!r || !c) return;

  r.busy = true;
  r.error = null;
  cx.notify();

  const o = await runOn(v, c, statements);
  const failed = saveError(statements, o);

  r.busy = false;

  for (const s of statements.filter((x) => x.role === "update")) v.logLine({ sql: s.text, ok: !failed, ms: o.ms, said: failed ? "rolled back" : "saved", conn: c.name });

  if (failed) {
    r.error = { index: o.error?.index ?? null, message: failed };
    v.say(failed, "failed");
    cx.notify();

    return;
  }

  v.review = null;
  v.edits = null;
  v.say(`saved ${changesWord(r.cells)} to ${r.table}`, "done");
  void loadRows(v, cx, true);
  r.after?.();
  cx.notify();
}

/** Before leaving the table (another table, another connection, reading again, closing): with
 *  changes staged, ask (save first, discard, or stay); else go on. */
export function beforeLeaving(v: DbView, what: string, then: () => void): void {
  settleEdit(v);

  const n = counted(v.edits).cells;

  if (!n) {
    then();

    return;
  }

  openMenu(v, `${changesWord(n)} to ${v.edits?.table.name ?? "the table"} aren't saved`, [
    { label: `Save them, then ${what}`, sub: "the review shows the statements first", key: "w", go: () => openReview(v, then) },
    { label: `Discard them and ${what}`, key: "d", danger: true, go: () => { v.edits = null; then(); } },
    { label: "Stay", key: "esc", go: () => {} },
  ]);
}
