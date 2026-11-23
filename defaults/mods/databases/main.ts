// Nocturne Databases: MySQL / MariaDB, Postgres, SQLite and libSQL (Turso)
// in Nocturne's night look, lazygit's way (the git window's anatomy):
//
//   [1] Connections   saved, sent by another mod, found in the space's folder
//   [2] Tables        · Views · Schemas · Databases (the server's: a pick connects
//                     to it, dbs.ts), with their row counts; an empty database says
//                     so and offers the others
//   [3] Structure     · Indexes · Keys · Value (the picked cell, whole)
//   [0] the main view: Rows (a table's page: sorted, filtered by a WHERE line,
//       paged) and one tab per query (an SQL editor over its result)
//   [4] Log           what ran in this window
//
// Keys: keys.ts (? lists them, m opens the menu of what the cursor is on, the
// same menu a right click opens: menus.ts). Mouse: every row, tab, header and
// cell is a click target, a double click is enter, a right click its menu;
// a grid's header sorts, drags its width or its place, its row numbers and a
// drag across cells select; names drag into a query, tabs and saved
// connections drag to reorder, a SQLite file dropped on the window opens it
// (press.ts, drops.ts). The wheel scrolls (a grid sideways with shift).
// Nothing runs on open; a write asks once, a destructive statement twice;
// read-only connections refuse writes (safety.ts). Secrets never leave the
// keychain or this window's memory (runner.ts, secrets.ts); one that lives in
// a cluster's secret is read from there at each connect (kube.ts).
//
// A window (props.overlay, opened by nocturne.databases) or a pane (props
// .slot: pane.split { mod: "databases", props: { slot, folder, on } }); ctrl-t
// moves it between the two (opening.ts). Props: { folder?, on?, connect? }:
// `connect` (another mod's databases.connect) connects at once, not saved; its
// `secret` names where a cluster keeps the password (never the password).
//
// The head says where the connection is and whether it is connected, first
// after its title (connmark.ts, connstate.ts: one function for the head's
// mark, the [1] row's pip and the pin's hover): connected means the last
// client run answered; a run that can't reach the server turns it, and the
// window checks again when it gets the keyboard back after a while. A
// Postgres connection that names no database is in the server's default,
// `postgres`, and says so.

import { View } from "gpui-kit";
import type { AsyncContext, Context, Element, FocusHandle, KeyEvent, Size } from "gpui-kit";
import type { Props } from "gpui-shell";
import type { InputState } from "gpui-base";
import { v_flex, ScrollHandle } from "gpui-base";
import { props, theme, shared, setShared, closeOverlay } from "herdr";
import { Array as Arr, Clock, Deferred, Effect, Option, Result, Schema, String as Str } from "effect";
import { Commands, readShared, redraw, writeShared } from "@fireflies/kit";
import { bindTab, tabActions } from "@fireflies/form-keys";
import type { Conn, Kind } from "./kinds.ts";
import type { Found } from "./discover.ts";
import type { TableRef } from "./catalog.ts";
import type { HistoryEntry } from "./store.ts";
import type { ConnectArgs, KeptCopy, Alive, Ask, Catalog, ForwardAsk, ServerDbs, CellEdit, ClientFound, DbProps, LogLine, Menu, Note, PanelId, PasswordAsk, QueryTab, Rename, Review, Rows, Sourced, Struct, StructTab, TablesTab } from "./state.ts";
import type { Edits } from "./edits.ts";
import { DbPropsSchema, STRUCT_TABS, TABLES_TABS, WINDOW_KEY, gridStart } from "./state.ts";
import type { Place } from "./keys.ts";
import { keyName } from "./keys.ts";
import { act, setPanel } from "./actions.ts";
import { shownGrid } from "./act-grid.ts";
import { scrollGrid } from "./grid.ts";
import { menuLayer, modalKey } from "./popups.ts";
import { askPassword, connList, connect, discover } from "./conns.ts";
import { readConnections } from "./store.ts";
import { loadTables } from "./session.ts";
import { newQuery } from "./query.ts";
import { loadQueries, saveQueries } from "./queries.ts";
import { frame } from "./chrome.ts";
import type { ConnForm } from "./conn-form.ts";
import type { ExportForm } from "./export-form.ts";
import { here, start, command, handoverOut, newSlot, restoreFound } from "./opening.ts";
import type { SpacePlace } from "./lastview.ts";
import { shownSpace } from "./lastview.ts";
import { clientOf, dataHome } from "./session.ts";
import { nowMs, runtime } from "./app.ts";
import type { DbFx, DbRun } from "./app.ts";
import { privateDir, removeDir } from "./runner.ts";
import type { FolderEnv } from "./folderenv.ts";
import type { Setup } from "./clients.ts";
import { setupOf } from "./clients.ts";
import { loadFolderEnv } from "./folderenv.ts";
import type { Read } from "./reads.ts";
import { overdue } from "./reads.ts";
import { syncPinned } from "./pinned.ts";
import { focusArrived } from "./connstate.ts";
import { dbsNow, loadDatabases } from "./dbs.ts";
import { unzoom, unzoomSize } from "./kit.ts";
import { beforeLeaving } from "./cell-edit.ts";
import { Dividers, tracking } from "@fireflies/dividers";
import type { Pt } from "@fireflies/menu-place";
import { originOf } from "@fireflies/menu-place";
import type { Pressing } from "./press.ts";
import { ghost, pressLeave, pressMove, pressUp } from "./press.ts";
import type { ColumnLayout } from "./columns.ts";
import { dropFiles } from "./drops.ts";
import type { Room } from "./layout.ts";
import { keepSizes, keptSizes } from "./layout.ts";

const NO_PROPS: DbProps = {};
const BEAT = 4000;
const TICK = "1 second";

/** The props as they came (another shape: none, the shown space's folder then). */
const propsOf = Schema.decodeUnknownOption(DbPropsSchema);

export default class Databases extends View {
  overlay: string | null = null;
  slot: string | null = null;
  folder: string | null = null;
  on: string | null = null;
  /** The space it opened in: where it's kept (lastview.ts). */
  space: string | null = null;
  /** What each sent connection was sent with (kept for its space: never a secret). */
  sentArgs = new Map<string, ConnectArgs>();
  /** A kept place whose connection isn't listed yet (one the folder's discovery may find). */
  lateKept: KeptCopy | SpacePlace | null = null;
  size: Size = { width: 1100, height: 720 };
  handle: FocusHandle | null = null;
  closed = false;
  beatAt = 0;
  /** init's context (made to be held): the commands loop's, for the actions it starts. */
  own: AsyncContext | null = null;
  /** This copy's handle on the mod's runtime: every read, loop and save runs through it. */
  fx: DbFx | null = null;
  /** The clock read once per render (every countdown on it agrees). */
  now = 0;

  // ---- connections
  saved: Conn[] = [];
  sent: Conn[] = [];
  found: Found[] = [];
  connAt = 0;
  active: Conn | null = null;
  /** Passwords and tokens asked for or found: this window's memory only. */
  secrets = new Map<string, string>();
  /** How each cluster-secret connection's last read went, in words (never the value). */
  sourced = new Map<string, Sourced>();
  clients = new Map<Kind, ClientFound>();
  /** The space folder's environment for the clients (folderenv.ts). */
  env: FolderEnv = { kind: "none" };
  /** The reads going on (reads.ts): what each panel says runs, and its stop. */
  reads: Read[] = [];
  /** The ask before a connection whose port-forward is down (forward.ts). */
  forwardAsk: ForwardAsk | null = null;
  /** Whether the active connection answers (connstate.ts): its last answer or its failure. */
  alive: Alive | null = null;
  /** A check that it still answers runs (connstate.ts recheck). */
  checking = false;
  /** Whether the view had the keyboard at the last draw, and when it got it again. */
  hadFocus = false;
  focusAt = 0;
  /** The server's databases as last read (dbs.ts). */
  dbs: ServerDbs | null = null;
  /** A database picked on a sent connection, by its id (dbs.ts): kept while the window lives. */
  picked = new Map<string, string | null>();
  /** Whether the Kubernetes mod is installed (null: not looked yet). */
  k8s: boolean | null = null;
  /** This copy, as the pinned list's notice names who changed it. */
  me = newSlot();
  /** When this window last read or changed the pinned list (pinned.ts). */
  pinnedAt = 0;
  /** How this machine gets its programs (the install line a missing client offers). */
  setup: Setup = "other";
  /** The private folder (0700) runs hand files over in; why there is none, when it couldn't be made. */
  dir: string | null = null;
  dirProblem: string | null = null;

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
  /** The shown table's columns as arranged (columns.ts), by the table's key. */
  columnsAt: { readonly key: string; readonly layout: ColumnLayout } | null = null;
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
  /** A query tab being renamed: the tab and its name's input. */
  rename: Rename | null = null;
  /** A press going on, perhaps a drag (press.ts). */
  press: Pressing | null = null;
  /** The pointer over the view as last seen (layout px), where a right click's menu opens. */
  pointer: { x: number; y: number } | null = null;
  /** The view's top left corner in the window (window px), from its own pointer moves: a press's
   *  window position less it is the press in the view (menu-place.ts). */
  origin: Pt | null = null;
  /** Where the next menu opens (atPointer sets it for a right click). */
  menuNear: Pt | null = null;

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
    const pr = Option.getOrElse(propsOf(props() ?? p), () => NO_PROPS);
    const h = pr.folder !== undefined ? { folder: pr.folder, on: pr.on ?? null } : here();
    const fx = runtime.attach(cx, (message) => this.say(message, "failed"));

    this.fx = fx;
    this.own = cx;
    this.overlay = pr.overlay ?? null;
    this.slot = pr.slot ?? null;
    this.dividers = new Dividers(keptSizes(this.overlay !== null), (sizes) => keepSizes(this.overlay !== null, sizes));
    this.folder = h.folder;
    this.on = h.on;
    this.space = shownSpace();
    this.handle = cx.focus_handle();
    bindTab(cx);
    this.handle.focus();

    // A window doesn't take the keyboard when it opens: take it, again once it's shown.
    if (this.overlay !== null) fx.run(Effect.forEach([60, 190, 350], (ms) => Effect.andThen(Effect.sleep(ms), Effect.sync(() => this.focusShown())), { concurrency: 1 }));

    this.beat();
    fx.run(this.opening(pr));
    fx.run(Effect.forever(Effect.andThen(Effect.sleep(TICK), this.tick())), { redraw: false });
    fx.run(Effect.forever(Commands.use((c) => c.next).pipe(
      Effect.tap((name) => Effect.sync(() => command(this, name, cx))),
      Effect.andThen(redraw),
    )), { redraw: false });
  }

  /** Runs `effect` for this copy (`key`: a run under the same key replaces the one before). */
  run<A, E>(effect: Effect.Effect<A, E, DbRun>, options?: { readonly key?: string }): void {
    this.fx?.run(effect, options);
  }

  /** The window's start: its private folder, the pinned connections, where it was (or what was
   *  sent), the folder's connections, each listed kind's client. */
  opening(pr: DbProps): Effect.Effect<void, never, DbRun> {
    return Effect.gen({ self: this }, function* () {
      const dir = yield* Effect.result(privateDir);

      if (Result.isSuccess(dir)) this.dir = dir.success;
      else this.dirProblem = dir.failure.message;

      this.run(Effect.map(setupOf, (s) => {
        this.setup = s;
      }));

      const saved = yield* Effect.result(readConnections(dataHome()));

      if (Result.isSuccess(saved)) this.saved = saved.success;
      else this.say(`the pinned connections couldn't be read: ${saved.failure.message}`, "failed");

      this.pinnedAt = yield* Clock.currentTimeMillis;

      // The folder's environment loads beside the first connect (a client may come from it).
      this.run(loadFolderEnv(this));
      yield* start(this, pr);
      yield* discover(this);

      restoreFound(this);
      // Each listed kind's client looked for once the folder's environment is known: a row whose
      // client is missing says so before it's connected to.
      const env = this.env;

      if (env.kind === "loading") yield* Deferred.await(env.done);

      yield* Effect.forEach(Arr.dedupe(Arr.map(connList(this), (c) => c.kind)), (k) => clientOf(this, k), { concurrency: "unbounded", discard: true });
    });
  }

  /** A window's note that it's open (nocturne's toggle reads it), renewed every few seconds. */
  beat(): void {
    if (this.overlay === null) return;

    this.beatAt = nowMs();
    writeShared(setShared, WINDOW_KEY, { id: this.overlay, beat: this.beatAt });
  }

  /** Every second: the beat, another window's pins, the focus coming back, the reads' seconds,
   *  the query tabs kept, an old note gone. */
  tick(): Effect.Effect<void, never, DbRun> {
    return Effect.gen({ self: this }, function* () {
      const now = yield* Clock.currentTimeMillis;

      if (now - this.beatAt >= BEAT) this.beat();

      // Another window changed the pinned connections: read them again.
      yield* syncPinned(this);

      // The window got the keyboard back after a while: its connection is asked once more.
      if (this.focusAt !== 0) {
        this.focusAt = 0;
        focusArrived(this, now);
      }

      // A read's seconds count up where it's shown; one past its deadline ends.
      if (this.reads.length !== 0) {
        overdue(this, now);
        yield* redraw;
      }

      if (this.queriesDirty) this.run(saveQueries(this), { key: "queries" });

      if (this.note !== null && this.note.tone !== "working" && now - this.note.at > 6000) {
        this.note = null;
        yield* redraw;
      }
    });
  }

  override close(): Promise<void> {
    this.closed = true;

    const w = readShared(shared, WINDOW_KEY, null);

    if (this.overlay !== null && w?.id === this.overlay) writeShared(setShared, WINDOW_KEY, null);

    this.secrets.clear();
    this.sourced.clear();

    const dir = this.dir;
    const last = Effect.andThen(Effect.ignore(saveQueries(this)), dir === null ? Effect.void : removeDir(dir));

    // Every read and loop of this copy is interrupted; its query tabs are kept and its folder goes on the
    // mod's runtime (as github's cache write), so the close waits for them and no run of the copy can stop them.
    void this.fx?.close();

    return runtime.managed().runPromise(Effect.andThen(Effect.yieldNow, last));
  }

  // ---- what the modules ask of the view

  /** A window closes itself; a pane never does by esc (its own × and cmd-w close it). */
  closeWindow(): void {
    const id = this.overlay;

    if (id !== null && Str.isNonEmpty(id)) beforeLeaving(this, "close", () => closeOverlay(id));
  }

  /** The keyboard back to the view (or the shown query's editor). */
  focusShown(): void {
    if (this.closed || this.form !== null || this.password !== null || this.exporting !== null || this.rename !== null) return;

    const q = this.shownQuery();

    if (this.panel === "main" && q !== null && !q.inResults) q.editor.focus();
    else this.handle?.focus();
  }

  focusSelf(): void {
    this.handle?.focus();
  }

  say(text: string, tone: Note["tone"]): void {
    this.note = { text, tone, at: nowMs() };
  }

  /** The shown query tab, or null on the Rows tab. */
  shownQuery(): QueryTab | null {
    return this.mainTab > 0 ? this.queries[this.mainTab - 1] ?? null : null;
  }

  /** The room the dividers share: the view, its body inside its padding, the shown query's box. */
  room(): Room {
    return { width: this.size.width, height: this.size.height, inner: this.bodyH - 18, query: this.shownQuery() !== null ? this.queryBox : null };
  }

  /** Where keys go now. */
  place(): Place {
    if (this.panel !== "main") return this.panel;

    const q = this.shownQuery();

    return q !== null ? (q.inResults ? "results" : "editor") : "rows";
  }

  connected(c: Conn, ok: boolean): void {
    if (ok && this.panel === "conns" && this.active === c) this.panel = "tables";
  }

  /** A table's rows as last known (its count or the server's estimate). */
  tableRows(t: Pick<TableRef, "schema" | "name">): number | null {
    return Option.getOrUndefined(Arr.findFirst(this.catalog.tables, (x) => x.name === t.name && x.schema === t.schema))?.rows ?? null;
  }

  refreshCatalog(): void {
    this.run(loadTables(this), { key: "tables" });
  }

  askPassword(c: Conn, keychain: boolean, then?: () => void): void {
    askPassword(this, c, keychain, then);
  }

  connectTo(c: Conn): void {
    this.run(connect(this, c));
  }

  addQuery(text: string): QueryTab {
    const q = newQuery(this, text);
    // The caret after the text: what's typed or dropped next follows it.
    const lines = Str.split(text, "\n");

    q.editor.set_cursor(lines.length - 1, lines.at(-1)?.length ?? 0);
    this.queries.push(q);
    this.mainTab = this.queries.length;
    this.panel = "main";
    this.queriesDirty = true;
    q.editor.focus();

    return q;
  }

  loadQueries(c: Conn): void {
    this.run(loadQueries(this, c), { key: "queries" });
  }

  logLine(line: LogLine): void {
    this.log = [line, ...this.log].slice(0, 200);
    this.logAt = 0;
  }

  openHistory(cx: Context): void {
    act(this, "window", "history", cx);
  }

  act(place: Place, action: string, cx: Context): boolean {
    return act(this, place, action, cx);
  }

  setPanel(p: PanelId): void {
    setPanel(this, p);
  }

  setTablesTab(key: string, _cx: Context): void {
    const tab = Option.getOrUndefined(Arr.findFirst(TABLES_TABS, (x) => x === key));

    if (tab !== undefined) this.tablesTab = tab;

    this.tableAt = 0;
    this.setPanel("tables");

    // The server's databases, read each time the tab is shown (one small catalog read).
    if (tab === "databases" && dbsNow(this)?.busy !== true) this.run(loadDatabases(this));
  }

  setStructTab(key: string, _cx: Context): void {
    const tab = Option.getOrUndefined(Arr.findFirst(STRUCT_TABS, (x) => x === key));

    if (tab !== undefined) this.structTab = tab;

    this.structAt = 0;
    this.setPanel("structure");
  }

  /** The shown grid scrolled by the wheel. */
  scrollGrid(by: number, across: number, _cx: Context): void {
    const g = shownGrid(this);

    if (g !== null) g.put(scrollGrid(g.at, g.set, g.cols, by, across, this.gridSize.height));
  }

  /** The Rows grid's column types, from the table's structure. */
  columnTypes(): readonly string[] | undefined {
    const set = this.rows.set;
    const s = this.struct.data;

    if (set === null || s === null || this.struct.table?.name !== this.rows.browse?.table.name) return undefined;

    return Arr.map(set.columns, (c) => Option.getOrUndefined(Arr.findFirst(s.columns, (x) => x.name === c))?.type ?? "");
  }

  /** Leaves for a pane or a window (ctrl-t, the ◧ / ⧉ chip). */
  move(): void {
    beforeLeaving(this, this.overlay !== null && Str.isNonEmpty(this.overlay) ? "move into a pane" : "move out to a window", () => handoverOut(this));
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

    this.now = nowMs();
    const handle = this.handle;
    // The keyboard coming back to the view (the tick asks the connection again: connstate.ts).
    const focused = handle?.is_focused() ?? false;

    if (focused && !this.hadFocus) this.focusAt = this.now;

    this.hadFocus = focused;
    const formOpen = Boolean(this.form || this.exporting);

    const view = v_flex().id("databases").relative().size_full().bg(t.background).text_size(11).text_color(t.foreground)
      .when(Boolean(this.overlay), (el) => el.border(1).border_color(t.muted));

    return (handle !== null ? view.track_focus(handle) : view)
      .on_key_down((e, cx) => this.key(e, cx))
      .map((el) => tabActions(el, (e, cx) => this.key(e, cx), formOpen))
      .map((el) => tracking(el, this.dividers, {
        move: (e, cx) => {
          this.pointer = { x: unzoom(e.local_position.x), y: unzoom(e.local_position.y) };
          this.origin = originOf(e);

          return pressMove(this, e, cx);
        },
        up: (cx) => pressUp(this, cx),
        leave: (cx) => pressLeave(this, cx),
      }))
      // A file dropped from outside: a SQLite file opens as a connection (drops.ts).
      .on_drop((e, cx) => {
        dropFiles(this, e.paths);
        cx.notify();
      })
      .on_size_change((drawn, cx) => {
        const size = unzoomSize(drawn);

        if (Math.abs(size.width - this.size.width) > 1 || Math.abs(size.height - this.size.height) > 1) {
          this.size = size;
          cx.notify();
        }
      })
      .children(frame(this, t))
      // The menu over the whole view: its place is measured from the view's corner (menu-place.ts).
      .map((el) => {
        const m = menuLayer(t, this);

        return m !== null ? el.child(m) : el;
      })
      .map((el) => {
        const g = ghost(t, this);

        return g !== null ? el.child(g) : el;
      });
  }
}
