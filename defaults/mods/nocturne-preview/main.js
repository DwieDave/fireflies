// Nocturne Preview: a file you look at but don't edit, in a pane beside where it
// was opened from: a link clicked in a terminal (a screenshot an agent saved, a
// report it wrote, `ls`, an OSC 8 link), a file picked in the files pane, a link
// in the Markdown viewer, or the `preview.open {path}` command (`image.open` is
// the same). Props: { path, on?, slot }.
//
//   pictures   PNG, JPEG, GIF (animated), WebP, BMP, TIFF, ICO, SVG drawn as
//              they are; HEIC / HEIF and AVIF converted to a PNG copy first
//              (macOS: sips, else qlmanage; Linux: heif-convert, avifdec,
//              ImageMagick or ffmpeg). Fit, 100%, zoom, pan, turn, background.
//   PDF        macOS: the system's PDF view (scroll, zoom, pages); elsewhere one
//              page at a time through pdftoppm when it's installed.
//   CSV / TSV  a table: the header row stays put, numbers align right, the row
//              numbers stay at the left; the first 50 000 rows / 200 columns of
//              the first 4 MB, saying so when there's more.
//   SQLite     .sqlite / .db: its tables, each one's first 1 000 rows, read only
//              (sqlite3).
//   patches    .diff / .patch: colored as nocturne-diff colors them, file by file.
//   fonts      macOS: Quick Look's specimen.
//   audio / video  macOS: the system's player (never plays by itself).
// What can't be shown here says why and offers the system's app (o).
//
// The original is only read: pictures, PDFs and fonts are drawn from a copy in
// the app's cache named by its contents, so a file an agent rewrites shows again
// by itself (the folder is watched; another machine's is polled).
//
// The bar: kind, name, facts, the place in its folder (‹ ›), the kind's own
// controls, files (the folder in the files pane), open (the system's app), copy
// (the path).
// Keys while it has focus:
//   n ] / p [   next / previous file of the same kind in the folder
//   o  open in the system's app    y  copy path    f  folder in the files pane
//   e  edit as text in the editor (tables, patches, SVG)
//   pictures: + = / - zoom, 0 fit, 1 100%, h j k l ←↓↑→ pan (← → step the
//             folder when it fits), r / R turn, b background
//   PDF:      + / - zoom, 0 fit width, ← → / pageup pagedown pages, g / G first / last
//   tables, patches: j k ↓ ↑ rows, J K / pageup pagedown pages, g / G top / bottom,
//             h l ← → columns (tables), } { next / previous file (patches),
//             t / T next / previous table (SQLite)
// Mouse: pictures: drag to pan, ⌘/ctrl + scroll zooms at the pointer, scroll
// pans, double-click toggles fit and 100%. Tables and patches: scroll (shift or
// sideways: across).
// Commands (keys.json, `herdr-app do nocturne-preview.<c>`; every shown preview
// takes them): zoom_in, zoom_out, fit, actual, next, prev, rotate, background,
// reload, page_next, page_prev.

import { View, div, svg, image, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as herdr from "herdr";
import { props, theme, settings, exec, run, panes, shared, setShared, watchFolder, nextCommand, home, appHome, writeTextFile, window as appWindow } from "herdr";
import { kindOf, sniffKind, route, TOOLS, rasterArgv, pageCount, duration, tag, noun, siblings, stepIn, fileSize, count } from "./kinds.js";
import { formatOf, hexBytes, sniff, sizeFromFile, plan, cantShow, fitted, fitScale, clampPan, zoomTo, step, panBy, rotate, placed, percent, wrapper, sharpness, turned } from "./image.js";
import { MAX_BYTES, MAX_ROWS, separator, parse as parseTable, table, oneLine, wholeLines, shownNote, SQLITE_ARGS, TABLES_SQL, rowsSql, countSql, tablesOf, sqliteError } from "./table.js";
import { parse as parsePatch, fileStarts, nextFile } from "./diff.js";

const MOD = "nocturne-preview";
// Each preview's shown file by slot: its name for the pane header
// (nocturne/header.js), its path so a second click on it finds this preview.
const TITLES = `${MOD}.titles`, PATHS = `${MOD}.paths`;
const ART = "mods/nocturne/art";
// Copies of what's shown, under the app's folder (where image() reads).
const CACHE = `cache/${MOD}`;
// The first bytes read for the size and format.
const HEAD = 262144;
// A file on another machine: read it this often; fetched up to this size.
const POLL = 4000, REMOTE_MAX = 6 * 1024 * 1024;
// Pan steps: a key, and a key with shift.
const NUDGE = 60, SHOVE = 240;
// Formats the SVG renderer can embed when turning a picture; others get a PNG copy first.
const EMBEDS = ["png", "jpeg", "gif", "webp", "svg"];
// Tables and patches: a row's height, a character's width in the code font
// (12 px), a cell's side padding, the row numbers' column.
const ROW = 22, CH = 7.25, CELL = 8, GUTTER_MIN = 40;
// Kinds drawn from a cached copy (named by contents), and kinds read as text.
const COPIED = ["image", "pdf", "font", "video", "audio"];
const TEXT = ["table", "diff"];

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
const zoom = () => Number(settings()?.zoom) || 1;
const unzoom = (v) => v / zoom();
const platform = () => appWindow()?.platform ?? "linux";
const dpr = () => (platform() === "macos" ? 2 : 1);
const code = () => settings()?.font_family || "JetBrains Mono";
/** This Herdr places macOS views (the fork's native-view/0). */
const nativeViews = () => typeof herdr.nativeView?.new === "function" && herdr.nativeViewCapabilities?.()?.available === true;
/** A 50% checker filling the parent, `cell` px squares (as ../nocturne/kit.js dither). */
function checker(color, cell = 1) {
  return window.paint_path(RECT(), Background.checkerboard(color, Math.max(1, Math.round(cell * zoom() * dpr())))).absolute().top(0).left(0).size_full();
}
const stop = (_e, cx) => cx.stop_propagation();
const dirname = (p) => String(p).replace(/\/[^/]*$/, "") || "/";
const basename = (p) => String(p).replace(/\/+$/, "").split("/").pop() || String(p);
const tilde = (p, h) => (!p || !h ? p ?? "" : p === h ? "~" : p.startsWith(h + "/") ? "~" + p.slice(h.length) : p);
const sh = (script, args, on) => exec("sh", ["-c", script, MOD, ...args], on ? { on } : undefined).catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));

// One copy per contents: `<crc>-<bytes>.<ext>` (then its size line and its first bytes).
const COPY = `f="$1"; d="$2"; e="$3"; [ -f "$f" ] || exit 3; mkdir -p "$d" || exit 4
set -- $(cksum < "$f"); n="$1-$2.$e"
[ -f "$d/$n" ] || cp -c "$f" "$d/$n" 2>/dev/null || cp "$f" "$d/$n" || exit 4
printf '%s\\n%s\\n' "$n" "$2"; od -An -v -tx1 -N ${HEAD} "$d/$n"`;
// Text: its size, its line count, then its first bytes.
const TEXT_HEAD = `[ -f "$1" ] || exit 3; wc -c < "$1"; wc -l < "$1"; head -c ${MAX_BYTES} "$1"`;
// What changed a file without reading it all (a database being written): size and time.
const STAMP = `[ -f "$1" ] || exit 3; wc -c < "$1"; date -r "$1" +%s 2>/dev/null || stat -c %Y "$1"; od -An -v -tx1 -N 16 "$1"`;

export default class PreviewView extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    this.on = pr.on ?? null;
    this.slot = pr.slot ?? null;
    this.handle = cx.focus_handle();
    this.port = { width: 0, height: 0 };
    this.checker = true;
    this.names = [];
    this.copied = 0;
    this.open(pr.path ?? "", cx);
    if (this.on) cx.timer.every(POLL, (cx) => { this.load(cx); this.list(cx); });
    // Copies nobody looked at for a week go.
    if (!this.on && pr.path) sh('[ -d "$1" ] && find "$1" -type f -mtime +7 -delete', [`${appHome()}/${CACHE}`]);
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^nocturne-(preview|image)\./, "");
        if (c === "focus") this.handle.focus();
        else this.command(c, cx);
        cx.notify();
      }
    });
    if (nativeViews()) {
      cx.spawn(async (cx) => {
        for (;;) {
          let e;
          try { e = JSON.parse(await herdr.nextNativeViewEvent()); } catch { return; }
          this.nativeEvent(e, cx);
          cx.notify();
        }
      });
    }
  }

  // ---- the file

  /** Shows `path` from the start (a picture fitted, a table at its top). */
  open(path, cx) {
    const sameFolder = this.path && dirname(this.path) === dirname(path);
    this.path = path;
    this.kind = kindOf(path);
    this.how = null;
    this.info = null; this.error = null; this.src = null; this.copy = null; this.busy = "Reading…";
    this.view = null; this.note = null;
    this.grid = null; this.patch = null; this.db = null; this.pdf = null; this.media = null;
    this.page = 1; this.pages = 0;
    this.sy = 0; this.sx = 0; this.cursor = 0;
    this.stamp = null;
    this.gen = (this.gen ?? 0) + 1;
    this.title();
    this.load(cx);
    if (!sameFolder) { this.names = []; this.list(cx); if (!this.on && path) this.watch(cx, this.gen); }
  }

  /** Reads the file (again, if it changed) and works out how to show it. */
  load(cx) {
    const path = this.path, gen = this.gen;
    if (!path) { this.error = "No file given"; this.busy = null; return; }
    if (!this.kind) { this.fail(cx, "The preview doesn't know this kind of file", { bytes: -1 }); return; }
    cx.spawn(async (cx) => {
      if (TEXT.includes(this.kind)) await this.loadText(cx, gen);
      else if (this.kind === "sqlite") await this.loadDb(cx, gen);
      else await this.loadCopy(cx, gen);
    });
  }

  failed(r) {
    return r.code === 3 ? "It isn't there (moved or deleted?)" : (r.stderr || "Can't read it").trim();
  }

  fail(cx, error, info) {
    if (info) this.info = info;
    this.error = error; this.busy = null; this.src = null;
    cx.notify();
  }

  /** Which tools route() asks after are installed (here, or on `on`). */
  async tools() {
    const want = TOOLS[this.kind] ?? [];
    if (!want.length) return [];
    // sqlite3 runs where the database is; a PDF is drawn here from its copy.
    const r = await sh('for t; do command -v "$t" >/dev/null 2>&1 && echo "$t"; done; true', want, this.kind === "sqlite" ? this.on : null);
    return r.stdout.split("\n").filter(Boolean);
  }

  /** Pictures, PDFs, fonts, media: a copy in the cache by contents, then its first bytes say what it is. */
  async loadCopy(cx, gen) {
    const path = this.path;
    const dir = `${appHome()}/${CACHE}`;
    const ext = this.kind === "image" ? (formatOf(path) ?? "img").replace("jpeg", "jpg") : path.split(".").pop().toLowerCase();
    // Media can be big: played from where it is (only another machine's is fetched),
    // known by its size and time instead of a checksum.
    const media = this.kind === "video" || this.kind === "audio";
    let r;
    if (this.on) r = await this.fetch(path, dir, ext);
    else if (media) {
      r = await sh(STAMP, [path]);
      if (r.code === 0) { const [size, time, ...rest] = r.stdout.split("\n"); r = { code: 0, stdout: `${time}-${size}\n${size}\n${rest.join(" ")}` }; }
    } else r = await sh(COPY, [path, dir, ext]);
    if (gen !== this.gen) return;
    if (r.code !== 0) {
      const error = this.failed(r);
      if (error !== this.error) this.fail(cx, error);
      return;
    }
    const [name, size, ...rest] = r.stdout.split("\n");
    const stamp = `${name}:${size}`;
    if (this.stamp === stamp && !this.error) return; // unchanged
    this.stamp = stamp;
    const bytes = hexBytes(rest.join(" "));
    if (this.kind === "image") return this.loadImage(cx, gen, name, Number(size), bytes, dir);
    const local = media && !this.on ? path : `${dir}/${name}`;
    const info = { bytes: Number(size) };
    const said = sniffKind(bytes);
    if ((this.kind === "pdf" && said?.kind !== "pdf") || (this.kind === "font" && said?.kind !== "font")) {
      this.fail(cx, `Not a ${noun(this.kind)}, or a damaged one`, info);
      return;
    }
    if (said?.format) info.format = said.format;
    const how = route(this.kind, { native: nativeViews(), tools: await this.tools() });
    if (gen !== this.gen) return;
    this.how = how;
    this.local = local;
    this.info = info;
    if (how.how === "none") { this.fail(cx, how.why, info); return; }
    if (how.how === "raster") {
      this.copy = { name, abs: `${dir}/${name}`, format: "pdf" };
      const pages = how.tool === "pdftoppm"
        ? await sh('pdfinfo "$1" 2>/dev/null', [this.copy.abs])
        : await sh('mdls -name kMDItemNumberOfPages "$1" 2>/dev/null', [this.copy.abs]);
      if (gen !== this.gen) return;
      this.pages = pageCount(pages.stdout) || 0;
      if (how.firstOnly) this.note = this.pages > 1 ? `page 1 of ${this.pages} only` : null;
      this.page = Math.min(this.page, this.pages || 1);
      await this.rasterPage(cx, gen);
      return;
    }
    this.error = null; this.busy = null;
    // A file that changed in place gets a fresh view (same props keep the old one).
    this.rev = stamp;
    cx.notify();
  }

  /** One PDF page as a PNG in the cache, then shown as a picture. */
  async rasterPage(cx, gen) {
    const how = this.how, src = this.copy;
    const base = `${src.name.replace(/\.[^.]*$/, "")}-p${this.page}`;
    const out = `${appHome()}/${CACHE}/${base}.png`;
    this.busy = `Drawing page ${this.page}…`; cx.notify();
    if ((await sh('[ -s "$1" ]', [out])).code !== 0) {
      const argv = rasterArgv(how.tool, this.page).map((a) => a.replace("$IN", src.abs).replace("$OUTBASE", out.replace(/\.png$/, "")).replace("$OUT", out));
      await exec(argv[0], argv.slice(1), { timeout: 60000 }).catch(() => null);
    }
    if (gen !== this.gen) return;
    const png = await sh('[ -s "$1" ] && od -An -v -tx1 -N 32 "$1"', [out]);
    const s = png.code === 0 ? sniff(hexBytes(png.stdout)) : null;
    if (!s?.width) { this.fail(cx, `${how.tool} couldn't draw page ${this.page}`); return; }
    const resized = !this.info?.width || this.info.width !== s.width || this.info.height !== s.height;
    this.info = { ...this.info, width: s.width, height: s.height };
    this.copy = { ...src, page: { name: `${base}.png`, abs: out, format: "png" } };
    this.src = `${CACHE}/${base}.png`;
    this.error = null; this.busy = null;
    if (resized || !this.view) this.view = null;
    cx.notify();
  }

  async loadImage(cx, gen, name, size, bytes, dir) {
    const path = this.path;
    this.how = { how: "image" };
    const head = sniff(bytes);
    const format = head?.format ?? formatOf(path);
    const info = { ...(head ?? { width: 0, height: 0 }), format, bytes: size };
    if (!head) { this.fail(cx, "Not a picture, or a damaged one", info); return; }
    if (!info.width && format !== "heic" && format !== "avif") {
      const f = await sh('file -b "$1"', [`${dir}/${name}`]);
      Object.assign(info, sizeFromFile(f.stdout) ?? {});
      if (gen !== this.gen) return;
      if (!info.width) { this.fail(cx, "Can't tell how big it is (a damaged file?)", info); return; }
    }
    const how = plan(format, platform());
    let copy = { name, abs: `${dir}/${name}`, format };
    if (how.kind === "none") { this.fail(cx, cantShow(format, platform()), info); return; }
    if (how.kind === "convert") {
      this.busy = `Converting ${format.toUpperCase()}…`; cx.notify();
      copy = await this.convert(how.tools, copy, dir);
      if (gen !== this.gen) return;
      if (!copy) { this.fail(cx, cantShow(format, platform()), info); return; }
      // The PNG's own size: the original's header may name a tile or a thumbnail.
      const png = await sh('od -An -v -tx1 -N 32 "$1"', [copy.abs]);
      const s = sniff(hexBytes(png.stdout));
      if (s?.width) { info.width = s.width; info.height = s.height; }
      delete info.orientation;
      if (!info.width) { this.fail(cx, "Can't tell how big it is (a damaged file?)", info); return; }
    }
    const resized = !this.info || this.info.width !== info.width || this.info.height !== info.height;
    this.info = info; this.copy = copy; this.error = null; this.busy = null;
    if (resized || !this.view) this.view = null; // fit again once the pane's size is known
    await this.draw(cx);
    cx.notify();
  }

  /** CSV, TSV, patches: the first MAX_BYTES as text. */
  async loadText(cx, gen) {
    const r = await sh(TEXT_HEAD, [this.path], this.on);
    if (gen !== this.gen) return;
    if (r.code !== 0) { const e = this.failed(r); if (e !== this.error) this.fail(cx, e); return; }
    const nl1 = r.stdout.indexOf("\n"), nl2 = r.stdout.indexOf("\n", nl1 + 1);
    const bytes = Number(r.stdout.slice(0, nl1).trim()), lines = Number(r.stdout.slice(nl1 + 1, nl2).trim());
    const body = r.stdout.slice(nl2 + 1);
    const stamp = `${bytes}:${body.length}:${body.slice(0, 256)}:${body.slice(-256)}`;
    if (this.stamp === stamp && !this.error) return;
    this.stamp = stamp;
    const partial = bytes > MAX_BYTES;
    const text = wholeLines(body, partial);
    this.info = { bytes };
    this.how = { how: this.kind };
    if (this.kind === "diff") {
      this.patch = parsePatch(text);
      this.patch.starts = fileStarts(this.patch.rows);
      this.note = partial ? `first ${fileSize(MAX_BYTES)} of ${fileSize(bytes)}` : null;
    } else {
      const sep = separator(text, this.path.split(".").pop().toLowerCase());
      const { rows, cut } = parseTable(text, sep);
      if (rows.length > MAX_ROWS + 1) rows.length = MAX_ROWS + 1;
      this.grid = table(rows);
      this.grid.sep = sep;
      const shown = this.grid.body.length;
      // wc counts line breaks; quoted ones inside cells make it a little high, so "about".
      this.note = shownNote({ shown, total: Math.max(shown, lines - 1), partial: partial || cut, wide: this.grid.wide, cols: this.grid.cols.length }) || null;
    }
    this.cursor = Math.min(this.cursor, Math.max(0, this.rowCount() - 1));
    this.error = null; this.busy = null;
    cx.notify();
  }

  /** SQLite: its tables, then the chosen one's first rows (sqlite3, read only). */
  async loadDb(cx, gen) {
    const s = await sh(STAMP, [this.path], this.on);
    if (gen !== this.gen) return;
    if (s.code !== 0) { const e = this.failed(s); if (e !== this.error) this.fail(cx, e); return; }
    const [size, time, ...rest] = s.stdout.split("\n");
    const stamp = `${size}:${time}`;
    if (this.stamp === stamp && !this.error) return;
    this.stamp = stamp;
    this.info = { bytes: Number(size) };
    if (sniffKind(hexBytes(rest.join(" ")))?.kind !== "sqlite") { this.fail(cx, `Not a SQLite database${Number(size) ? "" : " (it's empty)"}`); return; }
    const how = route("sqlite", { tools: await this.tools() });
    this.how = how;
    if (how.how === "none") { this.fail(cx, how.why); return; }
    const list = await exec("sqlite3", [...SQLITE_ARGS, this.path, TABLES_SQL], this.on ? { on: this.on } : undefined).catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
    if (gen !== this.gen) return;
    if (list.code !== 0) { this.fail(cx, sqliteError(list.stderr)); return; }
    const tables = tablesOf(list.stdout);
    const was = this.db?.tables?.[this.db.at]?.name;
    const at = Math.max(0, tables.findIndex((x) => x.name === was));
    this.db = { tables, at };
    if (!tables.length) { this.grid = null; this.note = null; this.error = null; this.busy = null; cx.notify(); return; }
    await this.loadTable(cx, gen);
  }

  async loadTable(cx, gen) {
    const t = this.db.tables[this.db.at];
    const q = (sql) => exec("sqlite3", [...SQLITE_ARGS, this.path, sql], this.on ? { on: this.on } : undefined).catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
    const [rows, n] = await Promise.all([q(rowsSql(t.name)), q(countSql(t.name))]);
    if (gen !== this.gen || this.db?.tables[this.db.at] !== t) return;
    if (rows.code !== 0) { this.fail(cx, sqliteError(rows.stderr)); return; }
    const total = Number(parseTable(n.stdout).rows[1]?.[0] ?? 0);
    t.count = total;
    let parsed = parseTable(rows.stdout).rows;
    // An empty table prints nothing, not even its header: ask for the columns.
    if (!parsed.length) {
      const cols = await q(`SELECT name FROM pragma_table_info(${"'" + t.name.replace(/'/g, "''") + "'"});`);
      parsed = [parseTable(cols.stdout).rows.slice(1).map((r) => r[0])];
    }
    this.grid = table(parsed);
    this.note = total > this.grid.body.length ? `first ${count(this.grid.body.length)} of ${count(total)} rows` : null;
    if (this.grid.wide) this.note = [this.note, `${this.grid.cols.length} of ${this.grid.wide} columns`].filter(Boolean).join(" · ");
    this.sy = 0; this.sx = 0; this.cursor = 0;
    this.error = null; this.busy = null;
    cx.notify();
  }

  pickTable(i, cx) {
    if (!this.db?.tables.length) return;
    const n = this.db.tables.length;
    this.db.at = ((i % n) + n) % n;
    this.busy = "Reading…";
    cx.notify();
    const gen = this.gen;
    cx.spawn(async (cx) => this.loadTable(cx, gen));
  }

  /** Another machine's file: its checksum there, then (once per contents) its bytes over base64. */
  async fetch(path, dir, ext) {
    const sum = await sh('[ -f "$1" ] || exit 3; cksum < "$1"', [path], this.on);
    if (sum.code !== 0) return sum;
    const [crc, bytes] = sum.stdout.trim().split(/\s+/);
    const name = `${crc}-${bytes}.${ext}`;
    const have = await sh('[ -f "$1/$2" ] && od -An -v -tx1 -N ' + HEAD + ' "$1/$2"', [dir, name]);
    if (have.code === 0) return { code: 0, stdout: `${name}\n${bytes}\n${have.stdout}` };
    if (Number(bytes) > REMOTE_MAX) return { code: 4, stdout: "", stderr: `Too large to fetch from ${this.on} (${fileSize(Number(bytes))})` };
    const data = await sh('base64 < "$1"', [path], this.on);
    if (data.code !== 0) return data;
    await sh('mkdir -p "$1"', [dir]);
    const b64 = `${dir}/${name}.b64`;
    try { await writeTextFile(b64, data.stdout, null); } catch { /* left over from before: replaced below */ }
    return sh(`base64 -d < "$1" > "$2/$3" && rm -f "$1" && printf '%s\\n%s\\n' "$3" "$4" && od -An -v -tx1 -N ${HEAD} "$2/$3"`, [b64, dir, name, bytes]);
  }

  /** A PNG copy by the first converter found; -> { name, abs, format: "png" } or null. */
  async convert(tools, copy, dir) {
    const name = copy.name.replace(/\.[^.]*$/, "") + ".png", out = `${dir}/${name}`;
    const done = { name, abs: out, format: "png" };
    if ((await sh('[ -s "$1" ]', [out])).code === 0) return done;
    for (const { tool, argv } of tools) {
      if ((await sh('command -v "$1" >/dev/null', [tool])).code !== 0) continue;
      const args = argv.map((a) => a.replace("$IN", copy.abs).replace("$OUTDIR", dir).replace("$OUT", out));
      const r = await exec(args[0], args.slice(1), { timeout: 60000 }).catch(() => null);
      // qlmanage writes `<name>.png` next to its own name.
      if (tool === "qlmanage") await sh('[ -s "$1/$2.png" ] && mv "$1/$2.png" "$3"', [dir, copy.name, out]);
      if (r && (await sh('[ -s "$1" ]', [out])).code === 0) return done;
    }
    return null;
  }

  /** What image() draws: the copy itself, or (turned, or a vector) a wrapper SVG around it. */
  async draw(cx) {
    if (this.how?.how === "raster") {
      // A PDF page: turned through the same wrapper as a picture.
      const page = this.copy?.page;
      if (!page) return;
      const rot = this.view?.rot ?? 0;
      if (!rot) { this.src = `${CACHE}/${page.name}`; return; }
      const name = `${page.name.replace(/\.png$/, "")}-r${rot}.svg`;
      try { await writeTextFile(`${appHome()}/${CACHE}/${name}`, wrapper(page.abs, this.info, rot, 1), null); } catch { /* same name, same contents */ }
      this.src = `${CACHE}/${name}`;
      cx.notify();
      return;
    }
    const copy = this.copy, info = this.info, gen = this.gen;
    if (!copy || !info) return;
    // Turns come faster than wrappers are written: only the latest draw lands.
    const token = this.drawing = (this.drawing ?? 0) + 1;
    const stale = () => gen !== this.gen || token !== this.drawing;
    const rot = this.view?.rot ?? 0;
    const vector = copy.format === "svg";
    if (!rot && !vector) { this.src = `${CACHE}/${copy.name}`; this.still = false; return; }
    let inner = copy;
    if (!EMBEDS.includes(copy.format)) {
      // BMP / TIFF / ICO: the SVG renderer embeds PNGs.
      inner = await this.convert(platform() === "macos"
        ? [{ tool: "sips", argv: ["sips", "-s", "format", "png", "$IN", "--out", "$OUT"] }]
        : [{ tool: "magick", argv: ["magick", "$IN[0]", "$OUT"] }, { tool: "convert", argv: ["convert", "$IN[0]", "$OUT"] }], copy, `${appHome()}/${CACHE}`);
      if (stale()) return;
      if (!inner) { this.note = "can't turn this format here"; this.view = { ...this.view, rot: 0 }; this.src = `${CACHE}/${copy.name}`; return; }
    }
    // Stored size: an EXIF orientation that turns it on its side swaps the shown one.
    const o = info.orientation ?? 1;
    const stored = o >= 5 ? { width: info.height, height: info.width } : info;
    const k = vector ? sharpness(info, this.view?.scale ?? 1, dpr()) : 1;
    const name = `${copy.name.replace(/\.[^.]*$/, "")}-r${rot}-k${k}.svg`;
    try { await writeTextFile(`${appHome()}/${CACHE}/${name}`, wrapper(inner.abs, stored, rot, k, inner.format === "jpeg" ? o : 1), null); } catch { /* already written: same name, same contents */ }
    if (stale()) return;
    this.src = `${CACHE}/${name}`;
    this.still = Boolean(info.animated && rot);
    cx.notify();
  }

  /** Waits for the file's folder to change: the file and the folder's list again. */
  watch(cx, gen) {
    const dir = dirname(this.path);
    cx.spawn(async (cx) => {
      while (gen === this.gen || dirname(this.path) === dir) {
        try { await watchFolder(dir); } catch { return; }
        if (dirname(this.path) !== dir) return;
        // Any change here: the checksum (or size and time) says whether this file changed.
        this.load(cx);
        this.list(cx);
      }
    });
  }

  /** The files of this kind in the file's folder, for next / previous. */
  list(cx) {
    const dir = dirname(this.path);
    if (!this.path) return;
    cx.spawn(async (cx) => {
      const r = await sh('ls -1A "$1"', [dir], this.on);
      if (r.code !== 0 || dirname(this.path) !== dir) return;
      const names = siblings(r.stdout.split("\n"), basename(this.path));
      if (names.join("\n") !== this.names.join("\n")) { this.names = names; cx.notify(); }
    });
  }

  go(dir, cx) {
    const next = stepIn(this.names, basename(this.path), dir);
    if (next && next !== basename(this.path)) this.open(`${dirname(this.path)}/${next}`, cx);
  }

  /** Tells the pane header which file this preview shows, and the app which path. */
  title() {
    if (!this.slot) return;
    const live = new Set(panes().filter((p) => p.mod === MOD).map((p) => p.props?.slot).filter(Boolean));
    const keep = (was, value) => {
      const next = Object.fromEntries(Object.entries(was ?? {}).filter(([k]) => live.has(k)));
      next[this.slot] = value;
      return next;
    };
    const name = this.path ? basename(this.path) : "Preview";
    const titles = shared(TITLES) ?? {}, paths = shared(PATHS) ?? {};
    const stale = (was) => Object.keys(was).some((k) => !live.has(k) && k !== this.slot);
    if (titles[this.slot] !== name || stale(titles)) setShared(TITLES, keep(titles, name));
    if (paths[this.slot] !== this.path || stale(paths)) setShared(PATHS, keep(paths, this.path));
  }

  // ---- native views (PDF, fonts, media)

  nativeEvent(e, cx) {
    if (e.id && e.id !== this.nativeId()) return;
    const d = e.data ?? {};
    if (e.event === "load.error") this.fail(cx, d.message ?? `Can't show this ${noun(this.kind)}`);
    else if (e.event === "pdf.locked") this.note = "locked with a password";
    else if (e.event === "pdf.page" || (e.event === "load.finish" && this.kind === "pdf")) {
      this.pdf = { ...(this.pdf ?? {}), ...d };
      // The view fits the page once it has its size, without saying so: ask again.
      if (e.event === "load.finish") this.pdfLater(cx);
    }
    else if (e.event === "load.finish" && (this.kind === "video" || this.kind === "audio")) this.mediaFacts(cx);
  }

  /** The view's id: a new file gets a new view. */
  nativeId() { return `preview-${this.how?.view ?? "none"}`; }

  call(action, args) {
    try { return herdr.nativeViewCall(this.nativeId(), action, args ?? {}); } catch (err) { this.note = String(err?.message ?? err); return null; }
  }

  pdfDo(action, args) {
    const s = this.call(action, args);
    if (s && typeof s === "object") this.pdf = { ...(this.pdf ?? {}), ...s };
  }

  /** The PDF view's page and scale a moment from now (after a resize, a load). */
  pdfLater(cx) {
    if (this.how?.how !== "native" || this.kind !== "pdf") return;
    const at = this.pdfAsk = (this.pdfAsk ?? 0) + 1;
    cx.timer.after(300, (cx) => {
      if (at !== this.pdfAsk) return;
      const s = this.call("state")?.content;
      if (s && typeof s === "object" && s.pageCount) { this.pdf = { ...(this.pdf ?? {}), ...s }; cx.notify(); }
    });
  }

  /** A clip's length, once the player knows it. */
  mediaFacts(cx, tries = 0) {
    const s = this.call("state")?.content;
    if (s?.duration > 0) { this.media = { duration: s.duration }; cx.notify(); return; }
    if (tries < 20) cx.timer.after(250, (cx) => this.mediaFacts(cx, tries + 1));
  }

  // ---- actions

  reveal() {
    run("pane.split", { edge: "right", px: 280, mod: "nocturne-files", props: { folder: dirname(this.path), on: this.on } });
  }

  system() {
    if (!this.on) run("preview.open", { path: this.path, in: "system" });
  }

  /** Text shown as something else (a table, a patch, an SVG): edit it as
   *  text in the editor (nocturne-editor), beside this preview. */
  editable() {
    return !this.on && /\.(csv|tsv|diff|patch|svg)$/i.test(this.path);
  }

  edit() {
    if (!this.editable()) return;
    const me = panes().find((p) => p.mod === "nocturne-preview" && p.props?.slot && p.props.slot === props()?.slot);
    run("editor.open", { path: this.path, ...(me ? { pane: me.pane } : {}) });
  }

  copyPath(cx) {
    cx.write_to_clipboard(this.on ? `${this.on}:${this.path}` : this.path);
    const at = this.copied = Date.now();
    cx.timer.after(1400, (cx) => { if (this.copied === at) { this.copied = 0; cx.notify(); } });
  }

  // ---- pages (PDF)

  pageGo(n, cx) {
    if (this.how?.how === "native") {
      if (n === "next") this.pdfDo("pdf.next");
      else if (n === "prev") this.pdfDo("pdf.previous");
      else if (this.pdf?.pageCount) this.pdfDo("pdf.goToPage", { page: Math.max(1, Math.min(this.pdf.pageCount, n)) });
      return;
    }
    if (this.how?.how !== "raster" || this.how.firstOnly) return;
    const to = n === "next" ? this.page + 1 : n === "prev" ? this.page - 1 : n;
    const page = Math.max(1, Math.min(this.pages || 1, to));
    if (page === this.page) return;
    this.page = page;
    const gen = this.gen;
    cx.spawn(async (cx) => this.rasterPage(cx, gen));
  }

  // ---- zoom and pan (pictures, a PDF page drawn as one)

  /** The picture's size as shown, and whether it's a vector (fit may enlarge it). */
  img() { return { width: this.info?.width || 1, height: this.info?.height || 1 }; }
  vector() { return this.copy?.format === "svg"; }
  pictured() { return this.how?.how === "image" || this.how?.how === "raster"; }
  ready() { return Boolean(this.pictured() && this.info?.width && this.port.width && this.src); }

  /** The view, fitted the first time the picture and the pane's size are both known. */
  current() {
    if (!this.view && this.pictured() && this.info?.width && this.port.width) this.view = fitted(this.img(), this.port, 0, this.vector());
    return this.pictured() ? this.view : null;
  }

  /** Sets the view; a vector redraws sharper (or lighter) when its scale crosses a step. */
  set(view, cx) {
    const before = this.view;
    this.view = view;
    const k = (v) => sharpness(this.img(), v?.scale ?? 1, dpr());
    if (before?.rot !== view.rot || (this.vector() && k(before) !== k(view))) this.draw(cx);
  }

  zoomBy(dir, cx, at) {
    if (this.how?.how === "native" && this.kind === "pdf") { this.pdfDo(dir > 0 ? "pdf.zoomIn" : "pdf.zoomOut"); return; }
    const v = this.current();
    if (v) this.set(zoomTo(v, step(v.scale, dir), this.img(), this.port, at), cx);
  }

  fit(cx) {
    if (this.how?.how === "native" && this.kind === "pdf") { this.pdfDo("pdf.fitWidth"); return; }
    const v = this.current();
    if (v) this.set(fitted(this.img(), this.port, v.rot, this.vector()), cx);
  }

  actual(cx, at) {
    const v = this.current();
    if (v) this.set(zoomTo(v, 1, this.img(), this.port, at), cx);
  }

  turn(dir, cx) {
    const v = this.current();
    if (v) { this.note = this.how?.firstOnly ? this.note : null; this.set(rotate(v, dir, this.img(), this.port, this.vector()), cx); }
  }

  /** Whether part of the picture is out of view (so keys pan rather than step). */
  pannable() {
    const v = this.current();
    if (!v) return false;
    const { width, height } = turned(this.img(), v.rot);
    return width * v.scale > this.port.width + 1 || height * v.scale > this.port.height + 1;
  }

  pan(dx, dy, cx) {
    const v = this.current();
    if (v) this.set(panBy(v, dx, dy, this.img(), this.port), cx);
  }

  resized(size, cx) {
    const port = { width: size.width, height: size.height };
    if (Math.abs(port.width - this.port.width) <= 1 && Math.abs(port.height - this.port.height) <= 1) return;
    this.port = port;
    const v = this.view;
    if (v && this.pictured()) this.set(v.fit ? { ...v, scale: fitScale(this.img(), port, v.rot, this.vector()) } : clampPan(v, this.img(), port), cx);
    this.scrollBy(0, 0);
    this.pdfLater(cx);
    cx.notify();
  }

  // ---- rows (tables, patches)

  rowCount() { return this.grid ? this.grid.body.length : this.patch ? this.patch.rows.length : 0; }
  /** Rows that fit under the header, in element px. */
  visibleRows() { return Math.max(1, Math.floor((unzoom(this.port.height) - (this.grid ? ROW : 0)) / ROW)); }
  /** How wide the table's columns are together, and the gutter before them. */
  gutter() { return Math.max(GUTTER_MIN, String(this.rowCount()).length * CH + 2 * CELL); }
  colWidth(c) { return c.ch * CH + 2 * CELL; }
  tableWidth() { return this.grid ? this.grid.cols.reduce((s, c) => s + this.colWidth(c), 0) : 0; }
  /** Where each column starts, for h / l. */
  colStarts() { let x = 0; return (this.grid?.cols ?? []).map((c) => { const at = x; x += this.colWidth(c); return at; }); }

  /** Scrolls by element px, kept in bounds. */
  scrollBy(dx, dy) {
    const room = unzoom(this.port.height) - (this.grid ? ROW : 0);
    const maxY = Math.max(0, this.rowCount() * ROW - room);
    const maxX = Math.max(0, this.tableWidth() - (unzoom(this.port.width) - this.gutter()));
    this.sy = Math.max(0, Math.min(maxY, this.sy + dy));
    this.sx = this.grid ? Math.max(0, Math.min(maxX, this.sx + dx)) : 0;
  }

  /** Moves the cursor row (and the view with it, when it leaves). */
  moveTo(row) {
    const n = this.rowCount();
    if (!n) return;
    this.cursor = Math.max(0, Math.min(n - 1, row));
    const top = Math.ceil(this.sy / ROW), shown = this.visibleRows();
    if (this.cursor < top) this.scrollBy(0, this.cursor * ROW - this.sy);
    else if (this.cursor >= top + shown) this.scrollBy(0, (this.cursor - shown + 1) * ROW - this.sy);
  }

  /** The next / previous column start (h, l). */
  column(dir) {
    const starts = this.colStarts();
    const to = dir > 0 ? starts.find((x) => x > this.sx + 1) : [...starts].reverse().find((x) => x < this.sx - 1);
    this.scrollBy((to ?? (dir > 0 ? this.tableWidth() : 0)) - this.sx, 0);
  }

  rowKey(k, m, cx) {
    const page = Math.max(1, this.visibleRows() - 1);
    if (k === "j" || k === "down") this.moveTo(this.cursor + 1);
    else if (k === "k" || k === "up") this.moveTo(this.cursor - 1);
    else if ((k === "J" || (k === "j" && m.shift)) || k === "pagedown") { this.scrollBy(0, page * ROW); this.moveTo(this.cursor + page); }
    else if ((k === "K" || (k === "k" && m.shift)) || k === "pageup") { this.scrollBy(0, -page * ROW); this.moveTo(this.cursor - page); }
    else if (k === "g" && !m.shift || k === "home") this.moveTo(0);
    else if (k === "G" || (k === "g" && m.shift) || k === "end") this.moveTo(this.rowCount() - 1);
    else if (this.grid && (k === "h" || k === "left")) this.column(-1);
    else if (this.grid && (k === "l" || k === "right")) this.column(1);
    else if (this.patch && (k === "}" || k === "{")) {
      const to = nextFile(this.patch.starts, this.cursor, k === "}" ? 1 : -1);
      if (to != null) { this.moveTo(to); this.scrollBy(0, to * ROW - this.sy); }
    } else if (this.db && (k === "t" || k === "T")) this.pickTable(this.db.at + (k === "T" || m.shift ? -1 : 1), cx);
    else return false;
    return true;
  }

  key(e, cx) {
    const k = e.key, m = e.modifiers ?? {};
    if (m.platform || m.control || m.alt) return;
    const d = m.shift ? SHOVE : NUDGE;
    const how = this.how?.how;
    if (k === "o") this.system();
    else if (k === "e") this.edit();
    else if (k === "y") this.copyPath(cx);
    else if (k === "f") this.reveal();
    else if (k === "n" || k === "]") this.go(1, cx);
    else if (k === "p" || k === "[") this.go(-1, cx);
    else if ((how === "table" || how === "diff") && this.rowKey(k, m, cx)) { /* moved */ }
    else if (how === "native" && this.kind === "pdf") {
      if (k === "+" || k === "=") this.zoomBy(1, cx);
      else if (k === "-" || k === "_") this.zoomBy(-1, cx);
      else if (k === "0") this.fit(cx);
      else if (k === "right" || k === "l" || k === "pagedown" || k === "space") this.pageGo("next", cx);
      else if (k === "left" || k === "h" || k === "pageup" || k === "backspace") this.pageGo("prev", cx);
      else if (k === "g" && !m.shift) this.pageGo(1, cx);
      else if (k === "G" || k === "g") this.pageGo(this.pdf?.pageCount ?? 1, cx);
      else return;
    } else if (how === "image" || how === "raster") {
      const pan = this.pannable();
      const paged = how === "raster" && !this.how.firstOnly;
      // Fitted, nothing to pan: ← → step through the folder (a PDF: its pages).
      const sideways = (dir) => (paged ? this.pageGo(dir > 0 ? "next" : "prev", cx) : this.go(dir, cx));
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
      else return;
    } else if (how === "native" && (this.kind === "video" || this.kind === "audio") && k === "space") {
      const s = this.call("state")?.content;
      this.call(s?.rate > 0 ? "media.pause" : "media.play");
    } else return;
    cx.stop_propagation();
    cx.notify();
  }

  /** `nocturne-preview.<command>` (keys.json, `herdr-app do`): every shown preview takes it. */
  command(c, cx) {
    if (c === "zoom_in") this.zoomBy(1, cx);
    else if (c === "zoom_out") this.zoomBy(-1, cx);
    else if (c === "fit") this.fit(cx);
    else if (c === "actual") this.actual(cx);
    else if (c === "next") this.go(1, cx);
    else if (c === "prev") this.go(-1, cx);
    else if (c === "page_next") this.pageGo("next", cx);
    else if (c === "page_prev") this.pageGo("prev", cx);
    else if (c === "rotate") this.turn(1, cx);
    else if (c === "background") this.checker = !this.checker;
    else if (c === "reload") { this.copy = null; this.stamp = null; this.load(cx); }
  }

  /** Pointer position in the viewport, from an event on it. */
  at(e) {
    const p = e?.local_position;
    return p ? { x: p.x, y: p.y } : null;
  }

  wheel(e, cx) {
    const m = e.modifiers ?? {}, dy = e.delta?.y ?? 0, dx = e.delta?.x ?? 0;
    const how = this.how?.how;
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
      this.set(zoomTo(v, v.scale * k, this.img(), this.port, this.at(e)), cx);
    } else if (this.pannable()) this.set(panBy(v, dx, dy, this.img(), this.port), cx);
    else return;
    cx.notify();
  }

  // ---- parts

  chip(t, id, label, action, on) {
    return h_flex().id(id).relative().h(20).px(6).flex_none().items_center()
      .text_color(on ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); cx.notify(); })
      .when(Boolean(on), (el) => el.child(checker(t.ansi0, 1)).child(div().absolute().left(0).right(0).bottom(0).h(2).bg(t.accent)))
      .child(div().relative().child(label));
  }

  /** "1920 × 1080 · PNG · 2.4 MB · animated", "12 034 rows × 9 columns · 3.1 MB", "3 files · +120 −40". */
  facts(w) {
    const i = this.info;
    if (!i) return "";
    const parts = [];
    const size = () => { if (w >= 600 && i.bytes >= 0) parts.push(fileSize(i.bytes)); };
    if (this.kind === "image") {
      if (i.width) parts.push(`${i.width} × ${i.height}`);
      if (w >= 520 && i.format) parts.push(i.format.toUpperCase());
      size();
      if (w >= 680 && i.animated) parts.push(this.still ? "still while turned" : i.frames ? `${i.frames} frames` : "animated");
    } else if (this.grid && this.kind === "table") {
      parts.push(`${count(this.grid.body.length)} rows × ${this.grid.wide || this.grid.cols.length} columns`);
      if (w >= 560 && this.grid.sep === ";") parts.push("; separated");
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
      if (w >= 520) parts.push(String(this.path.split(".").pop()).toUpperCase());
      size();
    } else {
      if (i.format) parts.push(i.format.toUpperCase());
      size();
    }
    return parts.join(" · ");
  }

  /** The kind's own controls in the bar, always in the same places. */
  controls(t, w, el) {
    const how = this.how?.how;
    if (how === "image" || how === "raster") {
      const v = this.view;
      if (!v || !this.ready()) return el;
      if (how === "raster" && !this.how.firstOnly && this.pages > 1) el = this.pager(t, el, this.page, this.pages);
      // The scale, then two chips that each do what they say: one toggle labelled
      // by its state ("fit 21%" zooming to 100%) read backwards and moved under the pointer.
      return el
        .when(w >= 400, (e2) => e2.child(div().flex_none().text_color(t.dim).child(percent(v.scale))))
        .child(this.chip(t, "img-fit", "fit", (cx) => this.fit(cx), v.fit))
        .child(this.chip(t, "img-actual", "100%", (cx) => this.actual(cx), !v.fit && Math.abs(v.scale - 1) < 1e-9))
        .when(w >= 380, (e2) => e2.child(this.chip(t, "img-turn", (how === "image" && this.note) || (v.rot ? `turn ${v.rot * 90}°` : "turn"), (cx) => this.turn(1, cx), Boolean(v.rot))))
        .when(w >= 460 && how === "image", (e2) => e2.child(this.chip(t, "img-bg", this.checker ? "checker" : "dark", () => { this.checker = !this.checker; }, false)));
    }
    if (how === "native" && this.kind === "pdf" && this.pdf?.pageCount) {
      const p = this.pdf;
      el = this.pager(t, el, p.page, p.pageCount);
      return el
        .when(w >= 400 && p.scale > 0, (e2) => e2.child(div().flex_none().text_color(t.dim).child(percent(p.scale))))
        .child(this.chip(t, "pdf-out", "−", () => this.zoomBy(-1)))
        .child(this.chip(t, "pdf-fit", "fit", () => this.fit(), Boolean(p.autoScales)))
        .child(this.chip(t, "pdf-in", "+", () => this.zoomBy(1)));
    }
    return el;
  }

  /** ‹ 3/12 › for pages. */
  pager(t, el, page, pages) {
    return el
      .child(this.chip(t, "page-prev", "‹", (cx) => this.pageGo("prev", cx)))
      .child(div().flex_none().text_color(t.foreground).child(`p ${page}/${pages}`))
      .child(this.chip(t, "page-next", "›", (cx) => this.pageGo("next", cx)));
  }

  toolbar(t) {
    const w = unzoom(this.port.width) || 600;
    const index = this.names.indexOf(basename(this.path));
    const many = this.names.length > 1;
    let el = h_flex().id("preview-toolbar").relative().h(34).flex_none().px(10).gap(8).items_center().text_size(11)
      .when(w >= 320, (e2) => e2.child(div().flex_none().text_color(t.ansi8).child(tag(this.kind, this.path))))
      .child(h_flex().flex_1().min_w(0).gap(8).items_baseline()
        .child(div().flex_none().max_w_full().truncate().text_color(t.foreground).child(basename(this.path || "Preview")))
        .when(w >= 420 && Boolean(this.facts(w)), (e2) => e2.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(this.facts(w)))))
      .when(many && w >= 360, (e2) => e2
        .child(this.chip(t, "img-prev", "‹", (cx) => this.go(-1, cx)))
        .child(div().flex_none().text_color(t.dim).child(index >= 0 ? `${index + 1}/${this.names.length}` : `${this.names.length}`))
        .child(this.chip(t, "img-next", "›", (cx) => this.go(1, cx))));
    el = this.controls(t, w, el);
    return el
      .when(Boolean(this.path), (e2) => e2
        .when(w >= 360 && this.editable(), (e3) => e3.child(this.chip(t, "img-edit", "edit", () => this.edit())))
        .when(w >= 300, (e3) => e3.child(this.chip(t, "img-files", "files", () => this.reveal())))
        .when(w >= 540 && !this.on, (e3) => e3.child(this.chip(t, "img-open", "open", () => this.system())))
        .when(w >= 620, (e3) => e3.child(this.chip(t, "img-copy", this.copied ? "copied" : "copy", (cx) => this.copyPath(cx), Boolean(this.copied)))))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(checker(t.ansi0, 1)));
  }

  /** A second strip: a database's tables, or what's left out of a table or patch. */
  strip(t) {
    const tables = this.db?.tables ?? [];
    // A picture's note sits on its turn chip.
    const note = this.how?.how === "image" ? null : this.note;
    if (!tables.length && !note) return null;
    return h_flex().id("preview-strip").relative().h(26).flex_none().px(10).gap(2).items_center().text_size(11).overflow_hidden()
      .children(tables.map((x, i) => this.chip(t, `db-table-${i}`, x.type === "view" ? `${x.name} (view)` : x.name, (cx) => { if (i !== this.db.at) this.pickTable(i, cx); }, i === this.db.at)))
      .when(Boolean(note), (el) => el.child(div().flex_1().min_w(0).when(tables.length > 0, (e2) => e2.pl(8)).truncate().text_color(t.ansi3).child(note)))
      .child(div().absolute().left(0).right(0).bottom(0).h(2).child(checker(t.ansi0, 1)));
  }

  empty(t, title, hint, offer) {
    return v_flex().size_full().items_center().justify_center().gap(10).px(16).text_size(11)
      .child(svg(`${ART}/moon-8.svg`).w(44).h(44).text_color(t.ansi8).opacity(0.6))
      .child(div().text_color(t.foreground).child(title))
      .when(Boolean(hint), (el) => el.child(div().text_center().text_color(t.ansi8).child(hint)))
      .when(Boolean(offer) && !this.on && Boolean(this.path), (el) => el.child(h_flex().pt(4).text_color(t.muted)
        .child(this.chip(t, "empty-open", "open in its app  o", () => this.system()))));
  }

  /** Where the view is when part of the picture is out of it: dithered rails on the
   *  right and bottom edges, as the Markdown viewer's scrollbar. */
  rails(t, box, focused) {
    const port = this.port, out = [];
    const color = focused ? t.accent : t.ansi8;
    if (box.height > port.height + 1) {
      const shown = port.height / box.height, top = (-box.top / box.height) * port.height;
      out.push(div().absolute().right(1).w(3).top(unzoom(top)).h(unzoom(Math.max(16, port.height * shown))).child(checker(color, 1)));
    }
    if (box.width > port.width + 1) {
      const shown = port.width / box.width, left = (-box.left / box.width) * port.width;
      out.push(div().absolute().bottom(1).h(3).left(unzoom(left)).w(unzoom(Math.max(16, port.width * shown))).child(checker(color, 1)));
    }
    return out;
  }

  picture(t, focused) {
    const v = this.current();
    const box = placed(v, this.img(), this.port);
    const [l, tp, w, h] = [box.left, box.top, box.width, box.height].map(unzoom);
    const paper = this.how?.how === "raster";
    return [
      // The checker sits under the picture only: transparency reads, the pane stays dark.
      // A PDF page is paper: white under it.
      div().absolute().left(l).top(tp).w(w).h(h).overflow_hidden().bg(paper ? "#ffffff" : this.checker ? t.hover : t.background)
        .when(this.checker && !paper, (el) => el.child(checker(t.ansi0, 8))),
      image(this.src).id(`img-${this.slot ?? "view"}`).absolute().left(l).top(tp).w(w).h(h),
      ...this.rails(t, box, focused),
    ];
  }

  /** The macOS view for a PDF, a font or a clip; under it, what shows while it loads. */
  native(t) {
    const view = this.how.view;
    return [herdr.nativeView.new(this.nativeId(), { kind: view, path: this.local, rev: this.rev })
      .child(this.empty(t, view === "media" ? "Opening the player…" : "Opening…", tilde(this.path, home())))];
  }

  /** Dithered rails for rows that don't all fit: right (rows), bottom (columns). */
  rowRails(t, focused, top, roomH, roomW, left) {
    const out = [], color = focused ? t.accent : t.ansi8;
    const total = this.rowCount() * ROW;
    if (total > roomH + 1) {
      const h = Math.max(16, roomH * (roomH / total)), y = top + (this.sy / Math.max(1, total - roomH)) * (roomH - h);
      out.push(div().absolute().right(1).w(3).top(y).h(h).child(checker(color, 1)));
    }
    const width = this.tableWidth();
    if (this.grid && width > roomW + 1) {
      const w = Math.max(16, roomW * (roomW / width)), x = left + (this.sx / Math.max(1, width - roomW)) * (roomW - w);
      out.push(div().absolute().bottom(1).h(3).left(x).w(w).child(checker(color, 1)));
    }
    return out;
  }

  /** The rows on screen, from the scroll position. */
  shownRange() {
    const first = Math.max(0, Math.floor(this.sy / ROW));
    const last = Math.min(this.rowCount(), first + this.visibleRows() + 2);
    return [first, last];
  }

  /** A table: header row and row numbers stay put, the cells scroll both ways. */
  tableView(t, focused) {
    const g = this.grid, font = code();
    const gut = this.gutter(), roomW = unzoom(this.port.width) - gut, roomH = unzoom(this.port.height) - ROW;
    const [first, last] = this.shownRange();
    const cell = (c, v, head) => div().w(this.colWidth(c)).flex_none().px(CELL).truncate()
      .when(c.num && !head, (el) => el.text_right())
      .text_color(head ? t.foreground : v === "" ? t.dim : t.foreground).child(oneLine(v));
    const rows = [];
    for (let r = first; r < last; r++) {
      const row = g.body[r], cur = r === this.cursor;
      rows.push(h_flex().absolute().left(0).top(ROW + r * ROW - this.sy).h(ROW).w_full().items_center()
        .when(cur, (el) => el.bg(t.hover))
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

  /** A patch, as nocturne-diff draws one, with each file's name over its part. */
  diffView(t, focused) {
    const font = code(), p = this.patch;
    const wide = unzoom(this.port.width) >= 560;
    const [first, last] = this.shownRange();
    const num = (n, w) => div().w(w).flex_none().text_right().pr(6).text_color(t.dim).child(n == null ? "" : String(n));
    const rows = [];
    for (let r = first; r < last; r++) {
      const row = p.rows[r], cur = r === this.cursor;
      let el;
      if (row.kind === "file") {
        el = h_flex().h(ROW).w_full().relative().items_center().px(10).gap(10).text_size(11)
          .child(div().absolute().left(0).right(0).bottom(0).h(1).child(checker(t.ansi0, 1)))
          .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(row.old ? `${row.old} → ${row.path}` : row.path || "(no name)"))
          .when(row.binary, (e2) => e2.child(div().flex_none().text_color(t.dim).child("binary")))
          .child(div().flex_none().text_color(t.ansi2).child(`+${row.add}`))
          .child(div().flex_none().text_color(t.ansi1).child(`-${row.del}`));
      } else if (row.kind === "@") {
        el = h_flex().h(ROW).w_full().relative().items_center().px(8).gap(10).text_size(11)
          .child(checker(t.ansi0, 2))
          .child(div().relative().flex_none().px(4).bg(t.background).text_color(t.accent).child(wide ? row.range : row.range.replace(/^@@ | @@$/g, "")))
          .when(Boolean(row.text), (e2) => e2.child(div().relative().min_w(0).truncate().px(4).bg(t.background).text_color(t.muted).child(row.text)));
      } else if (row.kind === "note") {
        el = h_flex().h(ROW).w_full().items_center().px(10).font_family(font).text_size(12).child(div().min_w(0).truncate().text_color(t.dim).child(row.text || " "));
      } else {
        const tint = row.kind === "+" ? t.ansi2 : row.kind === "-" ? t.ansi1 : null;
        el = h_flex().h(ROW).w_full().relative().items_center().font_family(font).text_size(12)
          .when(Boolean(tint), (e2) => e2.bg(tint + "16"))
          .child(div().w(3).h_full().flex_none().relative().when(Boolean(tint), (e2) => e2.child(checker(tint, 1))))
          .when(!wide, (e2) => e2.child(num(row.n ?? row.o, 34)))
          .when(wide, (e2) => e2.child(num(row.o, 38)).child(num(row.n, 38)))
          .child(div().w(wide ? 14 : 12).flex_none().text_color(tint ?? t.dim).child(row.kind === "+" || row.kind === "-" ? row.kind : ""))
          .child(div().flex_1().min_w(0).truncate().pr(8)
            .text_color(row.kind === "\\" ? t.dim : row.kind === " " ? t.muted : t.foreground).child(row.text || " "));
      }
      rows.push(div().absolute().left(0).right(0).top(r * ROW - this.sy).h(ROW)
        .when(cur && focused, (e2) => e2.child(div().absolute().left(0).top(0).bottom(0).w(1).bg(t.accent)))
        .child(el));
    }
    const body = !p.rows.length ? [div().absolute().left(16).top(12).text_size(11).text_color(t.dim).child("Nothing in it")] : rows;
    return [div().absolute().inset_0().children([...body, ...this.rowRails(t, focused, 0, unzoom(this.port.height), 0, 0)])];
  }

  render() {
    const t = theme();
    const focused = this.handle.is_focused();
    const how = this.how?.how;
    let inner = [];
    if (this.error) inner = [this.empty(t, `Can't preview this ${noun(this.kind)}`, this.error, true)];
    else if (this.busy) inner = [this.empty(t, this.busy, tilde(this.path, home()))];
    else if (how === "native") inner = this.native(t);
    else if (how === "table" && this.db && !this.db.tables.length) inner = [this.empty(t, "No tables", "This database is empty.")];
    else if (how === "table" && this.grid) inner = this.tableView(t, focused);
    else if (how === "diff" && this.patch) inner = this.diffView(t, focused);
    else if (!this.src) inner = [this.empty(t, "Reading…", tilde(this.path, home()))];
    else if (this.current()) inner = this.picture(t, focused);
    const body = div().id("preview-view").relative().flex_1().min_h(0).overflow_hidden()
      .when(this.pannable(), (el) => (this.drag ? el.cursor_grabbing() : el.cursor_grab()))
      .on_size_change((size, cx) => this.resized(size, cx))
      .on_scroll_wheel((e, cx) => this.wheel(e, cx))
      .on_mouse_down("left", (e, cx) => {
        this.handle.focus();
        const at = this.at(e);
        if ((how === "table" || how === "diff") && at) {
          const head = how === "table" ? ROW : 0;
          const r = Math.floor((unzoom(at.y) - head + this.sy) / ROW);
          if (unzoom(at.y) >= head && r >= 0 && r < this.rowCount()) { this.cursor = r; cx.notify(); }
          return;
        }
        if (e.click_count === 2 && at && this.current()) { this.view.fit ? this.actual(cx, at) : this.fit(cx); this.drag = null; cx.notify(); return; }
        if (at && this.pannable()) { this.drag = { from: at, x: this.view.x, y: this.view.y }; cx.notify(); }
      })
      .on_mouse_move((e, cx) => {
        const at = this.at(e), d = this.drag;
        if (!d || !at || !this.view) return;
        this.view = clampPan({ ...this.view, fit: false, x: d.x + at.x - d.from.x, y: d.y + at.y - d.from.y }, this.img(), this.port);
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => { if (this.drag) { this.drag = null; cx.notify(); } })
      .on_hover((over, cx) => { if (!over && this.drag) { this.drag = null; cx.notify(); } })
      .children(inner);
    const strip = this.error || this.busy ? null : this.strip(t);
    return v_flex().id(MOD).size_full().bg(t.background).text_color(t.foreground).track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(this.toolbar(t))
      .when(Boolean(strip), (el) => el.child(strip))
      .child(body);
  }
}
