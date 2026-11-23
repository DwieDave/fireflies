// The viewer reading a file: what kind it is, a local copy (fetched from
// another machine, converted where the kind needs it), a PDF's page as a
// picture, a picture's facts, the folder it steps through, its title, the
// file watched for changes.
//
// Each read is an effect run on the view's runtime (viewer-fx.ts): programs
// through `Exec`, files through `Files`. A read checks the view's `gen` after
// each wait: a newer file (or none) took its place, and it leaves the view alone.

import { Array as Arr, Effect, Option, String as Str } from "effect";
import { panes, appHome, watchFolder } from "herdr";
import type { ExecResult } from "herdr";
import { Exec, Files, causeMessage, fileError, redraw } from "@fireflies/kit";
import { DecodeError } from "@fireflies/kit";
import type { ExecError, FileError } from "@fireflies/kit";
import type { ViewerServices } from "./viewer-fx.ts";
import type { Context } from "gpui-kit";
import { kindOf, lookKind, sniffKind, route, toolsFor, rasterArgv, pageCount, noun, siblings, stepIn, fileSize } from "./kinds.ts";
import type { Converter, Size } from "./image.ts";
import { formatOf, headBytes, hexBytes, sniff, sizeFromFile, plan, cantShow, wrapper, sharpness } from "./image.ts";
import type { Info, Copy } from "./viewer-state.ts";
import { ReadProgress, waiting, sh, CACHE, nativeViews, dirname, blank, COPIED, lastPart, STAMP, COPY, platform, HEAD, REMOTE_MAX, EMBEDS, dpr, basename, MOD, slotOf, TITLES, PATHS, TitleSchema, PathSchema, readSharedMap, writeSharedMap } from "./viewer-state.ts";
import type { default as Viewer } from "./viewer.ts";
import { loadLook, loadText } from "./viewer-text.ts";
import { loadDb } from "./viewer-table.ts";

/** Shows `path` from the start (a picture fitted, a table at its top). */
export function openPath(v: Viewer, path: string): void {
  const sameFolder = Str.isNonEmpty(v.path) && dirname(v.path) === dirname(path);

  if (v.embedded) v.dropNative(lookKind(path));

  v.path = path;
  v.kind = v.embedded ? lookKind(path) : kindOf(path);
  v.text = null;
  v.how = null;
  v.info = null;
  v.error = null;
  v.src = null;
  v.copy = null;
  v.busy = "Reading…";
  v.view = null;
  v.note = null;
  v.grid = null;
  v.patch = null;
  v.db = null;
  v.pdf = null;
  v.media = null;
  v.page = 1;
  v.pages = 0;
  v.sy = 0;
  v.sx = 0;
  v.cursor = 0;
  v.stamp = null;
  v.gen += 1;
  v.title();
  loadPath(v);

  // Embedded: no stepping through the folder; the files pane watches it.
  if (!sameFolder && !v.embedded) {
    v.names = [];
    listFolder(v);

    if (v.on === null && Str.isNonEmpty(path)) watchFile(v, v.gen);
  }
}

/** Reads the file (again, if it changed) and works out how to show it. */
export function loadPath(v: Viewer): void {
  const gen = v.gen;

  if (Str.isEmpty(v.path)) {
    v.error = "No file given";
    v.busy = null;

    return;
  }

  const kind = v.kind;

  if (kind === null) {
    failWith(v, "The preview doesn't know this kind of file", blank(-1));

    return;
  }

  // Another machine's pictures, PDFs, fonts and clips would be fetched whole: not for a look.
  if (v.embedded && v.on !== null && COPIED.includes(kind)) {
    failWith(v, `On ${v.on}: p opens this ${noun(kind)} in the preview`);

    return;
  }

  runRead(v, gen, kind === "text" || kind === "markdown" ? loadLook(v, gen)
    : kind === "table" || kind === "diff" ? loadText(v, gen)
    : kind === "sqlite" ? loadDb(v, gen)
    : loadCopy(v, gen));
}

/**
 * Runs a read of the file `gen` names on the view's runtime. A program that
 * couldn't run, a file that couldn't be written or an answer in another form
 * says so in the file's place (unless a newer file took it); the next one
 * loads as ever.
 */
export function runRead(v: Viewer, gen: number, read: Effect.Effect<void, ExecError | FileError | DecodeError, ViewerServices>): void {
  const cantRead = (message: string) => Effect.sync(() => {
    if (gen === v.gen) failWith(v, `Can't show it: ${message}`);
  });

  const progress: Progress = { waits: 0, moves: 0, done: false };

  v.fx?.run(Effect.catchTags(read, { ExecError: (e) => cantRead(e.message), FileError: (e) => cantRead(e.message), DecodeError: (e) => cantRead(e.message) }).pipe(
    // A bug in a read (a throw) says so the same way, for the file it was reading only.
    Effect.catchDefect((defect) => cantRead(causeMessage(defect))),
    Effect.provideService(ReadProgress, ReadProgress.of({
      waits: Effect.sync(() => {
        progress.waits += 1;
      }),
      moves: Effect.sync(() => {
        progress.waits -= 1;
        progress.moves += 1;
      }),
    })),
    // Every end it can see (done, failed, interrupted); a read the engine cut off sees none.
    Effect.ensuring(Effect.sync(() => {
      progress.done = true;
    })),
  ));
  v.fx?.run(watchdog(v, gen, progress));
}

/** What a read's watchdog sees of it. */
interface Progress {
  /** Waits on the app (programs, files, timers) under way. */
  waits: number;
  /** Waits ended (the read moved on). */
  moves: number;
  done: boolean;
}

// The watchdog looks this often; a read neither waiting nor moving for this many looks was cut off.
const WATCH_EVERY = 1000;
const STILL_LOOKS = 3;

/**
 * Watches a read for the end it can't say itself: the engine stops a turn
 * that overruns its budget (500 ms for a task), uncatchably, and the read's
 * fiber never runs again. Its pane would say "Reading…" for ever; once the
 * read has been neither waiting nor moving for STILL_LOOKS looks, the pane
 * says it was cut off instead (unless a newer file took its place).
 */
const watchdog = (v: Viewer, gen: number, progress: Progress) => Effect.gen(function* () {
  let seen = progress.moves;
  let still = 0;

  while (!progress.done && gen === v.gen) {
    yield* Effect.sleep(WATCH_EVERY);

    const moved = progress.moves !== seen || progress.waits > 0;

    seen = progress.moves;
    still = moved ? 0 : still + 1;

    if (!progress.done && gen === v.gen && still >= STILL_LOOKS) {
      failWith(v, "Can't show it: reading it was cut off before it finished (it took the app too long in one go)");

      return;
    }
  }
});

/** Of a picture's first bytes, this many text characters of `od` are read into bytes a turn. */
const SLICE = 64 * 1024;

/**
 * `od -An -v -tx1` text as bytes, a slice a turn: a picture's head (256 KB:
 * 800 KB of text) in one go can overrun the engine's turn budget under load
 * and be cut off. Between slices a 1 ms wait (a timer: a turn of its own).
 */
export const hexBytesIn = Effect.fnUntraced(function* (text: string) {
  const out: number[] = [];
  const lineEnd = /\n/g;
  let at = 0;

  while (at < text.length) {
    lineEnd.lastIndex = at + SLICE;

    const cut = at + SLICE < text.length ? lineEnd.exec(text) : null;
    const end = cut === null ? text.length : cut.index + 1;

    for (const b of hexBytes(Str.slice(at, end)(text))) out.push(b);

    at = end;

    if (at < text.length) yield* waiting(Effect.sleep(1));
  }

  return out;
});

/** A non-picture's first bytes say what it is in its first 16 (PDF, the font formats, SQLite). */
const SNIFF_BYTES = 16;

export function failed(r: ExecResult): string {
  return r.code === 3 ? "It isn't there (moved or deleted?)" : Str.trim(Str.isEmpty(r.stderr) ? "Can't read it" : r.stderr);
}

/** The view says why the file isn't shown (the run's end, or the caller, redraws it). */
export function failWith(v: Viewer, error: string, info?: Info): void {
  if (info !== undefined) v.info = info;

  v.error = error;
  v.busy = null;
  v.src = null;
}

/**
 * The first two lines of a read's output (each trimmed) and the rest: `wc -c`,
 * `wc -l` (or the NULs counted), then the bytes. Output in another form (a
 * program that answered something else) is a `DecodeError` naming `what`.
 */
export function headLines(stdout: string, what: string): Effect.Effect<readonly [string, string, string], DecodeError> {
  const m = /^([^\n]*)\n([^\n]*)\n([\s\S]*)$/.exec(stdout);

  return m === null
    ? Effect.fail(DecodeError.make({ what, message: `${what} came back in another form than its size, a count and its text` }))
    : Effect.succeed([Str.trim(m[1] ?? ""), Str.trim(m[2] ?? ""), m[3] ?? ""]);
}

/** Which tools route() asks after are installed (here, or on `on`). */
export const tools = Effect.fnUntraced(function* (view: Viewer) {
  const want = toolsFor(view.kind);

  if (want.length === 0) return [];

  // sqlite3 runs where the database is; a PDF is drawn here from its copy.
  const r = yield* sh('for t; do command -v "$t" >/dev/null 2>&1 && echo "$t"; done; true', want, view.kind === "sqlite" ? view.on : null);

  return Arr.filter(Str.split(r.stdout, "\n"), Str.isNonEmpty);
});

/** Whether a file is there and not empty. */
const hasFile = (path: string) => Effect.map(sh('[ -s "$1" ]', [path]), (r) => r.code === 0);

/** Media (played from where it is): known by its size and time instead of a checksum, as a copy's answer. */
const mediaStamp = Effect.fnUntraced(function* (path: string) {
  const r = yield* sh(STAMP, [path]);

  if (r.code !== 0) return r;

  const [size = "", time = "", ...rest] = Str.split(r.stdout, "\n");

  return { code: 0, stdout: `${time}-${size}\n${size}\n${Arr.join(rest, " ")}`, stderr: "" };
});

/** Pictures, PDFs, fonts, media: a copy in the cache by contents, then its first bytes say what it is. */
export const loadCopy = Effect.fnUntraced(function* (v: Viewer, gen: number) {
  const path = v.path;
  const dir = `${appHome()}/${CACHE}`;
  const ext = v.kind === "image" ? Str.replace("jpeg", "jpg")(formatOf(path) ?? "img") : lastPart(path);
  // Media can be big: played from where it is (only another machine's is fetched),
  // known by its size and time instead of a checksum.
  const media = v.kind === "video" || v.kind === "audio";
  // As many first bytes as the kind (a picture: its format) needs, no more.
  const head = v.kind === "image" ? headBytes(formatOf(path), HEAD) : SNIFF_BYTES;
  const r = v.on !== null ? yield* fetchCopy(v, path, dir, ext, head) : media ? yield* mediaStamp(path) : yield* sh(COPY, [path, dir, ext, String(head)]);

  if (gen !== v.gen) return;

  if (r.code !== 0) {
    const error = failed(r);

    if (error !== v.error) failWith(v, error);

    return;
  }

  // The copy's name and size lines, then its first bytes as `od` writes them.
  const lines = /^([^\n]*)\n([^\n]*)\n?/.exec(r.stdout);
  const name = lines?.[1] ?? "";
  const size = lines?.[2] ?? "";
  const stamp = `${name}:${size}`;

  // Unchanged.
  if (v.stamp === stamp && v.error === null) return;

  v.stamp = stamp;

  const bytes = yield* hexBytesIn(Str.slice(lines?.[0].length ?? 0)(r.stdout));

  if (gen !== v.gen) return;

  if (v.kind === "image") return yield* loadImage(v, gen, name, Number(size), bytes, dir);

  const local = media && v.on === null ? path : `${dir}/${name}`;
  const said = sniffKind(bytes);
  const info: Info = { ...blank(Number(size)), format: said?.kind === "font" ? said.format : null };

  if ((v.kind === "pdf" && said?.kind !== "pdf") || (v.kind === "font" && said?.kind !== "font")) {
    failWith(v, `Not a ${noun(v.kind)}, or a damaged one`, info);

    return;
  }

  const how = route(v.kind, { native: nativeViews(), tools: yield* tools(v) });

  if (gen !== v.gen) return;

  v.how = how;
  v.local = local;
  v.info = info;

  if (how.how === "none") {
    failWith(v, how.why, info);

    return;
  }

  if (how.how === "raster") {
    const copy: Copy = { name, abs: `${dir}/${name}`, format: "pdf" };

    v.copy = copy;

    const pages = how.tool === "pdftoppm"
      ? yield* sh('pdfinfo "$1" 2>/dev/null', [copy.abs])
      : yield* sh('mdls -name kMDItemNumberOfPages "$1" 2>/dev/null', [copy.abs]);

    if (gen !== v.gen) return;

    v.pages = pageCount(pages.stdout);

    if (how.firstOnly === true) v.note = v.pages > 1 ? `page 1 of ${v.pages} only` : null;

    v.page = Math.min(v.page, v.pages > 0 ? v.pages : 1);

    return yield* rasterPageOf(v, gen);
  }

  v.error = null;
  v.busy = null;
  // A file that changed in place gets a fresh view (same props keep the old one).
  v.rev = stamp;
});

/**
 * Runs a converter or a renderer that may take a while (a minute at most).
 * Its own exit isn't the measure: the file it should have written is (a
 * tool that couldn't run leaves none, and the caller says so).
 */
const runTool = (argv: readonly string[], tool: string) =>
  Effect.map(Effect.option(waiting(Exec.use((x) => x.run(argv[0] ?? tool, argv.slice(1), { timeout: 60000 })))), Option.isSome);

/** One PDF page as a PNG in the cache, then shown as a picture. */
export const rasterPageOf = Effect.fnUntraced(function* (view: Viewer, gen: number) {
  const how = view.how;
  const src = view.copy;

  if (how?.how !== "raster" || src === null) return;

  const base = `${Str.replace(/\.[^.]*$/, "")(src.name)}-p${view.page}`;
  const out = `${appHome()}/${CACHE}/${base}.png`;
  const outBase = Str.replace(/\.png$/, "")(out);

  view.busy = `Drawing page ${view.page}…`;
  yield* redraw;

  if (!(yield* hasFile(out))) {
    const argv = Arr.map(rasterArgv(how.tool, view.page), (a) => Str.replace("$OUT", out)(Str.replace("$OUTBASE", outBase)(Str.replace("$IN", src.abs)(a))));

    yield* runTool(argv, how.tool);
  }

  if (gen !== view.gen) return;

  const png = yield* sh('[ -s "$1" ] && od -An -v -tx1 -N 32 "$1"', [out]);
  const s = png.code === 0 ? sniff(hexBytes(png.stdout)) : null;

  if (s === null || s.width === 0) {
    failWith(view, `${how.tool} couldn't draw page ${view.page}`);

    return;
  }

  const was = view.info;
  const resized = was === null || was.width === 0 || was.width !== s.width || was.height !== s.height;

  view.info = { ...(was ?? blank(-1)), width: s.width, height: s.height };
  view.copy = { ...src, page: { name: `${base}.png`, abs: out, format: "png" } };
  view.src = `${CACHE}/${base}.png`;
  view.error = null;
  view.busy = null;

  if (resized || view.view === null) view.view = null;
});

export const loadImage = Effect.fnUntraced(function* (view: Viewer, gen: number, name: string, size: number, bytes: readonly number[], dir: string) {
  view.how = { how: "image" };

  const head = sniff(bytes);
  const format = head?.format ?? formatOf(view.path);

  let info: Info = {
    bytes: size,
    width: head?.width ?? 0,
    height: head?.height ?? 0,
    format,
    orientation: head?.orientation ?? 1,
    animated: head?.animated === true,
    frames: head?.frames ?? null,
  };

  if (head === null) {
    failWith(view, "Not a picture, or a damaged one", info);

    return;
  }

  if (info.width === 0 && format !== "heic" && format !== "avif") {
    const f = yield* sh('file -b "$1"', [`${dir}/${name}`]);
    const told = sizeFromFile(f.stdout);

    if (told !== null) info = { ...info, ...told };

    if (gen !== view.gen) return;

    if (info.width === 0) {
      failWith(view, "Can't tell how big it is (a damaged file?)", info);

      return;
    }
  }

  const how = plan(format, platform());
  let copy: Copy = { name, abs: `${dir}/${name}`, format };

  if (how.kind === "none") {
    failWith(view, cantShow(format, platform()), info);

    return;
  }

  if (how.kind === "convert") {
    view.busy = `Converting ${Str.toUpperCase(format ?? "")}…`;
    yield* redraw;

    const png = yield* convertCopy(how.tools, copy, dir);

    if (gen !== view.gen) return;

    if (Option.isNone(png)) {
      failWith(view, cantShow(format, platform()), info);

      return;
    }

    copy = png.value;

    // The PNG's own size: the original's header may name a tile or a thumbnail.
    const head32 = yield* sh('od -An -v -tx1 -N 32 "$1"', [copy.abs]);
    const s = sniff(hexBytes(head32.stdout));

    // The copy is upright: its orientation is applied.
    info = s !== null && s.width > 0 ? { ...info, width: s.width, height: s.height, orientation: 1 } : { ...info, orientation: 1 };

    if (info.width === 0) {
      failWith(view, "Can't tell how big it is (a damaged file?)", info);

      return;
    }
  }

  const resized = view.info === null || view.info.width !== info.width || view.info.height !== info.height;

  view.info = info;
  view.copy = copy;
  view.error = null;
  view.busy = null;

  // Fit again once the pane's size is known.
  if (resized || view.view === null) view.view = null;

  yield* drawCopyFx(view);
});

/** Writes a file named by its contents, once: one already there has them (same name, same contents). */
const writeOnce = (path: string, text: string) =>
  Effect.catchTag(waiting(Files.use((f) => f.write(path, text, null))), "StaleFile", () => Effect.void);

/** Another machine's file: its checksum there, then (once per contents) its bytes over base64. */
export const fetchCopy = Effect.fnUntraced(function* (view: Viewer, path: string, dir: string, ext: string, head: number) {
  const sum = yield* sh('[ -f "$1" ] || exit 3; cksum < "$1"', [path], view.on);

  if (sum.code !== 0) return sum;

  const [crc = "", bytes = "0"] = Str.split(Str.trim(sum.stdout), /\s+/);
  const name = `${crc}-${bytes}.${ext}`;
  const have = yield* sh(`[ -f "$1/$2" ] && od -An -v -tx1 -N ${head} "$1/$2"`, [dir, name]);

  if (have.code === 0) return { code: 0, stdout: `${name}\n${bytes}\n${have.stdout}`, stderr: "" };

  if (Number(bytes) > REMOTE_MAX) return { code: 4, stdout: "", stderr: `Too large to fetch from ${view.on ?? "there"} (${fileSize(Number(bytes))})` };

  const data = yield* sh('base64 < "$1"', [path], view.on);

  if (data.code !== 0) return data;

  yield* sh('mkdir -p "$1"', [dir]);

  const b64 = `${dir}/${name}.b64`;

  // Left over from before: the same name holds the same bytes.
  yield* writeOnce(b64, data.stdout);

  return yield* sh(`base64 -d < "$1" > "$2/$3" && rm -f "$1" && printf '%s\\n%s\\n' "$3" "$4" && od -An -v -tx1 -N ${head} "$2/$3"`, [b64, dir, name, bytes]);
});

/** A PNG copy by the first converter found (none when no converter here makes one). */
export const convertCopy = Effect.fnUntraced(function* (converters: readonly Converter[], copy: Copy, dir: string) {
  const name = Str.replace(/\.[^.]*$/, "")(copy.name) + ".png";
  const out = `${dir}/${name}`;
  const done: Copy = { name, abs: out, format: "png" };

  if (yield* hasFile(out)) return Option.some(done);

  for (const { tool, argv } of converters) {
    if ((yield* sh('command -v "$1" >/dev/null', [tool])).code !== 0) continue;

    const args = Arr.map(argv, (a) => Str.replace("$OUT", out)(Str.replace("$OUTDIR", dir)(Str.replace("$IN", copy.abs)(a))));
    const ran = yield* runTool(args, tool);

    // qlmanage writes `<name>.png` next to its own name.
    if (tool === "qlmanage") yield* sh('[ -s "$1/$2.png" ] && mv "$1/$2.png" "$3"', [dir, copy.name, out]);

    if (ran && (yield* hasFile(out))) return Option.some(done);
  }

  return Option.none<Copy>();
});

/** The converters that make a PNG an SVG wrapper can embed (BMP, TIFF, ICO). */
const embeddable = (): readonly Converter[] => (platform() === "macos"
  ? [{ tool: "sips", argv: ["sips", "-s", "format", "png", "$IN", "--out", "$OUT"] }]
  : [{ tool: "magick", argv: ["magick", "$IN[0]", "$OUT"] }, { tool: "convert", argv: ["convert", "$IN[0]", "$OUT"] }]);

/** What image() draws: the copy itself, or (turned, or a vector) a wrapper SVG around it. */
export const drawCopyFx = Effect.fnUntraced(function* (v: Viewer) {
  if (v.how?.how === "raster") {
    // A PDF page: turned through the same wrapper as a picture.
    const page = v.copy?.page;

    if (page === undefined) return;

    const rot = v.view?.rot ?? 0;

    if (rot === 0) {
      v.src = `${CACHE}/${page.name}`;

      return;
    }

    const name = `${Str.replace(/\.png$/, "")(page.name)}-r${rot}.svg`;

    yield* writeOnce(`${appHome()}/${CACHE}/${name}`, wrapper(page.abs, v.info ?? blank(-1), rot, 1));

    v.src = `${CACHE}/${name}`;

    return;
  }

  const copy = v.copy;
  const info = v.info;
  const gen = v.gen;

  if (copy === null || info === null) return;

  // Turns come faster than wrappers are written: only the latest draw lands.
  const token = ++v.drawing;
  const stale = (): boolean => gen !== v.gen || token !== v.drawing;
  const rot = v.view?.rot ?? 0;
  const vector = copy.format === "svg";

  if (rot === 0 && !vector) {
    v.src = `${CACHE}/${copy.name}`;
    v.still = false;

    return;
  }

  let inner: Copy = copy;

  if (!EMBEDS.includes(copy.format)) {
    // BMP / TIFF / ICO: the SVG renderer embeds PNGs.
    const png = yield* convertCopy(embeddable(), copy, `${appHome()}/${CACHE}`);

    if (stale()) return;

    if (Option.isNone(png)) {
      v.note = "can't turn this format here";
      v.view = v.view === null ? null : { ...v.view, rot: 0 };
      v.src = `${CACHE}/${copy.name}`;

      return;
    }

    inner = png.value;
  }

  // Stored size: an EXIF orientation that turns it on its side swaps the shown one.
  const o = info.orientation;
  const stored: Size = o >= 5 ? { width: info.height, height: info.width } : info;
  const k = vector ? sharpness(info, v.view?.scale ?? 1, dpr()) : 1;
  const name = `${Str.replace(/\.[^.]*$/, "")(copy.name)}-r${rot}-k${k}.svg`;

  yield* writeOnce(`${appHome()}/${CACHE}/${name}`, wrapper(inner.abs, stored, rot, k, inner.format === "jpeg" ? o : 1));

  if (stale()) return;

  v.src = `${CACHE}/${name}`;
  v.still = info.animated && rot > 0;
});

/** Draws the copy again (a turn, a new zoom of a vector): its wrapper is written in the background. */
export function drawCopy(v: Viewer): void {
  v.fx?.run(drawCopyFx(v));
}

/** Waits for the file's folder to change: the file and the folder's list again. */
export function watchFile(v: Viewer, gen: number): void {
  const dir = dirname(v.path);
  const change = Effect.tryPromise({ try: () => watchFolder(dir), catch: fileError(dir) });

  v.fx?.run(Effect.gen(function* () {
    while (gen === v.gen || dirname(v.path) === dir) {
      yield* change;

      if (dirname(v.path) !== dir) return;

      // Any change here: the checksum (or size and time) says whether this file changed.
      loadPath(v);
      listFolder(v);
    }
  }).pipe(
    // A folder that can't be watched (gone, not allowed): the file is shown as it was read.
    Effect.catchTag("FileError", () => Effect.void),
  ));
}

/** The files of this kind in the file's folder, for next / previous. */
export function listFolder(v: Viewer): void {
  if (Str.isEmpty(v.path)) return;

  const dir = dirname(v.path);

  v.fx?.run(Effect.gen(function* () {
    const r = yield* sh('ls -1A "$1"', [dir], v.on);

    if (r.code !== 0 || dirname(v.path) !== dir) return;

    const names = siblings(Str.split(r.stdout, "\n"), basename(v.path));

    if (Arr.join(names, "\n") !== Arr.join(v.names, "\n")) v.names = names;
  }));
}

export function goTo(v: Viewer, dir: number, cx: Context): void {
  const next = stepIn(v.names, basename(v.path), dir);

  if (next !== null && next !== basename(v.path)) v.open(`${dirname(v.path)}/${next}`, cx);
}

/** Tells the pane header which file this preview shows, and the app which path. */
export function titleOf(v: Viewer): void {
  const slot = v.slot;

  if (slot === null) return;

  const live = new Set(Arr.flatMap(panes(), (p) => {
    const s = p.mod === MOD ? slotOf(p) : null;

    return s === null ? [] : [s];
  }));

  const keep = <T>(was: ReadonlyMap<string, T>, value: T): Map<string, T> => new Map([...Arr.filter(Arr.fromIterable(was), ([k]) => live.has(k)), [slot, value]]);
  const stale = <T>(was: ReadonlyMap<string, T>): boolean => Arr.some(Arr.fromIterable(was.keys()), (k) => !live.has(k) && k !== slot);
  const name = Str.isEmpty(v.path) ? "Preview" : basename(v.path);
  const titles = readSharedMap(TITLES, TitleSchema);
  const paths = readSharedMap(PATHS, PathSchema);

  if (titles.get(slot) !== name || stale(titles)) writeSharedMap(TITLES, keep(titles, name));

  if (paths.get(slot) !== v.path || stale(paths)) writeSharedMap(PATHS, keep<string | null>(paths, v.path));
}
