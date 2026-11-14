// Nocturne Databases: MySQL / MariaDB, Postgres, SQLite and libSQL (Turso)
// in Nocturne's night look, lazygit's way (the git window's anatomy):
//
//   [1] Connections   saved, sent by another mod, found in the space's folder
//   [2] Tables        · Views · Schemas, with their row counts
//   [3] Structure     · Indexes · Keys · Value (the picked cell, whole)
//   [0] the main view: Rows (a table's page: sorted, filtered by a WHERE line,
//       paged) and one tab per query (an SQL editor over its result)
//   [4] Log           what ran in this window
//
// Keys: keys.ts (? lists them); every row, tab, header and cell is a click
// target, right-click opens a row's menu, the wheel scrolls a grid.
// Nothing runs on open; a write asks once, a destructive statement twice;
// read-only connections refuse writes (safety.ts). Secrets never leave the
// keychain or this window's memory (runner.ts, secrets.ts).
//
// A window (props.overlay, opened by nocturne.databases) or a pane (props
// .slot: pane.split { mod: "databases", props: { slot, folder, on } }); ctrl-t
// moves it between the two (opening.ts). Props: { folder?, on?, connect? }:
// `connect` (another mod's databases.connect) connects at once, not saved.

import { View, div } from "gpui-kit";
import type { AsyncContext, Context, Element, FocusHandle, KeyEvent, Size } from "gpui-kit";
import type { Props } from "gpui-shell";
import type { InputState } from "gpui-base";
import { v_flex, ScrollHandle } from "gpui-base";
import { props, theme, nextCommand, shared, setShared, closeOverlay } from "herdr";
import { readShared, writeShared } from "./guard.ts";
import { bindTab, tabActions } from "./form-keys.ts";
import type { Conn, Kind } from "./kinds.ts";
import type { Found } from "./discover.ts";
import type { TableRef } from "./catalog.ts";
import type { HistoryEntry } from "./store.ts";
import type { Ask, Catalog, CellEdit, ClientFound, DbProps, LogLine, Menu, Note, PanelId, PasswordAsk, QueryTab, Review, Rows, Struct, StructTab, TablesTab } from "./state.ts";
import type { Edits } from "./edits.ts";
import { STRUCT_TABS, TABLES_TABS, WINDOW_KEY, gridStart, isDbProps, noteOf } from "./state.ts";
import type { Place } from "./keys.ts";
import { keyName } from "./keys.ts";
import { act, setPanel } from "./actions.ts";
import { colsOf, shownGrid } from "./act-grid.ts";
import { scrollGrid } from "./grid.ts";
import { modalKey } from "./popups.ts";
import { askPassword, connect, discover } from "./conns.ts";
import { readConnections } from "./store.ts";
import { loadTables } from "./session.ts";
import { newQuery } from "./query.ts";
import { loadQueries, saveQueries } from "./queries.ts";
import { frame } from "./chrome.ts";
import type { ConnForm } from "./conn-form.ts";
import type { ExportForm } from "./export-form.ts";
import { here, start, command, handoverOut } from "./opening.ts";
import { IO, dataHome } from "./session.ts";
import { privateDir, removeDir } from "./runner.ts";
import { unzoomSize } from "./kit.ts";
import { beforeLeaving } from "./cell-edit.ts";
import { Dividers, tracking } from "./dividers.ts";
import type { Room } from "./layout.ts";
import { keepSizes, keptSizes } from "./layout.ts";

const NO_PROPS: DbProps = {};
const BEAT = 4000;

export default class Databases extends View {
  overlay: string | null = null;
  slot: string | null = null;
  folder: string | null = null;
  on: string | null = null;
  size: Size = { width: 1100, height: 720 };
  handle: FocusHandle | null = null;
  closed = false;
  beatAt = 0;

  // ---- connections
  saved: Conn[] = [];
  sent: Conn[] = [];
  found: Found[] = [];
  connAt = 0;
  active: Conn | null = null;
  /** Passwords and tokens asked for or found: this window's memory only. */
  secrets = new Map<string, string>();
  clients = new Map<Kind, ClientFound>();
  envPath: string | null = null;
  /** The private folder (0700) runs hand files over in. */
  dir: string | null = null;

  // ---- panels
  panel: PanelId = "conns";
  catalog: Catalog = { tables: [], error: null, busy: false };
  tablesTab: TablesTab = "tables";
  tableAt = 0;
  schema: string | null = null;
  tableFind: InputState | null = null;
  /** The find line has the keyboard (its typing is its own; after ↓ the list's keys are). */
  findTyping = false;
  struct: Struct = { table: null, data: null, busy: false, error: null };
  structTab: StructTab = "columns";
  structAt = 0;
  rows: Rows = { browse: null, set: null, total: null, error: null, busy: false, at: gridStart(), filtering: false };
  filterInput: InputState | null = null;
  /** The changes staged on the shown table's rows (saved by w, after the review). */
  edits: Edits | null = null;
  /** The cell being edited. */
  cellEdit: CellEdit | null = null;
  queries: QueryTab[] = [];
  /** The main view's tab: 0 the Rows, n the n-th query. */
  mainTab = 0;
  queriesDirty = false;
  log: LogLine[] = [];
  logAt = 0;
  history: HistoryEntry[] = [];

  // ---- over the body
  ask: Ask | null = null;
  review: Review | null = null;
  menu: Menu | null = null;
  password: PasswordAsk | null = null;
  form: ConnForm | null = null;
  exporting: ExportForm | null = null;
  help = false;
  note: Note | null = null;

  // ---- drawing
  /** The shown grid's box, as last measured (the keys move by its rows). */
  gridSize: Size = { width: 600, height: 300 };
  /** The body's height and a query tab's box, as last measured (the dividers' room). */
  bodyH = 664;
  queryBox = 400;
  /** The panels' dividers, their sizes kept per window or pane (layout.ts). */
  dividers = new Dividers({}, () => {});
  scrolls = { conns: ScrollHandle.new(), tables: ScrollHandle.new(), structure: ScrollHandle.new(), log: ScrollHandle.new() };
  /** Each list's cursor as last scrolled to. */
  seen = { conns: { at: -1 }, tables: { at: -1 }, structure: { at: -1 }, log: { at: -1 } };

  override init(p: Props | undefined, cx: AsyncContext): void {
    const given = props() ?? p;
    const pr = isDbProps(given) ? given : NO_PROPS;
    const h = pr.folder !== undefined ? { folder: pr.folder, on: pr.on ?? null } : here();

    this.overlay = pr.overlay ?? null;
    this.slot = pr.slot ?? null;
    this.dividers = new Dividers(keptSizes(this.overlay !== null), (sizes) => keepSizes(this.overlay !== null, sizes));
    this.folder = h.folder;
    this.on = h.on;
    this.handle = cx.focus_handle();
    bindTab(cx);
    this.handle.focus();

    // A window doesn't take the keyboard when it opens: take it, again once it's shown.
    if (this.overlay) for (const ms of [60, 250, 600]) cx.timer.after(ms, () => this.focusShown());

    this.beat();
    cx.spawn(async (cx) => {
      this.dir = await privateDir(IO);
      this.saved = await readConnections(IO, dataHome());
      await start(this, pr, cx);
      await discover(this, cx);
    });
    cx.timer.every(2000, (cx) => this.tick(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        command(this, await nextCommand(), cx);
        cx.notify();
      }
    });
  }

  /** A window's note that it's open (nocturne's toggle), renewed every few seconds. */
  beat(): void {
    if (!this.overlay) return;

    this.beatAt = Date.now();
    writeShared(setShared, WINDOW_KEY, { id: this.overlay, beat: this.beatAt });
  }

  tick(cx: Context): void {
    if (Date.now() - this.beatAt >= BEAT) this.beat();

    if (this.queriesDirty) void saveQueries(this);

    if (this.note && this.note.tone !== "working" && Date.now() - this.note.at > 6000) {
      this.note = null;
      cx.notify();
    }
  }

  override async close(): Promise<void> {
    this.closed = true;

    const w = readShared(shared, WINDOW_KEY, null);

    if (this.overlay && w?.id === this.overlay) writeShared(setShared, WINDOW_KEY, null);

    this.secrets.clear();
    await saveQueries(this);

    if (this.dir) await removeDir(IO, this.dir);
  }

  // ---- what the modules ask of the view

  /** A window closes itself; a pane never does by esc (its own × and cmd-w close it). */
  closeWindow(): void {
    const id = this.overlay;

    if (id) beforeLeaving(this, "close", () => closeOverlay(id));
  }

  /** The keyboard back to the view (or the shown query's editor). */
  focusShown(): void {
    if (this.closed || this.form || this.password || this.exporting) return;

    const q = this.shownQuery();

    if (this.panel === "main" && q && !q.inResults) q.editor.focus();
    else this.handle?.focus();
  }

  focusSelf(): void {
    this.handle?.focus();
  }

  say(text: string, tone: Note["tone"]): void {
    this.note = noteOf(text, tone);
  }

  /** The shown query tab, or null on the Rows tab. */
  shownQuery(): QueryTab | null {
    return this.mainTab > 0 ? this.queries[this.mainTab - 1] ?? null : null;
  }

  /** The room the dividers share: the view, its body inside its padding, the shown query's box. */
  room(): Room {
    return { width: this.size.width, height: this.size.height, inner: this.bodyH - 18, query: this.shownQuery() ? this.queryBox : null };
  }

  /** Where keys go now. */
  place(): Place {
    if (this.panel !== "main") return this.panel;

    const q = this.shownQuery();

    return q ? (q.inResults ? "results" : "editor") : "rows";
  }

  connected(c: Conn, ok: boolean): void {
    if (ok && this.panel === "conns" && this.active === c) this.panel = "tables";
  }

  /** A table's rows as last known (its count or the server's estimate). */
  tableRows(t: Pick<TableRef, "schema" | "name">): number | null {
    return this.catalog.tables.find((x) => x.name === t.name && x.schema === t.schema)?.rows ?? null;
  }

  refreshCatalog(cx: Context): void {
    void loadTables(this, cx);
  }

  askPassword(c: Conn, keychain: boolean, cx: Context, then?: () => void): void {
    askPassword(this, c, keychain, cx, then);
  }

  connectTo(c: Conn, cx: Context): void {
    void connect(this, c, cx);
  }

  addQuery(text: string, cx: Context): QueryTab {
    const q = newQuery(this, text);

    this.queries.push(q);
    this.mainTab = this.queries.length;
    this.panel = "main";
    this.queriesDirty = true;
    q.editor.focus();
    cx.notify();

    return q;
  }

  loadQueries(c: Conn, cx: Context): Promise<void> {
    return loadQueries(this, c, cx);
  }

  logLine(line: LogLine): void {
    this.log = [line, ...this.log].slice(0, 200);
    this.logAt = 0;
  }

  openHistory(cx: Context): void {
    act(this, "window", "history", cx);
  }

  /** An action in a place (a click's way to what a key does). */
  act(place: Place, action: string, cx: Context): boolean {
    return act(this, place, action, cx);
  }

  setPanel(p: PanelId): void {
    setPanel(this, p);
  }

  setTablesTab(key: string, _cx: Context): void {
    const tab = TABLES_TABS.find((x) => x === key);

    if (tab) this.tablesTab = tab;

    this.tableAt = 0;
    this.setPanel("tables");
  }

  setStructTab(key: string, _cx: Context): void {
    const tab = STRUCT_TABS.find((x) => x === key);

    if (tab) this.structTab = tab;

    this.structAt = 0;
    this.setPanel("structure");
  }

  /** The shown grid scrolled by the wheel. */
  scrollGrid(by: number, across: number, _cx: Context): void {
    const g = shownGrid(this);

    if (g) g.put(scrollGrid(g.at, g.set, colsOf(g.set), by, across, this.gridSize.height));
  }

  /** The Rows grid's column types, from the table's structure. */
  columnTypes(): readonly string[] | undefined {
    const set = this.rows.set;
    const s = this.struct.data;

    if (!set || !s || this.struct.table?.name !== this.rows.browse?.table.name) return undefined;

    return set.columns.map((c) => s.columns.find((x) => x.name === c)?.type ?? "");
  }

  /** Leaves for a pane or a window (ctrl-t, the ◧ / ⧉ chip). */
  move(cx: Context): void {
    beforeLeaving(this, this.overlay ? "move into a pane" : "move out to a window", () => handoverOut(this, cx));
  }

  key(e: KeyEvent, cx: Context): void {
    const taken = modalKey(this, e, cx);

    // A text field's key, left unclaimed: a claimed one never reaches the field (popups.ts).
    if (taken === "typing") return;

    if (taken) {
      cx.stop_propagation();
      cx.notify();

      return;
    }

    const place = this.place();

    if (act(this, place, keyName(e), cx)) {
      cx.stop_propagation();
      cx.notify();
    }
  }

  override render(): Element {
    const t = theme();
    const handle = this.handle;
    const formOpen = Boolean(this.form || this.exporting);

    const view = v_flex().id("databases").relative().size_full().bg(t.background).text_size(11).text_color(t.foreground)
      .when(Boolean(this.overlay), (el) => el.border(1).border_color(t.ansi8));

    return (handle ? view.track_focus(handle) : view)
      .on_key_down((e, cx) => this.key(e, cx))
      .map((el) => tabActions(el, (e, cx) => this.key(e, cx), formOpen))
      .map((el) => tracking(el, this.dividers))
      .on_size_change((drawn, cx) => {
        const size = unzoomSize(drawn);

        if (Math.abs(size.width - this.size.width) > 1 || Math.abs(size.height - this.size.height) > 1) {
          this.size = size;
          cx.notify();
        }
      })
      .children(frame(this, t))
      .child(div());
  }
}
