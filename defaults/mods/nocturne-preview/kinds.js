// What the preview makes of a file, as plain functions (no app calls), so
// scripts/nocturne-preview*.test.ts can check them: which kind of file a path
// names (by extension, then by its first bytes), how this computer can show
// that kind, and the folder's order for next / previous.

/** Extensions per kind (the app's links::Viewer::Preview list; keep them alike). */
export const KINDS = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "ico", "svg", "avif", "heic", "heif"],
  pdf: ["pdf"],
  table: ["csv", "tsv"],
  sqlite: ["sqlite", "sqlite3", "db", "db3"],
  diff: ["diff", "patch"],
  font: ["ttf", "otf", "ttc", "woff", "woff2"],
  video: ["mp4", "m4v", "mov"],
  audio: ["mp3", "m4a", "aac", "wav", "aif", "aiff", "flac", "caf"],
};

/** The bar's tag for a kind (a table's is its format: CSV, TSV). */
export function tag(kind, path) {
  if (kind === "table") return extension(path) === "tsv" ? "TSV" : "CSV";
  return { image: "IMG", pdf: "PDF", sqlite: "DB", diff: extension(path) === "patch" ? "PATCH" : "DIFF", font: "FONT", video: "VIDEO", audio: "AUDIO" }[kind] ?? "FILE";
}

/** What a kind is called in a sentence ("Can't preview this PDF"). */
export const noun = (kind) => ({ image: "picture", pdf: "PDF", table: "table", sqlite: "database", diff: "patch", font: "font", video: "video", audio: "recording" }[kind] ?? "file");

/** The lower-case extension of a path ("" without one). */
export function extension(path) {
  const name = String(path ?? "").split("/").pop();
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** The kind a path's extension names, or null. */
export function kindOf(path) {
  const ext = extension(path);
  if (!ext) return null;
  for (const [kind, exts] of Object.entries(KINDS)) if (exts.includes(ext)) return kind;
  return null;
}

/** Whether the preview opens a path. */
export const previewable = (path) => kindOf(path) != null;

const ascii = (b, at, n) => String.fromCharCode(...b.slice(at, at + n));

/** What a file's first bytes say it is, for the kinds that aren't pictures (they
 *  have image.js's sniff): "pdf", "sqlite", "font" (with its `format`), or null. */
export function sniffKind(b) {
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

/** How this computer shows a kind, best first:
 *  "native"  a macOS view (PDFView, AVPlayerView, Quick Look) placed in the pane
 *  "raster"  a PNG of one page (pdftoppm, or sips for the first page only)
 *  "table" / "diff" / "image"  drawn by the preview itself
 *  "none"    nothing here shows it: say so, offer the system's app */
export function route(kind, { native = false, tools = [] } = {}) {
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

/** The programs `route` asks after, per kind (looked up with `command -v`). */
export const TOOLS = { pdf: ["pdftoppm", "sips"], sqlite: ["sqlite3"] };

/** pdftoppm's / sips's argv for page `page` (1-based) of `$IN` as a PNG at `$OUT`.
 *  pdftoppm writes `<prefix>.png` with -singlefile, so it gets `$OUT` less `.png`. */
export function rasterArgv(tool, page, dpi = 144) {
  if (tool === "pdftoppm") return ["pdftoppm", "-f", String(page), "-l", String(page), "-png", "-r", String(dpi), "-singlefile", "$IN", "$OUTBASE"];
  return ["sips", "-s", "format", "png", "$IN", "--out", "$OUT"];
}

/** `pdfinfo`'s "Pages:" line, or `mdls`' kMDItemNumberOfPages: the page count, or 0. */
export function pageCount(text) {
  const m = /^(?:Pages:\s*|kMDItemNumberOfPages\s*=\s*)(\d+)/m.exec(String(text ?? ""));
  return m ? Number(m[1]) : 0;
}

/** "3:07", "1:02:03" from seconds; "" when unknown. */
export function duration(s) {
  if (!(s >= 0) || !Number.isFinite(s)) return "";
  const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Names in a folder, the ones of `current`'s kind among them in the order a
 *  person reads them (case-insensitive, numbers by value: shot-2 before shot-10),
 *  hidden ones out unless `current` is hidden. Audio and video count as one kind. */
export function siblings(names, current) {
  const family = (k) => (k === "audio" ? "video" : k);
  const want = family(kindOf(current));
  const hidden = String(current ?? "").startsWith(".");
  return [...new Set(names)].filter((n) => n && want && family(kindOf(n)) === want && (hidden || !n.startsWith(".")))
    .sort((a, b) => natural(a, b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** Compares names as a person reads them: case aside, runs of digits by value.
 *  (The app's script engine has no Intl.Collator.) */
export function natural(a, b) {
  const parts = (s) => String(s).toLowerCase().match(/\d+|\D+/g) ?? [];
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    const dx = /^\d/.test(x[i]), dy = /^\d/.test(y[i]);
    if (dx && dy) return Number(x[i]) - Number(y[i]) || x[i].length - y[i].length;
    return x[i] < y[i] ? -1 : 1;
  }
  return x.length - y.length;
}

/** The name `step` places from `current` in `list` (wrapping around); `current`
 *  gone from the list: where it would have been. */
export function stepIn(list, current, step) {
  if (!list.length) return null;
  let i = list.indexOf(current);
  if (i < 0) {
    const after = list.findIndex((n) => natural(n, current) > 0);
    i = (after < 0 ? list.length : after) - (step > 0 ? 1 : 0);
  }
  return list[(((i + step) % list.length) + list.length) % list.length];
}

/** "812 B", "4.2 KB", "13 MB". */
export function fileSize(bytes) {
  if (!(bytes >= 0)) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

/** "1 204 330": thin groups of three, as the bar writes counts. */
export const count = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
