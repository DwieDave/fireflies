// The worktree manager pane ({ role: "worktrees" }, from the "+ new" menu's
// "Worktrees"): every checkout of the shown space's repo, with what's running
// in each, and create / select / rename / delete.
//
//   click a row     go to its space, or open a space there
//   rename          renames the branch (the folder stays where it is)
//   delete          closes the spaces in it, then `git worktree remove`;
//                   asks again if it has uncommitted changes, and can take
//                   the branch with it
//   + new           a branch name; checks out to ~/.herdr/worktrees/<repo>/<branch>
//                   (where Herdr's own worktree dialog puts them) and opens it
//
// Keys, lazygit's way (click the pane to give it the keyboard; ? lists them):
//   j k ↓ ↑         move          g < home / G > end   top / bottom
//   , .  pgup pgdn  a page        enter                go to it (opens a space)
//   space           select this one, then move down
//   n               new           R                    rename its branch
//   d               delete it, or the selected ones
//   v               select a range from here (move to grow it; v again: done)
//   a               select all / none     m  merged     u  unused
//   o               open the selected (or this one) without leaving
//   /               filter by branch or folder (enter keeps it, esc clears)
//   esc             back out: a step, then the filter, then the selection
// In a delete panel: enter or y deletes, esc or n keeps, b toggles taking
// the branch too, s toggles removing submodules first.
//
// Colors come from theme() only, so any Herdr theme restyles it.

import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { spaces, panes, agents, run, exec, home, theme, notify } from "herdr";
import { dither, pip, eyebrow, WORD, RANK, spaceFolder } from "./kit.js";
import { chip, field, confirm, check, working } from "./inline.js";

const POLL = 4000;
const ROW = 24;
// Fixed chip widths on the cursor row, so a press can be placed against them.
const CHIP = { rename: 56, delete: 50 };
const PAGE = 10;
const STALE = 10000;
const slug = (branch) => branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
const inside = (p, dir) => p === dir || p.startsWith(dir + "/");
const tildeOf = (p) => { const h = home(); return p === h ? "~" : p.startsWith(h + "/") ? "~" + p.slice(h.length) : p; };

async function git(cwd, args, on) {
  const r = await exec("git", args, { cwd, on });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr || r.stdout || "").trim() };
}

/**
 * What removing a worktree would take: { dirty: uncommitted files, subs: submodules git counts }.
 * git refuses a worktree whose own git dir holds submodule repositories
 * (<gitdir>/modules), even when `submodule status` calls them uninitialized
 * ("-"): a checkout made by another tool (Claude Code's worktrees) leaves
 * them like that. So those count too.
 */
async function inspect(w, on) {
  const [st, sub, gd] = await Promise.all([
    git(w.path, ["--no-optional-locks", "status", "--porcelain"], on),
    git(w.path, ["submodule", "status"], on),
    git(w.path, ["rev-parse", "--absolute-git-dir"], on),
  ]);
  const lines = sub.ok ? sub.out.split("\n").filter((l) => l.trim()) : [];
  const checkedOut = lines.filter((l) => !l.startsWith("-")).length;
  const kept = gd.ok && /\/worktrees\/[^/]+$/.test(gd.out)
    && (await exec("test", ["-d", `${gd.out}/modules`], { on }).catch(() => ({ code: 1 }))).code === 0;
  return {
    dirty: st.ok ? st.out.split("\n").filter(Boolean).length : 0,
    subs: kept ? Math.max(checkedOut, lines.length, 1) : checkedOut,
  };
}

/** The deepest checkout holding a folder (worktrees can live inside the main one). */
function owner(list, folder) {
  if (!folder) return null;
  return list.filter((w) => inside(folder, w.path)).sort((a, b) => b.path.length - a.path.length)[0] ?? null;
}

export default class Worktrees {
  init(cx) {
    this.list = [];
    this.repo = null;
    this.mode = null; // null | { kind: "new" } | { kind: "rename", w } | { kind: "delete", w, ... } | { kind: "bulk", items, ... }
    this.sel = new Set(); // selected worktree paths, for bulk actions
    this.error = "";
    this.input = InputState.new({ placeholder: "branch name" });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    // The keyboard: a cursor on a row (by path, so a re-sort keeps it), the
    // list's scroll position to keep it in view, a filter, and a range select.
    this.handle = cx.focus_handle();
    this.scroll = VirtualListScrollHandle.new();
    this.cursor = null;
    this.shown = []; // the rows as last drawn, in order
    this.filter = "";
    this.filtering = false;
    this.filterInput = InputState.new({ placeholder: "filter" });
    this.filterInput.on("change", (_e, cx) => { this.filter = this.filterInput.value().trim(); cx.notify(); });
    this.filterInput.on("submit", (_e, cx) => { this.filtering = false; this.handle.focus(); cx.notify(); });
    this.range = null; // { anchor: path } while v is selecting
    this.help = false;
    this.refresh(cx);
    cx.timer.every(POLL, (cx) => this.refresh(cx));
    // A space switch shows another repo within a second: a cheap check of
    // where the shown space is, reading git only when that changed. (Reads
    // start from a timer's or init's cx, never render's.)
    this.at = JSON.stringify(this.where());
    cx.timer.every(1000, (cx) => {
      const at = JSON.stringify(this.where());
      if (at !== this.at) { this.at = at; this.started = 0; this.refresh(cx); }
    });
  }

  // ---- data

  where() {
    const s = spaces().find((x) => x.active);
    return s ? { folder: spaceFolder(s, panes()), on: s.machine ?? null } : null;
  }

  // One read at a time, but never stuck behind one: a read that hasn't
  // answered in STALE ms (one started across a hot reload can hang) is given
  // up on, and a newer one's answer always wins over an older one's.
  refresh(cx) {
    const now = Date.now();
    if (this.started && now - this.started < STALE) return;
    const at = this.where();
    if (!at?.folder) { if (this.repo) { this.repo = null; this.list = []; cx.notify(); } return; }
    const gen = (this.gen = (this.gen ?? 0) + 1);
    this.started = now;
    cx.spawn(async (cx) => {
      try {
        const common = await git(at.folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"], at.on);
        if (gen !== this.gen) return;
        if (!common.ok) { if (this.repo) { this.repo = null; this.list = []; cx.notify(); } return; }
        const main = common.out.replace(/\/\.git$/, "");
        const list = await git(main, ["worktree", "list", "--porcelain"], at.on);
        if (gen !== this.gen) return;
        const out = [];
        for (const block of list.out.split(/\n\n+/)) {
          const lines = block.split("\n");
          const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
          if (!path || lines.includes("bare")) continue;
          const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
          out.push({ path, branch, main: out.length === 0, prunable: lines.some((l) => l.startsWith("prunable")) });
        }
        const moved = this.repo?.main !== main;
        // Another repo: what was said or asked about the last one goes.
        if (moved && this.repo && !this.mode?.busy) { this.error = ""; this.mode = null; this.sel = new Set(); }
        const changed = moved || JSON.stringify(out) !== JSON.stringify(this.list);
        this.repo = { main, name: main.split("/").pop(), on: at.on };
        this.list = out;
        if (changed) cx.notify();
      } catch (e) {
        if (gen === this.gen) { this.error = String(e?.message ?? e); cx.notify(); }
      } finally {
        if (gen === this.gen) this.started = 0;
      }
    });
  }

  /** Per checkout: agents working in it and spaces showing it. */
  occupancy() {
    const ps = panes(), occ = new Map(this.list.map((w) => [w.path, { agents: [], spaces: [] }]));
    for (const a of agents()) {
      const p = ps.find((x) => x.pane === a.pane);
      const w = owner(this.list, p?.cwd);
      if (w) occ.get(w.path).agents.push(a);
    }
    for (const s of spaces()) {
      if ((s.machine ?? null) !== (this.repo?.on ?? null)) continue;
      const w = owner(this.list, spaceFolder(s, ps));
      if (w) occ.get(w.path).spaces.push(s);
    }
    return occ;
  }

  // ---- actions

  select(w, occ) {
    const s = occ.get(w.path)?.spaces[0];
    if (s) run("space.select", { id: s.id });
    // Unnamed, so the space follows the checkout and nests under its repo.
    else run("space.new", { folder: w.path, ...(this.repo.on ? { machine: this.repo.on } : {}) });
  }

  start(mode, cx) {
    if (this.mode?.busy) return; // a step is running: let it finish
    this.mode = mode;
    this.error = "";
    if (!mode) this.handle.focus();
    if (mode?.kind === "new" || mode?.kind === "rename") {
      this.input.set_value(mode.kind === "rename" ? mode.w.branch ?? "" : "");
      this.input.focus();
    }
    if (mode?.kind === "delete") {
      // What a removal would take with it. git refuses either without
      // --force: uncommitted changes, and checked-out submodules.
      cx.spawn(async (cx) => {
        const info = await inspect(mode.w, this.repo.on);
        if (this.mode !== mode) return;
        Object.assign(mode, info, { clearSubs: info.subs > 0 });
        cx.notify();
      });
    }
    cx.notify();
  }

  submit(cx) {
    const name = this.input.value().trim();
    const mode = this.mode;
    if (!mode || !name || mode.busy) return;
    mode.busy = mode.kind === "new" ? `checking out ${name}` : "renaming";
    cx.notify();
    cx.spawn(async (cx) => {
      this.error = mode.kind === "new" ? await this.create(name) : await this.rename(mode.w, name);
      mode.busy = null;
      if (!this.error && this.mode === mode) { this.mode = null; this.handle.focus(); }
      this.started = 0;
      this.refresh(cx);
      cx.notify();
    });
  }

  async create(branch) {
    const { main, name, on } = this.repo;
    let root = home();
    if (on) root = (await exec("sh", ["-c", 'printf %s "$HOME"'], { on })).stdout.trim() || root;
    const path = `${root}/.herdr/worktrees/${name}/${slug(branch)}`;
    const exists = (await git(main, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], on)).ok;
    // A new branch starts from the checkout this space is in.
    const from = this.where()?.folder ?? main;
    const r = await git(from, exists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, "HEAD"], on);
    if (!r.ok) return r.err || "git worktree add failed.";
    run("space.new", { folder: path, ...(on ? { machine: on } : {}) });
    return "";
  }

  async rename(w, next) {
    if (!w.branch) return "A detached checkout has no branch to rename.";
    if (next === w.branch) return "";
    const r = await git(this.repo.main, ["branch", "-m", w.branch, next], this.repo.on);
    return r.ok ? "" : r.err || "git branch -m failed.";
  }

  /**
   * Removes one worktree; resolves with an error, or "" when it's gone.
   * opts: { dirty, subs } from inspect(), and the choices { clearSubs, branch }.
   */
  async removeOne(repo, w, opts, occ, step) {
    // Terminals first: a shell sitting in the folder keeps it busy.
    const closing = occ.get(w.path)?.spaces ?? [];
    if (closing.length) step("closing its spaces");
    for (const s of closing) run("space.close", { id: s.id, confirmed: true });
    // git won't remove a worktree with checked-out submodules. Unless told
    // to force it all, take them out first: deinit them, then drop their
    // repositories from the worktree's own git dir (git keeps them there,
    // and refuses while they exist). The worktree itself then goes the
    // normal way, still refusing uncommitted changes.
    if (opts.subs && opts.clearSubs) {
      step("removing its submodules");
      const d = await git(w.path, ["submodule", "deinit", "--all", "--force"], repo.on);
      if (!d.ok) return d.err || "git submodule deinit failed.";
      const gd = await git(w.path, ["rev-parse", "--absolute-git-dir"], repo.on);
      if (gd.ok && /\/worktrees\/[^/]+$/.test(gd.out)) {
        const rm = await exec("rm", ["-rf", "--", `${gd.out}/modules`], { on: repo.on });
        if (rm.code !== 0) return rm.stderr.trim() || "couldn't remove the submodules' repositories.";
      }
    }
    step("removing the worktree");
    const force = opts.dirty || (opts.subs && !opts.clearSubs);
    const r = await git(repo.main, ["worktree", "remove", ...(force ? ["--force"] : []), w.path], repo.on);
    if (!r.ok) return r.err || "git worktree remove failed.";
    if (opts.branch && w.branch) {
      step("deleting the branch");
      const b = await git(repo.main, ["branch", "-D", w.branch], repo.on);
      if (!b.ok) return b.err;
    }
    return "";
  }

  /** After a removal: refresh, and say how it went (a toast when the pane has moved on to another repo). */
  settle(mode, repo, title, error, cx) {
    mode.busy = null;
    if (this.repo?.main !== repo.main) {
      notify(error ? { title: `Couldn't ${title}`, body: error, level: "error" } : { title: title[0].toUpperCase() + title.slice(1), body: repo.name });
    } else this.error = error;
    if (!error && this.mode === mode) { this.mode = null; this.handle.focus(); }
    this.started = 0;
    this.refresh(cx);
    cx.notify();
  }

  remove(mode, occ, cx) {
    if (mode.busy) return;
    const { w } = mode, repo = this.repo, label = w.branch ?? w.path.split("/").pop();
    const step = (text) => { mode.busy = text; cx.notify(); };
    step("removing the worktree");
    cx.spawn(async (cx) => {
      const say = (text) => { mode.busy = text; cx.notify(); };
      const error = await this.removeOne(repo, w, mode, occ, say);
      this.settle(mode, repo, `delete ${label}`, error, cx);
    });
  }

  // ---- bulk

  /** Selected worktrees that still exist, in list order. */
  selected() { return this.list.filter((w) => !w.main && this.sel.has(w.path)); }

  pickSel(kind, occ, cx) {
    if (this.mode?.busy) return;
    const all = this.list.filter((w) => !w.main);
    if (kind === "none") this.sel = new Set();
    else if (kind === "all") this.sel = new Set(all.map((w) => w.path));
    else if (kind === "unused") {
      this.sel = new Set(all.filter((w) => !occ.get(w.path)?.spaces.length && !occ.get(w.path)?.agents.length).map((w) => w.path));
    } else if (kind === "merged") {
      // Merged into the branch the main checkout has out.
      const base = this.list[0]?.branch, repo = this.repo;
      if (!base) { this.error = "The main checkout has no branch to compare with."; return cx.notify(); }
      cx.spawn(async (cx) => {
        const r = await git(repo.main, ["branch", "--merged", base, "--format=%(refname:short)"], repo.on);
        if (!r.ok) { this.error = r.err; return cx.notify(); }
        const merged = new Set(r.out.split("\n").map((l) => l.trim()).filter(Boolean));
        this.sel = new Set(all.filter((w) => w.branch && w.branch !== base && merged.has(w.branch)).map((w) => w.path));
        if (!this.sel.size) this.error = `Nothing merged into ${base}.`;
        cx.notify();
      });
    }
    cx.notify();
  }

  openSel(occ) {
    for (const w of this.selected()) if (!occ.get(w.path)?.spaces.length) this.select(w, occ);
  }

  bulkStart(cx) {
    if (this.mode?.busy) return;
    const items = this.selected();
    if (!items.length) return;
    const mode = { kind: "bulk", items, info: new Map(), clearSubs: true, branch: false };
    this.mode = mode; this.error = "";
    cx.spawn(async (cx) => {
      const found = await Promise.all(items.map((w) => inspect(w, this.repo.on)));
      if (this.mode !== mode) return;
      items.forEach((w, i) => mode.info.set(w.path, found[i]));
      cx.notify();
    });
    cx.notify();
  }

  bulkRemove(mode, occ, cx) {
    if (mode.busy || mode.info.size < mode.items.length) return;
    const repo = this.repo, n = mode.items.length;
    mode.busy = `removing 1 of ${n}`;
    cx.notify();
    cx.spawn(async (cx) => {
      const failed = [];
      for (const [i, w] of mode.items.entries()) {
        const label = w.branch ?? w.path.split("/").pop();
        const say = (text) => { mode.busy = `${i + 1} of ${n}, ${label}: ${text}`; cx.notify(); };
        const error = await this.removeOne(repo, w, { ...mode.info.get(w.path), clearSubs: mode.clearSubs, branch: mode.branch }, occ, say);
        if (error) failed.push(`${label}: ${error}`);
        else this.sel.delete(w.path);
      }
      const done = n - failed.length;
      this.settle(mode, repo, `delete ${n} worktrees`,
        failed.length ? `Deleted ${done} of ${n}. Not deleted:\n${failed.join("\n")}` : "", cx);
    });
  }

  bulkPanel(t, mode, occ) {
    const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
    const ready = mode.info.size === mode.items.length;
    const info = [...mode.info.values()];
    const dirty = info.filter((x) => x.dirty).length, subs = info.filter((x) => x.subs).length;
    const spaces = mode.items.reduce((k, w) => k + (occ.get(w.path)?.spaces.length ?? 0), 0);
    const ags = mode.items.reduce((k, w) => k + (occ.get(w.path)?.agents.length ?? 0), 0);
    const facts = [
      [t.foreground, mode.items.map((w) => w.branch ?? w.path.split("/").pop()).slice(0, 4).join(", ") + (mode.items.length > 4 ? `, +${mode.items.length - 4} more` : "")],
      !ready ? [t.ansi8, "checking for changes…"]
        : dirty ? [t.blocked, `${dirty} ${dirty === 1 ? "has" : "have"} uncommitted changes, lost on delete`]
        : [t.ansi8, "no uncommitted changes"],
    ];
    if (ready && subs) facts.push([t.blocked, `${subs} ${subs === 1 ? "has" : "have"} submodules; unpushed commits in them are lost`]);
    if (spaces || ags) facts.push([ags ? t.blocked : t.ansi8, [spaces ? `closes ${n(spaces, "space", "spaces")}` : null, ags ? `ends ${n(ags, "agent", "agents")}` : null].filter(Boolean).join(", ")]);
    return confirm(t, "wt-bulk", {
      title: `Delete ${n(mode.items.length, "worktree", "worktrees")}?`,
      facts,
      options: [
        ready && subs ? check(t, "wt-bulk-subs", "remove submodules first", mode.clearSubs, (cx) => { mode.clearSubs = !mode.clearSubs; cx.notify(); }) : null,
        check(t, "wt-bulk-branch", "also delete their branches", mode.branch, (cx) => { mode.branch = !mode.branch; cx.notify(); }),
      ].filter(Boolean),
      go: { label: `delete ${mode.items.length}${dirty || (subs && !mode.clearSubs) ? " anyway" : ""}`, action: (cx) => this.bulkRemove(mode, occ, cx) },
      keep: (cx) => this.start(null, cx),
      busy: mode.busy,
    });
  }

  /** Under the toolbar: quick selections, and what to do with the selection. */
  selBar(t, occ) {
    const k = this.selected().length;
    const pick = (id, label) => chip(t, `sel-${id}`, label, (cx) => this.pickSel(id, occ, cx), t.ansi8);
    return h_flex().id("wt-selbar").h(28).flex_none().px(12).gap(2).items_center().text_size(11).border_b(1).border_color(t.ansi0)
      .child(div().pr(4).text_color(t.dim).child("select"))
      .child(pick("all", "all")).child(pick("merged", "merged")).child(pick("unused", "unused"))
      .when(k > 0, (el) => el.child(pick("none", "none")))
      .child(div().flex_1())
      .when(k > 0, (el) => el
        .child(div().px(6).text_color(t.foreground).child(`${k} selected`))
        .child(chip(t, "sel-open", "open", () => this.openSel(occ)))
        .child(chip(t, "sel-delete", `delete ${k}`, (cx) => this.bulkStart(cx), t.blocked)));
  }

  // ---- keyboard

  /** The row under the cursor (the first one when it's gone). */
  current() { return this.shown.find((w) => w.path === this.cursor) ?? this.shown[0] ?? null; }

  /** Moves the cursor to row i (clamped), growing a range select, and scrolls to it. */
  moveTo(i) {
    if (!this.shown.length) return;
    const k = Math.max(0, Math.min(this.shown.length - 1, i));
    this.cursor = this.shown[k].path;
    if (this.range) this.markRange();
    this.scroll.scroll_to_item(k);
  }

  /** v: the selection is every non-main row from the anchor to the cursor. */
  markRange() {
    const a = this.shown.findIndex((w) => w.path === this.range.anchor);
    const b = this.shown.findIndex((w) => w.path === this.cursor);
    if (a < 0 || b < 0) return;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    this.sel = new Set(this.shown.slice(lo, hi + 1).filter((w) => !w.main).map((w) => w.path));
  }

  /** A delete panel's keys; true when one was used. */
  panelKey(k, occ, cx) {
    const m = this.mode;
    if (m?.busy) return k === "escape"; // running: nothing to choose, and esc mustn't leave
    if (k === "enter" || k === "y") m.kind === "bulk" ? this.bulkRemove(m, occ, cx) : this.remove(m, occ, cx);
    else if (k === "escape" || k === "n") this.start(null, cx);
    else if (k === "b") m.branch = !m.branch;
    else if (k === "s" && (m.kind === "bulk" || m.subs)) m.clearSubs = !m.clearSubs;
    else return false;
    return true;
  }

  key(e, cx) {
    const mods = e.modifiers ?? {};
    if (mods.control || mods.platform || mods.alt) return;
    // A field has the keys while it's open (its own esc closes it).
    if (this.filtering || this.mode?.kind === "new" || this.mode?.kind === "rename") return;
    // What was typed ("G", "?", "<"), else the key's name ("down", "enter").
    const c = e.key_char;
    const k = c && c.length === 1 && c.trim() ? c : e.key;
    const occ = this.occupancy();
    if (this.help) {
      if (k === "escape" || k === "?" || k === "q") { this.help = false; cx.stop_propagation(); cx.notify(); }
      return;
    }
    if (this.mode?.kind === "delete" || this.mode?.kind === "bulk") {
      if (this.panelKey(k, occ, cx)) { cx.stop_propagation(); cx.notify(); }
      return;
    }
    const i = Math.max(0, this.shown.findIndex((w) => w.path === this.current()?.path));
    const w = this.current();
    if (k === "j" || k === "down") this.moveTo(i + 1);
    else if (k === "k" || k === "up") this.moveTo(i - 1);
    else if (k === "g" || k === "<" || k === "home") this.moveTo(0);
    else if (k === "G" || k === ">" || k === "end") this.moveTo(this.shown.length - 1);
    else if (k === "." || k === "pagedown") this.moveTo(i + PAGE);
    else if (k === "," || k === "pageup") this.moveTo(i - PAGE);
    else if (k === "enter" && w) this.select(w, occ);
    else if (k === "space" && w && !w.main) { this.sel.has(w.path) ? this.sel.delete(w.path) : this.sel.add(w.path); this.moveTo(i + 1); }
    else if (k === "n" && this.repo) this.start({ kind: "new" }, cx);
    else if (k === "R" && w) this.start({ kind: "rename", w }, cx);
    else if (k === "d") {
      if (this.selected().length) this.bulkStart(cx);
      else if (w && !w.main) this.start({ kind: "delete", w }, cx);
    } else if (k === "v") {
      if (this.range) this.range = null;
      else if (w) { this.range = { anchor: w.path }; this.markRange(); }
    } else if (k === "a") this.pickSel(this.selected().length ? "none" : "all", occ, cx);
    else if (k === "m") this.pickSel("merged", occ, cx);
    else if (k === "u") this.pickSel("unused", occ, cx);
    else if (k === "o") {
      if (this.selected().length) this.openSel(occ);
      else if (w && !occ.get(w.path)?.spaces.length) this.select(w, occ);
    } else if (k === "/") {
      this.filtering = true;
      this.filterInput.focus();
    } else if (k === "?") this.help = true;
    else if (k === "escape") {
      if (this.range) this.range = null;
      else if (this.filter) { this.filter = ""; this.filterInput.set_value(""); }
      else if (this.sel.size) this.sel = new Set();
      else if (this.error) this.error = "";
      else return;
    } else return;
    cx.stop_propagation();
    cx.notify();
  }

  /** lazygit's options bar: the keys that do something here, now. */
  hints(t) {
    const m = this.mode;
    const list = this.help ? [["esc", "close"]]
      : m?.kind === "delete" || m?.kind === "bulk" ? [["enter", "delete"], ["esc", "keep"], ["b", "branch"], ...(m.kind === "bulk" || m.subs ? [["s", "submodules"]] : [])]
      : this.filtering ? [["enter", "keep filter"], ["esc", "clear"]]
      : m ? [["enter", "save"], ["esc", "cancel"]]
      : this.range ? [["j/k", "grow"], ["d", "delete"], ["o", "open"], ["v", "done"]]
      : [["enter", "go"], ["space", "select"], ["n", "new"], ["R", "rename"], ["d", "delete"], ["v", "range"], ["/", "filter"], ["?", "keys"]];
    return h_flex().id("wt-hints").relative().h(22).flex_none().px(12).gap(10).items_center().text_size(11).overflow_hidden()
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
      .children(list.map(([key, what], i) => h_flex().id(`wt-hint-${i}`).flex_none().gap(4)
        .child(div().text_color(t.accent).child(key))
        .child(div().text_color(t.dim).child(what))));
  }

  /** ?: every key, grouped, over the list. */
  helpPanel(t) {
    const groups = [
      ["move", [["j k ↓ ↑", "up / down"], ["g G < >", "top / bottom"], [", .", "a page"]]],
      ["worktree", [["enter", "go to it"], ["n", "new"], ["R", "rename branch"], ["d", "delete"], ["o", "open, stay here"]]],
      ["select", [["space", "this one"], ["v", "range from here"], ["a", "all / none"], ["m", "merged"], ["u", "unused"], ["d o", "on the selection"]]],
      ["list", [["/", "filter"], ["esc", "back out"], ["?", "these keys"]]],
    ];
    return v_flex().id("wt-help").absolute().inset_0().bg(t.background).px(16).py(10).gap(10).text_size(11)
      .children(groups.map(([name, keys]) => v_flex().id(`wt-help-${name}`).gap(2)
        .child(eyebrow(t, name))
        .children(keys.map(([k, what], i) => h_flex().id(`wt-help-${name}-${i}`).gap(12)
          .child(div().w(92).flex_none().text_color(t.accent).child(k))
          .child(div().text_color(t.muted).child(what))))));
  }

  // ---- parts

  row(t, w, occ, here) {
    const o = occ.get(w.path) ?? { agents: [], spaces: [] };
    const status = o.agents.map((a) => a.status).sort((a, b) => RANK[a] - RANK[b])[0] ?? null;
    const label = w.branch ?? `detached · ${w.path.split("/").pop()}`;
    const mode = this.mode?.w?.path === w.path ? this.mode : null;
    const busy = o.agents.filter((a) => a.status === status).length;
    const note = status ? `${busy > 1 ? `${busy} ` : ""}${WORD[status]}` : o.spaces.length ? "open" : w.main ? "main checkout" : "";
    const id = `wt-${w.path}`;

    // A virtual list's rows can't carry handlers (gpui-kit refuses them in
    // the item renderer, and the whole window then draws blank), so every row
    // here is inert: presses land on the list (rowPress / rowClick), which
    // tell the select box, the chips and the row apart by where they were.
    const renaming = mode?.kind === "rename";
    if (renaming && mode.busy) return h_flex().id(id).h(ROW).w_full().flex_none().px(16).items_center().child(working(t, `${id}-busy`, mode.busy));
    // Being renamed or deleted: the row stays as it is, marked; the field or
    // panel is pinned below the list (render), where scrolling can't hide it.
    const marked = renaming || mode?.kind === "delete" || (this.mode?.kind === "bulk" && this.mode.items.some((x) => x.path === w.path));
    const cur = this.cursor === w.path;
    const chips = cur && !this.mode && !this.range;
    const slot = (key, label, width, color) => div().id(`${id}-${key}`).w(width).h(18).flex_none().flex().items_center().justify_center()
      .text_color(color).hover((s) => s.text_color(t.foreground).bg(t.ansi0)).child(label);
    return h_flex().id(id).relative().h(ROW).w_full().flex_none().px(16).gap(8).items_center().text_size(11)
      .hover((s) => s.bg(t.ansi0 + "55"))
      .when(here, (el) => el.child(dither(t.ansi0, 1)))
      .when(cur && !here && this.focusedNow, (el) => el.bg(t.ansi0 + "55"))
      .when((cur && this.focusedNow) || marked, (el) => el.child(div().absolute().left(0).top(0).bottom(0).w(2).bg(marked ? t.blocked : t.accent)))
      .child(w.main ? div().size(10).flex_none() : this.selBox(t, w))
      .child(pip(t, status))
      .child(h_flex().relative().flex_1().min_w(0).gap(10).items_baseline()
        .child(div().flex_none().max_w(260).truncate().text_color(marked || here || cur ? t.foreground : w.prunable ? t.dim : t.muted).child(label))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(tildeOf(w.path))))
      .when(!chips, (el) => el.child(div().relative().flex_none().text_color(status ? t[status] : t.dim).child(note)))
      .when(chips, (el) => el
        .child(slot("rename", "rename", CHIP.rename, t.muted))
        .when(!w.main, (el) => el.child(slot("delete", "delete", CHIP.delete, t.muted))));
  }

  /** Where a press on the list landed, from the list's own box (rows span it). */
  rowPress(e) {
    const x = e.local_position?.x, width = e.bounds?.size?.width ?? e.bounds?.width ?? this.listWidth;
    this.press = { x, fromRight: x != null && width != null ? width - x : null, count: e.click_count ?? 1 };
    this.handle.focus();
  }

  /** A click on row `path`: its select box, its chips (on the cursor row), or the row. */
  rowClick(path, cx) {
    const w = this.list.find((x) => x.path === path);
    if (!w) return;
    const p = this.press ?? {};
    this.press = null;
    if (!w.main && p.x != null && p.x >= 8 && p.x < 32) {
      this.sel.has(w.path) ? this.sel.delete(w.path) : this.sel.add(w.path);
      this.cursor = w.path;
      return cx.notify();
    }
    if (this.cursor === w.path && !this.mode && !this.range && p.fromRight != null) {
      const r = p.fromRight - 16; // the row's right padding
      const del = w.main ? 0 : CHIP.delete;
      if (!w.main && r >= 0 && r < del) return this.start({ kind: "delete", w }, cx);
      if (r >= del + (del ? 8 : 0) && r < del + (del ? 8 : 0) + CHIP.rename) return this.start({ kind: "rename", w }, cx);
    }
    // First click puts the cursor on it (and its chips); a second, or a
    // double-click, goes there.
    if (this.cursor === w.path || p.count > 1) this.select(w, this.occupancy());
    else this.cursor = w.path;
    cx.notify();
  }

  selBox(t, w) {
    const on = this.sel.has(w.path);
    return div().id(`sel-box-${w.path}`).relative().size(10).flex_none().border(1).border_color(on ? t.accent : t.ansi8)
      .when(on, (el) => el.child(dither(t.accent, 1)));
  }

  /** The delete confirmation for `mode.w`, with its progress while it runs. */
  deletePanel(t, mode, occ) {
    const w = mode.w;
    const o = occ.get(w.path) ?? { agents: [], spaces: [] };
    const label = w.branch ?? `detached · ${w.path.split("/").pop()}`;
    const id = `wt-del-${w.path}`;
    const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
    const facts = [
      mode.dirty === undefined ? [t.ansi8, "checking for changes…"]
        : mode.dirty ? [t.blocked, `${n(mode.dirty, "uncommitted change", "uncommitted changes")}, lost on delete`]
        : [t.ansi8, "no uncommitted changes"],
    ];
    if (mode.subs) facts.push([t.blocked, `${n(mode.subs, "submodule", "submodules")}; unpushed commits in them are lost`]);
    if (o.spaces.length || o.agents.length) {
      facts.push([o.agents.length ? t.blocked : t.ansi8,
        [o.spaces.length ? `closes ${n(o.spaces.length, "space", "spaces")}` : null, o.agents.length ? `ends ${n(o.agents.length, "agent", "agents")}` : null].filter(Boolean).join(", ")]);
    }
    return confirm(t, id, {
      title: `Delete ${label}?`,
      facts,
      options: [
        mode.subs ? check(t, `${id}-subs`, "remove submodules first", Boolean(mode.clearSubs), (cx) => { mode.clearSubs = !mode.clearSubs; cx.notify(); }) : null,
        w.branch ? check(t, `${id}-branch`, `also delete branch ${w.branch}`, Boolean(mode.branch), (cx) => { mode.branch = !mode.branch; cx.notify(); }) : null,
      ].filter(Boolean),
      // Forcing is only needed for changes, or submodules left in place.
      go: { label: mode.dirty || (mode.subs && !mode.clearSubs) ? "delete anyway" : "delete", action: (cx) => this.remove(mode, occ, cx) },
      keep: (cx) => this.start(null, cx),
      busy: mode.busy,
    });
  }

  /** The section: eyebrow, rows, the new-worktree row, an error line. Nothing outside a repo. */
  /** The pane: a toolbar, the new-worktree field, every worktree (scrolling), then the delete panel pinned below. */
  render(t) {
    const top = h_flex().id("wt-toolbar").relative().h(34).flex_none().px(12).gap(10).items_center().text_size(11)
      .child(div().flex_none().text_color(t.ansi8).child("WORKTREES"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground)
        .child(this.repo ? `${this.repo.name} · ${this.list.length}` : ""))
      .when(Boolean(this.repo) && this.mode?.kind !== "new", (el) => el.child(chip(t, "wt-new", "+ new", (cx) => this.start({ kind: "new" }, cx))))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
    this.focusedNow = this.handle.is_focused?.() ?? true;
    const pane = v_flex().id("worktrees").relative().size_full().bg(t.background)
      .track_focus(this.handle)
      .on_mouse_down("left", () => this.handle.focus())
      .on_key_down((e, cx) => this.key(e, cx))
      .child(top);
    if (!this.repo || !this.list.length) {
      return pane.child(v_flex().flex_1().items_center().justify_center().gap(8).px(16).text_size(11)
        .child(div().text_color(t.foreground).child(this.repo === null && this.where()?.folder ? "Not in a git repository" : "Reading worktrees…"))
        .child(div().text_center().text_color(t.ansi8).child(this.where()?.folder ? tildeOf(this.where().folder) : "")));
    }
    const occ = this.occupancy();
    const here = owner(this.list, this.where()?.folder)?.path;
    // Main first, then where agents are (most urgent first), then open ones,
    // then the rest in git's order.
    const urgency = (w) => {
      const o = occ.get(w.path);
      const top = o?.agents.map((a) => RANK[a.status]).sort()[0];
      return w.main ? -1 : top ?? (o?.spaces.length ? 10 : 20);
    };
    const sorted = this.list.map((w, i) => [w, i]).sort(([a, i], [b, j]) => urgency(a) - urgency(b) || i - j).map(([w]) => w);
    const q = this.filter.toLowerCase();
    const shown = q ? sorted.filter((w) => `${w.branch ?? ""} ${w.path}`.toLowerCase().includes(q)) : sorted;
    this.shown = shown;
    if (!shown.some((w) => w.path === this.cursor)) this.cursor = (shown.find((w) => w.path === here) ?? shown[0])?.path ?? null;
    return pane
      .child(this.selBar(t, occ))
      .when(this.mode?.kind === "new", (el) => el.child(this.mode.busy
        ? h_flex().id("wt-new-row").h(28).px(16).flex_none().items_center().child(working(t, "wt-new-busy", this.mode.busy))
        : h_flex().id("wt-new-row").h(28).px(16).flex_none().gap(8).items_center()
          .child(div().w(6).flex_none().text_size(11).text_color(t.accent).child("+"))
          .child(field(t, "wt-input", this.input, (cx) => this.start(null, cx)))
          .child(chip(t, "wt-new-cancel", "esc", (cx) => this.start(null, cx)))))
      .when(this.filtering || Boolean(this.filter), (el) => el.child(h_flex().id("wt-filter-row").h(28).px(16).flex_none().gap(8).items_center()
        .child(div().w(6).flex_none().text_size(11).text_color(t.accent).child("/"))
        .child(this.filtering
          ? field(t, "wt-filter", this.filterInput, (cx) => { this.filtering = false; this.filter = ""; this.filterInput.set_value(""); this.handle.focus(); cx.notify(); })
          : div().flex_1().min_w(0).truncate().text_size(11).text_color(t.foreground).child(this.filter))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(`${shown.length}/${sorted.length}`))))
      .child(div().id("wt-body").relative().flex_1().min_h(0)
        .on_mouse_down("left", (e) => this.rowPress(e))
        .on_size_change((size) => { this.listWidth = size.width; })
        .child(shown.length
          ? div().size_full().pt(4).child(v_virtual_list("wt-list", shown.length, ROW, (i) => shown[i].path,
            (range) => shown.slice(range.start, range.end).map((w) => this.row(t, w, occ, w.path === here)))
            .on_item_click((path, cx) => this.rowClick(path, cx))
            .size_full().track_scroll(this.scroll))
          : div().px(16).py(6).text_size(11).text_color(t.dim).child(`nothing matches "${this.filter}"`))
        .child(Scrollbar.vertical("wt-list").absolute().inset_0())
        .when(this.help, (el) => el.child(this.helpPanel(t))))
      .when(this.mode?.kind === "rename" && !this.mode.busy, (el) => el.child(h_flex().id("wt-rename-row").h(28).px(16).flex_none().gap(8).items_center()
        .child(div().flex_none().text_size(11).text_color(t.accent).child("R"))
        .child(field(t, "wt-input", this.input, (cx) => this.start(null, cx)))
        .child(chip(t, "wt-rename-cancel", "esc", (cx) => this.start(null, cx)))))
      .when(this.mode?.kind === "delete" && this.list.some((w) => w.path === this.mode.w.path), (el) => el.child(div().flex_none().pb(6).child(this.deletePanel(t, this.mode, occ))))
      .when(this.mode?.kind === "bulk", (el) => el.child(div().flex_none().pb(6).child(this.bulkPanel(t, this.mode, occ))))
      .when(Boolean(this.error), (el) => el.child(div().flex_none().px(16).py(4).text_size(11).text_color(t.blocked).child(this.error)))
      .child(this.hints(t));
  }
}

/** The worktree manager as a pane ({ role: "worktrees" }), opened from the "+ new" menu. */
export class WorktreesPanel {
  init(_props, cx) { this.wt = new Worktrees(); this.wt.init(cx); }
  render() { return this.wt.render(theme()); }
}
