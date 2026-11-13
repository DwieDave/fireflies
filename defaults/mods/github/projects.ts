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
import type { Color, Context, Element, KeyEvent, Size } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, VirtualListScrollHandle, InputState, Input } from "gpui-base";
import { shared, setShared } from "herdr";
import type { Theme } from "herdr";
import type { Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNumber, isString, nullable, object, readShared, sharedKey, writeShared } from "./guard.ts";
import type { JsonMap } from "./guards.ts";
import { mapOf, maybe, toJson, toMap } from "./guards.ts";
import type { Repo } from "./gh.ts";
import { graphql, mutate } from "./gh.ts";
import type { WebLink } from "./model.ts";
import { readAgo, ago, SLOW, linksIn } from "./model.ts";
import type { Pieces, Piece } from "./cache.ts";
import { repoKey, newest, LIMITS } from "./cache.ts";
import { markdown } from "./markdown.ts";
import type { Hint } from "./kit.ts";
import { dither, pip, empty, band, stop, unzoom, ART, ansiColor, noteOf } from "./kit.ts";
import type { Board, Choices, Content, Detail, Field, FieldValue, Item, ListedProject, ProjectList, ScopeProblem, StoredBoard, View } from "./board.ts";
import type { At, Carry, Dir, Layout, Lane } from "./board-layout.ts";
import type { Op } from "./board-edits.ts";
import { projectListQuery, parseProjectList, boardQuery, parseBoard, addPage, scopeProblem, detailQuery, parseDetail, choicesQuery, parseChoices, slimBoard, isStoredBoard, boardOf, isProjectListAnswer, isBoardAnswer, isDetailAnswer, isChoicesAnswer, isListedProject } from "./board.ts";
import { filterTokens, selectOf } from "./board-filter.ts";
import { layout, grid, find, step, pickUp, carry, carried, drop } from "./board-layout.ts";
import { overlay, valueFor, setFieldMutation, positionMutation, archiveMutation, addDraftMutation, convertMutation, draftMutation, toggleMutation, isAddedDraft } from "./board-edits.ts";
import { cardFields, editableFields, OPTION_ANSI, initials, loginSlot, valueText, wrap } from "./board-cards.ts";
import type { Host, ReadOptions } from "./host.ts";
import type { KeyRow } from "./keyhelp.ts";

const LIST_EVERY = 10 * 60000; // the picker's list is read again this rarely
const SETTLE = 2500; // after an edit GitHub took, the board is read again this much later
const FOLD_W = 28, GAP = 6, DETAIL_W = 340, CHAR = 7.7, LINE = 15, LANE_H = 22;
const HANDLES = 16;

const ansiKey = (color: string | null | undefined) => OPTION_ANSI.get(color ?? "") ?? 8;

const ansi = (t: Theme, color: string | null | undefined): Color => ansiColor(t, ansiKey(color));

// ---- what this app keeps of a board (shared "github.boards"): GitHub keeps no column limits or
// folded columns for a view. As shared state holds it:
// { repos: { repoKey: projectId }, projects: { id: { view, folded: { viewId: [key] }, lanes: { viewId: [key] }, limits: { fieldId: { key: n } } } } }

const isLocalJson = object({}, {
  view: maybe(isString), folded: maybe(mapOf(arrayOf(isString))), lanes: maybe(mapOf(arrayOf(isString))), limits: maybe(mapOf(mapOf(isNumber))),
});

const isPrefsJson = object({}, { repos: maybe(mapOf(isString)), projects: maybe(mapOf(isLocalJson)) });

const PREFS = sharedKey("github.boards", isPrefsJson);

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

const localOf = (l: Guarded<typeof isLocalJson>): Local => ({
  view: l.view ?? undefined, folded: toMap(l.folded ?? {}), lanes: toMap(l.lanes ?? {}),
  limits: new Map([...toMap(l.limits ?? {})].map(([k, v]) => [k, toMap(v)])),
});

function localJson(l: Local): Guarded<typeof isLocalJson> {
  const limits = toJson(new Map([...l.limits].map(([k, v]): [string, JsonMap<number>] => [k, toJson(v)])));
  const out = { folded: toJson(l.folded), lanes: toJson(l.lanes), limits };

  return l.view === undefined ? out : { ...out, view: l.view };
}

/** What the tab keeps in shared state between openings (main.ts STATE). */
export const isProjectsKept = object({}, { pick: nullable(isString), view: nullable(isString), sel: nullable(isString), filter: isString, detail: isBoolean });

export type ProjectsKept = Guarded<typeof isProjectsKept>;

/** The picker's list as the cache keeps it, with when it was read. */
const isListPiece = object({ projects: arrayOf(isListedProject) }, { viewer: nullable(isString), repoId: nullable(isString), at: maybe(isNumber) });

const isBoardPiece = object({ board: isStoredBoard }, { at: maybe(isNumber) });

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
interface Pending {
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
interface Opt {
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
type Menu =
  | { readonly kind: "pick"; readonly title: string; at: number; readonly rows: readonly MenuRow[] }
  | { readonly kind: "value"; readonly title: string; readonly back?: Menu | null; readonly go: (text: string) => void }
  | { readonly kind: "fields"; readonly item: string; at: number; side: "fields" | "opts"; opt: number; readonly fields: readonly string[] };

/** A row a column draws: a lane's header, a card, or the gap that lines its lane up. */
type ColumnRow =
  | { readonly lane: Lane; readonly n: number }
  | { readonly item: Item }
  | { readonly pad: number; readonly key: string | null };

const DIRS = new Map<string, Dir>([
  ["h", "left"], ["left", "left"], ["l", "right"], ["right", "right"], ["k", "up"], ["up", "up"], ["j", "down"], ["down", "down"],
  ["g", "top"], ["home", "top"], ["G", "bottom"], ["end", "bottom"],
]);

const FROM = { repo: "linked", parent: "parent's", owner: "owner's" } as const satisfies { readonly [K in ListedProject["from"]]: string };

const KIND_WORD = { issue: "Issue", pr: "Pull request", draft: "Draft", redacted: "Item" } as const satisfies { readonly [K in Content["kind"]]: string };

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

  /** The other tab's read behind this one, while it runs. */
  warming: Promise<void> | null = null;

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
      this.addDraft(cx);
      cx.notify();
    });
    this.valueInput = InputState.new({ placeholder: "" });
    this.valueInput.on("submit", (_e, cx) => {
      this.submitValue(cx);
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

    if (!this.pick || (this.list && !this.list.projects.some((p) => p.id === this.pick))) this.pick = this.remembered() ?? null;
  }

  snapshot(): ProjectsSnapshot {
    const boards = new Map<string, { readonly board: StoredBoard; readonly at: number }>();

    for (const [id, b] of this.boards) {
      const board = slimBoard(b.board);

      if (board) boards.set(id, { board, at: b.at });
    }

    return { list: this.list ? { ...this.list, at: this.listAt } : null, boards: newest(boards, LIMITS.boards) };
  }

  readAt(): number {
    return this.pick ? this.boards.get(this.pick)?.at ?? 0 : this.listAt;
  }

  interval(): number {
    return SLOW;
  }

  // ---- what GitHub keeps and what this app keeps

  prefs(): Prefs {
    const p = readShared(shared, PREFS, {});

    return { repos: toMap(p.repos ?? {}), projects: new Map([...toMap(p.projects ?? {})].map(([k, v]) => [k, localOf(v)])) };
  }

  /** Writes the prefs back, in the shape shared state holds them. */
  setPrefs(p: Prefs): void {
    writeShared(setShared, PREFS, { repos: toJson(p.repos), projects: toJson(new Map([...p.projects].map(([k, v]) => [k, localJson(v)]))) });
  }

  local(): Local {
    return (this.pick ? this.prefs().projects.get(this.pick) : undefined) ?? NO_LOCAL;
  }

  setLocal(fn: (l: Local) => Local): void {
    const pick = this.pick;

    if (!pick) return;

    const p = this.prefs();

    this.setPrefs({ ...p, projects: new Map(p.projects).set(pick, fn(p.projects.get(pick) ?? NO_LOCAL)) });
  }

  remembered(): string | null {
    const app = this.app.repo;

    return app ? this.prefs().repos.get(repoKey(app)) ?? null : null;
  }

  /** The board as read, with the edits on their way laid over it. */
  base(): Board | null {
    return this.pick ? this.boards.get(this.pick)?.board ?? null : null;
  }

  board(): Board | null {
    const b = this.base();

    return b ? overlay(b, this.pending) : null;
  }

  views(b: Board | null = this.board()): readonly View[] {
    const all = b?.views ?? [];
    const boards = all.filter((v) => v.layout === "board");

    return boards.length ? boards : all.slice(0, 1);
  }

  view(b: Board | null = this.board()): View | null {
    const vs = this.views(b);

    return vs.find((v) => v.id === this.viewId) ?? vs.find((v) => v.id === this.local().view) ?? vs[0] ?? null;
  }

  lay(b: Board | null = this.board()): Layout | null {
    if (!b) return null;

    const v = this.view(b), l = this.local();
    const field = v ? (b.fields.find((f) => f.id === v.columnBy) ?? null) : null;
    const fid = field?.id ?? layout(b, v).field?.id ?? "";
    const limits = new Map([...(l.limits.get(fid) ?? new Map<string, number>())].filter(([, n]) => n > 0));

    return layout(b, v, this.filterText, {
      folded: v ? l.folded.get(v.id) ?? [] : [], lanesFolded: v ? l.lanes.get(v.id) ?? [] : [], limits,
    }, { me: b.viewer ?? this.list?.viewer });
  }

  /** The grid j / k walk (carrying: as it would look after the drop). */
  grid(lay: Layout): readonly (readonly Item[])[] {
    const g = grid(lay);

    return this.carrying ? carried(g, this.carrying) : g;
  }

  foldedCols(lay: Layout): boolean[] {
    return lay.columns.map((c) => c.folded);
  }

  at(lay: Layout | null = this.lay()): At {
    if (!lay) return { col: 0, row: -1 };

    const g = this.grid(lay);

    if (this.carrying) return { col: this.carrying.col, row: this.carrying.row };

    const f = this.sel ? find(g, this.sel) : null;

    if (f) {
      this.selCol = f.col;

      return f;
    }

    const col = Math.min(this.selCol, Math.max(0, g.length - 1));

    return { col, row: g[col]?.length ? 0 : -1 };
  }

  current(lay: Layout | null = this.lay()): Item | null {
    if (!lay) return null;

    const a = this.at(lay);

    return this.grid(lay)[a.col]?.[a.row] ?? null;
  }

  /** After the filter or the board changed: the selection stays on its card, or the column's first. */
  keepSel(): void {
    const lay = this.lay();

    if (!lay) return;

    const g = this.grid(lay);

    if (this.sel && find(g, this.sel)) return;

    const col = Math.min(this.selCol, Math.max(0, g.length - 1));

    this.sel = g[col]?.[0]?.id ?? null;
  }

  // ---- reading

  async poll({ all = false }: ReadOptions, cx: Context | null): Promise<void> {
    const repo = this.app.repo;

    if (!repo) return;

    const now = Date.now();

    try {
      if (all || !this.list || now - this.listAt >= LIST_EVERY) {
        const l = parseProjectList(await graphql(repo, projectListQuery(repo), isProjectListAnswer, [], { partial: true }));

        if (this.app.repo !== repo) return;

        this.list = l;
        this.listAt = Date.now();
        this.scope = null;

        if (!this.pick || !l.projects.some((p) => p.id === this.pick)) {
          const was = this.remembered();

          this.pick = was && l.projects.some((p) => p.id === was) ? was : (l.projects.find((p) => !p.closed) ?? l.projects[0])?.id ?? null;
        }

        cx?.notify();
      }

      const pid = this.pick;

      if (!pid) return;

      const kept = this.boards.get(pid);
      // Read when asked, when old, or once an edit GitHub took has settled.
      const fresh = kept && now - kept.at < SLOW - 500, settled = this.settleAt && now >= this.settleAt;

      if (!all && fresh && !settled) return;

      await this.readBoard(repo, pid);

      // Reopened with the detail docked: its card is read with the board.
      const it = this.current();

      if (this.detailOpen && it) await this.readDetail(it, null);
    } catch (err) {
      const s = scopeProblem(err instanceof Error ? err.message : String(err));

      if (s) {
        this.scope = s;

        return;
      }

      throw err;
    }
  }

  async readBoard(repo: Repo, pid: string): Promise<void> {
    const started = Date.now();
    let b = parseBoard(await graphql(repo, boardQuery(true), isBoardAnswer, [["id", pid]]));

    if (!b) throw new Error("GitHub didn't find that project (it may be gone, or private to others).");

    for (let more = b.more; more; more = b.more) b = addPage(b, await graphql(repo, boardQuery(false), isBoardAnswer, [["id", pid], ["after", more]]));

    if (this.app.repo !== repo) return;

    this.boards.set(pid, { board: b, at: Date.now() });
    this.settleAt = 0;
    this.error = "";
    // Edits GitHub took before this read began are in it now.
    this.pending = this.pending.filter((p) => !(p.state === "done" && (p.doneAt ?? 0) <= started));
    this.keepSel();

    if (this.boards.size > LIMITS.boards * 2) this.boards = newest(this.boards, LIMITS.boards);
  }

  /** The selected card's body and comments, read once it's opened. */
  readDetail(item: Item, cx: Context | null): Promise<void> | undefined {
    const id = item.content.id, repo = this.app.repo;

    if (!id || !repo || this.details.get(id)?.busy) return undefined;

    const kept = this.details.get(id);

    if (kept && Date.now() - kept.at < 60000) return undefined;

    this.details.set(id, { ...kept, busy: true, at: kept?.at ?? 0 });

    const read = (async () => {
      try {
        this.details.set(id, { d: parseDetail(await graphql(repo, detailQuery, isDetailAnswer, [["id", id]])), at: Date.now() });
      } catch (err) {
        this.details.set(id, { error: err instanceof Error ? err.message : String(err), at: Date.now() });
      }
    })();

    if (cx) this.app.spawn(cx, () => read);

    return read;
  }

  async choicesFor(full: string | null): Promise<Choices> {
    const repo = this.app.repo;

    if (!full || !repo) return { labels: [], users: [] };

    const had = this.choices.get(full);

    if (had) return had;

    const c = parseChoices(await graphql(repo, choicesQuery(full), isChoicesAnswer));

    this.choices.set(full, c);

    return c;
  }

  // ---- edits: shown at once, sent, rolled back when refused

  /** The note for an edit GitHub refused. */
  refused(cause: unknown): void {
    const message = cause instanceof Error ? cause.message : String(cause);
    const s = scopeProblem(message, true);

    this.app.note = noteOf(s ? s.text : `GitHub refused it: ${message}`, "failed");
    this.keepSel();
  }

  /** Lays `op` over the board and sends it (`send`, with the repo). Returns its pending entry (null: nothing laid over). */
  edit(op: Op | null, send: (repo: Repo) => Promise<void>, ok: string | null, cx: Context): Pending | null {
    const entry: Pending | null = op ? { id: ++this.seq, op, state: "sending", at: Date.now() } : null;

    if (entry) this.pending.push(entry);

    this.send(entry ? [entry] : [], send, ok, cx);

    return entry;
  }

  editBatch(ops: readonly Op[], send: (repo: Repo) => Promise<void>, ok: string, cx: Context): void {
    const entries = ops.map((op): Pending => ({ id: ++this.seq, op, state: "sending", at: Date.now() }));

    this.pending.push(...entries);
    this.send(entries, send, ok, cx);
  }

  /** Sends edits laid over the board: done, they wait for a read; refused, they go (the rollback). */
  send(entries: readonly Pending[], send: (repo: Repo) => Promise<void>, ok: string | null, cx: Context): void {
    const repo = this.app.repo;

    this.app.note = noteOf("…", "working");
    cx.spawn(async (cx) => {
      try {
        if (!repo) throw new Error("No repo.");

        await send(repo);

        for (const e of entries) {
          e.state = "done";
          e.doneAt = Date.now();
        }

        this.app.note = ok ? noteOf(ok, "done") : null;
        this.settleAt = Date.now() + SETTLE;
        this.app.next = Math.min(this.app.next, this.settleAt);
      } catch (err) {
        this.pending = this.pending.filter((p) => !entries.includes(p)); // the rollback
        this.refused(err);
      }

      cx.notify();
    });
  }

  gql(query: string): (repo: Repo) => Promise<void> {
    return (repo) => mutate(repo, query);
  }

  setField(item: Item, field: Field, choice: string | null, cx: Context): void {
    const b = this.board();

    if (!b) return;

    const value = valueFor(field, choice);

    if (choice !== null && choice !== "" && !value) {
      this.app.note = noteOf(`That isn't a ${field.type} for ${field.name}.`, "failed");

      return;
    }

    this.edit({ kind: "field", item: item.id, field: field.id, value }, this.gql(setFieldMutation(b.project.id, item.id, field, value)),
      `${field.name}: ${value ? valueText(field, value) : "cleared"}`, cx);
  }

  /** Drops the carried card where it is. */
  dropCard(cx: Context): void {
    const lay = this.lay(), c = this.carrying, b = this.board();

    this.carrying = null;

    if (!lay || !c || !b) return;

    const plan = drop(grid(lay), c, lay.columns, { sorted: lay.sorted });

    if (!plan) return;

    const pid = b.project.id;
    const item = b.items.find((i) => i.id === plan.id);
    const col = lay.columns[c.col];
    const field = lay.field;
    const ops: Op[] = [];
    // Both edits are one move: shown together, rolled back together.
    const sends: string[] = [];

    if (plan.column !== undefined && field) {
      const value = plan.column ? valueFor(field, plan.column) : null;

      ops.push({ kind: "field", item: plan.id, field: field.id, value });
      sends.push(setFieldMutation(pid, plan.id, field, value));
    }

    if (plan.afterId !== undefined) {
      ops.push({ kind: "position", item: plan.id, afterId: plan.afterId });
      sends.push(positionMutation(pid, plan.id, plan.afterId));
    }

    this.sel = plan.id;
    this.selCol = c.col;
    this.editBatch(ops, async (repo) => {
      for (const q of sends) await mutate(repo, q);
    }, plan.column !== undefined ? `Moved ${label(item)} to ${col?.name ?? ""}` : `Moved ${label(item)}`, cx);
  }

  addDraft(cx: Context): void {
    const title = this.draft.value().trim(), lay = this.lay(), b = this.board();

    this.typing = null;
    this.draft.set_value("");
    this.app.focusSelf();

    if (!title || !lay || !b) return;

    const col = lay.columns[this.at(lay).col];
    const temp = `temp-${++this.seq}`;
    const field = lay.field;
    const start = col?.key && field ? valueFor(field, col.key) : null;
    const values = new Map<string, FieldValue>(field && start ? [[field.id, start]] : []);

    const item: Item = {
      id: temp, db: null, type: "DRAFT_ISSUE", archived: false, values,
      content: { kind: "draft", id: null, number: null, title, state: "DRAFT", isDraft: false, url: null, repo: null, assignees: [], labels: [], milestone: null },
    };

    this.sel = temp;

    let entry: Pending | null = null;

    entry = this.edit({ kind: "add", item }, async (repo) => {
      const r = await graphql(repo, addDraftMutation(b.project.id, title), isAddedDraft);
      const made = r.addProjectV2DraftIssue?.projectItem;
      const id = made?.id;

      if (id && col?.key && field) await mutate(repo, setFieldMutation(b.project.id, id, field, values.get(field.id)));

      if (!id) return;

      // The real item takes the temporary one's place in what's shown until the next read.
      if (entry) entry.op = { kind: "add", item: { ...item, id, db: made.databaseId ?? null, content: { ...item.content, id: made.content?.id ?? null } } };

      if (this.sel === temp) this.sel = id;
    }, `Added “${title}”${col ? ` to ${col.name}` : ""}`, cx);
  }

  archive(item: Item, cx: Context): void {
    const b = this.board();

    if (!b) return;

    this.app.ask(`Archive ${label(item)} “${item.content.title}” from ${b.project.title}?`, () => {
      const lay = this.lay();
      const g = lay ? this.grid(lay) : [], a = find(g, item.id);
      const next = a ? g[a.col]?.[a.row + 1] ?? g[a.col]?.[a.row - 1] : null;

      this.sel = next?.id ?? null;
      this.edit({ kind: "archive", item: item.id }, this.gql(archiveMutation(b.project.id, item.id)), `Archived ${label(item)}`, cx);
      cx.notify();
    });
  }

  // ---- moves

  select(lay: Layout, a: At, cx: Context | null): void {
    const g = this.grid(lay);

    this.selCol = a.col;
    this.sel = g[a.col]?.[a.row]?.id ?? null;
    this.follow(lay, a);

    if (this.detailOpen) {
      this.scrollY = 0;

      const it = this.current(lay);

      if (it) void this.readDetail(it, cx);
    }
  }

  /** Keeps the selected column and card on screen. */
  follow(lay: Layout, a: At): void {
    const fit = this.fits(lay);

    if (a.col < this.first) this.first = a.col;

    while (a.col >= this.first + fit && this.first < lay.columns.length - 1) this.first++;

    const h = this.handles[a.col];

    if (h && a.row >= 0) h.scroll_to_item(this.rowIndex(lay, a), "center");
  }

  /** The list row a grid position is drawn at (lane headers count). */
  rowIndex(lay: Layout, a: At): number {
    const rows = this.rows(lay, a.col);
    const id = this.grid(lay)[a.col]?.[a.row]?.id;

    return Math.max(0, rows.findIndex((r) => "item" in r && r.item.id === id));
  }

  /** How many columns fit side by side. */
  fits(lay: Layout): number {
    const avail = this.width - (this.detailOpen ? DETAIL_W + GAP : 0);
    const folded = lay.columns.filter((c) => c.folded).length;

    return Math.max(1, Math.floor((avail - folded * (FOLD_W + GAP)) / (200 + GAP)));
  }

  /** Keys while this tab shows; true when one was used ("typing": an Input's). */
  key(k: string, e: KeyEvent, cx: Context): boolean | "typing" {
    if (this.typing) return this.typingKey(k);

    if (this.menu) return this.menuKey(this.menu, k, e, cx);

    const b = this.board(), lay = this.lay(b);

    if (!b || !lay) {
      if (k === "p" && this.list?.projects.length) {
        this.openProjects();

        return true;
      }

      return false;
    }

    const a = this.at(lay), item = this.current(lay);
    const dir = DIRS.get(k);

    if (this.carrying) {
      if (dir) {
        this.carrying = carry(grid(lay), this.carrying, dir, { folded: this.foldedCols(lay), sorted: lay.sorted });
        this.follow(lay, this.at(lay));
      } else if (k === "enter" || k === "space" || k === "m") this.dropCard(cx);
      else if (k === "escape") this.carrying = null;

      return true; // nothing else while a card is in hand
    }

    if (this.focus === "detail") {
      if (k === "j" || k === "down") {
        this.scroll(60);

        return true;
      }

      if (k === "k" || k === "up") {
        this.scroll(-60);

        return true;
      }

      if (k === "h" || k === "left" || k === "tab") {
        this.focus = "board";

        return true;
      } // shift-tab too

      if (k === "escape") {
        this.focus = "board";
        this.detailOpen = false;

        return true;
      }
    }

    if (dir) {
      const next = step(this.grid(lay), a, dir, this.foldedCols(lay));

      if (next) this.select(lay, next, cx);
    } else if (k === "J" || k === "pagedown") this.scroll(Math.max(80, this.viewH / 2));
    else if (k === "K" || k === "pageup") this.scroll(-Math.max(80, this.viewH / 2));
    else if (k === "enter" && item) {
      if (this.detailOpen && this.focus === "board") this.focus = "detail";
      else {
        this.detailOpen = true;
        this.focus = "board";
        this.scrollY = 0;
        void this.readDetail(item, cx);
      }
    } else if (k === "tab" && this.detailOpen) this.focus = "detail";
    else if (k === "escape" && this.detailOpen) {
      this.detailOpen = false;
      this.focus = "board";
    } else if ((k === "space" || k === "m") && item) this.carrying = pickUp(grid(lay), a);
    else if (k === "e" && item) this.openFields(item, cx);
    else if (k === "a") {
      this.typing = "draft";
      this.draft.set_value("");
      this.draft.focus();
    } else if (k === "/") {
      this.typing = "filter";
      this.filter.focus();
    } else if (k === "v") this.openViews(b);
    else if (k === "p") this.openProjects();
    else if (k === "o") {
      const url = item ? itemUrl(b, this.view(b), item) : b.project.url;

      if (url) this.app.openUrl(url, cx);
    } else if (k === "x" && item) this.archive(item, cx);
    else if (k === "i" && item?.content.kind === "draft") this.openConvert(b, item);
    else if (k === "-") this.toggleFold(lay, a.col);
    else if (k === "z" && lay.lane) this.toggleLane(lay, item);
    else if (k === "w" && lay.columns[a.col]) this.openLimit(lay, a.col);
    else if (k === "escape" && this.filterText) {
      this.filter.set_value("");
      this.filterText = "";
      this.keepSel();
    } else return false;

    return true;
  }

  /** L: the links in the open card's detail (its body and comments). */
  links(): WebLink[] {
    const b = this.board(), item = this.detailOpen && b ? this.current(this.lay(b)) : null;
    const d = item?.content.id ? this.details.get(item.content.id)?.d : null;

    return d ? linksIn([d.body, ...d.comments.map((c) => c.body)]) : [];
  }

  typingKey(k: string): boolean | "typing" {
    if (k === "escape") {
      if (this.typing === "filter" && !this.filter.value()) this.filterText = "";

      if (this.typing === "draft") this.draft.set_value("");

      if (this.typing === "value") this.menu = this.menu?.kind === "value" ? this.menu.back ?? null : null;

      this.typing = null;
      this.app.focusSelf();

      return true;
    }

    if (k === "enter") return "typing"; // the Input's submit does it

    if (this.typing === "filter" && (k === "down" || k === "tab")) {
      this.typing = null;
      this.app.focusSelf();

      return true;
    }

    return "typing";
  }

  /** `key` in or out of a list of keys. */
  flipped(list: readonly string[] | undefined, key: string): string[] {
    const f = new Set(list ?? []);

    if (f.has(key)) f.delete(key);
    else f.add(key);

    return [...f];
  }

  toggleFold(lay: Layout, col: number): void {
    const c = lay.columns[col], v = this.view();

    if (!c || !v) return;

    this.setLocal((l) => ({ ...l, folded: new Map(l.folded).set(v.id, this.flipped(l.folded.get(v.id), c.key)) }));

    if (!c.folded) {
      const next = step(this.grid(lay), { col, row: 0 }, "right", lay.columns.map((x, i) => x.folded || i === col));
      const now = this.lay();

      if (next && now && next.col !== col) this.select(now, next, null);
    }
  }

  toggleLane(lay: Layout, item: Item | null): void {
    const v = this.view();
    const lane = item ? lay.lanes.find((l) => l.cells.some((c) => c.some((i) => i.id === item.id))) : lay.lanes.find((l) => l.folded);
    const key = lane?.key;

    if (key === undefined || key === null || !v) return;

    this.setLocal((l) => ({ ...l, lanes: new Map(l.lanes).set(v.id, this.flipped(l.lanes.get(v.id), key)) }));
    this.keepSel();
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

    if (repo) this.setPrefs({ ...p, repos: new Map(p.repos).set(repoKey(repo), id) });

    this.app.refresh(cx, { all: false });
  }

  // ---- menus: lazygit's, a list with j / k, enter, esc

  openProjects(): void {
    const ps = this.list?.projects ?? [];

    this.menu = {
      kind: "pick", title: "Projects", at: Math.max(0, ps.findIndex((p) => p.id === this.pick)),
      rows: ps.map((p) => ({ label: p.title, right: `${p.closed ? "closed · " : ""}${FROM[p.from]} · ${p.owner ?? ""}/#${p.number ?? ""}`, dim: p.closed, go: (cx) => this.setProject(p.id, cx) })),
    };
  }

  openViews(b: Board): void {
    const vs = b.views, cur = this.view(b);

    this.menu = {
      kind: "pick", title: "Views", at: Math.max(0, vs.findIndex((v) => v.id === cur?.id)),
      rows: vs.map((v) => ({ label: v.name, right: `${v.layout}${v.filter ? ` · ${v.filter}` : ""}`, dim: v.layout !== "board", go: () => this.setView(v.id) })),
    };
  }

  openConvert(b: Board, item: Item): void {
    const full = this.app.repo?.full ?? "";
    const repos = [...b.repos];
    const repoId = this.list?.repoId;

    if (repoId && !repos.some((r) => r.id === repoId)) repos.unshift({ id: repoId, full });

    this.menu = {
      kind: "pick", title: `Make “${item.content.title}” an issue in`, at: Math.max(0, repos.findIndex((r) => r.full === full)),
      rows: repos.map((r) => ({ label: r.full, go: (cx) => this.edit(null, this.gql(convertMutation(item.id, r.id)), `Made an issue in ${r.full}`, cx) })),
    };
  }

  openLimit(lay: Layout, col: number): void {
    const c = lay.columns[col];

    if (!c) return;

    this.menu = {
      kind: "value", title: `Limit for ${c.name} (cards; empty: none)`, go: (text) => {
        const n = Math.max(0, Math.floor(Number(text) || 0));
        const fid = lay.field?.id ?? "";

        this.setLocal((l) => {
          const limits = new Map(l.limits.get(fid) ?? []);

          if (n) limits.set(c.key, n);
          else limits.delete(c.key);

          return { ...l, limits: new Map(l.limits).set(fid, limits) };
        });
      },
    };
    this.valueInput.set_value(c.limit ? String(c.limit) : "");
    this.typing = "value";
    this.valueInput.focus();
  }

  /** e: the card's fields on the left, the chosen one's values on the right. */
  openFields(item: Item, cx: Context): void {
    const b = this.board();

    if (!b) return;

    const fields = editableFields(b, item);

    if (!fields.length) return;

    this.menu = { kind: "fields", item: item.id, at: 0, side: "fields", opt: 0, fields: fields.map((f) => f.id) };

    const repo = item.content.repo ?? this.app.repo?.full ?? null;

    if (fields.some((f) => f.type === "labels" || f.type === "assignees")) {
      this.app.spawn(cx, async () => {
        try {
          await this.choicesFor(repo);
        } catch {
          /* the menu says it */
        }
      });
    }
  }

  /** The values the field menu offers for one field: [{ id, label, color, on }]. */
  options(_b: Board, item: Item, f: Field): Opt[] {
    const v = item.values.get(f.id);

    if (f.type === "single") return [...f.options.map((o) => ({ id: o.id, label: o.name, color: ansiKey(o.color), on: selectOf(v)?.optionId === o.id })), { id: null, label: "clear", dim: true }];

    if (f.type === "iteration") {
      const cur = v && "iterationId" in v ? v.iterationId : null;

      return [...f.iterations.filter((i) => !i.done).map((i) => ({ id: i.id, label: i.title, right: i.startDate, on: cur === i.id })), { id: null, label: "clear", dim: true }];
    }

    if (f.type === "labels" || f.type === "assignees") {
      const c = this.choices.get(item.content.repo ?? this.app.repo?.full ?? "");

      if (!c) return [{ id: undefined, label: "reading…", dim: true }];

      if (f.type === "labels") {
        const have = item.content.labels.map((l) => l.name);

        return c.labels.map((l) => ({ id: l.id, label: l.name, hex: l.color, on: have.includes(l.name), toggle: true }));
      }

      const have = item.content.assignees.map((a) => a.login);

      return c.users.map((u) => ({ id: u.id, label: u.login, on: have.includes(u.login), toggle: true }));
    }

    const edit: Opt = { id: "edit", label: valueText(f, v) || (f.type === "title" ? item.content.title : "(empty)"), right: "enter edits", input: true };

    return f.type === "title" ? [edit] : [edit, { id: null, label: "clear", dim: true }];
  }

  /** The fields a fields menu lists, as the board has them. */
  menuFields(b: Board, ids: readonly string[]): Field[] {
    return ids.flatMap((id) => {
      const f = b.fields.find((x) => x.id === id);

      return f ? [f] : [];
    });
  }

  menuKey(m: Menu, k: string, e: KeyEvent, cx: Context): boolean {
    if (k === "escape" || k === "q") {
      this.menu = null;

      return true;
    }

    if (m.kind === "pick") {
      if (k === "j" || k === "down") m.at = Math.min(m.rows.length - 1, m.at + 1);
      else if (k === "k" || k === "up") m.at = Math.max(0, m.at - 1);
      else if (k === "enter" || k === "space") {
        const r = m.rows[m.at];

        this.menu = null;
        r?.go(cx);
      }

      return true;
    }

    if (m.kind !== "fields") return true;

    const b = this.board(), item = b?.items.find((i) => i.id === m.item);

    if (!b || !item) {
      this.menu = null;

      return true;
    }

    const fields = this.menuFields(b, m.fields);
    const f = fields[m.at], opts = f ? this.options(b, item, f) : [];

    // tab / shift-tab: the next / previous field, wrapping, as in every form (form-keys.ts).
    if (k === "tab" || k === "shift-tab") {
      const by = k === "tab" && !e.modifiers.shift ? 1 : -1;

      m.at = (((m.at + by) % fields.length) + fields.length) % fields.length;
      m.side = "fields";

      return true;
    }

    if (m.side === "fields") {
      if (k === "j" || k === "down") m.at = Math.min(fields.length - 1, m.at + 1);
      else if (k === "k" || k === "up") m.at = Math.max(0, m.at - 1);
      else if (k === "l" || k === "right" || k === "enter" || k === "space") {
        m.side = "opts";
        m.opt = Math.max(0, opts.findIndex((o) => o.on));
      }

      return true;
    }

    if (k === "j" || k === "down") m.opt = Math.min(opts.length - 1, m.opt + 1);
    else if (k === "k" || k === "up") m.opt = Math.max(0, m.opt - 1);
    else if (k === "h" || k === "left") m.side = "fields";
    else if ((k === "enter" || k === "space") && f) this.choose(item, f, opts[m.opt], cx);

    return true;
  }

  choose(item: Item, f: Field, o: Opt | undefined, cx: Context): void {
    if (!o || o.id === undefined) return;

    if (o.input) {
      const v = item.values.get(f.id);

      const text = f.type === "title" ? item.content.title
        : f.type === "date" ? (v && "date" in v ? v.date : "")
        : f.type === "number" ? (v && "number" in v ? String(v.number) : "")
        : v && "text" in v ? v.text : "";

      this.valueInput.set_value(text);

      const back = this.menu;

      this.menu = {
        kind: "value", back, title: `${f.name}${f.type === "date" ? " (YYYY-MM-DD)" : ""}`, go: (typed) => {
          if (f.type === "title") this.retitle(item, typed, cx);
          else this.setField(item, f, typed.trim(), cx);
        },
      };
      this.typing = "value";
      this.valueInput.focus();

      return;
    }

    if (o.toggle) {
      this.toggle(item, f, o, cx);

      return;
    }

    this.setField(item, f, o.id, cx);

    if (this.menu?.kind === "fields") this.menu.side = "fields";
  }

  retitle(item: Item, text: string, cx: Context): void {
    const title = text.trim();

    if (!title || !item.content.id) return;

    this.edit({ kind: "content", item: item.id, patch: { title } }, this.gql(draftMutation(item.content.id, { title })), "Renamed the draft", cx);
  }

  /** A label or an assignee on or off. */
  toggle(item: Item, f: Field, o: Opt, cx: Context): void {
    const c = item.content, id = o.id ?? "";

    if (!c.id) return;

    if (f.type === "labels") {
      const labels = o.on ? c.labels.filter((l) => l.name !== o.label) : [...c.labels, { id: o.id ?? null, name: o.label, color: o.hex ?? "666666" }];
      const q = toggleMutation(c.id, "labels", o.on ? [] : [id], o.on ? [id] : []);

      if (q) this.edit({ kind: "content", item: item.id, patch: { labels } }, this.gql(q), `${o.on ? "Took off" : "Put on"} ${o.label}`, cx);

      return;
    }

    const assignees = o.on ? c.assignees.filter((a) => a.login !== o.label) : [...c.assignees, { id: o.id ?? null, login: o.label }];
    const q = c.kind === "draft" ? draftMutation(c.id, { assigneeIds: assignees.flatMap((a) => (a.id ? [a.id] : [])) }) : toggleMutation(c.id, "assignees", o.on ? [] : [id], o.on ? [id] : []);

    if (q) this.edit({ kind: "content", item: item.id, patch: { assignees } }, this.gql(q), `${o.on ? "Unassigned" : "Assigned"} ${o.label}`, cx);
  }

  submitValue(cx: Context): void {
    const m = this.menu, text = this.valueInput.value();

    this.typing = null;
    this.app.focusSelf();
    this.menu = m?.kind === "value" ? m.back ?? null : null;

    if (this.menu?.kind === "fields") this.menu.side = "fields";

    if (m?.kind === "value") m.go(text);

    cx.notify();
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

    if (this.typing) return [["enter", "save"], ["esc", "cancel"]];

    if (this.menu?.kind === "fields") return this.menu.side === "fields" ? [["tab ⇧tab", "field"], ["l enter", "values"], ["esc", "close"]] : [["j/k", "value"], ["enter", "set"], ["tab ⇧tab", "field"], ["h", "fields"], ["esc", "close"]];

    if (this.menu) return [["j/k", "move"], ["enter", "choose"], ["esc", "close"]];

    if (this.carrying) return [["h/l", "column"], ["j/k", "move it"], ["enter", "drop"], ["esc", "put back"]];

    if (this.focus === "detail") return [["j/k", "scroll"], ["e", "edit fields"], ["o", "on GitHub"], ["h", "board"], ["esc", "close"], ["?", "keys"]];

    if (this.scope) return [["r", "read again"], ["?", "keys"]];

    if (!this.board()) return [["p", "projects"], ["r", "refresh"], ["?", "keys"]];

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

    if (this.scope) {
      const can = this.scope.need === "project" ? "change" : "read";

      return v_flex().size_full().items_center().justify_center().gap(10).text_size(11)
        .child(svg(`${ART}/moon-1.svg`).w(40).h(40).text_color(t.ansi8).opacity(0.6))
        .child(div().text_color(t.foreground).child("Projects need another permission"))
        .child(div().text_center().max_w(420).text_color(t.ansi8).child(`gh's token can't ${can} GitHub Projects. Run this in a terminal, then press r here:`))
        .child(h_flex().relative().px(10).h(24).items_center().text_size(12).child(dither(t.ansi0, 1)).child(div().relative().text_color(t.accent).child(this.scope.command)));
    }

    if (!this.list && !this.base()) return empty(t, "Reading projects…", null, { moon: 3 });

    if (!this.pick) return empty(t, "No projects here", `Neither ${this.app.repo?.full ?? "this repo"} nor its owner has a project you can see. Link one on GitHub, then r.`, { moon: 0 });

    const b = this.board();

    if (!b) return v_flex().size_full().child(this.bar(t, null, null)).child(empty(t, "Reading the board…", this.list?.projects.find((p) => p.id === this.pick)?.title ?? "", { moon: 4 }));

    const lay = this.lay(b);

    if (!lay) return empty(t, "Reading the board…", null, { moon: 4 });

    const menu = this.menu;

    const body = h_flex().flex_1().min_h(0).gap(GAP).items_start()
      .child(this.columns(t, b, lay, size))
      .when(this.detailOpen, (el) => el.child(this.detail(t, b, lay)));

    return v_flex().size_full().relative()
      .child(this.bar(t, b, lay))
      .child(body)
      .when(menu !== null, (el) => (menu ? el.child(this.menuPanel(t, b, menu)) : el));
  }

  /** The project, its views and the filter. */
  bar(t: Theme, b: Board | null, lay: Layout | null): Element {
    const p = this.list?.projects.find((x) => x.id === this.pick) ?? b?.project;
    const views = b ? this.views(b) : [], cur = b ? this.view(b) : null;

    const viewChips = views.map((v) => h_flex().id(`pv-${v.id}`).relative().h(20).px(7).flex_none().items_center().text_size(11)
      .text_color(v.id === cur?.id ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
      .on_mouse_down("left", stop).on_click((_e, cx) => {
        this.setView(v.id);
        cx.notify();
      })
      .when(v.id === cur?.id, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)))
      .child(div().relative().child(v.name)));

    const tokens = filterTokens(this.filterText);
    const typing = this.typing === "filter";

    const filter = h_flex().id("pf-filter").relative().flex_1().min_w(120).h(22).px(8).gap(6).items_center().text_size(11)
      .border(1).border_color(typing ? t.accent : t.ansi0)
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
        this.menu = null;
        this.typing = "filter";
        this.filter.focus();
        cx.notify();
      })
      .child(div().flex_none().text_color(typing ? t.accent : t.dim).child("/"))
      .child(typing ? Input.new(this.filter).flex_1().min_w(0).h_full().text_size(11).text_color(t.foreground)
        : h_flex().flex_1().min_w(0).gap(6).overflow_hidden().children(tokens.length ? tokens.map((k, i) => div().id(`tok-${i}`).flex_none().text_color(k.kind === "key" ? t.ansi5 : t.foreground).child(k.text))
          : [div().text_color(t.dim).truncate().child("filter")]))
      .when(lay !== null, (el) => (lay ? el.child(div().flex_none().text_color(t.dim).child(lay.shown === lay.total ? `${lay.total}` : `${lay.shown} of ${lay.total}`)) : el));

    return h_flex().h(30).flex_none().gap(8).items_center().pb(6)
      .child(h_flex().id("pf-project").flex_none().gap(6).items_center().text_size(11).max_w(300)
        .on_mouse_down("left", stop).on_click((_e, cx) => {
          this.openProjects();
          cx.notify();
        })
        .child(div().text_color(t.accent).child("p"))
        .child(div().truncate().text_color(t.foreground).hover((s) => s.text_color(t.accent)).child(p?.title ?? "Project"))
        .when(Boolean(p?.number), (el) => el.child(div().flex_none().text_color(t.dim).child(`#${p?.number ?? ""}`))))
      .child(div().w(2).h(14).relative().flex_none().child(dither(t.ansi0, 1)))
      .child(h_flex().flex_none().gap(2).children(viewChips))
      .child(filter);
  }

  /** The rows a column draws: lane headers, cards and the gap that keeps a lane as tall as in the
   *  tallest column, so swimlanes line up across the board ({ lane } | { item } | { pad }). */
  rows(lay: Layout, ci: number): ColumnRow[] {
    const g = this.grid(lay)[ci] ?? [];

    if (!lay.lane) return g.map((item) => ({ item }));

    const where = new Map(lay.lanes.flatMap((l) => l.cells.flatMap((c) => c.map((i) => [i.id, l.key] as const))));
    const all = this.grid(lay), chars = this.chars, fields = this.fields;

    const height = (items: readonly Item[]) => {
      let n = 0;

      for (const i of items) n += this.cardH(i, chars, fields);

      return n;
    };

    const out: ColumnRow[] = [];

    for (const lane of lay.lanes) {
      const inLane = (col: number) => (all[col] ?? []).filter((i) => where.get(i.id) === lane.key);
      const items = inLane(ci);

      out.push({ lane, n: lane.folded ? lane.cells[ci]?.length ?? 0 : items.length });

      if (lane.folded) continue;

      for (const item of items) out.push({ item });

      const tallest = Math.max(0, ...lay.columns.map((c, k) => (c.folded ? 0 : height(inLane(k)))));
      const gap = tallest - height(items);

      if (gap > 0) out.push({ pad: gap, key: lane.key });
    }

    return out;
  }

  columns(t: Theme, b: Board, lay: Layout, size: Size): Element {
    const avail = size.width - (this.detailOpen ? DETAIL_W + GAP : 0);
    const cols = lay.columns;

    if (!cols.length) return div().flex_1().h_full().child(empty(t, "This view has no columns", "Its column field has no options yet.", { moon: 0 }));

    const fit = this.fits(lay);

    this.first = Math.max(0, Math.min(this.first, cols.length - 1));

    const shown: number[] = [];
    let open = 0;

    for (let i = this.first; i < cols.length; i++) {
      if (!cols[i]?.folded) {
        if (open >= fit) break;

        open++;
      }

      shown.push(i);
    }

    const folded = shown.filter((i) => cols[i]?.folded).length;
    const w = Math.max(200, Math.floor((avail - folded * (FOLD_W + GAP) - Math.max(0, open - 1) * GAP) / Math.max(1, open)));
    const a = this.at(lay), fields = cardFields(b, this.view(b), lay);
    // Every open column is as wide, so a card is as tall in each (the swimlanes line up).
    const cw = Math.min(w, 480);

    this.chars = Math.max(8, Math.floor((cw - 24) / CHAR));
    this.fields = fields;

    const more = (n: number, side: string) => div().id(`pmore-${side}`).flex_none().w(14).h_full().flex().items_center().justify_center().text_size(10).text_color(t.dim).child(`${n}`);
    const last = shown.at(-1) ?? cols.length - 1;

    return h_flex().flex_1().min_w(0).h_full().gap(GAP)
      .when(this.first > 0, (el) => el.child(more(this.first, "l")))
      .children(shown.map((ci) => (cols[ci]?.folded ? this.foldStrip(t, lay, ci) : this.column(t, b, lay, ci, cw, a, fields))))
      .when(shown.length > 0 && last < cols.length - 1, (el) => el.child(more(cols.length - 1 - last, "r")));
  }

  foldStrip(t: Theme, lay: Layout, ci: number): Element {
    const c = lay.columns[ci];

    if (!c) return div();

    const letters = Array.from(c.name.slice(0, 14), (ch, i) => div().id(`pfl-${i}`).h(11).text_size(10).text_color(t.dim).child(ch === " " ? " " : ch));

    return v_flex().id(`pfold-${ci}`).w(FOLD_W).flex_none().h_full().items_center().pt(6).gap(6).border(1).border_color(t.ansi0)
      .hover((s) => s.border_color(t.ansi8))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => {
        this.toggleFold(lay, ci);
        this.selCol = ci;
        this.sel = null;
        this.keepSel();
        this.app.focusSelf();
        cx.notify();
      })
      .child(pip(t, "done", 7).text_color(ansi(t, c.color)))
      .child(v_flex().items_center().children(letters))
      .child(div().text_size(10).text_color(c.limit && c.count > c.limit ? t.blocked : t.dim).child(String(c.count)));
  }

  column(t: Theme, b: Board, lay: Layout, ci: number, w: number, a: At, fields: readonly Field[]): Element {
    const c = lay.columns[ci];

    if (!c) return div();

    const active = a.col === ci && this.focus === "board";
    const over = c.limit !== null && (c.count + (this.carrying && this.carrying.col === ci && this.carrying.from.col !== ci ? 1 : 0)) > c.limit;
    const edge = over ? t.blocked : active ? t.accent : t.ansi0;
    const rows = this.rows(lay, ci);
    const chars = this.chars;
    const heights = rows.map((r) => ("lane" in r ? LANE_H : "pad" in r ? r.pad : this.cardH(r.item, chars, fields)));
    const count = c.limit ? `${c.count} / ${c.limit}` : String(c.count);

    const head = h_flex().id(`pch-${ci}`).relative().h(22).flex_none().px(8).gap(7).items_center().text_size(11)
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => {
        this.selCol = ci;
        this.sel = this.grid(lay)[ci]?.[0]?.id ?? null;
        this.app.focusSelf();
        cx.notify();
      })
      .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(edge, 1)))
      .child(pip(t, "done", 7).text_color(ansi(t, c.color)))
      .child(div().relative().flex_1().min_w(0).truncate().text_color(active ? t.foreground : t.muted).child(c.name))
      .child(div().relative().flex_none().text_color(over ? t.blocked : t.dim).child(count));

    const drafting = this.typing === "draft" && a.col === ci;
    const handle = this.handles[ci];

    const keyOf = (i: number) => {
      const r = rows[i];

      if (!r) return String(i);

      return "lane" in r ? `lane-${r.lane.key ?? ""}` : "pad" in r ? `pad-${r.key ?? ""}` : r.item.id;
    };

    const list = !rows.length ? div().flex_1().min_h(0).child(empty(t, this.filterText || this.view(b)?.filter ? "Nothing matches" : "Nothing here", this.carrying ? "enter drops it here" : this.filterText ? "esc clears the filter" : "a adds a draft · m carries a card here", { moon: ci % 2 ? 0 : 1, small: false }))
      : div().flex_1().min_h(0).pt(2).child(v_virtual_list(`pcol-${b.project.id}-${ci}`, rows.length, heights, keyOf,
        (range) => rows.slice(range.start, range.end).map((r, k) => ("lane" in r ? this.laneRow(t, r, ci, range.start + k)
          : "pad" in r ? div().id(`ppad-${ci}-${range.start + k}`).h(r.pad).w_full() : this.card(t, r.item, a, ci, chars, fields))))
        .on_item_click((key, cx) => this.clicked(lay, ci, key, cx))
        .size_full().when(handle !== undefined, (el) => (handle ? el.track_scroll(handle) : el)));

    return v_flex().id(`pcolumn-${ci}`).w(w).flex_none().h_full().min_h(0).border(1).border_color(edge)
      .on_mouse_down("left", (_e, cx) => {
        this.app.focusSelf();
        cx.stop_propagation();
      })
      .child(head)
      .when(drafting, (el) => el.child(h_flex().h(26).flex_none().mx(6).mt(4).px(6).gap(6).items_center().border(1).border_color(t.accent)
        .child(div().text_size(11).text_color(t.accent).child("+"))
        .child(Input.new(this.draft).flex_1().h_full().text_size(11).text_color(t.foreground))))
      .child(list);
  }

  clicked(lay: Layout, ci: number, key: string, cx: Context): void {
    if (key.startsWith("pad-")) return;

    if (key.startsWith("lane-")) {
      const lane = lay.lanes.find((l) => `lane-${l.key ?? ""}` === key);
      const v = this.view();
      const k = lane?.key;

      if (k !== undefined && k !== null && v) this.setLocal((l) => ({ ...l, lanes: new Map(l.lanes).set(v.id, this.flipped(l.lanes.get(v.id), k)) }));
    } else if (!this.carrying) {
      const again = this.sel === key;

      this.sel = key;
      this.selCol = ci;
      this.focus = "board";

      if (again || this.detailOpen) {
        this.detailOpen = true;
        this.scrollY = 0;

        const it = this.current(lay);

        if (it) void this.readDetail(it, cx);
      }
    }

    this.app.focusSelf();
    cx.notify();
  }

  laneRow(t: Theme, r: { readonly lane: Lane; readonly n: number }, ci: number, i: number): Element {
    return h_flex().id(`plane-${ci}-${i}`).relative().h(LANE_H).px(8).gap(6).items_center().text_size(10)
      .hover((s) => s.bg(`${t.ansi0}55`))
      .child(div().flex_none().text_color(r.lane.done ? t.dim : t.ansi6).child(`${r.lane.folded ? "+" : "−"} ${r.lane.name}`))
      .child(div().flex_none().text_color(t.dim).child(String(r.n)))
      .child(div().relative().flex_1().h(2).child(dither(t.ansi0, 1)));
  }

  cardH(item: Item, chars: number, fields: readonly Field[]): number {
    const lines = wrap(item.content.title, chars - numW(item)).length;

    return 6 + lines * LINE + (item.content.labels.length ? 20 : 0) + (this.metaShown(item, fields) ? 17 : 0) + 7;
  }

  metaShown(item: Item, fields: readonly Field[]): boolean {
    const c = item.content;

    return c.assignees.length > 0 || fields.some((f) => item.values.get(f.id)) || c.kind === "draft" || c.repo !== this.app.repo?.full || c.state === "CLOSED" || c.state === "MERGED";
  }

  card(t: Theme, item: Item, a: At, ci: number, chars: number, fields: readonly Field[]): Element {
    const c = item.content;
    const sel = item.id === this.sel && a.col === ci;
    const lifted = this.carrying?.id === item.id;
    const active = sel && this.focus === "board";
    const pending = this.pending.some((p) => p.state === "sending" && (p.op.kind === "add" ? p.op.item.id : p.op.item) === item.id);
    const lines = wrap(c.title, chars - numW(item));
    const num = c.kind === "draft" ? "draft" : c.number !== null ? `#${c.number}` : "";
    const state = c.state === "MERGED" ? (["merged", t.ansi5] as const) : c.state === "CLOSED" ? (["closed", t.blocked] as const) : null;
    const otherRepo = c.repo && c.repo !== this.app.repo?.full ? c.repo.split("/")[1] ?? null : null;

    const values = fields.flatMap((f) => {
      const v = item.values.get(f.id);

      return v ? [[f, v] as const] : [];
    });

    const titleColor = lifted || sel ? t.foreground : c.kind === "draft" ? t.dim : t.muted;

    return v_flex().id(`pcard-${item.id}`).relative().w_full().h(this.cardH(item, chars, fields)).pl(10).pr(8).pt(6).gap(4).flex_none()
      .hover((s) => s.bg(`${t.ansi0}55`))
      .when(sel && !lifted, (el) => el.children(band(t, active)))
      .when(lifted, (el) => el.border(1).border_color(t.accent).child(dither(`${t.accent}30`, 1)))
      .when(!sel && !lifted, (el) => el.child(div().absolute().left(8).right(8).top(0).h(1).child(dither(t.ansi0, 1))))
      .child(h_flex().relative().gap(7).items_start().text_size(12)
        .when(lifted, (el) => el.child(svg(`${ART}/wings.svg`).w(16).h(6).mt(4).flex_none().text_color(t.working).loop("opacity", { from: 0.3, to: 1, period: 700 })))
        .child(div().flex_none().text_color(sel || lifted ? t.accent : c.kind === "draft" ? t.dim : t.ansi8).child(num))
        .child(v_flex().flex_1().min_w(0).children(lines.map((l, i) => div().id(`pt-${i}`).h(LINE).truncate().text_color(titleColor).child(l)))))
      .when(c.labels.length > 0, (el) => el.child(h_flex().relative().gap(4).pl(2).h(16).overflow_hidden().children(c.labels.slice(0, 4).map((l, i) =>
        div().id(`pl-${i}`).relative().px(5).h(16).flex_none().flex().items_center().text_size(10).text_color(t.foreground)
          .child(dither(`#${l.color}88`, 1)).child(div().relative().child(l.name))))))
      .when(this.metaShown(item, fields), (el) => el.child(h_flex().relative().h(16).gap(6).pl(2).items_center().text_size(10).text_color(t.dim).overflow_hidden()
        .children(c.assignees.slice(0, 3).map((u, i) => avatar(t, u.login, i)))
        .when(c.assignees.length > 3, (e2) => e2.child(div().flex_none().child(`+${c.assignees.length - 3}`)))
        .when(state !== null, (e2) => (state ? e2.child(div().flex_none().text_color(state[1]).child(state[0])) : e2))
        .when(Boolean(otherRepo), (e2) => e2.child(div().flex_none().truncate().max_w(90).child(otherRepo ?? "")))
        .when(pending, (e2) => e2.child(div().flex_none().loop("opacity", { from: 0.3, to: 1, period: 900 }).child(pip(t, "working", 6))))
        .child(div().flex_1())
        .children(values.map(([f, v], i) => div().id(`pv-${i}`).flex_none().truncate().max_w(110).text_color(valueColor(t, f, v)).child(valueText(f, v))))));
  }

  /** The card docked right: its fields, its body (markdown) and the conversation. */
  detail(t: Theme, b: Board, lay: Layout): Element {
    const item = this.current(lay), active = this.focus === "detail";
    const edge = active ? t.accent : t.ansi0;

    const frame = (body: Element, right?: string) => v_flex().id("pdetail").w(DETAIL_W).flex_none().h_full().min_h(0).border(1).border_color(edge)
      .on_mouse_down("left", (_e, cx) => {
        this.focus = "detail";
        this.app.focusSelf();
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().relative().h(22).flex_none().px(8).gap(8).items_center().text_size(11)
        .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(edge, 1)))
        .child(div().relative().flex_1().text_color(active ? t.foreground : t.muted).child(item ? KIND_WORD[item.content.kind] : "Item"))
        .child(div().relative().flex_none().text_color(t.dim).child(right ?? "")))
      .child(body);

    if (!item) return frame(empty(t, "Nothing selected", null, { moon: 0, small: true }));

    const c = item.content, kept = c.id ? this.details.get(c.id) : undefined, d = kept?.d ?? null;

    const rows = editableFields(b, item).flatMap((f): [string, Element][] => {
      if (f.type === "title" || f.type === "labels" || f.type === "assignees") return [];

      const v = item.values.get(f.id);

      return [[f.name, v ? div().text_color(valueColor(t, f, v)).child(valueText(f, v)) : div().text_color(t.dim).child("—")]];
    });

    const assignees: [string, Element] = ["Assignees", c.assignees.length ? h_flex().gap(6).items_center().children(c.assignees.map((u, i) => h_flex().id(`pda-${i}`).gap(4).items_center().child(avatar(t, u.login, 0)).child(div().text_color(t.foreground).child(u.login)))) : div().text_color(t.dim).child("—")];
    const labels: [string, Element][] = c.kind === "draft" ? [] : [["Labels", c.labels.length ? h_flex().flex_wrap().gap(4).children(c.labels.map((l, i) => div().id(`pdl-${i}`).relative().px(5).h(16).flex().items_center().text_size(10).text_color(t.foreground).child(dither(`#${l.color}88`, 1)).child(div().relative().child(l.name)))) : div().text_color(t.dim).child("—")]];

    const grid2 = v_flex().gap(3).text_size(11)
      .children([assignees, ...labels, ...rows].map(([k, v], i) => h_flex().id(`pdf-${i}`).gap(10).items_start().child(div().w(84).flex_none().text_color(t.dim).child(k)).child(div().flex_1().min_w(0).child(v))));

    const md = (id: string, text: string | null | undefined) => markdown(t, id, text?.trim() ? text : "_No description._", { size: 12, onLink: (url, cx) => this.app.openUrl(url, cx) });
    const state = c.state === "MERGED" ? (["merged", t.ansi5] as const) : c.state === "CLOSED" ? (["closed", t.blocked] as const) : c.kind === "draft" ? (["draft", t.dim] as const) : (["open", t.done] as const);
    const comments = d?.comments ?? [];

    const content = v_flex().absolute().left(0).right(0).top(-this.scrollY).px(14).py(10).gap(8)
      .on_size_change((s, cx) => {
        const h = unzoom(s.height);

        if (Math.abs(h - this.contentH) > 1) {
          this.contentH = h;
          this.scroll(0);
          cx.notify();
        }
      })
      .child(h_flex().gap(8).items_start().text_size(14)
        .when(c.number !== null, (el) => el.child(div().flex_none().text_color(t.accent).child(`#${c.number ?? ""}`)))
        .child(div().flex_1().min_w(0).text_color(t.foreground).child(c.title)))
      .child(h_flex().flex_wrap().gap_x(10).gap_y(2).text_size(11).text_color(t.muted)
        .when(Boolean(c.repo), (el) => el.child(div().child(c.repo ?? "")))
        .child(div().text_color(state[1]).child(state[0]))
        .when(Boolean(d?.createdAt), (el) => el.child(div().text_color(t.dim).child(`opened ${ago(d?.createdAt)} ago${d?.author ? ` by ${d.author}` : ""}`))))
      .child(grid2)
      .child(div().relative().h(2).child(dither(t.ansi0, 1)))
      .child(kept?.error ? div().text_size(11).text_color(t.blocked).child(kept.error) : md(`pd-body-${c.id ?? item.id}`, d ? d.body : c.id ? "_Reading…_" : ""))
      .when(comments.length > 0, (el) => el
        .child(h_flex().pt(8).gap(8).items_center().child(div().text_size(10).text_color(t.ansi8).child(`COMMENTS · ${comments.length + (d?.more ?? 0)}`)).child(div().relative().flex_1().h(2).child(dither(t.ansi0, 1))))
        .children(comments.map((cm, i) => v_flex().id(`pdc-${i}`).relative().gap(4).pl(12).py(6)
          .child(div().absolute().left(2).top(6).bottom(6).w(2).child(dither(t.ansi0, 1)))
          .child(h_flex().gap(8).text_size(11).child(div().text_color(t.accent).child(cm.who)).child(div().flex_1()).child(div().text_color(t.dim).child(ago(cm.at))))
          .child(md(`pd-c-${c.id ?? ""}-${i}`, cm.body)))))
      .child(div().h(20));

    const view = div().id("pd-view").relative().flex_1().min_h(0).overflow_hidden()
      .on_size_change((s, cx) => {
        const h = unzoom(s.height);

        if (Math.abs(h - this.viewH) > 1) {
          this.viewH = h;
          this.scroll(0);
          cx.notify();
        }
      })
      .on_scroll_wheel((e, cx) => {
        this.scroll(-unzoom(e.delta.y));
        cx.notify();
      })
      .child(content);

    return frame(view, kept?.at ? `read ${readAgo(kept.at)}` : c.id ? "reading…" : "");
  }

  /** The open menu, lazygit's: a framed list over the board. */
  menuPanel(t: Theme, b: Board, m: Menu): Element {
    interface RowLook {
      readonly on?: boolean;
      readonly cur?: boolean;
      readonly dim?: boolean;
      readonly color?: Color | null;
      readonly right?: string;
      readonly hex?: string | null;
      readonly toggle?: boolean;
    }

    const row = (id: string, text: string, { on = false, cur = false, dim = false, color = null, right = "", hex = null, toggle = false }: RowLook = {}) =>
      h_flex().id(id).relative().h(20).px(10).gap(7).items_center().text_size(11)
        .text_color(on ? t.foreground : dim ? t.dim : t.muted)
        .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
        .when(toggle, (el) => el.child(div().relative().flex_none().w(10).text_color(cur ? t.accent : t.dim).child(cur ? "■" : "□")))
        .when(color !== null, (el) => (color ? el.child(div().relative().child(pip(t, "done", 7).text_color(color))) : el))
        .when(Boolean(hex), (el) => el.child(div().relative().size(8).flex_none().child(dither(`#${hex ?? ""}`, 1))))
        .child(div().relative().flex_1().min_w(0).truncate().child(text))
        .when(Boolean(right) || (cur && !toggle), (el) => el.child(div().relative().flex_none().max_w(220).truncate().text_size(10).text_color(t.dim).child(right || "current")));

    const frame = (title: string, body: Element, w = 380) => v_flex().id("pmenu").absolute().top(36).left(Math.max(0, Math.round((this.width - w) / 2))).w(w).bg(t.background).border(1).border_color(t.accent)
      .on_mouse_down("left", stop)
      .child(h_flex().relative().h(22).px(8).items_center().text_size(11)
        .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(t.accent, 1)))
        .child(div().relative().truncate().text_color(t.foreground).child(title)))
      .child(body);

    if (m.kind === "value") {
      return frame(m.title, h_flex().h(30).px(8).gap(6).items_center().child(div().text_size(11).text_color(t.accent).child(">"))
        .child(Input.new(this.valueInput).flex_1().h_full().text_size(12).text_color(t.foreground)));
    }

    if (m.kind === "pick") {
      const top = Math.max(0, Math.min(m.at - 7, m.rows.length - 14));

      return frame(m.title, v_flex().py(4).children(m.rows.slice(top, top + 14).map((r, i) => row(`pm-${top + i}`, r.label, { on: top + i === m.at, dim: r.dim ?? false, right: r.right ?? "" })
        .on_mouse_down("left", stop).on_click((_e, cx) => {
          this.menu = null;
          r.go(cx);
          this.app.focusSelf();
          cx.notify();
        }))), 460);
    }

    const item = b.items.find((i) => i.id === m.item);

    if (!item) return div();

    const fields = this.menuFields(b, m.fields);
    const f = fields[m.at], opts = f ? this.options(b, item, f) : [];

    const left = v_flex().w(170).flex_none().py(4).border_r(1).border_color(t.ansi0).children(fields.map((x, i) => {
      const v = x.type === "labels" ? String(item.content.labels.length || "") : x.type === "assignees" ? String(item.content.assignees.length || "") : x.type === "title" ? "" : valueText(x, item.values.get(x.id));

      return row(`pmf-${i}`, x.name, { on: i === m.at && m.side === "fields", right: v }).when(i === m.at && m.side !== "fields", (el) => el.text_color(t.foreground))
        .on_mouse_down("left", stop).on_click((_e, cx) => {
          m.at = i;
          m.side = "opts";
          m.opt = 0;
          cx.notify();
        });
    }));

    const otop = Math.max(0, Math.min(m.opt - 7, opts.length - 14));

    const right = v_flex().flex_1().min_w(0).py(4).children(opts.slice(otop, otop + 14).map((o, i) => row(`pmo-${otop + i}`, o.label, {
      on: m.side === "opts" && otop + i === m.opt, cur: o.on ?? false, dim: o.dim ?? false, right: o.right ?? "", hex: o.hex ?? null, toggle: o.toggle ?? false,
      color: o.color === undefined ? null : ansiColor(t, o.color),
    }).on_mouse_down("left", stop).on_click((_e, cx) => {
      m.side = "opts";
      m.opt = otop + i;

      if (f) this.choose(item, f, o, cx);

      cx.notify();
    })));

    return frame(`${label(item)} · fields`, h_flex().items_start().child(left).child(right), 460);
  }
}

// ---- small pieces

const label = (item: Item | undefined): string => (item?.content.number !== null && item?.content.number !== undefined ? `#${item.content.number}` : "the draft");

const numW = (item: Item): number => (item.content.kind === "draft" ? 6 : item.content.number !== null ? String(item.content.number).length + 2 : 0);

/** Where o opens a card: its issue or PR, or the draft in the project's view. */
function itemUrl(b: Board, view: View | null, item: Item): string | null {
  if (item.content.url) return item.content.url;

  const base = `${b.project.url ?? ""}${view?.number ? `/views/${view.number}` : ""}`;

  return item.db ? `${base}?pane=issue&itemId=${item.db}` : base;
}

/** A login as a square of its initials, in its own color. */
function avatar(t: Theme, who: string, i: number): Element {
  return div().id(`pav-${who}-${i}`).relative().size(16).flex_none().flex().items_center().justify_center().text_size(9)
    .bg(ansiColor(t, loginSlot(who))).text_color(t.background).when(i > 0, (el) => el.ml(-3))
    .child(initials(who));
}

function valueColor(t: Theme, f: Field, v: FieldValue): Color {
  if (f.type === "single") {
    const id = selectOf(v)?.optionId;

    return ansi(t, f.options.find((o) => o.id === id)?.color);
  }

  if (f.type === "iteration") return t.ansi6;

  return t.muted;
}
