// Nocturne files: a folder's tree in a pane, in Nocturne's 1-bit look, that
// hands what you pick to $EDITOR. Herdr's shipped files mod, reworked: the
// same lazy listing, folder watch and git marks (a mod can't import another
// mod's files, so it isn't wrapped), but rooted where it was opened instead
// of following focus, and opening files in the editor instead of a preview.
// Opened from Nocturne's "+ new" > Files (or cmd-e) with props { folder, on }:
// the panel down the tab's right edge. A folder link (a terminal's cmd-click,
// `files.open`) opens a pane of its own instead, props { path, on, slot }:
// beside the pane it came from, closed with q / esc, opening files beside itself.
//
// Each pane keeps its filters (dotfiles, git-ignored files; new panes take
// settings.json `files`) in shared `nocturne-files.filters` by slot. `/`
// filters the tree as you type: fff's fuzzy index of the root (findFiles),
// hits under their folders; elsewhere (home, /, another machine) the folders
// already listed.
//
// Files open in the app's editor (nocturne-editor, `editor.open`); folders,
// files on another machine and E go to $EDITOR. That one runs through this mod's bin/nocturne-edit (on another
// machine: `nocturne-edit` from its PATH) in a
// terminal pane beside this one. With nvim it listens on a socket per tab,
// so later picks open in that same nvim instead of a new pane.
//
// Click a file: edit it in the app's editor (a Markdown file: read it in the Markdown viewer,
// nocturne-markdown, alt-click edits it as text; a picture, PDF, table, patch,
// font or clip: the preview, nocturne-preview, alt-click opens the system's app,
// or edits a table or patch). Click a folder: fold it;
// click it again quickly: edit the folder. Keys while it has focus:
//   j / k  ↓ ↑     move                 l →  unfold, or open a file
//   h ←            fold, or go to the parent row
//   enter          open a file, fold a folder    e  edit what's selected (as text; a picture: system app)
//   E              edit it in $EDITOR (a terminal beside)
//   -              root one folder up            .  root at the selected folder
//   gg / G         top / bottom                  r  refresh
//   /              filter (esc clears)           H  dotfiles  I  ignored files
//   v              Neovim beside                 o  a folder in a new files pane
//   y              copy the path                 m  the right-click menu
//   q / esc        close (a pane of its own)

import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar, VirtualListScrollHandle, InputState, Input } from "gpui-base";
import { props, theme, settings, exec, run, panes, spaces, terminals, watchFolder, nextCommand, home, appHome, shared, setShared, findFiles, window as appWindow } from "herdr";
import { keyColumn, parent, filterDefaults, parseIgnored, isIgnored, isHidden, lists, fuzzy, grouped, nvimLaunch, menuItems, marks } from "./logic.js";

const ROW = 22;
const PER_FOLDER = 500, TOTAL = 5000;
const EDIT = "nocturne-edit";
/** The editor wrapper: the one this mod ships, here; another machine's own. */
const editTool = (on) => (on ? EDIT : `${appHome()}/mods/nocturne-files/bin/${EDIT}`);
/** Files the app has a viewer for, by type: the command that opens one there,
 *  and what the other way (alt-click, `e`) does instead. */
const VIEWERS = [
  { test: /\.(md|markdown)$/i, open: "markdown.open", other: "edit" },
  // The preview (nocturne-preview/kinds.js KINDS); tables and patches are text: e edits them.
  { test: /\.(csv|tsv|diff|patch)$/i, open: "preview.open", other: "edit" },
  { test: /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|svg|avif|hei[cf]|pdf|sqlite3?|db3?|ttf|otf|ttc|woff2?|mp4|m4v|mov|mp3|m4a|aac|wav|aiff?|flac|caf)$/i, open: "preview.open", other: "system" },
];
export const viewerFor = (name) => VIEWERS.find((v) => v.test.test(name)) ?? null;
/** Markdown files open in the viewer (markdown.open), not the editor. */
export const isMarkdown = (name) => viewerFor(name)?.open === "markdown.open";
const isEdit = (argv0) => argv0 === EDIT || Boolean(argv0?.endsWith(`/${EDIT}`));
// Git status letter → theme color.
const MARK = { A: "ansi2", M: "ansi3", D: "ansi1", U: "ansi1" };
const ART = "mods/nocturne/art";
const MOD = "nocturne-files";
const ICONS = "mods/workspace-chrome";
const FILTERS = `${MOD}.filters`, TITLES = `${MOD}.titles`, PATHS = `${MOD}.paths`;
const HITS = 200, MENU_ROW = 20;
const zoom = () => Number(settings()?.zoom) || 1;

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
/** A 50% checker dither filling the parent (same as ../nocturne/kit.js). */
function dither(color, cell = 1) {
  const dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr)))).absolute().top(0).left(0).size_full();
}

const stop = (_e, cx) => cx.stop_propagation();
const tilde = (p) => {
  const h = home();
  return !p ? "" : p === h ? "~" : p.startsWith(h + "/") ? "~" + p.slice(h.length) : p;
};

/** A folder's entries, folders first, capped at PER_FOLDER (+1 to tell it was cut). */
async function directory(path, on) {
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  const r = await exec("sh", ["-c", script, "files", path], { on });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    this.on = pr.on ?? null;
    this.slot = pr.slot ?? null;
    // A pane of its own (a folder link, files.open): closes itself, opens files beside itself.
    this.alone = Boolean(pr.path);
    this.filters = (this.slot && shared(FILTERS)?.[this.slot]) || filterDefaults(settings());
    this.query = ""; this.hits = null; this.seq = 0; this.typing = false;
    this.menu = null; this.mouse = { x: 40, y: 40 }; this.size = { width: 400, height: 600 };
    this.input = InputState.new({ placeholder: "filter files" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); this.search(cx); });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.input.on("submit", (_e, cx) => { this.enter(cx); cx.notify(); });
    this.scroll = VirtualListScrollHandle.new();
    this.handle = cx.focus_handle();
    this.reroot(pr.path || pr.folder || home(), cx);
    // Remote folders can't be watched: poll those instead.
    cx.timer.every(this.on ? 15000 : 30000, (cx) => this.refresh(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        cx.notify();
      }
    });
  }

  // ---- the tree

  reroot(folder, cx) {
    this.root = folder;
    this.gen = (this.gen ?? 0) + 1;
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set();
    this.marks = {}; this.ignored = new Set(); this.error = null; this.limited = false; this.sel = null;
    this.watched = null;
    if (this.query) this.clearSearch(cx);
    this.refresh(cx);
  }

  async loadFolder(path, gen) {
    const entries = await directory(path ? `${this.root}/${path}` : this.root, this.on);
    if (gen !== this.gen || (path && !this.folders.has(path))) return;
    const used = [...this.entries].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    const room = Math.max(0, Math.min(PER_FOLDER, TOTAL - used));
    if (entries.length > room) this.limited = true;
    this.entries.set(path, entries.slice(0, room).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
  }

  refresh(cx) {
    if (this.loading) { this.again = true; return; }
    const gen = this.gen, root = this.root, on = this.on;
    this.loading = true;
    this.limited = false;
    cx.spawn(async (cx) => {
      try {
        for (const path of ["", ...this.folders]) {
          if (gen !== this.gen) return;
          await this.loadFolder(path, gen);
        }
        const marks = {};
        let ignored = new Set();
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: root, on }).catch(() => null);
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would fire again.
          const st = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd: root, on }).catch(() => null);
          const base = top.stdout.trim();
          if (st?.code === 0) for (const entry of st.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            const mark = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
            const abs = `${base}/${entry.slice(3)}`;
            marks[abs] = mark;
            // A folder carries a dot when anything under it changed.
            for (let d = parent(abs); d.length > base.length && !(d in marks); d = parent(d)) marks[d] = "•";
          }
          // What git ignores here, relative to the root (an ignored folder once, not its files).
          const ig = await exec("git", ["--no-optional-locks", "ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"], { cwd: root, on }).catch(() => null);
          if (ig?.code === 0) ignored = parseIgnored(ig.stdout);
          this.branch = (await exec("git", ["branch", "--show-current"], { cwd: root, on }).catch(() => null))?.stdout.trim() || null;
        } else this.branch = null;
        if (gen !== this.gen) return;
        this.marks = marks; this.ignored = ignored; this.error = null;
        this.watch(cx);
      } catch (e) { if (gen === this.gen) this.error = String(e?.message ?? e); }
      finally {
        this.loading = false;
        cx.notify();
        if (this.again) { this.again = false; this.refresh(cx); }
      }
    });
  }

  watch(cx) {
    if (this.on || this.watched === this.root) return;
    const root = this.watched = this.root;
    cx.spawn(async (cx) => {
      try { while (this.watched === root) { await watchFolder(root); if (this.watched === root) this.refresh(cx); } }
      catch { if (this.watched === root) this.watched = null; }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const f of [...this.folders]) if (f === path || f.startsWith(path + "/")) { this.folders.delete(f); this.entries.delete(f); }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const gen = this.gen;
        this.pending.add(path);
        cx.spawn(async (cx) => {
          try { await this.loadFolder(path, gen); }
          catch (e) { if (gen === this.gen) this.error = String(e?.message ?? e); }
          finally { this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  /** The visible rows, depth-first: { path, name, dir, depth, ignored }; what
   *  the filters leave out is counted in `this.cut`. */
  rows(prefix = "", depth = 0, out = [], cut = (this.cut = { hidden: 0, ignored: 0 })) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const e of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (!lists(path, this.filters, this.ignored)) {
        if (!this.filters.hidden && isHidden(path)) cut.hidden++;
        else cut.ignored++;
        continue;
      }
      out.push({ path, name: e.name, dir: e.dir, depth, ignored: isIgnored(path, this.ignored) });
      if (e.dir && this.folders.has(path)) this.rows(path, depth + 1, out, cut);
    }
    return out;
  }

  /** What the list shows: the search's hits while there's a query, else the tree. */
  shown() {
    return this.query?.trim() && this.hits ? this.hits : this.rows();
  }

  // ---- filters

  setFilter(name, cx) {
    this.filters = { ...this.filters, [name]: !this.filters[name] };
    if (this.slot) {
      // Kept per pane, by slot; panes that are gone drop out.
      const live = new Set(panes().filter((p) => p.mod === MOD).map((p) => p.props?.slot).filter(Boolean));
      const all = Object.fromEntries(Object.entries(shared(FILTERS) ?? {}).filter(([k]) => live.has(k)));
      setShared(FILTERS, { ...all, [this.slot]: this.filters });
    }
    if (this.query.trim()) this.search(cx);
    cx.notify();
  }

  // ---- search

  /** Hits for the query, under their folders: fff's index of the root
   *  (findFiles); where it can't go (home, /, another machine), the folders
   *  listed so far. */
  search(cx) {
    const q = this.query.trim(), seq = ++this.seq;
    if (!q) { this.hits = null; this.note = null; cx.notify(); return; }
    const root = this.root, keep = (f) => lists(f.path, this.filters, this.ignored);
    const done = (files, note) => {
      if (seq !== this.seq) return;
      this.hits = grouped(files.filter(keep).slice(0, HITS));
      this.note = note;
      const rows = this.hits, i = rows.findIndex((r) => !r.head);
      this.sel = rows[i]?.path ?? null;
      if (i >= 0) this.scroll.scroll_to_item(i);
      cx.notify();
    };
    if (this.on) return done(this.loaded(q), "searching the folders listed so far");
    cx.spawn(async (cx) => {
      try {
        const r = await findFiles(root, q, { limit: HITS });
        if (seq !== this.seq || root !== this.root) return;
        done(r.files, r.scanning ? "indexing the folder… (hits grow)" : null);
        if (r.scanning) cx.timer.after(800, (cx) => { if (seq === this.seq) this.search(cx); });
      } catch { done(this.loaded(q), "searching the folders listed so far"); }
    });
  }

  /** Files listed so far that match `q` fuzzily, closest first. */
  loaded(q) {
    const out = [];
    for (const [prefix, entries] of this.entries) for (const e of entries) {
      if (e.dir) continue;
      const path = prefix ? `${prefix}/${e.name}` : e.name, ranges = fuzzy(q, path);
      if (ranges) out.push({ path, ranges });
    }
    const spread = (f) => f.ranges.length * 100 + f.path.length;
    return out.sort((a, b) => spread(a) - spread(b));
  }

  clearSearch(cx) {
    this.query = ""; this.hits = null; this.note = null; this.seq++;
    this.input.set_value("");
    this.handle.focus();
    cx?.notify();
  }

  /** Shows a folder from the hits in the tree: the search ends, it unfolds there. */
  reveal(path, cx) {
    this.clearSearch(cx);
    const parts = path.split("/");
    for (let n = 1; n <= parts.length; n++) {
      const p = parts.slice(0, n).join("/");
      if (!this.folders.has(p)) this.toggle(p, cx);
    }
    this.want = path;
  }

  /** Enter: a hit opens (a folder shows in the tree); in the tree, a file opens and a folder folds. */
  enter(cx) {
    const row = this.shown().find((r) => r.path === this.sel);
    if (!row) return;
    if (row.head) this.reveal(row.path, cx);
    else if (row.dir) this.toggle(row.path, cx);
    else this.openFile(row.path, cx);
  }

  // ---- the editor

  /** This copy's own pane (found by its slot). */
  me() {
    return this.slot ? panes().find((p) => p.mod === MOD && p.props?.slot === this.slot) ?? null : null;
  }

  /** The shown tab, and the editor pane this panel opened there (nocturne-edit's terminal). */
  editorPane() {
    const tab = spaces().find((s) => s.active)?.tabs.find((c) => c.active)?.id;
    const ours = new Set(terminals().filter((x) => isEdit(x.argv?.[0])).map((x) => x.address));
    return { tab, pane: panes().find((p) => p.tab === tab && p.terminal && ours.has(p.terminal)) ?? null };
  }

  /** Where files open: beside a pane of its own; from the panel, beside the tab's first other pane. */
  beside() {
    if (this.alone) { const me = this.me(); if (me) return me; }
    const tab = spaces().find((s) => s.active)?.tabs.find((c) => c.active)?.id;
    return panes().find((p) => p.tab === tab && p.mod !== MOD && !p.parked)
      ?? panes().find((p) => p.tab === tab && p.mod === MOD);
  }

  /** Edits a file (relative to the root) in the app's editor (nocturne-editor),
   *  beside this tab's other panes; a folder, or a file on another machine, in
   *  $EDITOR (terminalEdit). */
  edit(path, cx) {
    const row = this.shown().find((r) => r.path === path);
    if (this.on || !path || row?.dir) return this.terminalEdit(path, cx);
    const beside = this.beside();
    run("editor.open", { path: `${this.root}/${path}`, ...(beside ? { pane: beside.pane } : {}) });
  }

  /** Opens a file or folder (relative to the root; "" is the root) in $EDITOR: in this
   *  tab's nvim when it is listening, else in a new terminal pane to this one's left. */
  terminalEdit(path, cx) {
    const abs = path ? `${this.root}/${path}` : this.root;
    const { tab, pane } = this.editorPane();
    // One socket per tab; ids from other machines carry a "machine/" prefix.
    const key = String(tab ?? "default").replace(/[^A-Za-z0-9_-]/g, "_");
    // Left of this pane: the files column stays on the tab's right edge.
    const self = this.me() ?? panes().find((p) => p.tab === tab && p.mod === MOD);
    const open = () => run("terminal.open", { argv: [editTool(this.on), "--listen", key, abs], folder: this.root, place: "left", ...(self ? { pane: self.pane } : {}) });
    if (!pane) return open();
    cx.spawn(async () => {
      const r = await exec(editTool(this.on), ["--remote", key, abs], { cwd: this.root, on: this.on }).catch(() => null);
      if (r?.code === 0) run("pane.focus", { pane: pane.pane });
      else open();
    });
  }

  /** Neovim (the one on PATH) in a new terminal beside: on a file, in its
   *  folder; on a folder (or the root), `nvim .` there. */
  nvim(row) {
    const path = row?.path ?? "";
    const { argv, folder } = nvimLaunch(path ? `${this.root}/${path}` : this.root, !path || row.dir);
    const self = this.me() ?? (this.alone ? null : panes().find((p) => p.tab === this.editorPane().tab && p.mod === MOD));
    run("terminal.open", { argv, folder, place: this.alone ? "auto" : "left", ...(self ? { pane: self.pane } : {}) });
  }

  /** A folder (relative to the root) in a new files pane of its own. */
  openPane(path) {
    const beside = this.beside();
    run("files.open", { path: path ? `${this.root}/${path}` : this.root, ...(beside ? { pane: beside.pane } : {}), ...(this.on ? { on: this.on } : {}) });
  }

  copy(path, cx) {
    const abs = path ? `${this.root}/${path}` : this.root;
    cx.write_to_clipboard(this.on ? `${this.on}:${abs}` : abs);
    const at = this.copied = Date.now();
    cx.timer.after(1400, (cx) => { if (this.copied === at) { this.copied = 0; cx.notify(); } });
  }

  close() {
    const me = this.me();
    if (me) run("pane.close", { pane: me.pane });
  }

  /** Opens a file: one the app has a viewer for (Markdown, pictures) in that
   *  viewer, beside this tab's editor or its first other pane (else this one);
   *  anything else in the editor. `other` (alt-click, `e`): Markdown as text in
   *  the editor, a picture in the system's app. */
  openFile(path, cx, other) {
    const viewer = viewerFor(path);
    const abs = `${this.root}/${path}`, on = this.on ? { on: this.on } : {};
    if (!viewer || (other && viewer.other === "edit")) return this.edit(path, cx);
    if (other) return run(viewer.open, { path: abs, in: "system", ...on });
    const beside = (this.alone && this.me()) || this.editorPane().pane || this.beside();
    run(viewer.open, { path: abs, ...(beside ? { pane: beside.pane } : {}), ...on });
  }

  /** Tells the pane header which folder a pane of its own shows, and the app
   *  (files.open finds the pane already on a folder) where it is rooted. */
  publish() {
    if (!this.alone || !this.slot) return;
    const live = new Set(panes().filter((p) => p.mod === MOD).map((p) => p.props?.slot).filter(Boolean));
    const name = this.root === "/" ? "/" : this.root.split("/").pop();
    for (const [key, value] of [[TITLES, name], [PATHS, this.root]]) {
      const was = shared(key) ?? {};
      if (was[this.slot] === value && Object.keys(was).every((k) => live.has(k) || k === this.slot)) continue;
      setShared(key, { ...Object.fromEntries(Object.entries(was).filter(([k]) => live.has(k))), [this.slot]: value });
    }
  }

  // ---- the menu

  openMenu(row, cx) {
    let items = menuItems(row, { pane: this.alone });
    if (!row.path) items = items.filter((x) => x.act !== "toggle" && x.act !== "root");
    if (row.head) items = items.filter((x) => x.act !== "root");
    this.sel = row.path || this.sel;
    this.menu = { row, items, at: { ...this.mouse }, n: 0 };
    this.handle.focus();
    cx?.notify();
  }

  act(act, row, cx) {
    const p = row.path;
    if (act === "toggle") row.head ? this.reveal(p, cx) : this.toggle(p, cx);
    else if (act === "pane") this.openPane(p);
    else if (act === "root") this.reroot(p ? `${this.root}/${p}` : this.root, cx);
    else if (act === "edit") this.edit(p, cx);
    else if (act === "nvim") this.nvim(row);
    else if (act === "open") this.openFile(p, cx);
    else if (act === "other") viewerFor(p)?.other === "system" ? this.openFile(p, cx, true) : this.edit(p, cx);
    else if (act === "terminal") this.terminalEdit(p, cx);
    else if (act === "copy") this.copy(p, cx);
    else if (act === "close") this.close();
  }

  menuKey(e, cx) {
    const m = this.menu, k = e.key, shift = e.modifiers?.shift;
    const char = shift && /^[a-z]$/.test(k) ? k.toUpperCase() : k;
    if (k === "escape" || k === "m") this.menu = null;
    else if (k === "j" || k === "down") m.n = Math.min(m.items.length - 1, m.n + 1);
    else if (k === "k" || k === "up") m.n = Math.max(0, m.n - 1);
    else if (k === "enter") { this.menu = null; this.act(m.items[m.n].act, m.row, cx); }
    else {
      const it = m.items.find((x) => x.key === char && x.key !== "enter");
      if (!it) return;
      this.menu = null;
      this.act(it.act, m.row, cx);
    }
    cx.stop_propagation();
    cx.notify();
  }

  // ---- input

  select(rows, i) {
    if (!rows.length) return;
    const n = Math.max(0, Math.min(rows.length - 1, i));
    this.sel = rows[n].path;
    this.scroll.scroll_to_item(n);
  }

  /** One step through the hits while typing (folder lines skipped). */
  step(d) {
    const rows = this.shown();
    let i = rows.findIndex((r) => r.path === this.sel);
    do i += d; while (rows[i]?.head);
    if (rows[i]) this.select(rows, i);
  }

  pick(path, cx) {
    const rows = this.shown(), row = rows.find((r) => r.path === path);
    if (!row) return;
    const now = Date.now(), again = this.lastClick?.path === path && now - this.lastClick.at < 400;
    this.lastClick = { path, at: now };
    this.sel = path;
    this.handle.focus();
    if (row.head) this.reveal(path, cx);
    else if (!row.dir) this.openFile(path, cx, this.alt);
    else if (again) { this.toggle(path, cx); this.edit(path, cx); } // undo the first click's fold
    else this.toggle(path, cx);
    cx.notify();
  }

  key(e, cx) {
    if (this.menu) return this.menuKey(e, cx);
    const k = e.key, m = e.modifiers ?? {};
    if (this.typing) {
      // Typing goes to the filter; these steer the hits (enter is the input's submit).
      if (k === "escape") this.clearSearch(cx);
      else if (k === "down" || (m.control && k === "n")) this.step(1);
      else if (k === "up" || (m.control && k === "p")) this.step(-1);
      else if (k === "tab") this.handle.focus();
      else return;
      cx.stop_propagation();
      cx.notify();
      return;
    }
    if (m.platform || m.control || m.alt) return;
    const upper = m.shift || /^[A-Z]$/.test(k), low = k.toLowerCase();
    const rows = this.shown(), i = rows.findIndex((r) => r.path === this.sel), row = rows[i];
    if (low === "h" && upper) this.setFilter("hidden", cx);
    else if (low === "i" && upper) this.setFilter("ignored", cx);
    else if (k === "/") this.input.focus();
    else if (k === "escape") { if (this.query) this.clearSearch(cx); else if (this.alone) this.close(); else return; }
    else if (k === "q" && this.alone) this.close();
    else if (k === "j" || k === "down") this.select(rows, i + 1);
    else if (k === "k" || k === "up") this.select(rows, i < 0 ? 0 : i - 1);
    else if (low === "g" && upper) { this.select(rows, rows.length - 1); this.gAt = 0; }
    else if (k === "g") {
      if (Date.now() - (this.gAt ?? 0) < 500) { this.gAt = 0; this.select(rows, 0); }
      else this.gAt = Date.now();
    } else if ((k === "l" || k === "right" || k === "enter") && row?.head) this.reveal(row.path, cx);
    else if ((k === "l" || k === "right") && row) {
      if (!row.dir) this.openFile(row.path, cx);
      else if (!this.folders.has(row.path)) this.toggle(row.path, cx);
      else this.select(rows, i + 1);
    } else if ((k === "h" || k === "left") && row && !row.hit) {
      if (row.dir && this.folders.has(row.path)) this.toggle(row.path, cx);
      else if (row.depth > 0) this.select(rows, rows.findIndex((r) => r.path === parent(row.path)));
    } else if (k === "enter" && row) row.dir ? this.toggle(row.path, cx) : this.openFile(row.path, cx);
    else if (k === "E" || (low === "e" && m.shift)) this.terminalEdit(row?.path ?? "", cx);
    else if (k === "e") row && !row.dir && viewerFor(row.path)?.other === "system" ? this.openFile(row.path, cx, true) : this.edit(row?.path ?? "", cx);
    else if (k === "v") this.nvim(row ?? null);
    else if (k === "o") this.openPane(row?.dir ? row.path : "");
    else if (k === "y") this.copy(row?.path ?? "", cx);
    else if (k === "m") this.openMenu(row ?? { path: "", name: this.root, dir: true }, cx);
    else if (k === "-") { const from = this.root; this.reroot(parent(this.root), cx); this.pendingSel = from; }
    else if (k === "." && row) {
      const into = row.dir ? row.path : row.path.includes("/") ? parent(row.path) : "";
      if (into) this.reroot(`${this.root}/${into}`, cx);
    }
    else if (k === "r") this.refresh(cx);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // ---- parts

  chip(t, id, label, action) {
    return h_flex().id(id).relative().h(20).px(6).flex_none().items_center()
      .text_color(t.muted).hover((s) => s.text_color(t.foreground))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { action(cx); cx.notify(); })
      .child(div().relative().child(label));
  }

  toolbar(t, w) {
    const changed = Object.values(this.marks).filter((m) => m !== "•").length;
    const name = this.root === "/" ? "/" : this.root.split("/").pop();
    return h_flex().id("nf-toolbar").relative().h(34).flex_none().px(10).gap(8).items_center().text_size(11)
      .when(w >= 300, (el) => el.child(div().flex_none().text_color(t.ansi8).child("FILES")))
      .child(this.chip(t, "nf-up", "‹", (cx) => this.key({ key: "-" }, cx)))
      .child(h_flex().flex_1().min_w(0).gap(6).items_baseline()
        .child(div().flex_none().max_w_full().truncate().text_color(t.foreground).child(name))
        .when(w >= 360, (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(tilde(parent(this.root))))))
      .when(Boolean(this.branch) && w >= 260, (el) => el.child(div().flex_none().max_w(140).truncate().text_color(t.ansi2).child(this.branch)))
      .when(changed > 0, (el) => el.child(div().flex_none().text_color(t.ansi3).child(`±${changed}`)))
      .child(this.chip(t, "nf-edit", "edit", (cx) => this.edit("", cx)))
      .when(this.alone, (el) => el.child(h_flex().id("nf-close").relative().size(20).flex_none().items_center().justify_center()
        .text_color(t.muted).hover((s) => s.text_color(t.foreground))
        .on_mouse_down("left", stop)
        .on_click(() => this.close())
        .child(svg(`${ICONS}/x.svg`).size(12))))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
  }

  /** A filter's switch: an open eye while that kind is listed; a shut one,
   *  the label struck through and how many it leaves out, while it's hidden. */
  filterChip(t, id, label, on, cut, action) {
    return h_flex().id(id).relative().h(20).px(4).gap(4).flex_none().items_center()
      .hover((s) => s.bg(t.ansi0 + "55"))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => action(cx))
      .child(svg(on ? `${ICONS}/eye.svg` : `mods/${MOD}/eye-off.svg`).relative().size(11).flex_none().text_color(on ? t.dim : t.ansi3))
      .child(div().relative().text_color(t.muted).when(!on, (el) => el.line_through()).child(label))
      .when(!on && cut > 0, (el) => el.child(div().relative().text_color(t.ansi3).child(String(cut))));
  }

  /** The line under the toolbar: the filter as you type, and the two switches. */
  lens(t, w, found) {
    const live = this.typing || Boolean(this.query);
    const cut = this.cut ?? { hidden: 0, ignored: 0 };
    return h_flex().id("nf-lens").relative().h(26).flex_none().pl(10).pr(6).gap(6).items_center().text_size(11)
      .child(svg(`${ICONS}/search.svg`).relative().size(11).flex_none().text_color(this.typing ? t.accent : t.dim))
      .child(h_flex().id("nf-find").relative().flex_1().min_w(0).h_full().items_center()
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.input.focus(); })
        .child(live
          ? Input.new(this.input).flex_1().h_full().text_size(11).text_color(t.foreground)
          : h_flex().gap(5).text_color(t.dim)
            .child(div().text_color(t.accent).child("/"))
            .child(div().truncate().child(w >= 240 ? "filter files" : "filter"))))
      .when(Boolean(this.query.trim()), (el) => el.child(div().flex_none().text_color(t.dim).child(`${found}`)))
      .child(this.filterChip(t, "nf-hidden", w >= 250 ? "dotfiles" : ".*", this.filters.hidden, cut.hidden, (cx) => this.setFilter("hidden", cx)))
      .child(this.filterChip(t, "nf-ignored", w >= 250 ? "ignored" : "ign", this.filters.ignored, cut.ignored, (cx) => this.setFilter("ignored", cx)))
      .child(div().absolute().left(0).right(0).bottom(0).h(1).child(dither(t.ansi0, 1)));
  }

  /** Text with the matched characters in the accent. */
  matched(t, id, text, ranges, color) {
    return h_flex().relative().flex_1().min_w(0).overflow_hidden()
      .children(marks(text, ranges).map(([piece, hit], j) => div().id(`${id}-${j}`).flex_none().text_color(hit ? t.accent : color).child(piece)));
  }

  row(t, r, focused) {
    const sel = r.path === this.sel, open = r.dir && this.folders.has(r.path);
    const mark = r.hit ? r.git && MARK[r.git] ? r.git : null : this.marks[`${this.root}/${r.path}`];
    const hidden = r.name.startsWith(".");
    const color = sel ? t.foreground : mark && mark !== "•" ? t[MARK[mark]] : hidden || r.ignored ? t.dim : r.dir ? t.foreground : t.muted;
    return h_flex().id(`nf-${r.path}`).relative().h(ROW).w_full().pl(8 + r.depth * 14).pr(10).gap(6).items_center()
      .hover((s) => s.bg(t.ansi0 + "55"))
      .when(sel, (el) => el.child(dither(focused ? t.ansi0 : t.ansi0 + "88", 1))
        .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(focused ? t.accent : t.ansi8)))
      // Indent guides: one dotted rule per level.
      .children(Array.from({ length: r.depth }, (_, d) => div().absolute().top(0).bottom(0).left(14 + d * 14).w(1).opacity(0.5).child(dither(t.ansi0, 1))))
      .child(r.head ? div().w(10).flex_none() : r.dir ? svg(`mods/files/chevron-${open ? "down" : "right"}.svg`).relative().size(10).flex_none().text_color(t.dim) : div().w(10).flex_none())
      .child(svg(`mods/files/${r.dir ? "folder" : "file"}.svg`).relative().size(12).flex_none()
        .text_color(r.dir ? (open ? t.accent : t.ansi4) : t.dim))
      .child(r.hit ? this.matched(t, `nf-m-${r.path}`, r.name, r.ranges, color)
        : div().relative().flex_1().min_w(0).truncate().text_color(r.head ? t.dim : color).child(r.name))
      .when(Boolean(mark), (el) => el.child(div().relative().flex_none().w(8).text_color(mark === "•" ? t.ansi3 : t[MARK[mark]]).child(mark)));
  }

  menuBox(t) {
    const m = this.menu, w = Math.min(240, this.size.width - 16);
    const h = m.items.length * MENU_ROW + 20;
    // The key column fits its widest key on one line (7 px a character at size 11, as nocturne-git's menus).
    const keyW = keyColumn(m.items);
    const x = Math.max(8, Math.min(m.at.x, this.size.width - w - 8)), y = Math.max(8, Math.min(m.at.y, this.size.height - h - 8));
    const edge = (where) => h_flex().absolute().left(0).right(0).h(13).items_center().text_size(11)
      .when(where === "top", (el) => el.top(-6)).when(where === "bottom", (el) => el.bottom(-6))
      .child(div().h(1).w(8).flex_none().bg(t.accent))
      .when(where === "top", (el) => el.child(div().flex_shrink(1).min_w(0).px(4).truncate().text_color(t.foreground).child(m.row.path ? m.row.name.split("/").pop() : tilde(this.root))))
      .child(div().h(1).flex_1().min_w(8).bg(t.accent));
    const rows = m.items.map((it, i) => h_flex().id(`nf-mi-${i}`).relative().h(MENU_ROW).px(10).gap(10).items_center().text_size(11)
      .hover((s) => s.bg(t.ansi0 + "66"))
      .on_mouse_move((_e, cx) => { if (m.n !== i) { m.n = i; cx.notify(); } })
      .on_click((_e, cx) => { cx.stop_propagation(); this.menu = null; this.act(it.act, m.row, cx); cx.notify(); })
      .when(i === m.n, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
      .child(div().relative().w(keyW).min_w(keyW).flex_none().overflow_hidden().text_color(t.accent).child(it.key))
      .child(div().relative().flex_1().min_w(0).truncate().text_color(i === m.n ? t.foreground : t.muted).child(it.label)));
    return div().id("nf-menu-layer").absolute().inset_0()
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.menu = null; cx.notify(); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu = null; cx.notify(); })
      .child(v_flex().id("nf-menu").absolute().left(x).top(y).w(w).pt(10).pb(6).bg(t.background).border_l(1).border_r(1).border_color(t.accent)
        .on_mouse_down("left", stop)
        .children(rows)
        .child(edge("top")).child(edge("bottom")));
  }

  empty(t, title, hint) {
    return v_flex().flex_1().min_h(0).items_center().justify_center().gap(10).px(16).text_size(11)
      .child(svg(`${ART}/moon-8.svg`).w(44).h(44).text_color(t.ansi8).opacity(0.6))
      .child(div().text_color(t.foreground).child(title))
      .when(Boolean(hint), (el) => el.child(div().text_center().text_color(t.ansi8).child(hint)));
  }

  render() {
    const t = theme();
    const rows = this.shown();
    this.publish();
    if (this.pendingSel && rows.length) {
      const back = this.pendingSel.startsWith(this.root + "/") ? this.pendingSel.slice(this.root.length + 1).split("/")[0] : null;
      this.pendingSel = null;
      if (back) { const i = rows.findIndex((r) => r.path === back); if (i >= 0) this.select(rows, i); }
    }
    if (this.want) { const i = rows.findIndex((r) => r.path === this.want); if (i >= 0) { this.want = null; this.select(rows, i); } }
    if (this.sel && !this.want && !rows.some((r) => r.path === this.sel)) this.sel = null;
    const focused = this.handle.is_focused() || this.typing;
    const w = this.size.width;
    const searching = Boolean(this.query.trim());
    let body;
    if (searching && this.hits && !rows.length) body = this.empty(t, "No files match", this.note ?? `“${this.query.trim()}” under ${tilde(this.root)}`);
    else if (searching && !this.hits) body = this.empty(t, "Searching…", null);
    else if (this.error && !rows.length) body = this.empty(t, "Can't read this folder", this.error);
    else if (!rows.length) body = this.empty(t, this.loading ? "Listing files…" : "Nothing here", this.loading ? null : tilde(this.root));
    else body = div().id("nf-tree").relative().flex_1().min_h(0).py(4).text_size(12)
      .child(v_virtual_list("nf-rows", rows.length, ROW, (i) => rows[i].path,
        (range) => rows.slice(range.start, range.end).map((r) => this.row(t, r, focused)))
        .on_item_click((path, cx) => this.pick(path, cx))
        // The pane's own right press comes after this and opens the menu for the row.
        .on_item_secondary_click((path) => { this.pressed = rows.find((r) => r.path === path) ?? null; })
        .size_full().track_scroll(this.scroll))
      .child(Scrollbar.vertical("nf-rows").absolute().inset_0());
    const foot = this.copied ? "path copied" : searching && this.note ? this.note
      : this.limited ? `Listing cut at ${PER_FOLDER} per folder, ${TOTAL} in all` : null;
    return v_flex().id("nocturne-files").relative().size_full().bg(t.background).text_color(t.foreground).track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      // A row's click comes after this: alt-click opens a Markdown file as text.
      .on_mouse_down("left", (e) => { this.alt = Boolean(e?.modifiers?.alt); this.handle.focus(); })
      .on_mouse_down("right", (e, cx) => {
        if (e?.local_position) this.mouse = { x: e.local_position.x / zoom(), y: e.local_position.y / zoom() };
        const row = this.pressed ?? { path: "", name: this.root, dir: true };
        this.pressed = null;
        this.openMenu(row, cx);
      })
      .on_mouse_move((e) => { if (e.local_position) this.mouse = { x: e.local_position.x / zoom(), y: e.local_position.y / zoom() }; })
      .on_size_change((size, cx) => {
        const s = { width: size.width / zoom(), height: size.height / zoom() };
        if (Math.abs(s.width - this.size.width) > 1 || Math.abs(s.height - this.size.height) > 1) { this.size = s; cx.notify(); }
      })
      .child(this.toolbar(t, w))
      .child(this.lens(t, w, rows.filter((r) => !r.head).length))
      .child(body)
      .when(Boolean(foot), (el) => el.child(div().flex_none().px(10).py(4).text_size(10).text_color(t.dim).border_t(1).border_color(t.ansi0).child(foot)))
      .when(Boolean(this.menu), (el) => el.child(this.menuBox(t)));
  }
}
