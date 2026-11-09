// Nocturne files: a folder's tree in a pane, in Nocturne's 1-bit look, that
// hands what you pick to $EDITOR. Herdr's shipped files mod, reworked: the
// same lazy listing, folder watch and git marks (a mod can't import another
// mod's files, so it isn't wrapped), but rooted where it was opened instead
// of following focus, and opening files in the editor instead of a preview.
// Opened from Nocturne's "+ new" > Files (or cmd-e) with props { folder, on }.
//
// The editor runs through this mod's bin/nocturne-edit (on another
// machine: `nocturne-edit` from its PATH) in a
// terminal pane beside this one. With nvim it listens on a socket per tab,
// so later picks open in that same nvim instead of a new pane.
//
// Click a file: edit it. Click a folder: fold it; click it again quickly:
// edit the folder. Keys while it has focus:
//   j / k  ↓ ↑     move                 l →  unfold, or edit a file
//   h ←            fold, or go to the parent row
//   enter          edit a file, fold a folder    e  edit what's selected
//   -              root one folder up            .  root at the selected folder
//   gg / G         top / bottom                  r  refresh

import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar, VirtualListScrollHandle } from "gpui-base";
import { props, theme, settings, exec, run, panes, spaces, terminals, watchFolder, nextCommand, home, appHome, window as appWindow } from "herdr";

const ROW = 22;
const PER_FOLDER = 500, TOTAL = 5000;
const EDIT = "nocturne-edit";
/** The editor wrapper: the one this mod ships, here; another machine's own. */
const editTool = (on) => (on ? EDIT : `${appHome()}/mods/nocturne-files/bin/${EDIT}`);
const isEdit = (argv0) => argv0 === EDIT || Boolean(argv0?.endsWith(`/${EDIT}`));
// Git status letter → theme color.
const MARK = { A: "ansi2", M: "ansi3", D: "ansi1", U: "ansi1" };
const ART = "mods/nocturne/art";

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
/** A 50% checker dither filling the parent (same as ../nocturne/kit.js). */
function dither(color, cell = 1) {
  const zoom = Number(settings()?.zoom) || 1, dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}

const stop = (_e, cx) => cx.stop_propagation();
const parent = (p) => p.replace(/\/[^/]+$/, "") || "/";
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
    this.scroll = VirtualListScrollHandle.new();
    this.handle = cx.focus_handle();
    this.reroot(pr.folder || home(), cx);
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
    this.marks = {}; this.error = null; this.limited = false; this.sel = null;
    this.watched = null;
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
          this.branch = (await exec("git", ["branch", "--show-current"], { cwd: root, on }).catch(() => null))?.stdout.trim() || null;
        } else this.branch = null;
        if (gen !== this.gen) return;
        this.marks = marks; this.error = null;
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

  /** The visible rows, depth-first: { path, name, dir, depth }. */
  rows(prefix = "", depth = 0, out = []) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const e of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      out.push({ path, name: e.name, dir: e.dir, depth });
      if (e.dir && this.folders.has(path)) this.rows(path, depth + 1, out);
    }
    return out;
  }

  // ---- the editor

  /** The shown tab, and the editor pane this panel opened there (nocturne-edit's terminal). */
  editorPane() {
    const tab = spaces().find((s) => s.active)?.tabs.find((c) => c.active)?.id;
    const ours = new Set(terminals().filter((x) => isEdit(x.argv?.[0])).map((x) => x.address));
    return { tab, pane: panes().find((p) => p.tab === tab && p.terminal && ours.has(p.terminal)) ?? null };
  }

  /** Opens a file or folder (relative to the root; "" is the root) in $EDITOR: in this
   *  tab's nvim when it is listening, else in a new terminal pane to this one's left. */
  edit(path, cx) {
    const abs = path ? `${this.root}/${path}` : this.root;
    const { tab, pane } = this.editorPane();
    // One socket per tab; ids from other machines carry a "machine/" prefix.
    const key = String(tab ?? "default").replace(/[^A-Za-z0-9_-]/g, "_");
    // Left of this pane: the files column stays on the tab's right edge.
    const self = panes().find((p) => p.tab === tab && p.mod === "nocturne-files");
    const open = () => run("terminal.open", { argv: [editTool(this.on), "--listen", key, abs], folder: this.root, place: "left", ...(self ? { pane: self.pane } : {}) });
    if (!pane) return open();
    cx.spawn(async () => {
      const r = await exec(editTool(this.on), ["--remote", key, abs], { cwd: this.root, on: this.on }).catch(() => null);
      if (r?.code === 0) run("pane.focus", { pane: pane.pane });
      else open();
    });
  }

  // ---- input

  select(rows, i) {
    if (!rows.length) return;
    const n = Math.max(0, Math.min(rows.length - 1, i));
    this.sel = rows[n].path;
    this.scroll.scroll_to_item(n);
  }

  pick(path, cx) {
    const rows = this.rows(), row = rows.find((r) => r.path === path);
    if (!row) return;
    const now = Date.now(), again = this.lastClick?.path === path && now - this.lastClick.at < 400;
    this.lastClick = { path, at: now };
    this.sel = path;
    this.handle.focus();
    if (!row.dir) this.edit(path, cx);
    else if (again) { this.toggle(path, cx); this.edit(path, cx); } // undo the first click's fold
    else this.toggle(path, cx);
    cx.notify();
  }

  key(e, cx) {
    const k = e.key, m = e.modifiers ?? {};
    if (m.platform || m.control || m.alt) return;
    const upper = m.shift || /^[A-Z]$/.test(k), low = k.toLowerCase();
    const rows = this.rows(), i = rows.findIndex((r) => r.path === this.sel), row = rows[i];
    if (k === "j" || k === "down") this.select(rows, i + 1);
    else if (k === "k" || k === "up") this.select(rows, i < 0 ? 0 : i - 1);
    else if (low === "g" && upper) { this.select(rows, rows.length - 1); this.gAt = 0; }
    else if (k === "g") {
      if (Date.now() - (this.gAt ?? 0) < 500) { this.gAt = 0; this.select(rows, 0); }
      else this.gAt = Date.now();
    } else if ((k === "l" || k === "right") && row) {
      if (!row.dir) this.edit(row.path, cx);
      else if (!this.folders.has(row.path)) this.toggle(row.path, cx);
      else this.select(rows, i + 1);
    } else if ((k === "h" || k === "left") && row) {
      if (row.dir && this.folders.has(row.path)) this.toggle(row.path, cx);
      else if (row.depth > 0) this.select(rows, rows.findIndex((r) => r.path === parent(row.path)));
    } else if (k === "enter" && row) row.dir ? this.toggle(row.path, cx) : this.edit(row.path, cx);
    else if (k === "e") this.edit(row?.path ?? "", cx);
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

  toolbar(t, rows, w) {
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
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
  }

  row(t, r, focused) {
    const sel = r.path === this.sel, open = r.dir && this.folders.has(r.path);
    const mark = this.marks[`${this.root}/${r.path}`];
    const hidden = r.name.startsWith(".");
    return h_flex().id(`nf-${r.path}`).relative().h(ROW).w_full().pl(8 + r.depth * 14).pr(10).gap(6).items_center()
      .hover((s) => s.bg(t.ansi0 + "55"))
      .when(sel, (el) => el.child(dither(focused ? t.ansi0 : t.ansi0 + "88", 1))
        .child(div().absolute().left(0).top(0).bottom(0).w(2).bg(focused ? t.accent : t.ansi8)))
      // Indent guides: one dotted rule per level.
      .children(Array.from({ length: r.depth }, (_, d) => div().absolute().top(0).bottom(0).left(14 + d * 14).w(1).opacity(0.5).child(dither(t.ansi0, 1))))
      .child(r.dir ? svg(`mods/files/chevron-${open ? "down" : "right"}.svg`).relative().size(10).flex_none().text_color(t.dim) : div().w(10).flex_none())
      .child(svg(`mods/files/${r.dir ? "folder" : "file"}.svg`).relative().size(12).flex_none()
        .text_color(r.dir ? (open ? t.accent : t.ansi4) : t.dim))
      .child(div().relative().flex_1().min_w(0).truncate()
        .text_color(sel ? t.foreground : mark && mark !== "•" ? t[MARK[mark]] : hidden ? t.dim : r.dir ? t.foreground : t.muted)
        .child(r.name))
      .when(Boolean(mark), (el) => el.child(div().relative().flex_none().w(8).text_color(mark === "•" ? t.ansi3 : t[MARK[mark]]).child(mark)));
  }

  empty(t, title, hint) {
    return v_flex().flex_1().min_h(0).items_center().justify_center().gap(10).px(16).text_size(11)
      .child(svg(`${ART}/moon-8.svg`).w(44).h(44).text_color(t.ansi8).opacity(0.6))
      .child(div().text_color(t.foreground).child(title))
      .when(Boolean(hint), (el) => el.child(div().text_center().text_color(t.ansi8).child(hint)));
  }

  render() {
    const t = theme();
    const rows = this.rows();
    if (this.pendingSel && rows.length) {
      const back = this.pendingSel.startsWith(this.root + "/") ? this.pendingSel.slice(this.root.length + 1).split("/")[0] : null;
      this.pendingSel = null;
      if (back) { const i = rows.findIndex((r) => r.path === back); if (i >= 0) this.select(rows, i); }
    }
    if (this.sel && !rows.some((r) => r.path === this.sel)) this.sel = null;
    const focused = this.handle.is_focused();
    const w = this.width ?? 400;
    let body;
    if (this.error && !rows.length) body = this.empty(t, "Can't read this folder", this.error);
    else if (!rows.length) body = this.empty(t, this.loading ? "Listing files…" : "Nothing here", this.loading ? null : tilde(this.root));
    else body = div().id("nf-tree").relative().flex_1().min_h(0).py(4).text_size(12)
      .child(v_virtual_list("nf-rows", rows.length, ROW, (i) => rows[i].path,
        (range) => rows.slice(range.start, range.end).map((r) => this.row(t, r, focused)))
        .on_item_click((path, cx) => this.pick(path, cx))
        .size_full().track_scroll(this.scroll))
      .child(Scrollbar.vertical("nf-rows").absolute().inset_0());
    return v_flex().id("nocturne-files").size_full().bg(t.background).text_color(t.foreground).track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => this.handle.focus())
      .on_size_change((size, cx) => { if (Math.abs(size.width - (this.width ?? 0)) > 1) { this.width = size.width; cx.notify(); } })
      .child(this.toolbar(t, rows, w))
      .child(body)
      .when(this.limited, (el) => el.child(div().flex_none().px(10).py(4).text_size(10).text_color(t.dim).border_t(1).border_color(t.ansi0)
        .child(`Listing cut at ${PER_FOLDER} per folder, ${TOTAL} in all`)));
  }
}
