// The Projects tab: a GitHub Projects (v2) board, lazygit's way. Each column
// is a panel (its title cut into the edge, accent when it has the keyboard,
// red when it holds more than its limit); cards are rows like the PR list.
// The project's board views are tabs on the bar beside an always-there filter
// (GitHub's syntax, board.ts parseFilter); a view's group-by draws swimlanes
// inside every column. enter docks the card's detail on the right.
//
// Keyboard first: h l columns, j k cards, space / m carries a card (hjkl
// moves it, enter drops, esc puts it back), e edits its fields, a adds a
// draft, / filters, v views, p projects, o GitHub, x archives, - folds a
// column, z a lane, w sets a column's limit. Edits show at once and roll back
// when GitHub refuses them (board.ts overlay).
//
// GitHub keeps no column limits or folded columns for a view in its API, so
// those are this app's, per project (shared state "github.boards").

import { div, svg } from "gpui-kit";
import { Semaphore, Array as Arr, Schema, Option } from "effect";
import type { Context, Element, KeyEvent, Size } from "gpui-kit";
import { h_flex, v_flex, VirtualListScrollHandle, InputState } from "gpui-base";
import { shared, setShared } from "herdr";
import type { Theme } from "herdr";
import { mapOf, readShared, sharedKey, writeShared } from "@fireflies/kit";
import { maybe } from "./model.ts";
import { pollProjects, readDetail } from "./projects-reads.ts";
import type { WebLink } from "./model.ts";
import { SLOW, linksIn } from "./model.ts";
import type { Pieces, Piece } from "./cache.ts";
import { repoKey, newest, LIMITS } from "./cache.ts";
import type { Hint } from "./kit.ts";
import { dither, empty, ART } from "./kit.ts";
import type { Board, Choices, Detail, Field, Item, ProjectList, ScopeProblem, StoredBoard, View } from "./board.ts";
import type { At, Carry, Layout, Lane } from "./board-layout.ts";
import type { Op } from "./board-edits.ts";
import { slimBoard, StoredBoardSchema, boardOf, ListedProjectSchema } from "./board.ts";
import { layout, grid, find, carried } from "./board-layout.ts";
import { overlay } from "./board-edits.ts";
import type { Host, ReadOptions } from "./host.ts";
import type { KeyRow } from "@fireflies/keyhelp";
import { FOLD_W, HANDLES, GAP, DETAIL_W, bar, columnRows, columns, detail, menuPanel } from "./projects-draw.ts";
import { options, submitValue } from "./projects-menus.ts";
import { addDraft } from "./projects-edits.ts";
import { key } from "./projects-keys.ts";
import { edge } from "@fireflies/tones";


// ---- what this app keeps of a board (shared "github.boards"): GitHub keeps no column limits or
// folded columns for a view. As shared state holds it:
// { repos: { repoKey: projectId }, projects: { id: { view, folded: { viewId: [key] }, lanes: { viewId: [key] }, limits: { fieldId: { key: n } } } } }

// Each map read entry by entry (the kit's mapOf): one project's settings in another shape are left out, the rest read.
const LocalSchema = Schema.Struct({
  view: Schema.optionalKey(Schema.String), folded: Schema.optionalKey(mapOf(Schema.Array(Schema.String))), lanes: Schema.optionalKey(mapOf(Schema.Array(Schema.String))),
  limits: Schema.optionalKey(Schema.Finite.pipe(mapOf, mapOf)),
});

const PREFS = sharedKey("github.boards", Schema.Struct({ repos: Schema.optionalKey(mapOf(Schema.String)), projects: Schema.optionalKey(mapOf(LocalSchema)) }));

/** A project's own settings here: its view, each view's folded columns and lanes, each field's column limits. */
interface Local {
  readonly view?: string | undefined;
  readonly folded: ReadonlyMap<string, readonly string[]>;
  readonly lanes: ReadonlyMap<string, readonly string[]>;
  readonly limits: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

/** Each repo's project, and each project's settings. */
interface Prefs {
  readonly repos: ReadonlyMap<string, string>;
  readonly projects: ReadonlyMap<string, Local>;
}

const NO_LOCAL: Local = { folded: new Map(), lanes: new Map(), limits: new Map() };

const localOf = (l: typeof LocalSchema.Type): Local => ({
  view: l.view, folded: l.folded ?? new Map(), lanes: l.lanes ?? new Map(), limits: l.limits ?? new Map(),
});

/** A project's settings as shared state holds them (the view only when there is one). */
function localJson(l: Local): typeof LocalSchema.Type {
  const out = { folded: l.folded, lanes: l.lanes, limits: l.limits };

  return l.view === undefined ? out : { ...out, view: l.view };
}

/** What the tab keeps in shared state between openings (main.ts STATE). */
import type { ProjectsKept } from "./kept.ts";

export type { ProjectsKept };

/** The picker's list as the cache keeps it, with when it was read. */
const isListPiece = Schema.is(Schema.Struct({ projects: Schema.Array(ListedProjectSchema), viewer: maybe(Schema.String), repoId: maybe(Schema.String), at: maybe(Schema.Finite) }));

const isBoardPiece = Schema.is(Schema.Struct({ board: StoredBoardSchema, at: maybe(Schema.Finite) }));

/** The cache's part for this tab (cache.ts entry.projects). */
export interface ProjectsCached {
  readonly list?: Piece | null | undefined;
  readonly boards?: Pieces | undefined;
}

/** A board as read and when. */
interface Read {
  readonly board: Board;
  readonly at: number;
}

/** What the tab gives the cache: the picker's list, the last boards opened (slim). */
export interface ProjectsSnapshot {
  readonly list: (ProjectList & { readonly at: number }) | null;
  readonly boards: Map<string, { readonly board: StoredBoard; readonly at: number }>;
}

/** An edit on its way: shown at once, dropped when GitHub refuses it, kept until a read after it. */
export interface Pending {
  readonly id: number;
  op: Op;
  state: "sending" | "done";
  readonly at: number;
  doneAt?: number;
}

/** A card's detail as read (or reading, or why not). */
interface DetailRead {
  readonly d?: Detail | null;
  readonly error?: string;
  readonly busy?: boolean;
  readonly at: number;
}

/** A row of a pick menu. */
interface MenuRow {
  readonly label: string;
  readonly right?: string;
  readonly dim?: boolean;
  readonly go: (cx: Context) => void;
}

/** A value the field menu offers. `id`: what it sets (null clears, undefined: nothing to pick). */
export interface Opt {
  readonly id: string | null | undefined;
  readonly label: string;
  readonly color?: number;
  readonly on?: boolean;
  readonly dim?: boolean;
  readonly right?: string;
  readonly hex?: string | null;
  readonly toggle?: boolean;
  readonly input?: boolean;
}

/** The open menu: a list to pick from, a value to type, or a card's fields. */
export type Menu =
  | { readonly kind: "pick"; readonly title: string; at: number; readonly rows: readonly MenuRow[] }
  | { readonly kind: "value"; readonly title: string; readonly back?: Menu | null; readonly go: (text: string) => void }
  | { readonly kind: "fields"; readonly item: string; at: number; side: "fields" | "opts"; opt: number; readonly fields: readonly string[] };

/** A row a column draws: a lane's header, a card, or the gap that lines its lane up. */
export type ColumnRow =
  | { readonly lane: Lane; readonly n: number }
  | { readonly item: Item }
  | { readonly pad: number; readonly key: string | null };

export default class Projects {
  readonly app: Host;

  /** The picker's { viewer, repoId, projects }. */
  list: ProjectList | null = null;
  listAt = 0;

  /** Project id -> its board as read. */
  boards = new Map<string, Read>();

  /** The project id. */
  pick: string | null;
  viewId: string | null;

  /** The item id. */
  sel: string | null;

  /** The column the selection is in (an empty column holds no item). */
  selCol = 0;

  /** The first column drawn, when they don't all fit. */
  first = 0;
  pending: Pending[] = [];
  seq = 0;

  /** board.ts carry state. */
  carrying: Carry | null = null;

  /** The open picker / field editor. */
  menu: Menu | null = null;
  filterText: string;
  filter: InputState;

  /** While an Input has the keys. */
  typing: "filter" | "draft" | "value" | null = null;
  draft: InputState;
  valueInput: InputState;
  detailOpen: boolean;
  focus: "board" | "detail" = "board";

  /** Content id -> its detail. */
  details = new Map<string, DetailRead>();

  /** Repo -> its labels and users. */
  choices = new Map<string, Choices>();
  scrollY = 0;
  contentH = 0;
  viewH = 400;
  handles = Array.from({ length: HANDLES }, () => VirtualListScrollHandle.new());

  /** board.ts scopeProblem: the token can't read projects. */
  scope: ScopeProblem | null = null;
  error = "";
  settleAt = 0;
  width = 1000;

  /** The characters a card's line holds, and the fields cards show, as last drawn. */
  chars = 24;
  fields: readonly Field[] = [];

  /** One read of this tab at a time (the shown tab's, and the read behind it: window-reads.ts). */
  readonly reading = Semaphore.makeUnsafe(1);

  constructor(app: Host, kept: ProjectsKept = {}) {
    this.app = app;
    this.pick = kept.pick ?? null;
    this.viewId = kept.view ?? null;
    this.sel = kept.sel ?? null;
    this.filterText = kept.filter ?? "";
    this.detailOpen = Boolean(kept.detail);
    this.filter = InputState.new({ placeholder: "filter: assignee:@me label:bug status:Ready is:open repo:name, or words", value: this.filterText });
    this.filter.on("change", (_e, cx) => {
      this.filterText = this.filter.value();
      this.keepSel();
      cx.notify();
    });
    this.filter.on("submit", (_e, cx) => {
      this.typing = null;
      this.app.focusSelf();
      cx.notify();
    });
    this.draft = InputState.new({ placeholder: "a title for the new draft; enter adds it" });
    this.draft.on("submit", (_e, cx) => {
      addDraft(this, cx);
      cx.notify();
    });
    this.valueInput = InputState.new({ placeholder: "" });
    this.valueInput.on("submit", (_e, cx) => {
      submitValue(this, cx);
      cx.notify();
    });
  }

  save(): ProjectsKept {
    return { pick: this.pick, view: this.viewId, sel: this.sel, filter: this.filterText, detail: this.detailOpen };
  }

  /** Shows what an earlier opening read (cache.ts entry.projects), until GitHub answers. Each piece
   *  is proven here: one in another shape is left out. */
  hydrate(c: ProjectsCached | null | undefined): void {
    const l = c?.list;

    this.list = isListPiece(l) ? { viewer: l.viewer ?? null, repoId: l.repoId ?? null, projects: l.projects } : null;
    this.listAt = isListPiece(l) ? l.at ?? 0 : 0;
    this.boards = new Map();

    for (const [id, b] of c?.boards ?? []) if (isBoardPiece(b)) this.boards.set(id, { board: boardOf(b.board), at: b.at ?? 0 });

    this.pending = [];
    this.carrying = null;
    this.menu = null;
    this.details = new Map();
    this.choices = new Map();
    this.scope = null;
    this.error = "";

    if (this.pick === null || this.pick === "" || (this.list !== null && !Arr.some(this.list.projects, (p) => p.id === this.pick))) this.pick = this.remembered() ?? null;
  }

  snapshot(): ProjectsSnapshot {
    const boards = new Map<string, { readonly board: StoredBoard; readonly at: number }>();

    for (const [id, b] of this.boards) {
      const board = slimBoard(b.board);

      if (board !== null) boards.set(id, { board, at: b.at });
    }

    return { list: this.list === null ? null : { ...this.list, at: this.listAt }, boards: newest(boards, LIMITS.boards) };
  }

  readAt(): number {
    return this.pick === null ? this.listAt : this.boards.get(this.pick)?.at ?? 0;
  }

  interval(): number {
    return SLOW;
  }

  // ---- what GitHub keeps and what this app keeps

  prefs(): Prefs {
    const p = readShared(shared, PREFS, {});

    return { repos: p.repos ?? new Map(), projects: new Map(Arr.map(Arr.fromIterable(p.projects ?? new Map<string, typeof LocalSchema.Type>()), ([k, v]) => [k, localOf(v)] as const)) };
  }

  /** Writes the prefs back, in the shape shared state holds them. */
  setPrefs(p: Prefs): void {
    writeShared(setShared, PREFS, { repos: p.repos, projects: new Map(Arr.map(Arr.fromIterable(p.projects), ([k, v]) => [k, localJson(v)] as const)) });
  }

  local(): Local {
    return (this.pick === null ? undefined : this.prefs().projects.get(this.pick)) ?? NO_LOCAL;
  }

  setLocal(fn: (l: Local) => Local): void {
    const pick = this.pick;

    if (pick === null || pick === "") return;

    const p = this.prefs();

    this.setPrefs({ ...p, projects: new Map(p.projects).set(pick, fn(p.projects.get(pick) ?? NO_LOCAL)) });
  }

  remembered(): string | null {
    const app = this.app.repo;

    return app === null ? null : this.prefs().repos.get(repoKey(app)) ?? null;
  }

  /** The board as read, with the edits on their way laid over it. */
  base(): Board | null {
    return this.pick === null ? null : this.boards.get(this.pick)?.board ?? null;
  }

  board(): Board | null {
    const b = this.base();

    return b === null ? null : overlay(b, this.pending);
  }

  views(b: Board | null = this.board()): readonly View[] {
    const all = b?.views ?? [];
    const boards = Arr.filter(all, (v) => v.layout === "board");

    return boards.length > 0 ? boards : Arr.take(all, 1);
  }

  view(b: Board | null = this.board()): View | null {
    const vs = this.views(b);

    return Option.getOrNull(Arr.findFirst(vs, (v) => v.id === this.viewId).pipe(Option.orElse(() => Arr.findFirst(vs, (v) => v.id === this.local().view)), Option.orElse(() => Arr.head(vs))));
  }

  lay(b: Board | null = this.board()): Layout | null {
    if (b === null) return null;

    const v = this.view(b), l = this.local();
    const field = v === null ? null : Option.getOrNull(Arr.findFirst(b.fields, (f) => f.id === v.columnBy));
    const fid = field?.id ?? layout(b, v).field?.id ?? "";
    const limits = new Map(Arr.filter(Arr.fromIterable(l.limits.get(fid) ?? new Map<string, number>()), ([, n]) => n > 0));

    return layout(b, v, this.filterText, {
      folded: v === null ? [] : l.folded.get(v.id) ?? [], lanesFolded: v === null ? [] : l.lanes.get(v.id) ?? [], limits,
    }, { me: b.viewer ?? this.list?.viewer, now: this.app.now() });
  }

  /** The grid j / k walk (carrying: as it would look after the drop). */
  grid(lay: Layout): readonly (readonly Item[])[] {
    const g = grid(lay);

    return this.carrying === null ? g : carried(g, this.carrying);
  }

  foldedCols(lay: Layout): boolean[] {
    return Arr.map(lay.columns, (c) => c.folded);
  }

  at(lay: Layout | null = this.lay()): At {
    if (lay === null) return { col: 0, row: -1 };

    const g = this.grid(lay);

    if (this.carrying !== null) return { col: this.carrying.col, row: this.carrying.row };

    const f = this.sel === null ? null : find(g, this.sel);

    if (f !== null) {
      this.selCol = f.col;

      return f;
    }

    const col = Math.min(this.selCol, Math.max(0, g.length - 1));

    return { col, row: (g[col]?.length ?? 0) > 0 ? 0 : -1 };
  }

  current(lay: Layout | null = this.lay()): Item | null {
    if (lay === null) return null;

    const a = this.at(lay);

    return this.grid(lay)[a.col]?.[a.row] ?? null;
  }

  /** After the filter or the board changed: the selection stays on its card, or the column's first. */
  keepSel(): void {
    const lay = this.lay();

    if (lay === null) return;

    const g = this.grid(lay);

    if (this.sel !== null && find(g, this.sel) !== null) return;

    const col = Math.min(this.selCol, Math.max(0, g.length - 1));

    this.sel = g[col]?.[0]?.id ?? null;
  }

  // ---- reading

  /** Reads the project list, the picked board and an open card's detail (projects-reads.ts). all: past the timers. */
  read(opts: ReadOptions) {
    return pollProjects(this, opts);
  }

  /** The selected card's body and comments, read once it's opened: a run on the window. */
  readDetail(item: Item, _cx?: Context | null): void {
    this.app.run(readDetail(this, item));
  }



  // ---- edits: shown at once, sent, rolled back when refused

  // ---- moves

  select(lay: Layout, a: At, cx: Context | null): void {
    const g = this.grid(lay);

    this.selCol = a.col;
    this.sel = g[a.col]?.[a.row]?.id ?? null;
    this.follow(lay, a);

    if (this.detailOpen) {
      this.scrollY = 0;

      const it = this.current(lay);

      if (it !== null) this.readDetail(it, cx);
    }
  }

  /** Keeps the selected column and card on screen. */
  follow(lay: Layout, a: At): void {
    const fit = this.fits(lay);

    if (a.col < this.first) this.first = a.col;

    while (a.col >= this.first + fit && this.first < lay.columns.length - 1) this.first++;

    const h = this.handles[a.col];

    if (h !== undefined && a.row >= 0) h.scroll_to_item(this.rowIndex(lay, a), "center");
  }

  /** The list row a grid position is drawn at (lane headers count). */
  rowIndex(lay: Layout, a: At): number {
    const rows = columnRows(this, lay, a.col);
    const id = this.grid(lay)[a.col]?.[a.row]?.id;

    return Math.max(0, Option.getOrElse(Arr.findFirstIndex(rows, (r) => "item" in r && r.item.id === id), () => -1));
  }

  /** How many columns fit side by side. */
  fits(lay: Layout): number {
    const avail = this.width - (this.detailOpen ? DETAIL_W + GAP : 0);
    const folded = Arr.filter(lay.columns, (c) => c.folded).length;

    return Math.max(1, Math.floor((avail - folded * (FOLD_W + GAP)) / (200 + GAP)));
  }

  key(k: string, e: KeyEvent, cx: Context): boolean | "typing" {
    return key(this, k, e, cx);
  }

  /** L: the links in the open card's detail (its body and comments). */
  links(): WebLink[] {
    const b = this.board(), item = this.detailOpen && b !== null ? this.current(this.lay(b)) : null;
    const id = item?.content.id ?? "";
    const d = id === "" ? null : this.details.get(id)?.d;

    return d === null || d === undefined ? [] : linksIn([d.body, ...Arr.map(d.comments, (c) => c.body)]);
  }

  setView(id: string): void {
    this.viewId = id;
    this.first = 0;
    this.setLocal((l) => ({ ...l, view: id }));
    this.keepSel();
  }

  setProject(id: string, cx: Context): void {
    if (id === this.pick) return;

    this.pick = id;
    this.viewId = null;
    this.sel = null;
    this.selCol = 0;
    this.first = 0;
    this.carrying = null;
    this.pending = [];
    this.detailOpen = false;

    const p = this.prefs(), repo = this.app.repo;

    if (repo !== null) this.setPrefs({ ...p, repos: new Map(p.repos).set(repoKey(repo), id) });

    this.app.refresh(cx, { all: false });
  }

  // ---- menus: lazygit's, a list with j / k, enter, esc

  options(_b: Board, item: Item, f: Field): Opt[] {
    return options(this, _b, item, f);
  }

  scroll(dy: number): void {
    const max = Math.max(0, this.contentH - this.viewH);

    this.scrollY = Math.max(0, Math.min(max, this.scrollY + dy));
  }

  // ---- the bar and the help

  get composer(): boolean {
    return Boolean(this.typing || this.menu || this.carrying);
  }

  /** No form on this tab. */
  get form(): null {
    return null;
  }

  hints(): Hint[] {
    if (this.typing === "filter") return [["enter", "apply"], ["esc", "leave"], ["↓", "board"]];

    if (this.typing !== null) return [["enter", "save"], ["esc", "cancel"]];

    if (this.menu?.kind === "fields") return this.menu.side === "fields" ? [["tab ⇧tab", "field"], ["l enter", "values"], ["esc", "close"]] : [["j/k", "value"], ["enter", "set"], ["tab ⇧tab", "field"], ["h", "fields"], ["esc", "close"]];

    if (this.menu !== null) return [["j/k", "move"], ["enter", "choose"], ["esc", "close"]];

    if (this.carrying !== null) return [["h/l", "column"], ["j/k", "move it"], ["enter", "drop"], ["esc", "put back"]];

    if (this.focus === "detail") return [["j/k", "scroll"], ["e", "edit fields"], ["o", "on GitHub"], ["h", "board"], ["esc", "close"], ["?", "keys"]];

    if (this.scope !== null) return [["r", "read again"], ["?", "keys"]];

    if (this.board() === null) return [["p", "projects"], ["r", "refresh"], ["?", "keys"]];

    return [["h/l", "column"], ["j/k", "card"], ["enter", "open"], ["m", "carry"], ["e", "fields"], ["a", "add"], ["/", "filter"], ["v", "view"], ["p", "project"], ["?", "keys"]];
  }

  static help(): KeyRow[] {
    return [
      ["h l ← →", "column"], ["j k ↓ ↑ g G home end", "card / first / last"], ["J K pgdn pgup", "scroll the card's detail"],
      ["tab ⇧tab", "to the detail and back"], ["esc", "close the detail · clear the filter"], ["enter", "the card's detail (again: into it)"], ["space m", "carry it: hjkl moves, enter drops, esc puts back"],
      ["e", "edit its fields"], ["a", "add a draft to the column"], ["i", "make the draft an issue"], ["x", "archive (asks)"],
      ["/", "filter: assignee: label: status: is: repo: no: words"], ["v", "the project's views"], ["p", "projects (repo's, owner's)"],
      ["-", "fold the column"], ["z", "fold the swimlane"], ["w", "the column's limit"], ["L", "a link in the open card"], ["o", "on GitHub"], ["r", "refresh"],
    ];
  }

  // ---- drawing

  render(t: Theme, size: Size): Element {
    this.width = size.width;

    if (this.scope !== null) {
      const can = this.scope.need === "project" ? "change" : "read";

      return v_flex().size_full().items_center().justify_center().gap(10).text_size(11)
        .child(svg(`${ART}/moon-1.svg`).w(40).h(40).text_color(t.muted).opacity(0.6))
        .child(div().text_color(t.foreground).child("Projects need another permission"))
        .child(div().text_center().max_w(420).text_color(t.muted).child(`gh's token can't ${can} GitHub Projects. Run this in a terminal, then press r here:`))
        .child(h_flex().relative().px(10).h(24).items_center().text_size(12).child(dither(edge(t), 1)).child(div().relative().text_color(t.accent).child(this.scope.command)));
    }

    if (this.list === null && this.base() === null) return empty(t, "Reading projects…", null, { moon: 3 });

    if (this.pick === null || this.pick === "") return empty(t, "No projects here", `Neither ${this.app.repo?.full ?? "this repo"} nor its owner has a project you can see. Link one on GitHub, then r.`, { moon: 0 });

    const b = this.board();

    if (b === null) return v_flex().size_full().child(bar(this, t, null, null)).child(empty(t, "Reading the board…", Option.getOrUndefined(Arr.findFirst(this.list?.projects ?? [], (p) => p.id === this.pick))?.title ?? "", { moon: 4 }));

    const lay = this.lay(b);

    if (lay === null) return empty(t, "Reading the board…", null, { moon: 4 });

    const menu = this.menu;

    const body = h_flex().flex_1().min_h(0).gap(GAP).items_start()
      .child(columns(this, t, b, lay, size))
      .when(this.detailOpen, (el) => el.child(detail(this, t, b, lay)));

    return v_flex().size_full().relative()
      .child(bar(this, t, b, lay))
      .child(body)
      .when(menu !== null, (el) => (menu !== null ? el.child(menuPanel(this, t, b, menu)) : el));
  }

}

// ---- small pieces

