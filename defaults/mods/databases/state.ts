// The Databases view's shapes: what it's opened with (props: a window's
// overlay, a pane's slot, folder and machine, a connection sent by another
// mod), its panels and tabs, the shared notes it writes (the window's beat for
// nocturne's toggle, the one-shot handover when it moves between a window and
// a pane), and the things a panel holds (a query tab, a page of rows, an ask).

import type { Pt } from "./menu-place.ts";
import type { EditorState, InputState } from "gpui-base";
import type { Guarded } from "./guard.ts";
import { isBoolean, isNumber, isString, literal, nullable, object, sharedKey } from "./guard.ts";
import type { Conn, Kind } from "./kinds.ts";
import { isKind } from "./kinds.ts";
import { isKubeForward, isKubeSource } from "./kube.ts";
import type { Browse, DbInfo, Here, Structure, TableRef } from "./catalog.ts";
import type { Outcome, ResultSet } from "./parse-out.ts";
import type { Risk, Verdict } from "./safety.ts";
import type { HistoryEntry } from "./store.ts";
import type { SaveStatement } from "./save-sql.ts";
import type { ColumnLayout, LocalSort } from "./columns.ts";

export const MOD = "databases";

/** What another mod sends to open a connection here (databases.connect, nocturne.databases:{…}):
 *  never a secret; `from` says who sent it; `secret` where a cluster keeps the password, `forward`
 *  the port-forward it came from (kube.ts). */
export const isConnectArgs = object({ kind: isKind }, {
  name: isString, host: isString, port: isNumber, database: isString, user: isString, path: isString, url: isString, readonly: isBoolean, from: isString,
  secret: isKubeSource, forward: isKubeForward,
});

export type ConnectArgs = Guarded<typeof isConnectArgs>;

/** What the view is opened with. A window has `overlay`; a pane has `slot`. */
export const isDbProps = object({}, {
  overlay: isString, slot: isString, folder: nullable(isString), on: nullable(isString), connect: isConnectArgs, at: isNumber,
});

export type DbProps = Guarded<typeof isDbProps>;

/** The panels: 1 Connections, 2 Tables, 3 Structure, 0 the main view, 4 the log. */
export type PanelId = "conns" | "tables" | "structure" | "main" | "log";

export const PANELS: readonly PanelId[] = ["conns", "tables", "structure", "main", "log"];

/** Each panel's number (its key) and name. */
export const PANEL_KEY = { conns: "1", tables: "2", structure: "3", main: "0", log: "4" } as const satisfies { readonly [P in PanelId]: string };

export const PANEL_NAME = { conns: "Connections", tables: "Tables", structure: "Structure", main: "Rows", log: "Log" } as const satisfies { readonly [P in PanelId]: string };

/** The Tables panel's tabs: "databases" lists the server's databases (a pick connects to it). */
export type TablesTab = "tables" | "views" | "schemas" | "databases";

export const TABLES_TABS: readonly TablesTab[] = ["tables", "views", "schemas", "databases"];

/** A kind's tabs in [2]: Postgres' schemas live inside a database, so it has both; a MySQL
 *  database is its schema (one tab); a SQLite file has no other database. */
export function tablesTabsOf(kind: Kind): readonly TablesTab[] {
  if (kind === "postgres") return ["tables", "views", "schemas", "databases"];

  return kind === "mysql" ? ["tables", "views", "databases"] : ["tables", "views", "schemas"];
}

/** The Structure panel's tabs; "value" is the picked cell's whole value. */
export type StructTab = "columns" | "indexes" | "keys" | "value";

export const STRUCT_TABS: readonly StructTab[] = ["columns", "indexes", "keys", "value"];

/** A grid's cursor and how far it's scrolled (rows, columns). */
export interface GridAt {
  row: number;
  col: number;
  top: number;
  left: number;
  /** Where a range of cells starts (shift + arrows, a drag, the row numbers, cmd-a); the cursor
   *  is its other corner. None: the cursor's cell alone. */
  anchor?: { readonly row: number; readonly col: number } | null;
}

export const gridStart = (): GridAt => ({ row: 0, col: 0, top: 0, left: 0 });

/** The Rows tab: the table shown, its page, sort and filter, what was read. */
export interface Rows {
  browse: Browse | null;
  set: ResultSet | null;
  /** Rows in the table (or matching the filter), when known. */
  total: number | null;
  error: string | null;
  busy: boolean;
  /** Whose busy it is (a read clears only its own). */
  by?: number;
  at: GridAt;
  /** The filter line: open while typing a WHERE clause. */
  filtering: boolean;
}

/** A query tab: its editor, what its last run answered, which result is shown, how it ran. */
export interface QueryTab {
  readonly id: number;
  name: string;
  readonly editor: EditorState;
  outcome: Outcome | null;
  /** The shown result: an index into outcome.results. */
  shown: number;
  /** A run going on: its nonce (for cancel), and when it started. */
  running: { readonly nonce: string | null; readonly at: number } | null;
  ms: number | null;
  /** The keyboard is in the results, not the editor. */
  inResults: boolean;
  at: GridAt;
  /** The editor's text when the run started (an error's place is in that text). */
  ranText: string;
  /** What each statement of the last run could change (a read says its rows, a write its changes). */
  verdicts: readonly Risk[];
  /** Its result's columns as arranged (widths, hidden, order) and its local sort (columns.ts). */
  layout: ColumnLayout;
  sort: LocalSort | null;
}

/** What a run asks before it goes: the verdict, and for a destructive one the name typed. */
/** What a key is to the window: taken (true: claimed, the window's own), "typing" (the focused
 *  field's: left unclaimed, or GPUI counts it handled and the field never gets its character),
 *  or not taken (false). */
export type Taken = boolean | "typing";

export interface Ask {
  readonly verdict: Verdict;
  readonly text: string;
  /** 1: y / enter; 2 (destructive): the name typed into `input`. */
  step: 1 | 2;
  readonly input: InputState | null;
  readonly go: () => void;
}

/** A cell being edited in the Rows grid: where, its input, and whether it stands for NULL (an
 *  empty input is '' unless it does). */
export interface CellEdit {
  readonly row: number;
  readonly col: number;
  readonly column: string;
  readonly input: InputState;
  isNull: boolean;
}

/** The save's review: the statements it will run, how it's going, where it stopped. */
export interface Review {
  readonly statements: readonly SaveStatement[];
  readonly table: string;
  readonly cells: number;
  busy: boolean;
  error: { readonly index: number | null; readonly message: string } | null;
  /** What waits for the save (leaving the table, closing), or null. */
  readonly after: (() => void) | null;
}

/** A row of a menu (a right-click, the connection switcher, history): what it says, its key, what it does. */
export interface MenuRow {
  readonly label: string;
  readonly sub?: string;
  /** The key that does the same where the menu was opened (keys.ts keyOf: never typed by hand). */
  readonly key?: string;
  /** The action that key names (a test holds the two together). */
  readonly act?: string;
  readonly danger?: boolean;
  readonly go: () => void;
}

/** A menu over the view: at the press (a right click: its point in the view, layout px), else at what
 *  the keys are on (the grid's cursor cell, found as it's drawn), else in the middle (menu-place.ts). */
export interface Menu {
  readonly title: string;
  readonly rows: readonly MenuRow[];
  at: number;
  readonly near?: Pt | null;
}

/** A query tab being renamed (a double click on it, its menu): the tab and the name's input. */
export interface Rename {
  readonly tab: QueryTab;
  readonly input: InputState;
}

/** A password asked for before connecting (an "ask each time" connection, a found one without it). */
export interface PasswordAsk {
  readonly conn: string;
  readonly input: InputState;
  readonly done: () => void;
}

/** The ask before a connection whose port-forward is down (forward.ts): why, what went wrong
 *  starting it, the local port it starts on, and since when it's starting. */
export interface ForwardAsk {
  readonly conn: Conn;
  /** down: nothing listens there; taken: something else answers there; gone: its pod isn't there. */
  why: "down" | "taken" | "gone";
  note: string | null;
  readonly local: number;
  starting: number | null;
}

/** How a cluster-secret connection's password read went, in words for its row and the ask. */
export interface Sourced {
  readonly ok: boolean;
  readonly text: string;
}

/** A line of the Log panel: a statement run in this window (never kept on disk: that's the history). */
export interface LogLine {
  readonly sql: string;
  readonly ok: boolean;
  readonly ms: number;
  readonly said: string;
  readonly conn: string;
  /** The client run: its program and arguments (nothing secret in them), where it came from, its exit. */
  readonly run?: string | undefined;
}

/** A note at the right of the key bar. */
export interface Note {
  readonly text: string;
  readonly tone: "working" | "done" | "failed";
  readonly at: number;
}

export const noteOf = (text: string, tone: Note["tone"]): Note => ({ text, tone, at: Date.now() });

/** The connection's catalog as read. */
export interface Catalog {
  tables: TableRef[];
  error: string | null;
  busy: boolean;
  /** Where the connection landed, as the server said it with the tables (null: not yet, SQLite). */
  here?: Here | null;
  /** Whose busy it is (a read clears only its own). */
  by?: number;
}

/** The server's databases, as last read for a connection (on demand: the Databases tab, b, an
 *  empty database's words). */
export interface ServerDbs {
  readonly conn: string;
  list: DbInfo[];
  busy: boolean;
  error: string | null;
  /** The sizes were asked for (Postgres reads each database's files for them). */
  sized: boolean;
}

/** Whether the active connection answers: its last answer (ok), or the failure that ended it;
 *  `since` when it first answered, `at` its latest answer (a read, a check). */
export interface Alive {
  readonly conn: string;
  ok: boolean;
  since: number;
  at: number;
  why: string | null;
}

/** The structure of the picked table. */
export interface Struct {
  table: TableRef | null;
  data: Structure | null;
  busy: boolean;
  error: string | null;
}

/** A client found for a kind: its path, or why there is none. */
/** A kind's client: where it was found (the folder's direnv environment or the app's PATH), or
 *  what to install. */
export type ClientFound = { readonly path: string; readonly from: "folder" | "app" } | { readonly missing: string };

/** The window's note that it's open (nocturne's toggle reads it). */
export const WINDOW_KEY = sharedKey("databases.window", nullable(object({ id: isString }, { beat: isNumber })));

/** The one-shot handover when the view moves between a window and a pane: where it was. */
export const HANDOVER_KEY = sharedKey("databases.handover", nullable(object({ at: isNumber }, {
  folder: nullable(isString), conn: isString, panel: literal("conns", "tables", "structure", "main", "log"), table: isString, query: isNumber,
})));

export type Handover = NonNullable<Guarded<typeof HANDOVER_KEY.guard>>;

/** What a pane keeps in localStorage (per slot): where it was. */
export const isKeptCopy = object({}, { conn: isString, panel: literal("conns", "tables", "structure", "main", "log"), table: isString, query: isNumber });

export type KeptCopy = Guarded<typeof isKeptCopy>;

/** How long a handover note is good for. */
export const HANDOVER_FRESH = 5000;

/** History rows as the menu lists them. */
export type History = readonly HistoryEntry[];
