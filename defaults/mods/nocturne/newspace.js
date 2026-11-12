// The new-space picker ({ role: "newspace" }): one list of folders, a field
// to filter it or type a path, and enter makes the space there. The same list
// attaches an existing space to another folder (props.space: its id).
//
//   opens     hanging under the sidebar's "+ new" (or the press that asked,
//             `at`: kit.js dropBelow), or centered from a key
//             (nocturne.space-new), the "+ new" menu, the palette and the
//             folded rail; a space's "Change folder…" hangs it under the row
//             right-clicked
//   list      folderlist.js: here, spaces, near, recent; then "browse…" (the
//             system's folder browser) and, always last, "no folder" (a space
//             of its own in ~; attaching: "detach", back to ~)
//   typing    filters by the folder's name, then its path; a field starting
//             with ~ or / lists that folder's subfolders instead
//   name      unnamed spaces are called after their folder; cmd-enter on a
//             row asks for a name first, the folder's in the field
//
// Keys: ↑ ↓ (ctrl-n / ctrl-p) move, wrapping (↑ from the top: "no folder");
// enter makes (attaches); cmd-enter names it first; tab puts the row's path
// in the field and lists inside it; shift-tab goes one folder up; esc leaves
// the name for the list, else closes. A click on a row picks it.

import { div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { theme, props, run, exec, home, spaces, panes, focused, shared, setShared, openOverlay, closeOverlay, pickFolder } from "herdr";
import { dither, eyebrow, spaceFolder } from "./kit.js";
import { tilde, untilde, isPath, splitPath, rank, sources, pathRows, complete, ghost, up, remember, newArgs, nearParents, worktreePaths, checkoutsFrom, folderName, tail } from "./folderlist.js";

/** shared() key: the folders spaces were made in or attached to here, newest first. */
export const RECENT = "nocturne.recent-folders";
/** shared() key: the open picker, { id: its overlay, space: the one it attaches, or null }. */
export const OPEN = "nocturne.newspace-open";

export const WIDTH = 452;
const ROW = 26;
const SEC = 24;
const HEAD = 34;
const FOOT = 28;
const LIST_MAX = 12 * ROW;
const CONTEXT = "NewSpace";
const TAB = "newspace::tab", TAB_BACK = "newspace::tab_back", ESC = "newspace::escape";
const chrome = (n) => `mods/workspace-chrome/${n}.svg`;
const stop = (_e, cx) => cx.stop_propagation();
const SECTIONS = { here: "here", spaces: "spaces", near: "near", recent: "recent", now: "now" };

/** The focused pane's folder now: where "here" starts. */
export function hereFolder() {
  const f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  return pane?.cwd || f?.cwd || null;
}

/**
 * Opens the picker: making a space, or (space: an id) attaching that one to
 * another folder. `at`: where it hangs (kit.js dropBelow); centered without.
 * Open already: closes it (a second key press). `wasOpen`: "+ new" was lit
 * when pressed, so the press closed it already; it stays closed. `replace`:
 * an open one gives way to this one even when it's the same (a menu's ask).
 */
export function openSpacePicker({ at = null, space = null, wasOpen = false, replace = false } = {}) {
  const open = shared(OPEN);
  if (open?.id) {
    setShared(OPEN, null);
    closeOverlay(open.id);
    // The same picker asked for again: that closes it. Another one replaces it.
    if (!replace && (open.space ?? null) === (space ?? null)) return null;
  }
  if (wasOpen && !space) return null;
  const id = openOverlay({ mod: "nocturne", kind: at ? "popup" : "dialog", frame: "none", width: WIDTH,
    ...(at ? { at, height: HEAD + LIST_MAX + 4 * SEC + FOOT + 12 } : {}),
    props: { role: "newspace", here: hereFolder(), ...(space ? { space } : {}) } });
  setShared(OPEN, { id, space: space ?? null });
  return id;
}

/** The picker is open ("+ new" stays lit). */
export const pickerOpen = () => Boolean(shared(OPEN)?.id);

export default class NewSpace {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    this.home = home();
    this.space = pr.space ? spaces().find((s) => s.id === pr.space) ?? null : null;
    this.on = this.space?.machine ?? null;
    this.cursor = 0;
    this.naming = null; // the row being named (cmd-enter)
    this.error = "";
    this.busy = false;
    this.done = false;
    this.lists = new Map(); // folder → { names, git } (path typing), or "asking"
    this.found = { here: null, spaces: [], near: [], git: new Set() };
    this.query = "";
    this.input = InputState.new({ placeholder: this.space ? "a folder, or a path: ~/ /" : "a folder, or a path: ~/ /" });
    this.input.on("change", (_e, cx) => this.changed(cx));
    this.input.on("submit", (e, cx) => this.enter(Boolean(e?.secondary), cx));
    this.nameInput = InputState.new({ placeholder: "name (empty: the folder's)" });
    this.nameInput.on("submit", (_e, cx) => this.enter(false, cx));
    this.scroll = ScrollHandle.new();
    this.focusField();
    for (const ms of [60, 250, 600]) cx.timer.after(ms, () => this.focusField());
    if (!NewSpace.bound) {
      try {
        cx.bind_keys([
          { keystroke: "tab", action: TAB, context: CONTEXT },
          { keystroke: "shift-tab", action: TAB_BACK, context: CONTEXT },
          { keystroke: "escape", action: ESC, context: CONTEXT },
        ]);
        NewSpace.bound = true;
      } catch { /* the key handler still tries */ }
    }
    this.seed(pr.here ?? null);
    cx.spawn((cx) => this.look(pr.here ?? null, cx));
  }

  focusField() { (this.naming ? this.nameInput : this.input).focus(); }

  close() {
    this.done = true;
    if (shared(OPEN)?.id === props()?.overlay) setShared(OPEN, null);
    closeOverlay(props()?.overlay);
  }

  /** The overlay is going (esc, a click beside it, a pick). */
  closing() {
    if (shared(OPEN)?.id === props()?.overlay) setShared(OPEN, null);
  }

  // ---- the folders

  /** What's known at once: the spaces' folders and branches, the recent list. */
  seed(here) {
    const all = panes();
    this.found.here = here && here !== this.home ? here : null;
    this.found.spaces = spaces().filter((s) => (s.machine ?? null) === this.on && s.id !== this.space?.id)
      .map((s) => ({ path: spaceFolder(s, all), branch: s.branch ?? null })).filter((s) => s.path);
  }

  /** Asks git and the disk, once: here's checkout, the repos' worktrees, the checkouts beside them. */
  async look(here, cx) {
    const on = this.on;
    const run1 = async (cmd, args, opts = {}) => {
      try { return await exec(cmd, args, { on, timeout: 4000, ...opts }); } catch { return { code: 1, stdout: "" }; }
    };
    if (this.found.here) {
      const r = await run1("git", ["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"], { cwd: this.found.here });
      const [top, branch] = r.stdout.trim().split("\n");
      if (r.code === 0 && top) {
        this.found.here = top === this.home ? null : top;
        this.found.hereBranch = branch && branch !== "HEAD" ? branch : null;
        this.found.git.add(top);
      }
    }
    const folders = [this.found.here, ...this.found.spaces.map((s) => s.path)].filter(Boolean);
    const trees = [];
    for (const f of [...new Set(folders)].slice(0, 8)) {
      const r = await run1("git", ["worktree", "list", "--porcelain"], { cwd: f });
      if (r.code !== 0) continue;
      this.found.git.add(f);
      const paths = worktreePaths(r.stdout);
      // The first is the main checkout; the rest are linked worktrees.
      paths.forEach((p, i) => trees.push({ path: p, worktree: i > 0 }));
    }
    const parents = nearParents([...folders, ...trees.filter((t) => !t.worktree).map((t) => t.path)], this.home).slice(0, 6);
    let beside = [];
    if (parents.length) {
      const all = await run1("find", [...parents, "-mindepth", "2", "-maxdepth", "2", "-name", ".git"]);
      const files = await run1("find", [...parents, "-mindepth", "2", "-maxdepth", "2", "-name", ".git", "-type", "f"]);
      beside = checkoutsFrom(all.stdout, new Set(files.stdout.split("\n").map((l) => l.trim()).filter(Boolean)));
    }
    this.found.near = [...trees, ...beside];
    for (const n of this.found.near) this.found.git.add(n.path);
    cx.notify();
  }

  /** The subfolders of `dir` (path typing), asked once and kept. */
  list(dir, cx) {
    if (this.lists.has(dir)) return this.lists.get(dir);
    if (!cx?.spawn) return "asking"; // drawing: changed() asks
    this.lists.set(dir, "asking");
    cx.spawn(async (cx) => {
      let names = [], git = new Set(), ok = false;
      try {
        const script = 'cd "$1" 2>/dev/null || exit 1; find -L . -mindepth 1 -maxdepth 1 -type d 2>/dev/null; echo ::; find -L . -mindepth 2 -maxdepth 2 -name .git 2>/dev/null; [ -e .git ] && echo ./.git';
        const r = await exec("sh", ["-c", script, "sh", dir], { on: this.on, timeout: 4000 });
        ok = r.code === 0;
        const [ds, gs = ""] = r.stdout.split("::");
        names = ds.split("\n").map((l) => l.trim().replace(/^\.\//, "")).filter(Boolean);
        git = new Set(gs.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^\.\//, "").replace(/\/?\.git$/, "") || "."));
      } catch { /* an empty list says it */ }
      this.lists.set(dir, { names, git, ok });
      cx.notify();
    });
    return "asking";
  }

  /** The folder rows now, for the field as typed. */
  folderRows(cx) {
    const q = this.query;
    if (isPath(q)) {
      const { dir } = splitPath(q, this.home);
      const got = this.list(dir, cx);
      if (got === "asking") return { path: true, dir, asking: true, rows: [] };
      const rows = got.ok ? pathRows(q, this.home, got.names, got.git).rows : [];
      // Nothing under it: the typed path itself, looked for on enter.
      const typed = untilde(q, this.home);
      if (!rows.length && typed !== this.home) rows.push({ path: typed, name: folderName(typed, this.home), from: "typed", tag: "", hits: [] });
      return { path: true, dir, rows, empty: !got.ok || rows[0]?.from === "typed" };
    }
    const f = this.found;
    const list = sources({
      here: f.here ? { path: f.here, branch: f.hereBranch ?? null } : null,
      spaces: f.spaces, near: f.near, recent: this.space ? [] : (shared(RECENT) ?? []), home: this.home, git: f.git,
    });
    const now = this.space ? spaceFolder(this.space, panes()) : null;
    const withNow = now && now !== this.home ? [{ path: now, name: folderName(now, this.home), from: "now", tag: "now" }, ...list.filter((r) => r.path !== now)] : list;
    return { path: false, rows: rank(withNow, q, this.home) };
  }

  /** Every pickable row in cursor order: the folders, browse, no folder. */
  rows(cx) {
    const f = this.folderRows(cx);
    const loose = this.space
      ? { id: "loose", kind: "loose", name: "no folder", say: "detach · starts in ~, belongs to no project" }
      : { id: "loose", kind: "loose", name: "no folder", say: "a space of its own · starts in ~, belongs to no project" };
    return { ...f, all: [...f.rows.map((r) => ({ ...r, id: r.path, kind: "folder" })), { id: "browse", kind: "browse", name: "browse…", say: "the system's folder browser" }, loose] };
  }

  // ---- acting

  changed(cx) {
    const v = this.input.value();
    if (v === this.query) return;
    this.query = v;
    this.cursor = 0;
    this.error = "";
    if (isPath(v)) this.list(splitPath(v, this.home).dir, cx);
    cx.notify();
  }

  /** Sets the field (tab, shift-tab) with the caret at its end. */
  setQuery(v, cx) {
    this.input.set_value(v);
    try { this.input.set_selected_range({ start: v.length, end: v.length }); } catch { /* the caret stays */ }
    this.query = v;
    this.cursor = 0;
    this.error = "";
    if (isPath(v)) this.list(splitPath(v, this.home).dir, cx);
    cx?.notify?.();
  }

  /** Tab: the cursor row's path in the field, listing inside it. Shift-tab: one folder up. */
  tab(back, cx) {
    if (this.naming) return;
    if (back) {
      if (isPath(this.query)) this.setQuery(up(this.query), cx);
      return;
    }
    const { all } = this.rows(cx);
    const row = all[this.cursor];
    if (row?.kind === "folder") this.setQuery(complete(row, this.home), cx);
    else if (!isPath(this.query)) this.setQuery("~/", cx);
  }

  /** Esc: from the name back to the list, else closed. */
  escape(cx) {
    if (this.naming) {
      this.naming = null;
      this.error = "";
      this.focusField();
      return cx?.notify?.();
    }
    this.close();
  }

  move(by, cx) {
    const n = this.rows(cx).all.length;
    this.cursor = n ? (((this.cursor + by) % n) + n) % n : 0;
    this.scroll.scroll_to_item?.(this.cursor);
    cx?.notify?.();
  }

  /** Enter (secondary: cmd-enter, name it first). */
  enter(secondary, cx) {
    if (this.done || this.busy) return;
    if (this.naming) return this.make(this.naming.folder, this.nameInput.value(), cx);
    const { all } = this.rows(cx);
    const row = all[this.cursor];
    if (!row) return;
    if (row.kind === "browse") return this.browse(secondary, cx);
    const folder = row.kind === "loose" ? null : row.path;
    if (secondary && !this.space) return this.askName(folder, cx);
    if (row.from === "typed") return this.checkThen(folder, () => this.make(folder, "", cx), cx);
    this.make(folder, "", cx);
  }

  /** cmd-enter: the folder kept, a name asked for (its folder's in the field). */
  askName(folder, cx) {
    this.naming = { folder };
    this.nameInput.set_value(folder ? folderName(folder, this.home) : "");
    const n = this.nameInput.value().length;
    try { this.nameInput.set_selected_range({ start: 0, end: n }); } catch { /* typing appends */ }
    this.focusField();
    cx?.notify?.();
  }

  /** A typed folder that isn't there says so in place; one that is goes on. */
  checkThen(folder, go, cx) {
    this.busy = true;
    cx.spawn(async (cx) => {
      let there = true;
      try { there = (await exec("test", ["-d", folder], { on: this.on })).code === 0; } catch { /* go on */ }
      this.busy = false;
      if (this.done) return;
      if (!there) { this.error = `no folder ${tilde(folder, this.home)}`; return cx.notify(); }
      go();
    });
  }

  /** Makes the space (or attaches this one) and closes. `folder` null: no folder. */
  make(folder, name, _cx) {
    if (this.done) return;
    if (this.space) {
      run("space.folder", { id: this.space.id, folder: folder ?? this.home });
    } else {
      run("space.new", newArgs(folder, name, this.home));
    }
    if (folder && !this.on) setShared(RECENT, remember(shared(RECENT), folder));
    this.close();
  }

  browse(secondary, cx) {
    this.busy = true;
    cx.spawn(async (cx) => {
      const folder = await pickFolder({ prompt: this.space ? `Attach ${this.space.name} to` : "Start the new space in" });
      this.busy = false;
      if (!folder || this.done) return cx.notify();
      if (secondary && !this.space) return this.askName(folder, cx);
      this.make(folder, "", cx);
    });
  }

  /** A key on the picker (its root's on_key_down): true when it was the picker's. */
  key(e, cx) {
    const m = e.modifiers ?? {}, k = e.key;
    const ctrl = m.control && !m.platform && !m.alt;
    if (k === "escape") { this.escape(cx); return true; }
    if (k === "tab" && !m.platform && !m.control && !m.alt) { this.tab(Boolean(m.shift), cx); return true; }
    if (k === "enter") { this.enter(Boolean(m.platform || m.control), cx); return true; }
    if (this.naming) return false;
    if (k === "down" || (ctrl && (k === "n" || k === "j"))) { this.move(1, cx); return true; }
    if (k === "up" || (ctrl && (k === "p" || k === "k"))) { this.move(-1, cx); return true; }
    return false;
  }

  // ---- drawing

  /** A row's name, the matched letters in the accent. */
  nameText(t, r, on) {
    const base = on ? t.foreground : t.muted;
    if (!r.hits?.length) return div().flex_none().text_color(base).child(r.name);
    return h_flex().flex_none().children([...r.name].map((ch, i) => div().text_color(r.hits.includes(i) ? t.accent : base).child(ch)));
  }

  row(t, r, i, on) {
    const icon = r.kind === "browse" ? "search" : r.kind === "loose" ? "square" : r.from === "here" ? "terminal" : r.tag === "worktree" ? "git-branch" : "folder";
    const tagColor = r.tag === "now" ? t.accent : r.tag && !["git", "worktree"].includes(r.tag) ? t.done : t.dim;
    const words = r.kind === "folder" ? tail(tilde(r.path, this.home), 52 - r.name.length - (r.tag?.length ?? 0)) : r.say;
    return h_flex().id(`ns-row-${i}`).relative().h(ROW).flex_none().px(12).gap(10).items_center().text_size(11)
      .on_mouse_down("left", stop)
      .on_hover((h, cx) => { if (h && this.cursor !== i) { this.cursor = i; cx.notify(); } })
      .on_click((_e, cx) => { this.cursor = i; this.enter(false, cx); })
      .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
      .child(svg(chrome(icon)).size(12).flex_none().relative().text_color(on || r.kind !== "folder" ? t.accent : t.ansi8))
      .child(div().relative().flex_none().child(this.nameText(t, r, on)))
      .child(div().relative().flex_1().min_w(0).truncate().text_color(t.dim).child(words ?? ""))
      .when(Boolean(r.tag), (el) => el.child(div().relative().flex_none().text_color(tagColor).child(r.tag)));
  }

  /** What enter does now, in words (the footer). */
  say(all) {
    if (this.error) return this.error;
    if (this.naming) {
      const n = this.nameInput.value().trim();
      const f = this.naming.folder;
      return `a space "${n || (f ? folderName(f, this.home) : "~")}", in ${f ? tail(tilde(f, this.home), 28) : "~"}`;
    }
    const r = all[this.cursor];
    if (!r) return isPath(this.query) ? `a space in ${tail(this.query, 32)}` : "";
    if (r.kind === "browse") return "pick a folder in the system's browser";
    if (this.space) {
      if (r.kind === "loose") return `${this.space.name} detaches, back to ~`;
      if (r.from === "now") return `${this.space.name} stays where it is`;
      return `${this.space.name} moves to ${tail(tilde(r.path, this.home), 30)}`;
    }
    if (r.kind === "loose") return "a space with no folder, in ~";
    return `a space "${r.name}", in ${tail(tilde(r.path, this.home), 30)}`;
  }

  render(_cx) {
    const t = theme();
    const view = this.rows(null);
    const { all, path, asking } = view;
    this.cursor = Math.min(this.cursor, Math.max(0, all.length - 1));
    const items = [];
    let lastFrom = null;
    if (path) items.push(div().id("ns-sec-in").px(12).pt(8).pb(3).flex_none().child(eyebrow(t, `in ${tail(tilde(view.dir, this.home), 40)}`)));
    all.forEach((r, i) => {
      if (r.kind !== "folder" && lastFrom !== "end") {
        if (asking) items.push(div().id("ns-asking").px(12).h(ROW).flex().items_center().text_size(11).text_color(t.dim).child("looking…"));
        else if (path && view.empty) items.push(div().id("ns-none").px(12).h(ROW).flex().items_center().text_size(11).text_color(t.dim)
          .child(`nothing in ${tail(tilde(view.dir, this.home), 24)} starts with "${splitPath(this.query, this.home).prefix}"`));
        items.push(div().id("ns-rule").mx(12).my(4).h(2).flex_none().relative().child(dither(t.ansi0, 1)));
        lastFrom = "end";
      }
      if (r.kind === "folder" && !path && !this.query.trim() && r.from !== lastFrom) {
        items.push(div().id(`ns-sec-${r.from}`).px(12).pt(8).pb(3).flex_none().child(eyebrow(t, SECTIONS[r.from] ?? r.from)));
        lastFrom = r.from;
      }
      items.push(this.row(t, r, i, i === this.cursor && !this.naming));
    });
    const title = this.space ? `attach ${this.space.name} to` : "new space";
    const hint = (k, w) => h_flex().flex_none().gap(4).child(div().text_color(t.accent).child(k)).child(div().text_color(t.dim).child(w));
    const g = this.naming ? "" : ghost(this.query, all[this.cursor], this.home);
    const field = (state, label) => h_flex().id(label ? "ns-name-field" : "ns-field").flex_1().min_w(0).h(22).px(6).gap(6).items_center()
      .border(1).border_color(t.accent).bg(t.background)
      .when(Boolean(label), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(label)))
      .child(Input.new(state).flex_1().h_full().text_size(11).text_color(t.foreground));
    const body = this.naming
      ? v_flex().id("ns-naming").py(4).child(this.row(t, { kind: "folder", name: "in", path: this.naming.folder ?? this.home, tag: "", hits: [] }, 0, false))
      : v_flex().id("ns-list").py(2).max_h(LIST_MAX + 4 * SEC).overflow_y_scroll().track_scroll(this.scroll).children(items);
    const root = v_flex().id("nocturne-newspace").w_full().bg(t.background).border(1).border_color(t.ansi0)
      .key_context(CONTEXT)
      .on_action(TAB, (_e, cx) => { this.tab(false, cx); cx.notify(); })
      .on_action(TAB_BACK, (_e, cx) => { this.tab(true, cx); cx.notify(); })
      .on_action(ESC, (_e, cx) => { this.escape(cx); cx.notify(); })
      .on_key_down((e, cx) => {
        if (!this.key(e, cx)) return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().relative().h(HEAD).flex_none().px(12).gap(8).items_center().text_size(11)
        .child(div().flex_none().text_color(t.foreground).child(title))
        .child(this.naming ? field(this.nameInput, "name") : field(this.input, null))
        .child(div().id("ns-esc").flex_none().px(5).h(18).flex().items_center().text_color(t.muted)
          .hover((s) => s.text_color(t.foreground).bg(t.ansi0))
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => { this.escape(cx); cx.notify(); })
          .child("esc"))
        .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1))))
      .child(body)
      .child(h_flex().id("ns-foot").relative().h(FOOT).flex_none().px(12).gap(12).items_center().text_size(11)
        .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
        .child(div().id("ns-say").flex_1().min_w(0).truncate().text_color(this.error ? t.blocked : t.muted).child(this.say(all)))
        .when(Boolean(g), (el) => el.child(hint("tab", g)))
        .when(!g && !this.naming, (el) => el.child(hint("enter", this.space ? "attach" : "make")))
        .when(!g && !this.naming && !this.space, (el) => el.child(hint("⌘enter", "name it")))
        .when(Boolean(this.naming), (el) => el.child(hint("enter", "make")).child(hint("esc", "back"))));
    return root;
  }
}
