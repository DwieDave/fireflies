// The preview's viewer: reads a file and draws it, kind by kind (kinds.ts).
// The preview pane (main.js, its keys and commands described there) is this
// view; the files pane's preview split (file-tree) and the editor's drawn tabs
// mount it as a nested view with props { embedded: true, path, on }. A mod can
// import only its own files, so file-tree and editor ship this file and the
// ones it imports (kinds.ts, image.ts, table.ts, diff.ts, keys.ts, keyhelp.ts,
// guard.ts) unchanged; scripts/preview-shared.test.ts fails when the copies
// differ: edit preview's and copy them over.
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

import { View, div, svg, image, PathBuilder, Background } from "gpui-kit";
import type { AsyncContext, Color, Context, Element, FocusHandle, KeyEvent, Modifiers, MouseButtonEvent, Point, ScrollWheelEvent } from "gpui-kit";
import type { Props } from "gpui-shell";
import { h_flex, v_flex, TextView } from "gpui-base";
import * as herdr from "herdr";
import { props, theme, settings, exec, run, panes, shared, setShared, watchFolder, nextCommand, home, appHome, writeTextFile, highlight, languageOf, window as appWindow } from "herdr";
import type { ExecResult, PaneInfo, Theme } from "herdr";
import type { Guard, Guarded } from "./guard.ts";
import { isBoolean, isNull, isNumber, isString, isUndefined, object, oneOf, parseJson, readSharedMap, sharedMapKey, writeSharedMap } from "./guard.ts";
import type { LookKind, Route, Run } from "./kinds.ts";
import { kindOf, lookKind, sniffKind, route, toolsFor, rasterArgv, pageCount, duration, tag, noun, siblings, stepIn, fileSize, count, syntaxColors, lineStarts, lineRuns, wrapRows, rowLine, sliceRuns } from "./kinds.ts";
import type { Converter, Format, Size, View as Look } from "./image.ts";
import { formatOf, hexBytes, sniff, sizeFromFile, plan, cantShow, fitted, fitScale, clampPan, zoomTo, step, panBy, rotate, placed, percent, wrapper, sharpness, turned } from "./image.ts";
import type { Column, DbTable, Separator, Table } from "./table.ts";
import { MAX_BYTES, MAX_ROWS, separator, parse as parseTable, table, oneLine, wholeLines, shownNote, SQLITE_ARGS, TABLES_SQL, rowsSql, countSql, tablesOf, sqliteError } from "./table.ts";
import type { Patch, PatchRow } from "./diff.ts";
import { parse as parsePatch, fileStarts, nextFile } from "./diff.ts";
import { keyOf, keyList, cycle } from "./keys.ts";
import { keysHint, keysView, keysKey } from "./keyhelp.ts";

const MOD = "preview";

// Each preview's shown file by slot: its name for the pane header
// (nocturne/header.js), its path so a second click on it finds this preview.
const TITLES = sharedMapKey(`${MOD}.titles`, isString);
const PATHS = sharedMapKey(`${MOD}.paths`, oneOf(isString, isNull));
const ART = "mods/nocturne/art";

// Copies of what's shown, under the app's folder (where image() reads).
const CACHE = `cache/${MOD}`;

// The first bytes read for the size and format.
const HEAD = 262144;

// A file on another machine: read it this often; fetched up to this size.
const POLL = 4000;
const REMOTE_MAX = 6 * 1024 * 1024;

// Pan steps: a key, and a key with shift.
const NUDGE = 60;
const SHOVE = 240;

// Audio and video: seconds a key moves, and with shift.
const SEEK = 5;
const SEEK_FAR = 30;

// Formats the SVG renderer can embed when turning a picture; others get a PNG copy first.
const EMBEDS: readonly (Format | "pdf" | null)[] = ["png", "jpeg", "gif", "webp", "svg"];

// Tables and patches: a row's height, a character's width in the code font
// (12 px), a cell's side padding, the row numbers' column.
const ROW = 22;
const CH = 7.25;
const CELL = 8;
const GUTTER_MIN = 40;

// Kinds drawn from a cached copy (named by contents), and kinds read as text.
const COPIED: readonly (LookKind | null)[] = ["image", "pdf", "font", "video", "audio"];

// Embedded (the files pane's split): text is read this far (Markdown is drawn
// whole, so less of it), a line of it this tall.
const LOOK_BYTES = 256 * 1024;
const LOOK_MD_BYTES = 64 * 1024;
const LINE = 18;

// Text: its size, how many NULs its start has (a binary has some), then (none) its first bytes.
// Exit 3: not there; 5: not readable; 6: not a file (a socket, a device).
const LOOK_HEAD = `[ -e "$1" ] || [ -L "$1" ] || exit 3; [ -f "$1" ] || exit 6; [ -r "$1" ] || exit 5
wc -c < "$1"; n=$(head -c 8000 "$1" | tr -dc '\\000' | wc -c); echo $n; [ "$n" -gt 0 ] || head -c "$2" "$1"`;

// One copy per contents: `<crc>-<bytes>.<ext>` (then its size line and its first bytes).
const COPY = `f="$1"; d="$2"; e="$3"; [ -f "$f" ] || exit 3; mkdir -p "$d" || exit 4
set -- $(cksum < "$f"); n="$1-$2.$e"
[ -f "$d/$n" ] || cp -c "$f" "$d/$n" 2>/dev/null || cp "$f" "$d/$n" || exit 4
printf '%s\\n%s\\n' "$n" "$2"; od -An -v -tx1 -N ${HEAD} "$d/$n"`;

// Text: its size, its line count, then its first bytes.
const TEXT_HEAD = `[ -f "$1" ] || exit 3; wc -c < "$1"; wc -l < "$1"; head -c ${MAX_BYTES} "$1"`;

// What changed a file without reading it all (a database being written): size and time.
const STAMP = `[ -f "$1" ] || exit 3; wc -c < "$1"; date -r "$1" +%s 2>/dev/null || stat -c %Y "$1"; od -An -v -tx1 -N 16 "$1"`;

/** A string, null, or (a JavaScript host's unset field) undefined. */
const maybeString = oneOf(isString, isNull, isUndefined);

/** The props: the preview pane's ({ path, on, slot }), or a host's that mounts it
 *  embedded ({ embedded, path, on, scroll: { n, dir }, reload }). */
export const isViewerProps = object({}, {
  embedded: isBoolean,
  path: maybeString,
  on: maybeString,
  slot: maybeString,
  scroll: oneOf(object({ n: isNumber, dir: isNumber }), isNull, isUndefined),
  reload: oneOf(isNumber, isNull, isUndefined),
});

export type ViewerProps = Guarded<typeof isViewerProps>;

/** A pane's slot, from its props. */
const isSlotted = object({}, { slot: isString });
const slotOf = (pane: PaneInfo): string | null => (isSlotted(pane.props) ? pane.props.slot ?? null : null);

/** What the PDF view says of itself (its state, an action's answer, its pdf.page event). */
const isPdfFacts = object({}, { page: isNumber, pageCount: isNumber, scale: isNumber, autoScales: isBoolean });

type PdfFacts = Guarded<typeof isPdfFacts>;

/** What the player says of itself. */
const isMediaFacts = object({}, { duration: isNumber, rate: isNumber, time: isNumber, muted: isBoolean });

type MediaFacts = Guarded<typeof isMediaFacts>;

/** A native view's `state` answer: { content }. */
const isPdfState = object({ content: isPdfFacts });
const isMediaState = object({ content: isMediaFacts });

/** A native view's event: which view, what happened, its data. */
const isNativeEvent = object({ event: isString }, { id: maybeString, data: object({}, { message: isString, page: isNumber, pageCount: isNumber, scale: isNumber, autoScales: isBoolean }) });

/** How the shown file is drawn: a route, or (embedded) as Markdown or text. */
type How = Route | { readonly how: "markdown" } | { readonly how: "text" };

/** What's known of the shown file: its size (bytes; -1 unknown), and a picture's
 *  size, format, EXIF orientation (1 upright) and motion. */
interface Info {
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly format: string | null;
  readonly orientation: number;
  readonly animated: boolean;
  readonly frames: number | null;
}

const blank = (bytes: number): Info => ({ bytes, width: 0, height: 0, format: null, orientation: 1, animated: false, frames: null });

/** A copy in the cache: its name, its path, its format; a PDF's page drawn as a PNG. */
interface Copy {
  readonly name: string;
  readonly abs: string;
  readonly format: Format | "pdf" | null;
  readonly page?: Copy;
}

/** Text read for a look: the text, where its lines start, its highlight, its
 *  language, whether it's Markdown, its lines' runs as drawn, Markdown's
 *  measured height, and the lines wrapped to the view's width. */
interface TextLook {
  readonly body: string;
  readonly starts: readonly number[];
  readonly spans: readonly (readonly [number, number, string])[];
  readonly lang: string | null;
  readonly md: boolean;
  readonly runs: Map<number, Run[]>;
  height: number;
  wrap: Wrapped | null;
}

interface Wrapped {
  readonly cols: number;
  readonly gutter: number;
  readonly at: readonly number[];
}

/** A database: its tables and views, and the one shown. */
interface Db {
  readonly tables: readonly DbTable[];
  readonly at: number;
}

/** A control on the bar or the strip, in drawing order (tab rings them). */
interface Chip {
  readonly id: string;
  readonly action: (cx: Context) => void;
}

/** What the embedded viewer has done of its props. */
interface Done {
  path: string | null;
  on: string | null;
  scroll: number | null;
  reload: number | null;
}

/** A press that pans: where it started, and the view's pan then. */
interface Drag {
  readonly from: Point;
  readonly x: number;
  readonly y: number;
}

// What's read and worked out for the shown file (text with its highlight, a
// table's rows, a patch's, a database's tables) is kept off the view object:
// before a nested view takes new props the app walks every object reachable
// from it (to undo a failed update) and refuses past 10,000 objects or
// 100,000 properties. Held on the view, a big highlighted file (a Cargo.lock)
// failed every next file's props and the split stayed on it.
interface Held {
  text: TextLook | null;
  grid: Table | null;
  sep: Separator | null;
  patch: Patch | null;
  starts: readonly number[];
  db: Db | null;
}

const HELD = new WeakMap<Viewer, Held>();

function held(view: Viewer): Held {
  const was = HELD.get(view);

  if (was) return was;

  const h: Held = { text: null, grid: null, sep: null, patch: null, starts: [], db: null };

  HELD.set(view, h);

  return h;
}

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
const zoom = (): number => settings().zoom || 1;
const unzoom = (v: number): number => v / zoom();
const platform = (): string => appWindow().platform;
const dpr = (): number => (platform() === "macos" ? 2 : 1);
const code = (): string => settings().font_family || "JetBrains Mono";

/** This Fireflies places macOS views (the fork's native-view/0; stock Herdr has none). */
const nativeViews = (): boolean => {
  try {
    return herdr.nativeViewCapabilities().available;
  } catch {
    return false;
  }
};

/** A 50% checker filling the parent, `cell` px squares (as ../nocturne/kit.js dither). */
function checker(color: Color, cell = 1): Element {
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr())))).absolute().top(0).left(0).size_full();
}

const stop = (_e: MouseButtonEvent, cx: Context): void => cx.stop_propagation();
const dirname = (p: string): string => p.replace(/\/[^/]*$/, "") || "/";
const basename = (p: string): string => p.replace(/\/+$/, "").split("/").pop() || p;
const tilde = (p: string, h: string): string => (!p || !h ? p : p === h ? "~" : p.startsWith(h + "/") ? "~" + p.slice(h.length) : p);
const lastPart = (p: string): string => (p.split(".").pop() ?? "").toLowerCase();
const failure = (cause: unknown): ExecResult => ({ code: -1, stdout: "", stderr: cause instanceof Error ? cause.message : String(cause) });
const sh = (script: string, args: readonly string[], on: string | null = null): Promise<ExecResult> => exec("sh", ["-c", script, MOD, ...args], on ? { on } : undefined).catch(failure);

/** A pointer's place in the viewport, from an event on it. */
const pointOf = (e: { readonly local_position?: Point | undefined }): Point | null => (e.local_position ? { x: e.local_position.x, y: e.local_position.y } : null);

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
        this.load(cx);
        this.list(cx);
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
    } else if (reload !== null && reload !== d.reload && this.path) this.load(cx);

    d.reload = reload;

    if (a.scroll && a.scroll.n !== d.scroll) {
      d.scroll = a.scroll.n;

      if (this.path) this.scrollLook(a.scroll.dir, cx);
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

    if (next?.how !== "native" || next.view !== this.how.view) this.act("dispose");
  }

  // ---- the file

  /** Shows `path` from the start (a picture fitted, a table at its top). */
  open(path: string, cx: Context): void {
    const sameFolder = Boolean(this.path) && dirname(this.path) === dirname(path);

    if (this.embedded) this.dropNative(lookKind(path));

    this.path = path;
    this.kind = this.embedded ? lookKind(path) : kindOf(path);
    this.text = null;
    this.how = null;
    this.info = null;
    this.error = null;
    this.src = null;
    this.copy = null;
    this.busy = "Reading…";
    this.view = null;
    this.note = null;
    this.grid = null;
    this.patch = null;
    this.db = null;
    this.pdf = null;
    this.media = null;
    this.page = 1;
    this.pages = 0;
    this.sy = 0;
    this.sx = 0;
    this.cursor = 0;
    this.stamp = null;
    this.gen += 1;
    this.title();
    this.load(cx);

    // Embedded: no stepping through the folder; the files pane watches it.
    if (!sameFolder && !this.embedded) {
      this.names = [];
      this.list(cx);

      if (!this.on && path) this.watch(cx, this.gen);
    }
  }

  /** Reads the file (again, if it changed) and works out how to show it. */
  load(cx: Context): void {
    const gen = this.gen;

    if (!this.path) {
      this.error = "No file given";
      this.busy = null;

      return;
    }

    if (!this.kind) {
      this.fail(cx, "The preview doesn't know this kind of file", blank(-1));

      return;
    }

    // Another machine's pictures, PDFs, fonts and clips would be fetched whole: not for a look.
    if (this.embedded && this.on && COPIED.includes(this.kind)) {
      this.fail(cx, `On ${this.on}: p opens this ${noun(this.kind)} in the preview`);

      return;
    }

    cx.spawn(async (cx) => {
      // A file that breaks the reading says so in its place; the next one loads as ever.
      try {
        if (this.kind === "text" || this.kind === "markdown") await this.loadLook(cx, gen);
        else if (this.kind === "table" || this.kind === "diff") await this.loadText(cx, gen);
        else if (this.kind === "sqlite") await this.loadDb(cx, gen);
        else await this.loadCopy(cx, gen);
      } catch (e) {
        if (gen === this.gen) this.fail(cx, `Can't show it: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  }

  failed(r: ExecResult): string {
    return r.code === 3 ? "It isn't there (moved or deleted?)" : (r.stderr || "Can't read it").trim();
  }

  fail(cx: Context, error: string, info?: Info): void {
    if (info) this.info = info;

    this.error = error;
    this.busy = null;
    this.src = null;
    cx.notify();
  }

  /** Which tools route() asks after are installed (here, or on `on`). */
  async tools(): Promise<string[]> {
    const want = toolsFor(this.kind);

    if (!want.length) return [];

    // sqlite3 runs where the database is; a PDF is drawn here from its copy.
    const r = await sh('for t; do command -v "$t" >/dev/null 2>&1 && echo "$t"; done; true', want, this.kind === "sqlite" ? this.on : null);

    return r.stdout.split("\n").filter(Boolean);
  }

  /** Pictures, PDFs, fonts, media: a copy in the cache by contents, then its first bytes say what it is. */
  async loadCopy(cx: Context, gen: number): Promise<void> {
    const path = this.path;
    const dir = `${appHome()}/${CACHE}`;
    const ext = this.kind === "image" ? (formatOf(path) ?? "img").replace("jpeg", "jpg") : lastPart(path);
    // Media can be big: played from where it is (only another machine's is fetched),
    // known by its size and time instead of a checksum.
    const media = this.kind === "video" || this.kind === "audio";
    let r: ExecResult;

    if (this.on) r = await this.fetch(path, dir, ext);
    else if (media) {
      r = await sh(STAMP, [path]);

      if (r.code === 0) {
        const [size = "", time = "", ...rest] = r.stdout.split("\n");

        r = { code: 0, stdout: `${time}-${size}\n${size}\n${rest.join(" ")}`, stderr: "" };
      }
    } else r = await sh(COPY, [path, dir, ext]);

    if (gen !== this.gen) return;

    if (r.code !== 0) {
      const error = this.failed(r);

      if (error !== this.error) this.fail(cx, error);

      return;
    }

    const [name = "", size = "", ...rest] = r.stdout.split("\n");
    const stamp = `${name}:${size}`;

    // Unchanged.
    if (this.stamp === stamp && !this.error) return;

    this.stamp = stamp;

    const bytes = hexBytes(rest.join(" "));

    if (this.kind === "image") return this.loadImage(cx, gen, name, Number(size), bytes, dir);

    const local = media && !this.on ? path : `${dir}/${name}`;
    const said = sniffKind(bytes);
    const info: Info = { ...blank(Number(size)), format: said?.kind === "font" ? said.format : null };

    if ((this.kind === "pdf" && said?.kind !== "pdf") || (this.kind === "font" && said?.kind !== "font")) {
      this.fail(cx, `Not a ${noun(this.kind)}, or a damaged one`, info);

      return;
    }

    const how = route(this.kind, { native: nativeViews(), tools: await this.tools() });

    if (gen !== this.gen) return;

    this.how = how;
    this.local = local;
    this.info = info;

    if (how.how === "none") {
      this.fail(cx, how.why, info);

      return;
    }

    if (how.how === "raster") {
      const copy: Copy = { name, abs: `${dir}/${name}`, format: "pdf" };

      this.copy = copy;

      const pages = how.tool === "pdftoppm"
        ? await sh('pdfinfo "$1" 2>/dev/null', [copy.abs])
        : await sh('mdls -name kMDItemNumberOfPages "$1" 2>/dev/null', [copy.abs]);

      if (gen !== this.gen) return;

      this.pages = pageCount(pages.stdout) || 0;

      if (how.firstOnly) this.note = this.pages > 1 ? `page 1 of ${this.pages} only` : null;

      this.page = Math.min(this.page, this.pages || 1);
      await this.rasterPage(cx, gen);

      return;
    }

    this.error = null;
    this.busy = null;
    // A file that changed in place gets a fresh view (same props keep the old one).
    this.rev = stamp;
    cx.notify();
  }

  /** One PDF page as a PNG in the cache, then shown as a picture. */
  async rasterPage(cx: Context, gen: number): Promise<void> {
    const how = this.how;
    const src = this.copy;

    if (how?.how !== "raster" || !src) return;

    const base = `${src.name.replace(/\.[^.]*$/, "")}-p${this.page}`;
    const out = `${appHome()}/${CACHE}/${base}.png`;

    this.busy = `Drawing page ${this.page}…`;
    cx.notify();

    if ((await sh('[ -s "$1" ]', [out])).code !== 0) {
      const argv = rasterArgv(how.tool, this.page).map((a) => a.replace("$IN", src.abs).replace("$OUTBASE", out.replace(/\.png$/, "")).replace("$OUT", out));

      await exec(argv[0] ?? how.tool, argv.slice(1), { timeout: 60000 }).catch(() => null);
    }

    if (gen !== this.gen) return;

    const png = await sh('[ -s "$1" ] && od -An -v -tx1 -N 32 "$1"', [out]);
    const s = png.code === 0 ? sniff(hexBytes(png.stdout)) : null;

    if (!s?.width) {
      this.fail(cx, `${how.tool} couldn't draw page ${this.page}`);

      return;
    }

    const resized = !this.info?.width || this.info.width !== s.width || this.info.height !== s.height;

    this.info = { ...(this.info ?? blank(-1)), width: s.width, height: s.height };
    this.copy = { ...src, page: { name: `${base}.png`, abs: out, format: "png" } };
    this.src = `${CACHE}/${base}.png`;
    this.error = null;
    this.busy = null;

    if (resized || !this.view) this.view = null;

    cx.notify();
  }

  async loadImage(cx: Context, gen: number, name: string, size: number, bytes: readonly number[], dir: string): Promise<void> {
    this.how = { how: "image" };

    const head = sniff(bytes);
    const format = head?.format ?? formatOf(this.path);

    let info: Info = {
      bytes: size,
      width: head?.width ?? 0,
      height: head?.height ?? 0,
      format,
      orientation: head?.orientation ?? 1,
      animated: head?.animated === true,
      frames: head?.frames ?? null,
    };

    if (!head) {
      this.fail(cx, "Not a picture, or a damaged one", info);

      return;
    }

    if (!info.width && format !== "heic" && format !== "avif") {
      const f = await sh('file -b "$1"', [`${dir}/${name}`]);
      const told = sizeFromFile(f.stdout);

      if (told) info = { ...info, ...told };

      if (gen !== this.gen) return;

      if (!info.width) {
        this.fail(cx, "Can't tell how big it is (a damaged file?)", info);

        return;
      }
    }

    const how = plan(format, platform());
    let copy: Copy | null = { name, abs: `${dir}/${name}`, format };

    if (how.kind === "none") {
      this.fail(cx, cantShow(format, platform()), info);

      return;
    }

    if (how.kind === "convert") {
      this.busy = `Converting ${(format ?? "").toUpperCase()}…`;
      cx.notify();
      copy = await this.convert(how.tools, copy, dir);

      if (gen !== this.gen) return;

      if (!copy) {
        this.fail(cx, cantShow(format, platform()), info);

        return;
      }

      // The PNG's own size: the original's header may name a tile or a thumbnail.
      const png = await sh('od -An -v -tx1 -N 32 "$1"', [copy.abs]);
      const s = sniff(hexBytes(png.stdout));

      // The copy is upright: its orientation is applied.
      info = s?.width ? { ...info, width: s.width, height: s.height, orientation: 1 } : { ...info, orientation: 1 };

      if (!info.width) {
        this.fail(cx, "Can't tell how big it is (a damaged file?)", info);

        return;
      }
    }

    const resized = !this.info || this.info.width !== info.width || this.info.height !== info.height;

    this.info = info;
    this.copy = copy;
    this.error = null;
    this.busy = null;

    // Fit again once the pane's size is known.
    if (resized || !this.view) this.view = null;

    await this.draw(cx);
    cx.notify();
  }

  /** CSV, TSV, patches: the first MAX_BYTES as text. */
  async loadText(cx: Context, gen: number): Promise<void> {
    const r = await sh(TEXT_HEAD, [this.path], this.on);

    if (gen !== this.gen) return;

    if (r.code !== 0) {
      const e = this.failed(r);

      if (e !== this.error) this.fail(cx, e);

      return;
    }

    const nl1 = r.stdout.indexOf("\n");
    const nl2 = r.stdout.indexOf("\n", nl1 + 1);
    const bytes = Number(r.stdout.slice(0, nl1).trim());
    const lines = Number(r.stdout.slice(nl1 + 1, nl2).trim());
    const body = r.stdout.slice(nl2 + 1);
    const stamp = `${bytes}:${body.length}:${body.slice(0, 256)}:${body.slice(-256)}`;

    if (this.stamp === stamp && !this.error) return;

    this.stamp = stamp;

    const partial = bytes > MAX_BYTES;
    const text = wholeLines(body, partial);

    this.info = blank(bytes);

    if (this.kind === "diff") {
      this.patch = parsePatch(text);
      this.how = { how: "diff" };
      this.note = partial ? `first ${fileSize(MAX_BYTES)} of ${fileSize(bytes)}` : null;
    } else {
      const sep = separator(text, lastPart(this.path));
      const { rows, cut } = parseTable(text, sep);

      if (rows.length > MAX_ROWS + 1) rows.length = MAX_ROWS + 1;

      const grid = table(rows);
      const shown = grid.body.length;

      this.grid = grid;
      held(this).sep = sep;
      this.how = { how: "table" };
      // wc counts line breaks; quoted ones inside cells make it a little high, so "about".
      this.note = shownNote({ shown, total: Math.max(shown, lines - 1), partial: partial || cut, wide: grid.wide, cols: grid.cols.length }) || null;
    }

    this.cursor = Math.min(this.cursor, Math.max(0, this.rowCount() - 1));
    this.error = null;
    this.busy = null;
    cx.notify();
  }

  /** Embedded: code, Markdown and other text, its first LOOK_BYTES (Markdown:
   *  LOOK_MD_BYTES); a binary or a file that can't be read says why. */
  async loadLook(cx: Context, gen: number): Promise<void> {
    const md = this.kind === "markdown";
    const cap = md ? LOOK_MD_BYTES : LOOK_BYTES;
    const r = await sh(LOOK_HEAD, [this.path, String(cap)], this.on);

    if (gen !== this.gen) return;

    if (r.code !== 0) {
      const e = r.code === 5 ? "Can't read it: no permission" : r.code === 6 ? "Not a regular file" : this.failed(r);

      if (e !== this.error) this.fail(cx, e);

      return;
    }

    const nl1 = r.stdout.indexOf("\n");
    const nl2 = r.stdout.indexOf("\n", nl1 + 1);
    const bytes = Number(r.stdout.slice(0, nl1).trim());
    const nuls = Number(r.stdout.slice(nl1 + 1, nl2).trim());

    this.info = blank(bytes);

    if (nuls > 0) {
      this.text = null;
      this.fail(cx, `A binary file (${fileSize(bytes)}): nothing to preview`);

      return;
    }

    const body = r.stdout.slice(nl2 + 1);
    const stamp = `${bytes}:${body.length}:${body.slice(0, 256)}:${body.slice(-256)}`;

    if (this.stamp === stamp && !this.error) return;

    this.stamp = stamp;

    const partial = bytes > cap;
    const text = wholeLines(body, partial);
    const lang = md ? null : languageOf(this.path);
    let spans: readonly (readonly [number, number, string])[] = [];

    if (lang) {
      try {
        spans = highlight(text, lang);
      } catch {
        spans = [];
      }
    }

    this.text = { body: text, starts: lineStarts(text), spans, lang, md, runs: new Map(), height: 0, wrap: null };
    this.note = partial ? `first ${fileSize(text.length)} of ${fileSize(bytes)}` : null;
    this.how = md ? { how: "markdown" } : { how: "text" };
    this.sy = Math.min(this.sy, this.maxScroll());
    this.error = null;
    this.busy = null;
    cx.notify();
  }

  /** Text: line `n` in its colors, worked out once. */
  runsOf(x: TextLook, n: number, colors: ReadonlyMap<string, Color>): Run[] {
    const was = x.runs.get(n);

    if (was) return was;

    const runs = lineRuns(x.body, x.starts, x.spans, n, colors);

    x.runs.set(n, runs);

    return runs;
  }

  /** How far text or Markdown scrolls (element px). */
  maxScroll(): number {
    const x = this.text;
    const room = unzoom(this.port.height);

    if (!x) return 0;

    const total = x.md ? x.height + 24 : this.wrapped(x).rows * LINE + 12;

    return Math.max(0, total - room);
  }

  /** Text: the line numbers' column, and the lines soft-wrapped to the view's
   *  width (a narrow panel shows whole lines, no sideways scrolling). */
  wrapped(x: TextLook): Wrapped & { readonly rows: number } {
    const gutter = Math.max(30, String(x.starts.length).length * CH + 16);
    const cols = Math.max(8, Math.floor(((unzoom(this.port.width) || 600) - gutter - 14) / CH));
    const wrap = x.wrap?.cols === cols ? x.wrap : { cols, gutter, at: wrapRows(x.body, x.starts, cols) };

    x.wrap = wrap;

    return { ...wrap, rows: wrap.at[wrap.at.length - 1] ?? 0 };
  }

  /** Embedded: J / K in the tree. Text, Markdown, tables and patches move
   *  half a view; a PDF a page; a picture larger than the view pans. */
  scrollLook(dir: number, cx: Context): void {
    const how = this.how;
    const half = Math.max(LINE, Math.round(unzoom(this.port.height) / 2));

    if (how?.how === "text" || how?.how === "markdown") this.sy = Math.max(0, Math.min(this.maxScroll(), this.sy + dir * half));
    else if (how?.how === "table" || how?.how === "diff") {
      const rows = Math.max(1, Math.floor(this.visibleRows() / 2));

      this.scrollBy(0, dir * rows * ROW);
      this.cursor = Math.max(0, Math.min(this.rowCount() - 1, Math.ceil(this.sy / ROW)));
    } else if (how?.how === "native" && this.kind === "pdf") this.pageGo(dir > 0 ? "next" : "prev", cx);
    else if (how?.how === "raster" && !how.firstOnly) this.pageGo(dir > 0 ? "next" : "prev", cx);
    else if (this.pictured() && this.pannable()) this.pan(0, -dir * half * zoom(), cx);
  }

  /** SQLite: its tables, then the chosen one's first rows (sqlite3, read only). */
  async loadDb(cx: Context, gen: number): Promise<void> {
    const s = await sh(STAMP, [this.path], this.on);

    if (gen !== this.gen) return;

    if (s.code !== 0) {
      const e = this.failed(s);

      if (e !== this.error) this.fail(cx, e);

      return;
    }

    const [size = "", time = "", ...rest] = s.stdout.split("\n");
    const stamp = `${size}:${time}`;

    if (this.stamp === stamp && !this.error) return;

    this.stamp = stamp;
    this.info = blank(Number(size));

    if (sniffKind(hexBytes(rest.join(" ")))?.kind !== "sqlite") {
      this.fail(cx, `Not a SQLite database${Number(size) ? "" : " (it's empty)"}`);

      return;
    }

    const how = route("sqlite", { tools: await this.tools() });

    this.how = how;

    if (how.how === "none") {
      this.fail(cx, how.why);

      return;
    }

    const list = await this.sqlite(TABLES_SQL);

    if (gen !== this.gen) return;

    if (list.code !== 0) {
      this.fail(cx, sqliteError(list.stderr));

      return;
    }

    const tables = tablesOf(list.stdout);
    const was = this.db ? this.db.tables[this.db.at]?.name : undefined;
    const at = Math.max(0, tables.findIndex((x) => x.name === was));

    this.db = { tables, at };

    if (!tables.length) {
      this.grid = null;
      this.note = null;
      this.error = null;
      this.busy = null;
      cx.notify();

      return;
    }

    await this.loadTable(cx, gen);
  }

  /** One query on the database, as CSV. */
  sqlite(sql: string): Promise<ExecResult> {
    return exec("sqlite3", [...SQLITE_ARGS, this.path, sql], this.on ? { on: this.on } : undefined).catch(failure);
  }

  async loadTable(cx: Context, gen: number): Promise<void> {
    const db = this.db;
    const t = db?.tables[db.at];

    if (!t) return;

    const [rows, n] = await Promise.all([this.sqlite(rowsSql(t.name)), this.sqlite(countSql(t.name))]);

    if (gen !== this.gen || (this.db ? this.db.tables[this.db.at] : undefined) !== t) return;

    if (rows.code !== 0) {
      this.fail(cx, sqliteError(rows.stderr));

      return;
    }

    const total = Number(parseTable(n.stdout).rows[1]?.[0] ?? 0);
    let parsed: readonly (readonly string[])[] = parseTable(rows.stdout).rows;

    // An empty table prints nothing, not even its header: ask for the columns.
    if (!parsed.length) {
      const cols = await this.sqlite(`SELECT name FROM pragma_table_info(${"'" + t.name.replace(/'/g, "''") + "'"});`);

      parsed = [parseTable(cols.stdout).rows.slice(1).map((r) => r[0] ?? "")];
    }

    const grid = table(parsed);
    const shownRows = total > grid.body.length ? `first ${count(grid.body.length)} of ${count(total)} rows` : null;

    this.grid = grid;
    this.note = grid.wide ? [shownRows, `${grid.cols.length} of ${grid.wide} columns`].filter(Boolean).join(" · ") : shownRows;
    this.sy = 0;
    this.sx = 0;
    this.cursor = 0;
    this.error = null;
    this.busy = null;
    cx.notify();
  }

  pickTable(i: number, cx: Context): void {
    const db = this.db;

    if (!db?.tables.length) return;

    const n = db.tables.length;

    this.db = { ...db, at: ((i % n) + n) % n };
    this.busy = "Reading…";
    cx.notify();

    const gen = this.gen;

    cx.spawn(async (cx) => this.loadTable(cx, gen));
  }

  /** Another machine's file: its checksum there, then (once per contents) its bytes over base64. */
  async fetch(path: string, dir: string, ext: string): Promise<ExecResult> {
    const sum = await sh('[ -f "$1" ] || exit 3; cksum < "$1"', [path], this.on);

    if (sum.code !== 0) return sum;

    const [crc = "", bytes = "0"] = sum.stdout.trim().split(/\s+/);
    const name = `${crc}-${bytes}.${ext}`;
    const have = await sh('[ -f "$1/$2" ] && od -An -v -tx1 -N ' + HEAD + ' "$1/$2"', [dir, name]);

    if (have.code === 0) return { code: 0, stdout: `${name}\n${bytes}\n${have.stdout}`, stderr: "" };

    if (Number(bytes) > REMOTE_MAX) return { code: 4, stdout: "", stderr: `Too large to fetch from ${this.on ?? "there"} (${fileSize(Number(bytes))})` };

    const data = await sh('base64 < "$1"', [path], this.on);

    if (data.code !== 0) return data;

    await sh('mkdir -p "$1"', [dir]);

    const b64 = `${dir}/${name}.b64`;

    try {
      await writeTextFile(b64, data.stdout, null);
    } catch {
      // Left over from before: replaced below.
    }

    return sh(`base64 -d < "$1" > "$2/$3" && rm -f "$1" && printf '%s\\n%s\\n' "$3" "$4" && od -An -v -tx1 -N ${HEAD} "$2/$3"`, [b64, dir, name, bytes]);
  }

  /** A PNG copy by the first converter found, or null. */
  async convert(tools: readonly Converter[], copy: Copy, dir: string): Promise<Copy | null> {
    const name = copy.name.replace(/\.[^.]*$/, "") + ".png";
    const out = `${dir}/${name}`;
    const done: Copy = { name, abs: out, format: "png" };

    if ((await sh('[ -s "$1" ]', [out])).code === 0) return done;

    for (const { tool, argv } of tools) {
      if ((await sh('command -v "$1" >/dev/null', [tool])).code !== 0) continue;

      const args = argv.map((a) => a.replace("$IN", copy.abs).replace("$OUTDIR", dir).replace("$OUT", out));
      const r = await exec(args[0] ?? tool, args.slice(1), { timeout: 60000 }).catch(() => null);

      // qlmanage writes `<name>.png` next to its own name.
      if (tool === "qlmanage") await sh('[ -s "$1/$2.png" ] && mv "$1/$2.png" "$3"', [dir, copy.name, out]);

      if (r && (await sh('[ -s "$1" ]', [out])).code === 0) return done;
    }

    return null;
  }

  /** What image() draws: the copy itself, or (turned, or a vector) a wrapper SVG around it. */
  async draw(cx: Context): Promise<void> {
    if (this.how?.how === "raster") {
      // A PDF page: turned through the same wrapper as a picture.
      const page = this.copy?.page;

      if (!page) return;

      const rot = this.view?.rot ?? 0;

      if (!rot) {
        this.src = `${CACHE}/${page.name}`;

        return;
      }

      const name = `${page.name.replace(/\.png$/, "")}-r${rot}.svg`;

      try {
        await writeTextFile(`${appHome()}/${CACHE}/${name}`, wrapper(page.abs, this.info ?? blank(-1), rot, 1), null);
      } catch {
        // Same name, same contents.
      }

      this.src = `${CACHE}/${name}`;
      cx.notify();

      return;
    }

    const copy = this.copy;
    const info = this.info;
    const gen = this.gen;

    if (!copy || !info) return;

    // Turns come faster than wrappers are written: only the latest draw lands.
    const token = ++this.drawing;
    const stale = (): boolean => gen !== this.gen || token !== this.drawing;
    const rot = this.view?.rot ?? 0;
    const vector = copy.format === "svg";

    if (!rot && !vector) {
      this.src = `${CACHE}/${copy.name}`;
      this.still = false;

      return;
    }

    let inner: Copy | null = copy;

    if (!EMBEDS.includes(copy.format)) {
      // BMP / TIFF / ICO: the SVG renderer embeds PNGs.
      inner = await this.convert(platform() === "macos"
        ? [{ tool: "sips", argv: ["sips", "-s", "format", "png", "$IN", "--out", "$OUT"] }]
        : [{ tool: "magick", argv: ["magick", "$IN[0]", "$OUT"] }, { tool: "convert", argv: ["convert", "$IN[0]", "$OUT"] }], copy, `${appHome()}/${CACHE}`);

      if (stale()) return;

      if (!inner) {
        this.note = "can't turn this format here";
        this.view = this.view ? { ...this.view, rot: 0 } : null;
        this.src = `${CACHE}/${copy.name}`;

        return;
      }
    }

    // Stored size: an EXIF orientation that turns it on its side swaps the shown one.
    const o = info.orientation;
    const stored: Size = o >= 5 ? { width: info.height, height: info.width } : info;
    const k = vector ? sharpness(info, this.view?.scale ?? 1, dpr()) : 1;
    const name = `${copy.name.replace(/\.[^.]*$/, "")}-r${rot}-k${k}.svg`;

    try {
      await writeTextFile(`${appHome()}/${CACHE}/${name}`, wrapper(inner.abs, stored, rot, k, inner.format === "jpeg" ? o : 1), null);
    } catch {
      // Already written: same name, same contents.
    }

    if (stale()) return;

    this.src = `${CACHE}/${name}`;
    this.still = info.animated && rot > 0;
    cx.notify();
  }

  /** Waits for the file's folder to change: the file and the folder's list again. */
  watch(cx: Context, gen: number): void {
    const dir = dirname(this.path);

    cx.spawn(async (cx) => {
      while (gen === this.gen || dirname(this.path) === dir) {
        try {
          await watchFolder(dir);
        } catch {
          return;
        }

        if (dirname(this.path) !== dir) return;

        // Any change here: the checksum (or size and time) says whether this file changed.
        this.load(cx);
        this.list(cx);
      }
    });
  }

  /** The files of this kind in the file's folder, for next / previous. */
  list(cx: Context): void {
    if (!this.path) return;

    const dir = dirname(this.path);

    cx.spawn(async (cx) => {
      const r = await sh('ls -1A "$1"', [dir], this.on);

      if (r.code !== 0 || dirname(this.path) !== dir) return;

      const names = siblings(r.stdout.split("\n"), basename(this.path));

      if (names.join("\n") !== this.names.join("\n")) {
        this.names = names;
        cx.notify();
      }
    });
  }

  go(dir: number, cx: Context): void {
    const next = stepIn(this.names, basename(this.path), dir);

    if (next && next !== basename(this.path)) this.open(`${dirname(this.path)}/${next}`, cx);
  }

  /** Tells the pane header which file this preview shows, and the app which path. */
  title(): void {
    const slot = this.slot;

    if (!slot) return;

    const live = new Set(panes().flatMap((p) => {
      const s = p.mod === MOD ? slotOf(p) : null;

      return s ? [s] : [];
    }));

    const keep = <T>(was: ReadonlyMap<string, T>, value: T): Map<string, T> => new Map([...[...was].filter(([k]) => live.has(k)), [slot, value]]);
    const stale = <T>(was: ReadonlyMap<string, T>): boolean => [...was.keys()].some((k) => !live.has(k) && k !== slot);
    const name = this.path ? basename(this.path) : "Preview";
    const titles = readSharedMap(shared, TITLES);
    const paths = readSharedMap(shared, PATHS);

    if (titles.get(slot) !== name || stale(titles)) writeSharedMap(setShared, TITLES, keep(titles, name));

    if (paths.get(slot) !== this.path || stale(paths)) writeSharedMap(setShared, PATHS, keep<string | null>(paths, this.path));
  }

  // ---- native views (PDF, fonts, media)

  nativeEvent(e: Guarded<typeof isNativeEvent>, cx: Context): void {
    if (e.id && e.id !== this.nativeId()) return;

    const d = e.data ?? {};

    // Esc in the view: the keyboard is the app's again, this preview's keys first.
    if (e.event === "view.escapeKey") {
      this.handle?.focus();

      return;
    }

    if (e.event === "load.error") this.fail(cx, d.message ?? `Can't show this ${noun(this.kind)}`);
    else if (e.event === "pdf.locked") this.note = "locked with a password";
    else if (e.event === "pdf.page" || (e.event === "load.finish" && this.kind === "pdf")) {
      this.pdf = { ...this.pdf, ...d };

      // The view fits the page once it has its size, without saying so: ask again.
      if (e.event === "load.finish") this.pdfLater(cx);
    } else if (e.event === "load.finish" && (this.kind === "video" || this.kind === "audio")) this.mediaFacts(cx);
  }

  /** The view's id: a new file gets a new view. */
  nativeId(): string {
    return `preview-${this.how?.how === "native" ? this.how.view : "none"}`;
  }

  /** An action on the native view, and its answer if it's a T (null when it isn't, or the
   *  call failed: the bar says why). */
  ask<T>(action: string, guard: Guard<T>, args: { readonly [name: string]: number | boolean } = {}): T | null {
    try {
      const answer = herdr.nativeViewCall(this.nativeId(), action, { ...args });

      return guard(answer) ? answer : null;
    } catch (err) {
      this.note = err instanceof Error ? err.message : String(err);

      return null;
    }
  }

  /** An action on the native view whose answer isn't needed. */
  act(action: string, args: { readonly [name: string]: number | boolean } = {}): void {
    try {
      herdr.nativeViewCall(this.nativeId(), action, { ...args });
    } catch (err) {
      this.note = err instanceof Error ? err.message : String(err);
    }
  }

  pdfDo(action: string, args?: { readonly [name: string]: number }): void {
    const s = this.ask(action, isPdfFacts, args);

    if (s) this.pdf = { ...this.pdf, ...s };
  }

  /** The PDF view's state (empty when it doesn't answer). */
  pdfState(): PdfFacts {
    return this.ask("state", isPdfState)?.content ?? {};
  }

  /** The player's state (empty when it doesn't answer). */
  mediaState(): MediaFacts {
    return this.ask("state", isMediaState)?.content ?? {};
  }

  /** The PDF view's page and scale a moment from now (after a resize, a load). */
  pdfLater(cx: Context): void {
    if (this.how?.how !== "native" || this.kind !== "pdf") return;

    const asked = ++this.pdfAsk;

    cx.timer.after(300, (cx) => {
      if (asked !== this.pdfAsk) return;

      const s = this.pdfState();

      if (s.pageCount) {
        this.pdf = { ...this.pdf, ...s };
        cx.notify();
      }
    });
  }

  /** A clip's length, once the player knows it. */
  mediaFacts(cx: Context, tries = 0): void {
    const length = this.mediaState().duration ?? 0;

    if (length > 0) {
      this.media = { duration: length };
      cx.notify();

      return;
    }

    if (tries < 20) cx.timer.after(250, (cx) => this.mediaFacts(cx, tries + 1));
  }

  // ---- actions

  reveal(): void {
    run("pane.split", { edge: "right", px: 280, mod: "file-tree", props: { folder: dirname(this.path), on: this.on } });
  }

  system(): void {
    if (!this.on) run("preview.open", { path: this.path, in: "system" });
  }

  /** Text shown as something else (a table, a patch, an SVG): edit it as
   *  text in the editor (editor), beside this preview. */
  editable(): boolean {
    return !this.on && /\.(csv|tsv|diff|patch|svg)$/i.test(this.path);
  }

  edit(): void {
    if (!this.editable()) return;

    const me = this.slot ? panes().find((p) => p.mod === MOD && slotOf(p) === this.slot) : undefined;

    run("editor.open", me ? { path: this.path, pane: me.pane } : { path: this.path });
  }

  copyPath(cx: Context): void {
    cx.write_to_clipboard(this.on ? `${this.on}:${this.path}` : this.path);

    const at = Date.now();

    this.copied = at;
    cx.timer.after(1400, (cx) => {
      if (this.copied === at) {
        this.copied = 0;
        cx.notify();
      }
    });
  }

  // ---- pages (PDF)

  pageGo(n: "next" | "prev" | number, cx: Context): void {
    const how = this.how;

    if (how?.how === "native") {
      if (n === "next") this.pdfDo("pdf.next");
      else if (n === "prev") this.pdfDo("pdf.previous");
      else if (this.pdf?.pageCount) this.pdfDo("pdf.goToPage", { page: Math.max(1, Math.min(this.pdf.pageCount, n)) });

      return;
    }

    if (how?.how !== "raster" || how.firstOnly) return;

    const to = n === "next" ? this.page + 1 : n === "prev" ? this.page - 1 : n;
    const page = Math.max(1, Math.min(this.pages || 1, to));

    if (page === this.page) return;

    this.page = page;

    const gen = this.gen;

    cx.spawn(async (cx) => this.rasterPage(cx, gen));
  }

  // ---- zoom and pan (pictures, a PDF page drawn as one)

  /** The picture's size as shown. */
  img(): Size {
    return { width: this.info?.width || 1, height: this.info?.height || 1 };
  }

  /** A vector: fit may enlarge it. */
  vector(): boolean {
    return this.copy?.format === "svg";
  }

  pictured(): boolean {
    return this.how?.how === "image" || this.how?.how === "raster";
  }

  ready(): boolean {
    return Boolean(this.pictured() && this.info?.width && this.port.width && this.src);
  }

  /** The view, fitted the first time the picture and the pane's size are both known. */
  current(): Look | null {
    if (!this.view && this.pictured() && this.info?.width && this.port.width) this.view = fitted(this.img(), this.port, 0, this.vector());

    return this.pictured() ? this.view : null;
  }

  /** Sets the view; a vector redraws sharper (or lighter) when its scale crosses a step. */
  set(view: Look, cx: Context): void {
    const before = this.view;
    const k = (v: Look | null): number => sharpness(this.img(), v?.scale ?? 1, dpr());

    this.view = view;

    if (before?.rot !== view.rot || (this.vector() && k(before) !== k(view))) void this.draw(cx);
  }

  zoomBy(dir: number, cx: Context, point?: Point | null): void {
    if (this.how?.how === "native" && this.kind === "pdf") {
      this.pdfDo(dir > 0 ? "pdf.zoomIn" : "pdf.zoomOut");

      return;
    }

    const v = this.current();

    if (v) this.set(zoomTo(v, step(v.scale, dir), this.img(), this.port, point), cx);
  }

  fit(cx: Context): void {
    if (this.how?.how === "native" && this.kind === "pdf") {
      this.pdfDo("pdf.fitWidth");

      return;
    }

    const v = this.current();

    if (v) this.set(fitted(this.img(), this.port, v.rot, this.vector()), cx);
  }

  actual(cx: Context, point?: Point | null): void {
    const v = this.current();

    if (v) this.set(zoomTo(v, 1, this.img(), this.port, point), cx);
  }

  turn(dir: number, cx: Context): void {
    const v = this.current();

    if (!v) return;

    if (this.how?.how !== "raster" || !this.how.firstOnly) this.note = null;

    this.set(rotate(v, dir, this.img(), this.port, this.vector()), cx);
  }

  /** Whether part of the picture is out of view (so keys pan rather than step). */
  pannable(): boolean {
    const v = this.current();

    if (!v) return false;

    const { width, height } = turned(this.img(), v.rot);

    return width * v.scale > this.port.width + 1 || height * v.scale > this.port.height + 1;
  }

  pan(dx: number, dy: number, cx: Context): void {
    const v = this.current();

    if (v) this.set(panBy(v, dx, dy, this.img(), this.port), cx);
  }

  resized(size: Size, cx: Context): void {
    const port = { width: size.width, height: size.height };

    if (Math.abs(port.width - this.port.width) <= 1 && Math.abs(port.height - this.port.height) <= 1) return;

    this.port = port;

    const v = this.view;

    if (v && this.pictured()) this.set(v.fit ? { ...v, scale: fitScale(this.img(), port, v.rot, this.vector()) } : clampPan(v, this.img(), port), cx);

    if (this.text) this.sy = Math.min(this.sy, this.maxScroll());
    else this.scrollBy(0, 0);

    this.pdfLater(cx);
    cx.notify();
  }

  // ---- rows (tables, patches)

  rowCount(): number {
    return this.grid ? this.grid.body.length : this.patch ? this.patch.rows.length : 0;
  }

  /** Rows that fit under the header, in element px. */
  visibleRows(): number {
    return Math.max(1, Math.floor((unzoom(this.port.height) - (this.grid ? ROW : 0)) / ROW));
  }

  /** The row numbers' column. */
  gutter(): number {
    return Math.max(GUTTER_MIN, String(this.rowCount()).length * CH + 2 * CELL);
  }

  colWidth(c: Column): number {
    return c.ch * CH + 2 * CELL;
  }

  /** How wide the table's columns are together. */
  tableWidth(): number {
    let w = 0;

    for (const c of this.grid?.cols ?? []) w += this.colWidth(c);

    return w;
  }

  /** Where each column starts, for h / l. */
  colStarts(): number[] {
    let x = 0;

    return (this.grid?.cols ?? []).map((c) => {
      const at = x;

      x += this.colWidth(c);

      return at;
    });
  }

  /** Scrolls by element px, kept in bounds. */
  scrollBy(dx: number, dy: number): void {
    const room = unzoom(this.port.height) - (this.grid ? ROW : 0);
    const maxY = Math.max(0, this.rowCount() * ROW - room);
    const maxX = Math.max(0, this.tableWidth() - (unzoom(this.port.width) - this.gutter()));

    this.sy = Math.max(0, Math.min(maxY, this.sy + dy));
    this.sx = this.grid ? Math.max(0, Math.min(maxX, this.sx + dx)) : 0;
  }

  /** Moves the cursor row (and the view with it, when it leaves). */
  moveTo(row: number): void {
    const n = this.rowCount();

    if (!n) return;

    this.cursor = Math.max(0, Math.min(n - 1, row));

    const top = Math.ceil(this.sy / ROW);
    const shown = this.visibleRows();

    if (this.cursor < top) this.scrollBy(0, this.cursor * ROW - this.sy);
    else if (this.cursor >= top + shown) this.scrollBy(0, (this.cursor - shown + 1) * ROW - this.sy);
  }

  /** The next / previous column start (h, l). */
  column(dir: number): void {
    const starts = this.colStarts();
    const to = dir > 0 ? starts.find((x) => x > this.sx + 1) : [...starts].reverse().find((x) => x < this.sx - 1);

    this.scrollBy((to ?? (dir > 0 ? this.tableWidth() : 0)) - this.sx, 0);
  }

  rowKey(k: string, m: Modifiers, cx: Context): boolean {
    const page = Math.max(1, this.visibleRows() - 1);

    if (k === "j" || k === "down") this.moveTo(this.cursor + 1);
    else if (k === "k" || k === "up") this.moveTo(this.cursor - 1);
    else if (k === "J" || (k === "j" && m.shift) || k === "pagedown") {
      this.scrollBy(0, page * ROW);
      this.moveTo(this.cursor + page);
    } else if (k === "K" || (k === "k" && m.shift) || k === "pageup") {
      this.scrollBy(0, -page * ROW);
      this.moveTo(this.cursor - page);
    } else if ((k === "g" && !m.shift) || k === "home") this.moveTo(0);
    else if (k === "G" || (k === "g" && m.shift) || k === "end") this.moveTo(this.rowCount() - 1);
    else if (this.grid && (k === "h" || k === "left")) this.column(-1);
    else if (this.grid && (k === "l" || k === "right")) this.column(1);
    else if (this.patch && (k === "}" || k === "{")) {
      const to = nextFile(held(this).starts, this.cursor, k === "}" ? 1 : -1);

      if (to !== null) {
        this.moveTo(to);
        this.scrollBy(0, to * ROW - this.sy);
      }
    } else if (this.db && (k === "t" || k === "T")) this.pickTable(this.db.at + (k === "T" || m.shift ? -1 : 1), cx);
    else return false;

    return true;
  }

  /** tab / shift-tab, enter, esc: the bar's controls. */
  barKey(k: string, m: Modifiers, cx: Context): boolean {
    if (k === "tab") this.ring = cycle(this.chips.map((c) => c.id), this.ring, m.shift ? -1 : 1);
    else if (k === "enter" && this.ring) {
      const c = this.chips.find((x) => x.id === this.ring);

      if (!c) {
        this.ring = null;

        return false;
      }

      c.action(cx);
    } else if (k === "escape" && this.ring) this.ring = null;
    else return false;

    return true;
  }

  /** Audio and video: play / pause, seek, sound. */
  mediaKey(k: string, m: Modifiers): boolean {
    const s = this.mediaState();
    const by = m.shift ? SEEK_FAR : SEEK;
    const length = s.duration ?? 0;
    const seek = (t: number): void => this.act("media.seek", { time: Math.max(0, length > 0 ? Math.min(length, t) : t) });

    if (k === "space" || k === "k") this.act((s.rate ?? 0) > 0 ? "media.pause" : "media.play");
    else if (k === "right" || k === "l" || k === "L") seek((s.time ?? 0) + by);
    else if (k === "left" || k === "h" || k === "H") seek((s.time ?? 0) - by);
    else if (k === "0" || k === "home") seek(0);
    else if (k === "m") this.act("media.setMuted", { muted: !s.muted });
    else return false;

    return true;
  }

  /** A PDF in its native view: zoom, fit, pages. */
  pdfKey(k: string, m: Modifiers, cx: Context): boolean {
    if (k === "+" || k === "=") this.zoomBy(1, cx);
    else if (k === "-" || k === "_") this.zoomBy(-1, cx);
    else if (k === "0") this.fit(cx);
    else if (k === "right" || k === "l" || k === "pagedown" || k === "space") this.pageGo("next", cx);
    else if (k === "left" || k === "h" || k === "pageup" || k === "backspace") this.pageGo("prev", cx);
    else if (k === "g" && !m.shift) this.pageGo(1, cx);
    else if (k === "G" || k === "g") this.pageGo(this.pdf?.pageCount ?? 1, cx);
    else return false;

    return true;
  }

  /** A picture, or a PDF page drawn as one: zoom, fit, pan, turn, step, the background. */
  pictureKey(k: string, m: Modifiers, cx: Context): boolean {
    const pan = this.pannable();
    const paged = this.how?.how === "raster" && !this.how.firstOnly;
    const d = m.shift ? SHOVE : NUDGE;
    // Fitted, nothing to pan: ← → step through the folder (a PDF: its pages).
    const sideways = (dir: number): void => (paged ? this.pageGo(dir > 0 ? "next" : "prev", cx) : this.go(dir, cx));

    if (k === "+" || k === "=") this.zoomBy(1, cx);
    else if (k === "-" || k === "_") this.zoomBy(-1, cx);
    else if (k === "0") this.fit(cx);
    else if (k === "1") this.actual(cx);
    else if (k === "pagedown" || k === "space") sideways(1);
    else if (k === "pageup" || k === "backspace") sideways(-1);
    else if (paged && k === "g" && !m.shift) this.pageGo(1, cx);
    else if (paged && (k === "G" || k === "g")) this.pageGo(this.pages, cx);
    else if ((k === "h" || k === "left") && !pan) sideways(-1);
    else if ((k === "l" || k === "right") && !pan) sideways(1);
    else if (k === "h" || k === "left") this.pan(d, 0, cx);
    else if (k === "l" || k === "right") this.pan(-d, 0, cx);
    else if (k === "k" || k === "up") this.pan(0, d, cx);
    else if (k === "j" || k === "down") this.pan(0, -d, cx);
    else if (k === "r" || k === "R") this.turn(m.shift || k === "R" ? -1 : 1, cx);
    else if (k === "b") this.checker = !this.checker;
    else return false;

    return true;
  }

  key(e: KeyEvent, cx: Context): void {
    const k = keyOf(e);
    const m = e.modifiers;

    if (m.platform || m.control || m.alt) return;

    const how = this.how?.how;
    // ? opens the keys in the file's place, ? esc q close them; meanwhile they take every key (keyhelp.ts).
    const help = keysKey(e, this.keysShown);

    if (help || this.keysShown) {
      if (help) this.keysShown = help === "toggle" ? !this.keysShown : false;

      cx.stop_propagation();
      cx.notify();

      return;
    }

    if (!this.commonKey(k, m, cx) && !this.kindKey(how ?? null, k, m, cx)) return;

    cx.stop_propagation();
    cx.notify();
  }

  /** The keys every way of showing takes: the bar's, open, edit, copy, files, next / previous. */
  commonKey(k: string, m: Modifiers, cx: Context): boolean {
    if (this.barKey(k, m, cx)) return true;

    if (k === "o") this.system();
    else if (k === "e") this.edit();
    else if (k === "y") this.copyPath(cx);
    else if (k === "f") this.reveal();
    else if (k === "n" || k === "]") this.go(1, cx);
    else if (k === "p" || k === "[") this.go(-1, cx);
    else return false;

    return true;
  }

  /** The keys of the way the file is shown. */
  kindKey(how: How["how"] | null, k: string, m: Modifiers, cx: Context): boolean {
    if (how === "table" || how === "diff") return this.rowKey(k, m, cx);

    if (how === "native" && this.kind === "pdf") return this.pdfKey(k, m, cx);

    if (how === "image" || how === "raster") return this.pictureKey(k, m, cx);

    if (how === "native" && (this.kind === "video" || this.kind === "audio")) return this.mediaKey(k, m);

    return false;
  }

  /** `preview.<command>` (keys.json, `herdr-app do`): every shown preview takes it. */
  command(c: string, cx: Context): void {
    if (c === "keys") this.keysShown = !this.keysShown;
    else if (c === "zoom_in") this.zoomBy(1, cx);
    else if (c === "zoom_out") this.zoomBy(-1, cx);
    else if (c === "fit") this.fit(cx);
    else if (c === "actual") this.actual(cx);
    else if (c === "next") this.go(1, cx);
    else if (c === "prev") this.go(-1, cx);
    else if (c === "page_next") this.pageGo("next", cx);
    else if (c === "page_prev") this.pageGo("prev", cx);
    else if (c === "rotate") this.turn(1, cx);
    else if (c === "background") this.checker = !this.checker;
    else if (c === "reload") {
      this.copy = null;
      this.stamp = null;
      this.load(cx);
    }
  }

  wheel(e: ScrollWheelEvent, cx: Context): void {
    const m = e.modifiers;
    const dy = e.delta.y;
    const dx = e.delta.x;
    const how = this.how?.how;

    if (how === "text" || how === "markdown") {
      this.sy = Math.max(0, Math.min(this.maxScroll(), this.sy - unzoom(dy)));
      cx.notify();

      return;
    }

    if (how === "table" || how === "diff") {
      // Shift turns a mouse wheel sideways; a trackpad scrolls both ways at once.
      if (m.shift && !dx) this.scrollBy(-unzoom(dy), 0);
      else this.scrollBy(-unzoom(dx), -unzoom(dy));

      cx.notify();

      return;
    }

    const v = this.current();

    if (!v) return;

    if (m.platform || m.control) {
      const k = Math.exp(Math.max(-1, Math.min(1, dy / 240)));

      this.set(zoomTo(v, v.scale * k, this.img(), this.port, pointOf(e)), cx);
    } else if (this.pannable()) this.set(panBy(v, dx, dy, this.img(), this.port), cx);
    else return;

    cx.notify();
  }

  // ---- parts

  /** A control on the bar or the strip; tab / shift-tab reach it in drawing order. */
  chip(t: Theme, id: string, label: string, action: (cx: Context) => void, on = false): Element {
    this.chips.push({ id, action });

    const ringed = this.ring === id && this.focusedNow;

    const base = h_flex().id(id).relative().h(20).px(6).flex_none().items_center()
      .text_color(on || ringed ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        action(cx);
        cx.notify();
      });

    const lit = on ? base.child(checker(t.ansi0, 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)) : base;
    const framed = ringed ? lit.child(div().absolute().inset_0().border(1).border_color(t.accent)) : lit;

    return framed.child(div().relative().child(label));
  }

  /** ? keys, the bar's last control (keyhelp.ts); tab rings it like the chips. */
  keysChip(t: Theme): Element {
    const toggle = (): void => {
      this.keysShown = !this.keysShown;
    };

    this.chips.push({ id: "img-keys", action: toggle });

    const ringed = this.ring === "img-keys" && this.focusedNow;
    const hint = keysHint(t, "img-keys", this.keysShown || ringed, toggle).relative().h(20).px(4).ml(2);

    return ringed ? hint.child(div().absolute().inset_0().border(1).border_color(t.accent)) : hint;
  }

  /** `?`: the keys that do something here, in the file's place (keyhelp.ts): a
   *  native view (a PDF, a video) would draw over anything laid on it. */
  keysStrip(t: Theme): Element {
    const how = this.how;

    const list = keyList(how?.how ?? null, this.kind, {
      editable: this.editable(),
      db: Boolean(this.db),
      paged: how?.how === "raster" && !how.firstOnly && this.pages > 1,
    });

    return div().relative().flex_1().min_h(0)
      .child(keysView(t, {
        id: "preview-keys",
        title: this.kind ?? "preview",
        list,
        close: () => {
          this.keysShown = false;
        },
      }));
  }

  /** "1920 × 1080 · PNG · 2.4 MB · animated", "12 034 rows × 9 columns · 3.1 MB", "3 files · +120 −40". */
  facts(w: number): string {
    const i = this.info;

    if (!i) return "";

    const parts: string[] = [];

    const size = (): void => {
      if (w >= 600 && i.bytes >= 0) parts.push(fileSize(i.bytes));
    };

    if (this.kind === "image") {
      if (i.width) parts.push(`${i.width} × ${i.height}`);

      if (w >= 520 && i.format) parts.push(i.format.toUpperCase());

      size();

      if (w >= 680 && i.animated) parts.push(this.still ? "still while turned" : i.frames ? `${i.frames} frames` : "animated");
    } else if (this.grid && this.kind === "table") {
      parts.push(`${count(this.grid.body.length)} rows × ${this.grid.wide || this.grid.cols.length} columns`);

      if (w >= 560 && held(this).sep === ";") parts.push("; separated");

      size();
    } else if (this.kind === "sqlite") {
      if (this.db) parts.push(`${this.db.tables.length} ${this.db.tables.length === 1 ? "table" : "tables"}`);

      size();
    } else if (this.patch) {
      const f = this.patch.files.length;

      parts.push(`${f} ${f === 1 ? "file" : "files"}`);
      size();
    } else if (this.kind === "pdf") {
      const n = this.pdf?.pageCount || this.pages;

      if (n) parts.push(`${n} ${n === 1 ? "page" : "pages"}`);

      size();
    } else if (this.kind === "video" || this.kind === "audio") {
      if (this.media?.duration) parts.push(duration(this.media.duration));

      if (w >= 520) parts.push(lastPart(this.path).toUpperCase());

      size();
    } else if (this.text && !this.text.md) {
      const n = this.text.starts.length;

      parts.push(`${count(n)} ${n === 1 ? "line" : "lines"}`);
      size();
    } else {
      if (i.format) parts.push(i.format.toUpperCase());

      size();
    }

    return parts.join(" · ");
  }

  /** The kind's own controls in the bar, always in the same places. */
  controls(t: Theme, w: number, el: Element): Element {
    const how = this.how;

    if (how?.how === "image" || how?.how === "raster") {
      const v = this.view;

      if (!v || !this.ready()) return el;

      const paged = how.how === "raster" && !how.firstOnly && this.pages > 1 ? this.pager(t, el, this.page, this.pages) : el;
      const turnLabel = (how.how === "image" && this.note) || (v.rot ? `turn ${v.rot * 90}°` : "turn");

      // The scale, then two chips that each do what they say: one toggle labelled
      // by its state ("fit 21%" zooming to 100%) read backwards and moved under the pointer.
      return paged
        .when(w >= 400, (e2) => e2.child(div().flex_none().text_color(t.dim).child(percent(v.scale))))
        .child(this.chip(t, "img-fit", "fit", (cx) => this.fit(cx), v.fit))
        .child(this.chip(t, "img-actual", "100%", (cx) => this.actual(cx), !v.fit && Math.abs(v.scale - 1) < 1e-9))
        .when(w >= 380, (e2) => e2.child(this.chip(t, "img-turn", turnLabel, (cx) => this.turn(1, cx), Boolean(v.rot))))
        .when(w >= 460 && how.how === "image", (e2) => e2.child(this.chip(t, "img-bg", this.checker ? "checker" : "dark", () => {
          this.checker = !this.checker;
        })));
    }

    const p = this.pdf;

    if (how?.how === "native" && this.kind === "pdf" && p?.pageCount) {
      const scale = p.scale ?? 0;

      return this.pager(t, el, p.page ?? 1, p.pageCount)
        .when(w >= 400 && scale > 0, (e2) => e2.child(div().flex_none().text_color(t.dim).child(percent(scale))))
        .child(this.chip(t, "pdf-out", "−", (cx) => this.zoomBy(-1, cx)))
        .child(this.chip(t, "pdf-fit", "fit", (cx) => this.fit(cx), p.autoScales === true))
        .child(this.chip(t, "pdf-in", "+", (cx) => this.zoomBy(1, cx)));
    }

    return el;
  }

  /** ‹ 3/12 › for pages. */
  pager(t: Theme, el: Element, page: number, pages: number): Element {
    return el
      .child(this.chip(t, "page-prev", "‹", (cx) => this.pageGo("prev", cx)))
      .child(div().flex_none().text_color(t.foreground).child(`p ${page}/${pages}`))
      .child(this.chip(t, "page-next", "›", (cx) => this.pageGo("next", cx)));
  }

  toolbar(t: Theme): Element {
    const w = unzoom(this.port.width) || 600;
    const index = this.names.indexOf(basename(this.path));
    const many = this.names.length > 1;
    const facts = this.facts(w);

    const head = h_flex().id("preview-toolbar").relative().h(34).flex_none().px(10).gap(8).items_center().text_size(11)
      .when(w >= 320, (e2) => e2.child(div().flex_none().text_color(t.ansi8).child(tag(this.kind, this.path))))
      .child(h_flex().flex_1().min_w(0).gap(8).items_baseline()
        .child(div().flex_none().max_w_full().truncate().text_color(t.foreground).child(basename(this.path || "Preview")))
        .when(w >= 420 && Boolean(facts), (e2) => e2.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(facts))))
      .when(many && w >= 360, (e2) => e2
        .child(this.chip(t, "img-prev", "‹", (cx) => this.go(-1, cx)))
        .child(div().flex_none().text_color(t.dim).child(index >= 0 ? `${index + 1}/${this.names.length}` : `${this.names.length}`))
        .child(this.chip(t, "img-next", "›", (cx) => this.go(1, cx))));

    return this.controls(t, w, head)
      .when(Boolean(this.path), (e2) => e2
        .when(w >= 360 && this.editable(), (e3) => e3.child(this.chip(t, "img-edit", "edit", () => this.edit())))
        .when(w >= 300, (e3) => e3.child(this.chip(t, "img-files", "files", () => this.reveal())))
        .when(w >= 540 && !this.on, (e3) => e3.child(this.chip(t, "img-open", "open", () => this.system())))
        .when(w >= 620, (e3) => e3.child(this.chip(t, "img-copy", this.copied ? "copied" : "copy", (cx) => this.copyPath(cx), Boolean(this.copied)))))
      .child(this.keysChip(t))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(checker(t.ansi0, 1)));
  }

  /** A second strip: a database's tables, or what's left out of a table or patch. */
  strip(t: Theme): Element | null {
    const db = this.db;
    const tables = db?.tables ?? [];
    // A picture's note sits on its turn chip.
    const note = this.how?.how === "image" ? null : this.note;

    if (!tables.length && !note) return null;

    const shownAt = db?.at ?? 0;

    return h_flex().id("preview-strip").relative().h(26).flex_none().px(10).gap(2).items_center().text_size(11).overflow_hidden()
      .children(tables.map((x, i) => this.chip(t, `db-table-${i}`, x.type === "view" ? `${x.name} (view)` : x.name, (cx) => {
        if (i !== shownAt) this.pickTable(i, cx);
      }, i === shownAt)))
      .when(Boolean(note), (el) => el.child(div().flex_1().min_w(0).when(tables.length > 0, (e2) => e2.pl(8)).truncate().text_color(t.ansi3).child(note ?? "")))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(checker(t.ansi0, 1)));
  }

  empty(t: Theme, title: string, hint: string | null, offer = false): Element {
    return v_flex().size_full().items_center().justify_center().gap(10).px(16).text_size(11)
      .child(svg(`${ART}/moon-8.svg`).w(44).h(44).text_color(t.ansi8).opacity(0.6))
      .child(div().text_color(t.foreground).child(title))
      .when(Boolean(hint), (el) => el.child(div().text_center().text_color(t.ansi8).child(hint ?? "")))
      .when(offer && !this.on && Boolean(this.path), (el) => el.child(h_flex().pt(4).text_color(t.muted)
        .child(this.chip(t, "empty-open", "open in its app  o", () => this.system()))));
  }

  /** Where the view is when part of the picture is out of it: dithered rails on the
   *  right and bottom edges, as the Markdown viewer's scrollbar. */
  rails(t: Theme, box: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }, focused: boolean): Element[] {
    const port = this.port;
    const out: Element[] = [];
    const color = focused ? t.accent : t.ansi8;

    if (box.height > port.height + 1) {
      const shown = port.height / box.height;
      const top = (-box.top / box.height) * port.height;

      out.push(div().absolute().right(1).w(3).top(unzoom(top)).h(unzoom(Math.max(16, port.height * shown))).child(checker(color, 1)));
    }

    if (box.width > port.width + 1) {
      const shown = port.width / box.width;
      const left = (-box.left / box.width) * port.width;

      out.push(div().absolute().bottom(1).h(3).left(unzoom(left)).w(unzoom(Math.max(16, port.width * shown))).child(checker(color, 1)));
    }

    return out;
  }

  picture(t: Theme, v: Look, focused: boolean): Element[] {
    const box = placed(v, this.img(), this.port);
    const l = unzoom(box.left);
    const tp = unzoom(box.top);
    const w = unzoom(box.width);
    const h = unzoom(box.height);
    const paper = this.how?.how === "raster";
    const under = div().absolute().left(l).top(tp).w(w).h(h).overflow_hidden().bg(paper ? "#ffffff" : this.checker ? t.hover : t.background);

    return [
      // The checker sits under the picture only: transparency reads, the pane stays dark.
      // A PDF page is paper: white under it.
      this.checker && !paper ? under.child(checker(t.ansi0, 8)) : under,
      image(this.src ?? "").id(`img-${this.slot ?? "view"}`).absolute().left(l).top(tp).w(w).h(h),
      ...this.rails(t, box, focused),
    ];
  }

  /** The macOS view for a PDF, a font or a clip; under it, what shows while it loads. */
  native(t: Theme, view: "pdf" | "quicklook" | "media"): Element[] {
    const path = this.local ?? this.path;

    return [herdr.nativeView.new(this.nativeId(), this.rev ? { kind: view, path, rev: this.rev } : { kind: view, path })
      .child(this.embedded ? this.standIn(t) : this.empty(t, view === "media" ? "Opening the player…" : "Opening…", tilde(this.path, home())))];
  }

  /** Dithered rails for rows that don't all fit: right (rows), bottom (columns). */
  rowRails(t: Theme, focused: boolean, top: number, roomH: number, roomW: number, left: number): Element[] {
    const out: Element[] = [];
    const color = focused ? t.accent : t.ansi8;
    const total = this.rowCount() * ROW;

    if (total > roomH + 1) {
      const h = Math.max(16, roomH * (roomH / total));
      const y = top + (this.sy / Math.max(1, total - roomH)) * (roomH - h);

      out.push(div().absolute().right(1).w(3).top(y).h(h).child(checker(color, 1)));
    }

    const width = this.tableWidth();

    if (this.grid && width > roomW + 1) {
      const w = Math.max(16, roomW * (roomW / width));
      const x = left + (this.sx / Math.max(1, width - roomW)) * (roomW - w);

      out.push(div().absolute().bottom(1).h(3).left(x).w(w).child(checker(color, 1)));
    }

    return out;
  }

  /** The rows on screen, from the scroll position. */
  shownRange(): readonly [first: number, last: number] {
    const first = Math.max(0, Math.floor(this.sy / ROW));
    const last = Math.min(this.rowCount(), first + this.visibleRows() + 2);

    return [first, last];
  }

  /** A table: header row and row numbers stay put, the cells scroll both ways. */
  tableView(t: Theme, g: Table, focused: boolean): Element[] {
    const font = code();
    const gut = this.gutter();
    const roomW = unzoom(this.port.width) - gut;
    const roomH = unzoom(this.port.height) - ROW;
    const [first, last] = this.shownRange();

    const cell = (c: Column, v: string, head: boolean): Element => {
      const el = div().w(this.colWidth(c)).flex_none().px(CELL).truncate();

      return (c.num && !head ? el.text_right() : el).text_color(head ? t.foreground : v === "" ? t.dim : t.foreground).child(oneLine(v));
    };

    const rows: Element[] = [];

    for (let r = first; r < last; r++) {
      const row = g.body[r] ?? [];
      const cur = r === this.cursor;
      const line = h_flex().absolute().left(0).top(ROW + r * ROW - this.sy).h(ROW).w_full().items_center();

      rows.push((cur ? line.bg(t.hover) : line)
        .child(div().w(gut).flex_none().h_full().flex().items_center().justify_end().pr(CELL).text_color(cur ? t.accent : t.dim).child(String(r + 1)))
        .child(div().relative().flex_1().min_w(0).h_full().overflow_hidden()
          .child(h_flex().absolute().top(0).h_full().items_center().left(-this.sx)
            .children(g.cols.map((c, i) => cell(c, row[i] ?? "", false))))));
    }

    const head = h_flex().absolute().left(0).top(0).h(ROW).w_full().items_center().bg(t.background)
      .child(div().w(gut).flex_none())
      .child(div().relative().flex_1().min_w(0).h_full().overflow_hidden()
        .child(h_flex().absolute().top(0).h_full().items_center().left(-this.sx)
          .children(g.cols.map((c) => cell(c, c.name, true)))))
      .child(div().absolute().left(0).right(0).bottom(0).h(1).child(checker(t.ansi8, 1)));

    const body = !g.body.length ? [div().absolute().left(gut + CELL).top(ROW + 8).text_color(t.dim).child("No rows")] : rows;

    return [div().absolute().inset_0().font_family(font).text_size(12).children([...body, head, ...this.rowRails(t, focused, ROW, roomH, roomW, gut)])];
  }

  /** One row of a patch. */
  patchRow(t: Theme, row: PatchRow, wide: boolean): Element {
    const font = code();
    const num = (n: number | null, w: number): Element => div().w(w).flex_none().text_right().pr(6).text_color(t.dim).child(n === null ? "" : String(n));

    if (row.kind === "file") {
      const el = h_flex().h(ROW).w_full().relative().items_center().px(10).gap(10).text_size(11)
        .child(div().absolute().left(0).right(0).bottom(0).h(1).child(checker(t.ansi0, 1)))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(row.old ? `${row.old} → ${row.path}` : row.path || "(no name)"));

      return (row.binary ? el.child(div().flex_none().text_color(t.dim).child("binary")) : el)
        .child(div().flex_none().text_color(t.ansi2).child(`+${row.add}`))
        .child(div().flex_none().text_color(t.ansi1).child(`-${row.del}`));
    }

    if (row.kind === "@") {
      const el = h_flex().h(ROW).w_full().relative().items_center().px(8).gap(10).text_size(11)
        .child(checker(t.ansi0, 2))
        .child(div().relative().flex_none().px(4).bg(t.background).text_color(t.accent).child(wide ? row.range : row.range.replace(/^@@ | @@$/g, "")));

      return row.text ? el.child(div().relative().min_w(0).truncate().px(4).bg(t.background).text_color(t.muted).child(row.text)) : el;
    }

    if (row.kind === "note") return h_flex().h(ROW).w_full().items_center().px(10).font_family(font).text_size(12).child(div().min_w(0).truncate().text_color(t.dim).child(row.text || " "));

    const tint = row.kind === "+" ? t.ansi2 : row.kind === "-" ? t.ansi1 : null;
    const o = "o" in row ? row.o : null;
    const n = "n" in row ? row.n : null;
    const line = h_flex().h(ROW).w_full().relative().items_center().font_family(font).text_size(12);
    const edge = div().w(3).h_full().flex_none().relative();

    return (tint ? line.bg(`${tint}16`) : line)
      .child(tint ? edge.child(checker(tint, 1)) : edge)
      .children(wide ? [num(o, 38), num(n, 38)] : [num(n ?? o, 34)])
      .child(div().w(wide ? 14 : 12).flex_none().text_color(tint ?? t.dim).child(row.kind === "+" || row.kind === "-" ? row.kind : ""))
      .child(div().flex_1().min_w(0).truncate().pr(8)
        .text_color(row.kind === "\\" ? t.dim : row.kind === " " ? t.muted : t.foreground).child(row.text || " "));
  }

  /** A patch, as diff draws one, with each file's name over its part. */
  diffView(t: Theme, p: Patch, focused: boolean): Element[] {
    const wide = unzoom(this.port.width) >= 560;
    const [first, last] = this.shownRange();
    const rows: Element[] = [];

    for (let r = first; r < last; r++) {
      const row = p.rows[r];

      if (!row) continue;

      const place = div().absolute().left(0).right(0).top(r * ROW - this.sy).h(ROW);

      rows.push((r === this.cursor && focused ? place.child(div().absolute().left(0).top(0).bottom(0).w(1).bg(t.accent)) : place).child(this.patchRow(t, row, wide)));
    }

    const body = !p.rows.length ? [div().absolute().left(16).top(12).text_size(11).text_color(t.dim).child("Nothing in it")] : rows;

    return [div().absolute().inset_0().children([...body, ...this.rowRails(t, focused, 0, unzoom(this.port.height), 0, 0)])];
  }

  // ---- embedded: text, Markdown, the slim bar

  /** Text: the lines in view, numbered, in the editor's colors. */
  textView(t: Theme, x: TextLook): Element[] {
    const colors = this.colors ?? syntaxColors(t);

    this.colors = colors;

    const room = unzoom(this.port.height) || 400;
    const { cols, gutter, at, rows: total } = this.wrapped(x);
    const first = Math.max(0, Math.floor(this.sy / LINE));
    const last = Math.min(total, first + Math.ceil(room / LINE) + 2);
    const rows: Element[] = [];

    for (let r = first; r < last; r++) {
      // A wrapped row: its line's number on the first one only.
      const [n, k] = rowLine(at, r);
      const runs = sliceRuns(this.runsOf(x, n, colors), k * cols, (k + 1) * cols);

      rows.push(h_flex().absolute().left(0).right(0).top(6 + r * LINE - this.sy).h(LINE).items_center()
        .child(div().w(gutter).flex_none().text_right().pr(10).text_color(t.dim).child(k ? "" : String(n + 1)))
        .child(h_flex().flex_1().min_w(0).overflow_hidden().pr(8)
          .children(runs.map(([piece, color]) => div().flex_none().whitespace_nowrap().text_color(color ?? t.foreground).child(piece)))));
    }

    return [div().absolute().inset_0().font_family(code()).text_size(12).children(rows), ...this.textRail(t, total * LINE + 12)];
  }

  /** Markdown, rendered as the viewer renders it; its measured height bounds the scroll. */
  mdView(t: Theme, x: TextLook): Element[] {
    return [
      div().absolute().left(0).right(0).top(-this.sy).px(14).pt(10).pb(14).text_size(12.5).text_color(t.foreground)
        .on_size_change((size, cx) => {
          const h = unzoom(size.height);

          if (Math.abs(h - x.height) > 1) {
            x.height = h;
            cx.notify();
          }
        })
        .child(TextView.markdown("look-md", x.body)),
      ...this.textRail(t, x.height + 24),
    ];
  }

  /** Where the view is in a long text: the dithered rail on the right. */
  textRail(t: Theme, total: number): Element[] {
    const room = unzoom(this.port.height);

    if (!(total > room + 1) || !room) return [];

    const h = Math.max(16, room * (room / total));
    const y = (this.sy / Math.max(1, total - room)) * (room - h);

    return [div().absolute().right(1).w(3).top(y).h(h).child(checker(t.ansi8, 1))];
  }

  /** The look's bar: the kind (a language for code), the name, the facts, what's left out. */
  lookBar(t: Theme): Element {
    const w = unzoom(this.port.width) || 400;
    const lang = this.kind === "text" ? this.text?.lang : null;
    const kind = lang ? lang.toUpperCase() : tag(this.kind, this.path);
    const facts = this.error ? "" : this.facts(w);
    const note = this.error || this.busy ? null : this.note;

    return h_flex().id("look-bar").relative().h(26).flex_none().px(10).gap(8).items_center().text_size(11).overflow_hidden()
      .child(div().flex_none().text_color(t.ansi8).child(kind))
      .child(div().flex_shrink(1).min_w(0).truncate().text_color(t.foreground).child(basename(this.path)))
      .when(Boolean(facts) && w >= 220, (el) => el.child(div().flex_shrink(1).min_w(0).truncate().text_color(t.dim).child(facts)))
      .child(div().flex_1())
      .when(Boolean(note) && w >= 260, (el) => el.child(div().flex_shrink(1).min_w(0).truncate().text_color(t.ansi3).child(note ?? "")))
      .child(div().absolute().left(0).right(0).bottom(0).h(1).child(checker(t.ansi0, 1)));
  }

  /** One plain line (a binary, an unreadable file, reading). */
  line(t: Theme, text: string): Element {
    return div().px(12).py(10).text_size(11).text_color(t.dim).child(text);
  }

  /** What shows under a native view while it loads, or while a menu sets it aside. */
  standIn(t: Theme): Element {
    return v_flex().size_full().items_center().justify_center().gap(6).px(16).text_size(11).bg(t.background)
      .child(div().text_color(t.ansi8).child(tag(this.kind, this.path)))
      .child(div().max_w_full().truncate().text_color(t.foreground).child(basename(this.path)));
  }

  /** The file's place: what's read, drawn the way its kind is shown. */
  inner(t: Theme, focused: boolean): Element[] {
    const how = this.how;
    const text = this.text;
    const v = this.current();

    if (this.embedded && !this.path) return [];

    if (this.embedded && this.error) return [this.line(t, this.error)];

    if (this.embedded && this.busy) return [this.line(t, this.busy)];

    if (this.embedded && how?.how === "text" && text) return this.textView(t, text);

    if (this.embedded && how?.how === "markdown" && text) return this.mdView(t, text);

    if (this.error) return [this.empty(t, `Can't preview this ${noun(this.kind)}`, this.error, true)];

    if (this.busy) return [this.empty(t, this.busy, tilde(this.path, home()))];

    if (how?.how === "native") return this.native(t, how.view);

    if (how?.how === "table" && this.db && !this.db.tables.length) return [this.empty(t, "No tables", "This database is empty.")];

    if (how?.how === "table" && this.grid) return this.tableView(t, this.grid, focused);

    if (how?.how === "diff" && this.patch) return this.diffView(t, this.patch, focused);

    if (!this.src) return [this.empty(t, "Reading…", tilde(this.path, home()))];

    return v ? this.picture(t, v, focused) : [];
  }

  /** A press on the file: a table's or a patch's row, a double click fits or
   *  shows 100%, else a drag that pans starts. */
  press(e: { readonly click_count: number; readonly local_position?: Point | undefined }, cx: Context): void {
    const how = this.how?.how;
    const at = pointOf(e);

    // Embedded: the keyboard stays in the tree.
    if (!this.embedded) this.handle?.focus();

    if ((how === "table" || how === "diff") && at) {
      const head = how === "table" ? ROW : 0;
      const r = Math.floor((unzoom(at.y) - head + this.sy) / ROW);

      if (unzoom(at.y) >= head && r >= 0 && r < this.rowCount()) {
        this.cursor = r;
        cx.notify();
      }

      return;
    }

    const v = this.current();

    if (e.click_count === 2 && at && v) {
      if (v.fit) this.actual(cx, at);
      else this.fit(cx);

      this.drag = null;
      cx.notify();

      return;
    }

    if (at && v && this.pannable()) {
      this.drag = { from: at, x: v.x, y: v.y };
      cx.notify();
    }
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
    this.current();

    // Drawn first so tab goes bar, then strip, then the body's controls.
    const bar = this.embedded ? this.lookBar(t) : this.toolbar(t);
    const strip = this.error || this.busy || this.embedded ? null : this.strip(t);
    const inner = this.inner(t, focused);
    const frame = div().id("preview-view").relative().flex_1().min_h(0).overflow_hidden();

    const body = (this.pannable() ? (this.drag ? frame.cursor_grabbing() : frame.cursor_grab()) : frame)
      .on_size_change((size, cx) => this.resized(size, cx))
      .on_scroll_wheel((e, cx) => this.wheel(e, cx))
      .on_mouse_down("left", (e, cx) => this.press(e, cx))
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
