// The viewer's state and small helpers (viewer.ts): its records (titles,
// paths), the reads' limits and shell scripts, the props a host passes, the
// native views' answers, the shapes it holds (a copy, a text look, a table, a
// drag), and the helpers its parts share (zoom, the checker, paths).

import { Array as Arr, Context as Services, Effect, Option, Record as Rec, Schema, String as Str } from "effect";
import { PathBuilder, Background } from "gpui-kit";
import type { Color, Context, Element, MouseButtonEvent, Point } from "gpui-kit";
import * as herdr from "herdr";
import { settings, window as appWindow } from "herdr";
import type { ExecResult, PaneInfo } from "herdr";
import { Exec } from "@fireflies/kit";
import type { Codec, ExecError } from "@fireflies/kit";
import type { LookKind, Route, Run } from "./kinds.ts";
import type { Format } from "./image.ts";
import type { DbTable, Separator, Table } from "./table.ts";
import { MAX_BYTES } from "./table.ts";
import type { Patch } from "./diff.ts";
import type { default as Viewer } from "./viewer.ts";
import { flat } from "@fireflies/layout-look";

export const MOD = "preview";

// Each preview's shown file by slot: its name for the pane header
// (nocturne/header.ts), its path so a second click on it finds this preview.
export const TITLES = `${MOD}.titles`;
export const PATHS = `${MOD}.paths`;
export const TitleSchema = Schema.String;
export const PathSchema = Schema.NullOr(Schema.String);
export const ART = "mods/nocturne/art";

// Copies of what's shown, under the app's folder (where image() reads).
export const CACHE = `cache/${MOD}`;

// The most a copy's first bytes are read for its size and format (a picture whose
// format keeps its size far in: image.ts `headBytes` says how far each needs).
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

// One copy per contents: `<crc>-<bytes>.<ext>` (then its size line and its first $4 bytes).
export const COPY = `f="$1"; d="$2"; e="$3"; h="$4"; [ -f "$f" ] || exit 3; mkdir -p "$d" || exit 4
set -- $(cksum < "$f"); n="$1-$2.$e"
[ -f "$d/$n" ] || cp -c "$f" "$d/$n" 2>/dev/null || cp "$f" "$d/$n" || exit 4
printf '%s\\n%s\\n' "$n" "$2"; od -An -v -tx1 -N "$h" "$d/$n"`;

// Text: its size, its line count, then its first bytes.
export const TEXT_HEAD = `[ -f "$1" ] || exit 3; wc -c < "$1"; wc -l < "$1"; head -c ${MAX_BYTES} "$1"`;

// What changed a file without reading it all (a database being written): size and time.
export const STAMP = `[ -f "$1" ] || exit 3; wc -c < "$1"; date -r "$1" +%s 2>/dev/null || stat -c %Y "$1"; od -An -v -tx1 -N 16 "$1"`;

/** A string or null, left out or given. */
const maybeString = Schema.optionalKey(Schema.NullOr(Schema.String));

/** The props: the preview pane's ({ path, on, slot }), or a host's that mounts it
 *  embedded ({ embedded, path, on, scroll: { n, dir }, reload }). */
export const ViewerPropsSchema = Schema.Struct({
  embedded: Schema.optionalKey(Schema.Boolean),
  path: maybeString,
  on: maybeString,
  slot: maybeString,
  scroll: Schema.optionalKey(Schema.NullOr(Schema.Struct({ n: Schema.Finite, dir: Schema.Finite }))),
  reload: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
});

export type ViewerProps = typeof ViewerPropsSchema.Type;

/** Props from the app or a host: what this view reads of them, none when they are of another shape. */
export const viewerProps = Schema.decodeUnknownOption(ViewerPropsSchema);

/** A pane's slot, from its props. */
const slotted = Schema.decodeUnknownOption(Schema.Struct({ slot: Schema.optionalKey(Schema.String) }));

export const slotOf = (pane: PaneInfo): string | null => Option.match(slotted(pane.props), { onNone: () => null, onSome: (p) => p.slot ?? null });

/** What the PDF view says of itself (its state, an action's answer, its pdf.page event). */
export const PdfFactsSchema = Schema.Struct({
  page: Schema.optionalKey(Schema.Finite),
  pageCount: Schema.optionalKey(Schema.Finite),
  scale: Schema.optionalKey(Schema.Finite),
  autoScales: Schema.optionalKey(Schema.Boolean),
});

export type PdfFacts = typeof PdfFactsSchema.Type;

/** What the player says of itself. */
export const MediaFactsSchema = Schema.Struct({
  duration: Schema.optionalKey(Schema.Finite),
  rate: Schema.optionalKey(Schema.Finite),
  time: Schema.optionalKey(Schema.Finite),
  muted: Schema.optionalKey(Schema.Boolean),
});

export type MediaFacts = typeof MediaFactsSchema.Type;

/** A native view's `state` answer: { content }. */
export const PdfStateSchema = Schema.Struct({ content: PdfFactsSchema });
export const MediaStateSchema = Schema.Struct({ content: MediaFactsSchema });

/** A native view's event: which view, what happened, its data. */
export const NativeEventSchema = Schema.Struct({
  event: Schema.String,
  id: maybeString,
  data: Schema.optionalKey(Schema.Struct({
    message: Schema.optionalKey(Schema.String),
    page: Schema.optionalKey(Schema.Finite),
    pageCount: Schema.optionalKey(Schema.Finite),
    scale: Schema.optionalKey(Schema.Finite),
    autoScales: Schema.optionalKey(Schema.Boolean),
  })),
});

export type NativeEvent = typeof NativeEventSchema.Type;

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

  if (was !== undefined) return was;

  const h: Held = { text: null, grid: null, sep: null, patch: null, starts: [], db: null };

  HELD.set(view, h);

  return h;
}

export const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();

export const zoom = (): number => {
  const z = settings().zoom;

  return z > 0 ? z : 1;
};

export const unzoom = (v: number): number => v / zoom();
export const platform = (): string => appWindow().platform;
export const dpr = (): number => (platform() === "macos" ? 2 : 1);

export const code = (): string => {
  const font = settings().font_family;

  return font === undefined || font === null || Str.isEmpty(font) ? "JetBrains Mono" : font;
};

/** This Fireflies places macOS views (the fork's native-view/0; stock Herdr has none). */
export const nativeViews = (): boolean => {
  try {
    return herdr.nativeViewCapabilities().available;
  } catch {
    // Stock Herdr has no nativeViewCapabilities: no native views there.
    return false;
  }
};

/** A 50% checker filling the parent, `cell` px squares (as ../nocturne/kit.ts dither). */
export function checker(color: Color, cell = 1): Element {
  const plain = flat(color, cell);

  if (plain !== null) return plain;

  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr())))).absolute().top(0).left(0).size_full();
}

export const stop = (_e: MouseButtonEvent, cx: Context): void => cx.stop_propagation();
export const dirname = (p: string): string => Str.replace(/\/[^/]*$/, "")(p) || "/";

export const basename = (p: string): string => {
  const last = Arr.lastNonEmpty(Str.split(Str.replace(/\/+$/, "")(p), "/"));

  return Str.isEmpty(last) ? p : last;
};

export const tilde = (p: string, h: string): string => (Str.isEmpty(p) || Str.isEmpty(h) ? p : p === h ? "~" : Str.startsWith(h + "/")(p) ? "~" + Str.slice(h.length)(p) : p);
export const lastPart = (p: string): string => Str.toLowerCase(Arr.lastNonEmpty(Str.split(p, ".")));

/**
 * How the file's read is getting on, for its watchdog (viewer-load.ts
 * `runRead`): a wait on the app (a program, a file, a timer) starts and
 * ends. A read that is neither waiting nor moving any more was cut off: the
 * engine stops a turn that overruns its budget, and nothing after it runs.
 */
export class ReadProgress extends Services.Service<ReadProgress, {
  readonly waits: Effect.Effect<void>;
  readonly moves: Effect.Effect<void>;
}>()("@fireflies/viewer/viewer-state/ReadProgress") {}

/** `effect` (a program, a file, a timer) as a wait of the read it runs in, when it runs in one. */
export const waiting = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.flatMap(Effect.serviceOption(ReadProgress), Option.match({
    onNone: () => effect,
    onSome: (p) => Effect.andThen(p.waits, Effect.ensuring(effect, p.moves)),
  }));

/** Runs `script` in sh (`$0` the mod, `$1`… `args`), here or on machine `on`: its exit and output, whatever the code. */
export const sh = (script: string, args: readonly string[], on: string | null = null): Effect.Effect<ExecResult, ExecError, Exec> =>
  waiting(Exec.use((x) => x.run("sh", ["-c", script, MOD, ...args], on === null ? undefined : { on })));

/** A pointer's place in the viewport, from an event on it. */
export const pointOf = (e: { readonly local_position?: Point | undefined }): Point | null => (e.local_position === undefined ? null : { x: e.local_position.x, y: e.local_position.y });

// ---- shared(): maps keyed by slot

const readRecord = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));

/** The entries of shared(`name`) whose values are of `entry`'s shape (the others left out, not the whole map); empty when it isn't an object. */
export function readSharedMap<A, I>(name: string, entry: Codec<A, I>): ReadonlyMap<string, A> {
  const decodeEntry = Schema.decodeUnknownOption(entry);
  const out = new Map<string, A>();

  for (const [key, value] of Option.match(readRecord(herdr.shared(name)), { onNone: () => [], onSome: (r) => Rec.toEntries(r) })) {
    const a = decodeEntry(value);

    if (Option.isSome(a)) out.set(key, a.value);
  }

  return out;
}

/** Writes `map` as shared(`name`), an object keyed by its keys. */
export function writeSharedMap<A>(name: string, map: ReadonlyMap<string, A>): void {
  herdr.setShared(name, Rec.fromEntries(map));
}
