// What the preview makes of a file, as plain functions (no app calls), so
// scripts/preview*.test.ts can check them: which kind of file a path
// names (by extension, then by its first bytes), how this computer can show
// that kind, and the folder's order for next / previous.

import type { Color } from "gpui-kit";
import type { Theme } from "herdr";

/** The kinds the preview opens. */
export type Kind = "image" | "pdf" | "table" | "sqlite" | "diff" | "font" | "video" | "audio";

/** What the files pane's preview split makes of a path: a kind, Markdown, or text. */
export type LookKind = Kind | "markdown" | "text";

/** A font's format, as its first bytes say. */
export type FontFormat = "woff" | "woff2" | "otf" | "ttc" | "ttf";

/** What a file's first bytes say it is (sniffKind). */
export type Sniffed = { readonly kind: "pdf" } | { readonly kind: "sqlite" } | { readonly kind: "font"; readonly format: FontFormat };

/** A program `route` asks after. */
export type Tool = "pdftoppm" | "sips" | "sqlite3";

/** How this computer shows a kind (route()). */
export type Route =
  /** A macOS view (PDFView, AVPlayerView, Quick Look) placed in the pane. */
  | { readonly how: "native"; readonly view: "pdf" | "quicklook" | "media" }
  /** A PNG of one page (pdftoppm, or sips for the first page only). */
  | { readonly how: "raster"; readonly tool: "pdftoppm" | "sips"; readonly firstOnly?: true }
  /** Drawn by the preview itself. */
  | { readonly how: "image" }
  | { readonly how: "table" }
  | { readonly how: "diff" }
  /** Nothing here shows it: say so, offer the system's app. */
  | { readonly how: "none"; readonly why: string };

/** What `route` knows of this computer: macOS views, and the programs installed. */
export interface RouteHost {
  readonly native?: boolean;
  readonly tools?: readonly string[];
}

/** A piece of a line in its colour (null: the text's own). */
export type Run = readonly [piece: string, color: Color | null];

/** A highlight span over the whole text: [start, end, capture name], ordered. */
export type Span = readonly [start: number, end: number, name: string];

/** Each kind in the order they're looked up. */
const KIND_LIST: readonly Kind[] = ["image", "pdf", "table", "sqlite", "diff", "font", "video", "audio"];

/** Each kind's extensions. */
export type KindExtensions = { readonly [K in Kind]: readonly string[] };

/** Extensions per kind (the app's links::Viewer::Preview list; keep them alike). */
export const KINDS: KindExtensions = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "ico", "svg", "avif", "heic", "heif"],
  pdf: ["pdf"],
  table: ["csv", "tsv"],
  sqlite: ["sqlite", "sqlite3", "db", "db3"],
  diff: ["diff", "patch"],
  font: ["ttf", "otf", "ttc", "woff", "woff2"],
  video: ["mp4", "m4v", "mov"],
  audio: ["mp3", "m4a", "aac", "wav", "aif", "aiff", "flac", "caf"],
};

/** The lower-case extension of a path ("" without one). */
export function extension(path: string | null | undefined): string {
  const name = (path ?? "").split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** The bar's tag for a kind (a table's is its format: CSV, TSV). */
export function tag(kind: LookKind | null, path: string | null): string {
  switch (kind) {
    case "table": return extension(path) === "tsv" ? "TSV" : "CSV";
    case "image": return "IMG";
    case "pdf": return "PDF";
    case "sqlite": return "DB";
    case "diff": return extension(path) === "patch" ? "PATCH" : "DIFF";
    case "font": return "FONT";
    case "video": return "VIDEO";
    case "audio": return "AUDIO";
    case "markdown": return "MD";
    case "text": return "TEXT";
    case null: return "FILE";
  }
}

/** What a kind is called in a sentence ("Can't preview this PDF"). */
export function noun(kind: LookKind | null): string {
  switch (kind) {
    case "image": return "picture";
    case "pdf": return "PDF";
    case "table": return "table";
    case "sqlite": return "database";
    case "diff": return "patch";
    case "font": return "font";
    case "video": return "video";
    case "audio": return "recording";
    case "markdown": return "Markdown file";
    case "text":
    case null: return "file";
  }
}

/** The kind a path's extension names, or null. */
export function kindOf(path: string | null | undefined): Kind | null {
  const ext = extension(path);

  if (!ext) return null;

  return KIND_LIST.find((kind) => KINDS[kind].includes(ext)) ?? null;
}

/** What the files pane's preview split makes of a path: the preview's kind,
 *  else "markdown", else "text" (read as text; a binary one says so). */
export function lookKind(path: string | null | undefined): LookKind {
  return kindOf(path) ?? (/\.(md|markdown|mdx)$/i.test(path ?? "") ? "markdown" : "text");
}

/** Whether the preview opens a path. */
export const previewable = (path: string | null | undefined): boolean => kindOf(path) !== null;

const ascii = (b: readonly number[], at: number, n: number): string => String.fromCharCode(...b.slice(at, at + n));

/** What a file's first bytes say it is, for the kinds that aren't pictures (they
 *  have image.ts's sniff), or null. */
export function sniffKind(b: readonly number[] | null | undefined): Sniffed | null {
  if (!b || b.length < 4) return null;

  if (ascii(b, 0, 5) === "%PDF-") return { kind: "pdf" };

  if (ascii(b, 0, 16) === "SQLite format 3\0") return { kind: "sqlite" };

  const head = ascii(b, 0, 4);

  if (head === "wOFF") return { kind: "font", format: "woff" };

  if (head === "wOF2") return { kind: "font", format: "woff2" };

  if (head === "OTTO") return { kind: "font", format: "otf" };

  if (head === "ttcf") return { kind: "font", format: "ttc" };

  if (head === "\0\x01\0\0" || head === "true") return { kind: "font", format: "ttf" };

  return null;
}

/** How this computer shows a kind, best first (see Route). */
export function route(kind: LookKind | null, host: RouteHost = {}): Route {
  const { native = false, tools = [] } = host;

  switch (kind) {
    case "image": return { how: "image" };
    case "table": return { how: "table" };
    case "diff": return { how: "diff" };
    case "sqlite": return tools.includes("sqlite3") ? { how: "table" } : { how: "none", why: "Reading a database needs sqlite3, and it isn't installed" };

    case "pdf":
      if (native) return { how: "native", view: "pdf" };

      if (tools.includes("pdftoppm")) return { how: "raster", tool: "pdftoppm" };

      if (tools.includes("sips")) return { how: "raster", tool: "sips", firstOnly: true };

      return { how: "none", why: "Showing a PDF here needs pdftoppm (poppler)" };

    case "font": return native ? { how: "native", view: "quicklook" } : { how: "none", why: "Fonts are previewed on macOS only" };

    case "video":
    case "audio": return native ? { how: "native", view: "media" } : { how: "none", why: "Playing media here works on macOS only" };

    default: return { how: "none", why: "The preview doesn't know this kind of file" };
  }
}

/** The programs `route` asks after for a kind (looked up with `command -v`). */
export function toolsFor(kind: LookKind | null): readonly Tool[] {
  switch (kind) {
    case "pdf": return ["pdftoppm", "sips"];
    case "sqlite": return ["sqlite3"];
    default: return [];
  }
}

/** pdftoppm's / sips's argv for page `page` (1-based) of `$IN` as a PNG at `$OUT`.
 *  pdftoppm writes `<prefix>.png` with -singlefile, so it gets `$OUT` less `.png`. */
export function rasterArgv(tool: "pdftoppm" | "sips", page: number, dpi = 144): readonly string[] {
  if (tool === "pdftoppm") return ["pdftoppm", "-f", String(page), "-l", String(page), "-png", "-r", String(dpi), "-singlefile", "$IN", "$OUTBASE"];

  return ["sips", "-s", "format", "png", "$IN", "--out", "$OUT"];
}

/** `pdfinfo`'s "Pages:" line, or `mdls`' kMDItemNumberOfPages: the page count, or 0. */
export function pageCount(text: string | null | undefined): number {
  const m = /^(?:Pages:\s*|kMDItemNumberOfPages\s*=\s*)(\d+)/m.exec(text ?? "");

  return m ? Number(m[1]) : 0;
}

/** "3:07", "1:02:03" from seconds; "" when unknown. */
export function duration(s: number | null | undefined): string {
  if (s === null || s === undefined || !(s >= 0) || !Number.isFinite(s)) return "";

  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");

  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Audio and video count as one kind for stepping. */
const family = (k: Kind | null): Kind | null => (k === "audio" ? "video" : k);

/** Names in a folder, the ones of `current`'s kind among them in the order a
 *  person reads them (case-insensitive, numbers by value: shot-2 before shot-10),
 *  hidden ones out unless `current` is hidden. Audio and video count as one kind. */
export function siblings(names: readonly string[], current: string | null | undefined): string[] {
  const want = family(kindOf(current));
  const hidden = (current ?? "").startsWith(".");

  if (!want) return [];

  return [...new Set(names)].filter((n) => n && family(kindOf(n)) === want && (hidden || !n.startsWith(".")))
    .sort((a, b) => natural(a, b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** Compares names as a person reads them: case aside, runs of digits by value.
 *  (The app's script engine has no Intl.Collator.) */
export function natural(a: string, b: string): number {
  const parts = (s: string): readonly string[] => s.toLowerCase().match(/\d+|\D+/g) ?? [];
  const x = parts(a);
  const y = parts(b);

  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const xi = x[i] ?? "";
    const yi = y[i] ?? "";

    if (xi === yi) continue;

    if (/^\d/.test(xi) && /^\d/.test(yi)) return Number(xi) - Number(yi) || xi.length - yi.length;

    return xi < yi ? -1 : 1;
  }

  return x.length - y.length;
}

/** The name `step` places from `current` in `list` (wrapping around); `current`
 *  gone from the list: where it would have been. */
export function stepIn(list: readonly string[], current: string, step: number): string | null {
  if (!list.length) return null;

  let i = list.indexOf(current);

  if (i < 0) {
    const after = list.findIndex((n) => natural(n, current) > 0);

    i = (after < 0 ? list.length : after) - (step > 0 ? 1 : 0);
  }

  return list[(((i + step) % list.length) + list.length) % list.length] ?? null;
}

/** "812 B", "4.2 KB", "13 MB". */
export function fileSize(bytes: number): string {
  if (!(bytes >= 0)) return "";

  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB"] as const;
  let v = bytes / 1024;
  let u = 0;

  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }

  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u] ?? "GB"}`;
}

/** "1 204 330": thin groups of three, as the bar writes counts. */
export const count = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

// ---- text in the editor's colors (as editor/logic.ts and finder)

/** The moonfly roles a tree-sitter capture name colors with, from the theme
 *  (capture names are data: what the highlighter answers). */
export function syntaxColors(t: Theme): ReadonlyMap<string, Color> {
  return new Map<string, Color>([
    ["keyword", t.ansi5], ["keyword.operator", t.ansi9], ["conditional", t.ansi5], ["repeat", t.ansi5], ["include", t.ansi5],
    ["function", t.ansi12], ["function.builtin", t.ansi4], ["function.macro", t.ansi13], ["constructor", t.ansi10],
    ["type", t.ansi10], ["type.builtin", t.ansi10], ["tag", t.ansi10], ["attribute", t.ansi13], ["namespace", t.ansi6], ["module", t.ansi6],
    ["string", t.ansi11], ["string.escape", t.ansi9], ["string.special", t.ansi3], ["string.regex", t.ansi3], ["character", t.ansi11], ["escape", t.ansi9],
    ["number", t.ansi3], ["float", t.ansi3], ["boolean", t.ansi3], ["constant", t.ansi3], ["constant.builtin", t.ansi3],
    ["comment", t.ansi8], ["comment.documentation", t.ansi8],
    ["property", t.ansi6], ["field", t.ansi6], ["label", t.ansi3], ["operator", t.ansi9],
    ["variable.builtin", t.ansi4], ["variable.parameter", t.foreground], ["embedded", t.foreground],
    ["text.title", t.ansi4], ["text.literal", t.ansi11], ["text.uri", t.ansi6], ["text.reference", t.ansi12], ["text.emphasis", t.ansi5], ["text.strong", t.ansi5],
    ["punctuation.special", t.ansi9],
  ]);
}

/** The color for a capture name: its own, else its root's, else null. */
export function colorOf(colors: ReadonlyMap<string, Color>, name: string): Color | null {
  const own = colors.get(name);

  if (own) return own;

  const parts = name.split(".");

  for (let i = parts.length - 1; i > 0; i--) {
    const c = colors.get(parts.slice(0, i).join("."));

    if (c) return c;
  }

  return null;
}

/** Where each line starts in `text` (offsets), one more for the end. */
export function lineStarts(text: string): number[] {
  const out = [0];

  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) out.push(i + 1);

  return out;
}

/** Where line `n` of `text` ends (its break left out). */
const lineEnd = (text: string, starts: readonly number[], n: number): number => {
  const next = starts[n + 1];

  return next === undefined ? text.length : next - 1;
};

/** Line `n` (0-based) of `text` as [piece, color|null] runs, from the whole
 *  text's highlight spans ([start, end, name], ordered): only the spans that
 *  touch it are looked at. Tabs as two spaces. */
export function lineRuns(text: string, starts: readonly number[], spans: readonly Span[], n: number, colors: ReadonlyMap<string, Color>): Run[] {
  const from = starts[n] ?? text.length;
  const to = lineEnd(text, starts, n);
  const line = text.slice(from, to);
  // The first span ending after the line's start.
  let lo = 0;
  let hi = spans.length;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;

    if ((spans[mid]?.[1] ?? 0) <= from) lo = mid + 1;
    else hi = mid;
  }

  const out: Run[] = [];
  let at = 0;

  for (let i = lo; i < spans.length; i++) {
    const span = spans[i];

    if (!span || span[0] >= to) break;

    const s = Math.max(0, span[0] - from);
    const e = Math.min(line.length, span[1] - from);

    if (e <= at) continue;

    if (s > at) out.push([line.slice(at, s), null]);

    out.push([line.slice(Math.max(s, at), e), colorOf(colors, span[2])]);
    at = e;
  }

  if (at < line.length) out.push([line.slice(at), null]);

  return out.map(([piece, color]) => [piece.replace(/\t/g, "  ").replace(/\r$/, ""), color]);
}

// ---- soft wrap (the files pane's narrow preview)

/** Where each line's wrapped rows start at `cols` characters a row (tabs
 *  count two, as lineRuns draws them); the last entry is the row count. */
export function wrapRows(text: string, starts: readonly number[], cols: number): number[] {
  const at = [0];

  for (let n = 0; n < starts.length; n++) {
    const from = starts[n] ?? text.length;
    const to = lineEnd(text, starts, n);
    let len = to - from;

    for (let i = from; i < to; i++) if (text.charCodeAt(i) === 9) len++;

    at.push((at[n] ?? 0) + Math.max(1, Math.ceil(len / cols)));
  }

  return at;
}

/** The line a wrapped row belongs to, and which of its rows it is: [line, k]. */
export function rowLine(at: readonly number[], row: number): readonly [line: number, k: number] {
  let lo = 0;
  let hi = at.length - 2;

  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;

    if ((at[mid] ?? 0) <= row) lo = mid;
    else hi = mid - 1;
  }

  return [lo, row - (at[lo] ?? 0)];
}

/** The [piece, color] runs of characters [from, to) of a line's runs. */
export function sliceRuns(runs: readonly Run[], from: number, to: number): Run[] {
  const out: Run[] = [];
  let at = 0;

  for (const [piece, color] of runs) {
    const end = at + piece.length;

    if (end > from && at < to) out.push([piece.slice(Math.max(0, from - at), Math.min(piece.length, to - at)), color]);

    at = end;

    if (at >= to) break;
  }

  return out;
}
