// Nocturne Markdown: a Markdown file, rendered, in a pane beside where it was
// opened from: a link to a .md file clicked in a terminal (Claude Code's
// output, `ls`, an OSC 8 link), a .md picked in the files pane, or the
// `markdown.open {path}` command. Props: { path, on?, slot }.
//
// Readable width, headings, code in tree-sitter colors, tables, math ($…$,
// $$…$$), mermaid diagrams, callouts (> [!NOTE]), footnotes, task lists (a
// click ticks the box in the file), images next to the
// file (copied into the app's cache so they can be drawn; a click opens one in
// the preview, preview, as do links to pictures, PDFs, tables and the
// other files it shows), links: web pages
// open as the app opens them (settings `links`), other .md files open here
// (‹ goes back), #anchors scroll to their heading, other files go to the
// system. It reads the file again whenever it changes on disk (agents edit
// these), keeping where you were.
//
// The bar: the file and its folder, ‹ back, raw / rendered, edit (the editor
// beside; another machine's file: $EDITOR in a terminal there), files (the folder in the files pane).
// Keys while it has focus:
//   j / k  ↓ ↑   scroll         d / u  space   half a page down / up
//   gg / G       top / bottom   r              raw / rendered
//   e            edit           backspace h    back
//   tab / shift-tab  next / previous link or picture (its block gets a blue
//                edge, where it goes shows at the foot), enter follows it
//   ] / [        next / previous heading
//   f            the folder in the files pane      y  copy the path
//   ?            the keys, under the bar           esc  link, then keys, away
// Commands (keys.json, `herdr-app do markdown.<c>`; every shown
// viewer takes them): down, up, top, bottom, raw, back, reload.

import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as herdr from "herdr";
import { openInEditor } from "./editor-route.js";
import { props, theme, settings, exec, run, panes, shared, setShared, readTextFile, writeTextFile, watchFolder, nextCommand, home, window as appWindow } from "herdr";
import { fenced, isLocalSource, MarkdownDoc, cacheImage, taskToggle } from "./markdown.js";
import { follow, dirname, basename, join, tilde } from "./paths.js";
import { documentLinks, nextLink, nextHeading } from "./links.js";
import { keysHint, keysView, keysKey } from "./keyhelp.js";
import { CHANGES, newestId, follow as followFiles } from "./follow.js";

const MOD = "markdown";
// Each viewer's shown file by slot, for its pane header (nocturne/header.js).
const TITLES = "markdown.titles";
// ... and its path, for the app to find the viewer showing a file (`markdown.open`).
const PATHS = "markdown.paths";
const ART = "mods/nocturne/art";
// Local images are copied here (under the app's folder, where image() reads).
const IMAGES = "markdown";
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i;
// Links to these open in the preview (preview/kinds.js KINDS).
const PREVIEW = /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|svg|avif|hei[cf]|pdf|csv|tsv|sqlite3?|db3?|diff|patch|ttf|otf|ttc|woff2?|mp4|m4v|mov|mp3|m4a|aac|wav|aiff?|flac|caf)$/i;
const WIDTH = 780;
// A file on another machine can't be watched: read it this often.
const POLL = 4000;

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
const zoom = () => Number(settings()?.zoom) || 1;
const unzoom = (v) => v / zoom();
/** A 50% checker dither filling the parent (same as ../nocturne/kit.js). */
function dither(color, cell = 1) {
  const dpr = appWindow()?.platform === "macos" ? 2 : 1;
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr)))).absolute().top(0).left(0).size_full();
}
const stop = (_e, cx) => cx.stop_propagation();
/** A key's name: the typed character for printable keys ("G", "?", "]"), else GPUI's key. */
const keyOf = (e) => (typeof e?.key_char === "string" && e.key_char.length === 1 && e.key_char.trim() ? e.key_char : String(e?.key ?? ""));
// What `?` lists.
// Every key key() takes, ? keys last.
export const KEYS = [["j k  ↑ ↓", "scroll"], ["d u  ctrl-d ctrl-u", "half a page down / up"], ["space  pgdn pgup", "half a page down · down / up"],
  ["gg G  home end", "top / bottom"], ["tab ⇧tab", "links"], ["enter", "follow"], ["] [", "headings"], ["h ←  ⌫", "back"],
  ["r", "raw"], ["e", "edit"], ["f", "files"], ["y", "copy path"], ["esc", "off the link · keys away"], ["?", "keys"]];

export default class Markdown extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    this.on = pr.on ?? null;
    this.slot = pr.slot ?? null;
    this.handle = cx.focus_handle();
    this.raw = false;
    this.history = [];
    this.images = new Map(); // abs path -> cache name | null (can't) | undefined (copying)
    this.doc = new MarkdownDoc("md");
    this.rawDoc = new MarkdownDoc("md-raw");
    this.width = 600;
    // Renamed or moved from the files pane (follow.js): the viewer follows,
    // only what comes after this start.
    this.seenChange = newestId(shared(CHANGES));
    this.open(pr.path ?? "", cx, pr.anchor);
    if (this.on) cx.timer.every(POLL, (cx) => this.load(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        else this.command(c, cx);
        cx.notify();
      }
    });
  }

  // ---- the file

  /** Shows `path` (scrolled to `anchor`), from the top unless `keep`. */
  open(path, cx, anchor, keep) {
    this.path = path;
    this.text = null; this.error = null;
    this.doc.setText(null); this.rawDoc.setText(null); this.links = []; this.sel = null;
    if (!keep) { this.doc.scrollY = 0; this.rawDoc.scrollY = 0; }
    this.doc.want = anchor || null;
    this.gen = (this.gen ?? 0) + 1;
    this.title();
    this.load(cx);
    if (!this.on && path) this.watch(cx, this.gen);
  }

  /** Reads the file again; the scroll stays where it was. */
  load(cx) {
    const path = this.path, gen = this.gen;
    if (!path) { this.error = "No file given"; return; }
    cx.spawn(async (cx) => {
      let text = null, error = null;
      try {
        text = await readTextFile(path, { on: this.on });
        if (text == null) error = "It isn't there (moved or deleted?)";
        else if (text.includes("\0")) { text = null; error = "Not a text file"; }
      } catch (e) { error = String(e?.message ?? e); }
      if (gen !== this.gen) return;
      if (text === this.text && error === this.error) return;
      this.text = text; this.error = error;
      this.doc.setText(text);
      this.links = documentLinks(this.doc.parts);
      if (this.sel != null && this.sel >= this.links.length) this.sel = null;
      this.rawDoc.setText(text == null ? null : fenced(text));
      if (this.doc.want) this.doc.scrollTo(this.doc.want);
      this.loadImages(cx);
      cx.notify();
    });
  }

  /** Waits for the file's folder to change, and reads the file again. */
  watch(cx, gen) {
    const dir = dirname(this.path);
    cx.spawn(async (cx) => {
      while (gen === this.gen) {
        let changed;
        try { changed = await watchFolder(dir); } catch { return; }
        if (gen !== this.gen) return;
        // Reported paths may be spelled another way (/tmp vs /private/tmp): any
        // change here reads the file again, which redraws only when it differs.
        this.load(cx);
        const names = new Set(changed.map(basename));
        const stale = [...this.images.keys()].filter((p) => names.has(basename(p)));
        if (stale.length) { for (const p of stale) this.images.delete(p); this.loadImages(cx); }
      }
    });
  }

  loadImages(cx) {
    if (this.on) return;
    for (const part of this.doc.parts) {
      if (part.kind !== "images") continue;
      for (const img of part.images) {
        if (!isLocalSource(img.src)) continue;
        const abs = join(dirname(this.path), decodeURI(img.src.split(/[?#]/)[0]));
        if (this.images.has(abs)) continue;
        if (!IMAGE_EXT.test(abs)) { this.images.set(abs, null); continue; }
        this.images.set(abs, undefined);
        cx.spawn(async (cx) => {
          const name = await cacheImage(abs, IMAGES);
          this.images.set(abs, name);
          cx.notify();
        });
      }
    }
  }

  /** The files pane renamed or moved the shown file (or its folder): shown
   *  from there, the scroll kept; the back history follows too. A delete
   *  shows as the missing file it is. From a task, never a render. */
  followChanges(cx) {
    const list = shared(CHANGES);
    const r = followFiles(list, this.seenChange, this.path, this.on);
    this.history = this.history.map((h) => (typeof h === "string" ? followFiles(list, this.seenChange, h, this.on).path : h?.path ? { ...h, path: followFiles(list, this.seenChange, h.path, this.on).path } : h));
    this.seenChange = r.seen;
    if (r.path !== this.path) this.open(r.path, cx, null, true);
    cx.notify();
  }

  /** Tells the pane header which file this viewer shows. */
  title() {
    if (!this.slot) return;
    const live = new Set(panes().filter((p) => p.mod === MOD).map((p) => p.props?.slot).filter(Boolean));
    const was = shared(TITLES) ?? {};
    const name = this.path ? basename(this.path) : "Markdown";
    // Its path too, so clicking a link to the file it moved on to finds this viewer.
    const paths = shared(PATHS) ?? {};
    if (paths[this.slot] !== this.path || Object.keys(paths).some((k) => !live.has(k) && k !== this.slot)) {
      setShared(PATHS, { ...Object.fromEntries(Object.entries(paths).filter(([k]) => live.has(k))), [this.slot]: this.path });
    }
    if (was[this.slot] === name && Object.keys(was).every((k) => live.has(k) || k === this.slot)) return;
    const next = Object.fromEntries(Object.entries(was).filter(([k]) => live.has(k)));
    next[this.slot] = name;
    setShared(TITLES, next);
  }

  /** This viewer's pane. */
  pane() {
    return panes().find((p) => p.mod === MOD && this.slot && p.props?.slot === this.slot) ?? null;
  }

  // ---- links and actions

  link(href, cx) {
    const to = follow(href, this.path);
    if (!to) return;
    if (to.kind === "anchor") this.doc.scrollTo(to.anchor);
    else if (to.kind === "markdown") {
      if (to.path === this.path) { if (to.anchor) this.doc.scrollTo(to.anchor); }
      else { this.history.push({ path: this.path, scrollY: this.doc.scrollY }); this.open(to.path, cx, to.anchor); }
    } else if (to.kind === "web") run("app.open_url", { url: to.url });
    else if (to.kind === "file" && PREVIEW.test(to.path)) this.showImage(to.path);
    else if (!this.on) {
      const opener = appWindow()?.platform === "windows" ? null : appWindow()?.platform === "macos" ? "open" : "xdg-open";
      if (opener) exec(opener, [to.kind === "file" ? to.path : to.url]).catch(() => null);
    }
    cx.notify();
  }

  /** A picture (or a PDF, a table, …) in the preview (preview), beside this viewer. */
  showImage(path) {
    const me = this.pane();
    run("preview.open", { path, ...(me ? { pane: me.pane } : {}), ...(this.on ? { on: this.on } : {}) });
  }

  back(cx) {
    const last = this.history.pop();
    if (!last) return;
    this.open(last.path, cx);
    this.doc.scrollY = last.scrollY;
  }

  /** Ticks or unticks a task in the file itself (only over what was read). */
  tick(line, cx) {
    if (this.on || this.text == null) return;
    const edit = taskToggle(this.text, line);
    if (!edit) return;
    const lines = this.text.split("\n");
    const l = lines[line];
    lines[line] = l.slice(0, edit.col) + edit.text + l.slice(edit.col + 1);
    const next = lines.join("\n"), was = this.text;
    this.text = next;
    this.doc.setText(next);
    this.rawDoc.setText(fenced(next));
    cx.notify();
    writeTextFile(this.path, next, was).catch(() => { this.load(cx); });
  }

  /** The app's editor (editor) in this viewer's place, its Markdown
   *  preview on (split): a tab of the tab's editor when it has one
   *  (editor-route.js), else a new editor opened beside this viewer, which
   *  then closes so the editor takes its room. A file on another machine:
   *  $EDITOR in a terminal beside. */
  edit() {
    const me = this.pane();
    if (!this.on) {
      openInEditor(herdr, { path: this.path, pane: me?.pane ?? null, view: "split" });
      if (me) run("pane.close", { pane: me.pane });
      return;
    }
    run("terminal.open", { argv: ["sh", "-c", 'exec "${VISUAL:-${EDITOR:-vi}}" "$1"', "edit", this.path], folder: dirname(this.path), place: "left", ...(me ? { pane: me.pane } : {}), ...(this.on ? { on: this.on } : {}) });
  }

  revealFolder() {
    run("pane.split", { edge: "right", px: 280, mod: "file-tree", props: { folder: dirname(this.path), on: this.on } });
  }

  // ---- scrolling

  /** The document on screen: rendered, or the raw text. */
  shown() { return this.raw ? this.rawDoc : this.doc; }

  scroll(dy) { this.shown().scroll(dy); }

  /** Brings block `i` into view, near the top when it was out of it. */
  reveal(i) {
    const doc = this.doc, top = doc.tops().tops[i], h = doc.height(doc.parts[i]);
    if (top >= doc.scrollY && top + Math.min(h, doc.viewH / 2) <= doc.scrollY + doc.viewH - 32) return;
    doc.setScroll(top - 24);
  }

  /** The first block still in view, and the last that starts in view. */
  firstShown() {
    const d = this.doc, { tops } = d.tops();
    const i = d.parts.findIndex((p, j) => tops[j] + d.height(p) > d.scrollY);
    return i < 0 ? 0 : i;
  }

  lastShown() {
    const d = this.doc, { tops } = d.tops();
    return Math.max(0, d.parts.findLastIndex((_, j) => tops[j] < d.scrollY + d.viewH));
  }

  /** tab / shift-tab: the next / previous link, from the ones in view. */
  pickLink(dir) {
    if (this.raw || !this.links.length) return;
    this.sel = nextLink(this.links, this.sel, dir, dir > 0 ? this.firstShown() : this.lastShown());
    this.reveal(this.links[this.sel].part);
  }

  /** enter: where the chosen link goes. */
  followLink(cx) {
    const l = this.links[this.sel];
    if (!l) return;
    this.sel = null;
    const local = l.image && isLocalSource(l.href) && !this.on;
    if (local) this.showImage(join(dirname(this.path), decodeURI(l.href.split(/[?#]/)[0])));
    else this.link(l.href, cx);
  }

  /** ] / [: the next / previous heading to the top. */
  heading(dir) {
    const d = this.doc, here = this.firstShown();
    // The heading at the top already counts as passed going down.
    const at = dir > 0 && d.tops().tops[here] < d.scrollY + 30 ? here : dir > 0 ? here - 1 : here;
    const i = nextHeading(d.parts, at, dir);
    if (i != null) d.scrollTo(d.parts[i].anchor);
  }

  copyPath(cx) {
    cx.write_to_clipboard?.(this.on ? `${this.on}:${this.path}` : this.path);
  }

  key(e, cx) {
    const k = keyOf(e), m = e.modifiers ?? {};
    if (m.platform || m.alt) return;
    // ? opens the keys over the page, ? esc q close them; meanwhile they take every key (keyhelp.js).
    const help = keysKey(e, this.keysShown);
    if (help || this.keysShown) {
      if (help) this.keysShown = help === "toggle" ? !this.keysShown : false;
      cx.stop_propagation();
      return cx.notify();
    }
    const page = Math.max(80, this.shown().viewH / 2);
    if (k === "tab" && !m.control) this.pickLink(m.shift ? -1 : 1);
    else if (k === "enter" && this.sel != null && !m.control) this.followLink(cx);
    else if (k === "escape" && this.sel != null) this.sel = null;
    else if (m.control) {
      if (k === "d") this.scroll(page); else if (k === "u") this.scroll(-page); else return;
    } else if (k === "j" || k === "down") this.scroll(60);
    else if (k === "k" || k === "up") this.scroll(-60);
    else if (k === "d" || k === "space" || k === "pagedown") this.scroll(page);
    else if (k === "u" || k === "pageup") this.scroll(-page);
    else if (k === "G" || (k === "g" && m.shift) || k === "end") this.scroll(1e9);
    else if (k === "g" || k === "home") {
      if (k === "home" || Date.now() - (this.gAt ?? 0) < 500) { this.gAt = 0; this.shown().scrollY = 0; } else this.gAt = Date.now();
    } else if (k === "r") { this.raw = !this.raw; this.sel = null; }
    else if (k === "e") this.edit();
    else if (k === "backspace" || k === "h" || k === "left") this.back(cx);
    else if (k === "]" || k === "[") this.heading(k === "]" ? 1 : -1);
    else if (k === "f") this.revealFolder();
    else if (k === "y") this.copyPath(cx);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  /** `markdown.<command>` (keys.json, `herdr-app do`): every shown viewer takes it. */
  command(c, cx) {
    if (c === "keys" || c === "markdown.keys") { this.keysShown = !this.keysShown; return; }
    const page = Math.max(80, this.shown().viewH / 2);
    if (c === "down") this.scroll(page);
    else if (c === "up") this.scroll(-page);
    else if (c === "top") this.shown().scrollY = 0;
    else if (c === "bottom") this.scroll(1e9);
    else if (c === "raw") this.raw = !this.raw;
    else if (c === "back") this.back(cx);
    else if (c === "reload") this.load(cx);
  }

  // ---- parts

  chip(t, id, label, action, on) {
    return h_flex().id(id).relative().h(20).px(6).flex_none().items_center()
      .text_color(on ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); cx.notify(); })
      .when(Boolean(on), (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)))
      .child(div().relative().child(label));
  }

  toolbar(t) {
    const w = this.width;
    return h_flex().id("md-toolbar").relative().h(34).flex_none().px(10).gap(8).items_center().text_size(11)
      .when(w >= 320, (el) => el.child(div().flex_none().text_color(t.ansi8).child("MD")))
      .when(this.history.length > 0, (el) => el.child(this.chip(t, "md-back", "‹", (cx) => this.back(cx))))
      .child(h_flex().flex_1().min_w(0).gap(6).items_baseline()
        .child(div().flex_none().max_w_full().truncate().text_color(t.foreground).child(basename(this.path || "Markdown")))
        .when(w >= 420 && Boolean(this.path), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim)
          .child(`${this.on ? this.on + ":" : ""}${tilde(dirname(this.path), home())}`))))
      .child(this.chip(t, "md-raw", this.raw ? "raw" : "rendered", () => { this.raw = !this.raw; }, this.raw))
      .when(Boolean(this.path), (el) => el
        .child(this.chip(t, "md-edit", "edit", () => this.edit()))
        .when(w >= 300, (e2) => e2.child(this.chip(t, "md-files", "files", () => this.revealFolder()))))
      .child(keysHint(t, "md-keys", Boolean(this.keysShown), () => { this.keysShown = !this.keysShown; }).ml(4))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
  }

  empty(t, title, hint) {
    return v_flex().size_full().items_center().justify_center().gap(10).px(16).text_size(11)
      .child(svg(`${ART}/moon-8.svg`).w(44).h(44).text_color(t.ansi8).opacity(0.6))
      .child(div().text_color(t.foreground).child(title))
      .when(Boolean(hint), (el) => el.child(div().text_center().text_color(t.ansi8).child(hint)));
  }

  /** A local image's place and its name in the cache (undefined while copying). */
  image(src) {
    if (!isLocalSource(src)) return { abs: null, name: null };
    const abs = join(dirname(this.path), decodeURI(src.split(/[?#]/)[0]));
    const name = this.images.get(abs);
    return { abs: this.on ? null : abs, name: name ? `cache/${IMAGES}/${name}` : name };
  }

  /** `?`: every key, in the page's place (keyhelp.js). */
  keysStrip(t) {
    return keysView(t, { id: "md-keys-strip", title: "markdown", list: KEYS, close: () => { this.keysShown = false; } });
  }


  /** The chosen link, at the foot of the page: what it says and where it goes. */
  linkBar(t) {
    const l = this.links[this.sel];
    return h_flex().id("md-link").absolute().left(0).right(0).bottom(0).h(24).px(10).gap(8).items_center().text_size(11).bg(t.background)
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
      .child(div().flex_none().text_color(t.accent).child("enter"))
      .child(div().flex_none().max_w(260).truncate().text_color(t.foreground).child(`${l.image ? "▧ " : ""}${l.text}`))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(l.href))
      .child(div().flex_none().text_color(t.dim).child(`${this.sel + 1}/${this.links.length}`));
  }

  render(cx) {
    const t = theme();
    const focused = this.handle.is_focused();
    // A newer rename or move from the files pane: answered after this render.
    if (newestId(shared(CHANGES)) > this.seenChange) cx?.timer?.after(0, (cx) => this.followChanges(cx));
    let body;
    if (this.error) body = this.empty(t, "Can't show this file", this.error);
    else if (this.text == null) body = this.empty(t, "Reading…", tilde(this.path, home()));
    else {
      const doc = this.shown();
      this.width = doc.width;
      const chosen = this.raw ? null : this.doc.parts[this.links[this.sel]?.part]?.key ?? null;
      body = v_flex().id("md-body").relative().flex_1().min_h(0).child(doc.render(t, {
        onLink: (url, cx) => this.link(url, cx),
        onTask: (line, cx) => this.tick(line, cx),
        image: (src) => this.image(src),
        onImage: (abs) => this.showImage(abs),
        dither: (color) => dither(color, 1),
        focused, size: this.raw ? 12 : 13, maxWidth: WIDTH, unzoom, notify: (cx) => cx.notify(), chosen,
      })).when(!this.raw && this.links[this.sel] != null, (el) => el.child(this.linkBar(t)));
    }
    return v_flex().id("markdown").relative().size_full().bg(t.background).text_color(t.foreground).track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => this.handle.focus())
      .child(this.toolbar(t))
      // ?: the keys in the page's place, the toolbar stays (keyhelp.js).
      .child(this.keysShown ? div().relative().flex_1().min_h(0).child(this.keysStrip(t)) : body);
  }
}
