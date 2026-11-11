// Nocturne Markdown: a Markdown file, rendered, in a pane beside where it was
// opened from: a link to a .md file clicked in a terminal (Claude Code's
// output, `ls`, an OSC 8 link), a .md picked in the files pane, or the
// `markdown.open {path}` command. Props: { path, on?, slot }.
//
// Readable width, headings, code, tables, task lists, images next to the
// file (copied into the app's cache so they can be drawn; a click opens one in
// the preview, nocturne-preview, as do links to pictures, PDFs, tables and the
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
// Commands (keys.json, `herdr-app do nocturne-markdown.<c>`; every shown
// viewer takes them): down, up, top, bottom, raw, back, reload.

import { View, div, svg, image, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, theme, settings, exec, run, panes, shared, setShared, readTextFile, watchFolder, nextCommand, home, appHome, window as appWindow } from "herdr";
import { markdown, fenced, blocks, isLocalSource } from "./markdown.js";
import { follow, dirname, basename, join, tilde } from "./paths.js";
import { documentLinks, nextLink, nextHeading } from "./links.js";

const MOD = "nocturne-markdown";
// Each viewer's shown file by slot, for its pane header (nocturne/header.js).
const TITLES = "nocturne-markdown.titles";
// ... and its path, for the app to find the viewer showing a file (`markdown.open`).
const PATHS = "nocturne-markdown.paths";
const ART = "mods/nocturne/art";
// Local images are copied here (under the app's folder, where image() reads).
const IMAGES = "cache/nocturne-markdown";
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i;
// Links to these open in the preview (nocturne-preview/kinds.js KINDS).
const PREVIEW = /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|svg|avif|hei[cf]|pdf|csv|tsv|sqlite3?|db3?|diff|patch|ttf|otf|ttc|woff2?|mp4|m4v|mov|mp3|m4a|aac|wav|aiff?|flac|caf)$/i;
const WIDTH = 780;
// Images are drawn at most this tall.
const IMAGE_H = 360;
const GAP = 12;
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
const KEYS = [["j k", "scroll"], ["d u", "half page"], ["gg G", "top / bottom"], ["tab ⇧tab", "links"], ["enter", "follow"],
  ["] [", "headings"], ["h", "back"], ["r", "raw"], ["e", "edit"], ["f", "files"], ["y", "copy path"], ["?", "keys"]];

/** Copies a local image into the cache, named by its contents; -> its name there. */
async function cacheImage(path) {
  const script = 'mkdir -p "$2" && [ -f "$1" ] || exit 3; s=$(cksum < "$1" | cut -d" " -f1); n="$s.${1##*.}"; [ -f "$2/$n" ] || cp "$1" "$2/$n" || exit 4; printf %s "$n"';
  const r = await exec("sh", ["-c", script, "md-image", path, `${appHome()}/${IMAGES}`]).catch(() => null);
  return r?.code === 0 && r.stdout ? r.stdout.trim() : null;
}

export default class Markdown extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    this.on = pr.on ?? null;
    this.slot = pr.slot ?? null;
    this.handle = cx.focus_handle();
    this.raw = false;
    this.history = [];
    this.images = new Map(); // abs path -> cache name | null (can't) | undefined (copying)
    this.scrollY = 0; this.viewH = 400; this.heights = []; this.width = 600;
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
    this.text = null; this.error = null; this.parts = []; this.heights = []; this.links = []; this.sel = null;
    if (!keep) this.scrollY = 0;
    this.want = anchor || null;
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
      this.parts = text == null ? [] : blocks(text);
      this.links = documentLinks(this.parts);
      if (this.sel != null && this.sel >= this.links.length) this.sel = null;
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
    for (const part of this.parts) {
      if (part.kind !== "images") continue;
      for (const img of part.images) {
        if (!isLocalSource(img.src)) continue;
        const abs = join(dirname(this.path), decodeURI(img.src.split(/[?#]/)[0]));
        if (this.images.has(abs)) continue;
        if (!IMAGE_EXT.test(abs)) { this.images.set(abs, null); continue; }
        this.images.set(abs, undefined);
        cx.spawn(async (cx) => {
          const name = await cacheImage(abs);
          this.images.set(abs, name);
          cx.notify();
        });
      }
    }
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
    if (to.kind === "anchor") this.scrollTo(to.anchor);
    else if (to.kind === "markdown") {
      if (to.path === this.path) { if (to.anchor) this.scrollTo(to.anchor); }
      else { this.history.push({ path: this.path, scrollY: this.scrollY }); this.open(to.path, cx, to.anchor); }
    } else if (to.kind === "web") run("app.open_url", { url: to.url });
    else if (to.kind === "file" && PREVIEW.test(to.path)) this.showImage(to.path);
    else if (!this.on) {
      const opener = appWindow()?.platform === "windows" ? null : appWindow()?.platform === "macos" ? "open" : "xdg-open";
      if (opener) exec(opener, [to.kind === "file" ? to.path : to.url]).catch(() => null);
    }
    cx.notify();
  }

  /** A picture (or a PDF, a table, …) in the preview (nocturne-preview), beside this viewer. */
  showImage(path) {
    const me = this.pane();
    run("preview.open", { path, ...(me ? { pane: me.pane } : {}), ...(this.on ? { on: this.on } : {}) });
  }

  back(cx) {
    const last = this.history.pop();
    if (!last) return;
    this.open(last.path, cx);
    this.scrollY = last.scrollY;
  }

  /** The app's editor (nocturne-editor) beside this viewer; a file on another
   *  machine in $EDITOR in a terminal there. */
  edit() {
    const me = this.pane();
    if (!this.on) return run("editor.open", { path: this.path, ...(me ? { pane: me.pane } : {}) });
    run("terminal.open", { argv: ["sh", "-c", 'exec "${VISUAL:-${EDITOR:-vi}}" "$1"', "edit", this.path], folder: dirname(this.path), place: "left", ...(me ? { pane: me.pane } : {}), ...(this.on ? { on: this.on } : {}) });
  }

  revealFolder() {
    run("pane.split", { edge: "right", px: 280, mod: "nocturne-files", props: { folder: dirname(this.path), on: this.on } });
  }

  // ---- scrolling

  contentH() {
    return this.heights.reduce((a, h) => a + (h ?? 0), 0) + GAP * Math.max(0, this.heights.length - 1) + 64;
  }

  scroll(dy) {
    const max = Math.max(0, this.contentH() - this.viewH);
    this.scrollY = Math.max(0, Math.min(max, this.scrollY + dy));
  }

  /** Scrolls a heading to the top, once the blocks above it are measured. */
  scrollTo(anchor) {
    const i = this.parts.findIndex((p) => p.anchor === anchor);
    if (i < 0) { this.want = null; return; }
    if (this.heights.slice(0, i).some((h) => h == null)) { this.want = anchor; return; }
    this.want = null;
    this.scrollY = 0;
    this.scroll(this.heights.slice(0, i).reduce((a, h) => a + h + GAP, 0) + 24 - 8);
  }

  /** Where block `i` starts, in the document's px. */
  partTop(i) {
    return 20 + this.heights.slice(0, i).reduce((a, h) => a + (h ?? 0) + GAP, 0);
  }

  /** The first block still in view. */
  firstShown() {
    const i = this.parts.findIndex((_, j) => this.partTop(j) + (this.heights[j] ?? 0) > this.scrollY);
    return i < 0 ? 0 : i;
  }

  /** Brings block `i` into view, near the top when it was out of it. */
  reveal(i) {
    const top = this.partTop(i), h = this.heights[i] ?? 0;
    if (top >= this.scrollY && top + Math.min(h, this.viewH / 2) <= this.scrollY + this.viewH - 32) return;
    this.scrollY = 0;
    this.scroll(top - 24);
  }

  /** The last block that starts in view. */
  lastShown() {
    const i = this.parts.findLastIndex((_, j) => this.partTop(j) < this.scrollY + this.viewH);
    return Math.max(0, i);
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
    const here = this.firstShown();
    // The heading at the top already counts as passed going down.
    const at = dir > 0 && this.partTop(here) < this.scrollY + 30 ? here : dir > 0 ? here - 1 : here;
    const i = nextHeading(this.parts, at, dir);
    if (i != null) this.scrollTo(this.parts[i].anchor);
  }

  copyPath(cx) {
    cx.write_to_clipboard?.(this.on ? `${this.on}:${this.path}` : this.path);
  }

  key(e, cx) {
    const k = keyOf(e), m = e.modifiers ?? {};
    if (m.platform || m.alt) return;
    const page = Math.max(80, this.viewH / 2);
    if (k === "tab" && !m.control) this.pickLink(m.shift ? -1 : 1);
    else if (k === "enter" && this.sel != null && !m.control) this.followLink(cx);
    else if (k === "escape" && this.sel != null) this.sel = null;
    else if (k === "escape" && this.keysShown) this.keysShown = false;
    else if (m.control) {
      if (k === "d") this.scroll(page); else if (k === "u") this.scroll(-page); else return;
    } else if (k === "j" || k === "down") this.scroll(60);
    else if (k === "k" || k === "up") this.scroll(-60);
    else if (k === "d" || k === "space" || k === "pagedown") this.scroll(page);
    else if (k === "u" || k === "pageup") this.scroll(-page);
    else if (k === "G" || (k === "g" && m.shift) || k === "end") this.scroll(1e9);
    else if (k === "g" || k === "home") {
      if (k === "home" || Date.now() - (this.gAt ?? 0) < 500) { this.gAt = 0; this.scrollY = 0; } else this.gAt = Date.now();
    } else if (k === "r") { this.raw = !this.raw; this.sel = null; }
    else if (k === "e") this.edit();
    else if (k === "backspace" || k === "h" || k === "left") this.back(cx);
    else if (k === "]" || k === "[") this.heading(k === "]" ? 1 : -1);
    else if (k === "f") this.revealFolder();
    else if (k === "y") this.copyPath(cx);
    else if (k === "?") this.keysShown = !this.keysShown;
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  /** `nocturne-markdown.<command>` (keys.json, `herdr-app do`): every shown viewer takes it. */
  command(c, cx) {
    const page = Math.max(80, this.viewH / 2);
    if (c === "down") this.scroll(page);
    else if (c === "up") this.scroll(-page);
    else if (c === "top") this.scrollY = 0;
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
      .child(this.chip(t, "md-keys", "?", () => { this.keysShown = !this.keysShown; }, Boolean(this.keysShown)))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
  }

  empty(t, title, hint) {
    return v_flex().size_full().items_center().justify_center().gap(10).px(16).text_size(11)
      .child(svg(`${ART}/moon-8.svg`).w(44).h(44).text_color(t.ansi8).opacity(0.6))
      .child(div().text_color(t.foreground).child(title))
      .when(Boolean(hint), (el) => el.child(div().text_center().text_color(t.ansi8).child(hint)));
  }

  imageRow(t, part, i) {
    return v_flex().gap(6).children(part.images.map((img, j) => {
      const local = isLocalSource(img.src);
      const abs = local ? join(dirname(this.path), decodeURI(img.src.split(/[?#]/)[0])) : null;
      const name = abs ? this.images.get(abs) : null;
      // A click shows it whole in the preview.
      if (name) return div().id(`md-imgbox-${i}-${j}`).flex().cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); this.showImage(abs); })
        .child(image(`${IMAGES}/${name}`).id(`md-img-${i}-${j}`).max_w_full().max_h(IMAGE_H));
      const label = name === undefined && local && !this.on ? "loading…" : img.alt || img.src;
      return markdown(t, `md-imgalt-${i}-${j}`, `[▧ ${label.replace(/[[\]]/g, "")}](${img.src})`, { onLink: (url, cx) => this.link(url, cx) })
        .text_color(t.muted);
    }));
  }

  document(t) {
    const onLink = (url, cx) => this.link(url, cx);
    if (this.raw) {
      return v_flex().child(div().on_size_change((size, cx) => this.measured(0, size, cx))
        .child(markdown(t, "md-raw", fenced(this.text), { onLink, size: 12 })));
    }
    if (this.heights.length !== this.parts.length) this.heights = this.parts.map((_, i) => this.heights[i]);
    const chosen = this.links[this.sel]?.part;
    return v_flex().gap(GAP).children(this.parts.map((part, i) => div().id(`md-part-${i}`).relative()
      .on_size_change((size, cx) => this.measured(i, size, cx))
      .when(i === chosen, (el) => el.child(div().absolute().left(-12).top(0).bottom(0).w(2).bg(t.accent)))
      .child(part.kind === "md" ? markdown(t, `md-${i}`, part.text, { onLink, size: 13 }) : this.imageRow(t, part, i))));
  }

  measured(i, size, cx) {
    const h = unzoom(size.height);
    if (Math.abs((this.heights[i] ?? -1) - h) <= 1) return;
    this.heights[i] = h;
    if (this.want) this.scrollTo(this.want);
    this.scroll(0);
    cx.notify();
  }

  /** `?`: the keys, under the bar. */
  keysStrip(t) {
    return h_flex().id("md-keys-strip").relative().flex_none().flex_wrap().px(10).py(4).gap_x(12).gap_y(2).items_center().text_size(11)
      .children(KEYS.map(([keys, what], i) => h_flex().id(`md-key-${i}`).flex_none().gap(4)
        .child(div().text_color(t.accent).child(keys))
        .child(div().text_color(t.dim).child(what))))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
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

  render() {
    const t = theme();
    const focused = this.handle.is_focused();
    let body;
    if (this.error) body = this.empty(t, "Can't show this file", this.error);
    else if (this.text == null) body = this.empty(t, "Reading…", tilde(this.path, home()));
    else {
      if (this.raw && this.heights.length !== 1) this.heights = [this.heights[0]];
      const contentH = this.contentH();
      const max = Math.max(1, contentH - this.viewH), shown = Math.min(1, this.viewH / Math.max(1, contentH));
      body = div().id("md-view").relative().flex_1().min_h(0).overflow_hidden()
        .on_size_change((size, cx) => {
          const h = unzoom(size.height), w = unzoom(size.width);
          if (Math.abs(h - this.viewH) > 1 || Math.abs(w - this.width) > 1) { this.viewH = h; this.width = w; this.scroll(0); cx.notify(); }
        })
        .on_scroll_wheel((e, cx) => { this.scroll(-unzoom(e.delta?.y ?? 0)); cx.notify(); })
        .child(h_flex().absolute().left(0).right(0).top(-this.scrollY).justify_center()
          .child(div().w_full().max_w(WIDTH).px(24).pt(20).pb(44).child(this.document(t))))
        .when(shown < 1, (el) => el.child(div().absolute().right(1).w(3)
          .top(Math.round((this.scrollY / max) * this.viewH * (1 - shown))).h(Math.max(16, Math.round(this.viewH * shown)))
          .child(dither(focused ? t.accent : t.ansi8, 1))))
        .when(!this.raw && this.links[this.sel] != null, (el) => el.child(this.linkBar(t)));
    }
    return v_flex().id("nocturne-markdown").size_full().bg(t.background).text_color(t.foreground).track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => this.handle.focus())
      .child(this.toolbar(t))
      .when(Boolean(this.keysShown), (el) => el.child(this.keysStrip(t)))
      .child(body);
  }
}
