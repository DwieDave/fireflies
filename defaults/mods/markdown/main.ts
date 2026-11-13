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
import type { AsyncContext, Color, Context, Element, FocusHandle, KeyEvent } from "gpui-kit";
import type { Props } from "gpui-shell";
import { h_flex, v_flex } from "gpui-base";
import * as herdr from "herdr";
import type { PaneInfo, Theme } from "herdr";
import { openInEditor } from "./editor-route.ts";
import { props, theme, settings, exec, run, panes, shared, setShared, readTextFile, writeTextFile, watchFolder, nextCommand, home, window as appWindow } from "herdr";
import type { Guarded } from "./guard.ts";
import { isString, nullable, object, readSharedMap, sharedMapKey, writeSharedMap } from "./guard.ts";
import { fenced, isLocalSource, MarkdownDoc, cacheImage, taskToggle } from "./markdown.ts";
import { follow, dirname, basename, join, tilde } from "./paths.ts";
import type { DocLink } from "./links.ts";
import { anchorOf, documentLinks, lastIndex, nextLink, nextHeading } from "./links.ts";
import { keysHint, keysView, keysKey } from "./keyhelp.ts";
import type { KeyRow } from "./keyhelp.ts";
import { fileChanges, newestId, follow as followFiles } from "./follow.ts";

const MOD = "markdown";

// Each viewer's shown file by slot, for its pane header (nocturne/header.js).
const TITLES = sharedMapKey("markdown.titles", isString);

// ... and its path, for the app to find the viewer showing a file (`markdown.open`).
const PATHS = sharedMapKey("markdown.paths", isString);

const ART = "mods/nocturne/art";

// Local images are copied here (under the app's folder, where image() reads).
const IMAGES = "markdown";
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i;

// Links to these open in the preview (preview/kinds.ts KINDS).
const PREVIEW = /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|svg|avif|hei[cf]|pdf|csv|tsv|sqlite3?|db3?|diff|patch|ttf|otf|ttc|woff2?|mp4|m4v|mov|mp3|m4a|aac|wav|aiff?|flac|caf)$/i;
const WIDTH = 780;

// A file on another machine can't be watched: read it this often.
const POLL = 4000;

/** What the viewer is opened with (the app's `markdown.open`: { path, on, slot, anchor? }). */
const isMarkdownProps = object({}, { path: isString, on: nullable(isString), slot: nullable(isString), anchor: isString });

type MarkdownProps = Guarded<typeof isMarkdownProps>;

const NO_PROPS: MarkdownProps = {};

/** A viewer pane's slot, when it is one. */
const slotOf = (p: PaneInfo): string | null => (p.mod === MOD && isMarkdownProps(p.props) ? p.props.slot ?? null : null);

/** `preview.open`'s arguments: the file, beside which pane, on which machine (a type, not an
 *  interface: `run` takes a record). */
type PreviewOpen = {
  path: string;
  pane?: string;
  on?: string;
};

/** `terminal.open`'s arguments for $EDITOR on another machine's file. */
type TerminalOpen = {
  readonly argv: readonly string[];
  readonly folder: string;
  readonly place: "left";
  readonly on: string;
  pane?: string;
};

/** Where ‹ goes back to: a file and how far down it was. */
interface Visited {
  readonly path: string;
  readonly scrollY: number;
}

/** A local image's place, and its name in the app's cache: undefined while it's copied, null when it can't be. */
interface ImageSpot {
  readonly abs: string | null;
  readonly name: string | null | undefined;
}

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
const zoom = (): number => settings().zoom || 1;
const unzoom = (v: number): number => v / zoom();

/** A 50% checker dither filling the parent (same as ../nocturne/kit.js). */
function dither(color: Color, cell = 1): Element {
  const dpr = appWindow().platform === "macos" ? 2 : 1;

  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr)))).absolute().top(0).left(0).size_full();
}

/** A key's name: the typed character for printable keys ("G", "?", "]"), else GPUI's key. */
function keyOf(e: KeyEvent): string {
  const typed = e.key_char;

  return typed && typed.length === 1 && typed.trim() ? typed : e.key;
}

// What `?` lists.
// Every key key() takes, ? keys last.
export const KEYS: readonly KeyRow[] = [["j k  ↑ ↓", "scroll"], ["d u  ctrl-d ctrl-u", "half a page down / up"], ["space  pgdn pgup", "half a page down · down / up"],
  ["gg G  home end", "top / bottom"], ["tab ⇧tab", "links"], ["enter", "follow"], ["] [", "headings"], ["h ←  ⌫", "back"],
  ["r", "raw"], ["e", "edit"], ["f", "files"], ["y", "copy path"], ["esc", "off the link · keys away"], ["?", "keys"]];

export default class Markdown extends View {
  on: string | null = null;
  slot: string | null = null;
  handle: FocusHandle | null = null;
  raw = false;
  history: Visited[] = [];
  images = new Map<string, string | null | undefined>(); // abs path -> cache name | null (can't) | undefined (copying)
  doc = new MarkdownDoc("md");
  rawDoc = new MarkdownDoc("md-raw");
  width = 600;
  seenChange = 0;
  path = "";
  text: string | null = null;
  error: string | null = null;
  links: DocLink[] = [];

  /** The chosen link's index (tab / shift-tab), null: none. */
  sel: number | null = null;
  gen = 0;
  keysShown = false;

  /** When g was last pressed (gg goes to the top). */
  gAt = 0;

  override init(p: Props | undefined, cx: AsyncContext): void {
    const given = props() ?? p;
    const pr = isMarkdownProps(given) ? given : NO_PROPS;
    const handle = cx.focus_handle();

    this.on = pr.on ?? null;
    this.slot = pr.slot ?? null;
    this.handle = handle;

    // Renamed or moved from the files pane (follow.ts): the viewer follows,
    // only what comes after this start.
    this.seenChange = newestId(fileChanges(shared));
    this.open(pr.path ?? "", cx, pr.anchor);

    if (this.on) cx.timer.every(POLL, (cx) => this.load(cx));

    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();

        if (c === "focus") handle.focus();
        else this.command(c, cx);

        cx.notify();
      }
    });
  }

  // ---- the file

  /** Shows `path` (scrolled to `anchor`), from the top unless `keep`. */
  open(path: string, cx: Context, anchor?: string | null, keep?: boolean): void {
    this.path = path;
    this.text = null;
    this.error = null;
    this.doc.setText(null);
    this.rawDoc.setText(null);
    this.links = [];
    this.sel = null;

    if (!keep) {
      this.doc.scrollY = 0;
      this.rawDoc.scrollY = 0;
    }

    this.doc.want = anchor || null;
    this.gen = (this.gen ?? 0) + 1;
    this.title();
    this.load(cx);

    if (!this.on && path) this.watch(cx, this.gen);
  }

  /** Reads the file again; the scroll stays where it was. */
  load(cx: Context): void {
    const path = this.path, gen = this.gen;

    if (!path) {
      this.error = "No file given";

      return;
    }

    cx.spawn(async (cx) => {
      let text: string | null = null, error: string | null = null;

      try {
        text = await readTextFile(path, { on: this.on });

        if (text === null) error = "It isn't there (moved or deleted?)";
        else if (text.includes("\0")) {
          text = null;
          error = "Not a text file";
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }

      if (gen !== this.gen) return;

      if (text === this.text && error === this.error) return;

      this.text = text;
      this.error = error;
      this.doc.setText(text);
      this.links = documentLinks(this.doc.parts);

      if (this.sel !== null && this.sel >= this.links.length) this.sel = null;

      this.rawDoc.setText(text === null ? null : fenced(text));

      if (this.doc.want) this.doc.scrollTo(this.doc.want);

      this.loadImages(cx);
      cx.notify();
    });
  }

  /** Waits for the file's folder to change, and reads the file again. */
  watch(cx: Context, gen: number): void {
    const dir = dirname(this.path);

    cx.spawn(async (cx) => {
      while (gen === this.gen) {
        let changed: string[];

        try {
          changed = await watchFolder(dir);
        } catch {
          return;
        }

        if (gen !== this.gen) return;

        // Reported paths may be spelled another way (/tmp vs /private/tmp): any
        // change here reads the file again, which redraws only when it differs.
        this.load(cx);

        const names = new Set(changed.map((c) => basename(c)));
        const stale = [...this.images.keys()].filter((p) => names.has(basename(p)));

        if (stale.length) {
          for (const p of stale) this.images.delete(p);

          this.loadImages(cx);
        }
      }
    });
  }

  /** A local image's source as a path beside the shown file. */
  local(src: string): string {
    return join(dirname(this.path), decodeURI(src.split(/[?#]/)[0] ?? ""));
  }

  loadImages(cx: Context): void {
    if (this.on) return;

    for (const part of this.doc.parts) {
      if (part.kind !== "images") continue;

      for (const img of part.images) {
        if (!isLocalSource(img.src)) continue;

        const abs = this.local(img.src);

        if (this.images.has(abs)) continue;

        if (!IMAGE_EXT.test(abs)) {
          this.images.set(abs, null);

          continue;
        }

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
  followChanges(cx: Context): void {
    const list = fileChanges(shared);
    const r = followFiles(list, this.seenChange, this.path, this.on);

    this.history = this.history.map((h) => (h.path ? { ...h, path: followFiles(list, this.seenChange, h.path, this.on).path } : h));
    this.seenChange = r.seen;

    if (r.path !== this.path) this.open(r.path, cx, null, true);

    cx.notify();
  }

  /** Tells the pane header which file this viewer shows. */
  title(): void {
    const slot = this.slot;

    if (!slot) return;

    const live = new Set(panes().flatMap((p) => {
      const s = slotOf(p);

      return s ? [s] : [];
    }));

    const kept = (map: ReadonlyMap<string, string>) => new Map([...map].filter(([k]) => live.has(k)));
    const was = readSharedMap(shared, TITLES);
    const name = this.path ? basename(this.path) : "Markdown";

    // Its path too, so clicking a link to the file it moved on to finds this viewer.
    const paths = readSharedMap(shared, PATHS);

    if (paths.get(slot) !== this.path || [...paths.keys()].some((k) => !live.has(k) && k !== slot)) {
      writeSharedMap(setShared, PATHS, kept(paths).set(slot, this.path));
    }

    if (was.get(slot) === name && [...was.keys()].every((k) => live.has(k) || k === slot)) return;

    writeSharedMap(setShared, TITLES, kept(was).set(slot, name));
  }

  /** This viewer's pane. */
  pane(): PaneInfo | null {
    const slot = this.slot;

    return panes().find((p) => slot !== null && slotOf(p) === slot) ?? null;
  }

  // ---- links and actions

  link(href: string, cx: Context): void {
    const to = follow(href, this.path);

    if (!to) return;

    if (to.kind === "anchor") this.doc.scrollTo(to.anchor);
    else if (to.kind === "markdown") {
      if (to.path === this.path) {
        if (to.anchor) this.doc.scrollTo(to.anchor);
      } else {
        this.history.push({ path: this.path, scrollY: this.doc.scrollY });
        this.open(to.path, cx, to.anchor);
      }
    } else if (to.kind === "web") run("app.open_url", { url: to.url });
    else if (to.kind === "file" && PREVIEW.test(to.path)) this.showImage(to.path);
    else if (!this.on) {
      const platform = appWindow().platform;
      const opener = platform === "windows" ? null : platform === "macos" ? "open" : "xdg-open";

      if (opener) exec(opener, [to.kind === "file" ? to.path : to.url]).catch(() => null);
    }

    cx.notify();
  }

  /** A picture (or a PDF, a table, …) in the preview (preview), beside this viewer. */
  showImage(path: string): void {
    const me = this.pane();
    const args: PreviewOpen = { path };

    if (me) args.pane = me.pane;

    if (this.on) args.on = this.on;

    run("preview.open", args);
  }

  back(cx: Context): void {
    const last = this.history.pop();

    if (!last) return;

    this.open(last.path, cx);
    this.doc.scrollY = last.scrollY;
  }

  /** Ticks or unticks a task in the file itself (only over what was read). */
  tick(line: number, cx: Context): void {
    if (this.on || this.text === null) return;

    const edit = taskToggle(this.text, line);

    if (!edit) return;

    const lines = this.text.split("\n");
    const l = lines[line];

    if (l === undefined) return;

    lines[line] = l.slice(0, edit.col) + edit.text + l.slice(edit.col + 1);

    const next = lines.join("\n"), was = this.text;

    this.text = next;
    this.doc.setText(next);
    this.rawDoc.setText(fenced(next));
    cx.notify();
    writeTextFile(this.path, next, was).catch(() => {
      this.load(cx);
    });
  }

  /** The app's editor (editor) in this viewer's place, its Markdown
   *  preview on (split): a tab of the tab's editor when it has one
   *  (editor-route.ts), else a new editor opened beside this viewer, which
   *  then closes so the editor takes its room. A file on another machine:
   *  $EDITOR in a terminal beside. */
  edit(): void {
    const me = this.pane();

    if (!this.on) {
      openInEditor(herdr, { path: this.path, pane: me?.pane ?? null, view: "split" });

      if (me) run("pane.close", { pane: me.pane });

      return;
    }

    const args: TerminalOpen = {
      argv: ["sh", "-c", 'exec "${VISUAL:-${EDITOR:-vi}}" "$1"', "edit", this.path], folder: dirname(this.path), place: "left", on: this.on,
    };

    if (me) args.pane = me.pane;

    run("terminal.open", args);
  }

  revealFolder(): void {
    run("pane.split", { edge: "right", px: 280, mod: "file-tree", props: { folder: dirname(this.path), on: this.on } });
  }

  // ---- scrolling

  /** The document on screen: rendered, or the raw text. */
  shown(): MarkdownDoc {
    return this.raw ? this.rawDoc : this.doc;
  }

  scroll(dy: number): void {
    this.shown().scroll(dy);
  }

  /** Brings block `i` into view, near the top when it was out of it. */
  reveal(i: number): void {
    const doc = this.doc, top = doc.tops().tops[i], part = doc.parts[i];

    if (top === undefined || part === undefined) return;

    const h = doc.height(part);

    if (top >= doc.scrollY && top + Math.min(h, doc.viewH / 2) <= doc.scrollY + doc.viewH - 32) return;

    doc.setScroll(top - 24);
  }

  /** The first block still in view, and the last that starts in view. */
  firstShown(): number {
    const d = this.doc, { tops } = d.tops();

    const i = d.parts.findIndex((p, j) => {
      const top = tops[j];

      return top !== undefined && top + d.height(p) > d.scrollY;
    });

    return i < 0 ? 0 : i;
  }

  lastShown(): number {
    const d = this.doc, { tops } = d.tops();

    return Math.max(0, lastIndex(tops, (top) => top < d.scrollY + d.viewH));
  }

  /** The chosen link, if any. */
  chosenLink(): DocLink | undefined {
    return this.sel === null ? undefined : this.links[this.sel];
  }

  /** tab / shift-tab: the next / previous link, from the ones in view. */
  pickLink(dir: number): void {
    if (this.raw || !this.links.length) return;

    this.sel = nextLink(this.links, this.sel, dir, dir > 0 ? this.firstShown() : this.lastShown());

    const l = this.chosenLink();

    if (l) this.reveal(l.part);
  }

  /** enter: where the chosen link goes. */
  followLink(cx: Context): void {
    const l = this.chosenLink();

    if (!l) return;

    this.sel = null;

    const local = l.image && isLocalSource(l.href) && !this.on;

    if (local) this.showImage(this.local(l.href));
    else this.link(l.href, cx);
  }

  /** ] / [: the next / previous heading to the top. */
  heading(dir: number): void {
    const d = this.doc, here = this.firstShown();

    // The heading at the top already counts as passed going down.
    const top = d.tops().tops[here];
    const at = dir > 0 && top !== undefined && top < d.scrollY + 30 ? here : dir > 0 ? here - 1 : here;
    const i = nextHeading(d.parts, at, dir);
    const anchor = i === null ? undefined : anchorOf(d.parts[i]);

    if (anchor !== undefined) d.scrollTo(anchor);
  }

  copyPath(cx: Context): void {
    cx.write_to_clipboard(this.on ? `${this.on}:${this.path}` : this.path);
  }

  key(e: KeyEvent, cx: Context): void {
    const k = keyOf(e), m = e.modifiers;

    if (m.platform || m.alt) return;

    // ? opens the keys over the page, ? esc q close them; meanwhile they take every key (keyhelp.ts).
    const help = keysKey(e, this.keysShown);

    if (help || this.keysShown) {
      if (help) this.keysShown = help === "toggle" ? !this.keysShown : false;

      cx.stop_propagation();
      cx.notify();

      return;
    }

    const page = Math.max(80, this.shown().viewH / 2);

    if (k === "tab" && !m.control) this.pickLink(m.shift ? -1 : 1);
    else if (k === "enter" && this.sel !== null && !m.control) this.followLink(cx);
    else if (k === "escape" && this.sel !== null) this.sel = null;
    else if (m.control) {
      if (k === "d") this.scroll(page);
      else if (k === "u") this.scroll(-page);
      else return;
    } else if (k === "j" || k === "down") this.scroll(60);
    else if (k === "k" || k === "up") this.scroll(-60);
    else if (k === "d" || k === "space" || k === "pagedown") this.scroll(page);
    else if (k === "u" || k === "pageup") this.scroll(-page);
    else if (k === "G" || (k === "g" && m.shift) || k === "end") this.scroll(1e9);
    else if (k === "g" || k === "home") {
      if (k === "home" || Date.now() - this.gAt < 500) {
        this.gAt = 0;
        this.shown().scrollY = 0;
      } else this.gAt = Date.now();
    } else if (k === "r") {
      this.raw = !this.raw;
      this.sel = null;
    } else if (k === "e") this.edit();
    else if (k === "backspace" || k === "h" || k === "left") this.back(cx);
    else if (k === "]" || k === "[") this.heading(k === "]" ? 1 : -1);
    else if (k === "f") this.revealFolder();
    else if (k === "y") this.copyPath(cx);
    else return;

    cx.stop_propagation();
    cx.notify();
  }

  /** `markdown.<command>` (keys.json, `herdr-app do`): every shown viewer takes it. */
  command(c: string, cx: Context): void {
    if (c === "keys" || c === "markdown.keys") {
      this.keysShown = !this.keysShown;

      return;
    }

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

  chip(t: Theme, id: string, label: string, action: (cx: Context) => void, on = false): Element {
    return h_flex().id(id).relative().h(20).px(6).flex_none().items_center()
      .text_color(on ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        action(cx);
        cx.notify();
      })
      .when(on, (el) => el.child(dither(t.ansi0, 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)))
      .child(div().relative().child(label));
  }

  toolbar(t: Theme): Element {
    const w = this.width;

    return h_flex().id("md-toolbar").relative().h(34).flex_none().px(10).gap(8).items_center().text_size(11)
      .when(w >= 320, (el) => el.child(div().flex_none().text_color(t.ansi8).child("MD")))
      .when(this.history.length > 0, (el) => el.child(this.chip(t, "md-back", "‹", (cx) => this.back(cx))))
      .child(h_flex().flex_1().min_w(0).gap(6).items_baseline()
        .child(div().flex_none().max_w_full().truncate().text_color(t.foreground).child(basename(this.path || "Markdown")))
        .when(w >= 420 && Boolean(this.path), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim)
          .child(`${this.on ? this.on + ":" : ""}${tilde(dirname(this.path), home())}`))))
      .child(this.chip(t, "md-raw", this.raw ? "raw" : "rendered", () => {
        this.raw = !this.raw;
      }, this.raw))
      .when(Boolean(this.path), (el) => el
        .child(this.chip(t, "md-edit", "edit", () => this.edit()))
        .when(w >= 300, (e2) => e2.child(this.chip(t, "md-files", "files", () => this.revealFolder()))))
      .child(keysHint(t, "md-keys", Boolean(this.keysShown), () => {
        this.keysShown = !this.keysShown;
      }).ml(4))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(dither(t.ansi0, 1)));
  }

  empty(t: Theme, title: string, hint: string): Element {
    return v_flex().size_full().items_center().justify_center().gap(10).px(16).text_size(11)
      .child(svg(`${ART}/moon-8.svg`).w(44).h(44).text_color(t.ansi8).opacity(0.6))
      .child(div().text_color(t.foreground).child(title))
      .when(Boolean(hint), (el) => el.child(div().text_center().text_color(t.ansi8).child(hint)));
  }

  /** A local image's place and its name in the cache (undefined while copying). */
  image(src: string): ImageSpot {
    if (!isLocalSource(src)) return { abs: null, name: null };

    const abs = this.local(src);
    const name = this.images.get(abs);

    return { abs: this.on ? null : abs, name: name ? `cache/${IMAGES}/${name}` : name };
  }

  /** `?`: every key, in the page's place (keyhelp.ts). */
  keysStrip(t: Theme): Element {
    return keysView(t, {
      id: "md-keys-strip", title: "markdown", list: KEYS, close: () => {
        this.keysShown = false;
      },
    });
  }

  /** The chosen link, at the foot of the page: what it says and where it goes. */
  linkBar(t: Theme, l: DocLink, sel: number): Element {
    return h_flex().id("md-link").absolute().left(0).right(0).bottom(0).h(24).px(10).gap(8).items_center().text_size(11).bg(t.background)
      .child(div().absolute().left(0).right(0).top(0).h(2).child(dither(t.ansi0, 1)))
      .child(div().flex_none().text_color(t.accent).child("enter"))
      .child(div().flex_none().max_w(260).truncate().text_color(t.foreground).child(`${l.image ? "▧ " : ""}${l.text}`))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(l.href))
      .child(div().flex_none().text_color(t.dim).child(`${sel + 1}/${this.links.length}`));
  }

  /** The page: the file rendered (or raw), or why it can't be. */
  body(t: Theme): Element {
    if (this.error) return this.empty(t, "Can't show this file", this.error);

    if (this.text === null) return this.empty(t, "Reading…", tilde(this.path, home()));

    const doc = this.shown();
    const l = this.raw ? undefined : this.chosenLink();
    const chosen = l === undefined ? null : this.doc.parts[l.part]?.key ?? null;
    const focused = this.handle?.is_focused() ?? false;

    this.width = doc.width;

    const page = v_flex().id("md-body").relative().flex_1().min_h(0).child(doc.render(t, {
      onLink: (url, cx) => this.link(url, cx),
      onTask: (line, cx) => this.tick(line, cx),
      image: (src) => this.image(src),
      onImage: (abs) => {
        if (abs !== null) this.showImage(abs);
      },
      dither: (color) => dither(color, 1),
      focused, size: this.raw ? 12 : 13, maxWidth: WIDTH, unzoom, notify: (cx) => cx.notify(), chosen,
    }));

    return l === undefined || this.sel === null ? page : page.child(this.linkBar(t, l, this.sel));
  }

  override render(cx: Context): Element {
    const t = theme();
    const handle = this.handle;

    // A newer rename or move from the files pane: answered after this render.
    if (newestId(fileChanges(shared)) > this.seenChange) cx.timer.after(0, (cx) => this.followChanges(cx));

    const view = v_flex().id("markdown").relative().size_full().bg(t.background).text_color(t.foreground);

    return (handle ? view.track_focus(handle).on_mouse_down("left", () => handle.focus()) : view)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(this.toolbar(t))
      // ?: the keys in the page's place, the toolbar stays (keyhelp.ts).
      .child(this.keysShown ? div().relative().flex_1().min_h(0).child(this.keysStrip(t)) : this.body(t));
  }
}
