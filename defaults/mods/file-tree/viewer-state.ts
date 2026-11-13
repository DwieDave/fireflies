// The viewer's state and small helpers (viewer.ts): its records (titles,
// paths), the reads' limits and shell scripts, the props a host passes, the
// native views' answers, the shapes it holds (a copy, a text look, a table, a
// drag), and the helpers its parts share (zoom, the checker, paths). Shared
// like viewer.ts: preview, editor and file-tree ship it unchanged.

import { PathBuilder, Background } from "gpui-kit";
import type { Color, Context, Element, MouseButtonEvent, Point } from "gpui-kit";
import * as herdr from "herdr";
import { settings, exec, window as appWindow } from "herdr";
import type { ExecResult, PaneInfo } from "herdr";
import type { Guarded } from "./guard.ts";
import { isBoolean, isNull, isNumber, isString, nullable, object, oneOf, sharedMapKey } from "./guard.ts";
import type { LookKind, Route, Run } from "./kinds.ts";
import type { Format } from "./image.ts";
import type { DbTable, Separator, Table } from "./table.ts";
import { MAX_BYTES } from "./table.ts";
import type { Patch } from "./diff.ts";
import type { default as Viewer } from "./viewer.ts";

export const MOD = "preview";

// Each preview's shown file by slot: its name for the pane header
// (nocturne/header.ts), its path so a second click on it finds this preview.
export const TITLES = sharedMapKey(`${MOD}.titles`, isString);
export const PATHS = sharedMapKey(`${MOD}.paths`, oneOf(isString, isNull));
export const ART = "mods/nocturne/art";

// Copies of what's shown, under the app's folder (where image() reads).
export const CACHE = `cache/${MOD}`;

// The first bytes read for the size and format.
export const HEAD = 262144;

// A file on another machine: read it this often; fetched up to this size.
export const POLL = 4000;
export const REMOTE_MAX = 6 * 1024 * 1024;

// Pan steps: a key, and a key with shift.
export const NUDGE = 60;
export const SHOVE = 240;

// Audio and video: seconds a key moves, and with shift.
export const SEEK = 5;
export const SEEK_FAR = 30;

// Formats the SVG renderer can embed when turning a picture; others get a PNG copy first.
export const EMBEDS: readonly (Format | "pdf" | null)[] = ["png", "jpeg", "gif", "webp", "svg"];

// Tables and patches: a row's height, a character's width in the code font
// (12 px), a cell's side padding, the row numbers' column.
export const ROW = 22;
export const CH = 7.25;
export const CELL = 8;
export const GUTTER_MIN = 40;

// Kinds drawn from a cached copy (named by contents), and kinds read as text.
export const COPIED: readonly (LookKind | null)[] = ["image", "pdf", "font", "video", "audio"];

// Embedded (the files pane's split): text is read this far (Markdown is drawn
// whole, so less of it), a line of it this tall.
export const LOOK_BYTES = 256 * 1024;
export const LOOK_MD_BYTES = 64 * 1024;
export const LINE = 18;

// Text: its size, how many NULs its start has (a binary has some), then (none) its first bytes.
// Exit 3: not there; 5: not readable; 6: not a file (a socket, a device).
export const LOOK_HEAD = `[ -e "$1" ] || [ -L "$1" ] || exit 3; [ -f "$1" ] || exit 6; [ -r "$1" ] || exit 5
wc -c < "$1"; n=$(head -c 8000 "$1" | tr -dc '\\000' | wc -c); echo $n; [ "$n" -gt 0 ] || head -c "$2" "$1"`;

// One copy per contents: `<crc>-<bytes>.<ext>` (then its size line and its first bytes).
export const COPY = `f="$1"; d="$2"; e="$3"; [ -f "$f" ] || exit 3; mkdir -p "$d" || exit 4
set -- $(cksum < "$f"); n="$1-$2.$e"
[ -f "$d/$n" ] || cp -c "$f" "$d/$n" 2>/dev/null || cp "$f" "$d/$n" || exit 4
printf '%s\\n%s\\n' "$n" "$2"; od -An -v -tx1 -N ${HEAD} "$d/$n"`;

// Text: its size, its line count, then its first bytes.
export const TEXT_HEAD = `[ -f "$1" ] || exit 3; wc -c < "$1"; wc -l < "$1"; head -c ${MAX_BYTES} "$1"`;

// What changed a file without reading it all (a database being written): size and time.
export const STAMP = `[ -f "$1" ] || exit 3; wc -c < "$1"; date -r "$1" +%s 2>/dev/null || stat -c %Y "$1"; od -An -v -tx1 -N 16 "$1"`;

/** A string or null. */
export const maybeString = nullable(isString);

/** The props: the preview pane's ({ path, on, slot }), or a host's that mounts it
 *  embedded ({ embedded, path, on, scroll: { n, dir }, reload }). */
export const isViewerProps = object({}, {
  embedded: isBoolean,
  path: maybeString,
  on: maybeString,
  slot: maybeString,
  scroll: nullable(object({ n: isNumber, dir: isNumber })),
  reload: nullable(isNumber),
});

export type ViewerProps = Guarded<typeof isViewerProps>;

/** A pane's slot, from its props. */
export const isSlotted = object({}, { slot: isString });
export const slotOf = (pane: PaneInfo): string | null => (isSlotted(pane.props) ? pane.props.slot ?? null : null);

/** What the PDF view says of itself (its state, an action's answer, its pdf.page event). */
export const isPdfFacts = object({}, { page: isNumber, pageCount: isNumber, scale: isNumber, autoScales: isBoolean });

export type PdfFacts = Guarded<typeof isPdfFacts>;

/** What the player says of itself. */
export const isMediaFacts = object({}, { duration: isNumber, rate: isNumber, time: isNumber, muted: isBoolean });

export type MediaFacts = Guarded<typeof isMediaFacts>;

/** A native view's `state` answer: { content }. */
export const isPdfState = object({ content: isPdfFacts });
export const isMediaState = object({ content: isMediaFacts });

/** A native view's event: which view, what happened, its data. */
export const isNativeEvent = object({ event: isString }, { id: maybeString, data: object({}, { message: isString, page: isNumber, pageCount: isNumber, scale: isNumber, autoScales: isBoolean }) });

/** How the shown file is drawn: a route, or (embedded) as Markdown or text. */
export type How = Route | { readonly how: "markdown" } | { readonly how: "text" };

/** What's known of the shown file: its size (bytes; -1 unknown), and a picture's
 *  size, format, EXIF orientation (1 upright) and motion. */
export interface Info {
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly format: string | null;
  readonly orientation: number;
  readonly animated: boolean;
  readonly frames: number | null;
}

export const blank = (bytes: number): Info => ({ bytes, width: 0, height: 0, format: null, orientation: 1, animated: false, frames: null });

/** A copy in the cache: its name, its path, its format; a PDF's page drawn as a PNG. */
export interface Copy {
  readonly name: string;
  readonly abs: string;
  readonly format: Format | "pdf" | null;
  readonly page?: Copy;
}

/** Text read for a look: the text, where its lines start, its highlight, its
 *  language, whether it's Markdown, its lines' runs as drawn, Markdown's
 *  measured height, and the lines wrapped to the view's width. */
export interface TextLook {
  readonly body: string;
  readonly starts: readonly number[];
  readonly spans: readonly (readonly [number, number, string])[];
  readonly lang: string | null;
  readonly md: boolean;
  readonly runs: Map<number, Run[]>;
  height: number;
  wrap: Wrapped | null;
}

export interface Wrapped {
  readonly cols: number;
  readonly gutter: number;
  readonly at: readonly number[];
}

/** A database: its tables and views, and the one shown. */
export interface Db {
  readonly tables: readonly DbTable[];
  readonly at: number;
}

/** A control on the bar or the strip, in drawing order (tab rings them). */
export interface Chip {
  readonly id: string;
  readonly action: (cx: Context) => void;
}

/** What the embedded viewer has done of its props. */
export interface Done {
  path: string | null;
  on: string | null;
  scroll: number | null;
  reload: number | null;
}

/** A press that pans: where it started, and the view's pan then. */
export interface Drag {
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
export interface Held {
  text: TextLook | null;
  grid: Table | null;
  sep: Separator | null;
  patch: Patch | null;
  starts: readonly number[];
  db: Db | null;
}

export const HELD = new WeakMap<Viewer, Held>();

export function held(view: Viewer): Held {
  const was = HELD.get(view);

  if (was) return was;

  const h: Held = { text: null, grid: null, sep: null, patch: null, starts: [], db: null };

  HELD.set(view, h);

  return h;
}

export const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
export const zoom = (): number => settings().zoom || 1;
export const unzoom = (v: number): number => v / zoom();
export const platform = (): string => appWindow().platform;
export const dpr = (): number => (platform() === "macos" ? 2 : 1);
export const code = (): string => settings().font_family || "JetBrains Mono";

/** This Fireflies places macOS views (the fork's native-view/0; stock Herdr has none). */
export const nativeViews = (): boolean => {
  try {
    return herdr.nativeViewCapabilities().available;
  } catch {
    return false;
  }
};

/** A 50% checker filling the parent, `cell` px squares (as ../nocturne/kit.ts dither). */
export function checker(color: Color, cell = 1): Element {
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr())))).absolute().top(0).left(0).size_full();
}

export const stop = (_e: MouseButtonEvent, cx: Context): void => cx.stop_propagation();
export const dirname = (p: string): string => p.replace(/\/[^/]*$/, "") || "/";
export const basename = (p: string): string => p.replace(/\/+$/, "").split("/").pop() || p;
export const tilde = (p: string, h: string): string => (!p || !h ? p : p === h ? "~" : p.startsWith(h + "/") ? "~" + p.slice(h.length) : p);
export const lastPart = (p: string): string => (p.split(".").pop() ?? "").toLowerCase();
export const failure = (cause: unknown): ExecResult => ({ code: -1, stdout: "", stderr: cause instanceof Error ? cause.message : String(cause) });
export const sh = (script: string, args: readonly string[], on: string | null = null): Promise<ExecResult> => exec("sh", ["-c", script, MOD, ...args], on ? { on } : undefined).catch(failure);

/** A pointer's place in the viewport, from an event on it. */
export const pointOf = (e: { readonly local_position?: Point | undefined }): Point | null => (e.local_position ? { x: e.local_position.x, y: e.local_position.y } : null);
