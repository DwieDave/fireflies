// The Projects tab: a GitHub Projects (v2) board, lazygit's way. Each column
// is a panel (its title cut into the edge, accent when it has the keyboard,
// red when it holds more than its limit); cards are rows like the PR list.
// The project's board views are tabs on the bar beside an always-there filter
// (GitHub's syntax, board.js parseFilter); a view's group-by draws swimlanes
// inside every column. enter docks the card's detail on the right.
//
// Keyboard first: h l columns, j k cards, space / m carries a card (hjkl
// moves it, enter drops, esc puts it back), e edits its fields, a adds a
// draft, / filters, v views, p projects, o GitHub, x archives, - folds a
// column, z a lane, w sets a column's limit. Edits show at once and roll back
// when GitHub refuses them (board.js overlay).
//
// GitHub keeps no column limits or folded columns for a view in its API, so
// those are this app's, per project (shared state "github.boards").

import { div, svg } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, VirtualListScrollHandle, InputState, Input } from "gpui-base";
import { shared, setShared } from "herdr";
import { graphql, mutate } from "./gh.ts";
import { readAgo, ago, SLOW, linksIn } from "./model.ts";
import { repoKey, newest, LIMITS } from "./cache.ts";
import { markdown } from "./markdown.ts";
import { dither, pip, empty, band, stop, unzoom, ART } from "./kit.js";
import {
  projectListQuery, parseProjectList, boardQuery, parseBoard, addPage, scopeProblem, detailQuery, parseDetail, choicesQuery, parseChoices,
  filterTokens, layout, grid, find, step, pickUp, carry, carried, drop, overlay, valueFor, setFieldMutation, positionMutation,
  archiveMutation, addDraftMutation, convertMutation, draftMutation, toggleMutation, cardFields, editableFields, OPTION_ANSI,
  initials, loginSlot, valueText, slimBoard, wrap, isStoredBoard, boardOf, isProjectListAnswer, isBoardAnswer, isDetailAnswer, isChoicesAnswer, isAddedDraft,
} from "./board.ts";

const PREFS = "github.boards"; // { repos: { repoKey: projectId }, projects: { id: { view, folded: { viewId: [key] }, lanes: { viewId: [key] }, limits: { fieldId: { key: n } } } } }
const LIST_EVERY = 10 * 60000; // the picker's list is read again this rarely
const SETTLE = 2500; // after an edit GitHub took, the board is read again this much later
const FOLD_W = 28, GAP = 6, DETAIL_W = 340, CHAR = 7.7, LINE = 15, LANE_H = 22;
const HANDLES = 16;

const ansi = (t, color) => t[`ansi${OPTION_ANSI.get(color) ?? 8}`] ?? t.ansi8;

export default class Projects {
  constructor(app, kept = {}) {
    this.app = app;
    this.list = null; this.listAt = 0; // the picker's { viewer, repoId, projects }
    this.boards = {}; // project id -> { board, at }
    this.pick = kept.pick ?? null; // project id
    this.viewId = kept.view ?? null;
    this.sel = kept.sel ?? null; // item id
    this.selCol = 0; // the column the selection is in (an empty column holds no item)
    this.first = 0; // the first column drawn, when they don't all fit
    this.pending = []; // { id, op, state: "sending" | "done", at, doneAt }
    this.seq = 0;
    this.carrying = null; // board.js carry state
    this.menu = null; // { kind, ... } the open picker / field editor
    this.filterText = kept.filter ?? "";
    this.filter = InputState.new({ placeholder: "filter: assignee:@me label:bug status:Ready is:open repo:name, or words", value: this.filterText });
    this.filter.on("change", (_e, cx) => { this.filterText = this.filter.value(); this.keepSel(); cx.notify(); });
    this.filter.on("submit", (_e, cx) => { this.typing = null; this.app.focusSelf(); cx.notify(); });
    this.typing = null; // "filter" | "draft" | "value" while an Input has the keys
    this.draft = InputState.new({ placeholder: "a title for the new draft; enter adds it" });
    this.draft.on("submit", (_e, cx) => { this.addDraft(cx); cx.notify(); });
    this.valueInput = InputState.new({ placeholder: "" });
    this.valueInput.on("submit", (_e, cx) => { this.submitValue(cx); cx.notify(); });
    this.detailOpen = Boolean(kept.detail); this.focus = "board"; // "board" | "detail"
    this.details = new Map(); // content id -> { d, at }
    this.choices = new Map(); // repo -> { labels, users }
    this.scrollY = 0; this.contentH = 0; this.viewH = 400;
    this.handles = Array.from({ length: HANDLES }, () => VirtualListScrollHandle.new());
    this.scope = null; // board.js scopeProblem: the token can't read projects
    this.error = "";
    this.settleAt = 0;
    this.width = 1000;
  }

  save() { return { pick: this.pick, view: this.viewId, sel: this.sel, filter: this.filterText, detail: this.detailOpen }; }

  /** Shows what an earlier opening read (cache.js entry.projects), until GitHub answers. */
  hydrate(c) {
    this.list = c?.list?.projects ? c.list : null; this.listAt = c?.list?.at ?? 0;
    this.boards = {};
    for (const [id, b] of (c?.boards ?? [])) if (isStoredBoard(b?.board)) this.boards[id] = { board: boardOf(b.board), at: b.at ?? 0 };
    this.pending = []; this.carrying = null; this.menu = null; this.details = new Map(); this.choices = new Map();
    this.scope = null; this.error = "";
    if (!this.pick || (this.list && !this.list.projects.some((p) => p.id === this.pick))) this.pick = this.remembered() ?? null;
  }

  snapshot() {
    const boards = {};
    for (const [id, b] of Object.entries(this.boards)) boards[id] = { board: slimBoard(b.board), at: b.at };
    return { list: this.list ? { ...this.list, at: this.listAt } : null, boards: newest(new Map(Object.entries(boards)), LIMITS.boards) };
  }

  readAt() { return this.pick ? this.boards[this.pick]?.at ?? 0 : this.listAt; }
  interval() { return SLOW; }

  // ---- what GitHub keeps and what this app keeps

  prefs() { return shared(PREFS) ?? { repos: {}, projects: {} }; }
  local() { return this.prefs().projects?.[this.pick] ?? {}; }
  setLocal(fn) {
    const p = this.prefs();
    const cur = p.projects?.[this.pick] ?? {};
    setShared(PREFS, { ...p, projects: { ...(p.projects ?? {}), [this.pick]: fn(cur) } });
  }
  remembered() {
    const app = this.app.repo;
    return app ? this.prefs().repos?.[repoKey(app)] ?? null : null;
  }

  /** The board as read, with the edits on their way laid over it. */
  base() { return this.pick ? this.boards[this.pick]?.board ?? null : null; }
  board() { const b = this.base(); return b ? overlay(b, this.pending) : null; }

  views(b = this.board()) {
    const all = b?.views ?? [];
    const boards = all.filter((v) => v.layout === "board");
    return boards.length ? boards : all.slice(0, 1);
  }
  view(b = this.board()) {
    const vs = this.views(b);
    return vs.find((v) => v.id === this.viewId) ?? vs.find((v) => v.id === this.local().view) ?? vs[0] ?? null;
  }

  lay(b = this.board()) {
    if (!b) return null;
    const v = this.view(b), l = this.local();
    const field = v ? (b.fields.find((f) => f.id === v.columnBy) ?? null) : null;
    return layout(b, v, this.filterText, {
      folded: l.folded?.[v?.id] ?? [], lanesFolded: l.lanes?.[v?.id] ?? [],
      limits: new Map(Object.entries((l.limits ?? {})[field?.id ?? layout(b, v).field?.id] ?? {}).filter(([, n]) => Number(n) > 0).map(([k, n]) => [k, Number(n)])),
    }, { me: b.viewer ?? this.list?.viewer });
  }

  /** The grid j / k walk (carrying: as it would look after the drop). */
  grid(lay) { const g = grid(lay); return this.carrying ? carried(g, this.carrying) : g; }
  foldedCols(lay) { return lay.columns.map((c) => c.folded); }

  at(lay = this.lay()) {
    if (!lay) return { col: 0, row: -1 };
    const g = this.grid(lay);
    if (this.carrying) return { col: this.carrying.col, row: this.carrying.row };
    const f = this.sel ? find(g, this.sel) : null;
    if (f) { this.selCol = f.col; return f; }
    const col = Math.min(this.selCol, Math.max(0, g.length - 1));
    return { col, row: g[col]?.length ? 0 : -1 };
  }

  current(lay = this.lay()) {
    if (!lay) return null;
    const a = this.at(lay);
    return this.grid(lay)[a.col]?.[a.row] ?? null;
  }

  /** After the filter or the board changed: the selection stays on its card, or the column's first. */
  keepSel() {
    const lay = this.lay();
    if (!lay) return;
    const g = this.grid(lay);
    if (this.sel && find(g, this.sel)) return;
    const col = Math.min(this.selCol, Math.max(0, g.length - 1));
    this.sel = g[col]?.[0]?.id ?? null;
  }

  // ---- reading

  async poll({ all = false } = {}, cx) {
    const repo = this.app.repo;
    if (!repo) return;
    const now = Date.now();
    try {
      if (all || !this.list || now - this.listAt >= LIST_EVERY) {
        const l = parseProjectList(await graphql(repo, projectListQuery(repo), isProjectListAnswer, [], { partial: true }));
        if (this.app.repo !== repo) return;
        this.list = l; this.listAt = Date.now(); this.scope = null;
        if (!this.pick || !l.projects.some((p) => p.id === this.pick)) {
          this.pick = this.remembered() && l.projects.some((p) => p.id === this.remembered()) ? this.remembered()
            : (l.projects.find((p) => !p.closed) ?? l.projects[0])?.id ?? null;
        }
        cx?.notify();
      }
      if (!this.pick) return;
      const pid = this.pick, kept = this.boards[pid];
      // Read when asked, when old, or once an edit GitHub took has settled.
      const fresh = kept && now - kept.at < SLOW - 500, settled = this.settleAt && now >= this.settleAt;
      if (!all && fresh && !settled) return;
      await this.readBoard(repo, pid);
      // Reopened with the detail docked: its card is read with the board.
      if (this.detailOpen && this.current()) await this.readDetail(this.current(), null);
    } catch (e) {
      const s = scopeProblem(e?.message ?? e);
      if (s) { this.scope = s; return; }
      throw e;
    }
  }

  async readBoard(repo, pid) {
    const started = Date.now();
    let b = parseBoard(await graphql(repo, boardQuery(true), isBoardAnswer, [["id", pid]]));
    if (!b) throw new Error("GitHub didn't find that project (it may be gone, or private to others).");
    while (b.more) b = addPage(b, await graphql(repo, boardQuery(false), isBoardAnswer, [["id", pid], ["after", b.more]]));
    if (this.app.repo !== repo) return;
    this.boards[pid] = { board: b, at: Date.now() };
    this.settleAt = 0; this.error = "";
    // Edits GitHub took before this read began are in it now.
    this.pending = this.pending.filter((p) => !(p.state === "done" && p.doneAt <= started));
    this.keepSel();
    const n = Object.keys(this.boards);
    if (n.length > LIMITS.boards * 2) this.boards = Object.fromEntries(newest(new Map(Object.entries(this.boards)), LIMITS.boards));
  }

  /** The selected card's body and comments, read once it's opened. */
  readDetail(item, cx) {
    const id = item?.content?.id;
    if (!id || this.details.get(id)?.busy) return;
    const kept = this.details.get(id);
    if (kept && Date.now() - kept.at < 60000) return;
    this.details.set(id, { ...(kept ?? {}), busy: true, at: kept?.at ?? 0 });
    const repo = this.app.repo;
    const read = (async () => {
      try { this.details.set(id, { d: parseDetail(await graphql(repo, detailQuery, isDetailAnswer, [["id", id]])), at: Date.now() }); }
      catch (e) { this.details.set(id, { error: String(e?.message ?? e), at: Date.now() }); }
    })();
    if (cx) this.app.spawn(cx, () => read);
    return read;
  }

  async choicesFor(full) {
    if (!full) return { labels: [], users: [] };
    if (!this.choices.has(full)) this.choices.set(full, parseChoices(await graphql(this.app.repo, choicesQuery(full), isChoicesAnswer)));
    return this.choices.get(full);
  }

  // ---- edits: shown at once, sent, rolled back when refused

  /** Lays `op` over the board and sends `mutation` (text, or an async function returning what to send next). */
  edit(op, send, ok, cx) {
    const entry = { id: ++this.seq, op, state: "sending", at: Date.now() };
    if (op) this.pending.push(entry);
    const repo = this.app.repo;
    this.app.note = { text: "…", tone: "working", at: Date.now() };
    cx.spawn(async (cx) => {
      try {
        await send(repo);
        entry.state = "done"; entry.doneAt = Date.now();
        this.app.note = ok ? { text: ok, tone: "done", at: Date.now() } : null;
        this.settleAt = Date.now() + SETTLE;
        this.app.next = Math.min(this.app.next, this.settleAt);
      } catch (e) {
        this.pending = this.pending.filter((p) => p !== entry); // the rollback
        const s = scopeProblem(e?.message ?? e, true);
        this.app.note = { text: s ? s.text : `GitHub refused it: ${String(e?.message ?? e)}`, tone: "failed", at: Date.now() };
        this.keepSel();
      }
      cx.notify();
    });
  }

  gql(query) { return (repo) => mutate(repo, query); }

  setField(item, field, choice, cx) {
    const b = this.board();
    const value = typeof choice === "object" && choice !== null ? choice : valueFor(field, choice);
    if (choice != null && choice !== "" && !value) { this.app.note = { text: `That isn't a ${field.type} for ${field.name}.`, tone: "failed", at: Date.now() }; return; }
    this.edit({ kind: "field", item: item.id, field: field.id, value }, this.gql(setFieldMutation(b.project.id, item.id, field, value)),
      `${field.name}: ${value ? valueText(field, value) : "cleared"}`, cx);
  }

  /** Drops the carried card where it is. */
  dropCard(cx) {
    const lay = this.lay(), c = this.carrying;
    this.carrying = null;
    if (!lay || !c) return;
    const plan = drop(grid(lay), c, lay.columns, { sorted: lay.sorted });
    if (!plan) return;
    const b = this.board(), pid = b.project.id;
    const item = b.items.find((i) => i.id === plan.id);
    const col = lay.columns[c.col];
    const ops = [];
    if (plan.column !== undefined) ops.push({ kind: "field", item: plan.id, field: lay.field.id, value: plan.column ? valueFor(lay.field, plan.column) : null });
    if (plan.afterId !== undefined) ops.push({ kind: "position", item: plan.id, afterId: plan.afterId });
    // Both edits are one move: shown together, rolled back together.
    const sends = [];
    if (plan.column !== undefined) sends.push(setFieldMutation(pid, plan.id, lay.field, ops[0].value));
    if (plan.afterId !== undefined) sends.push(positionMutation(pid, plan.id, plan.afterId));
    this.sel = plan.id; this.selCol = c.col;
    this.editBatch(ops, async (repo) => { for (const q of sends) await mutate(repo, q); },
      plan.column !== undefined ? `Moved ${label(item)} to ${col.name}` : `Moved ${label(item)}`, cx);
  }

  editBatch(ops, send, ok, cx) {
    const entries = ops.map((op) => ({ id: ++this.seq, op, state: "sending", at: Date.now() }));
    this.pending.push(...entries);
    this.app.note = { text: "…", tone: "working", at: Date.now() };
    const repo = this.app.repo;
    cx.spawn(async (cx) => {
      try {
        await send(repo);
        for (const e of entries) { e.state = "done"; e.doneAt = Date.now(); }
        this.app.note = { text: ok, tone: "done", at: Date.now() };
        this.settleAt = Date.now() + SETTLE;
        this.app.next = Math.min(this.app.next, this.settleAt);
      } catch (e) {
        this.pending = this.pending.filter((p) => !entries.includes(p));
        const s = scopeProblem(e?.message ?? e, true);
        this.app.note = { text: s ? s.text : `GitHub refused it: ${String(e?.message ?? e)}`, tone: "failed", at: Date.now() };
        this.keepSel();
      }
      cx.notify();
    });
  }

  addDraft(cx) {
    const title = this.draft.value().trim(), lay = this.lay(), b = this.board();
    this.typing = null; this.draft.set_value(""); this.app.focusSelf();
    if (!title || !lay || !b) return;
    const col = lay.columns[this.at(lay).col];
    const temp = `temp-${++this.seq}`;
    const values = new Map(col?.key && lay.field ? [[lay.field.id, valueFor(lay.field, col.key)]] : []);
    const item = { id: temp, db: null, type: "DRAFT_ISSUE", archived: false, values, content: { kind: "draft", id: null, number: null, title, state: "DRAFT", url: null, repo: null, assignees: [], labels: [], milestone: null } };
    this.sel = temp;
    this.edit({ kind: "add", item }, async (repo) => {
      const r = await graphql(repo, addDraftMutation(b.project.id, title), isAddedDraft);
      const id = r?.addProjectV2DraftIssue?.projectItem?.id;
      if (id && col?.key && lay.field) await mutate(repo, setFieldMutation(b.project.id, id, lay.field, values.get(lay.field.id)));
      if (id) {
        // The real item takes the temporary one's place in what's shown until the next read.
        item.id = id; item.db = r.addProjectV2DraftIssue.projectItem.databaseId ?? null; item.content.id = r.addProjectV2DraftIssue.projectItem.content?.id ?? null;
        if (this.sel === temp) this.sel = id;
      }
    }, `Added “${title}”${col ? ` to ${col.name}` : ""}`, cx);
  }

  archive(item, cx) {
    const b = this.board();
    this.app.ask(`Archive ${label(item)} “${item.content.title}” from ${b.project.title}?`, () => {
      const lay = this.lay(), g = this.grid(lay), a = find(g, item.id);
      const next = a ? g[a.col][a.row + 1] ?? g[a.col][a.row - 1] : null;
      this.sel = next?.id ?? null;
      this.edit({ kind: "archive", item: item.id }, this.gql(archiveMutation(b.project.id, item.id)), `Archived ${label(item)}`, cx);
      cx.notify();
    });
  }

  // ---- moves

  select(lay, a, cx) {
    const g = this.grid(lay);
    this.selCol = a.col;
    this.sel = g[a.col]?.[a.row]?.id ?? null;
    this.follow(lay, a);
    if (this.detailOpen) { this.scrollY = 0; const it = this.current(lay); if (it) this.readDetail(it, cx); }
  }

  /** Keeps the selected column and card on screen. */
  follow(lay, a) {
    const fit = this.fits(lay);
    if (a.col < this.first) this.first = a.col;
    while (a.col >= this.first + fit && this.first < lay.columns.length - 1) this.first++;
    const h = this.handles[a.col];
    if (h && a.row >= 0) h.scroll_to_item(this.rowIndex(lay, a), "center");
  }

  /** The list row a grid position is drawn at (lane headers count). */
  rowIndex(lay, a) {
    const rows = this.rows(lay, a.col);
    const id = this.grid(lay)[a.col]?.[a.row]?.id;
    return Math.max(0, rows.findIndex((r) => r.item?.id === id));
  }

  /** How many columns fit side by side. */
  fits(lay) {
    const avail = this.width - (this.detailOpen ? DETAIL_W + GAP : 0);
    const folded = lay.columns.filter((c) => c.folded).length;
    return Math.max(1, Math.floor((avail - folded * (FOLD_W + GAP)) / (200 + GAP)));
  }

  /** Keys while this tab shows; true when one was used ("typing": an Input's). */
  key(k, e, cx) {
    if (this.typing) return this.typingKey(k, e, cx);
    if (this.menu) return this.menuKey(k, e, cx);
    const b = this.board(), lay = this.lay(b);
    if (!b || !lay) {
      if (k === "p" && this.list?.projects?.length) { this.openProjects(); return true; }
      return false;
    }
    const a = this.at(lay), item = this.current(lay);
    const dir = { h: "left", left: "left", l: "right", right: "right", k: "up", up: "up", j: "down", down: "down", g: "top", home: "top", G: "bottom", end: "bottom" }[k];
    if (this.carrying) {
      if (dir) { this.carrying = carry(grid(lay), this.carrying, dir, { folded: this.foldedCols(lay), sorted: lay.sorted }); this.follow(lay, this.at(lay)); }
      else if (k === "enter" || k === "space" || k === "m") this.dropCard(cx);
      else if (k === "escape") { this.carrying = null; }
      return true; // nothing else while a card is in hand
    }
    if (this.focus === "detail") {
      if (k === "j" || k === "down") { this.scroll(60); return true; }
      if (k === "k" || k === "up") { this.scroll(-60); return true; }
      if (k === "h" || k === "left" || k === "tab") { this.focus = "board"; return true; } // shift-tab too
      if (k === "escape") { this.focus = "board"; this.detailOpen = false; return true; }
    }
    if (dir) this.select(lay, step(this.grid(lay), a, dir, this.foldedCols(lay)), cx);
    else if (k === "J" || k === "pagedown") this.scroll(Math.max(80, this.viewH / 2));
    else if (k === "K" || k === "pageup") this.scroll(-Math.max(80, this.viewH / 2));
    else if (k === "enter" && item) { if (this.detailOpen && this.focus === "board") this.focus = "detail"; else { this.detailOpen = true; this.focus = "board"; this.scrollY = 0; this.readDetail(item, cx); } }
    else if (k === "tab" && this.detailOpen) this.focus = "detail";
    else if (k === "escape" && this.detailOpen) { this.detailOpen = false; this.focus = "board"; }
    else if ((k === "space" || k === "m") && item) { this.carrying = pickUp(grid(lay), a); }
    else if (k === "e" && item) this.openFields(item, cx);
    else if (k === "a") { this.typing = "draft"; this.draft.set_value(""); this.draft.focus(); }
    else if (k === "/") { this.typing = "filter"; this.filter.focus(); }
    else if (k === "v") this.openViews(b);
    else if (k === "p") this.openProjects();
    else if (k === "o") this.app.openUrl(item ? itemUrl(b, this.view(b), item) : b.project.url, cx);
    else if (k === "x" && item) this.archive(item, cx);
    else if (k === "i" && item?.content.kind === "draft") this.openConvert(b, item);
    else if (k === "-") this.toggleFold(lay, a.col);
    else if (k === "z" && lay.lane) this.toggleLane(lay, item);
    else if (k === "w" && lay.columns[a.col]) this.openLimit(lay, a.col);
    else if (k === "escape" && this.filterText) { this.filter.set_value(""); this.filterText = ""; this.keepSel(); }
    else return false;
    return true;
  }

  /** L: the links in the open card's detail (its body and comments). */
  links() {
    const b = this.board(), item = this.detailOpen && b ? this.current(this.lay(b)) : null;
    const d = item?.content.id ? this.details.get(item.content.id)?.d : null;
    return d ? linksIn([d.body, ...(d.comments ?? []).map((c) => c.body)]) : [];
  }

  typingKey(k, e, cx) {
    if (k === "escape") {
      if (this.typing === "filter" && !this.filter.value()) this.filterText = "";
      if (this.typing === "draft") this.draft.set_value("");
      if (this.typing === "value") this.menu = this.menu?.back ?? null;
      this.typing = null; this.app.focusSelf(); return true;
    }
    if (k === "enter") return "typing"; // the Input's submit does it
    if (this.typing === "filter" && (k === "down" || k === "tab")) { this.typing = null; this.app.focusSelf(); return true; }
    return "typing";
  }

  toggleFold(lay, col) {
    const c = lay.columns[col], v = this.view();
    if (!c || !v) return;
    this.setLocal((l) => { const f = new Set(l.folded?.[v.id] ?? []); f.has(c.key) ? f.delete(c.key) : f.add(c.key); return { ...l, folded: { ...(l.folded ?? {}), [v.id]: [...f] } }; });
    if (!c.folded) { const next = step(this.grid(lay), { col, row: 0 }, "right", lay.columns.map((x, i) => x.folded || i === col)); if (next.col !== col) this.select(this.lay(), next, null); }
  }

  toggleLane(lay, item) {
    const v = this.view();
    const lane = item ? lay.lanes.find((l) => l.cells.some((c) => c.some((i) => i.id === item.id))) : lay.lanes.find((l) => l.folded);
    if (!lane || !v) return;
    this.setLocal((l) => { const f = new Set(l.lanes?.[v.id] ?? []); f.has(lane.key) ? f.delete(lane.key) : f.add(lane.key); return { ...l, lanes: { ...(l.lanes ?? {}), [v.id]: [...f] } }; });
    this.keepSel();
  }

  setView(id) {
    this.viewId = id; this.first = 0;
    this.setLocal((l) => ({ ...l, view: id }));
    this.keepSel();
  }

  setProject(id, cx) {
    if (id === this.pick) return;
    this.pick = id; this.viewId = null; this.sel = null; this.selCol = 0; this.first = 0; this.carrying = null; this.pending = []; this.detailOpen = false;
    const p = this.prefs();
    setShared(PREFS, { ...p, repos: { ...(p.repos ?? {}), [repoKey(this.app.repo)]: id } });
    this.app.refresh(cx, { all: false });
  }

  // ---- menus: lazygit's, a list with j / k, enter, esc

  openProjects() {
    const ps = this.list?.projects ?? [];
    const from = { repo: "linked", parent: "parent's", owner: "owner's" };
    this.menu = { kind: "pick", title: "Projects", at: Math.max(0, ps.findIndex((p) => p.id === this.pick)),
      rows: ps.map((p) => ({ label: p.title, right: `${p.closed ? "closed · " : ""}${from[p.from]} · ${p.owner}/#${p.number}`, dim: p.closed, go: (cx) => this.setProject(p.id, cx) })) };
  }

  openViews(b) {
    const vs = b.views ?? [], cur = this.view(b);
    this.menu = { kind: "pick", title: "Views", at: Math.max(0, vs.findIndex((v) => v.id === cur?.id)),
      rows: vs.map((v) => ({ label: v.name, right: `${v.layout}${v.filter ? ` · ${v.filter}` : ""}`, dim: v.layout !== "board", go: () => this.setView(v.id) })) };
  }

  openConvert(b, item) {
    const repos = [...(b.repos ?? [])];
    if (this.list?.repoId && !repos.some((r) => r.id === this.list.repoId)) repos.unshift({ id: this.list.repoId, full: this.app.repo.full });
    this.menu = { kind: "pick", title: `Make “${item.content.title}” an issue in`, at: Math.max(0, repos.findIndex((r) => r.full === this.app.repo.full)),
      rows: repos.map((r) => ({ label: r.full, go: (cx) => this.edit(null, this.gql(convertMutation(item.id, r.id)), `Made an issue in ${r.full}`, cx) })) };
  }

  openLimit(lay, col) {
    const c = lay.columns[col];
    this.menu = { kind: "value", title: `Limit for ${c.name} (cards; empty: none)`, go: (text) => {
      const n = Math.max(0, Math.floor(Number(text) || 0));
      const fid = lay.field?.id ?? "";
      this.setLocal((l) => ({ ...l, limits: { ...(l.limits ?? {}), [fid]: { ...((l.limits ?? {})[fid] ?? {}), [c.key]: n || undefined } } }));
    } };
    this.valueInput.set_value(c.limit ? String(c.limit) : "");
    this.typing = "value"; this.valueInput.focus();
  }

  /** e: the card's fields on the left, the chosen one's values on the right. */
  openFields(item, cx) {
    const b = this.board();
    const fields = editableFields(b, item);
    if (!fields.length) return;
    this.menu = { kind: "fields", item: item.id, at: 0, side: "fields", opt: 0, fields: fields.map((f) => f.id) };
    const repo = item.content.repo ?? this.app.repo.full;
    if (fields.some((f) => f.type === "labels" || f.type === "assignees")) {
      this.app.spawn(cx, async () => { try { await this.choicesFor(repo); } catch { /* the menu says it */ } });
    }
  }

  /** The values the field menu offers for one field: [{ id, label, color, on }]. */
  options(b, item, f) {
    const v = item.values.get(f.id);
    if (f.type === "single") return [...f.options.map((o) => ({ id: o.id, label: o.name, color: ansiKey(o.color), on: v?.optionId === o.id })), { id: null, label: "clear", dim: true }];
    if (f.type === "iteration") return [...f.iterations.filter((i) => !i.done).map((i) => ({ id: i.id, label: i.title, right: i.startDate, on: v?.iterationId === i.id })), { id: null, label: "clear", dim: true }];
    if (f.type === "labels" || f.type === "assignees") {
      const c = this.choices.get(item.content.repo ?? this.app.repo.full);
      if (!c) return [{ id: undefined, label: "reading…", dim: true }];
      const have = f.type === "labels" ? item.content.labels.map((l) => l.name) : item.content.assignees.map((a) => a.login);
      return f.type === "labels" ? c.labels.map((l) => ({ id: l.id, label: l.name, hex: l.color, on: have.includes(l.name), toggle: true }))
        : c.users.map((u) => ({ id: u.id, label: u.login, on: have.includes(u.login), toggle: true }));
    }
    return [{ id: "edit", label: valueText(f, v) || (f.type === "title" ? item.content.title : "(empty)"), right: "enter edits", input: true }, { id: null, label: "clear", dim: true }].filter((o) => f.type !== "title" || o.id !== null);
  }

  menuKey(k, e, cx) {
    const m = this.menu;
    if (k === "escape" || k === "q") { this.menu = null; return true; }
    if (m.kind === "pick") {
      if (k === "j" || k === "down") m.at = Math.min(m.rows.length - 1, m.at + 1);
      else if (k === "k" || k === "up") m.at = Math.max(0, m.at - 1);
      else if (k === "enter" || k === "space") { const r = m.rows[m.at]; this.menu = null; r?.go(cx); }
      return true;
    }
    if (m.kind !== "fields") return true;
    const b = this.board(), item = b?.items.find((i) => i.id === m.item);
    if (!item) { this.menu = null; return true; }
    const fields = m.fields.map((id) => b.fields.find((f) => f.id === id)).filter(Boolean);
    const f = fields[m.at], opts = f ? this.options(b, item, f) : [];
    // tab / shift-tab: the next / previous field, wrapping, as in every form (form-keys.ts).
    if (k === "tab" || k === "shift-tab") {
      const by = k === "tab" && !e?.modifiers?.shift ? 1 : -1;
      m.at = (((m.at + by) % fields.length) + fields.length) % fields.length;
      m.side = "fields";
      return true;
    }
    if (m.side === "fields") {
      if (k === "j" || k === "down") m.at = Math.min(fields.length - 1, m.at + 1);
      else if (k === "k" || k === "up") m.at = Math.max(0, m.at - 1);
      else if (k === "l" || k === "right" || k === "enter" || k === "space") { m.side = "opts"; m.opt = Math.max(0, opts.findIndex((o) => o.on)); }
      return true;
    }
    if (k === "j" || k === "down") m.opt = Math.min(opts.length - 1, m.opt + 1);
    else if (k === "k" || k === "up") m.opt = Math.max(0, m.opt - 1);
    else if (k === "h" || k === "left") m.side = "fields";
    else if (k === "enter" || k === "space") this.choose(b, item, f, opts[m.opt], cx);
    return true;
  }

  choose(b, item, f, o, cx) {
    if (!o || o.id === undefined) return;
    if (o.input) {
      const v = item.values.get(f.id);
      this.valueInput.set_value(f.type === "title" ? item.content.title : f.type === "date" ? v?.date ?? "" : f.type === "number" ? (v?.number != null ? String(v.number) : "") : v?.text ?? "");
      const back = this.menu;
      this.menu = { kind: "value", back, title: `${f.name}${f.type === "date" ? " (YYYY-MM-DD)" : ""}`, go: (text) => {
        if (f.type === "title") return this.retitle(item, text, cx);
        this.setField(item, f, text.trim(), cx);
      } };
      this.typing = "value"; this.valueInput.focus();
      return;
    }
    if (o.toggle) return this.toggle(item, f, o, cx);
    this.setField(item, f, o.id, cx);
    this.menu.side = "fields";
  }

  retitle(item, text, cx) {
    const title = text.trim();
    if (!title || !item.content.id) return;
    this.edit({ kind: "content", item: item.id, patch: { title } }, this.gql(draftMutation(item.content.id, { title })), "Renamed the draft", cx);
  }

  /** A label or an assignee on or off. */
  toggle(item, f, o, cx) {
    const c = item.content;
    if (f.type === "labels") {
      const labels = o.on ? c.labels.filter((l) => l.name !== o.label) : [...c.labels, { id: o.id, name: o.label, color: o.hex }];
      this.edit({ kind: "content", item: item.id, patch: { labels } }, this.gql(toggleMutation(c.id, "labels", o.on ? [] : [o.id], o.on ? [o.id] : [])), `${o.on ? "Took off" : "Put on"} ${o.label}`, cx);
      return;
    }
    const assignees = o.on ? c.assignees.filter((a) => a.login !== o.label) : [...c.assignees, { id: o.id, login: o.label }];
    const q = c.kind === "draft" ? draftMutation(c.id, { assigneeIds: assignees.map((a) => a.id).filter(Boolean) }) : toggleMutation(c.id, "assignees", o.on ? [] : [o.id], o.on ? [o.id] : []);
    this.edit({ kind: "content", item: item.id, patch: { assignees } }, this.gql(q), `${o.on ? "Unassigned" : "Assigned"} ${o.label}`, cx);
  }

  submitValue(cx) {
    const m = this.menu, text = this.valueInput.value();
    this.typing = null; this.app.focusSelf();
    this.menu = m?.back ?? null;
    if (this.menu) this.menu.side = "fields";
    m?.go?.(text);
    cx.notify();
  }

  scroll(dy) {
    const max = Math.max(0, this.contentH - this.viewH);
    this.scrollY = Math.max(0, Math.min(max, this.scrollY + dy));
  }

  // ---- the bar and the help

  get composer() { return Boolean(this.typing || this.menu || this.carrying); }

  hints() {
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

  static help() {
    return [
      ["h l ← →", "column"], ["j k ↓ ↑ g G home end", "card / first / last"], ["J K pgdn pgup", "scroll the card's detail"],
      ["tab ⇧tab", "to the detail and back"], ["esc", "close the detail · clear the filter"], ["enter", "the card's detail (again: into it)"], ["space m", "carry it: hjkl moves, enter drops, esc puts back"],
      ["e", "edit its fields"], ["a", "add a draft to the column"], ["i", "make the draft an issue"], ["x", "archive (asks)"],
      ["/", "filter: assignee: label: status: is: repo: no: words"], ["v", "the project's views"], ["p", "projects (repo's, owner's)"],
      ["-", "fold the column"], ["z", "fold the swimlane"], ["w", "the column's limit"], ["L", "a link in the open card"], ["o", "on GitHub"], ["r", "refresh"],
    ];
  }

  // ---- drawing

  render(t, size) {
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
    if (!b) return v_flex().size_full().child(this.bar(t, null)).child(empty(t, "Reading the board…", this.list?.projects?.find((p) => p.id === this.pick)?.title ?? "", { moon: 4 }));
    const lay = this.lay(b);
    const body = h_flex().flex_1().min_h(0).gap(GAP).items_start()
      .child(this.columns(t, b, lay, size))
      .when(this.detailOpen, (el) => el.child(this.detail(t, b, lay)));
    return v_flex().size_full().relative()
      .child(this.bar(t, b, lay))
      .child(body)
      .when(Boolean(this.menu), (el) => el.child(this.menuPanel(t, b)));
  }

  /** The project, its views and the filter. */
  bar(t, b, lay) {
    const p = this.list?.projects?.find((x) => x.id === this.pick) ?? b?.project;
    const views = b ? this.views(b) : [], cur = b ? this.view(b) : null;
    const viewChips = views.map((v) => h_flex().id(`pv-${v.id}`).relative().h(20).px(7).flex_none().items_center().text_size(11)
      .text_color(v.id === cur?.id ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
      .on_mouse_down("left", stop).on_click((_e, cx) => { this.setView(v.id); cx.notify(); })
      .when(v.id === cur?.id, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)))
      .child(div().relative().child(v.name)));
    const tokens = filterTokens(this.filterText);
    const typing = this.typing === "filter";
    const filter = h_flex().id("pf-filter").relative().flex_1().min_w(120).h(22).px(8).gap(6).items_center().text_size(11)
      .border(1).border_color(typing ? t.accent : t.ansi0)
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.menu = null; this.typing = "filter"; this.filter.focus(); cx.notify(); })
      .child(div().flex_none().text_color(typing ? t.accent : t.dim).child("/"))
      .child(typing ? Input.new(this.filter).flex_1().min_w(0).h_full().text_size(11).text_color(t.foreground)
        : h_flex().flex_1().min_w(0).gap(6).overflow_hidden().children(tokens.length ? tokens.map((k, i) => div().id(`tok-${i}`).flex_none().text_color(k.kind === "key" ? t.ansi5 : t.foreground).child(k.text))
          : [div().text_color(t.dim).truncate().child("filter")]))
      .when(Boolean(lay), (el) => el.child(div().flex_none().text_color(t.dim).child(lay.shown === lay.total ? `${lay.total}` : `${lay.shown} of ${lay.total}`)));
    return h_flex().h(30).flex_none().gap(8).items_center().pb(6)
      .child(h_flex().id("pf-project").flex_none().gap(6).items_center().text_size(11).max_w(300)
        .on_mouse_down("left", stop).on_click((_e, cx) => { this.openProjects(); cx.notify(); })
        .child(div().text_color(t.accent).child("p"))
        .child(div().truncate().text_color(t.foreground).hover((s) => s.text_color(t.accent)).child(p?.title ?? "Project"))
        .when(Boolean(p?.number), (el) => el.child(div().flex_none().text_color(t.dim).child(`#${p.number}`))))
      .child(div().w(2).h(14).relative().flex_none().child(dither(t.ansi0, 1)))
      .child(h_flex().flex_none().gap(2).children(viewChips))
      .child(filter);
  }

  /** The rows a column draws: lane headers, cards and the gap that keeps a lane as tall as in the
   *  tallest column, so swimlanes line up across the board ({ lane } | { item } | { pad }). */
  rows(lay, ci) {
    const g = this.grid(lay)[ci] ?? [];
    if (!lay.lane) return g.map((item) => ({ item }));
    const where = new Map(lay.lanes.flatMap((l) => l.cells.flatMap((c) => c.map((i) => [i.id, l.key]))));
    const grid = this.grid(lay), chars = this.chars ?? 24, fields = this.fields ?? [];
    const height = (items) => items.reduce((n, i) => n + this.cardH(i, chars, fields), 0);
    const out = [];
    for (const lane of lay.lanes) {
      const inLane = (col) => (grid[col] ?? []).filter((i) => where.get(i.id) === lane.key);
      const items = inLane(ci);
      out.push({ lane, n: lane.folded ? lane.cells[ci].length : items.length });
      if (lane.folded) continue;
      for (const item of items) out.push({ item });
      const tallest = Math.max(0, ...lay.columns.map((c, k) => (c.folded ? 0 : height(inLane(k)))));
      const gap = tallest - height(items);
      if (gap > 0) out.push({ pad: gap, key: lane.key });
    }
    return out;
  }

  columns(t, b, lay, size) {
    const avail = size.width - (this.detailOpen ? DETAIL_W + GAP : 0);
    const cols = lay.columns;
    if (!cols.length) return div().flex_1().h_full().child(empty(t, "This view has no columns", "Its column field has no options yet.", { moon: 0 }));
    const fit = this.fits(lay);
    this.first = Math.max(0, Math.min(this.first, cols.length - 1));
    const shown = [];
    let open = 0;
    for (let i = this.first; i < cols.length; i++) { if (!cols[i].folded) { if (open >= fit) break; open++; } shown.push(i); }
    const folded = shown.filter((i) => cols[i].folded).length;
    const w = Math.max(200, Math.floor((avail - folded * (FOLD_W + GAP) - Math.max(0, open - 1) * GAP) / Math.max(1, open)) - (open ? 0 : 0));
    const a = this.at(lay), fields = cardFields(b, this.view(b), lay);
    // Every open column is as wide, so a card is as tall in each (the swimlanes line up).
    const cw = Math.min(w, 480);
    this.chars = Math.max(8, Math.floor((cw - 24) / CHAR)); this.fields = fields;
    const more = (n, side) => div().id(`pmore-${side}`).flex_none().w(14).h_full().flex().items_center().justify_center().text_size(10).text_color(t.dim).child(`${n}`);
    return h_flex().flex_1().min_w(0).h_full().gap(GAP)
      .when(this.first > 0, (el) => el.child(more(this.first, "l")))
      .children(shown.map((ci) => cols[ci].folded ? this.foldStrip(t, lay, ci) : this.column(t, b, lay, ci, cw, a, fields)))
      .when(shown.length && shown[shown.length - 1] < cols.length - 1, (el) => el.child(more(cols.length - 1 - shown[shown.length - 1], "r")));
  }

  foldStrip(t, lay, ci) {
    const c = lay.columns[ci];
    const letters = [...c.name.slice(0, 14)].map((ch, i) => div().id(`pfl-${i}`).h(11).text_size(10).text_color(t.dim).child(ch === " " ? " " : ch));
    return v_flex().id(`pfold-${ci}`).w(FOLD_W).flex_none().h_full().items_center().pt(6).gap(6).border(1).border_color(t.ansi0)
      .hover((s) => s.border_color(t.ansi8))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { this.toggleFold(lay, ci); this.selCol = ci; this.sel = null; this.keepSel(); this.app.focusSelf(); cx.notify(); })
      .child(pip(t, "done", 7).text_color(ansi(t, c.color)))
      .child(v_flex().items_center().children(letters))
      .child(div().text_size(10).text_color(c.limit && c.count > c.limit ? t.blocked : t.dim).child(String(c.count)));
  }

  column(t, b, lay, ci, w, a, fields) {
    const c = lay.columns[ci];
    const active = a.col === ci && this.focus === "board";
    const over = c.limit && (c.count + (this.carrying && this.carrying.col === ci && this.carrying.from.col !== ci ? 1 : 0)) > c.limit;
    const edge = over ? t.blocked : active ? t.accent : t.ansi0;
    const rows = this.rows(lay, ci);
    const chars = this.chars;
    const heights = rows.map((r) => (r.lane ? LANE_H : r.pad ? r.pad : this.cardH(r.item, chars, fields)));
    const count = c.limit ? `${c.count} / ${c.limit}` : String(c.count);
    const head = h_flex().id(`pch-${ci}`).relative().h(22).flex_none().px(8).gap(7).items_center().text_size(11)
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { this.selCol = ci; this.sel = this.grid(lay)[ci]?.[0]?.id ?? null; this.app.focusSelf(); cx.notify(); })
      .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(edge, 1)))
      .child(pip(t, "done", 7).text_color(ansi(t, c.color)))
      .child(div().relative().flex_1().min_w(0).truncate().text_color(active ? t.foreground : t.muted).child(c.name))
      .child(div().relative().flex_none().text_color(over ? t.blocked : t.dim).child(count));
    const drafting = this.typing === "draft" && a.col === ci;
    const list = !rows.length ? div().flex_1().min_h(0).child(empty(t, this.filterText || this.view(b)?.filter ? "Nothing matches" : "Nothing here", this.carrying ? "enter drops it here" : this.filterText ? "esc clears the filter" : "a adds a draft · m carries a card here", { moon: ci % 2 ? 0 : 1, small: false }))
      : div().flex_1().min_h(0).pt(2).child(v_virtual_list(`pcol-${b.project.id}-${ci}`, rows.length, heights, (i) => (rows[i].lane ? `lane-${rows[i].lane.key}` : rows[i].pad ? `pad-${rows[i].key}` : rows[i].item.id),
        (range) => rows.slice(range.start, range.end).map((r, k) => (r.lane ? this.laneRow(t, lay, r, ci, range.start + k)
          : r.pad ? div().id(`ppad-${ci}-${range.start + k}`).h(r.pad).w_full() : this.card(t, b, r.item, a, ci, chars, fields, lay))))
        .on_item_click((key, cx) => this.clicked(lay, ci, key, cx))
        .size_full().when(Boolean(this.handles[ci]), (el) => el.track_scroll(this.handles[ci])));
    return v_flex().id(`pcolumn-${ci}`).w(w).flex_none().h_full().min_h(0).border(1).border_color(edge)
      .on_mouse_down("left", (_e, cx) => { this.app.focusSelf(); cx.stop_propagation(); })
      .child(head)
      .when(drafting, (el) => el.child(h_flex().h(26).flex_none().mx(6).mt(4).px(6).gap(6).items_center().border(1).border_color(t.accent)
        .child(div().text_size(11).text_color(t.accent).child("+"))
        .child(Input.new(this.draft).flex_1().h_full().text_size(11).text_color(t.foreground))))
      .child(list);
  }

  clicked(lay, ci, key, cx) {
    if (key.startsWith("pad-")) return;
    if (key.startsWith("lane-")) {
      const lane = lay.lanes.find((l) => `lane-${l.key}` === key);
      const v = this.view();
      if (lane && v) this.setLocal((l) => { const f = new Set(l.lanes?.[v.id] ?? []); f.has(lane.key) ? f.delete(lane.key) : f.add(lane.key); return { ...l, lanes: { ...(l.lanes ?? {}), [v.id]: [...f] } }; });
    } else if (!this.carrying) {
      const again = this.sel === key;
      this.sel = key; this.selCol = ci; this.focus = "board";
      if (again || this.detailOpen) { this.detailOpen = true; this.scrollY = 0; const it = this.current(lay); if (it) this.readDetail(it, cx); }
    }
    this.app.focusSelf();
    cx.notify();
  }

  laneRow(t, lay, r, ci, i) {
    return h_flex().id(`plane-${ci}-${i}`).relative().h(LANE_H).px(8).gap(6).items_center().text_size(10)
      .hover((s) => s.bg(t.ansi0 + "55"))
      .child(div().flex_none().text_color(r.lane.done ? t.dim : t.ansi6).child(`${r.lane.folded ? "+" : "−"} ${r.lane.name}`))
      .child(div().flex_none().text_color(t.dim).child(String(r.n)))
      .child(div().relative().flex_1().h(2).child(dither(t.ansi0, 1)));
  }

  cardH(item, chars, fields) {
    const lines = wrap(item.content.title, chars - numW(item)).length;
    return 6 + lines * LINE + (item.content.labels.length ? 20 : 0) + (this.metaShown(item, fields) ? 17 : 0) + 7;
  }

  metaShown(item, fields) {
    return item.content.assignees.length > 0 || fields.some((f) => item.values.get(f.id)) || item.content.kind === "draft" || item.content.repo !== this.app.repo?.full || item.content.state === "CLOSED" || item.content.state === "MERGED";
  }

  card(t, b, item, a, ci, chars, fields, lay) {
    const c = item.content;
    const sel = item.id === this.sel && a.col === ci;
    const lifted = this.carrying?.id === item.id;
    const active = sel && this.focus === "board";
    const pending = this.pending.some((p) => p.state === "sending" && (p.op?.item === item.id || p.op?.item?.id === item.id));
    const lines = wrap(c.title, chars - numW(item));
    const num = c.kind === "draft" ? "draft" : c.number != null ? `#${c.number}` : "";
    const state = c.state === "MERGED" ? ["merged", t.ansi5] : c.state === "CLOSED" ? ["closed", t.blocked] : null;
    const otherRepo = c.repo && c.repo !== this.app.repo?.full ? c.repo.split("/")[1] : null;
    const values = fields.map((f) => [f, item.values.get(f.id)]).filter(([, v]) => v);
    const titleColor = lifted || sel ? t.foreground : c.kind === "draft" ? t.dim : t.muted;
    return v_flex().id(`pcard-${item.id}`).relative().w_full().h(this.cardH(item, chars, fields)).pl(10).pr(8).pt(6).gap(4).flex_none()
      .hover((s) => s.bg(t.ansi0 + "55"))
      .when(sel && !lifted, (el) => el.children(band(t, active)))
      .when(lifted, (el) => el.border(1).border_color(t.accent).child(dither(t.accent + "30", 1)))
      .when(!sel && !lifted, (el) => el.child(div().absolute().left(8).right(8).top(0).h(1).child(dither(t.ansi0, 1))))
      .child(h_flex().relative().gap(7).items_start().text_size(12)
        .when(lifted, (el) => el.child(svg(`${ART}/wings.svg`).w(16).h(6).mt(4).flex_none().text_color(t.working).loop("opacity", { from: 0.3, to: 1, period: 700 })))
        .child(div().flex_none().text_color(sel || lifted ? t.accent : c.kind === "draft" ? t.dim : t.ansi8).child(num))
        .child(v_flex().flex_1().min_w(0).children(lines.map((l, i) => div().id(`pt-${i}`).h(LINE).truncate().text_color(titleColor).child(l)))))
      .when(c.labels.length > 0, (el) => el.child(h_flex().relative().gap(4).pl(2).h(16).overflow_hidden().children(c.labels.slice(0, 4).map((l, i) =>
        div().id(`pl-${i}`).relative().px(5).h(16).flex_none().flex().items_center().text_size(10).text_color(t.foreground)
          .child(dither(`#${l.color ?? "666666"}88`, 1)).child(div().relative().child(l.name))))))
      .when(this.metaShown(item, fields), (el) => el.child(h_flex().relative().h(16).gap(6).pl(2).items_center().text_size(10).text_color(t.dim).overflow_hidden()
        .children(c.assignees.slice(0, 3).map((u, i) => avatar(t, u.login, i)))
        .when(c.assignees.length > 3, (e2) => e2.child(div().flex_none().child(`+${c.assignees.length - 3}`)))
        .when(Boolean(state), (e2) => e2.child(div().flex_none().text_color(state[1]).child(state[0])))
        .when(Boolean(otherRepo), (e2) => e2.child(div().flex_none().truncate().max_w(90).child(otherRepo)))
        .when(pending, (e2) => e2.child(div().flex_none().loop("opacity", { from: 0.3, to: 1, period: 900 }).child(pip(t, "working", 6))))
        .child(div().flex_1())
        .children(values.map(([f, v], i) => div().id(`pv-${i}`).flex_none().truncate().max_w(110).text_color(valueColor(t, f, v)).child(valueText(f, v))))));
  }

  /** The card docked right: its fields, its body (markdown) and the conversation. */
  detail(t, b, lay) {
    const item = this.current(lay), active = this.focus === "detail";
    const edge = active ? t.accent : t.ansi0;
    const frame = (body, right) => v_flex().id("pdetail").w(DETAIL_W).flex_none().h_full().min_h(0).border(1).border_color(edge)
      .on_mouse_down("left", (_e, cx) => { this.focus = "detail"; this.app.focusSelf(); cx.stop_propagation(); cx.notify(); })
      .child(h_flex().relative().h(22).flex_none().px(8).gap(8).items_center().text_size(11)
        .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(edge, 1)))
        .child(div().relative().flex_1().text_color(active ? t.foreground : t.muted).child(item ? { issue: "Issue", pr: "Pull request", draft: "Draft", redacted: "Item" }[item.content.kind] : "Item"))
        .child(div().relative().flex_none().text_color(t.dim).child(right ?? "")))
      .child(body);
    if (!item) return frame(empty(t, "Nothing selected", null, { moon: 0, small: true }));
    const c = item.content, kept = c.id ? this.details.get(c.id) : null, d = kept?.d;
    const rows = editableFields(b, item).filter((f) => f.type !== "title" && f.type !== "labels" && f.type !== "assignees").map((f) => [f.name, item.values.get(f.id) ? div().text_color(valueColor(t, f, item.values.get(f.id))).child(valueText(f, item.values.get(f.id))) : div().text_color(t.dim).child("—")]);
    const grid2 = v_flex().gap(3).text_size(11)
      .children([["Assignees", c.assignees.length ? h_flex().gap(6).items_center().children(c.assignees.map((u, i) => h_flex().id(`pda-${i}`).gap(4).items_center().child(avatar(t, u.login, 0)).child(div().text_color(t.foreground).child(u.login)))) : div().text_color(t.dim).child("—")],
        ...(c.kind !== "draft" ? [["Labels", c.labels.length ? h_flex().flex_wrap().gap(4).children(c.labels.map((l, i) => div().id(`pdl-${i}`).relative().px(5).h(16).flex().items_center().text_size(10).text_color(t.foreground).child(dither(`#${l.color ?? "666666"}88`, 1)).child(div().relative().child(l.name)))) : div().text_color(t.dim).child("—")]] : []),
        ...rows].map(([k, v], i) => h_flex().id(`pdf-${i}`).gap(10).items_start().child(div().w(84).flex_none().text_color(t.dim).child(k)).child(div().flex_1().min_w(0).child(v))));
    const md = (id, text) => markdown(t, id, text?.trim() ? text : "_No description._", { size: 12, onLink: (url, cx) => this.app.openUrl(url, cx) });
    const state = c.state === "MERGED" ? ["merged", t.ansi5] : c.state === "CLOSED" ? ["closed", t.blocked] : c.kind === "draft" ? ["draft", t.dim] : ["open", t.done];
    const content = v_flex().absolute().left(0).right(0).top(-this.scrollY).px(14).py(10).gap(8)
      .on_size_change((s, cx) => { const h = unzoom(s.height); if (Math.abs(h - this.contentH) > 1) { this.contentH = h; this.scroll(0); cx.notify(); } })
      .child(h_flex().gap(8).items_start().text_size(14)
        .when(c.number != null, (el) => el.child(div().flex_none().text_color(t.accent).child(`#${c.number}`)))
        .child(div().flex_1().min_w(0).text_color(t.foreground).child(c.title)))
      .child(h_flex().flex_wrap().gap_x(10).gap_y(2).text_size(11).text_color(t.muted)
        .when(Boolean(c.repo), (el) => el.child(div().child(c.repo)))
        .child(div().text_color(state[1]).child(state[0]))
        .when(Boolean(d?.createdAt), (el) => el.child(div().text_color(t.dim).child(`opened ${ago(d.createdAt)} ago${d.author ? ` by ${d.author}` : ""}`))))
      .child(grid2)
      .child(div().relative().h(2).child(dither(t.ansi0, 1)))
      .child(kept?.error ? div().text_size(11).text_color(t.blocked).child(kept.error) : md(`pd-body-${c.id ?? item.id}`, d ? d.body : c.id ? "_Reading…_" : ""))
      .when(Boolean(d?.comments?.length), (el) => el
        .child(h_flex().pt(8).gap(8).items_center().child(div().text_size(10).text_color(t.ansi8).child(`COMMENTS · ${d.comments.length + d.more}`)).child(div().relative().flex_1().h(2).child(dither(t.ansi0, 1))))
        .children(d.comments.map((cm, i) => v_flex().id(`pdc-${i}`).relative().gap(4).pl(12).py(6)
          .child(div().absolute().left(2).top(6).bottom(6).w(2).child(dither(t.ansi0, 1)))
          .child(h_flex().gap(8).text_size(11).child(div().text_color(t.accent).child(cm.who)).child(div().flex_1()).child(div().text_color(t.dim).child(ago(cm.at))))
          .child(md(`pd-c-${c.id}-${i}`, cm.body)))))
      .child(div().h(20));
    const view = div().id("pd-view").relative().flex_1().min_h(0).overflow_hidden()
      .on_size_change((s, cx) => { const h = unzoom(s.height); if (Math.abs(h - this.viewH) > 1) { this.viewH = h; this.scroll(0); cx.notify(); } })
      .on_scroll_wheel((e, cx) => { this.scroll(-unzoom(e.delta?.y ?? 0)); cx.notify(); })
      .child(content);
    return frame(view, kept?.at ? `read ${readAgo(kept.at)}` : c.id ? "reading…" : "");
  }

  /** The open menu, lazygit's: a framed list over the board. */
  menuPanel(t, b) {
    const m = this.menu;
    const row = (id, label, { on = false, cur = false, dim = false, color = null, right = "", hex = null, toggle = false } = {}) =>
      h_flex().id(id).relative().h(20).px(10).gap(7).items_center().text_size(11)
        .text_color(on ? t.foreground : dim ? t.dim : t.muted)
        .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
        .when(toggle, (el) => el.child(div().relative().flex_none().w(10).text_color(cur ? t.accent : t.dim).child(cur ? "■" : "□")))
        .when(Boolean(color), (el) => el.child(div().relative().child(pip(t, "done", 7).text_color(color))))
        .when(Boolean(hex), (el) => el.child(div().relative().size(8).flex_none().child(dither(`#${hex}`, 1))))
        .child(div().relative().flex_1().min_w(0).truncate().child(label))
        .when(Boolean(right) || (cur && !toggle), (el) => el.child(div().relative().flex_none().max_w(220).truncate().text_size(10).text_color(t.dim).child(right || "current")));
    const frame = (title, body, w = 380) => v_flex().id("pmenu").absolute().top(36).left(Math.max(0, Math.round((this.width - w) / 2))).w(w).bg(t.background).border(1).border_color(t.accent)
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
      return frame(m.title, v_flex().py(4).children(m.rows.slice(top, top + 14).map((r, i) => row(`pm-${top + i}`, r.label, { on: top + i === m.at, dim: r.dim, right: r.right })
        .on_mouse_down("left", stop).on_click((_e, cx) => { this.menu = null; r.go(cx); this.app.focusSelf(); cx.notify(); }))), 460);
    }
    const item = b.items.find((i) => i.id === m.item);
    if (!item) return div();
    const fields = m.fields.map((id) => b.fields.find((f) => f.id === id)).filter(Boolean);
    const f = fields[m.at], opts = f ? this.options(b, item, f) : [];
    const left = v_flex().w(170).flex_none().py(4).border_r(1).border_color(t.ansi0).children(fields.map((x, i) => {
      const v = x.type === "labels" ? String(item.content.labels.length || "") : x.type === "assignees" ? String(item.content.assignees.length || "") : x.type === "title" ? "" : valueText(x, item.values.get(x.id));
      return row(`pmf-${i}`, x.name, { on: i === m.at && m.side === "fields", right: v }).when(i === m.at && m.side !== "fields", (el) => el.text_color(t.foreground))
        .on_mouse_down("left", stop).on_click((_e, cx) => { m.at = i; m.side = "opts"; m.opt = 0; cx.notify(); });
    }));
    const otop = Math.max(0, Math.min(m.opt - 7, opts.length - 14));
    const right = v_flex().flex_1().min_w(0).py(4).children(opts.slice(otop, otop + 14).map((o, i) => row(`pmo-${otop + i}`, o.label, {
      on: m.side === "opts" && otop + i === m.opt, cur: o.on, dim: o.dim, right: o.right, hex: o.hex, toggle: o.toggle,
      color: o.color != null ? t[`ansi${o.color}`] : null,
    }).on_mouse_down("left", stop).on_click((_e, cx) => { m.side = "opts"; m.opt = otop + i; this.choose(b, item, f, o, cx); cx.notify(); })));
    return frame(`${label(item)} · fields`, h_flex().items_start().child(left).child(right), 460);
  }
}

// ---- small pieces

const label = (item) => (item.content.number != null ? `#${item.content.number}` : "the draft");
const numW = (item) => (item.content.kind === "draft" ? 6 : item.content.number != null ? String(item.content.number).length + 2 : 0);
const ansiKey = (color) => OPTION_ANSI.get(color) ?? 8;

/** Where o opens a card: its issue or PR, or the draft in the project's view. */
function itemUrl(b, view, item) {
  if (item.content.url) return item.content.url;
  const base = `${b.project.url}${view?.number ? `/views/${view.number}` : ""}`;
  return item.db ? `${base}?pane=issue&itemId=${item.db}` : base;
}

/** A login as a square of its initials, in its own color. */
function avatar(t, login, i) {
  return div().id(`pav-${login}-${i}`).relative().size(16).flex_none().flex().items_center().justify_center().text_size(9)
    .bg(t[`ansi${loginSlot(login)}`]).text_color(t.background).when(i > 0, (el) => el.ml(-3))
    .child(initials(login));
}

function valueColor(t, f, v) {
  if (f.type === "single") return ansi(t, f.options.find((o) => o.id === v.optionId)?.color);
  if (f.type === "iteration") return t.ansi6;
  if (f.type === "date") return t.muted;
  return t.muted;
}
