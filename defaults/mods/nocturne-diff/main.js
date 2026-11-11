// Nocturne diff: a repo's changes in a pane beside the agent that made them.
// Files (status letter, size, a reviewed box) and the chosen file's unified
// diff. Two scopes: uncommitted work, or the whole branch since it left its
// base. Tests, config, assets and docs can be hidden to leave the business
// code. In wide panes the file list's edge drags.
// Opened from the Nocturne tab strip with props { folder, on }. With
// { pr, repo } (the GitHub window's `d`) it starts on a third scope, that pull
// request's diff from `gh pr diff`; with { back } too it sits in the GitHub
// window's place, and esc puts that window back.
//
// It fits its pane: from SPLIT wide, list and diff side by side; narrower,
// one at a time (the diff, with ‹ › and a files button); under SHORT high,
// tighter bars.
//
// Keys while it has focus, lazygit's way (? lists them, the bottom bar
// shows the ones that matter now):
//   j k ↓ ↑        next / previous file     g G < > home end  first / last
//   , .            a page of files          J K pgdn pgup     scroll the diff
//   space          mark reviewed, go to the next unreviewed
//   a              mark every file reviewed (again: none)
//   enter          the diff (narrow)        esc / f           back to the files (narrow)
//   [ ] s          switch scope             r R               refresh

import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex, h_resizable, resizable_panel, Scrollbar, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { props, theme, settings, shared, setShared, watchFolder, nextCommand, openOverlay, highlight, window as appWindow } from "herdr";
import { repo, changes, prChanges } from "./git.js";
import { KINDS, kind } from "./kinds.js";

const MARKS = "nocturne-diff.reviewed";
const HIDE = "nocturne-diff.hide";
const STATUS = { added: ["A", "ansi2"], modified: ["M", "ansi3"], deleted: ["D", "ansi1"], renamed: ["R", "ansi4"], untracked: ["U", "ansi5"] };
// Width tiers (logical px) and the short-height line.
const SPLIT = 560, ROOMY = 760, TIGHT = 440, SHORT = 320;

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
function dither(color, cell = 1) {
  const zoom = Number(settings()?.zoom) || 1, dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom * dpr)))).absolute().top(0).left(0).size_full();
}

const stop = (_e, cx) => cx.stop_propagation();

export default class Diff extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    this.folder = pr.folder;
    this.on = pr.on ?? null;
    this.pr = pr.pr ?? null; // a pull request number: the "pr" scope
    this.prRepo = pr.repo ?? null; // "owner/name" of that PR's repo (the GitHub window's)
    this.back = pr.back ?? null; // { mod, props }: the window to put back on esc
    this.overlay = pr.overlay ?? null;
    this.scope = this.pr ? "pr" : "work";
    this.state = "loading";
    this.files = [];
    this.sel = null;
    this.view = "file"; // narrow panes: "file" (the diff) or "list"
    this.size = { width: 800, height: 600 };
    this.handle = cx.focus_handle();
    // Scroll positions the keyboard drives: the file list (kept on the
    // selection) and the diff (J / K move its top line).
    this.listScroll = VirtualListScrollHandle.new();
    this.diffScroll = VirtualListScrollHandle.new();
    this.diffAt = 0;
    this.help = false;
    // In a window (the GitHub window's place) nothing hands over the keyboard;
    // and it says it holds that window, so cmd-shift-g closes it.
    if (this.overlay) for (const ms of [0, 60, 250, 600]) cx.timer.after(ms, () => this.handle.focus());
    if (this.overlay && this.back) {
      const hold = () => setShared("nocturne-github.window", { id: this.overlay, beat: Date.now() });
      hold();
      cx.timer.every(4000, hold);
    }
    this.load(cx);
    // Remote folders can't be watched: poll those gently instead.
    cx.timer.every(this.on ? 15000 : 60000, (cx) => this.load(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        cx.notify();
      }
    });
  }

  load(cx) {
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        this.repo = this.repo ?? (this.folder ? await repo(this.folder, this.on) : null);
        if (!this.repo) { this.state = "norepo"; return; }
        const { files, since } = this.scope === "pr" ? await prChanges(this.repo, this.pr, this.prRepo) : await changes(this.repo, this.scope);
        for (const f of files) f.kind = kind(f);
        this.files = files; this.since = since;
        this.state = "ready";
        this.watch(cx);
      } catch (e) {
        this.state = "error"; this.error = String(e?.message ?? e);
      } finally {
        this.busy = false;
        cx.notify();
        if (this.again) { this.again = false; this.load(cx); }
      }
    });
  }

  watch(cx) {
    if (this.on || this.watching) return;
    this.watching = true;
    cx.spawn(async (cx) => {
      try { for (;;) { await watchFolder(this.repo.root); this.load(cx); } } catch { this.watching = false; }
    });
  }

  // ---- state

  hidden() { return shared(HIDE) ?? {}; }
  shown() { const h = this.hidden(); return this.files.filter((f) => !(f.kind && h[f.kind])); }
  current(list) { return list.find((f) => f.path === this.sel) ?? list[0] ?? null; }
  marks() { return new Set(shared(MARKS)?.[this.repo?.root] ?? []); }

  toggleKind(k) { setShared(HIDE, { ...this.hidden(), [k]: !this.hidden()[k] }); }

  toggle(f) {
    const m = this.marks();
    m.has(f.key) ? m.delete(f.key) : m.add(f.key);
    // Keep only marks for diffs that still exist, so the store doesn't grow.
    const live = new Set(this.files.map((x) => x.key));
    setShared(MARKS, { ...(shared(MARKS) ?? {}), [this.repo.root]: [...m].filter((k) => live.has(k)) });
  }

  step(d) {
    const list = this.shown(), cur = this.current(list);
    this.goTo(list, list.indexOf(cur) + d);
  }

  /** Selects file i (clamped), from the diff's top, and keeps it in view. */
  goTo(list, i) {
    if (!list.length) return;
    const k = Math.max(0, Math.min(list.length - 1, i));
    if (list[k].path !== this.sel) { this.diffAt = 0; this.diffScroll.scroll_to_item(0, "top"); }
    this.sel = list[k].path;
    this.listScroll.scroll_to_item(k);
  }

  /** J / K: the diff's top line, half a pane at a time. */
  scrollDiff(d, f) {
    const n = f?.rows?.length ?? 0;
    if (!n) return;
    const half = Math.max(4, Math.floor((this.size.height - 90) / 20 / 2));
    this.diffAt = Math.max(0, Math.min(n - 1, this.diffAt + d * half));
    this.diffScroll.scroll_to_item(this.diffAt, "top");
  }

  pick(f) { this.sel = f.path; this.view = "file"; this.handle.focus(); }

  /** Puts the window this diff stood in for back in its place (same key). */
  goBack() {
    openOverlay({ mod: this.back.mod, kind: "window", key: "nocturne-github", frame: "none", width: 0.85, height: 0.85, props: this.back.props ?? {} });
  }

  setScope(s, cx) { if (this.scope !== s) { this.scope = s; this.state = "loading"; this.load(cx); } }

  key(e, cx) {
    const mods = e.modifiers ?? {};
    if (mods.control || mods.platform || mods.alt) return;
    // What was typed ("G", "?", "["), else the key's name ("down", "space").
    const c = e.key_char;
    const k = c && c.length === 1 && c.trim() ? c : e.key;
    const list = this.shown(), f = this.current(list), i = list.indexOf(f);
    if (this.help) {
      if (k === "escape" || k === "?" || k === "q") { this.help = false; cx.stop_propagation(); cx.notify(); }
      return;
    }
    if (k === "j" || k === "down") this.step(1);
    else if (k === "k" || k === "up") this.step(-1);
    else if (k === "g" || k === "<" || k === "home") this.goTo(list, 0);
    else if (k === "G" || k === ">" || k === "end") this.goTo(list, list.length - 1);
    else if (k === ".") this.goTo(list, i + 10);
    else if (k === ",") this.goTo(list, i - 10);
    else if (k === "J" || k === "pagedown") this.scrollDiff(1, f);
    else if (k === "K" || k === "pageup") this.scrollDiff(-1, f);
    else if (k === "a" && this.repo) {
      // Every shown file reviewed; when they all are already, none.
      const m = this.marks(), all = list.every((x) => m.has(x.key));
      for (const x of list) if (all === m.has(x.key)) this.toggle(x);
    } else if (k === "space" && f) {
      const was = this.marks().has(f.key);
      this.toggle(f);
      if (!was) {
        const m = this.marks(), i = list.indexOf(f);
        const next = [...list.slice(i + 1), ...list.slice(0, i)].find((x) => !m.has(x.key));
        if (next) this.sel = next.path;
      }
    } else if (k === "f") this.view = this.view === "list" ? "file" : "list";
    else if (k === "enter" && this.view === "list") this.view = "file";
    else if (k === "escape" && this.view === "file" && this.size.width < SPLIT) this.view = "list";
    else if (k === "s" || k === "[" || k === "]") {
      const scopes = this.pr ? ["pr", "work", "branch"] : ["work", "branch"];
      const at = scopes.indexOf(this.scope);
      this.setScope(scopes[(at + (k === "[" ? scopes.length - 1 : 1)) % scopes.length], cx);
    } else if ((k === "escape" || k === "q") && this.back && !(this.view === "file" && this.size.width < SPLIT)) this.goBack();
    else if (k === "r" || k === "R") this.load(cx);
    else if (k === "?") this.help = true;
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // ---- parts

  box(t, on, id, f) {
    return div().id(id).relative().size(10).flex_none().border(1).border_color(on ? t.ansi2 : t.ansi8)
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { this.toggle(f); cx.notify(); })
      .when(on, (el) => el.child(dither(t.ansi2, 1)));
  }

  /** A small text button; `on` gives it the dithered pressed look. */
  chip(t, id, label, on, action, faint = false) {
    return h_flex().id(id).relative().h(20).px(6).flex_none().items_center()
      .text_color(on ? t.foreground : faint ? t.dim : t.muted).hover((s) => s.text_color(t.foreground))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { action(cx); cx.notify(); })
      .when(on, (el) => el.child(dither(t.ansi0, 1)))
      .child(div().relative().child(label));
  }

  toolbar(t, list, w, short) {
    const r = this.repo, m = this.marks();
    const add = list.reduce((s, f) => s + f.add, 0), del = list.reduce((s, f) => s + f.del, 0);
    const done = list.filter((f) => m.has(f.key)).length;
    const roomy = w >= ROOMY, tight = w < TIGHT;
    const where = !r ? this.folder ?? "" : roomy ? `${r.name} · ${r.branch}` : r.name;
    return h_flex().id("toolbar").relative().h(short ? 28 : 34).flex_none().px(10).gap(tight ? 6 : 10).items_center().text_size(11)
      .when(roomy, (el) => el.child(div().flex_none().text_color(t.ansi8).child("DIFF")))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(where))
      .when(Boolean(r), (el) => el
        .child(h_flex().flex_none().border(1).border_color(t.ansi0)
          .when(Boolean(this.pr), (el) => el.child(this.chip(t, "scope-pr", `#${this.pr}`, this.scope === "pr", (cx) => this.setScope("pr", cx))))
          .child(this.chip(t, "scope-work", tight ? "work" : "uncommitted", this.scope === "work", (cx) => this.setScope("work", cx)))
          .child(this.chip(t, "scope-branch", roomy ? `since ${r.base ?? "base"}` : "branch", this.scope === "branch", (cx) => this.setScope("branch", cx))))
        .child(h_flex().flex_none().gap(6)
          .child(div().text_color(t.ansi2).child(`+${add}`))
          .child(div().text_color(t.ansi1).child(`-${del}`)))
        .when(roomy, (el) => el.child(div().flex_none().text_color(done === list.length && list.length ? t.ansi2 : t.ansi8)
          .child(`${done}/${list.length} reviewed`))))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
  }

  /** Count and the hide chips, above the list. Wraps when the list is narrow. */
  listHead(t, list, short) {
    const h = this.hidden(), m = this.marks();
    const off = this.files.length - list.length;
    const count = `${list.length} ${list.length === 1 ? "file" : "files"}${off ? ` · ${off} hidden` : ""}`;
    // Every kind always has its chip (a choice holds across repos), with how
    // many changed files it covers; a kind with none is dimmed.
    const chips = KINDS.map(([k, label]) => {
      const n = this.files.filter((f) => f.kind === k).length;
      return this.chip(t, `hide-${k}`, n ? `${label} ${n}` : label, Boolean(h[k]), () => this.toggleKind(k), !n);
    });
    return h_flex().flex_wrap().flex_none().px(10).py(short ? 3 : 6).gap_x(8).gap_y(2).items_center().text_size(11)
      .border_b(1).border_color(t.ansi0)
      .child(div().flex_1().min_w(80).truncate().text_color(t.ansi8).child(count))
      .child(h_flex().flex_wrap().max_w_full().min_w(0).gap(2).items_center()
        .child(div().pr(2).text_color(t.dim).child("hide"))
        .children(chips));
  }

  // A virtual list's rows can't carry handlers (gpui-kit refuses them in the
  // item renderer, and the list then draws empty), so file rows are inert:
  // presses land on the list (filePress / fileClick), which tells the
  // reviewed box and the row apart by where the press was.
  fileRow(t, f, sel, marks) {
    const [letter, color] = STATUS[f.status] ?? ["?", "ansi8"];
    const done = marks.has(f.key);
    const slash = f.path.lastIndexOf("/");
    const name = f.path.slice(slash + 1), dir = slash > 0 ? f.path.slice(0, slash) : "";
    return h_flex().id(`file-${f.path}`).relative().h(24).w_full().pl(10).pr(8).gap(8).items_center().flex_none()
      .hover((s) => s.bg(t.ansi0 + "55"))
      .when(sel, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).top(0).bottom(0).w(2).bg(t.accent)))
      .child(div().relative().size(10).flex_none().border(1).border_color(done ? t.ansi2 : t.ansi8).when(done, (el) => el.child(dither(t.ansi2, 1))))
      .child(div().flex_none().w(8).text_color(t[color]).child(letter))
      .child(h_flex().flex_1().min_w(0).gap(6).items_baseline()
        .child(div().flex_none().max_w_full().truncate().text_color(done ? t.dim : sel ? t.foreground : t.muted).child(name))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(dir)))
      .child(div().flex_none().text_color(t.dim).child(f.binary ? "bin" : `${f.add + f.del}`));
  }

  /** Where a press on the file list landed (rows span the list, so x is the row's). */
  filePress(e) {
    this.press = { x: e.local_position?.x ?? null };
    this.handle.focus();
  }

  /** A click on a file row: its reviewed box (the row's first 30 px), else the file. */
  fileClick(path, cx) {
    const f = this.files.find((x) => x.path === path);
    const x = this.press?.x;
    this.press = null;
    if (!f) return;
    if (x != null && x < 26) this.toggle(f);
    else this.pick(f);
    cx.notify();
  }

  fileList(t, list, cur, side, short) {
    const marks = this.marks();
    // side: in the split's panel (fills it, edge on the right); else the whole pane.
    return v_flex().relative().size_full()
      .when(side, (el) => el.border_r(1).border_color(t.ansi0))
      .child(this.listHead(t, list, short))
      .child(div().id("files-body").relative().flex_1().min_h(0)
        .on_mouse_down("left", (e) => this.filePress(e))
        .child(div().size_full().pt(4).text_size(11)
          .child(v_virtual_list("files", list.length, 24, (i) => list[i].path,
            (range) => list.slice(range.start, range.end).map((f) => this.fileRow(t, f, f === cur, marks)))
            .on_item_click((path, cx) => this.fileClick(path, cx))
            .size_full().track_scroll(this.listScroll)))
        .child(Scrollbar.vertical("files").absolute().inset_0()));
  }

  /** A code line in moonfly's syntax colors (tree-sitter, by the file's
   *  language; each line on its own), the row's base color between. */
  code(t, text, path, base) {
    const role = { keyword: t.ansi5, function: t.ansi12, type: t.ansi10, constructor: t.ansi10, tag: t.ansi10, string: t.ansi11,
      number: t.ansi3, boolean: t.ansi3, constant: t.ansi3, comment: t.ansi8, property: t.ansi6, field: t.ansi6,
      operator: t.ansi9, attribute: t.ansi13, namespace: t.ansi6, module: t.ansi6, label: t.ansi3, escape: t.ansi9 };
    const color = (name) => role[name] ?? role[name.split(".")[0]] ?? (name.startsWith("function") ? role.function : name === "variable.builtin" ? t.ansi4 : null);
    const spans = path && text.length < 2000 ? highlight(text, path) : [];
    if (!spans.length) return text || " ";
    const parts = [];
    let at = 0;
    for (const [s, e, name] of spans) {
      if (s > at) parts.push([text.slice(at, s), base]);
      parts.push([text.slice(s, e), color(name) ?? base]);
      at = Math.max(at, e);
    }
    if (at < text.length) parts.push([text.slice(at), base]);
    return h_flex().min_w(0).overflow_hidden().children(parts.map(([piece, c]) => div().flex_none().text_color(c).child(piece)));
  }

  line(t, row, code, compact, path) {
    const num = (n, w) => div().w(w).flex_none().text_right().pr(6).text_color(t.dim).child(n == null ? "" : String(n));
    if (row.kind === "@") {
      return h_flex().h(20).w_full().relative().items_center().px(8).gap(10).text_size(11)
        .child(dither(t.ansi0, 2))
        .child(div().relative().flex_none().px(4).bg(t.background).text_color(t.accent).child(compact ? row.range.replace(/^@@ | @@$/g, "") : row.range))
        .when(Boolean(row.text), (el) => el.child(div().relative().min_w(0).truncate().px(4).bg(t.background).text_color(t.muted).child(row.text)));
    }
    const tint = row.kind === "+" ? t.ansi2 : row.kind === "-" ? t.ansi1 : null;
    return h_flex().h(20).w_full().relative().items_center().font_family(code).text_size(compact ? 12 : 12.5)
      .when(Boolean(tint), (el) => el.bg(tint + "16"))
      .child(div().w(3).h_full().flex_none().relative().when(Boolean(tint), (el) => el.child(dither(tint, 1))))
      // Narrow: one number column (the new line, or the old one for a deletion).
      .when(compact, (el) => el.child(num(row.n ?? row.o, 34)))
      .when(!compact, (el) => el.child(num(row.o, 38)).child(num(row.n, 38)))
      .child(div().w(compact ? 12 : 14).flex_none().text_color(tint ?? t.dim).child(row.kind === "+" || row.kind === "-" ? row.kind : ""))
      .child(div().flex_1().min_w(0).truncate().pr(8)
        .text_color(row.kind === "\\" ? t.dim : row.kind === " " ? t.muted : t.foreground)
        .child(row.kind === "\\" ? row.text || " " : this.code(t, row.text ?? "", path, row.kind === " " ? t.muted : t.foreground)));
  }

  fileView(t, list, f, w, narrow, short) {
    if (!f) return div().flex_1();
    const done = this.marks().has(f.key);
    const code = settings().font_family || "JetBrains Mono";
    const compact = w < SPLIT;
    const i = list.indexOf(f);
    const slash = f.path.lastIndexOf("/");
    const path = f.status === "renamed" && f.old ? `${f.old} → ${f.path}` : f.path;
    const nav = (id, label, d, off) => this.chip(t, id, label, false, () => { if (!off) this.step(d); });
    const head = h_flex().h(short ? 26 : 30).flex_none().px(narrow ? 6 : 12).gap(narrow ? 4 : 10).items_center().text_size(11)
      .border_b(1).border_color(t.ansi0)
      .when(narrow, (el) => el
        .child(this.chip(t, "show-list", "files", false, () => { this.view = "list"; }))
        .child(nav("prev", "<", -1, i <= 0))
        .child(div().flex_none().text_color(t.ansi8).child(`${i + 1}/${list.length}`))
        .child(nav("next", ">", 1, i >= list.length - 1)))
      // Narrow shows the file's name; wide, its whole path.
      .child(div().flex_1().min_w(0).truncate().px(narrow ? 4 : 0).text_color(t.foreground).child(narrow ? f.path.slice(slash + 1) : path))
      .child(div().flex_none().text_color(t.ansi2).child(`+${f.add}`))
      .child(div().flex_none().text_color(t.ansi1).child(`-${f.del}`))
      .child(h_flex().id("mark-current").flex_none().gap(6).items_center().px(4).h(20)
        .text_color(done ? t.ansi2 : t.muted).hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { this.toggle(f); cx.notify(); })
        .child(this.box(t, done, "mark-current-box", f))
        .when(w >= TIGHT, (el) => el.child(done ? "reviewed" : narrow ? "review" : "mark reviewed")));
    const note = (s) => div().p(narrow ? 10 : 16).text_size(11).text_color(t.ansi8).child(s);
    const body = f.binary ? note("Binary file: not shown.")
      : !f.rows.length ? note(f.status === "untracked" ? "Untracked, not diffed (too many new files)." : "No text changes (mode or rename only).")
      : div().relative().flex_1().min_h(0)
          .child(v_virtual_list(`diff-${f.key}`, f.rows.length, 20, (n) => `${f.key}:${n}`,
            (range) => f.rows.slice(range.start, range.end).map((row) => this.line(t, row, code, compact, f.path)))
            .size_full().track_scroll(this.diffScroll))
          .child(Scrollbar.vertical(`diff-${f.key}`).absolute().inset_0());
    return v_flex().id("diff-side").flex_1().min_w(0).size_full()
      .when(!narrow, (el) => el.on_size_change((size, cx) => {
        if (Math.abs(size.width - (this.diffW ?? 0)) > 1) { this.diffW = size.width; cx.notify(); }
      }))
      .child(head)
      .when(narrow && f.status === "renamed" && f.old, (el) => el.child(div().px(10).py(2).truncate().text_size(11).text_color(t.dim).child(`from ${f.old}`)))
      .child(body);
  }

  /** lazygit's options bar: the keys that do something now. */
  hints(t, narrow) {
    const list = this.help ? [["esc", "close"]]
      : narrow && this.view === "list" ? [["j/k", "file"], ["enter", "diff"], ["space", "reviewed"], ["s", "scope"], ["?", "keys"]]
      : [["j/k", "file"], ["J/K", "scroll"], ["space", "reviewed"], ...(narrow ? [["esc", "files"]] : []), ["s", "scope"], ...(this.back && !narrow ? [["esc", "back to GitHub"]] : []), ["?", "keys"]];
    return h_flex().id("diff-hints").relative().h(22).flex_none().px(10).gap(10).items_center().text_size(11).overflow_hidden()
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
      .children(list.map(([key, what], i) => h_flex().id(`diff-hint-${i}`).flex_none().gap(4)
        .child(div().text_color(t.accent).child(key))
        .child(div().text_color(t.dim).child(what))));
  }

  /** ?: every key, over the pane. */
  helpPanel(t) {
    const keys = [
      ["j k ↓ ↑", "next / previous file"], ["g G < >", "first / last file"], [", .", "a page of files"],
      ["J K pgdn pgup", "scroll the diff"], ["space", "mark reviewed, next unreviewed"], ["a", "all reviewed / none"],
      ["enter", "the diff (narrow)"], ["esc f", "the files (narrow)"], ["s [ ]", this.pr ? `#${this.pr} / uncommitted / branch` : "uncommitted / branch"],
      ...(this.back ? [["esc q", "back to the GitHub window"]] : []), ["r", "refresh"], ["?", "these keys"],
    ];
    return v_flex().id("diff-help").absolute().inset_0().bg(t.background).px(16).py(12).gap(2).text_size(11)
      .child(div().pb(6).text_color(t.ansi8).child("KEYS"))
      .children(keys.map(([k, what], i) => h_flex().id(`diff-help-${i}`).gap(12)
        .child(div().w(110).flex_none().text_color(t.accent).child(k))
        .child(div().text_color(t.muted).child(what))));
  }

  empty(t, title, hint, short, action) {
    return v_flex().flex_1().min_h(0).items_center().justify_center().gap(short ? 6 : 10).px(16).text_size(11)
      .when(!short, (el) => el.child(svg("mods/nocturne/art/moon-8.svg").w(44).h(44).text_color(t.ansi8).opacity(0.6)))
      .child(div().text_color(t.foreground).child(title))
      .when(Boolean(hint), (el) => el.child(div().text_center().text_color(t.ansi8).child(hint)))
      .when(Boolean(action), (el) => el.child(action));
  }

  render() {
    const t = theme();
    const { width: w, height: hgt } = this.size;
    const narrow = w < SPLIT, short = hgt < SHORT;
    const list = this.shown(), cur = this.current(list);
    if (cur) this.sel = cur.path;
    let body;
    if (this.state === "loading" && !this.files.length) body = this.empty(t, "Reading changes…", null, short);
    else if (this.state === "norepo") body = this.empty(t, "Not a git repository", `${this.folder ?? "No folder"}: open the diff from a terminal inside a repo.`, short);
    else if (this.state === "error") body = this.empty(t, "git didn't answer", this.error, short);
    else if (!this.files.length) body = this.empty(t, "Nothing changed",
      this.scope === "pr" ? `#${this.pr} changes nothing.` : this.scope === "work" ? "No uncommitted changes. Press s for the branch." : `No changes since ${this.since ?? "the base"}.`, short);
    else if (!list.length) body = this.empty(t, `All ${this.files.length} changed files are hidden`, "Only tests, assets or docs changed.", short,
      this.chip(t, "show-all", "show them", false, () => setShared(HIDE, {})));
    else if (narrow) body = this.view === "list" ? this.fileList(t, list, cur, false, short) : this.fileView(t, list, cur, w, true, short);
    // Wide: list and diff in a split whose divider drags; Herdr keeps the
    // dragged width under the split's id.
    else body = h_resizable("nocturne-diff-split").flex_1().min_h(0)
      .child(resizable_panel().size(Math.max(190, Math.min(300, Math.round(w * 0.3)))).size_range(150, Math.max(200, Math.round(w * 0.6)))
        .child(this.fileList(t, list, cur, true, short)))
      .child(resizable_panel().child(this.fileView(t, list, cur, this.diffW ?? w * 0.7, false, short)));
    return v_flex().id("diff").size_full().bg(t.background).track_focus(this.handle)
      // Frameless in a window: its own 1-bit edge.
      .when(Boolean(this.overlay), (el) => el.border(1).border_color(t.ansi8))
      .on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => this.handle.focus())
      .on_size_change((size, cx) => {
        if (Math.abs(size.width - this.size.width) > 1 || Math.abs(size.height - this.size.height) > 1) { this.size = size; cx.notify(); }
      })
      .child(this.toolbar(t, list, w, short))
      .child(div().relative().flex_1().min_h(0).flex().flex_col()
        .child(body)
        .when(this.help, (el) => el.child(this.helpPanel(t))))
      .when(!short, (el) => el.child(this.hints(t, narrow)));
  }
}
