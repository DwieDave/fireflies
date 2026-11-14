// The Databases window's keys, lazygit's way: one table per place (the
// window, each panel, the grids, the log), read by the key handler (actionFor)
// and by the ? overview and the key bar, so what's listed is what's handled.
// What each action does is actions.ts's.

import type { KeyEvent } from "gpui-kit";
import type { KeySection } from "./keyhelp.ts";

/** Where a key is read: the window (always), or what has the keyboard. */
export type Place = "window" | "conns" | "tables" | "structure" | "rows" | "results" | "editor" | "log";

/** A binding: the keys (as keyName says them), what it does, the action. */
export type Binding = readonly [keys: readonly string[], what: string, action: string];

const WINDOW: readonly Binding[] = [
  [["1"], "connections", "panel-conns"], [["2"], "tables", "panel-tables"], [["3"], "structure", "panel-structure"],
  [["0"], "rows / queries", "panel-main"], [["4"], "log", "panel-log"],
  [["tab"], "next panel", "panel-next"], [["shift-tab"], "previous panel", "panel-prev"],
  [["ctrl-n"], "new query tab", "query-new"], [["ctrl-h"], "history", "history"],
  [["r"], "read again", "refresh"], [["b"], "the server's databases (a click on the head's database too)", "databases"],
  [["C"], "the connection's menu (a click on the head's mark too)", "conn-menu"], [["ctrl-t"], "into a pane / out to a window", "move"],
  [["+", "="], "grow the panel (drag a gap; double click: back)", "grow"], [["-"], "shrink the panel", "shrink"],
  [["w", "cmd-s", "ctrl-s"], "save the changes (the statements shown first)", "save"], [["U"], "discard every change", "discard"],
  [["q"], "close", "close"], [["?"], "keys", "help"],
];

const CONNS: readonly Binding[] = [
  [["j", "down"], "down", "down"], [["k", "up"], "up", "up"], [["enter"], "connect (a double click too)", "connect"],
  [["x"], "disconnect", "disconnect"], [["n"], "new connection", "conn-new"], [["e"], "edit", "conn-edit"],
  [["D"], "duplicate", "conn-duplicate"], [["d"], "remove", "conn-remove"],
  [["P"], "pin / unpin (every Databases window lists a pinned one)", "conn-pin"], [["s"], "pin a found or sent one", "conn-save"],
  [["t"], "test", "conn-test"], [["y"], "copy its address (never a password)", "copy"],
  [["J"], "move it down (or drag it)", "conn-down"], [["K"], "move it up", "conn-up"], [["m"], "menu (a right click too)", "menu"],
];

const TABLES: readonly Binding[] = [
  [["j", "down"], "down", "down"], [["k", "up"], "up", "up"], [["enter"], "rows and structure (a double click too; in Databases: connect to it)", "open"],
  [["["], "tables / views / schemas / databases", "subtab-prev"], [["]"], "tables / views / schemas / databases", "subtab-next"],
  [["s"], "select it in a query", "table-query"], [["i"], "its name into the query (or drag it there)", "insert"],
  [["/"], "find a table", "table-find"], [["y"], "copy its name", "copy"], [["e"], "export", "export"],
  [["#"], "count its rows exactly (the list shows the server's estimate); databases: their sizes", "count"], [["m"], "menu (a right click too)", "menu"],
];

const STRUCTURE: readonly Binding[] = [
  [["j", "down"], "down", "down"], [["k", "up"], "up", "up"],
  [["["], "columns / indexes / keys / value", "subtab-prev"], [["]"], "columns / indexes / keys / value", "subtab-next"],
  [["enter"], "a key's table, or the name into the query", "open"], [["i"], "the name into the query (or drag it there)", "insert"],
  [["y"], "copy", "copy"], [["m"], "menu (a right click too)", "menu"],
];

const GRID: readonly Binding[] = [
  [["h", "left"], "left", "left"], [["l", "right"], "right", "right"], [["j", "down"], "down", "down"], [["k", "up"], "up", "up"],
  [["g"], "first row", "first"], [["G"], "last row", "last"],
  [["shift-left"], "select: stretch left (or drag across cells)", "select-left"], [["shift-right"], "select: stretch right", "select-right"],
  [["shift-down"], "select: stretch down", "select-down"], [["shift-up"], "select: stretch up", "select-up"],
  [["V"], "select the row (or click its number)", "select-row"], [["cmd-a"], "select every cell", "select-all"], [["escape"], "drop the selection", "unselect"],
  [["enter", "v"], "the cell's whole value", "value"],
  [["y", "cmd-c"], "copy the cell (a selection as TSV)", "copy"], [["Y"], "copy the row", "copy-row"], [["e"], "export", "export"],
  [["}"], "the column wider (or drag its header's edge)", "wider"], [["{"], "the column narrower", "narrower"], [["H"], "hide the column", "hide"],
  [["m"], "the cell's menu (a right click too)", "menu"], [["O"], "the column's menu (a right click on its header)", "column-menu"], [["T"], "the tab's menu", "tab-menu"],
];

const ROWS: readonly Binding[] = [
  ...GRID, [["c"], "change the cell (a double click too)", "cell-edit"], [["N"], "the cell to NULL", "cell-null"], [["u"], "undo the cell's change", "cell-undo"],
  [["o", "s"], "sort by the column (ORDER BY: ↑, ↓, off; or click its header)", "sort"], [["/"], "filter (a WHERE clause)", "filter"],
  [[">"], "next page", "page-next"], [["<"], "previous page", "page-prev"], [["["], "previous tab", "tab-prev"], [["]"], "next tab", "tab-next"],
];

const RESULTS: readonly Binding[] = [
  ...GRID, [["c"], "change the cell (a table's rows only)", "cell-edit"], [["o", "s"], "sort what came back (↑, ↓, off; or click a header)", "sort"],
  [["i", "escape"], "back to the editor", "edit"], [[">"], "next result", "result-next"], [["<"], "previous result", "result-prev"],
  [["["], "previous tab", "tab-prev"], [["]"], "next tab", "tab-next"], [["x"], "close the tab", "query-close"],
];

/** The editor's own keys (it takes them before the window: query.ts editorKey). */
const EDITOR: readonly Binding[] = [
  [["ctrl-enter", "cmd-enter"], "run the statement (or the selection)", "run"], [["ctrl-shift-enter", "cmd-shift-enter"], "run every statement", "run-all"],
  [["escape"], "to the results (cancels a run)", "results"], [["ctrl-h"], "history", "history"], [["ctrl-n"], "new query tab", "query-new"],
];

const LOG: readonly Binding[] = [
  [["j", "down"], "down", "down"], [["k", "up"], "up", "up"], [["enter"], "into a query tab (a double click too)", "open"], [["y"], "copy the statement", "copy"],
  [["m"], "menu (a right click too)", "menu"],
];

export const BINDINGS = { window: WINDOW, conns: CONNS, tables: TABLES, structure: STRUCTURE, rows: ROWS, results: RESULTS, editor: EDITOR, log: LOG } as const satisfies { readonly [P in Place]: readonly Binding[] };

/** A key's name as the tables write it: "j", "G", "enter", "ctrl-n", "shift-tab", "?". */
export function keyName(e: KeyEvent): string {
  const m = e.modifiers;
  const c = e.key_char;
  const printable = c && c.length === 1 && c.trim() && !m.platform && !m.control && !m.alt;

  if (printable) return c;

  const mods = [m.control ? "ctrl" : "", m.platform ? "cmd" : "", m.alt ? "alt" : "", m.shift ? "shift" : ""].filter(Boolean);

  return [...mods, e.key].join("-");
}

/** The first key of an action in a place (its own table, then the window's), as the menus and the
 *  key bar show it; undefined when no key does it. */
export function keyOf(place: Place, action: string): string | undefined {
  const b = BINDINGS[place].find(([, , a]) => a === action) ?? BINDINGS.window.find(([, , a]) => a === action);

  return b ? shown(b[0][0] ?? "") : undefined;
}

/** The action a key names in a place (its own table first, then the window's), or null. */
export function actionFor(place: Place, key: string): string | null {
  return actionsFor(place, key)[0] ?? null;
}

/** Every action a key names in a place, in the order they're tried (esc in a result: drop the
 *  selection, else back to the editor). */
export function actionsFor(place: Place, key: string): string[] {
  return [...BINDINGS[place], ...BINDINGS.window].flatMap(([keys, , a]) => (keys.includes(key) ? [a] : []));
}

const PLACE_NAME = {
  window: "window", conns: "connections", tables: "tables", structure: "structure", rows: "rows", results: "results", editor: "query editor", log: "log",
} as const satisfies { readonly [P in Place]: string };

/** A key as the overview writes it (escape as esc, arrows as arrows). */
const ARROWS: readonly (readonly [string, string])[] = [["left", "←"], ["right", "→"], ["up", "↑"], ["down", "↓"]];

export const shown = (k: string): string => (k === "escape" ? "esc" : k.replace(/\b(left|right|up|down)$/, (m) => ARROWS.find(([n]) => n === m)?.[1] ?? m));

/** The ? overview: the place's keys, then the window's. */
export function helpSections(place: Place): KeySection[] {
  const rows = (list: readonly Binding[]) => list.map(([keys, what]) => [keys.map(shown).join(" "), what] as const);

  return [{ title: PLACE_NAME[place], keys: rows(BINDINGS[place]) }, { title: "window", keys: rows(BINDINGS.window) }];
}

/** The actions the key bar names, per place. */
const BAR = {
  window: [], conns: ["connect", "conn-new", "conn-edit", "conn-test", "menu"], tables: ["open", "table-query", "insert", "export", "menu"],
  structure: ["subtab-next", "open", "insert", "menu"], rows: ["cell-edit", "sort", "filter", "page-next", "menu", "column-menu"],
  results: ["edit", "copy", "sort", "menu", "column-menu"], editor: ["run", "run-all", "results", "history"], log: ["open", "copy", "menu"],
} as const satisfies { readonly [P in Place]: readonly string[] };

/** The key bar's few entries for a place. */
export function barHints(place: Place): (readonly [string, string])[] {
  return BAR[place].flatMap((a) => {
    const b = BINDINGS[place].find(([, , x]) => x === a);

    return b ? [[shown(b[0][0] ?? ""), b[1].split(" (")[0] ?? b[1]] as const] : [];
  });
}
