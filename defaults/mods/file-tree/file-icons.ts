// A file's type mark: which of the marks in icons/ (a 16 grid of crisp
// squares as nocturne's art, one colour, tinted by the theme; drawn at 12 px)
// stands for a path, and the theme colour it takes. Plain functions over
// kinds.ts and nothing else of a mod's. Shared: editor (its tabs and bar) and
// file-tree (its rows) ship this file and icons/*.svg byte for byte
// (scripts/editor-tabs.test.ts fails when they differ): edit editor's and
// copy them over.

import type { Color } from "gpui-kit";
import type { Theme } from "herdr";
import type { LookKind } from "./kinds.ts";
import { extension, lookKind } from "./kinds.ts";

/** The marks: a page (anything else), text, Markdown, code, settings, a
 *  picture, a PDF, a table (CSV, SQLite), video or audio. */
export type FileIcon = "file" | "text" | "markdown" | "code" | "config" | "image" | "pdf" | "table" | "media";

export const FILE_ICONS: readonly FileIcon[] = ["file", "text", "markdown", "code", "config", "image", "pdf", "table", "media"];

/** The size the marks are drawn at (px, unzoomed). */
export const ICON_SIZE = 12;

const CODE = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "rs", "go", "py", "rb", "java", "kt", "kts", "swift", "c", "h", "cc", "cpp", "hpp", "cxx",
  "m", "mm", "cs", "fs", "zig", "lua", "nix", "sh", "bash", "zsh", "fish", "ps1", "php", "pl", "hs", "ml", "ex", "exs", "erl", "clj", "scala",
  "dart", "r", "jl", "sql", "html", "htm", "css", "scss", "sass", "less", "vue", "svelte", "astro", "elm", "gleam", "wgsl", "glsl", "metal", "vim",
]);

const CODE_NAMES = new Set(["makefile", "justfile", "dockerfile", "rakefile", "gemfile", "brewfile", "vagrantfile", "procfile"]);
const CONFIG = new Set(["json", "jsonc", "json5", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "envrc", "plist", "xml", "lock", "properties", "editorconfig", "gitignore", "gitattributes", "gitmodules", "npmrc", "prettierrc", "eslintrc"]);
const TEXT = new Set(["txt", "text", "log", "rst", "adoc", "org", "tex", "rtf", "srt", "vtt"]);

/** The mark for a kind of file (kinds.ts lookKind), its extension (or name)
 *  telling code and settings from other text. */
export function iconOfKind(kind: LookKind, ext: string, name = ""): FileIcon {
  switch (kind) {
    case "image": return "image";
    case "pdf": return "pdf";
    case "table":
    case "sqlite": return "table";
    case "video":
    case "audio": return "media";
    case "diff": return "code";
    case "font": return "file";
    case "markdown": return "markdown";
    case "text": return textIcon(ext, name.toLowerCase());
  }
}

function textIcon(ext: string, name: string): FileIcon {
  if (CONFIG.has(ext) || (name.startsWith(".") && CONFIG.has(name.slice(1))) || /^\.env(\..+)?$/.test(name)) return "config";

  if (CODE.has(ext) || CODE_NAMES.has(name)) return "code";

  return TEXT.has(ext) || !ext ? "text" : "file";
}

/** The mark for a path. */
export function fileIcon(path: string | null | undefined): FileIcon {
  const name = (path ?? "").split("/").pop() ?? "";

  return iconOfKind(lookKind(path), extension(path), name);
}

/** A mark's svg in mod `mod`'s copy of icons/ (an app asset path). */
export function iconSvg(icon: FileIcon, mod: string): string {
  return `mods/${mod}/icons/${icon}.svg`;
}

/** A mark's tint in the theme: Markdown blue, code cyan, settings yellow,
 *  pictures and media magenta, a PDF red, a table green, text dim. */
export function iconColor(icon: FileIcon, t: Theme): Color {
  switch (icon) {
    case "markdown": return t.ansi4;
    case "code": return t.ansi6;
    case "config": return t.ansi3;
    case "image":
    case "media": return t.ansi5;
    case "pdf": return t.ansi1;
    case "table": return t.ansi2;
    case "text":
    case "file": return t.dim;
  }
}
