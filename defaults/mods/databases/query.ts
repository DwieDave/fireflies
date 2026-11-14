// The query tabs: an SQL editor each (gpui-kit's EditorState, language sql,
// the editor mod's colours), and running what's in it: the selection, else
// the statement under the caret, else (run all) every statement, in one
// session. Before it runs: a read-only connection refuses a write, a write
// asks once, a destructive statement twice (the name typed). After: the
// result under the editor, the error underlined where the client says, a line
// in the Log, an entry in the connection's history.

import type { Context, KeyEvent } from "gpui-kit";
import { EditorState, InputState } from "gpui-base";
import { settings, theme } from "herdr";
import type { Conn } from "./kinds.ts";
import type { Statement } from "./split.ts";
import { splitStatements, statementAt } from "./split.ts";
import type { Verdict } from "./safety.ts";
import { allowedReadOnly, asks, classify, worst } from "./safety.ts";
import type { Ran } from "./session.ts";
import { IO, dataHome, needsPassword, runOn } from "./session.ts";
import { cancel } from "./runner.ts";
import { closest, namedIn, resultWords } from "./parse-out.ts";
import { addHistory } from "./store.ts";
import type { HistoryEntry } from "./store.ts";
import type { QueryTab } from "./state.ts";
import { gridStart, noteOf } from "./state.ts";
import { selectionColor, syntaxColors } from "./kit.ts";
import { NO_LAYOUT } from "./columns.ts";
import type { default as DbView } from "./main.ts";

/** A place in the editor (0-based line, UTF-16 column). */
interface Pos {
  readonly line: number;
  readonly col: number;
}

/** A 0-based place as an offset into `text`. */
export function offsetOf(text: string, p: Pos): number {
  let at = 0;

  for (let l = 0; l < p.line; l++) {
    const nl = text.indexOf("\n", at);

    if (nl < 0) return text.length;

    at = nl + 1;
  }

  return Math.min(text.length, at + p.col);
}

/** An offset as a 0-based place. */
export function posOf(text: string, offset: number): Pos {
  const before = text.slice(0, offset);
  const nl = before.lastIndexOf("\n");

  return { line: before.split("\n").length - 1, col: offset - nl - 1 };
}

let ids = 0;

/** A new query tab, its editor wired to the window's keys (ctrl-enter runs before the editor types). */
export function newQuery(v: DbView, text = ""): QueryTab {
  const t = theme();

  const editor = EditorState.new({
    language: "sql", value: text, font_family: settings().font_family || "JetBrains Mono", font_size: 13,
    line_numbers: true, folding: false, soft_wrap: false, syntax: syntaxColors(t), selection: selectionColor(t),
  });

  ids += 1;

  const tab: QueryTab = { id: ids, name: `Query ${ids}`, editor, outcome: null, shown: 0, running: null, ms: null, inResults: false, at: gridStart(), ranText: "", verdicts: [], layout: NO_LAYOUT, sort: null };

  editor.on("key", (e, cx) => editorKey(v, tab, e, cx));
  editor.on("change", () => {
    v.queriesDirty = true;
  });

  return tab;
}

/** What a key in the editor does before the editor sees it: run (⌘/ctrl-enter, with shift every
 *  statement), cancel or leave (esc), history (ctrl-h), new tab (ctrl-n). Else the editor's. */
export function editorKey(v: DbView, tab: QueryTab, e: KeyEvent, cx: Context): boolean {
  const m = e.modifiers;
  const mod = m.control || m.platform;

  if (e.key === "enter" && mod) {
    runQuery(v, tab, m.shift, cx);
  } else if (e.key === "escape") {
    if (tab.running) void cancelQuery(v, tab, cx);
    else {
      tab.inResults = true;
      v.focusSelf();
    }
  } else if (m.control && e.key === "h") v.openHistory(cx);
  else if (m.control && e.key === "n") v.addQuery("", cx);
  else return false;

  cx.notify();

  return true;
}

/** The statements a run takes: the selection's, else the one under the caret, else (all) every one. */
export function pickStatements(tab: QueryTab, kind: Conn["kind"], all: boolean): Statement[] {
  const text = tab.editor.value();
  const sel = tab.editor.selection();

  if (sel.text.trim()) {
    const base = offsetOf(text, sel.start);
    const lineBase = sel.start.line;

    return splitStatements(sel.text, kind).map((s) => ({ ...s, start: s.start + base, end: s.end + base, line: s.line + lineBase }));
  }

  const list = splitStatements(text, kind);

  if (all) return list;

  const at = statementAt(list, text, offsetOf(text, tab.editor.cursor()));

  return at ? [at] : [];
}

/** The words of an ask (and for a destructive one, what to type). */
function askText(c: Conn, v: Verdict, count: number): string {
  const what = `${v.verb}${v.target ? ` ${v.target}` : ""}`;
  const more = count > 1 ? ` (and ${count - 1} more)` : "";

  const said = v.risk === "destructive" ? `${what}${more} on ${c.name}? It can't be undone.` : `Run ${what}${more} on ${c.name}?`;

  return said.charAt(0).toUpperCase() + said.slice(1);
}

/** Runs the tab's statements, after the asks. */
export function runQuery(v: DbView, tab: QueryTab, all: boolean, cx: Context): void {
  const c = v.active;

  if (!c) {
    v.say("connect first: pick a connection in [1] and press enter", "failed");

    return;
  }

  if (tab.running) return;

  const list = pickStatements(tab, c.kind, all);

  if (!list.length) {
    v.say("nothing to run here", "failed");

    return;
  }

  const verdicts = list.map((s) => classify(s.text, c.kind));
  const w = worst(verdicts);

  if (c.readonly && !verdicts.every(allowedReadOnly)) {
    v.say(`${c.name} is read only: ${w.verb} is refused here (e on the connection to change that)`, "failed");

    return;
  }

  const go = () => {
    if (needsPassword(v, c)) v.askPassword(c, false, cx, () => void execute(v, tab, c, list, verdicts, cx));
    else void execute(v, tab, c, list, verdicts, cx);
  };

  if (!asks(w)) {
    go();

    return;
  }

  v.ask = { verdict: w, text: askText(c, w, list.length), step: 1, input: w.risk === "destructive" ? InputState.new({ placeholder: w.target ?? "yes" }) : null, go };
}

/** Runs them (asked already) and shows the answer. */
async function execute(v: DbView, tab: QueryTab, c: Conn, list: readonly Statement[], verdicts: readonly Verdict[], cx: Context): Promise<void> {
  tab.running = { nonce: null, at: Date.now() };
  tab.ranText = tab.editor.value();
  tab.editor.set_diagnostics([]);
  cx.notify();

  const o = await runOn(v, c, list.map((s, i) => ({ text: s.text, risk: verdicts[i]?.risk ?? "write" })), (nonce) => {
    tab.running = { nonce, at: tab.running?.at ?? Date.now() };
  });

  tab.running = null;
  tab.outcome = withSuggestion(v, o);
  tab.ms = o.ms;
  tab.at = gridStart();

  // The last statement that returned rows, else the last one.
  const withRows = o.results.reduce((last, r, i) => (r.set !== null && r.set.columns.length > 0 ? i : last), -1);

  tab.shown = withRows >= 0 ? withRows : Math.max(0, o.results.length - 1);
  tab.inResults = false;
  placeError(tab, list, o);
  record(v, c, list, verdicts, o);
  tab.verdicts = verdicts.map((x) => x.risk);

  // A statement that changed the schema: read the tables again.
  if (verdicts.some((x) => x.risk !== "read" && x.risk !== "session") && !o.error) v.refreshCatalog(cx);

  cx.notify();
}

/** A missing table's error with the nearest table named ("did you mean lanterns?"). */
function withSuggestion(v: DbView, o: Ran): Ran {
  const e = o.error;
  const name = e && !e.hint ? namedIn(e.message) : null;
  const near = name ? closest(name, v.catalog.tables.map((t) => t.name)) : null;

  return e && near ? { ...o, error: { ...e, hint: `did you mean ${near}?` } } : o;
}

/** Underlines the error where the client says (its statement's first line when it doesn't). */
function placeError(tab: QueryTab, list: readonly Statement[], o: Ran): void {
  const e = o.error;
  const s = e && e.index !== null ? list[e.index] : null;

  if (!e || !s) return;

  const start = posOf(tab.ranText, s.start);
  const line = start.line + (e.line ?? 1) - 1;
  const col = e.col === null ? 0 : (e.line ?? 1) === 1 ? start.col + e.col - 1 : e.col - 1;
  const end = e.col === null ? 999 : col + 1;

  tab.editor.set_diagnostics([{ line, col, end_line: line, end_col: end, severity: "error", message: e.message, source: "database" }]);
}

/** The Log panel's lines and the history's entries for a run. */
function record(v: DbView, c: Conn, list: readonly Statement[], verdicts: readonly Verdict[], o: Ran): void {
  list.forEach((s, i) => {
    const r = o.results.find((x) => x.index === i);
    const failed = o.error?.index === i;

    if (!r && !failed) return;

    const rows = r?.set ? r.set.rows.length : null;
    const writes = verdicts[i]?.risk !== "read";
    const said = failed ? o.error?.message ?? "" : resultWords(r, writes);

    v.logLine({ sql: s.text, ok: !failed, ms: o.ms, said, conn: c.name });

    if (c.origin === "saved") {
      const entry: HistoryEntry = rows === null ? { sql: s.text, at: Date.now(), ms: o.ms, ok: !failed } : { sql: s.text, at: Date.now(), ms: o.ms, ok: !failed, rows };

      void addHistory(IO, dataHome(), c.id, entry).then((h) => {
        if (v.active?.id === c.id) v.history = h;
      });
    }
  });

  if (o.error && o.error.index === null) v.logLine({ sql: list.map((s) => s.text).join("; "), ok: false, ms: o.ms, said: o.error.message, conn: c.name });
}

/** Stops the tab's run. */
export async function cancelQuery(v: DbView, tab: QueryTab, cx: Context): Promise<void> {
  const n = tab.running?.nonce;
  const dir = v.dir;

  if (!n || !dir) return;

  v.note = noteOf("cancelling…", "working");
  cx.notify();
  await cancel(IO, dir, n);
}

/** The text of a query tab after an insert at its caret (a table or column name). */
export function insertAtCaret(tab: QueryTab, text: string): void {
  const p = tab.editor.cursor();

  tab.editor.edit([{ start: p, end: p, text }]);
  tab.editor.set_cursor(p.line, p.col + text.length);
}
