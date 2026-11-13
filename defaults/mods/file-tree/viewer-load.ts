// The viewer reading a file: what kind it is, a local copy (fetched from
// another machine, converted where the kind needs it), a PDF's page as a
// picture, a picture's facts, the folder it steps through, its title, the
// file watched for changes. Shared like viewer.ts.

import type { Context } from "gpui-kit";
import { exec, panes, shared, setShared, watchFolder, appHome, writeTextFile } from "herdr";
import type { ExecResult } from "herdr";
import { readSharedMap, writeSharedMap } from "./guard.ts";
import { kindOf, lookKind, sniffKind, route, toolsFor, rasterArgv, pageCount, noun, siblings, stepIn, fileSize } from "./kinds.ts";
import type { Converter, Size } from "./image.ts";
import { formatOf, hexBytes, sniff, sizeFromFile, plan, cantShow, wrapper, sharpness } from "./image.ts";
import type { Info, Copy } from "./viewer-state.ts";
import { sh, CACHE, nativeViews, dirname, blank, COPIED, lastPart, STAMP, COPY, platform, HEAD, REMOTE_MAX, EMBEDS, dpr, basename, MOD, slotOf, TITLES, PATHS } from "./viewer-state.ts";
import type { default as Viewer } from "./viewer.ts";
import { loadLook, loadText } from "./viewer-text.ts";
import { loadDb } from "./viewer-table.ts";

/** Shows `path` from the start (a picture fitted, a table at its top). */
export function openPath(v: Viewer, path: string, cx: Context): void {
  const sameFolder = Boolean(v.path) && dirname(v.path) === dirname(path);

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
  loadPath(v, cx);

  // Embedded: no stepping through the folder; the files pane watches it.
  if (!sameFolder && !v.embedded) {
    v.names = [];
    listFolder(v, cx);

    if (!v.on && path) watchFile(v, cx, v.gen);
  }
}

/** Reads the file (again, if it changed) and works out how to show it. */
export function loadPath(v: Viewer, cx: Context): void {
  const gen = v.gen;

  if (!v.path) {
    v.error = "No file given";
    v.busy = null;

    return;
  }

  if (!v.kind) {
    failWith(v, cx, "The preview doesn't know this kind of file", blank(-1));

    return;
  }

  // Another machine's pictures, PDFs, fonts and clips would be fetched whole: not for a look.
  if (v.embedded && v.on && COPIED.includes(v.kind)) {
    failWith(v, cx, `On ${v.on}: p opens this ${noun(v.kind)} in the preview`);

    return;
  }

  cx.spawn(async (cx) => {
    // A file that breaks the reading says so in its place; the next one loads as ever.
    try {
      if (v.kind === "text" || v.kind === "markdown") await loadLook(v, cx, gen);
      else if (v.kind === "table" || v.kind === "diff") await loadText(v, cx, gen);
      else if (v.kind === "sqlite") await loadDb(v, cx, gen);
      else await loadCopy(v, cx, gen);
    } catch (e) {
      if (gen === v.gen) failWith(v, cx, `Can't show it: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

export function failed(r: ExecResult): string {
  return r.code === 3 ? "It isn't there (moved or deleted?)" : (r.stderr || "Can't read it").trim();
}

export function failWith(v: Viewer, cx: Context, error: string, info?: Info): void {
  if (info) v.info = info;

  v.error = error;
  v.busy = null;
  v.src = null;
  cx.notify();
}

/** Which tools route() asks after are installed (here, or on `on`). */
export async function tools(view: Viewer): Promise<string[]> {
  const want = toolsFor(view.kind);

  if (!want.length) return [];

  // sqlite3 runs where the database is; a PDF is drawn here from its copy.
  const r = await sh('for t; do command -v "$t" >/dev/null 2>&1 && echo "$t"; done; true', want, view.kind === "sqlite" ? view.on : null);

  return r.stdout.split("\n").filter(Boolean);
}

/** Pictures, PDFs, fonts, media: a copy in the cache by contents, then its first bytes say what it is. */
export async function loadCopy(v: Viewer, cx: Context, gen: number): Promise<void> {
  const path = v.path;
  const dir = `${appHome()}/${CACHE}`;
  const ext = v.kind === "image" ? (formatOf(path) ?? "img").replace("jpeg", "jpg") : lastPart(path);
  // Media can be big: played from where it is (only another machine's is fetched),
  // known by its size and time instead of a checksum.
  const media = v.kind === "video" || v.kind === "audio";
  let r: ExecResult;

  if (v.on) r = await fetchCopy(v, path, dir, ext);
  else if (media) {
    r = await sh(STAMP, [path]);

    if (r.code === 0) {
      const [size = "", time = "", ...rest] = r.stdout.split("\n");

      r = { code: 0, stdout: `${time}-${size}\n${size}\n${rest.join(" ")}`, stderr: "" };
    }
  } else r = await sh(COPY, [path, dir, ext]);

  if (gen !== v.gen) return;

  if (r.code !== 0) {
    const error = failed(r);

    if (error !== v.error) failWith(v, cx, error);

    return;
  }

  const [name = "", size = "", ...rest] = r.stdout.split("\n");
  const stamp = `${name}:${size}`;

  // Unchanged.
  if (v.stamp === stamp && !v.error) return;

  v.stamp = stamp;

  const bytes = hexBytes(rest.join(" "));

  if (v.kind === "image") return loadImage(v, cx, gen, name, Number(size), bytes, dir);

  const local = media && !v.on ? path : `${dir}/${name}`;
  const said = sniffKind(bytes);
  const info: Info = { ...blank(Number(size)), format: said?.kind === "font" ? said.format : null };

  if ((v.kind === "pdf" && said?.kind !== "pdf") || (v.kind === "font" && said?.kind !== "font")) {
    failWith(v, cx, `Not a ${noun(v.kind)}, or a damaged one`, info);

    return;
  }

  const how = route(v.kind, { native: nativeViews(), tools: await tools(v) });

  if (gen !== v.gen) return;

  v.how = how;
  v.local = local;
  v.info = info;

  if (how.how === "none") {
    failWith(v, cx, how.why, info);

    return;
  }

  if (how.how === "raster") {
    const copy: Copy = { name, abs: `${dir}/${name}`, format: "pdf" };

    v.copy = copy;

    const pages = how.tool === "pdftoppm"
      ? await sh('pdfinfo "$1" 2>/dev/null', [copy.abs])
      : await sh('mdls -name kMDItemNumberOfPages "$1" 2>/dev/null', [copy.abs]);

    if (gen !== v.gen) return;

    v.pages = pageCount(pages.stdout) || 0;

    if (how.firstOnly) v.note = v.pages > 1 ? `page 1 of ${v.pages} only` : null;

    v.page = Math.min(v.page, v.pages || 1);
    await v.rasterPage(cx, gen);

    return;
  }

  v.error = null;
  v.busy = null;
  // A file that changed in place gets a fresh view (same props keep the old one).
  v.rev = stamp;
  cx.notify();
}

/** One PDF page as a PNG in the cache, then shown as a picture. */
export async function rasterPageOf(view: Viewer, cx: Context, gen: number): Promise<void> {
  const how = view.how;
  const src = view.copy;

  if (how?.how !== "raster" || !src) return;

  const base = `${src.name.replace(/\.[^.]*$/, "")}-p${view.page}`;
  const out = `${appHome()}/${CACHE}/${base}.png`;

  view.busy = `Drawing page ${view.page}…`;
  cx.notify();

  if ((await sh('[ -s "$1" ]', [out])).code !== 0) {
    const argv = rasterArgv(how.tool, view.page).map((a) => a.replace("$IN", src.abs).replace("$OUTBASE", out.replace(/\.png$/, "")).replace("$OUT", out));

    await exec(argv[0] ?? how.tool, argv.slice(1), { timeout: 60000 }).catch(() => null);
  }

  if (gen !== view.gen) return;

  const png = await sh('[ -s "$1" ] && od -An -v -tx1 -N 32 "$1"', [out]);
  const s = png.code === 0 ? sniff(hexBytes(png.stdout)) : null;

  if (!s?.width) {
    failWith(view, cx, `${how.tool} couldn't draw page ${view.page}`);

    return;
  }

  const resized = !view.info?.width || view.info.width !== s.width || view.info.height !== s.height;

  view.info = { ...(view.info ?? blank(-1)), width: s.width, height: s.height };
  view.copy = { ...src, page: { name: `${base}.png`, abs: out, format: "png" } };
  view.src = `${CACHE}/${base}.png`;
  view.error = null;
  view.busy = null;

  if (resized || !view.view) view.view = null;

  cx.notify();
}

export async function loadImage(view: Viewer, cx: Context, gen: number, name: string, size: number, bytes: readonly number[], dir: string): Promise<void> {
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

  if (!head) {
    failWith(view, cx, "Not a picture, or a damaged one", info);

    return;
  }

  if (!info.width && format !== "heic" && format !== "avif") {
    const f = await sh('file -b "$1"', [`${dir}/${name}`]);
    const told = sizeFromFile(f.stdout);

    if (told) info = { ...info, ...told };

    if (gen !== view.gen) return;

    if (!info.width) {
      failWith(view, cx, "Can't tell how big it is (a damaged file?)", info);

      return;
    }
  }

  const how = plan(format, platform());
  let copy: Copy | null = { name, abs: `${dir}/${name}`, format };

  if (how.kind === "none") {
    failWith(view, cx, cantShow(format, platform()), info);

    return;
  }

  if (how.kind === "convert") {
    view.busy = `Converting ${(format ?? "").toUpperCase()}…`;
    cx.notify();
    copy = await convertCopy(how.tools, copy, dir);

    if (gen !== view.gen) return;

    if (!copy) {
      failWith(view, cx, cantShow(format, platform()), info);

      return;
    }

    // The PNG's own size: the original's header may name a tile or a thumbnail.
    const png = await sh('od -An -v -tx1 -N 32 "$1"', [copy.abs]);
    const s = sniff(hexBytes(png.stdout));

    // The copy is upright: its orientation is applied.
    info = s?.width ? { ...info, width: s.width, height: s.height, orientation: 1 } : { ...info, orientation: 1 };

    if (!info.width) {
      failWith(view, cx, "Can't tell how big it is (a damaged file?)", info);

      return;
    }
  }

  const resized = !view.info || view.info.width !== info.width || view.info.height !== info.height;

  view.info = info;
  view.copy = copy;
  view.error = null;
  view.busy = null;

  // Fit again once the pane's size is known.
  if (resized || !view.view) view.view = null;

  await view.draw(cx);
  cx.notify();
}

/** Another machine's file: its checksum there, then (once per contents) its bytes over base64. */
export async function fetchCopy(view: Viewer, path: string, dir: string, ext: string): Promise<ExecResult> {
  const sum = await sh('[ -f "$1" ] || exit 3; cksum < "$1"', [path], view.on);

  if (sum.code !== 0) return sum;

  const [crc = "", bytes = "0"] = sum.stdout.trim().split(/\s+/);
  const name = `${crc}-${bytes}.${ext}`;
  const have = await sh('[ -f "$1/$2" ] && od -An -v -tx1 -N ' + HEAD + ' "$1/$2"', [dir, name]);

  if (have.code === 0) return { code: 0, stdout: `${name}\n${bytes}\n${have.stdout}`, stderr: "" };

  if (Number(bytes) > REMOTE_MAX) return { code: 4, stdout: "", stderr: `Too large to fetch from ${view.on ?? "there"} (${fileSize(Number(bytes))})` };

  const data = await sh('base64 < "$1"', [path], view.on);

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
export async function convertCopy(tools: readonly Converter[], copy: Copy, dir: string): Promise<Copy | null> {
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
export async function drawCopy(v: Viewer, cx: Context): Promise<void> {
  if (v.how?.how === "raster") {
    // A PDF page: turned through the same wrapper as a picture.
    const page = v.copy?.page;

    if (!page) return;

    const rot = v.view?.rot ?? 0;

    if (!rot) {
      v.src = `${CACHE}/${page.name}`;

      return;
    }

    const name = `${page.name.replace(/\.png$/, "")}-r${rot}.svg`;

    try {
      await writeTextFile(`${appHome()}/${CACHE}/${name}`, wrapper(page.abs, v.info ?? blank(-1), rot, 1), null);
    } catch {
      // Same name, same contents.
    }

    v.src = `${CACHE}/${name}`;
    cx.notify();

    return;
  }

  const copy = v.copy;
  const info = v.info;
  const gen = v.gen;

  if (!copy || !info) return;

  // Turns come faster than wrappers are written: only the latest draw lands.
  const token = ++v.drawing;
  const stale = (): boolean => gen !== v.gen || token !== v.drawing;
  const rot = v.view?.rot ?? 0;
  const vector = copy.format === "svg";

  if (!rot && !vector) {
    v.src = `${CACHE}/${copy.name}`;
    v.still = false;

    return;
  }

  let inner: Copy | null = copy;

  if (!EMBEDS.includes(copy.format)) {
    // BMP / TIFF / ICO: the SVG renderer embeds PNGs.
    inner = await convertCopy(platform() === "macos"
      ? [{ tool: "sips", argv: ["sips", "-s", "format", "png", "$IN", "--out", "$OUT"] }]
      : [{ tool: "magick", argv: ["magick", "$IN[0]", "$OUT"] }, { tool: "convert", argv: ["convert", "$IN[0]", "$OUT"] }], copy, `${appHome()}/${CACHE}`);

    if (stale()) return;

    if (!inner) {
      v.note = "can't turn this format here";
      v.view = v.view ? { ...v.view, rot: 0 } : null;
      v.src = `${CACHE}/${copy.name}`;

      return;
    }
  }

  // Stored size: an EXIF orientation that turns it on its side swaps the shown one.
  const o = info.orientation;
  const stored: Size = o >= 5 ? { width: info.height, height: info.width } : info;
  const k = vector ? sharpness(info, v.view?.scale ?? 1, dpr()) : 1;
  const name = `${copy.name.replace(/\.[^.]*$/, "")}-r${rot}-k${k}.svg`;

  try {
    await writeTextFile(`${appHome()}/${CACHE}/${name}`, wrapper(inner.abs, stored, rot, k, inner.format === "jpeg" ? o : 1), null);
  } catch {
    // Already written: same name, same contents.
  }

  if (stale()) return;

  v.src = `${CACHE}/${name}`;
  v.still = info.animated && rot > 0;
  cx.notify();
}

/** Waits for the file's folder to change: the file and the folder's list again. */
export function watchFile(v: Viewer, cx: Context, gen: number): void {
  const dir = dirname(v.path);

  cx.spawn(async (cx) => {
    while (gen === v.gen || dirname(v.path) === dir) {
      try {
        await watchFolder(dir);
      } catch {
        return;
      }

      if (dirname(v.path) !== dir) return;

      // Any change here: the checksum (or size and time) says whether this file changed.
      loadPath(v, cx);
      listFolder(v, cx);
    }
  });
}

/** The files of this kind in the file's folder, for next / previous. */
export function listFolder(v: Viewer, cx: Context): void {
  if (!v.path) return;

  const dir = dirname(v.path);

  cx.spawn(async (cx) => {
    const r = await sh('ls -1A "$1"', [dir], v.on);

    if (r.code !== 0 || dirname(v.path) !== dir) return;

    const names = siblings(r.stdout.split("\n"), basename(v.path));

    if (names.join("\n") !== v.names.join("\n")) {
      v.names = names;
      cx.notify();
    }
  });
}

export function goTo(v: Viewer, dir: number, cx: Context): void {
  const next = stepIn(v.names, basename(v.path), dir);

  if (next && next !== basename(v.path)) v.open(`${dirname(v.path)}/${next}`, cx);
}

/** Tells the pane header which file this preview shows, and the app which path. */
export function titleOf(v: Viewer): void {
  const slot = v.slot;

  if (!slot) return;

  const live = new Set(panes().flatMap((p) => {
    const s = p.mod === MOD ? slotOf(p) : null;

    return s ? [s] : [];
  }));

  const keep = <T>(was: ReadonlyMap<string, T>, value: T): Map<string, T> => new Map([...[...was].filter(([k]) => live.has(k)), [slot, value]]);
  const stale = <T>(was: ReadonlyMap<string, T>): boolean => [...was.keys()].some((k) => !live.has(k) && k !== slot);
  const name = v.path ? basename(v.path) : "Preview";
  const titles = readSharedMap(shared, TITLES);
  const paths = readSharedMap(shared, PATHS);

  if (titles.get(slot) !== name || stale(titles)) writeSharedMap(setShared, TITLES, keep(titles, name));

  if (paths.get(slot) !== v.path || stale(paths)) writeSharedMap(setShared, PATHS, keep<string | null>(paths, v.path));
}
