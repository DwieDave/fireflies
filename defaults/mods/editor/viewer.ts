// The preview's viewer: reads a file and draws it, kind by kind (kinds.ts).
// The preview pane (main.ts, its keys and commands described there) is this
// view; the files pane's preview split (file-tree) and the editor's drawn tabs
// mount it as a nested view with props { embedded: true, path, on }. A mod can
// import only its own files, so file-tree and editor ship this file and the
// ones it imports (its parts, viewer-*.ts: state, load, text, table, native,
// pan, keys, bars, views; and kinds.ts, image.ts, table.ts, diff.ts, keys.ts,
// keyhelp.ts, guard.ts, file-icons.ts) unchanged; scripts/preview-shared.test.ts
// fails when the copies differ: edit preview's and copy them over.
//
// Embedded, it's a look, not a place to work: no keyboard of its own (the
// tree keeps it), a slim bar (kind, name, facts), no folder stepping, no
// commands. It shows text too (code highlighted as the editor colors it,
// Markdown rendered, any other text plain), the first LOOK_BYTES of it;
// binaries without a viewer and unreadable files say why in one line. On
// another machine only what is text is read (a capped `head`); pictures,
// PDFs, fonts and clips say so instead of fetching the file. The host steps
// it through props: { path, on, scroll: { n, dir } } (J / K in the tree),
// { reload: n } (the folder changed).

import { View, div } from "gpui-kit";
import type { AsyncContext, Color, Context, Element, FocusHandle, KeyEvent, ScrollWheelEvent } from "gpui-kit";
import type { Props } from "gpui-shell";
import { v_flex } from "gpui-base";
import * as herdr from "herdr";
import { props, theme, nextCommand, appHome } from "herdr";
import type { Theme } from "herdr";
import type { Guarded } from "./guard.ts";
import { parseJson } from "./guard.ts";
import type { LookKind } from "./kinds.ts";
import { route } from "./kinds.ts";
import type { Size, View as Look } from "./image.ts";
import { clampPan } from "./image.ts";
import type { Table } from "./table.ts";
import type { Patch } from "./diff.ts";
import { fileStarts } from "./diff.ts";
import type { TextLook, Db, ViewerProps, Done, How, Info, Copy, PdfFacts, Chip, Drag, Wrapped } from "./viewer-state.ts";
import { held, isViewerProps, POLL, sh, CACHE, nativeViews, isNativeEvent, MOD, pointOf } from "./viewer-state.ts";
import { drawCopy, listFolder, loadPath, openPath, rasterPageOf, titleOf } from "./viewer-load.ts";
import { scrollLook, wrappedRows, maxScroll } from "./viewer-text.ts";
import { colStartsOf, gutterOf, pickTableOf, tableWidthOf, visibleRowsOf } from "./viewer-table.ts";
import { actNative, onNativeEvent } from "./viewer-native.ts";
import { current, editFile, imgOf, pannable, resized } from "./viewer-pan.ts";
import { keyDown, runCommand, wheelBy } from "./viewer-keys.ts";
import { drawKeysStrip, drawLookBar, drawStrip, drawToolbar } from "./viewer-bars.ts";
import { innerView, pressAt } from "./viewer-views.ts";

export default class Viewer extends View {
  get text(): TextLook | null { return held(this).text; }
  set text(v: TextLook | null) { held(this).text = v; }
  get grid(): Table | null { return held(this).grid; }
  set grid(v: Table | null) { held(this).grid = v; }
  get patch(): Patch | null { return held(this).patch; }
  // Where each of its files starts, for } / {, worked out with it.
  set patch(v: Patch | null) {
    const h = held(this);

    h.patch = v;
    h.starts = v ? fileStarts(v.rows) : [];
  }
  get db(): Db | null { return held(this).db; }
  set db(v: Db | null) { held(this).db = v; }

  embedded = false;
  on: string | null = null;
  slot: string | null = null;
  handle: FocusHandle | null = null;
  port: Size = { width: 0, height: 0 };
  checker = true;
  names: string[] = [];
  copied = 0;
  // The embedded viewer's props: asked (the latest), seen (applied from a render), done.
  asked: ViewerProps = {};
  seen: ViewerProps | null = null;
  done: Done = { path: null, on: null, scroll: null, reload: null };
  path = "";
  kind: LookKind | null = null;
  how: How | null = null;
  info: Info | null = null;
  error: string | null = null;
  busy: string | null = null;
  src: string | null = null;
  copy: Copy | null = null;
  view: Look | null = null;
  note: string | null = null;
  pdf: PdfFacts | null = null;
  media: { readonly duration: number } | null = null;
  page = 1;
  pages = 0;
  sy = 0;
  sx = 0;
  cursor = 0;
  stamp: string | null = null;
  gen = 0;
  // A native view's file, and its revision (a new one loads it again).
  local: string | null = null;
  rev: string | null = null;
  drawing = 0;
  still = false;
  pdfAsk = 0;
  keysShown = false;
  ring: string | null = null;
  chips: Chip[] = [];
  focusedNow = false;
  drag: Drag | null = null;
  colors: ReadonlyMap<string, Color> | null = null;

  override init(p: Props | undefined, cx: AsyncContext): void {
    // Embedded (the files pane's split): its props come from the pane that mounts it.
    const given: ViewerProps = isViewerProps(p) ? p : {};
    const own = props();

    this.embedded = given.embedded === true;

    const pr: ViewerProps = this.embedded ? given : isViewerProps(own) ? own : given;

    this.on = pr.on ?? null;
    this.slot = pr.slot ?? null;
    this.handle = cx.focus_handle();

    if (this.embedded) {
      // The host steps it (update); its pane keeps the keyboard and the commands.
      this.asked = pr;
      this.seen = pr;
      this.apply(cx);
    } else this.open(pr.path ?? "", cx);

    if (this.on && !this.embedded) {
      cx.timer.every(POLL, (cx) => {
        loadPath(this, cx);
        listFolder(this, cx);
      });
    }

    // Copies nobody looked at for a week go.
    if (!this.on && pr.path && !this.embedded) void sh('[ -d "$1" ] && find "$1" -type f -mtime +7 -delete', [`${appHome()}/${CACHE}`]);

    if (!this.embedded) {
      cx.spawn(async (cx) => {
        for (;;) {
          const c = (await nextCommand()).replace(/^preview\./, "");

          if (c === "focus") this.handle?.focus();
          else this.command(c, cx);

          cx.notify();
        }
      });
    }

    if (nativeViews()) {
      cx.spawn(async (cx) => {
        for (;;) {
          let text: string;

          try {
            text = await herdr.nextNativeViewEvent();
          } catch {
            return;
          }

          const e = parseJson(text, isNativeEvent);

          if (!e) continue;

          this.nativeEvent(e, cx);
          cx.notify();
        }
      });
    }
  }

  // ---- embedded: the host's props

  /** New props from the pane that mounts it: applied on the next render (an
   *  update has no context to load with). */
  override update(p: Props | undefined): void {
    this.asked = isViewerProps(p) ? p : {};
  }

  /** What the props ask that isn't done yet: another file (or none), a
   *  scroll from the tree's J / K, a reload after the folder changed. */
  apply(cx: Context): void {
    const a = this.asked;
    const d = this.done;
    const path = a.path ?? null;
    const on = a.on ?? null;
    const reload = a.reload ?? null;

    if (path !== d.path || on !== d.on) {
      d.path = path;
      d.on = on;
      this.on = on;

      if (path) this.open(path, cx);
      else this.clear();
    } else if (reload !== null && reload !== d.reload && this.path) loadPath(this, cx);

    d.reload = reload;

    if (a.scroll && a.scroll.n !== d.scroll) {
      d.scroll = a.scroll.n;

      if (this.path) scrollLook(this, a.scroll.dir, cx);
    } else if (a.scroll) d.scroll = a.scroll.n;
  }

  /** Nothing shown (a folder picked, the split closed): a native view goes. */
  clear(): void {
    this.dropNative(null);
    this.path = "";
    this.kind = null;
    this.how = null;
    this.info = null;
    this.error = null;
    this.src = null;
    this.copy = null;
    this.busy = null;
    this.view = null;
    this.note = null;
    this.grid = null;
    this.patch = null;
    this.db = null;
    this.pdf = null;
    this.media = null;
    this.text = null;
    this.gen += 1;
  }

  /** A native view (PDF, player, Quick Look) about to show something it
   *  can't: released, else it would stay where it was last drawn. */
  dropNative(nextKind: LookKind | null): void {
    if (this.how?.how !== "native") return;

    const next = nextKind ? route(nextKind, { native: nativeViews() }) : null;

    if (next?.how !== "native" || next.view !== this.how.view) actNative(this, "dispose");
  }

  // ---- the file

  /** Shows `path` from the start (a picture fitted, a table at its top). */
  open(path: string, cx: Context): void {
    return openPath(this, path, cx);
  }

  /** One PDF page as a PNG in the cache, then shown as a picture. */
  async rasterPage(cx: Context, gen: number): Promise<void> {
    return rasterPageOf(this, cx, gen);
  }

  /** How far text or Markdown scrolls (element px). */
  maxScroll(): number {
    return maxScroll(this);
  }

  /** Embedded: J / K in the tree. Text, Markdown, tables and patches move
   *  half a view; a PDF a page; a picture larger than the view pans. */
  scrollLook(dir: number, cx: Context): void {
    scrollLook(this, dir, cx);
  }

  /** Text: the line numbers' column, and the lines soft-wrapped to the view's
   *  width (a narrow panel shows whole lines, no sideways scrolling). */
  wrapped(x: TextLook): Wrapped & { readonly rows: number } {
    return wrappedRows(this, x);
  }

  pickTable(i: number, cx: Context): void {
    return pickTableOf(this, i, cx);
  }

  /** What image() draws: the copy itself, or (turned, or a vector) a wrapper SVG around it. */
  async draw(cx: Context): Promise<void> {
    return drawCopy(this, cx);
  }

  /** Tells the pane header which file this preview shows, and the app which path. */
  title(): void {
    return titleOf(this);
  }

  // ---- native views (PDF, fonts, media)

  nativeEvent(e: Guarded<typeof isNativeEvent>, cx: Context): void {
    return onNativeEvent(this, e, cx);
  }

  // ---- actions

  edit(): void {
    return editFile(this);
  }

  // ---- pages (PDF)

  // ---- zoom and pan (pictures, a PDF page drawn as one)

  /** The picture's size as shown. */
  img(): Size {
    return imgOf(this);
  }

  // ---- rows (tables, patches)

  /** Rows that fit under the header, in element px. */
  visibleRows(): number {
    return visibleRowsOf(this);
  }

  /** The row numbers' column. */
  gutter(): number {
    return gutterOf(this);
  }

  /** How wide the table's columns are together. */
  tableWidth(): number {
    return tableWidthOf(this);
  }

  /** Where each column starts, for h / l. */
  colStarts(): number[] {
    return colStartsOf(this);
  }

  key(e: KeyEvent, cx: Context): void {
    return keyDown(this, e, cx);
  }

  /** `preview.<command>` (keys.json, `herdr-app do`): every shown preview takes it. */
  command(c: string, cx: Context): void {
    return runCommand(this, c, cx);
  }

  wheel(e: ScrollWheelEvent, cx: Context): void {
    return wheelBy(this, e, cx);
  }

  // ---- parts

  /** `?`: the keys that do something here, in the file's place (keyhelp.ts): a
   *  native view (a PDF, a video) would draw over anything laid on it. */
  keysStrip(t: Theme): Element {
    return drawKeysStrip(this, t);
  }

  // ---- embedded: text, Markdown, the slim bar

  /** The look's bar: the kind (a language for code), the name, the facts, what's left out. */
  lookBar(t: Theme): Element {
    return drawLookBar(this, t);
  }

  override render(cx: Context): Element {
    const t = theme();

    // Embedded: what the host's props ask is applied from a timer (render can't load).
    if (this.embedded && this.asked !== this.seen) {
      const asked = this.asked;

      this.seen = asked;
      cx.timer.after(0, (cx) => {
        if (this.asked === asked) {
          this.apply(cx);
          cx.notify();
        }
      });
    }

    const focused = !this.embedded && this.handle?.is_focused() === true;

    this.focusedNow = focused;
    this.chips = [];
    // Fitted before the bar shows its scale.
    current(this);

    // Drawn first so tab goes bar, then strip, then the body's controls.
    const bar = this.embedded ? this.lookBar(t) : drawToolbar(this, t);
    const strip = this.error || this.busy || this.embedded ? null : drawStrip(this, t);
    const inner = innerView(this, t, focused);
    const frame = div().id("preview-view").relative().flex_1().min_h(0).overflow_hidden();

    const body = (pannable(this) ? (this.drag ? frame.cursor_grabbing() : frame.cursor_grab()) : frame)
      .on_size_change((size, cx) => resized(this, size, cx))
      .on_scroll_wheel((e, cx) => this.wheel(e, cx))
      .on_mouse_down("left", (e, cx) => pressAt(this, e, cx))
      .on_mouse_move((e, cx) => {
        const at = pointOf(e);
        const d = this.drag;

        if (!d || !at || !this.view) return;

        this.view = clampPan({ ...this.view, fit: false, x: d.x + at.x - d.from.x, y: d.y + at.y - d.from.y }, this.img(), this.port);
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => {
        if (this.drag) {
          this.drag = null;
          cx.notify();
        }
      })
      .on_hover((over, cx) => {
        if (!over && this.drag) {
          this.drag = null;
          cx.notify();
        }
      })
      .children(inner);

    if (this.embedded) return v_flex().id("look").size_full().bg(t.background).text_color(t.foreground).child(bar).child(body);

    const root = v_flex().id(MOD).size_full().bg(t.background).text_color(t.foreground);

    return (this.handle ? root.track_focus(this.handle) : root)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(bar)
      .when(Boolean(strip) && !this.keysShown, (el) => (strip ? el.child(strip) : el))
      .when(this.keysShown, (el) => el.child(this.keysStrip(t)))
      // Under the keys the file folds away, still there (a native view hides, kept).
      .child(this.keysShown ? div().h(0).flex_none().overflow_hidden().child(body) : body);
  }
}
