// What editing cells draws outside the grid: the changes bar over the Rows
// pager (how many changes are staged and the keys that save, undo and discard
// them, or, while a cell is edited, the edit's own keys), and the save's
// review over the body (the exact statements it runs, one block per changed
// row with its key, the guard after each, where a failed save stopped). Staged
// is moonfly yellow (ansi3), the tone the write-ask already has.

import { div } from "gpui-kit";
import type { Color, Context, Element, KeyEvent } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import type { Theme } from "herdr";
import { chip, dither, pip, popupScrim, stop } from "./kit.ts";
import { changeAt, changesWord, counted } from "./edits.ts";
import type { SaveStatement } from "./save-sql.ts";
import { discardAll, dropEdit, keepEdit, liveEdits, nextEdit, openReview, runSave, toggleNull, undoCell } from "./cell-edit.ts";
import { shownGrid } from "./act-grid.ts";
import type { default as DbView } from "./main.ts";

/** A key and what it does, as one click target. */
function action(t: Theme, id: string, key: string, what: string, go: (cx: Context) => void, lit = false): Element {
  return chip(t, id, h_flex().gap(5).items_center().child(div().text_color(t.accent).child(key)).child(div().text_color(lit ? t.foreground : t.muted).child(what)), lit, go);
}

/** The bar over the pager: the changes staged and their keys, or the edit's keys. */
export function changesBar(t: Theme, v: DbView): Element | null {
  const edit = v.cellEdit;
  const e = liveEdits(v);
  const n = counted(e);

  if (!edit && !n.cells) return null;

  const set = v.rows.set;
  const onChange = Boolean(e && set && changeAt(e, set, v.rows.at.row, shownGrid(v)?.set.columns[v.rows.at.col] ?? ""));

  const bar = h_flex().id("rows-changes").relative().h(24).flex_none().px(10).gap(6).items_center().text_size(11)
    .child(div().absolute().inset_0().child(dither(`${t.ansi3}30`, 1)))
    .child(div().absolute().left(0).right(0).top(0).h(1).bg(`${t.ansi3}66`))
    .child(pip(t.ansi3, 6).relative());

  if (edit) {
    return bar.child(div().relative().text_color(t.ansi3).child(`editing ${edit.column} · row ${edit.row + 1}`))
      .child(div().relative().flex_1())
      .child(action(t, "edit-keep", "enter", "keep", () => keepEdit(v)))
      .child(action(t, "edit-next", "tab", "next", () => nextEdit(v, 1)))
      .child(action(t, "edit-null", "ctrl-n", "NULL", () => toggleNull(v), edit.isNull))
      .child(action(t, "edit-drop", "esc", "drop", () => dropEdit(v)));
  }

  return bar.child(div().relative().text_color(t.ansi3).child(`${changesWord(n.cells)}${n.rows > 1 ? ` in ${n.rows} rows` : ""} · not saved`))
    .child(div().relative().flex_1())
    .child(action(t, "changes-save", "w", "save…", () => openReview(v)))
    .when(onChange, (el) => el.child(action(t, "changes-undo", "u", "undo cell", () => undoCell(v))))
    .child(action(t, "changes-discard", "U", "discard all", () => discardAll(v)));
}

const KEYWORDS = new Set(["update", "set", "where", "and", "is", "null", "begin", "commit", "start", "transaction", "select", "cast", "as", "text", "char", "case", "when", "then", "end", "if", "true", "false"]);

/** A statement in tokens: quoted texts and names kept whole. */
const TOKENS = /(_utf8mb4 X'[0-9A-F]*'|E?'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\s+|[A-Za-z_][A-Za-z0-9_$@.]*|-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|:[A-Z_]+|.)/g;

/** A token's colour: keywords violet, texts green-yellow, names cyan, numbers yellow. */
function tokenColor(t: Theme, tok: string): Color {
  if (/^(E?'|_utf8mb4)/.test(tok)) return t.ansi11;

  if (/^["`]/.test(tok)) return t.ansi6;

  if (/^-?\d/.test(tok) || tok.startsWith(":")) return t.ansi3;

  if (KEYWORDS.has(tok.toLowerCase())) return t.ansi5;

  return t.foreground;
}

/** A statement as lines: a new line before SET, WHERE and AND (outside its texts), the words lined up. */
export function statementLines(sql: string): string[][] {
  const lines: string[][] = [[]];

  for (const tok of sql.match(TOKENS) ?? []) {
    const word = tok.toUpperCase();
    const breaks = word === "SET" || word === "WHERE" || word === "AND";
    const line = lines.at(-1) ?? [];

    if (breaks && line.length) {
      while (line.length && /^\s+$/.test(line.at(-1) ?? "")) line.pop();

      lines.push([word === "WHERE" ? " " : word === "SET" ? "   " : "   ", tok]);
    } else line.push(tok);
  }

  return lines;
}

function sqlBlock(t: Theme, id: string, sql: string, dim: boolean): Element {
  return v_flex().id(id).children(statementLines(sql).map((toks, i) => h_flex().id(`${id}-${i}`)
    .children(toks.map((tok) => div().flex_none().text_color(dim ? t.dim : tokenColor(t, tok)).child(tok.replace(/ /g, " "))))));
}

/** One statement of the review: its key above an UPDATE, the guard under it, BEGIN and COMMIT plain. */
function reviewRow(t: Theme, s: SaveStatement, i: number, failed: boolean, error: string): Element {
  const block = v_flex().id(`review-${i}`).relative().gap(2);

  if (s.role === "update") {
    return block.pt(6)
      .child(h_flex().gap(6).text_size(10).text_color(failed ? t.ansi1 : t.ansi8).child(div().child(failed ? "✕" : String(s.row + 1))).child(div().child(s.where)))
      .child(div().pl(14).child(sqlBlock(t, `review-sql-${i}`, s.text, false)))
      .when(failed, (el) => el.child(div().pl(14).text_color(t.ansi1).child(error)));
  }

  if (s.role === "guard") {
    return block.pl(14)
      .child(h_flex().gap(6).text_size(10).text_color(failed ? t.ansi1 : t.dim).child(div().child("↳")).child(div().child(failed ? error : "then this stops the save if no row changed:")))
      .child(div().pl(14).text_size(10).child(sqlBlock(t, `review-guard-${i}`, s.text, true)));
  }

  return block.child(div().text_color(failed ? t.ansi1 : t.ansi5).child(failed ? `${s.text}  ✕ ${error}` : s.text));
}

/** The save's review over the body: the statements, then y commit · esc back. */
export function reviewPanel(t: Theme, v: DbView): Element {
  const r = v.review;

  if (!r) return div();

  const rowsChanged = new Set(r.statements.filter((s) => s.role === "update").map((s) => s.row)).size;
  const err = r.error;
  const where = v.active?.name ?? "the database";

  const foot = h_flex().gap(8).items_center().pt(8)
    .when(r.busy, (el) => el.child(pip(t.working, 6, true)).child(div().text_color(t.working).child("saving…")))
    .when(!r.busy && err !== null, (el) => el.child(div().flex_shrink(1).min_w(0).truncate().text_color(t.ansi1).child("nothing was saved: the changes stay staged")))
    .child(div().flex_1())
    .child(chip(t, "review-yes", err ? "y  try again" : `y  commit to ${where}`, false, (cx) => runSave(v, cx), t.ansi3))
    .child(chip(t, "review-no", "esc  back", false, () => { if (!r.busy) v.review = null; }));

  const box = v_flex().id("db-review-box").w(Math.min(760, v.size.width - 40)).max_h(Math.min(560, v.size.height - 80)).bg(t.background).border(1).border_color(t.ansi3).p(12).gap(6).text_size(11)
    .child(h_flex().gap(8).items_center().text_size(12)
      .child(pip(t.ansi3, 7))
      .child(div().text_color(t.foreground).child(`Save ${changesWord(r.cells)} to ${r.table}`))
      .child(div().text_color(t.dim).child(`${rowsChanged} row${rowsChanged === 1 ? "" : "s"} · one transaction`)))
    .child(div().text_size(10).text_color(t.dim).child("Each UPDATE finds its row by its key and checks it still holds what was read. If one changes no row or fails, nothing is saved."))
    .child(div().relative().h(2).flex_none().child(dither(t.ansi0, 1)))
    .child(v_flex().id("db-review-list").flex_1().min_h(0).overflow_y_scroll().gap(2).py(4)
      .children(r.statements.map((s, i) => reviewRow(t, s, i, err?.index === i, err?.message ?? ""))))
    .when(err !== null && (err.index === null || !r.statements[err.index]), (el) => el.child(div().text_color(t.ansi1).child(`✕ ${err?.message ?? ""}`)))
    .child(foot);

  return div().id("db-review").absolute().inset_0().flex().items_center().justify_center()
    .on_mouse_down("left", (_e, cx) => {
      cx.stop_propagation();

      if (!r.busy) v.review = null;

      cx.notify();
    })
    .child(popupScrim("db-review-scrim"))
    .child(box.relative().on_mouse_down("left", stop));
}

/** The review's keys: y / enter commit, esc / n back (not while it runs). */
export function reviewKey(v: DbView, e: KeyEvent, cx: Context): void {
  const r = v.review;

  if (!r) return;

  if (e.key === "y" || e.key === "enter") runSave(v, cx);
  else if ((e.key === "escape" || e.key === "n" || e.key === "q") && !r.busy) {
    v.review = null;
    v.focusShown();
  }
}
