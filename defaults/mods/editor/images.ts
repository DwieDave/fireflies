// Images in a Markdown file (main.js, rendered.js): where a pasted picture
// goes, the line that shows it, and reading the clipboard's image.
//
// Where it goes: beside the document, in a folder of its own:
// `assets/<document name>-<time>.<ext>` for a Markdown file; for a scratchpad
// note (`<app home>/scratchpad/<note>.md`, out of the repository, so are its
// pictures) `<note>-assets/<note>-<time>.<ext>` beside it. The Markdown gets
// the relative path.
//
// The clipboard: the app hands mods its text only, so its image is read with
// the system's own tool through exec: macOS osascript (an image as PNG, or a
// copied file: Finder, a clipboard manager), Linux wl-paste or xclip
// (image/png), Windows PowerShell. Each answers "png", "file:<path>" or
// "none".

import type * as Herdr from "herdr";

const EXT = /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|avif|heic)$/i;

/** Whether a path names an image file (by its extension). */
export const isImagePath = (p: string | null | undefined): boolean => EXT.test(p ?? "");

const trim = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, "") : p);

const dirOf = (p: string): string => {
  const t = trim(p);
  const i = t.lastIndexOf("/");

  return i > 0 ? t.slice(0, i) : "/";
};

const baseOf = (p: string): string => trim(p).split("/").pop() ?? "";

/** A moment as YYYYMMDD-HHMMSS (local time): file names that sort. */
export function stamp(d = new Date()): string {
  const z = (n: number): string => String(n).padStart(2, "0");

  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

/** What else assetPlace takes: a scratchpad note's, the extension, the moment, names in use. */
export interface AssetOptions {
  readonly scratch?: boolean;
  readonly ext?: string;
  readonly now?: Date;
  readonly taken?: (path: string) => boolean;
}

/** Where a pasted picture goes: its folder, its path, and the path from the document's folder. */
export interface AssetPlace {
  readonly dir: string;
  readonly path: string;
  readonly rel: string;
}

/** Where a picture pasted into `doc` goes: { dir, path, rel } (rel: from the document's folder).
 *  `scratch`: the document is a scratchpad note. `ext` without the dot. */
export function assetPlace(doc: string, { scratch = false, ext = "png", now = new Date(), taken = () => false }: AssetOptions = {}): AssetPlace {
  const name = baseOf(doc).replace(/\.(md|markdown|mdx)$/i, "") || "image";
  const folder = scratch ? `${name}-assets` : "assets";
  const dir = `${dirOf(doc)}/${folder}`;
  let file = `${name}-${stamp(now)}.${ext}`;

  // Two in one second: -2, -3 …
  for (let n = 2; taken(`${dir}/${file}`); n++) file = `${name}-${stamp(now)}-${n}.${ext}`;

  return { dir, path: `${dir}/${file}`, rel: `${folder}/${file}` };
}

/** `to` relative to the folder `from` (both absolute). */
export function relative(from: string, to: string): string {
  const a = trim(from).split("/").filter(Boolean);
  const b = trim(to).split("/").filter(Boolean);
  let i = 0;

  while (i < a.length && i < b.length && a[i] === b[i]) i++;

  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/") || ".";
}

/** The Markdown for an image: ![alt](path), spaces and parentheses in the path escaped. */
export function imageMarkdown(path: string, alt = ""): string {
  const src = path.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");

  return `![${alt.replace(/[[\]]/g, "")}](${src})`;
}

/** The text with the image line in, and the line it's on. */
export interface Inserted {
  readonly text: string;
  readonly line: number;
}

/** The text with an image line put at `line`: there when that line is blank, else as a block
 *  of its own after the block holding it (`blockEnd`: that block's last line; default the
 *  line itself), blank lines around it. -> { text, line } (where the image line is). */
export function insertImage(text: string | null | undefined, line: number, md: string, blockEnd = line): Inserted {
  const t = text ?? "";
  const eol = /\r\n/.test(t) ? "\r\n" : "\n";
  const ls = t.split(/\r?\n/);
  const at = Math.max(0, Math.min(line, ls.length - 1));

  if (!ls[at]?.trim()) {
    ls[at] = md;

    // A blank line after it when something follows straight on.
    if (ls[at + 1]?.trim()) ls.splice(at + 1, 0, "");

    if (at > 0 && ls[at - 1]?.trim()) {
      ls.splice(at, 0, "");

      return { text: ls.join(eol), line: at + 1 };
    }

    return { text: ls.join(eol), line: at };
  }

  const end = Math.max(at, Math.min(blockEnd, ls.length - 1));
  const add = ["", md];

  if (ls[end + 1]?.trim()) add.push("");
  ls.splice(end + 1, 0, ...add);

  return { text: ls.join(eol), line: end + 2 };
}

const MAC = [
  "on run argv",
  "set p to item 1 of argv",
  "try",
  "return \"file:\" & (POSIX path of (the clipboard as «class furl»))",
  "end try",
  "try",
  "set d to the clipboard as «class PNGf»",
  "on error",
  "return \"none\"",
  "end try",
  "set fh to open for access (POSIX file p) with write permission",
  "set eof of fh to 0",
  "write d to fh",
  "close access fh",
  "return \"png\"",
  "end run",
];

const LINUX = 'if command -v wl-paste >/dev/null 2>&1 && wl-paste --list-types 2>/dev/null | grep -qx image/png; then wl-paste --type image/png > "$1" && echo png; ' +
  'elif command -v xclip >/dev/null 2>&1 && xclip -selection clipboard -t TARGETS -o 2>/dev/null | grep -qx image/png; then xclip -selection clipboard -t image/png -o > "$1" && echo png; ' +
  "else echo none; fi";

const WINDOWS = "Add-Type -AssemblyName System.Windows.Forms; $f = [Windows.Forms.Clipboard]::GetFileDropList(); if ($f.Count -gt 0) { 'file:' + $f[0]; exit }; " +
  "$i = [Windows.Forms.Clipboard]::GetImage(); if ($i) { $i.Save($args[0], [Drawing.Imaging.ImageFormat]::Png); 'png' } else { 'none' }";

/** herdr's window().platform. */
export type Platform = ReturnType<typeof Herdr.window>["platform"];

/** The command that writes the clipboard's image to `path` (a PNG) or names a copied file:
 *  [command, args]. `platform`: herdr's window().platform. */
export function clipboardCommand(platform: Platform, path: string): readonly [string, string[]] {
  if (platform === "macos") return ["osascript", [...MAC.flatMap((l) => ["-e", l]), path]];

  if (platform === "windows") return ["powershell", ["-NoProfile", "-STA", "-Command", WINDOWS, path]];

  return ["sh", ["-c", LINUX, "clipboard-image", path]];
}

/** The clipboard's picture: a PNG written to `path`, or a copied image file. */
export interface ClipboardImage {
  readonly kind: "png" | "file";
  readonly path: string;
}

/** Reads the clipboard's picture: -> { kind: "png", path } (written to `path`), { kind: "file", path }
 *  (a copied image file), or null (no picture: paste as text). `exec` is herdr's. */
export async function readClipboardImage(exec: typeof Herdr.exec, platform: Platform, path: string): Promise<ClipboardImage | null> {
  const [cmd, args] = clipboardCommand(platform, path);
  const r = await exec(cmd, args, { timeout: 5000 }).catch(() => null);
  const out = (r?.stdout ?? "").trim();

  if (r?.code !== 0) return null;

  if (out === "png") return { kind: "png", path };

  if (out.startsWith("file:")) {
    const file = out.slice(5).trim();

    return isImagePath(file) ? { kind: "file", path: file } : null;
  }

  return null;
}

/** Whether pasted clipboard text could be a copied file's name (Finder puts the name there
 *  beside the file itself): then the clipboard is asked for the file first. */
export const maybeCopiedImage = (text: string | null | undefined): boolean => text !== null && text !== undefined && !text.includes("\n") && text.length < 260 && isImagePath(text.trim());
