// The Databases view's shapes: what it's opened with (props: a window's
// overlay, a pane's slot, folder and machine, a connection sent by another
// mod), its panels and tabs, the shared notes it writes (the window's beat for
// nocturne's toggle, the one-shot handover when it moves between a window and
// a pane), and the things a panel holds (a query tab, a page of rows, an ask).

import type { EditorState, InputState } from "gpui-base";
import type { Guarded } from "./guard.ts";
import { isBoolean, isNumber, isString, literal, nullable, object, sharedKey } from "./guard.ts";
import type { Kind } from "./kinds.ts";
import { isKind } from "./kinds.ts";
import type { Browse, Structure, TableRef } from "./catalog.ts";
import type { Outcome, ResultSet } from "./parse-out.ts";
import type { Verdict } from "./safety.ts";
import type { HistoryEntry } from "./store.ts";

export const MOD = "databases";

/** What another mod sends to open a connection here (databases.connect, nocturne.databases:{…}):
 *  never a secret; `from` says who sent it. */
export const isConnectArgs = object({ kind: isKind }, {
  name: isString, host: isString, port: isNumber, database: isString, user: isString, path: isString, url: isString, readonly: isBoolean, from: isString,
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

/** The Tables panel's tabs. */
export type TablesTab = "tables" | "views" | "schemas";

export const TABLES_TABS: readonly TablesTab[] = ["tables", "views", "schemas"];

/** The Structure panel's tabs; "value" is the picked cell's whole value. */
export type StructTab = "columns" | "indexes" | "keys" | "value";

export const STRUCT_TABS: readonly StructTab[] = ["columns", "indexes", "keys", "value"];

/** A grid's cursor and how far it's scrolled (rows, columns). */
export interface GridAt {
  row: number;
  col: number;
  top: number;
  left: number;
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
}

/** What a run asks before it goes: the verdict, and for a destructive one the name typed. */
export interface Ask {
  readonly verdict: Verdict;
  readonly text: string;
  /** 1: y / enter; 2 (destructive): the name typed into `input`. */
  step: 1 | 2;
  readonly input: InputState | null;
  readonly go: () => void;
}

/** A row of a menu (a right-click, the connection switcher, history): what it says, its key, what it does. */
export interface MenuRow {
  readonly label: string;
  readonly sub?: string;
  readonly key?: string;
  readonly danger?: boolean;
  readonly go: () => void;
}

/** A menu over the body. */
export interface Menu {
  readonly title: string;
  readonly rows: readonly MenuRow[];
  at: number;
}

/** A password asked for before connecting (an "ask each time" connection, a found one without it). */
export interface PasswordAsk {
  readonly conn: string;
  readonly input: InputState;
  readonly done: () => void;
}

/** A line of the Log panel: a statement run in this window (never kept on disk: that's the history). */
export interface LogLine {
  readonly sql: string;
  readonly ok: boolean;
  readonly ms: number;
  readonly said: string;
  readonly conn: string;
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
}

/** The structure of the picked table. */
export interface Struct {
  table: TableRef | null;
  data: Structure | null;
  busy: boolean;
  error: string | null;
}

/** A client found for a kind: its path, or why there is none. */
export type ClientFound = { readonly path: string } | { readonly missing: string };

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

/** A kind's word for its schemas (MySQL's are databases). */
export const schemaWord = (kind: Kind): string => (kind === "mysql" ? "databases" : "schemas");

/** History rows as the menu lists them. */
export type History = readonly HistoryEntry[];
