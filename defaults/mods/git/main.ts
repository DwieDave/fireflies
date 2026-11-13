// Nocturne Git: lazygit in Nocturne's night look, and the one git + review
// tool (diff's review lives here now, as the Files panel's Review
// tab). Every operation runs the real git CLI (git.ts), on this computer or
// a space's machine (`on`).
//
// Layout, lazygit's: five numbered side panels on the left (1 Status,
// 2 Files / Review / Worktrees, 3 Local branches / Remotes / Tags,
// 4 Commits / Reflog, 5 Stash), the main view on the right (the selection's
// diff; Unstaged over Staged while staging lines), the command log under it,
// the options bar at the bottom. + and _ (or the ⤢ in a panel's title)
// cycle the focused panel's screen mode: normal, half (it takes a wide middle
// column and the others fold into a rail; Commits draws its wide graph
// there) and full. Narrower than NARROW: one thing at a time.
//
// History comes in pages (lazygit's): the Commits panel and a branch's
// commits read LOG_LIMIT commits, the branch log LOG_FULL_LIMIT; when the end
// of a cut history comes into view, more() reads the next page below it.
// Every list is windowed (rowWindow): whole rows that fit its height, the
// last one ending inside the list.
//
// Keys: lazygit's defaults (keys.ts holds them all; ? lists them). Mouse:
// click focuses and selects, double-click drills in (enter), right-click
// opens that row's menu (its actions with their keys), the wheel scrolls
// the panel under it, the gaps between columns drag.
//
// keys.json (or `herdr-app do`) can send git.<action> to a shown
// window: any action of keys.ts (screen-next, push, panel-commits…).
//
// ctrl-p (or the ⧉ in the main view's title, a right-click menu, the
// palette) opens what the main view shows as a pane beside the focused pane,
// ctrl-shift-p in a new tab, and closes the window. That pane is this mod
// with props { show }: { kind: "file", path } (the working diff), "commit"
// { hash, path? }, "stash" { ref, path? }, "range" { a, b } (diff mode), or
// "review" { scope, pr?, repo?, path? } (the review list beside its diff),
// "log" { ref } (a branch's, remote branch's or tag's log, as the main view
// shows it for the Branches panel: lazygit's git log --graph on our lanes).
// It reads again on changes like the window; q / esc close the pane.
//
// Props: { folder?, on? } (the shown space's when missing), { review: true,
// scope? } to start on Review (diff's props land here), { pr, repo,
// back } a pull request's diff opened from the GitHub window: esc / q puts
// that window back. As an overlay window it says so in shared(WINDOW), so
// the toggle (nocturne's git.ts) closes it.


import { View, div } from "gpui-kit";
import type { AsyncContext, Context, FocusHandle, KeyEvent } from "gpui-kit";
import type { Props } from "gpui-shell";
import type { InputState } from "gpui-base";
import { v_flex } from "gpui-base";
import { props, theme, shared, setShared, nextCommand, home } from "herdr";
import type { Theme } from "herdr";
import { readShared, readSharedMap, writeShared, writeSharedMap } from "./guard.ts";
import type { Git, LogEntry } from "./git.ts";
import { LOG_LIMIT } from "./git.ts";
import type { Graph } from "./graph.ts";
import type { Commit } from "./parse.ts";
import type { Action, ListContext } from "./keys.ts";
import { lookup, keyName, isListContext } from "./keys.ts";
import { act } from "./actions.ts";
import type { CommitOptions, ConfirmOptions, MenuOptions, PromptOptions } from "./popups.ts";
import { Popups } from "./popups.ts";
import { bindTab, tabActions } from "./form-keys.ts";
import * as WT from "./worktrees.ts";
import { Review } from "./review.ts";
import { empty, unzoom, unzoomSize } from "./draw.ts";
import type { Back, Data, Panel, TabOf, Subs, Mode, Copied, MainContent, More, Staging, Note, Resizing, Show, Intent, MainHeights, OtherTops, Kept, SpawnOptions, Sub, ExecOptions, ViewContext, Tab } from "./state.ts";
import { Queue } from "./queue.ts";
import { NO_PROPS, isGitProps, isGroups, NO_GROUPS, here, STATE, WINDOW_KEY, GITHUB_WINDOW, PANELS } from "./state.ts";
import type { Job } from "./queue.ts";
import { isReviewFile, listItems, pathOf, rowKey } from "./items.ts";
import type { Item } from "./items.ts";
import { historyCut, listTail, rowMenu } from "./lists.ts";
import { windowBody } from "./main-view.ts";
import { optionsBar, windowHeader } from "./bars.ts";
import { goBack, quit, showNow } from "./panes.ts";
import { loadMain } from "./content.ts";
import { focusMain, giveWay, moveTo, scrollMain, setPanel, setTab } from "./navigate.ts";
import { loadAll, reload, reloadNow, reloadReview, start } from "./reads.ts";
import { actsOnCommands, saveCopy, takeCopy, toPane, toWindow } from "./place.ts";

export default class GitView extends View {
  overlay: string | null = null;
  /** A whole-window pane's own id (props.slot, place.ts). */
  slot: string | null = null;
  folder: string | null = null;
  on: string | null = null;
  /** The GitHub window to put back. */
  backTo: Back | null = null;
  state: "loading" | "norepo" | "ready" = "loading";
  git: Git | null = null;
  data: Data = { status: null, branches: [], remotes: [], remoteBranches: [], tags: [], commits: [], reflog: [], stash: [], worktrees: [], state: null, main: null, unpushed: new Set(), notMain: new Set() };
  graph: Graph | null = null;
  panel: Panel = "files";
  tabOf: TabOf = { files: "files", branches: "branches", commits: "commits" };
  subs: Subs = { status: [], files: [], branches: [], commits: [], stash: [] };
  sel: { [C in ListContext]?: number } = {};
  top: { [C in ListContext]?: number } = {};
  follow: { [C in ListContext]?: boolean } = {};
  vis: { [C in ListContext]?: number } = {};
  mode: Mode = "normal";
  focus: "side" | "main" = "side";
  tree = true;
  collapsed = new Set<string>();
  filters: { [C in ListContext]?: string } = {};
  filtering: { readonly ctx: ListContext; readonly input: InputState } | null = null;
  range: { readonly ctx: ListContext; readonly anchor: number } | null = null;
  statusFilter: "staged" | "unstaged" | null = null;
  branchSort: "date" | "name" = "date";
  copied: Copied[] = [];
  allBranches = false;
  noGraph = false;
  context = 3;
  ws = false;
  diffBase: string | null = null;
  diffReverse = false;
  main: MainContent | null = null;
  mainTop = 0;
  mainGen = 0;
  // How far back history is read: the Commits panel, and each ref's log in
  // the main view. Reaching the end of a history cut at its limit reads
  // further (more()), as lazygit does.
  commitLimit = LOG_LIMIT;
  logLimits = new Map<string, number>();
  moreBusy = new Set<More>();
  staging: Staging | null = null;
  logs: LogEntry[] = [];
  showLog = true;
  shellHistory: string[] = [];
  draft: string | null = null;
  noteText: Note | null = null;
  busyText: string | null = null;
  busyRows = new Map<string, number>(); // rowKey -> operations acting on that row (spawn)
  size = { width: 1000, height: 700 };
  sideW: number | null = null;
  railW: number | null = null;
  midW: number | null = null;
  logH = 110;
  resizing: Resizing | null = null;
  mouse = { x: 200, y: 200 };
  popups: Popups = new Popups(this);
  // A pane opened from the window (ctrl-p): one diff, or a review.
  show: Show | null = null;
  paneId: string | null = null;
  review: Review = new Review(this);
  // Opened for a worktree (the space menu's New / Remove worktree, the
  // sidebar's w, the palette, the old worktree dialog's callers):
  // { action: "new" | "open" | "remove", space?, branch?, tab?, argv? }.
  wtIntent: Intent | null = null;
  wtPicked = new Set<string>(); // worktree paths picked for d (M, U, A)
  userHome: string | null = null;
  handle: FocusHandle | null = null;
  acts = new Queue();
  reads = new Queue();
  closed = false;
  watching = false;
  reloadQueued = false;
  pickedPath = false;
  listPx: { [C in ListContext]?: number } = {};
  mainPx: MainHeights = {};
  otherTop: OtherTops = {};
  mainVis: number | null = null;
  wheelAcc = 0;
  mainWheel = 0;

  override init(p: Props | undefined, cx: AsyncContext) {
    this.takeProps(p);
    takeCopy(this);

    this.handle = cx.focus_handle();
    bindTab(cx); // tab / shift-tab reach the key handler (form-keys.ts)

    const handle = this.handle;

    handle.focus();

    if (this.overlay) {
      for (const ms of [60, 250, 600]) {
        cx.timer.after(ms, () => {
          if (!this.closed && !this.popups.open && !this.filtering) handle.focus();
        });
      }
    }

    this.beat();

    if (this.overlay) cx.timer.every(4000, () => this.beat());

    this.drainQueues(cx);
    start(this);
    cx.timer.every(this.on ? 15000 : 30000, () => reload(this));
    cx.timer.every(1000, (cx) => {
      if (this.noteText && Date.now() - this.noteText.at > 6000) {
        this.noteText = null;
        cx.notify();
      }
    });
    this.listen(handle, cx);
  }

  /** The props (or the shown space) and what the window kept for its folder. */
  takeProps(p: Props | undefined) {
    const given = props() ?? p ?? NO_PROPS;
    const pr = isGitProps(given) ? given : NO_PROPS;
    const groups = isGroups(given) ? given : NO_GROUPS;

    this.overlay = pr.overlay ?? null;
    this.slot = pr.slot ?? null;

    const h = pr.folder ? { folder: pr.folder, on: pr.on ?? null } : here();

    this.folder = h.folder;
    this.on = h.on ?? null;
    this.backTo = groups.back ?? null; // { mod, props }: the GitHub window to put back

    const kept: Kept = this.folder === null ? {} : readSharedMap(shared, STATE).get(this.folder) ?? {};

    this.panel = kept.panel ?? "files";
    this.tabOf = { files: kept.tabOf?.files ?? "files", branches: kept.tabOf?.branches ?? "branches", commits: kept.tabOf?.commits ?? "commits" };
    this.mode = kept.mode ?? "normal";
    this.tree = kept.tree ?? true;
    this.showLog = kept.showLog ?? true;
    this.sideW = kept.sideW ?? null;
    this.railW = kept.railW ?? null;
    this.midW = kept.midW ?? null;
    this.logH = kept.logH ?? 110;
    // A pane opened from the window (ctrl-p): one diff, or a review.
    this.show = groups.show ?? null;
    this.paneId = pr.paneId ?? null;

    const rv = this.show?.kind === "review" ? this.show : pr;

    this.review = new Review(this, { scope: rv.scope ?? "work", pr: rv.pr ?? null, repo: rv.repo ?? null });

    if (pr.review || pr.pr || pr.scope || this.show?.kind === "review") {
      this.panel = "files";
      this.tabOf.files = "review";
    }

    this.wtIntent = groups.worktrees ?? null;
    this.userHome = this.on ? null : home();

    if (this.wtIntent) {
      this.panel = "files";
      this.tabOf.files = "worktrees";
      this.mode = "normal";
    }

    if (this.show) {
      this.mode = "normal";
      this.showLog = false;

      if (this.show.kind !== "review") this.focus = "main";
    }

  }

  /** Runs the queues' jobs, each on its own long-lived task (queue.ts). */
  drainQueues(cx: AsyncContext) {
    for (const q of [this.acts, this.reads]) {
      cx.spawn(async (cx) => {
        for (;;) {
          const job = await q.next();

          if (this.closed) return;

          try { await job(cx); } catch (cause: unknown) { this.error(cause instanceof Error ? cause.message : String(cause)); }

          if (this.closed) return;

          cx.notify();
        }
      });
    }
  }

  /** The commands sent to the window (keys.json's git.<action>, the toggle's focus). */
  listen(handle: FocusHandle, cx: AsyncContext) {
    cx.spawn(async (cx) => {
      for (;;) {
        const c = (await nextCommand()).replace(/^git\./, "");

        if (c === "focus") handle.focus();
        else if (c === "refresh") reload(this, true);
        else if (c === "review") {
          this.setPanel("files");
          this.setTab("review");
        }
        // keys.json can bind any key table action: git.<action>
        // (panel-commits for panel:commits).
        // One copy acts: the window while one is open, else the pane with the keyboard (place.ts).
        else if (!actsOnCommands(this)) { /* another copy's */ }
        else if (c === "to-pane") toPane(this);
        else if (c === "to-window") toWindow(this);
        else if (this.popups.open) {
          if (c === "back") this.popups.close();
          else if (c === "menu-run" || c === "confirm-yes" || c === "prompt-ok" || c === "commit-ok") this.popups.ok(cx);
        } else if (this.state === "ready") act(this, c.replace(/^panel-/, "panel:"), cx);

        cx.notify();
      }
    });
  }

  // ---- life

  beat() {
    if (!this.overlay || this.closed) return;

    // In the GitHub window's place (its d), this window is the one cmd-shift-g closes.
    if (this.backTo) writeShared(setShared, GITHUB_WINDOW, { id: this.overlay, beat: Date.now() });
    else writeShared(setShared, WINDOW_KEY, { id: this.overlay, beat: Date.now(), folder: this.folder });
  }

  override async close() {
    this.closed = true;
    this.saveState();

    const w = readShared(shared, WINDOW_KEY, null);

    if (this.overlay && w?.id === this.overlay) writeShared(setShared, WINDOW_KEY, null);
  }

  saveState() {
    if (!this.folder || this.show) return;

    const all = new Map(readSharedMap(shared, STATE));

    all.set(this.folder, { panel: this.panel, tabOf: this.tabOf, mode: this.mode, tree: this.tree, showLog: this.showLog, sideW: this.sideW, railW: this.railW, midW: this.midW, logH: this.logH });
    writeSharedMap(setShared, STATE, all);
    saveCopy(this);
  }

  focusSelf() { if (!this.closed) this.handle?.focus(); }

  /** Queues an operation. While it's queued and running, the row it acts on
   *  (`row`: a rowKey; by default the shown panel's selected row, taken now,
   *  at the key; null: none, as fetch all) shows a spinner in the row. */
  spawn(fn: Job, options: SpawnOptions = {}) {
    const done = this.hold(options.row === undefined ? this.selectedRow() : options.row);

    this.acts.push(async (cx) => {
      try { await fn(cx); } finally { done(); }
    });
  }

  /** The shown panel's selected row, as a rowKey (null for Status). */
  selectedRow() {
    const ctx = this.ctxOf(this.panel);

    return rowKey(ctx, this.item(ctx));
  }

  /** Marks a row busy until the returned function is called (counted: two
   *  operations on one row keep it busy until both are done). */
  hold(key: string | null) {
    if (!key) return () => {};

    this.busyRows.set(key, (this.busyRows.get(key) ?? 0) + 1);

    let held = true;

    return () => {
      if (!held) return;

      held = false;

      const n = (this.busyRows.get(key) ?? 1) - 1;

      if (n > 0) this.busyRows.set(key, n);
      else this.busyRows.delete(key);
    };
  }

  /** `fn(cx)` shortly after the next frame (focusing a new input). */
  later(fn: (cx: Context) => void, ms = 40) { this.reads.push(async (cx) => { cx.timer.after(ms, (cx2) => fn(cx2)); }); }

  async reloadNow() {
    return reloadNow(this);
  }

  reloadReview() {
    return reloadReview(this);
  }

  // ---- notes, errors, the log

  note(text: string, tone: Note["tone"] = "done") { this.noteText = { text, tone, at: Date.now() }; }

  busy(text: string | null) { this.busyText = text; }

  error(text: string) { this.popups.confirm({ title: "Error", text: (text || "git failed").trim().split("\n").slice(-6).join("\n"), error: true }); }

  logged(entry: LogEntry) {
    if (!this.logs.includes(entry)) this.logs.push(entry);

    if (this.logs.length > 200) this.logs.splice(0, this.logs.length - 200);
  }

  showOutput(cmd: string, text: string, ok: boolean) {
    this.popups.confirm({ title: cmd, text: text.split("\n").slice(-14).join("\n") || "(no output)", error: !ok });
  }

  /** A git action: runs, then reads everything again; a failure opens lazygit's error popup. */
  exec(title: string, args: readonly string[], options: ExecOptions = {}) {
    const { row, ...opts } = options;

    this.spawn(async () => {
      const g = this.git;

      if (!g) return;

      const r = await g.run(title, args, opts);

      if (!r.ok) this.error(r.err);

      await loadAll(this);
    }, row === undefined ? {} : { row });
  }

  copy(text: string, cx: Context) {
    cx.write_to_clipboard(text);
    this.note(`Copied ${text.length > 40 ? `${text.slice(0, 40)}…` : text}`);
  }

  ask(o: ConfirmOptions) { this.popups.confirm(o); }

  prompt(o: PromptOptions) { this.popups.prompt(o); }

  menu(o: MenuOptions) { this.popups.menu(o); }

  commitPopup(o: CommitOptions) { this.popups.commit(o); }

  commitWhat() {
    const n = (this.data.status?.files ?? []).filter((f) => f.staged).length;

    return `${n} file${n === 1 ? "" : "s"} staged · ${this.data.status?.head ?? "detached"}`;
  }

  // ---- worktrees

  tilde(p: string) { return WT.tilde(p, this.userHome); }

  /** Per worktree: the spaces showing it and the agents in it. */
  occupancy() { return WT.occupancy(this.data.worktrees, this.on); }

  // ---- what's where

  sub(p: Panel = this.panel): Sub | null {
    const s = this.subs[p];

    return s[s.length - 1] ?? null;
  }

  ctxOf(p: Panel): ListContext {
    const s = this.sub(p);

    if (s) return s.kind;

    if (p === "status" || p === "stash") return p;

    return this.tabOf[p];
  }

  ctx(): ViewContext {
    if (this.popups.open) return this.popups.kind ?? "menu";

    if (this.filtering) return "filter";

    if (this.focus === "main" || (this.show && this.show.kind !== "review")) return this.staging ? "staging" : "main";

    return this.ctxOf(this.panel);
  }

  /** The newest drill-in list of a kind (enter on a branch: its commits). */
  subOfKind(kind: Sub["kind"]) { return Object.values(this.subs).flat().reverse().find((x) => x.kind === kind) ?? null; }

  /** The rows a list context shows (filtered). */
  items(ctx: ListContext): readonly Item[] {
    return listItems(this, ctx);
  }

  /** The review file under the cursor, when the cursor is on one (review.ts). */
  reviewItem() {
    const x = this.item();

    return isReviewFile(x) ? x : null;
  }

  /** The selected row of a context (the focused panel's by default). */
  item(context: ViewContext = this.focus === "main" ? this.ctxOf(this.panel) : this.ctx()): Item | null {
    const ctx = isListContext(context) ? context : this.ctxOf(this.panel);
    const list = this.items(ctx);

    return list[Math.min(this.sel[ctx] ?? 0, list.length - 1)] ?? null;
  }

  itemPath() {
    if (this.staging) return this.staging.file.path;

    const x = this.item();

    return pathOf(x);
  }

  /** The rows a range selection (v) covers, or the selected one. */
  pickedRows(): readonly Item[] {
    const ctx = this.ctxOf(this.panel), list = this.items(ctx), i = this.sel[ctx] ?? 0;

    if (this.range?.ctx === ctx) return list.slice(Math.min(this.range.anchor, i), Math.max(this.range.anchor, i) + 1);

    const x = list[i];

    return x ? [x] : [];
  }

  selectRange(a: number, b: number) {
    const ctx = this.ctxOf(this.panel);

    this.range = { ctx, anchor: a };
    this.sel[ctx] = b;
    this.follow[ctx] = true;
  }

  commitList(): readonly Commit[] {
    const s = this.sub();

    return this.ctxOf(this.panel) === "subCommits" ? (s?.kind === "subCommits" ? s.items : []) : this.data.commits;
  }

  commitIndex() { return this.sel[this.ctxOf(this.panel)] ?? 0; }

  isHead(c: { readonly hash: string }) { return c.hash === this.data.status?.oid; }

  rebasing() { return this.data.state === "rebasing"; }

  clampAll() {
    for (const p of PANELS) {
      const ctx = this.ctxOf(p), n = this.items(ctx).length;

      if ((this.sel[ctx] ?? 0) >= n) this.sel[ctx] = Math.max(0, n - 1);
    }
  }

  // ---- moving

  setPanel(p: Panel) {
    return setPanel(this, p);
  }

  setTab(id: Tab) {
    return setTab(this, id);
  }

  moveTo(i: number) {
    return moveTo(this, i);
  }

  /** What the main view shows now, as a pane's { show } (null: nothing to open). */
  showNow(): Show | null {
    return showNow(this);
  }

  goBack() {
    return goBack(this);
  }

  focusMain() {
    return focusMain(this);
  }

  scrollMain(d: number, lines: number | null = null) {
    return scrollMain(this, d, lines);
  }

  run(action: Action, cx: Context) { act(this, action, cx); }

  // ---- staging lines

  // ---- the main view's content

  // ---- keys

  key(e: KeyEvent, cx: Context) {
    // cmd-enter submits a popup's form (keyName leaves cmd chords to the app).
    const k = this.popups.open && e.key === "enter" && e.modifiers.platform ? "cmd-enter" : keyName(e);

    if (!k) return;

    if (this.popups.open) {
      if (this.popups.key(k, e, cx)) {
        cx.stop_propagation();
        cx.notify();
      }

      return;
    }

    if (this.filtering) {
      if (k === "escape") {
        giveWay(this);
        cx.stop_propagation();
        cx.notify();
      } else if (k === "enter" || k === "down" || k === "up") {
        this.filtering = null;
        this.handle?.focus();
        loadMain(this);
        cx.stop_propagation();
        cx.notify();
      }

      return;
    }

    const ctx = this.ctx();

    if (this.state !== "ready") {
      if (k === "q" || k === "escape") {
        quit(this, k === "escape");
        cx.stop_propagation();
      }

      return;
    }

    if (ctx === "keys" || ctx === "filter") return;

    const b = lookup(ctx, k);

    if (!b) return;

    if (!act(this, b.action, cx)) return;

    cx.stop_propagation();
    cx.notify();
  }

  // ---- mouse

  rowMenu(ctx: ListContext, i: number, cx: Context) {
    return rowMenu(this, ctx, i, cx);
  }

  // ---- drawing: lists

  /** Whether a list holds a history cut at its limit (it goes further back).
   *  Not while filtered: the end of a filtered list isn't the history's. */
  cut(ctx: ListContext) {
    return historyCut(this, ctx);
  }

  /** Below a commit list's last row: its open lanes run on to the bottom
   *  edge (history cut at the limit, or the panel taller than the list), so
   *  no line ends in the air. */
  listTail(t: Theme, ctx: ListContext, last: number, rowH: number) {
    return listTail(this, t, ctx, last, rowH);
  }

  // ---- drawing: panels

  override render() {
    const t = theme();

    const body = this.state === "loading" ? empty(t, "Reading the repo…", this.folder ?? "", { moon: 3 })
      : this.state === "norepo" ? empty(t, "Not a git repository", `${this.folder ?? "This space has no folder"}: the git window shows the repo of the shown space's folder.`, { moon: 0 })
      : windowBody(this, t);

    const endResize = (cx: Context) => {
      if (this.resizing) {
        this.resizing = null;
        this.saveState();
        cx.notify();
      }
    };

    const root = v_flex().id("git").relative().size_full().bg(t.background);
    const framed = this.overlay ? root.border(1).border_color(t.ansi8) : root;
    const handle = this.handle;
    const r = this.resizing;

    const sized = (handle ? framed.track_focus(handle) : framed)
      .on_key_down((e, cx) => this.key(e, cx))
      .map((el) => tabActions(el, (e, cx) => this.key(e, cx)))
      .on_size_change((drawn, cx) => {
        const size = unzoomSize(drawn);

        if (Math.abs(size.width - this.size.width) > 1 || Math.abs(size.height - this.size.height) > 1) {
          this.size = size;
          cx.notify();
        }
      });

    const cursor = r ? (r.axis === "x" ? sized.cursor_col_resize() : sized.cursor_row_resize()) : sized;

    const view = cursor
      .on_mouse_move((e, cx) => {
        this.mouse = { x: unzoom(e.local_position.x), y: unzoom(e.local_position.y) };

        const now = this.resizing;

        if (!now) return;

        const moved = unzoom((now.axis === "x" ? e.position.x : e.position.y) - now.at) * now.sign;

        now.set(Math.round(Math.min(now.max, Math.max(now.min, now.from + moved))));
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => endResize(cx))
      .on_hover((h, cx) => { if (!h) endResize(cx); })
      .child(windowHeader(this, t))
      .child(div().id("git-body").relative().flex_1().min_h(0).pt(4)
        .on_mouse_down("left", (_e, cx) => { this.handle?.focus(); cx.stop_propagation(); })
        .child(body))
      .child(optionsBar(this, t));

    const popup = this.popups.open ? this.popups.render(t, this.size) : null;

    return popup ? view.child(popup) : view;
  }
}


