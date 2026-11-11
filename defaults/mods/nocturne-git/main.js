// Nocturne Git: lazygit in Nocturne's night look, and the one git + review
// tool (nocturne-diff's review lives here now, as the Files panel's Review
// tab). Every operation runs the real git CLI (git.js), on this computer or
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
// Keys: lazygit's defaults (keys.js holds them all; ? lists them). Mouse:
// click focuses and selects, double-click drills in (enter), right-click
// opens that row's menu (its actions with their keys), the wheel scrolls
// the panel under it, the gaps between columns drag.
//
// keys.json (or `herdr-app do`) can send nocturne-git.<action> to a shown
// window: any action of keys.js (screen-next, push, panel-commits…).
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
// scope? } to start on Review (nocturne-diff's props land here), { pr, repo,
// back } a pull request's diff opened from the GitHub window: esc / q puts
// that window back. As an overlay window it says so in shared(WINDOW), so
// the toggle (nocturne's git.js) closes it.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { props, theme, settings, shared, setShared, spaces, panes, focused, run, nextCommand, closeOverlay, openOverlay, watchFolder, home } from "herdr";
import { Git, LOG_LIMIT } from "./git.js";
import { layoutGraph, usedWidth, widthOf } from "./graph.js";
import { rows as diffRows, isChange, hunkKeys } from "./patch.js";
import { fileTree, dirLetters, letters, age, initials, relativeDate } from "./parse.js";
import { lookup, barKeys, menuKeys, bindings, keyName, keyLabel, LISTS } from "./keys.js";
import { act } from "./actions.js";
import { Popups } from "./popups.js";
import { keysHint } from "./keyhelp.js";
import { bindTab, tabActions } from "./form-keys.js";
import * as WT from "./worktrees.js";
import { Review } from "./review.js";
import { ART, dither, panel, band, chip, hints, empty, graphCell, graphPass, logTail, diffLine, laneColors, letterColor, unzoom, unzoomSize, stop } from "./draw.js";

export const WINDOW = "nocturne-git.window"; // { id, beat }: the open window, for the toggle
const STATE = "nocturne-git.state"; // where the window was, per folder
const PANELS = ["status", "files", "branches", "commits", "stash"];
const TABS = {
  files: [["files", "Files"], ["review", "Review"], ["worktrees", "Worktrees"]],
  branches: [["branches", "Local branches"], ["remotes", "Remotes"], ["tags", "Tags"]],
  commits: [["commits", "Commits"], ["reflog", "Reflog"]],
};
const MODES = ["normal", "half", "full"];
const ROW = 18, WIDE_ROW = 32, LOG_ROW = 16, NARROW = 640;
// The graph's lane width: the Commits list, its wide rows, the branch log.
const LANE = 10, WIDE_LANE = 13;
const CONTEXT_NAMES = {
  status: "status", files: "files", review: "review", worktrees: "worktrees", branches: "branches", remotes: "remotes", remoteBranches: "remote branches",
  tags: "tags", commits: "commits", reflog: "reflog", subCommits: "commits", commitFiles: "commit files", stash: "stash", staging: "staging", main: "main view",
  menu: "menu", confirm: "confirm", prompt: "prompt", commit: "commit", filter: "filter",
};

/** A job queue a long-lived task drains: async work keeps that task's cx. */
class Queue {
  constructor() { this.items = []; this.wake = null; }
  push(job) { this.items.push(job); const w = this.wake; this.wake = null; w?.(); }
  async next() { while (!this.items.length) await new Promise((r) => { this.wake = r; }); return this.items.shift(); }
}

/** The shown space's folder and machine. */
function here() {
  const space = spaces().find((s) => s.active) ?? null;
  const tab = space?.tabs.find((c) => c.active)?.id ?? null;
  const f = focused();
  const pane = panes().find((p) => p.focused && p.tab === tab) ?? panes().find((p) => p.tab === tab && p.cwd);
  return { folder: (space?.attached && space.folder) || pane?.cwd || f?.cwd || space?.folder || null, on: space?.machine ?? null };
}

export default class GitView extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    this.overlay = pr.overlay ?? null;
    const h = pr.folder ? { folder: pr.folder, on: pr.on ?? null } : here();
    this.folder = h.folder; this.on = h.on ?? null;
    this.backTo = pr.back ?? null; // { mod, props }: the GitHub window to put back
    this.state = "loading"; // loading | norepo | ready
    this.git = null;
    this.data = { status: null, branches: [], remotes: [], remoteBranches: [], tags: [], commits: [], reflog: [], stash: [], worktrees: [], state: null, main: null, unpushed: new Set(), notMain: new Set() };
    this.graph = null;
    const kept = (shared(STATE) ?? {})[this.folder] ?? {};
    this.panel = kept.panel ?? "files";
    this.tabOf = { files: "files", branches: "branches", commits: "commits", ...(kept.tabOf ?? {}) };
    this.subs = { files: [], branches: [], commits: [], stash: [] };
    this.sel = {}; this.top = {}; this.follow = {}; this.vis = {};
    this.mode = kept.mode ?? "normal";
    this.focus = "side"; // side | main
    this.tree = kept.tree ?? true;
    this.collapsed = new Set();
    this.filters = {}; this.filtering = null; // { ctx, input }
    this.range = null; // { ctx, anchor }
    this.statusFilter = null;
    this.branchSort = "date";
    this.copied = [];
    this.allBranches = false; this.noGraph = false;
    this.context = 3; this.ws = false;
    this.diffBase = null; this.diffReverse = false;
    this.main = null; this.mainTop = 0; this.mainGen = 0;
    this.staging = null;
    this.logs = []; this.showLog = kept.showLog ?? true;
    this.shellHistory = [];
    this.draft = null;
    this.noteText = null; this.busyText = null;
    this.size = { width: 1000, height: 700 };
    this.sideW = kept.sideW ?? null; this.railW = kept.railW ?? null; this.midW = kept.midW ?? null; this.logH = kept.logH ?? 110;
    this.resizing = null;
    this.mouse = { x: 200, y: 200 };
    this.popups = new Popups(this);
    // A pane opened from the window (ctrl-p): one diff, or a review.
    this.show = pr.show ?? null;
    this.paneId = pr.paneId ?? null;
    const rv = this.show?.kind === "review" ? this.show : pr;
    this.review = new Review(this, { scope: rv.scope ?? "work", pr: rv.pr ?? null, repo: rv.repo ?? null });
    if (pr.review || pr.pr || pr.scope || this.show?.kind === "review") { this.panel = "files"; this.tabOf.files = "review"; }
    // Opened for a worktree (the space menu's New / Remove worktree, the
    // sidebar's w, the palette, the old worktree dialog's callers):
    // { action: "new" | "open" | "remove", space?, branch?, tab?, argv? }.
    this.wtIntent = pr.worktrees ?? null;
    this.wtPicked = new Set(); // worktree paths picked for d (M, U, A)
    this.userHome = this.on ? null : home?.() ?? null;
    if (this.wtIntent) { this.panel = "files"; this.tabOf.files = "worktrees"; this.mode = "normal"; }
    if (this.show) { this.mode = "normal"; this.showLog = false; if (this.show.kind !== "review") this.focus = "main"; }
    this.handle = cx.focus_handle();
    bindTab(cx); // tab / shift-tab reach the key handler (form-keys.js)
    this.handle.focus();
    if (this.overlay) for (const ms of [60, 250, 600]) cx.timer.after(ms, () => { if (!this.closed && !this.popups.open && !this.filtering) this.handle.focus(); });
    this.beat();
    if (this.overlay) cx.timer.every(4000, () => this.beat());
    this.acts = new Queue(); this.reads = new Queue();
    for (const q of [this.acts, this.reads]) {
      cx.spawn(async (cx) => {
        for (;;) {
          const job = await q.next();
          if (this.closed) return;
          try { await job(cx); } catch (e) { this.error(String(e?.message ?? e)); }
          if (this.closed) return;
          cx.notify();
        }
      });
    }
    this.start();
    cx.timer.every(this.on ? 15000 : 30000, () => this.reload());
    cx.timer.every(1000, (cx) => { if (this.noteText && Date.now() - this.noteText.at > 6000) { this.noteText = null; cx.notify(); } });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^nocturne-git\./, "");
        if (c === "focus") this.handle.focus();
        else if (c === "refresh") this.reload(true);
        else if (c === "review") { this.setPanel("files"); this.setTab("review"); }
        // keys.json can bind any key table action: nocturne-git.<action>
        // (panel-commits for panel:commits).
        // While a git window is open, commands are its keys: other copies (panes) leave them.
        else if (this.notMine()) { /* the window's */ }
        else if (this.popups.open) { if (c === "back") this.popups.close(); else if (c === "menu-run" || c === "confirm-yes" || c === "prompt-ok" || c === "commit-ok") this.popups.ok(cx); }
        else if (this.state === "ready") act(this, c.replace(/^panel-/, "panel:"), cx);
        cx.notify();
      }
    });
  }

  // ---- life

  start() {
    this.reads.push(async () => {
      if (!this.folder) { this.state = "norepo"; return; }
      this.git = await Git.open(this.folder, this.on, (e) => this.logged(e));
      if (!this.git) { this.state = "norepo"; return; }
      this.state = "ready";
      await this.loadAll();
      this.watch();
      if (this.on && !this.userHome) this.userHome = await WT.userHomeOn(this.on).catch(() => null);
      this.worktreeIntent();
    });
  }

  watch() {
    if (this.on || this.watching) return;
    this.watching = true;
    this.reads.push(async (cx) => {
      cx.spawn(async () => {
        try {
          for (;;) {
            const paths = await watchFolder(this.git.root);
            if (this.closed) return;
            // Our own index writes show up too; a refresh is cheap and idempotent.
            if (paths?.length) this.reload();
          }
        } catch { this.watching = false; }
      });
    });
  }

  /** A git window is open and this copy isn't it. */
  notMine() {
    const w = shared(WINDOW);
    return Boolean(w?.id && Date.now() - (w.beat ?? 0) < 10000 && w.id !== this.overlay);
  }

  beat() {
    if (!this.overlay || this.closed) return;
    // In the GitHub window's place (its d), this window is the one cmd-shift-g closes.
    if (this.backTo) setShared("nocturne-github.window", { id: this.overlay, beat: Date.now() });
    else setShared(WINDOW, { id: this.overlay, beat: Date.now(), folder: this.folder });
  }

  async close() {
    this.closed = true;
    this.saveState();
    const w = shared(WINDOW);
    if (this.overlay && w?.id === this.overlay) setShared(WINDOW, null);
  }

  saveState() {
    if (!this.folder || this.show) return;
    const all = { ...(shared(STATE) ?? {}) };
    all[this.folder] = { panel: this.panel, tabOf: this.tabOf, mode: this.mode, tree: this.tree, showLog: this.showLog, sideW: this.sideW, railW: this.railW, midW: this.midW, logH: this.logH };
    setShared(STATE, all);
  }

  focusSelf() { if (!this.closed) this.handle.focus(); }

  /** Runs `fn(cx)` on the action queue (git actions run one at a time). */
  spawn(fn) { this.acts.push(fn); }

  /** `fn(cx)` shortly after the next frame (focusing a new input). */
  later(fn, ms = 40) { this.reads.push(async (cx) => { cx.timer.after(ms, (cx2) => fn(cx2)); }); }

  reload(loud = false) {
    if (this.state !== "ready" || this.reloadQueued) return;
    this.reloadQueued = true;
    this.reads.push(async () => { this.reloadQueued = false; await this.loadAll(); if (loud) this.note("Refreshed"); });
  }

  async reloadNow() { await this.loadAll(); }

  reloadReview() { this.reads.push(async () => { await this.review.load(); this.pickShownPath(); this.clampAll(); this.loadMain(); }); }

  /** A review pane opened on a file starts on it. */
  pickShownPath() {
    if (!this.show?.path || this.pickedPath) return;
    const i = this.review.shown().findIndex((f) => f.path === this.show.path);
    if (i >= 0) { this.sel.review = i; this.follow.review = true; this.pickedPath = true; }
  }

  async loadAll() {
    const g = this.git;
    if (!g) return;
    const [status, branches, remotes, remoteBranches, tags, stash, worktrees, state] = await Promise.all([
      g.status(), g.branches(), g.remotes(), g.remoteBranches(), g.tags(), g.stash(), WT.listWorktrees(g), g.state(),
    ]);
    if (this.data.main === null) this.data.main = (await g.mainBranch()) ?? undefined;
    const main = this.data.main || null;
    const commits = await g.log("HEAD", { all: this.allBranches });
    const [unpushed, notMain] = await Promise.all([
      status.upstream ? g.only("HEAD", "@{u}") : Promise.resolve(new Set(commits.filter(() => !status.upstream).map((c) => c.hash))),
      main && status.head !== main ? g.only("HEAD", main) : Promise.resolve(new Set()),
    ]);
    Object.assign(this.data, { status, branches, remotes, remoteBranches, tags, stash, worktrees, state, commits, unpushed, notMain });
    this.graph = layoutGraph(commits);
    if (this.ctxOf(this.panel) === "reflog" || this.data.reflog.length) this.data.reflog = await g.reflog();
    for (const s of Object.values(this.subs).flat()) await this.loadSub(s);
    if (this.tabOf.files === "review" || this.review.files.length) { await this.review.load(); this.pickShownPath(); }
    if (this.staging) await this.loadStaging();
    this.clampAll();
    this.loadMain();
  }

  async loadSub(s) {
    const g = this.git;
    if (s.kind === "subCommits") { s.items = await g.log(s.ref); s.graph = layoutGraph(s.items); }
    else if (s.kind === "remoteBranches") s.items = this.data.remoteBranches.filter((r) => r.remote === s.remote);
    else if (s.kind === "commitFiles") s.items = await g.commitFiles(s.hash);
  }

  // ---- notes, errors, the log

  note(text, tone = "done") { this.noteText = { text, tone, at: Date.now() }; }
  busy(text) { this.busyText = text; }
  error(text) { this.popups.confirm({ title: "Error", text: String(text || "git failed").trim().split("\n").slice(-6).join("\n"), error: true }); }

  logged(entry) {
    if (!this.logs.includes(entry)) this.logs.push(entry);
    if (this.logs.length > 200) this.logs.splice(0, this.logs.length - 200);
  }

  showOutput(cmd, text, ok) {
    this.popups.confirm({ title: cmd, text: text.split("\n").slice(-14).join("\n") || "(no output)", error: !ok });
  }

  /** A git action: runs, then reads everything again; a failure opens lazygit's error popup. */
  exec(title, args, opts = {}) {
    this.spawn(async () => {
      const r = await this.git.run(title, args, opts);
      if (!r.ok) this.error(r.err);
      await this.loadAll();
    });
  }

  copy(text, cx) {
    if (!cx?.write_to_clipboard) return;
    cx.write_to_clipboard(String(text));
    this.note(`Copied ${String(text).length > 40 ? `${String(text).slice(0, 40)}…` : text}`);
  }

  ask(o) { this.popups.confirm(o); }
  prompt(o) { this.popups.prompt(o); }
  menu(o) { this.popups.menu(o); }
  commitPopup(o) { this.popups.commit(o); }
  commitWhat() {
    const n = (this.data.status?.files ?? []).filter((f) => f.staged).length;
    return `${n} file${n === 1 ? "" : "s"} staged · ${this.data.status?.head ?? "detached"}`;
  }

  /** A program in a terminal floating over the tab (an editor, git's own editor). */
  terminal(argv, name, folder = this.git.root) {
    run("terminal.open", { argv, folder, place: "float", name });
    // lazygit suspends for an editor; the floating window would sit over it.
    if (this.overlay) { this.saveState(); closeOverlay(this.overlay); }
  }

  editFile(path) {
    this.terminal(["sh", "-c", 'exec ${VISUAL:-${EDITOR:-vi}} "$1"', "-", path], path.split("/").pop());
  }

  /** $VISUAL / $EDITOR on a folder (a worktree), in a floating terminal there. */
  editIn(folder) {
    this.terminal(["sh", "-c", 'exec ${VISUAL:-${EDITOR:-vi}} .'], folder.split("/").pop(), folder);
  }

  openFile(path) {
    run("preview.open", { path: `${this.git.root}/${path}`, in: "system", ...(this.on ? { on: this.on } : {}) });
  }

  recentRepos() {
    const seen = new Set([this.git?.root, this.folder]);
    const out = [];
    for (const s of spaces()) {
      for (const f of [s.folder, ...panes().filter((p) => s.tabs.some((c) => c.id === p.tab)).map((p) => p.cwd)]) {
        if (!f || seen.has(f) || (s.machine ?? null) !== this.on) continue;
        seen.add(f);
        out.push({ folder: f, name: f.split("/").pop() });
      }
    }
    return out.slice(0, 20);
  }

  switchRepo(folder) {
    this.saveState();
    this.folder = folder; this.git = null; this.state = "loading";
    this.subs = { files: [], branches: [], commits: [], stash: [] };
    this.sel = {}; this.top = {}; this.staging = null; this.focus = "side"; this.main = null;
    this.data.main = null; this.review.files = [];
    this.watching = false; this.wtPicked = new Set();
    this.start();
  }

  // ---- worktrees

  tilde(p) { return WT.tilde(p, this.userHome); }

  /** Per worktree: the spaces showing it and the agents in it. */
  occupancy() { return WT.occupancy(this.data.worktrees, this.on); }

  /** After a worktree was made or picked from outside (a space's menu, the
   *  palette, the sidebar's w): what it asked for, once the repo is read. */
  worktreeIntent() {
    const want = this.wtIntent;
    this.wtIntent = null;
    if (!want) return;
    this.setPanel("files"); this.setTab("worktrees");
    const s = want.space ? spaces().find((x) => x.id === want.space) : null;
    const here = s ? WT.owner(this.data.worktrees, WT.spaceFolder(s)) : WT.owner(this.data.worktrees, this.folder);
    const i = here ? this.items("worktrees").findIndex((w) => w.path === here.path) : -1;
    if (i >= 0) this.moveTo(i);
    if (want.action === "new" || want.branch) this.newWorktree({ value: want.branch ?? "", now: Boolean(want.branch), tab: want.tab, argv: want.argv });
    else if (want.action === "remove") {
      if (!here || here.main) this.error(here ? "This is the repository's main checkout, not a worktree." : "That space isn't on a worktree of this repo.");
      else this.removeWorktrees([here]);
    }
  }

  /** Goes to a worktree: the space showing it, else a new space there
   *  (unnamed, so it follows the checkout and nests under its repo); the
   *  window steps aside, as after lazygit's worktree switch. */
  goToWorktree(w, { tab, argv } = {}) {
    if (w.prunable) return this.error("Its folder is gone: X prunes it.");
    const s = this.occupancy().get(w.path)?.spaces[0];
    if (s && !tab && !argv) run("space.select", { id: s.id });
    else run("space.new", { folder: w.path, machine: this.on ?? "", ...(tab ? { tab } : {}), ...(argv ? { argv } : {}) });
    if (this.overlay && !this.show) { this.saveState(); closeOverlay(this.overlay); }
  }

  /** n: a branch for a new worktree (an existing one is checked out, a new
   *  one starts from `base`, HEAD by default), checked out under
   *  ~/.herdr/worktrees/<repo>/ and opened as a space. `now`: no prompt. */
  newWorktree({ value = "", base = null, label = null, track = false, now = false, tab, argv } = {}) {
    const from = label ?? this.data.status?.head ?? "HEAD";
    const go = (branch) => {
      const name = String(branch ?? "").trim();
      if (!name) return;
      this.spawn(async () => {
        this.busyText = `Checking out ${name}…`;
        const made = await WT.create(this.git, name, { base });
        this.busyText = null;
        if (made.error) { this.error(made.error); await this.loadAll(); return; }
        if (track && made.created && base) await this.git.run("Set upstream", ["-C", made.path, "branch", "--set-upstream-to", base]);
        await this.loadAll();
        const w = this.data.worktrees.find((x) => x.path === made.path) ?? { path: made.path, branch: name };
        this.note(`${name} checked out in ${this.tilde(made.path)}`);
        this.goToWorktree(w, { tab, argv });
      });
    };
    if (now) return go(value);
    const out = new Set(this.data.worktrees.map((w) => w.branch).filter(Boolean));
    const local = this.data.branches.filter((b) => !out.has(b.name));
    this.prompt({
      title: "New worktree: branch", value,
      placeholder: "a branch: an existing one, or a new name",
      note: `An existing branch is checked out; a new one starts from ${from}. It goes to ${this.tilde(this.userHome ? WT.ROOT(this.userHome) : "~/.herdr/worktrees")}/${this.git.name}/ and opens as a space.`,
      suggest: (q) => {
        const f = q.trim().toLowerCase();
        return local.filter((b) => !f || b.name.toLowerCase().includes(f)).map((b) => ({ value: b.name, sub: b.subject ?? "" }));
      },
      ok: go,
    });
  }

  /** d: removes the picked worktrees (M / U / A), else the range, else the
   *  selected one, after one confirm that says what goes with them. */
  removeWorktrees(list = null) {
    const all = this.items("worktrees");
    let items = list;
    if (!items && this.wtPicked.size) items = this.data.worktrees.filter((w) => this.wtPicked.has(w.path));
    if (!items && this.range?.ctx === "worktrees") {
      const [a, b] = [Math.min(this.range.anchor, this.sel.worktrees ?? 0), Math.max(this.range.anchor, this.sel.worktrees ?? 0)];
      items = all.slice(a, b + 1);
    }
    if (!items) items = [this.item("worktrees")].filter(Boolean);
    if (items.some((w) => w.main)) {
      items = items.filter((w) => !w.main);
      if (!items.length) return this.error("This is the repository's main checkout: it can't be removed (a worktree can).");
    }
    if (!items.length) return;
    this.note(`Checking ${items.length === 1 ? WT.label(items[0]) : `${items.length} worktrees`}…`);
    this.reads.push(async () => {
      const info = await Promise.all(items.map((w) => (w.prunable ? { dirty: 0, subs: 0, unpushed: [] } : WT.inspect(w, this.on))));
      const occ = this.occupancy();
      const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
      const dirty = info.filter((x) => x.dirty), subs = info.filter((x) => x.subs), lost = info.flatMap((x) => x.unpushed);
      const spaceN = items.reduce((k, w) => k + (occ.get(w.path)?.spaces.length ?? 0), 0);
      const agentN = items.reduce((k, w) => k + (occ.get(w.path)?.agents.length ?? 0), 0);
      const one = items.length === 1;
      const lines = [
        ...(one ? [[`Deletes ${this.tilde(items[0].path)}. The branch stays unless b.`, "muted"]] : items.slice(0, 6).map((w) => [`${WT.label(w)}  ${this.tilde(w.path)}`, "muted"])),
        ...(items.length > 6 ? [[`and ${items.length - 6} more`, "dim"]] : []),
        ...(dirty.length ? [[one ? `${n(dirty[0].dirty, "uncommitted file")}: lost` : `${n(dirty.length, "has", "have")} uncommitted changes: lost`, "ansi1"]] : []),
        ...(lost.length ? [[`Submodule ${lost.join(", ")} has commits pushed nowhere: lost`, "ansi1"]] : []),
        ...(spaceN || agentN ? [[[spaceN ? `closes ${n(spaceN, "space")}` : null, agentN ? `ends ${n(agentN, "agent")}` : null].filter(Boolean).join(", "), agentN ? "ansi1" : "ansi3"]] : []),
      ];
      const checks = [{ key: "b", label: one ? "also delete its branch" : "also delete their branches", on: false }];
      if (subs.length) checks.push({ key: "s", label: "take the submodules out first (else forced)", on: true });
      this.ask({
        title: one ? `Remove worktree ${WT.label(items[0])}` : `Remove ${items.length} worktrees`,
        text: one ? `Remove the worktree ${WT.label(items[0])}?` : `Remove these ${items.length} worktrees?`,
        danger: true, lines, checks,
        go: (_cx, picked) => {
          const branch = picked?.find((c) => c.key === "b")?.on ?? false;
          const clearSubs = picked?.find((c) => c.key === "s")?.on ?? true;
          this.spawn(async () => {
            const failed = [];
            const leaving = items.some((w) => w.path === this.git.root);
            for (const [k, w] of items.entries()) {
              if (w.prunable) continue;
              const say = (text) => { this.busyText = `${items.length > 1 ? `${k + 1} of ${items.length}, ` : ""}${WT.label(w)}: ${text}`; };
              const error = await WT.removeOne(this.git, w, { ...info[k], clearSubs, branch, spaces: occ.get(w.path)?.spaces ?? [] },
                { closeSpace: (s) => run("space.close", { id: s.id, confirmed: true }), step: say });
              if (error) failed.push(`${WT.label(w)}: ${error}`);
              else this.wtPicked.delete(w.path);
            }
            if (items.some((w) => w.prunable)) await this.git.run("Prune worktrees", ["worktree", "prune"]);
            this.busyText = null;
            if (failed.length) this.error(`Removed ${items.length - failed.length} of ${items.length}. Not removed:\n${failed.join("\n")}`);
            else this.note(one ? `Removed ${WT.label(items[0])}` : `Removed ${items.length} worktrees`);
            // The window was on one of them: it goes to the main checkout.
            if (leaving && !failed.length) { const main = this.data.worktrees.find((w) => w.main); if (main) { this.switchRepo(main.path); return; } }
            await this.loadAll();
          });
        },
      });
    });
  }

  /** M: picks the worktrees whose branch is merged into the main checkout's. */
  pickMergedWorktrees() {
    const base = this.data.worktrees.find((w) => w.main)?.branch;
    if (!base) return this.error("The main checkout has no branch to compare with.");
    this.reads.push(async () => {
      const merged = await WT.merged(this.git, base);
      this.wtPicked = new Set(this.data.worktrees.filter((w) => !w.main && w.branch && w.branch !== base && merged.has(w.branch)).map((w) => w.path));
      this.note(this.wtPicked.size ? `${this.wtPicked.size} merged into ${base} picked: d removes them, esc lets go` : `Nothing merged into ${base}`);
    });
  }

  // ---- what's where

  sub(p = this.panel) { const s = this.subs[p]; return s?.length ? s[s.length - 1] : null; }

  ctxOf(p) {
    const s = this.sub(p);
    if (s) return s.kind;
    if (p === "status" || p === "stash") return p;
    return this.tabOf[p];
  }

  ctx() {
    if (this.popups.open) return this.popups.kind;
    if (this.filtering) return "filter";
    if (this.focus === "main" || (this.show && this.show.kind !== "review")) return this.staging ? "staging" : "main";
    return this.ctxOf(this.panel);
  }

  /** The rows a list context shows (filtered). */
  items(ctx) {
    const d = this.data;
    let list;
    switch (ctx) {
      case "status": list = [{ kind: "status" }]; break;
      case "files": {
        const files = (d.status?.files ?? []).filter((f) => !this.statusFilter || (this.statusFilter === "staged" ? f.staged : f.unstaged));
        list = this.tree ? fileTree(files, this.collapsed) : files.map((f) => ({ kind: "file", path: f.path, name: f.path, depth: 0, file: f }));
        break;
      }
      case "review": list = this.review.shown(); break;
      case "worktrees": list = d.worktrees; break;
      case "branches": list = this.branchSort === "name" ? [...d.branches].sort((a, b) => (b.head - a.head) || a.name.localeCompare(b.name)) : d.branches; break;
      case "remotes": list = d.remotes; break;
      case "tags": list = d.tags; break;
      case "commits": list = d.commits; break;
      case "reflog": list = d.reflog; break;
      case "stash": list = d.stash; break;
      case "remoteBranches": case "subCommits": case "commitFiles": {
        const s = Object.values(this.subs).flat().reverse().find((x) => x.kind === ctx);
        list = s?.items ?? [];
        if (ctx === "commitFiles" && this.tree) list = fileTree(list.map((f) => ({ ...f, path: f.path })), this.collapsed);
        else if (ctx === "commitFiles") list = list.map((f) => ({ kind: "file", path: f.path, name: f.path, depth: 0, file: f }));
        break;
      }
      default: list = [];
    }
    const q = (this.filters[ctx] ?? "").toLowerCase();
    if (!q) return list;
    return list.filter((x) => [x.name, x.path, x.subject, x.hash, x.url, x.branch].some((s) => s && String(s).toLowerCase().includes(q)));
  }

  /** The selected row of a context (the focused panel's by default). */
  item(ctx = this.focus === "main" ? this.ctxOf(this.panel) : this.ctx()) {
    if (!LISTS.has(ctx)) ctx = this.ctxOf(this.panel);
    const list = this.items(ctx);
    return list[Math.min(this.sel[ctx] ?? 0, list.length - 1)] ?? null;
  }

  itemPath() {
    if (this.staging) return this.staging.file.path;
    const x = this.item();
    return x?.path ?? x?.file?.path ?? null;
  }

  /** The rows a range selection (v) covers, or the selected one. */
  pickedRows() {
    const ctx = this.ctxOf(this.panel), list = this.items(ctx), i = this.sel[ctx] ?? 0;
    if (this.range?.ctx === ctx) {
      const [a, b] = [Math.min(this.range.anchor, i), Math.max(this.range.anchor, i)];
      return list.slice(a, b + 1);
    }
    return list[i] ? [list[i]] : [];
  }

  selectRange(a, b) {
    const ctx = this.ctxOf(this.panel);
    this.range = { ctx, anchor: a };
    this.sel[ctx] = b; this.follow[ctx] = true;
  }

  commitList() { return this.ctxOf(this.panel) === "subCommits" ? this.sub()?.items ?? [] : this.data.commits; }
  commitIndex() { return this.sel[this.ctxOf(this.panel)] ?? 0; }
  isHead(c) { return c.hash === this.data.status?.oid; }
  rebasing() { return this.data.state === "rebasing"; }

  clampAll() {
    for (const p of PANELS) {
      const ctx = this.ctxOf(p), n = this.items(ctx).length;
      if ((this.sel[ctx] ?? 0) >= n) this.sel[ctx] = Math.max(0, n - 1);
    }
  }

  // ---- moving

  setPanel(p) {
    if (!PANELS.includes(p) || (this.show && p !== "files")) return;
    if (this.panel === p && this.focus === "side") return;
    this.panel = p; this.focus = "side"; this.staging = null; this.range = null;
    this.ensureLoaded();
    this.loadMain();
  }

  ensureLoaded() {
    const ctx = this.ctxOf(this.panel);
    if (ctx === "reflog" && !this.data.reflog.length) this.reads.push(async () => { this.data.reflog = await this.git.reflog(); this.loadMain(); });
    if (ctx === "review" && this.review.state === "idle") this.reloadReview();
  }

  stepPanel(d) {
    if (this.focus === "main") { this.back(); return; }
    const i = PANELS.indexOf(this.panel);
    this.setPanel(PANELS[(i + d + PANELS.length) % PANELS.length]);
  }

  setTab(id) {
    const p = Object.keys(TABS).find((k) => TABS[k].some(([t]) => t === id));
    if (!p) return;
    this.tabOf[p] = id; this.subs[p] = []; this.range = null;
    this.ensureLoaded();
    this.loadMain();
  }

  stepTab(d) {
    const tabs = TABS[this.panel];
    if (!tabs || this.sub()) return;
    const i = tabs.findIndex(([t]) => t === this.tabOf[this.panel]);
    this.setTab(tabs[(i + d + tabs.length) % tabs.length][0]);
  }

  move(d) {
    const ctx = this.ctxOf(this.panel), n = this.items(ctx).length;
    if (!n) return;
    this.sel[ctx] = Math.max(0, Math.min(n - 1, (this.sel[ctx] ?? 0) + d));
    this.follow[ctx] = true;
    this.mainTop = 0;
    this.loadMain();
  }

  moveTo(i) {
    const ctx = this.ctxOf(this.panel), n = this.items(ctx).length;
    this.sel[ctx] = Math.max(0, Math.min(n - 1, i === Infinity ? n - 1 : i));
    this.follow[ctx] = true;
    this.mainTop = 0;
    this.loadMain();
  }

  page() { return Math.max(1, (this.vis[this.ctxOf(this.panel)] ?? 10) - 1); }

  toggleRange() {
    const ctx = this.ctxOf(this.panel);
    if (this.focus === "main" && this.staging) { this.staging.anchor = this.staging.anchor == null ? this.staging.cur : null; this.staging.hunkMode = false; return; }
    this.range = this.range ? null : { ctx, anchor: this.sel[ctx] ?? 0 };
  }

  toggleDir(path) { this.collapsed.has(path) ? this.collapsed.delete(path) : this.collapsed.add(path); }

  collapseAll(fold) {
    if (!fold) { this.collapsed.clear(); return; }
    const files = this.ctxOf(this.panel) === "commitFiles" ? this.sub()?.items ?? [] : this.data.status?.files ?? [];
    for (const r of fileTree(files)) if (r.kind === "dir") this.collapsed.add(r.path);
  }

  enterSub(s) {
    const p = this.panel;
    s.items = [];
    this.subs[p] = [...this.subs[p], s];
    this.sel[s.kind] = 0; this.top[s.kind] = 0;
    this.reads.push(async () => { await this.loadSub(s); this.loadMain(); });
  }

  openFilter() {
    const ctx = this.ctxOf(this.panel);
    const input = InputState.new({ placeholder: "filter", value: this.filters[ctx] ?? "" });
    input.on("change", (_e, cx) => { this.filters[ctx] = input.value(); this.sel[ctx] = 0; this.top[ctx] = 0; cx.notify(); });
    input.on("submit", (_e, cx) => { this.filtering = null; this.handle.focus(); this.loadMain(); cx.notify(); });
    this.filtering = { ctx, input };
    input.focus();
    this.later(() => { if (this.filtering?.input === input) input.focus(); });
  }

  /** esc: the innermost thing gives way first. */
  back() {
    if (this.filtering) { const c = this.filtering.ctx; this.filtering = null; this.filters[c] = ""; this.handle.focus(); return; }
    if (this.show && this.show.kind !== "review") { this.closePane(); return; }
    if (this.focus === "main") { this.focus = "side"; this.staging = null; this.loadMain(); return; }
    if (this.range) { this.range = null; return; }
    const ctx = this.ctxOf(this.panel);
    if (ctx === "worktrees" && this.wtPicked.size) { this.wtPicked = new Set(); return; }
    if (this.filters[ctx]) { this.filters[ctx] = ""; return; }
    if (this.sub()) { this.subs[this.panel] = this.subs[this.panel].slice(0, -1); this.loadMain(); return; }
    if (this.diffBase) { this.diffBase = null; this.loadMain(); return; }
    if (this.copied.length && (ctx === "commits" || ctx === "reflog" || ctx === "subCommits")) { this.copied = []; this.note("Copied commits forgotten"); return; }
    if (this.mode !== "normal") { this.mode = "normal"; return; }
    this.quit(true);
  }

  /** q: back to the GitHub window when it opened this, else close. esc
   *  at the top level closes only a window (a pane stays). */
  quit(fromEsc = false) {
    if (this.show) return this.closePane();
    if (this.backTo) return this.goBack();
    if (this.overlay) { this.saveState(); closeOverlay(this.overlay); return; }
    if (!fromEsc) run("pane.close");
  }

  /** Closes this copy's own pane (a ctrl-p pane finds itself by its paneId prop). */
  closePane() {
    const mine = this.paneId ? panes().find((p) => p.mod === "nocturne-git" && p.props?.paneId === this.paneId) : null;
    run("pane.close", mine ? { pane: mine.pane } : {});
  }

  /** What the main view shows now, as a pane's { show } (null: nothing to open). */
  showNow() {
    const ctx = this.ctxOf(this.panel), x = this.item(ctx);
    if (this.diffBase) {
      const ref = x?.hash ?? x?.oid ?? null;
      if (ref) return this.diffReverse ? { kind: "range", a: ref, b: this.diffBase } : { kind: "range", a: this.diffBase, b: ref };
    }
    if (this.staging) return { kind: "file", path: this.staging.file.path };
    switch (ctx) {
      case "files": return x?.file ? { kind: "file", path: x.file.path } : x?.kind === "dir" ? { kind: "review", scope: "work", path: x.files[0]?.path } : null;
      case "review": return { kind: "review", scope: this.review.scope, ...(this.review.pr ? { pr: this.review.pr, repo: this.review.prRepo } : {}), ...(x?.path ? { path: x.path } : {}) };
      case "commits": case "subCommits": case "reflog": return x?.hash ? { kind: "commit", hash: x.hash } : null;
      case "commitFiles": {
        const s = this.sub(), f = x?.file ?? x;
        const path = x?.kind === "dir" ? null : f?.path ?? null;
        return s?.stash ? { kind: "stash", ref: s.hash, ...(path ? { path } : {}) } : { kind: "commit", hash: s.hash, ...(path ? { path } : {}) };
      }
      case "stash": return x ? { kind: "stash", ref: x.hash ?? x.ref } : null;
      case "branches": case "tags": case "remoteBranches": return x?.name ? { kind: "log", ref: x.name } : null;
    }
    return null;
  }

  /** ctrl-p: the main view as a pane beside the focused pane (tab: in a new
   *  tab); the window steps aside. */
  openPane(tab = false) {
    const show = this.git && this.showNow();
    if (!show) return this.error("Nothing in the main view to open as a pane.");
    const props = { folder: this.git.root, ...(this.on ? { on: this.on } : {}), show, paneId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}` };
    if (tab) run("tab.new", { mod: "nocturne-git", props, name: paneName(show) });
    else run("pane.split", { direction: "auto", mod: "nocturne-git", props });
    // The window steps aside a moment later: closed in the same turn, the new
    // pane's first tasks were cancelled with it (it stayed on "Reading…").
    if (this.overlay) {
      this.saveState();
      const id = this.overlay;
      this.later(() => closeOverlay(id), 300);
    }
  }

  goBack() {
    this.saveState();
    openOverlay({ mod: this.backTo.mod, kind: "window", key: "nocturne-github", frame: "none", scrim: true, width: 0.85, height: 0.85, props: this.backTo.props ?? {} });
  }

  focusMain() {
    const ctx = this.ctxOf(this.panel);
    if (ctx === "files") { const r = this.item(); if (r?.file) return this.startStaging(r.file); }
    if (!this.main?.rows?.length) return;
    this.focus = "main";
  }

  screen(d) {
    this.mode = MODES[(MODES.indexOf(this.mode) + d + MODES.length) % MODES.length];
    this.focus = "side";
    this.saveState();
  }

  setContext(d) {
    this.context = Math.max(0, Math.min(30, this.context + d));
    this.note(`Diff context: ${this.context} lines`);
    if (this.staging) this.reads.push(async () => { await this.loadStaging(); });
    this.loadMain();
  }

  scrollMain(d, lines = null) {
    const n = (this.staging?.rows ?? this.main?.rows ?? []).length;
    const step = lines ?? Math.max(4, Math.floor((this.mainVis ?? 20) / 2));
    if (this.staging && lines == null) { this.stepLine(d * step); return; }
    this.mainTop = Math.max(0, Math.min(Math.max(0, n - 4), this.mainTop + d * step));
  }

  /** ?: every key of the focused context, the list's and the window's, as
   *  keyhelp.js's overview; a row runs its action (j k enter, or its key). */
  openKeys() {
    const ctx = this.ctx();
    const own = bindings(LISTS.has(ctx) || ctx === "staging" || ctx === "main" ? ctx : this.ctxOf(this.panel));
    const glob = bindings("global").filter((b) => !b.flags.has("hidden"));
    const list = LISTS.has(ctx) ? bindings("list").filter((b) => !b.flags.has("hidden")) : [];
    const row = (b) => Object.assign([b.keys.map(keyLabel).join(" "), b.label, (cx) => this.run(b.action, cx)], { key: b.keys[0], danger: b.flags.has("danger") });
    this.popups.keys({
      title: `git · ${CONTEXT_NAMES[ctx] ?? ctx}`,
      sections: [{ title: CONTEXT_NAMES[ctx] ?? ctx, keys: own.filter((b) => !b.flags.has("hidden")).map(row) },
        ...(list.length ? [{ title: "list", keys: list.map(row) }] : []),
        { title: "global", keys: glob.map(row) }].filter((s) => s.keys.length),
    });
  }

  /** A row's right-click menu: its context's actions with their keys. */
  contextMenu(ctx) {
    const items = menuKeys(ctx).map((b) => ({ key: keyLabel(b.key), label: b.label, danger: b.flags.has("danger"), go: (cx) => this.run(b.action, cx) }));
    if (!this.show && PANE_CONTEXTS.has(ctx)) {
      items.push({ key: "ctrl-p", label: "Open the diff as a pane", go: () => this.openPane(false) });
      items.push({ key: "ctrl-shift-p", label: "Open the diff in a new tab", go: () => this.openPane(true) });
    }
    const x = this.item(ctx);
    const title = x?.name ?? x?.path ?? x?.subject ?? CONTEXT_NAMES[ctx];
    this.menu({ title: String(title).slice(0, 60), items, at: { x: this.mouse.x, y: this.mouse.y } });
  }

  run(action, cx) { act(this, action, cx); }

  // ---- staging lines

  startStaging(file) {
    this.staging = { file, side: file.unstaged ? "unstaged" : "staged", diff: null, rows: [], cur: 0, anchor: null, hunkMode: false, other: null };
    this.focus = "main";
    this.reads.push(async () => { await this.loadStaging(true); });
  }

  async loadStaging(first = false) {
    const s = this.staging;
    if (!s) return;
    const now = (this.data.status?.files ?? []).find((f) => f.path === s.file.path);
    if (!now) { this.staging = null; this.focus = "side"; return; }
    s.file = now;
    if (s.side === "unstaged" && !now.unstaged) s.side = "staged";
    if (s.side === "staged" && !now.staged) s.side = "unstaged";
    const [mine, other] = await Promise.all([
      this.git.fileDiff(now, { cached: s.side === "staged", context: this.context, ws: false }),
      (s.side === "staged" ? now.unstaged : now.staged) ? this.git.fileDiff(now, { cached: s.side !== "staged", context: this.context }) : Promise.resolve(null),
    ]);
    if (this.staging !== s) return;
    s.diff = mine; s.rows = mine ? diffRows(mine) : [];
    s.other = other ? diffRows(other) : null;
    if (!s.rows.length) { this.staging = null; this.focus = "side"; return; }
    const changes = s.rows.map((r, i) => (isChange(r) ? i : -1)).filter((i) => i >= 0);
    if (first || !isChange(s.rows[s.cur])) s.cur = changes.find((i) => i >= (first ? 0 : s.cur)) ?? changes[changes.length - 1] ?? 0;
    s.top = Math.min(s.top ?? 0, s.cur);
  }

  pickedKeys() {
    const s = this.staging;
    if (!s) return new Set();
    const r = s.rows[s.cur];
    if (!r) return new Set();
    if (s.hunkMode) return new Set(hunkKeys(s.diff, r.hunk));
    const [a, b] = s.anchor == null ? [s.cur, s.cur] : [Math.min(s.anchor, s.cur), Math.max(s.anchor, s.cur)];
    return new Set(s.rows.slice(a, b + 1).filter(isChange).map((x) => `${x.hunk}:${x.line}`));
  }

  stepLine(d) {
    const s = this.staging;
    if (!s) return;
    if (s.hunkMode) return this.stepHunk(d > 0 ? 1 : -1);
    let i = s.cur;
    const n = Math.abs(d), dir = Math.sign(d);
    for (let k = 0; k < n; k++) {
      let j = i + dir;
      while (j >= 0 && j < s.rows.length && !isChange(s.rows[j])) j += dir;
      if (j < 0 || j >= s.rows.length) break;
      i = j;
    }
    s.cur = i;
  }

  stepHunk(d) {
    const s = this.staging;
    if (!s) { this.scrollMain(d); return; }
    const h = s.rows[s.cur]?.hunk ?? 0;
    const target = Math.max(0, Math.min(s.diff.hunks.length - 1, h + d));
    const i = s.rows.findIndex((r) => r.hunk === target && isChange(r));
    if (i >= 0) s.cur = i;
  }

  switchSide() {
    const s = this.staging;
    if (!s?.other) return;
    s.side = s.side === "staged" ? "unstaged" : "staged";
    s.anchor = null; s.cur = 0;
    this.reads.push(async () => { await this.loadStaging(true); });
  }

  stepFile(d) {
    if (!this.staging) {
      // The main view of a multi-file diff: jump between its files.
      const rows = this.main?.rows ?? [];
      const starts = rows.map((r, i) => (r.kind === "file" ? i : -1)).filter((i) => i >= 0);
      const next = d > 0 ? starts.find((i) => i > this.mainTop) : [...starts].reverse().find((i) => i < this.mainTop);
      if (next != null) this.mainTop = next;
      else if (this.ctxOf(this.panel) === "review") { this.move(d); }
      return;
    }
    const files = (this.data.status?.files ?? []);
    const i = files.findIndex((f) => f.path === this.staging.file.path);
    const f = files[(i + d + files.length) % files.length];
    if (f) this.startStaging(f);
  }

  // ---- the main view's content

  loadMain() {
    const gen = ++this.mainGen;
    this.reads.push(async () => {
      if (gen !== this.mainGen || !this.git) return;
      const m = await this.mainContent();
      if (gen !== this.mainGen) return;
      this.main = m;
      this.mainTop = Math.min(this.mainTop, Math.max(0, (m?.rows?.length ?? 1) - 1));
    });
  }

  /** lazygit's branch log (git log --graph with whole headers): a block of
   *  rows per commit, the commit line on the lane graph's node, the others
   *  with the lanes running through, in the Commits panel's colors. */
  async logRows(ref) {
    const commits = await this.git.logFull(ref);
    const graph = layoutGraph(commits);
    const head = this.data.status?.oid;
    const refColor = { head: "ansi6", branch: "ansi2", ref: "ansi1", tag: "ansi3", detached: "ansi6" };
    const rows = [];
    commits.forEach((c, i) => {
      const g = graph.rows[i], w = usedWidth(g);
      const line = (parts) => rows.push({ kind: "log", g, w, node: false, parts });
      const refs = c.refs.flatMap((r, k) => [[k ? ", " : " (", "ansi3"], [r.kind === "head" ? `HEAD -> ${r.name}` : r.kind === "tag" ? `tag: ${r.name}` : r.name, refColor[r.kind] ?? "ansi2"]]);
      rows.push({ kind: "log", g, w, node: true, head: c.hash === head, parts: [[`commit ${c.short}`, "ansi3"], ...refs, ...(refs.length ? [[")", "ansi3"]] : [])] });
      if (c.parents.length > 1) line([["Merge: ", "dim"], [c.parents.map((p) => p.slice(0, 7)).join(" "), "muted"]]);
      line([["Author: ", "dim"], [`${c.author} <${c.email}>`, "ansi5"]]);
      line([["Date:   ", "dim"], [relativeDate(c.date), "muted"]]);
      for (const l of c.message.split("\n")) line([[`    ${l}`, "foreground"]]);
      line([]);
    });
    return rows.length ? rows : [text("No commits.", "muted")];
  }

  /** A worktree in the main view: where it is, what's in it (spaces,
   *  agents, uncommitted changes), then its branch's log. */
  async worktreeContent(w) {
    const occ = this.occupancy().get(w.path) ?? { spaces: [], agents: [] };
    const kv = (k, parts) => ({ kind: "text", parts: [[k.padEnd(10), "dim"], ...parts] });
    const rows = [kv("Worktree", [[this.tilde(w.path), "foreground"], ...(w.main ? [["  (the main checkout)", "dim"]] : [])])];
    rows.push(kv("Branch", w.branch ? [[w.branch, "ansi6"]] : [[`detached at ${String(w.head ?? "").slice(0, 7)}`, "ansi3"]]));
    if (w.prunable) rows.push(kv("Folder", [["gone: X forgets it (git worktree prune)", "ansi1"]]));
    else {
      const st = await this.git.read(["-C", w.path, "status", "--porcelain"]);
      const n = st.code === 0 ? st.stdout.split("\n").filter(Boolean).length : null;
      rows.push(kv("Changes", n == null ? [["unreadable", "ansi1"]] : n ? [[`${n} uncommitted file${n === 1 ? "" : "s"}`, "ansi3"]] : [["none", "muted"]]));
    }
    if (w.locked) rows.push(kv("Locked", [["git won't remove it until it's unlocked (git worktree unlock)", "ansi3"]]));
    rows.push(kv("Spaces", occ.spaces.length ? [[occ.spaces.map((s) => s.name || "unnamed").join(", "), "accent"]] : [["none: space opens one", "muted"]]));
    if (occ.agents.length) rows.push(kv("Agents", [[occ.agents.map((a) => `${a.name ?? "agent"} (${a.status ?? "running"})`).join(", "), "ansi3"]]));
    rows.push(text(""));
    const ref = w.branch ?? w.head;
    const log = ref && !w.prunable ? await this.logRows(ref) : [];
    return { title: `Worktree · ${WT.label(w)}`, rows: [...rows, ...log], rowH: LOG_ROW };
  }

  /** A ctrl-p pane's one diff (show kinds other than review). */
  async showContent() {
    const g = this.git, s = this.show, opts = { context: this.context, ws: this.ws };
    const flat = (files) => {
      if (files.length === 1) return diffRows(files[0]).map((r) => ({ ...r, path: files[0].path }));
      return files.flatMap((f) => [{ kind: "file", text: f.status === "renamed" && f.old ? `${f.old} → ${f.path}` : f.path, sub: f.binary ? "binary" : `+${f.add} -${f.del}` }, ...diffRows(f).map((r) => ({ ...r, path: f.path }))]);
    };
    if (s.kind === "file") {
      const f = (this.data.status?.files ?? []).find((x) => x.path === s.path);
      if (!f) return { title: s.path, path: s.path, rows: [text("No changes in this file now.", "muted")] };
      const [un, st] = await Promise.all([f.unstaged ? g.fileDiff(f, opts) : null, f.staged ? g.fileDiff(f, { cached: true, ...opts }) : null]);
      const rows = [
        ...(un ? [{ kind: "file", text: "unstaged", sub: `+${un.add} -${un.del}` }, ...diffRows(un).map((r) => ({ ...r, path: f.path }))] : []),
        ...(st ? [{ kind: "file", text: "staged", sub: `+${st.add} -${st.del}` }, ...diffRows(st).map((r) => ({ ...r, path: f.path }))] : []),
      ];
      return { title: `Working diff · ${f.path}`, path: f.path, rows: rows.length ? rows : [text("No text changes (mode, rename or binary).", "muted")] };
    }
    if (s.kind === "commit") {
      const c = await g.show(s.hash, { ...opts, path: s.path ?? null });
      if (!c) return { title: short(s.hash), rows: [text("Not a commit.", "muted")] };
      const head = [
        { kind: "text", parts: [[`commit ${c.hash}`, "ansi3"], ...(c.refs ? [[` (${c.refs})`, "ansi5"]] : [])] },
        { kind: "text", parts: [["Author: ", "dim"], [`${c.author} <${c.email}>`, "ansi5"]] },
        { kind: "text", parts: [["Date:   ", "dim"], [new Date(c.date * 1000).toLocaleString(), "muted"]] },
        text(""), ...c.body.split("\n").map((l) => text(`    ${l}`, "foreground")), text(""),
      ];
      return { title: `Patch · ${short(c.hash)}${s.path ? ` · ${s.path}` : ""}`, rows: [...head, ...flat(c.files)] };
    }
    if (s.kind === "stash") {
      const files = (await g.stashShow(s.ref, opts)).filter((f) => !s.path || f.path === s.path);
      return { title: `Stash · ${short(s.ref)}${s.path ? ` · ${s.path}` : ""}`, rows: files.length ? flat(files) : [text("Empty stash entry.", "muted")] };
    }
    if (s.kind === "log") return { title: `Log · ${s.ref}`, rows: await this.logRows(s.ref), rowH: LOG_ROW };
    if (s.kind === "range") {
      const files = await g.between(s.a, s.b, opts);
      return { title: `Diff ${short(s.a)}..${short(s.b)}`, rows: files.length ? flat(files) : [text("No differences.", "muted")] };
    }
    return { title: "", rows: [] };
  }

  async mainContent() {
    if (this.show && this.show.kind !== "review") return this.showContent();
    const g = this.git, ctx = this.ctxOf(this.panel), x = this.item(ctx), opts = { context: this.context, ws: this.ws };
    const flat = (files) => {
      if (files.length === 1) return diffRows(files[0]).map((r) => ({ ...r, path: files[0].path }));
      return files.flatMap((f) => [{ kind: "file", text: f.status === "renamed" && f.old ? `${f.old} → ${f.path}` : f.path, sub: f.binary ? "binary" : `+${f.add} -${f.del}` }, ...diffRows(f).map((r) => ({ ...r, path: f.path }))]);
    };
    const ref = x?.hash ?? (ctx === "branches" || ctx === "tags" || ctx === "remoteBranches" ? x?.name : null);
    if (this.diffBase && ref) {
      const [a, b] = this.diffReverse ? [ref, this.diffBase] : [this.diffBase, ref];
      const files = await g.between(a, b, opts);
      return { title: `Diff ${short(a)}..${short(b)}`, rows: files.length ? flat(files) : [text("No differences.")] };
    }
    if (!x) return { title: "", rows: [] };
    switch (ctx) {
      case "status": {
        const s = this.data.status;
        return { title: "Status", rows: [
          text(`${g.name}`, "foreground"), text(g.root, "dim"), text(""),
          text(`on ${s?.head ?? "a detached HEAD"}${s?.upstream ? ` → ${s.upstream}` : " (no upstream)"}`, "ansi6"),
          ...(s?.upstream ? [text(`↑${s.ahead} ahead · ↓${s.behind} behind`, "ansi4")] : []),
          ...(this.data.state ? [text(`${this.data.state}: m for continue / abort`, "ansi3")] : []),
          text(`${(s?.files ?? []).length} changed file${(s?.files ?? []).length === 1 ? "" : "s"} · ${this.data.stash.length} stash entr${this.data.stash.length === 1 ? "y" : "ies"} · ${this.data.branches.length} branches`, "muted"),
          text(""), text("? lists every key · 1-5 jump to a panel · + widens it · enter on Status: recent repos", "dim"),
        ] };
      }
      case "files": {
        if (x.kind === "dir") {
          const files = await g.between("HEAD", null, { ...opts, path: x.path });
          return { title: `${x.path} · ${x.files.length} file${x.files.length === 1 ? "" : "s"}`, rows: files.length ? flat(files) : [text(`${x.files.length} new file${x.files.length === 1 ? "" : "s"} under ${x.path}`, "muted")] };
        }
        const f = x.file;
        const [un, st] = await Promise.all([
          f.unstaged ? g.fileDiff(f, { ...opts }) : null,
          f.staged ? g.fileDiff(f, { cached: true, ...opts }) : null,
        ]);
        return {
          title: f.unstaged ? "Unstaged changes" : "Staged changes", path: f.path,
          rows: (f.unstaged ? un : st) ? diffRows(f.unstaged ? un : st).map((r) => ({ ...r, path: f.path })) : [text(f.conflict ? "Merge conflict: enter or M for the options." : "No text changes (mode, rename or binary).", "muted")],
          second: f.unstaged && st ? { title: "Staged changes", rows: diffRows(st) } : null,
        };
      }
      case "review": {
        const f = x;
        const rows = f.binary ? [text("Binary file: not shown.", "muted")] : !f.hunks?.length ? [text(f.status === "untracked" ? "Untracked, not diffed (too many new files)." : "No text changes (mode or rename only).", "muted")] : diffRows(f).map((r) => ({ ...r, path: f.path }));
        return { title: `${this.review.scopeName()} · ${f.status === "renamed" && f.old ? `${f.old} → ${f.path}` : f.path}`, path: f.path, rows };
      }
      case "worktrees": return this.worktreeContent(x);
      case "remotes": return { title: x.name, rows: [text(`fetch ${x.url}`, "foreground"), text(`push  ${x.push}`, "muted"), text(""), ...this.data.remoteBranches.filter((r) => r.remote === x.name).slice(0, 40).map((r) => text(`${r.branch}  ${r.subject}`, "muted"))] };
      case "branches": case "remoteBranches": case "tags": return { title: `Log · ${x.name}`, rows: await this.logRows(x.name), rowH: LOG_ROW };
      case "commits": case "subCommits": case "reflog": {
        const c = await g.show(x.hash, opts);
        if (!c) return { title: short(x.hash), rows: [text("Not a commit.", "muted")] };
        const head = [
          { kind: "text", parts: [[`commit ${c.hash}`, "ansi3"], ...(c.refs ? [[` (${c.refs})`, "ansi5"]] : [])] },
          ...(c.parents.length > 1 ? [text(`Merge: ${c.parents.map(short).join(" ")}`, "muted")] : []),
          { kind: "text", parts: [["Author: ", "dim"], [`${c.author} <${c.email}>`, "ansi5"]] },
          { kind: "text", parts: [["Date:   ", "dim"], [new Date(c.date * 1000).toLocaleString(), "muted"]] },
          text(""),
          ...c.body.split("\n").map((l) => text(`    ${l}`, "foreground")),
          text(""),
        ];
        return { title: `Patch · ${short(c.hash)}`, rows: [...head, ...flat(c.files)] };
      }
      case "commitFiles": {
        const s = this.sub();
        const f = x.file ?? x;
        if (x.kind === "dir") return { title: x.path, rows: [text(`${x.files.length} files under ${x.path}`, "muted")] };
        const files = s?.stash ? (await g.stashShow(s.hash, opts)).filter((d) => d.path === f.path) : (await g.show(s.hash, { ...opts, path: f.path }))?.files ?? [];
        return { title: `${short(s.hash)} · ${f.path}`, rows: files.length ? flat(files) : [text("No text changes.", "muted")] };
      }
      case "stash": {
        const files = await g.stashShow(x.ref, opts);
        return { title: `${x.ref} · ${x.subject}`, rows: files.length ? flat(files) : [text("Empty stash entry.", "muted")] };
      }
    }
    return { title: "", rows: [] };
  }

  // ---- keys

  key(e, cx) {
    // cmd-enter submits a popup's form (keyName leaves cmd chords to the app).
    const k = this.popups.open && e.key === "enter" && e.modifiers?.platform ? "cmd-enter" : keyName(e);
    if (!k) return;
    if (this.popups.open) {
      if (this.popups.key(k, e, cx)) { cx.stop_propagation(); cx.notify(); }
      return;
    }
    if (this.filtering) {
      if (k === "escape") { this.back(); cx.stop_propagation(); cx.notify(); }
      else if (k === "enter" || k === "down" || k === "up") { this.filtering = null; this.handle.focus(); this.loadMain(); cx.stop_propagation(); cx.notify(); }
      return;
    }
    const ctx = this.ctx();
    if (this.state !== "ready") {
      if (k === "q" || k === "escape") { this.quit(k === "escape"); cx.stop_propagation(); }
      return;
    }
    const b = lookup(ctx, k);
    if (!b) return;
    if (act(this, b.action, cx) === false) return;
    cx.stop_propagation();
    cx.notify();
  }

  // ---- mouse

  rowPress(ctx, i, e, cx) {
    const p = PANELS.find((x) => this.ctxOf(x) === ctx) ?? this.panel;
    const was = this.panel === p && this.focus === "side" && (this.sel[ctx] ?? 0) === i;
    this.handle.focus();
    if (this.panel !== p || this.focus !== "side") { this.panel = p; this.focus = "side"; this.staging = null; }
    if (e.modifiers?.shift) { if (!this.range) this.range = { ctx, anchor: this.sel[ctx] ?? 0 }; }
    else if (!was) this.range = null;
    this.sel[ctx] = i; this.mainTop = 0;
    this.loadMain();
    if (e.click_count === 2) {
      const b = lookup(ctx, "enter");
      if (b) act(this, b.action, cx);
    }
    cx.notify();
  }

  rowMenu(ctx, i, cx) {
    const p = PANELS.find((x) => this.ctxOf(x) === ctx) ?? this.panel;
    this.panel = p; this.focus = "side"; this.staging = null;
    this.sel[ctx] = i;
    this.loadMain();
    this.contextMenu(ctx);
    cx.notify();
  }

  wheel(ctx, e, rowH, n, cx) {
    cx.stop_propagation();
    const dy = unzoom(e.delta.y);
    this.wheelAcc = (this.wheelAcc ?? 0) + dy / rowH;
    const steps = Math.trunc(this.wheelAcc);
    if (!steps) return;
    this.wheelAcc -= steps;
    const vis = this.vis[ctx] ?? 10;
    this.top[ctx] = Math.max(0, Math.min(Math.max(0, n - vis), (this.top[ctx] ?? 0) - steps));
    cx.notify();
  }

  resize(e, key, from, set, { min = 160, max = 4000, sign = 1, axis = "x" } = {}) {
    this.resizing = { key, axis, at: axis === "x" ? e.position.x : e.position.y, from, set, min, max: Math.max(min, max), sign };
  }

  splitter(t, id, axis, key, from, set, opts) {
    const on = this.resizing?.key === key;
    return div().id(id).relative().flex_none()
      .when(axis === "x", (el) => el.w(6).h_full().cursor_col_resize()).when(axis === "y", (el) => el.h(6).w_full().cursor_row_resize())
      .hover((s) => s.bg(t.ansi0 + "88"))
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.resize(e, key, from, set, { axis, ...opts }); cx.notify(); })
      .when(on, (el) => el.child(div().absolute().when(axis === "x", (l) => l.top(0).bottom(0).left(2).w(2)).when(axis === "y", (l) => l.left(0).right(0).top(2).h(2)).bg(t.accent)));
  }

  // ---- drawing: lists

  /** A list body: only the rows in view are drawn (lazygit scrolls by row). */
  list(t, ctx, rowH, draw, { active }) {
    const rows = this.items(ctx);
    const n = rows.length;
    // The rows that fit, from the list's height: the row height can change
    // without a resize (Commits going wide), so a count kept from the last
    // resize would leave the bottom of the list empty.
    const px = this.listPx?.[ctx];
    const vis = px ? Math.max(1, Math.floor(px / rowH)) : Math.max(1, this.vis[ctx] ?? 12);
    this.vis[ctx] = vis;
    let top = this.top[ctx] ?? 0;
    const sel = Math.min(this.sel[ctx] ?? 0, Math.max(0, n - 1));
    if (this.follow[ctx]) {
      if (sel < top) top = sel;
      if (sel >= top + vis) top = sel - vis + 1;
      this.follow[ctx] = false;
    }
    top = Math.max(0, Math.min(top, Math.max(0, n - vis)));
    this.top[ctx] = top;
    const range = this.range?.ctx === ctx ? [Math.min(this.range.anchor, sel), Math.max(this.range.anchor, sel)] : null;
    const shown = rows.slice(top, top + vis + 1).map((r, k) => {
      const i = top + k, isSel = i === sel, inRange = range && i >= range[0] && i <= range[1];
      return div().id(`${ctx}-row-${i}`).relative().h(rowH).flex_none().w_full()
        .hover((s) => s.bg(t.ansi0 + "55"))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.rowPress(ctx, i, e, cx); })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.rowMenu(ctx, i, cx); })
        .when(isSel || inRange, (el) => el.children(band(t, active && this.focus === "side")))
        .child(draw(r, i, isSel).relative().size_full());
    });
    const bar = n > vis ? div().absolute().right(0).w(2).top(Math.round((top / n) * 100) + "%").h(Math.max(4, Math.round((vis / n) * 100)) + "%").bg(active ? t.accent + "aa" : t.ansi8 + "66") : null;
    return div().id(`${ctx}-list`).relative().size_full().overflow_hidden()
      .on_size_change((size, cx) => {
        const h = unzoom(size.height);
        (this.listPx ??= {});
        if (h !== this.listPx[ctx]) { this.listPx[ctx] = h; this.vis[ctx] = Math.max(1, Math.floor(h / rowH)); cx.notify(); }
      })
      .on_scroll_wheel((e, cx) => this.wheel(ctx, e, rowH, n, cx))
      .child(v_flex().size_full().children(shown).children([n > 0 && top + vis >= n - 1 ? this.listTail(t, ctx, n - 1, rowH) : null].filter(Boolean)))
      .when(Boolean(bar), (el) => el.child(bar))
      .when(!n, (el) => el.child(div().absolute().inset_0().child(empty(t, this.emptyText(ctx), null, { small: true }))));
  }

  /** Below a commit list's last row: its open lanes run on to the bottom
   *  edge (history cut at the limit, or the panel taller than the list), so
   *  no line ends in the air. */
  listTail(t, ctx, last, rowH) {
    if (ctx !== "commits" && ctx !== "subCommits") return null;
    const g = this.graphFor(ctx), row = g?.rows[last];
    if (!row || !row.after.some((c) => c != null)) return null;
    const wide = rowH === WIDE_ROW;
    const h = Math.max(rowH, this.listPx?.[ctx] ?? 600);
    const lanes = graphPass(t, row.after, this.shownWidth(ctx, g), { lane: wide ? WIDE_LANE : LANE, h });
    return h_flex().id(`${ctx}-tail`).flex_1().min_h(0).w_full().items_start().overflow_hidden()
      .when(wide, (el) => el.pl(4).child(lanes))
      .when(!wide, (el) => el.px(6).gap(7).child(div().w(56).flex_none()).child(div().w(18).flex_none()).child(lanes));
  }

  emptyText(ctx) {
    if (this.filters[ctx]) return `Nothing matches "${this.filters[ctx]}"`;
    return {
      files: "Nothing changed: the work tree is clean", review: this.review.state === "loading" ? "Reading changes…" : this.review.state === "error" ? this.review.error : `Nothing changed (${this.review.scopeName()})`,
      branches: "No branches", remotes: "No remotes: n adds one", tags: "No tags", commits: "No commits yet", reflog: "Empty reflog",
      stash: "Nothing stashed", worktrees: "No worktrees", remoteBranches: "No branches on this remote", subCommits: "Reading…", commitFiles: "Reading…",
    }[ctx] ?? "Empty";
  }

  rowLine(t, kids, pad = 8) {
    return h_flex().px(pad).gap(7).items_center().text_size(11).overflow_hidden().children(kids.filter(Boolean).map((k) => k.relative()));
  }

  txt(s, color, { w = null, grow = false } = {}) {
    let el = div().flex_none().text_color(color).child(String(s ?? ""));
    if (w) el = el.w(w);
    if (grow) el = div().flex_1().min_w(0).truncate().text_color(color).child(String(s ?? ""));
    return el;
  }

  drawRow(t, ctx, wide) {
    const T = (s, c, o) => this.txt(s, c, o);
    switch (ctx) {
      case "status": return () => {
        const s = this.data.status;
        return this.rowLine(t, [
          s?.upstream ? h_flex().gap(2).child(T(`↑${s.ahead}`, t.ansi4)).child(T(`↓${s.behind}`, t.ansi5)) : null,
          T(this.git?.name ?? "", t.foreground), T("→", t.dim), T(s?.head ?? "(detached)", t.ansi6),
          this.data.state ? T(this.data.state.toUpperCase(), t.ansi3) : null,
        ]);
      };
      case "files": case "commitFiles": return (r, i, sel) => {
        if (r.kind === "dir") {
          const l = dirLetters(r.files);
          return this.rowLine(t, [div().w(r.depth * 12).flex_none(), T(r.open ? "▾" : "▸", t.dim),
            ctx === "files" ? h_flex().child(T(l.x, letterColor(t, l.x, true))).child(T(l.y, letterColor(t, l.y, false))) : null,
            T(r.name, t.muted, { grow: true }), T(String(r.files.length), t.dim)]);
        }
        const f = r.file;
        if (ctx === "commitFiles") {
          const c = { A: t.ansi2, D: t.ansi1, M: t.ansi3, R: t.ansi4 }[f.status] ?? t.muted;
          return this.rowLine(t, [div().w(r.depth * 12 + (this.tree ? 12 : 0)).flex_none(), T(f.status, c, { w: 10 }), T(f.from ? `${f.from} → ${r.name}` : r.name, sel ? t.foreground : t.muted, { grow: true })]);
        }
        const two = letters(f);
        const color = f.conflict ? t.ansi3 : f.untracked ? t.ansi1 : f.staged && !f.unstaged ? t.ansi2 : sel ? t.foreground : t.muted;
        return this.rowLine(t, [div().w(r.depth * 12 + (this.tree ? 12 : 0)).flex_none(),
          h_flex().w(16).flex_none().child(T(two[0], letterColor(t, two[0], true))).child(T(two[1], letterColor(t, two[1], false))),
          T(f.from ? `${f.from} → ${r.name}` : r.name, color, { grow: true })]);
      };
      case "review": return (f, i, sel) => {
        const done = this.review.marks().has(f.key);
        const [letter, c] = { added: ["A", t.ansi2], modified: ["M", t.ansi3], deleted: ["D", t.ansi1], renamed: ["R", t.ansi4], untracked: ["U", t.ansi5] }[f.status] ?? ["?", t.ansi8];
        const slash = f.path.lastIndexOf("/");
        return this.rowLine(t, [
          div().id(`rv-box-${i}`).relative().size(10).flex_none().border(1).border_color(done ? t.ansi2 : t.ansi8).when(done, (el) => el.child(dither(t.ansi2, 1)))
            .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.review.toggle(f); cx.notify(); }),
          T(letter, c, { w: 8 }),
          h_flex().flex_1().min_w(0).gap(6).child(div().flex_none().truncate().text_color(done ? t.dim : sel ? t.foreground : t.muted).child(f.path.slice(slash + 1)))
            .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(slash > 0 ? f.path.slice(0, slash) : "")),
          T(f.binary ? "bin" : `${f.add + f.del}`, t.dim),
        ]);
      };
      case "worktrees": {
        // * this window's checkout, ◆ picked for d; then the branch, what's
        // in it (agents, open in a space), how old its last commit is, where.
        const occ = this.occupancy();
        return (w, i, sel) => {
          const o = occ.get(w.path) ?? { spaces: [], agents: [] };
          const picked = this.wtPicked.has(w.path);
          const mark = picked ? ["◆", t.ansi5] : w.path === this.git?.root ? ["*", t.ansi6] : [" ", t.dim];
          const busy = o.agents.length ? [`${o.agents.length} agent${o.agents.length === 1 ? "" : "s"}`, o.agents.some((a) => a.status === "blocked") ? t.ansi1 : t.working ?? t.ansi3] : null;
          return this.rowLine(t, [
            T(mark[0], mark[1], { w: 8 }),
            T(w.branch ?? `(detached) ${String(w.head ?? "").slice(0, 7)}`, w.branch ? (sel ? t.foreground : t.ansi6) : t.ansi3),
            w.main ? T("main", t.dim) : null,
            w.prunable ? T("folder gone", t.ansi1) : w.locked ? T("locked", t.ansi3) : null,
            T(this.tilde(w.path), t.dim, { grow: true }),
            busy ? T(busy[0], busy[1]) : o.spaces.length ? T("open", t.accent) : null,
            w.at ? T(age(w.at), t.dim) : null,
          ]);
        };
      }
      case "branches": return (b, i, sel) => this.rowLine(t, [
        T(age(b.date), t.dim, { w: 26 }),
        T(b.head ? `* ${b.name}` : b.name, b.head ? t.ansi6 : sel ? t.foreground : t.muted),
        b.ahead ? T(`↑${b.ahead}`, t.ansi4) : null, b.behind ? T(`↓${b.behind}`, t.ansi5) : null,
        b.gone ? T("(upstream gone)", t.dim) : b.upstream && !b.ahead && !b.behind ? T("✓", t.ansi2) : null,
        wide ? T(b.subject, t.dim, { grow: true }) : null,
      ]);
      case "remotes": return (r, i, sel) => this.rowLine(t, [T(r.name, sel ? t.foreground : t.muted), T(r.url, t.dim, { grow: true })]);
      case "remoteBranches": return (r, i, sel) => this.rowLine(t, [T(age(r.date), t.dim, { w: 26 }), T(r.name, sel ? t.foreground : t.muted), wide ? T(r.subject, t.dim, { grow: true }) : null]);
      case "tags": return (g, i, sel) => this.rowLine(t, [T("◆", t.ansi3), T(g.name, sel ? t.foreground : t.muted), T(g.subject, t.dim, { grow: true })]);
      case "reflog": return (r, i, sel) => this.rowLine(t, [T(r.short, t.ansi5, { w: 56 }), T(age(r.date), t.dim, { w: 26 }), T(r.subject, sel ? t.foreground : t.muted, { grow: true })]);
      case "stash": return (s, i, sel) => this.rowLine(t, [T(String(s.index), t.dim, { w: 14 }), T(s.subject, sel ? t.foreground : t.muted, { grow: true })]);
      case "commits": case "subCommits": return wide ? this.wideCommit(t, ctx) : this.commitRow(t, ctx);
    }
    return () => div();
  }

  /** The graph column's width in lanes for the rows in view (list() sets
   *  the top before it draws them). */
  shownWidth(ctx, g) {
    const top = this.top[ctx] ?? 0;
    return widthOf(g.rows, top, top + Math.max(1, this.vis[ctx] ?? 12) + 1);
  }

  graphFor(ctx) {
    if (this.noGraph || this.filters[ctx]) return null;
    return ctx === "subCommits" ? this.sub()?.graph ?? null : this.graph;
  }

  hashColor(t, c) {
    if (this.data.unpushed.has(c.hash)) return t.ansi1;
    if (this.data.notMain.size && !this.data.notMain.has(c.hash)) return t.ansi2;
    return t.ansi3;
  }

  authorColor(t, name) {
    const cs = [t.ansi5, t.ansi6, t.ansi4, t.ansi3, t.ansi2, t.ansi13 ?? t.ansi5, t.ansi10 ?? t.ansi2, t.ansi12 ?? t.ansi4];
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return cs[h % cs.length];
  }

  refChips(t, c, laneColor) {
    return (c.refs ?? []).filter((r) => r.kind !== "detached").map((r) => {
      const color = r.kind === "tag" ? t.ansi3 : r.kind === "ref" ? t.ansi5 : laneColor ?? t.ansi6;
      return div().flex_none().text_color(color).child(r.kind === "tag" ? `◆ ${r.name}` : r.kind === "head" ? `${r.name} ✱` : r.name);
    });
  }

  commitRow(t, ctx) {
    const g = this.graphFor(ctx);
    return (c, i, sel) => {
      const row = g?.rows[i];
      const copied = this.copied.some((x) => x.hash === c.hash);
      return this.rowLine(t, [
        T7(t, c.short, this.hashColor(t, c)),
        div().w(18).flex_none().text_color(this.authorColor(t, c.author)).child(initials(c.author)),
        row ? graphCell(t, row, this.shownWidth(ctx, g), { lane: LANE, h: ROW, head: this.isHead(c) }) : null,
        copied ? div().flex_none().px(3).bg(t.ansi5 + "44").text_color(t.ansi5).child("copied") : null,
        ...this.refChips(t, c),
        div().flex_1().min_w(0).truncate().text_color(sel ? t.foreground : t.muted).child(c.subject),
      ], 6);
    };
  }

  /** Commits in half / full mode: B's constellation rows. */
  wideCommit(t, ctx) {
    const g = this.graphFor(ctx);
    const colors = laneColors(t);
    const list = this.items(ctx);
    const firstOnMain = this.data.notMain.size ? list.findIndex((c) => !this.data.notMain.has(c.hash)) : -1;
    return (c, i, sel) => {
      const row = g?.rows[i];
      const lane = row ? colors[row.color] : t.accent;
      const flags = (c.refs ?? []).filter((r) => r.kind !== "detached").map((r) => {
        const color = r.kind === "tag" ? t.ansi3 : lane;
        return r.kind === "ref"
          ? div().flex_none().h(15).px(5).flex().items_center().border(1).border_color(t.ansi5).text_size(10).text_color(t.ansi5).child(r.name)
          : div().flex_none().h(15).px(5).flex().items_center().bg(color).text_size(10).text_color(t.background).child(r.kind === "tag" ? `◆ ${r.name}` : r.name);
      });
      const copied = this.copied.some((x) => x.hash === c.hash);
      const ahead = this.data.unpushed.has(c.hash);
      return h_flex().pl(4).pr(8).gap(8).items_center().overflow_hidden()
        .child(row ? graphCell(t, row, this.shownWidth(ctx, g), { lane: WIDE_LANE, h: WIDE_ROW, head: this.isHead(c), big: true }).relative() : div())
        .child(v_flex().relative().flex_1().min_w(0).gap(2).justify_center()
          .child(h_flex().gap(7).items_center().text_size(11).children(flags)
            .when(copied, (el) => el.child(div().flex_none().px(3).bg(t.ansi5 + "44").text_color(t.ansi5).child("copied")))
            .child(div().flex_1().min_w(0).truncate().text_color(sel || this.data.notMain.has(c.hash) ? t.foreground : t.muted).child(c.subject)))
          .child(h_flex().gap(8).text_size(10).text_color(t.dim)
            .child(div().flex_none().text_color(ahead ? t.ansi1 : this.hashColor(t, c)).child(`${c.short}${ahead ? " ↑" : ""}`))
            .child(div().flex_none().text_color(this.authorColor(t, c.author)).child(c.author))
            .child(div().flex_none().child(age(c.date)))))
        .when(i === firstOnMain && firstOnMain > 0, (el) => el.child(h_flex().absolute().left(g ? this.shownWidth(ctx, g) * WIDE_LANE + 8 : 8).right(8).top(0).h(1).child(dither(t.ansi8, 1)))
          .child(div().absolute().right(10).top(-6).px(4).bg(t.background).text_size(10).text_color(t.ansi4).child(`↑ ${firstOnMain} not on ${this.data.main}`)));
    };
  }

  // ---- drawing: panels

  tabsTitle(t, p, active, num) {
    const parts = [div().text_color(active ? t.accent : t.dim).child(`[${num}]`)];
    const s = this.sub(p);
    if (s) {
      parts.push(div().text_color(t.foreground).child({ subCommits: "Commits", remoteBranches: "Remote branches", commitFiles: "Files" }[s.kind] ?? s.kind));
      parts.push(div().text_color(t.dim).child(`· ${s.title}`));
      return parts;
    }
    const tabs = TABS[p];
    if (!tabs) parts.push(div().text_color(active ? t.foreground : t.muted).child(p === "status" ? "Status" : "Stash"));
    else tabs.forEach(([id, label], k) => {
      if (k) parts.push(div().text_color(t.ansi0).child("-"));
      const on = this.tabOf[p] === id;
      // The open tab of the focused panel is lit in the accent, lazygit's
      // way: an underline would sit below the edge row, on the first row.
      parts.push(div().id(`tab-${p}-${id}`).text_color(on ? (active ? t.accent : t.muted) : t.dim)
        .hover((st) => st.text_color(t.foreground))
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.panel = p; this.focus = "side"; this.setTab(id); cx.notify(); })
        .child(label));
    });
    return parts;
  }

  /** The ⤢ that cycles a panel's screen mode (the mouse's + and _). */
  modeChip(t, p) {
    const big = this.panel === p && this.mode !== "normal";
    return div().id(`mode-${p}`).px(2).text_color(big ? t.accent : t.dim).hover((s) => s.text_color(t.foreground))
      .tooltip(big ? `${this.mode} screen: + / _ cycle, click to shrink` : "Widen (+): half, then full screen")
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); if (this.panel !== p) { this.panel = p; this.focus = "side"; this.mode = "normal"; } this.screen(1); this.loadMain(); cx.notify(); })
      .child(big ? "⤡" : "⤢");
  }

  sidePanel(t, p, { wide = false, compact = false } = {}) {
    const active = this.panel === p && this.focus === "side" && !this.popups.open;
    const num = PANELS.indexOf(p) + 1;
    const ctx = this.ctxOf(p);
    const n = this.items(ctx).length;
    const isCommits = ctx === "commits" || ctx === "subCommits";
    const rowH = wide && isCommits ? WIDE_ROW : ROW;
    const filtering = this.filtering?.ctx === ctx;
    let foot = n ? `${Math.min((this.sel[ctx] ?? 0) + 1, n)} of ${n}${ctx === "commits" && n >= LOG_LIMIT ? "+" : ""}` : null;
    if (ctx === "review" && this.review.files.length) foot = `${this.review.scopeName()} · ${this.review.summary()}`;
    if (this.filters[ctx] && !filtering) foot = `/${this.filters[ctx]} · ${foot ?? "0"}`;
    const body = v_flex().size_full()
      .child(div().flex_1().min_h(0).child(this.list(t, ctx, rowH, this.drawRow(t, ctx, wide), { active })))
      .when(filtering, (el) => el.child(h_flex().h(22).mx(4).mb(2).px(6).gap(6).items_center().border(1).border_color(t.accent).text_size(11)
        .child(div().text_color(t.accent).child("/")).child(Input.new(this.filtering.input).flex_1().text_size(11).text_color(t.foreground))));
    return panel(t, `panel-${p}`, this.tabsTitle(t, p, active, num), active, body, {
      foot: compact || p === "status" ? null : foot,
      right: p === "status" ? null : this.modeChip(t, p),
      onTitle: (e, cx) => { this.handle.focus(); this.panel = p; this.focus = "side"; this.staging = null; if (e.click_count === 2) this.screen(1); this.loadMain(); cx.notify(); },
    }).on_mouse_down("left", (_e, cx) => { this.handle.focus(); if (this.panel !== p || this.focus !== "side") { this.panel = p; this.focus = "side"; this.staging = null; this.loadMain(); } cx.notify(); });
  }

  sideColumn(t, panels, { compact = false } = {}) {
    return v_flex().size_full().gap(12).pt(7).children(panels.map((p) => {
      const el = this.sidePanel(t, p, { compact });
      const focusedHere = this.panel === p;
      if (p === "status") return el.h(30).flex_none();
      if (p === "stash" && !focusedHere) return el.h(this.data.stash.length ? Math.min(3, this.data.stash.length) * ROW + 20 : 30).flex_none();
      return el.flex_grow(focusedHere && !compact ? 2.2 : 1).flex_basis(0).min_h(30);
    }));
  }

  mainPanel(t) {
    const active = this.focus === "main" && !this.popups.open;
    const code = settings().font_family || "JetBrains Mono";
    const s = this.staging;
    const m = this.main;
    const narrow = this.size.width < NARROW;
    if (s) {
      const keys = this.pickedKeys();
      const mine = this.mainList(t, "main-diff", s.rows, (r, i) => diffLine(t, r, { code, compact: narrow, pick: keys.has(`${r.hunk}:${r.line}`), cursor: i === s.cur, active, path: s.file.path }), { follow: s.cur, key: "staging" });
      const title = (on, label) => [div().text_color(on ? t.foreground : t.dim).child(label)];
      const right = div().text_color(t.dim).child(`${s.file.path}${s.hunkMode ? " · hunk" : s.anchor != null ? " · range" : ""}`);
      const a = panel(t, "main-a", title(true, s.side === "staged" ? "Staged changes" : "Unstaged changes"), active, mine, { right, foot: active ? "tab: other side · a: hunk mode" : null }).flex_grow(1.4).flex_basis(0);
      if (!s.other) return v_flex().size_full().gap(12).pt(7).child(a);
      const b = panel(t, "main-b", title(false, s.side === "staged" ? "Unstaged changes" : "Staged changes"), false,
        this.mainList(t, "main-other", s.other, (r) => diffLine(t, r, { code, compact: narrow, active: false, path: s.file.path }), { key: "other" }),
        { onTitle: (_e, cx) => { this.switchSide(); cx.notify(); } }).flex_grow(0.8).flex_basis(0);
      return v_flex().size_full().gap(12).pt(7).child(s.side === "staged" ? b : a).child(s.side === "staged" ? a : b);
    }
    const rows = m?.rows ?? [];
    const body = !m ? empty(t, this.state === "ready" ? "Reading…" : "", null, { small: true })
      : !rows.length ? empty(t, "Nothing to show", null, { small: true })
      : this.mainList(t, "main-diff", rows, (r) => diffLine(t, r, { code, compact: narrow, path: r.path ?? m.path, active, h: m.rowH ?? ROW }), { key: "main", rowH: m.rowH ?? ROW });
    // ⧉: what this view shows, as a pane (shift: a new tab), like a pane header's split.
    const asPane = !this.show && m?.rows?.length ? div().id("main-as-pane").px(3).flex_none().text_color(t.dim).hover((s) => s.text_color(t.accent).bg(t.ansi0 + "66"))
      .tooltip("Open as a pane beside (ctrl-p) · shift: in a new tab (ctrl-shift-p)")
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.openPane(Boolean(e.modifiers?.shift)); cx.notify(); })
      .child(svg("mods/workspace-chrome/panel-right.svg").size(11).text_color(t.dim)) : null;
    const one = panel(t, "main-a", [div().text_color(active ? t.foreground : t.muted).child(m?.title ?? "")], active, body, {
      right: this.diffBase || asPane ? h_flex().gap(8).items_center()
        .when(Boolean(this.diffBase), (el) => el.child(div().text_color(t.ansi3).child(`diff mode: ${short(this.diffBase)} (W)`)))
        .when(Boolean(asPane), (el) => el.child(asPane)) : null,
      onTitle: (_e, cx) => { this.focusMain(); cx.notify(); },
    }).flex_grow(1.4).flex_basis(0);
    const parts = [one];
    if (m?.second) parts.push(panel(t, "main-b", [div().text_color(t.dim).child(m.second.title)], false,
      this.mainList(t, "main-second", m.second.rows, (r) => diffLine(t, r, { code, compact: narrow, active: false, path: m.path }), { key: "second" })).flex_grow(0.8).flex_basis(0));
    return v_flex().size_full().gap(12).pt(7).children(parts);
  }

  /** A main-view list: windowed like the side lists; the wheel scrolls it. */
  mainList(t, id, rows, draw, { follow = null, key = "main", rowH = ROW } = {}) {
    // As list(): the rows that fit come from the height, at this list's row
    // height (a diff's and the branch log's differ).
    const px = this.mainPx?.[key];
    const vis = px ? Math.max(1, Math.floor(px / rowH)) : 30;
    let top = key === "staging" ? (this.staging.top ?? 0) : key === "main" ? this.mainTop : (this.otherTop?.[key] ?? 0);
    if (follow != null) {
      if (follow < top + 1) top = Math.max(0, follow - 2);
      if (follow >= top + vis - 1) top = follow - vis + 3;
    }
    top = Math.max(0, Math.min(top, Math.max(0, rows.length - vis)));
    if (key === "staging") this.staging.top = top; else if (key === "main") this.mainTop = top; else (this.otherTop ??= {})[key] = top;
    if (key === "main" || key === "staging") this.mainVis = vis;
    return div().id(id).relative().size_full().overflow_hidden()
      .on_size_change((size, cx) => {
        const h = unzoom(size.height);
        (this.mainPx ??= {});
        if (h !== this.mainPx[key]) { this.mainPx[key] = h; cx.notify(); }
      })
      .on_scroll_wheel((e, cx) => {
        cx.stop_propagation();
        this.mainWheel = (this.mainWheel ?? 0) + unzoom(e.delta.y) / rowH;
        const steps = Math.trunc(this.mainWheel);
        if (!steps) return;
        this.mainWheel -= steps;
        const nt = Math.max(0, Math.min(Math.max(0, rows.length - vis), top - steps));
        if (key === "staging") this.staging.top = nt; else if (key === "main") this.mainTop = nt; else this.otherTop[key] = nt;
        cx.notify();
      })
      .on_mouse_down("left", (e, cx) => {
        this.handle.focus();
        if (key === "staging" && this.staging) {
          // A click picks the line under the pointer; shift extends a range.
          const y = unzoom(e.local_position?.y ?? 0);
          const i = top + Math.floor(y / rowH);
          if (isChange(this.staging.rows[i])) {
            if (e.modifiers?.shift) { if (this.staging.anchor == null) this.staging.anchor = this.staging.cur; } else this.staging.anchor = null;
            this.staging.cur = i;
          }
          if (e.click_count === 2) act(this, "stage-pick", cx);
        }
        if (this.focus !== "main" && (key === "main" || key === "staging") && rows.length) this.focusMain();
        cx.notify();
      })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); if (this.staging || this.focus === "main") this.contextMenu(this.staging ? "staging" : "main"); cx.notify(); })
      .child(v_flex().size_full().children(rows.slice(top, top + vis + 1).map((r, k) => draw(r, top + k).id(`${id}-${top + k}`).flex_none()))
        .children([top + vis >= rows.length - 1 ? logTail(t, rows[rows.length - 1], px ?? 600) : null].filter(Boolean)))
      .when(rows.length > vis, (el) => el.child(div().absolute().right(0).w(2).top(Math.round((top / rows.length) * 100) + "%").h(Math.max(3, Math.round((vis / rows.length) * 100)) + "%").bg(t.ansi8 + "66")));
  }

  logPanel(t) {
    const shown = this.logs.slice(-40);
    const lines = shown.flatMap((e, i) => [
      h_flex().id(`log-t-${i}`).gap(6).text_size(11).child(div().text_color(e.ok === false ? t.ansi1 : t.foreground).child(e.title)).when(e.ok === null, (el) => el.child(div().text_color(t.working).frames(["░", "▒", "▓", "█", "▓", "▒"], 120))),
      div().id(`log-c-${i}`).pl(12).text_size(11).truncate().text_color(e.ok === false ? t.ansi1 + "cc" : t.ansi6).child(e.cmd),
    ]);
    const vis = Math.max(1, Math.floor((this.logH - 14) / 15));
    return panel(t, "panel-log", [div().text_color(t.muted).child("Command log")], false,
      v_flex().size_full().px(10).justify_end().overflow_hidden().children(lines.slice(-vis))
        .when(!lines.length, (el) => el.child(div().text_size(11).text_color(t.dim).child("What git runs shows here (@ for options)."))),
      { right: div().text_color(t.dim).child("@") }).size_full();
  }

  mainColumn(t) {
    return v_flex().flex_1().min_w(0).h_full()
      .child(div().flex_1().min_h(0).child(this.mainPanel(t)))
      .when(this.showLog, (el) => el
        .child(this.splitter(t, "split-log", "y", "log", this.logH, (v) => { this.logH = v; }, { min: 50, max: Math.max(60, this.size.height - 200), sign: -1 }))
        .child(div().h(this.logH).flex_none().pt(6).child(this.logPanel(t))));
  }

  /** A ctrl-p pane: the one diff, or the review list beside its diff. */
  showBody(t) {
    if (this.show.kind !== "review") return div().size_full().px(6).pb(4).child(this.mainPanel(t));
    if (this.size.width < NARROW) return div().size_full().px(6).pb(4).child(this.focus === "main" ? this.mainPanel(t) : this.sidePanel(t, "files").size_full().mt(7));
    const sideW = this.sideW ?? Math.round(Math.max(220, Math.min(360, this.size.width * 0.3)));
    return h_flex().size_full().px(6).pb(4)
      .child(div().w(sideW).flex_none().h_full().pt(7).child(this.sidePanel(t, "files").size_full()))
      .child(this.splitter(t, "split-side", "x", "side", sideW, (v) => { this.sideW = v; }, { min: 160, max: this.size.width * 0.7 }))
      .child(div().flex_1().min_w(0).h_full().child(this.mainPanel(t)));
  }

  body(t) {
    if (this.show) return this.showBody(t);
    const w = this.size.width;
    const narrow = w < NARROW;
    if (narrow) {
      // One thing at a time: the side panels, or the main view (enter / esc).
      if (this.focus === "main") return div().size_full().px(6).pb(4).child(this.mainPanel(t));
      return div().size_full().px(6).pb(4).child(this.sideColumn(t, PANELS));
    }
    if (this.mode === "full") {
      return div().size_full().px(6).pb(4).pt(7).child(this.focus === "main" ? this.mainPanel(t) : this.sidePanel(t, this.panel, { wide: true }).size_full());
    }
    if (this.mode === "half") {
      const railW = this.railW ?? Math.round(Math.max(230, Math.min(300, w * 0.22)));
      const midW = this.midW ?? Math.round(Math.max(360, Math.min(620, w * 0.38)));
      const rail = PANELS.filter((p) => p !== this.panel);
      return h_flex().size_full().px(6).pb(4)
        .child(div().w(railW).flex_none().h_full().child(this.sideColumn(t, rail, { compact: true })))
        .child(this.splitter(t, "split-rail", "x", "rail", railW, (v) => { this.railW = v; }, { min: 180, max: w * 0.4 }))
        .child(div().w(midW).flex_none().h_full().pt(7).child(this.sidePanel(t, this.panel, { wide: true }).size_full()))
        .child(this.splitter(t, "split-mid", "x", "mid", midW, (v) => { this.midW = v; }, { min: 280, max: w * 0.7 }))
        .child(this.mainColumn(t));
    }
    const sideW = this.sideW ?? Math.round(Math.max(280, Math.min(520, w * 0.34)));
    return h_flex().size_full().px(6).pb(4)
      .child(div().w(sideW).flex_none().h_full().child(this.sideColumn(t, PANELS)))
      .child(this.splitter(t, "split-side", "x", "side", sideW, (v) => { this.sideW = v; }, { min: 200, max: w * 0.7 }))
      .child(this.mainColumn(t));
  }

  header(t) {
    const s = this.data.status;
    const where = this.git ? this.git.root.replace(/^\/(Users|home)\/[^/]+/, "~") : this.folder ?? "";
    const state = this.data.state;
    return h_flex().id("git-head").relative().h(34).flex_none().pl(12).pr(6).gap(10).items_center().text_size(11)
      .child(div().absolute().inset_0().opacity(0.5).child(dither(t.ansi0, 2)))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi8, 1)))
      .when(Boolean(this.busyText), (el) => el.child(svg(`${ART}/wings.svg`).absolute().top(4).size(10).text_color(t.working)
        .loop("left", { from: 140, to: Math.max(300, this.size.width - 260), period: 9000 })
        .loop("opacity", { from: 0.3, to: 1, period: 800 })))
      .child(h_flex().relative().flex_none().gap(8).items_center()
        .child(svg(`${ART}/moon-6.svg`).size(16).text_color(t.foreground))
        .child(div().text_color(t.foreground).child("GIT")))
      .child(div().relative().flex_none().max_w(360).truncate().text_color(t.muted).child(this.on ? `${this.on}:${where}` : where))
      .when(Boolean(s), (el) => el
        .child(div().relative().flex_none().text_color(t.ansi6).child(s.head ?? `(detached ${short(s.oid ?? "")})`))
        .when(s.ahead > 0, (e2) => e2.child(div().relative().flex_none().text_color(t.ansi4).child(`↑${s.ahead}`)))
        .when(s.behind > 0, (e2) => e2.child(div().relative().flex_none().text_color(t.ansi5).child(`↓${s.behind}`))))
      .when(Boolean(state), (el) => el.child(h_flex().relative().flex_none().px(5).h(16).items_center().bg(t.ansi3).text_color(t.background).child(`${state.toUpperCase()} · m`)))
      .when(Boolean(this.backTo), (el) => el.child(chip(t, "git-back", "‹ GitHub", false, () => this.goBack(), t.dim)))
      .child(div().flex_1())
      .when(Boolean(this.busyText), (el) => el.child(div().relative().text_color(t.working).child(this.busyText)))
      .child(keysHint(t, "git-keys", this.popups.top?.kind === "keys", () => (this.popups.top?.kind === "keys" ? this.popups.close() : this.openKeys())).mx(4))
      .child(chip(t, "git-refresh", "↻", false, () => this.reload(true)))
      .when(Boolean(this.overlay), (el) => el.child(chip(t, "git-close", "✕", false, () => this.quit())));
  }

  bar(t) {
    const ctx = this.ctx();
    // The context's keys on the left; the global ones (push, pull) at the
    // right end, and the help key (?) last of all.
    const all = this.show && ctx === "main" ? [["q", "close"], ["j/k", "scroll"], ["J/K", "page"], ["n/N", "file"], ["{ }", "context"], ["?", "keys", null, true]]
      : (ctx === "filter" ? [{ key: "enter", label: "keep" }, { key: "escape", label: "clear" }] : barKeys(ctx))
        .map((b) => [keyLabel(b.key), shortLabel(b.label), null, b.context === "global"]);
    const help = all.find(([k]) => k === "?") ?? null;
    const list = all.filter((x) => x !== help && !x[3]).map(([k, w]) => [k, w]);
    const ends = all.filter((x) => x !== help && x[3]).map(([k, w]) => [k, w]);
    const note = this.noteText;
    const right = note ? div().text_color(note.tone === "failed" ? t.blocked : t.done).truncate().max_w(420).child(note.text)
      : this.copied.length ? div().text_color(t.ansi5).child(`${this.copied.length} copied · V paste`)
      : div().text_color(t.dim).child(this.show ? "q closes this pane" : "1-5 panels · + widen");
    return hints(t, [[null, null, (CONTEXT_NAMES[ctx] ?? ctx).toUpperCase()], ...list], right, (key, cx) => {
      if (this.show && ctx === "main" && key === "?") return this.openKeys();
      const b = lookup(ctx, { esc: "escape", pgup: "pageup", pgdn: "pagedown" }[key] ?? key);
      if (b) act(this, b.action, cx);
    }, { ends, help: help ? [help[0], help[1]] : null });
  }

  render() {
    const t = theme();
    let body;
    if (this.state === "loading") body = empty(t, "Reading the repo…", this.folder ?? "", { moon: 3 });
    else if (this.state === "norepo") body = empty(t, "Not a git repository", `${this.folder ?? "This space has no folder"}: the git window shows the repo of the shown space's folder.`, { moon: 0 });
    else body = this.body(t);
    const endResize = (cx) => { if (this.resizing) { this.resizing = null; this.saveState(); cx.notify(); } };
    return v_flex().id("nocturne-git").relative().size_full().bg(t.background)
      .when(Boolean(this.overlay), (el) => el.border(1).border_color(t.ansi8))
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .map((el) => tabActions(el, (e, cx) => this.key(e, cx)))
      .on_size_change((drawn, cx) => {
        const size = unzoomSize(drawn);
        if (Math.abs(size.width - this.size.width) > 1 || Math.abs(size.height - this.size.height) > 1) { this.size = size; cx.notify(); }
      })
      .when(Boolean(this.resizing), (el) => el.when(this.resizing.axis === "x", (e2) => e2.cursor_col_resize()).when(this.resizing.axis === "y", (e2) => e2.cursor_row_resize()))
      .on_mouse_move((e, cx) => {
        if (e.local_position) this.mouse = { x: unzoom(e.local_position.x), y: unzoom(e.local_position.y) };
        const r = this.resizing;
        if (!r) return;
        const moved = unzoom((r.axis === "x" ? e.position.x : e.position.y) - r.at) * r.sign;
        r.set(Math.round(Math.min(r.max, Math.max(r.min, r.from + moved))));
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => endResize(cx))
      .on_hover((h, cx) => { if (!h) endResize(cx); })
      .child(this.header(t))
      .child(div().id("git-body").relative().flex_1().min_h(0).pt(4)
        .on_mouse_down("left", (_e, cx) => { this.handle.focus(); cx.stop_propagation(); })
        .child(body))
      .child(this.bar(t))
      .when(this.popups.open, (el) => el.child(this.popups.render(t, this.size)));
  }
}

/** Contexts whose right-click menu offers ctrl-p (the main view shows a diff for them). */
const PANE_CONTEXTS = new Set(["files", "review", "commits", "subCommits", "reflog", "commitFiles", "stash", "staging", "main"]);
/** A ctrl-p tab's name. */
const paneName = (s) => (s.kind === "file" ? s.path.split("/").pop() : s.kind === "review" ? (s.pr ? `#${s.pr}` : "review") : s.kind === "range" ? "diff" : s.kind === "log" ? s.ref : (s.hash ?? s.ref ?? "").slice(0, 7));
const T7 = (t, s, c) => div().w(56).flex_none().text_color(c).child(s);
const short = (r) => (/^[0-9a-f]{40}$/.test(r ?? "") ? r.slice(0, 7) : r);
const text = (s, color = "foreground") => ({ kind: "text", parts: [[s, color]] });
/** A bar label: the first words before "/" or "…". */
const shortLabel = (s) => s.replace(/ \(.*\)$/, "").replace(/…$/, "").split(" / ")[0].split(",")[0].split(/ (?:into|the|with|from|to|as|on|of|this|last|all) /)[0].toLowerCase();
