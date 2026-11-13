// The editor's decisions, as plain functions (no app calls), so
// scripts/editor.test.ts can check them: what a language's settings
// come to, which language server to run and where its workspace is, what
// the bar and the hints say, where the hover card goes, the edits sent to a
// server, the app's keys. What a server answers (diagnostics, hovers,
// definitions, progress) is lsp-replies.ts's; isServerCaps proves its
// capabilities here.

import type { Color } from "gpui-kit";
import type { EditorLanguage, Settings, Theme, keys } from "herdr";
import type { Guarded } from "./guard.ts";
import { isNumber, isString, object, oneOf, parseJson } from "./guard.ts";
import type { Json, JsonObject } from "./guards.ts";
import { isJson, isJsonObject } from "./guards.ts";

/** A language server to try: its argv and the settings it gets. */
export interface ServerSpec {
  readonly argv: readonly string[];
  readonly settings?: JsonObject;
}

/** A server to start: its argv and the settings it gets (null: none). */
export interface ServerCandidate {
  readonly argv: readonly string[];
  readonly settings: Json | null;
}

/** rust-analyzer's settings (its initializationOptions; workspace/configuration). */
export const RUST_ANALYZER = { cargo: { targetDir: true } } as const satisfies JsonObject;

const TYPESCRIPT: readonly ServerSpec[] = [{ argv: ["typescript-language-server", "--stdio"], settings: { supportsHoverVerbosity: true } }, { argv: ["vtsls", "--stdio"] }];

/** Built-in language servers by language id, tried in order: the first found on PATH runs.
 *  `settings` go out as initializationOptions and workspace/configuration. */
export const SERVERS: ReadonlyMap<string, readonly ServerSpec[]> = new Map<string, readonly ServerSpec[]>([
  // Its own target folder (target/rust-analyzer): its build scripts, proc
  // macros and `cargo check` never wait on a `cargo build` for the lock, nor
  // rebuild what the build made with another environment (the dev shell's).
  ["rust", [{ argv: ["rust-analyzer"], settings: RUST_ANALYZER }]],
  ["typescript", TYPESCRIPT],
  ["tsx", TYPESCRIPT],
  ["javascript", TYPESCRIPT],
  ["python", [{ argv: ["basedpyright-langserver", "--stdio"] }, { argv: ["pyright-langserver", "--stdio"] }, { argv: ["pylsp"] }]],
  ["go", [{ argv: ["gopls"] }]],
  ["nix", [{ argv: ["nixd"] }, { argv: ["nil"] }]],
  ["lua", [{ argv: ["lua-language-server"] }]],
  ["bash", [{ argv: ["bash-language-server", "start"] }]],
  ["json", [{ argv: ["vscode-json-language-server", "--stdio"], settings: { provideFormatter: true, json: { validate: { enable: true } } } }]],
  ["yaml", [{ argv: ["yaml-language-server", "--stdio"], settings: { yaml: { validate: true, schemaStore: { enable: true } } } }]],
  ["toml", [{ argv: ["taplo", "lsp", "stdio"] }]],
  ["markdown", [{ argv: ["marksman", "server"] }]],
  ["css", [{ argv: ["vscode-css-language-server", "--stdio"], settings: { provideFormatter: true } }]],
  ["html", [{ argv: ["vscode-html-language-server", "--stdio"], settings: { provideFormatter: true } }]],
  ["c", [{ argv: ["clangd"] }]],
  ["zig", [{ argv: ["zls"] }]],
]);

/** What marks a language's workspace root, nearest first; `outermost`: the
 *  highest such folder inside the repository (a Cargo workspace). */
export interface RootMarkers {
  readonly markers: readonly string[];
  readonly outermost?: boolean;
}

/** The workspace markers by language id. */
export const ROOTS: ReadonlyMap<string, RootMarkers> = new Map<string, RootMarkers>([
  ["rust", { markers: ["Cargo.toml"], outermost: true }],
  ["typescript", { markers: ["tsconfig.json", "jsconfig.json", "package.json"] }],
  ["tsx", { markers: ["tsconfig.json", "jsconfig.json", "package.json"] }],
  ["javascript", { markers: ["jsconfig.json", "tsconfig.json", "package.json"] }],
  ["python", { markers: ["pyproject.toml", "pyrightconfig.json", "setup.py", "setup.cfg", "requirements.txt"] }],
  ["go", { markers: ["go.work", "go.mod"] }],
  ["nix", { markers: ["flake.nix"] }],
  ["lua", { markers: [".luarc.json", ".luarc.jsonc"] }],
  ["c", { markers: ["compile_commands.json", "CMakeLists.txt", "Makefile"] }],
  ["zig", { markers: ["build.zig"] }],
]);

/** LSP's languageId for a language id and path. */
export function languageId(lang: string, path = ""): string {
  const ext = (path.match(/\.([^./]+)$/)?.[1] ?? "").toLowerCase();

  if (lang === "tsx") return "typescriptreact";

  if (lang === "javascript" && ext === "jsx") return "javascriptreact";

  if (lang === "bash") return "shellscript";

  if (lang === "json" && (ext === "jsonc" || /(^|\/)(tsconfig|jsconfig)[^/]*\.json$/.test(path))) return "jsonc";

  if (lang === "c" && ["cc", "cpp", "cxx", "hpp", "hh"].includes(ext)) return "cpp";

  if (lang === "c" && ["m", "mm"].includes(ext)) return "objective-c";

  return lang || "plaintext";
}

/** The settings every language has a value for. */
interface Defaults {
  readonly tab_size: number;
  readonly insert_spaces: boolean;
  readonly soft_wrap: boolean;
  readonly format_on_save: boolean;
}

const DEFAULTS: Defaults = { tab_size: 4, insert_spaces: true, soft_wrap: false, format_on_save: false };

/** Indentation people expect where a language has a convention. */
const LANGUAGE_DEFAULTS: ReadonlyMap<string, Partial<Defaults>> = new Map<string, Partial<Defaults>>([
  ["javascript", { tab_size: 2 }],
  ["typescript", { tab_size: 2 }],
  ["tsx", { tab_size: 2 }],
  ["json", { tab_size: 2 }],
  ["yaml", { tab_size: 2 }],
  ["nix", { tab_size: 2 }],
  ["lua", { tab_size: 2 }],
  ["html", { tab_size: 2 }],
  ["css", { tab_size: 2 }],
  ["markdown", { tab_size: 2, soft_wrap: true }],
  ["go", { insert_spaces: false }],
  ["text", { soft_wrap: true }],
]);

/** settings.json's `editor` as settings() has it. */
export type EditorSettings = Settings["editor"];

/** A language's settings as the editor runs with them: every default filled in. */
export type LanguageOptions = Omit<EditorSettings, "languages"> & Defaults;

/** A language's settings: settings.json's `editor.languages[lang]`, over its
 *  top level, over the language's convention, over the editor's defaults. */
export function languageSettings(editor: EditorSettings | undefined, lang: string): LanguageOptions {
  const { languages, ...top }: EditorSettings = editor ?? {};
  const out = { ...DEFAULTS, ...LANGUAGE_DEFAULTS.get(lang), ...top, ...languages?.[lang] };

  // settings() has it as a number (1 to 16 in settings.json); anything else is the default.
  return { ...out, tab_size: Math.min(16, Math.max(1, Number(out.tab_size) || DEFAULTS.tab_size)) };
}

/** The last part of a path (`/nix/x/bin/rust-analyzer` → `rust-analyzer`). */
const programName = (path: string | undefined): string => (path ?? "").split("/").pop() ?? "";

/** The servers to try for a language: settings.json's `server` (an argv, or
 *  false for none), else the built-in list. */
export function serverCandidates(lang: string, settings: Pick<EditorLanguage, "server" | "server_settings">): ServerCandidate[] {
  if (settings.server === false) return [];

  // Handed to the server as is; a value JSON can't hold isn't sent.
  const extra: Json = isJson(settings.server_settings) ? settings.server_settings : null;
  const list = SERVERS.get(lang) ?? [];
  const own = settings.server;

  if (own !== undefined && own.length > 0) {
    // Another build of a built-in server (a path, a wrapper) keeps its settings.
    const same = list.find((s) => programName(s.argv[0]) === programName(own[0]));

    return [{ argv: own, settings: merge(same?.settings ?? null, extra) }];
  }

  return list.map((s) => ({ argv: s.argv, settings: merge(s.settings ?? null, extra) }));
}

/** `b` over `a`: objects field by field, anything else replaced; a null `b` keeps `a`. */
function merge(a: Json, b: Json): Json {
  if (b === null) return a;

  if (!isJsonObject(a) || !isJsonObject(b)) return b;

  const out = new Map<string, Json>(Object.entries(a));

  for (const [k, v] of Object.entries(b)) {
    const was = a[k];

    if (was !== undefined) out.set(k, merge(was, v));
    else if (v !== null) out.set(k, v);
  }

  return Object.fromEntries(out);
}

/** A shell script that prints, one per line, every folder from `dir` up to /
 *  holding one of `markers`, then `git <root>` for the repository's top. */
export function rootScript(markers: readonly string[]): string {
  const tests = markers.map((m) => `[ -e "$d/${m.replace(/"/g, "")}" ]`).join(" || ");

  return `d="$1"; while :; do if ${tests || "false"}; then echo "$d"; fi; [ "$d" = / ] && break; d=$(dirname "$d"); done; echo "git $(git -C "$1" rev-parse --show-toplevel 2>/dev/null)"`;
}

/** The workspace root from rootScript's output: the nearest marked folder
 *  (outermost: the highest inside the repository), else the repository, else
 *  the file's folder. */
export function pickRoot(lang: string, output: string | null | undefined, dir: string): string {
  const lines = (output ?? "").split("\n").flatMap((l) => (l.trim() ? [l.trim()] : []));
  const isGit = (l: string): boolean => l === "git" || l.startsWith("git ");
  const git = lines.find(isGit)?.slice(3).trim() || null;
  const marked = lines.filter((l) => !isGit(l));
  const inside = git ? marked.filter((d) => d === git || d.startsWith(git + "/")) : marked;
  const outermost = inside.at(-1);

  if (ROOTS.get(lang)?.outermost && outermost !== undefined) return outermost;

  return marked[0] ?? git ?? dir;
}

/** `file://` URI for a path, as LSP servers expect (percent-encoded). */
export function uri(path: string): string {
  return "file://" + encodeURI(path).replace(/[?#]/g, encodeURIComponent);
}

/** The path a `file://` URI names. */
export function pathOf(u: string): string | null {
  if (!u.startsWith("file://")) return null;

  try {
    return decodeURIComponent(u.slice(7).replace(/^localhost/, ""));
  } catch {
    return null;
  }
}

/** "~/x" for paths under home. */
export function tilde(path: string, home: string | null | undefined): string {
  return home && (path === home || path.startsWith(home + "/")) ? "~" + path.slice(home.length) : path;
}

export const dirname = (p: string): string => (p.lastIndexOf("/") > 0 ? p.slice(0, p.lastIndexOf("/")) : "/");

export const basename = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

/** The moonfly roles a capture name colors with (moonfly.vim's groups), by capture name. */
export type SyntaxColors = ReturnType<typeof syntaxColors>;

/** The moonfly roles (moonfly.vim's groups) a capture name colors with, from
 *  the theme's palette: `{ keyword: "#cf87e8", ... }` for EditorState's
 *  `syntax` and the hover's code. */
export function syntaxColors(t: Theme) {
  return {
    keyword: t.ansi5,
    "keyword.operator": t.ansi9,
    conditional: t.ansi5,
    repeat: t.ansi5,
    include: t.ansi5,
    function: t.ansi12,
    "function.builtin": t.ansi4,
    "function.macro": t.ansi13,
    constructor: t.ansi10,
    type: t.ansi10,
    "type.builtin": t.ansi10,
    tag: t.ansi10,
    attribute: t.ansi13,
    namespace: t.ansi6,
    module: t.ansi6,
    string: t.ansi11,
    "string.escape": t.ansi9,
    "string.special": t.ansi3,
    "string.regex": t.ansi3,
    character: t.ansi11,
    escape: t.ansi9,
    number: t.ansi3,
    float: t.ansi3,
    boolean: t.ansi3,
    constant: t.ansi3,
    "constant.builtin": t.ansi3,
    comment: t.ansi8,
    "comment.documentation": t.ansi8,
    property: t.ansi6,
    field: t.ansi6,
    label: t.ansi3,
    operator: t.ansi9,
    "variable.builtin": t.ansi4,
    "variable.parameter": t.foreground,
    embedded: t.foreground,
    "text.title": t.ansi4,
    "text.literal": t.ansi11,
    "text.uri": t.ansi6,
    "text.reference": t.ansi12,
    "text.emphasis": t.ansi5,
    "text.strong": t.ansi5,
    "punctuation.special": t.ansi9,
  } as const satisfies { readonly [capture: string]: Color };
}

/** Each palette's colors by capture name, made once per palette. */
const byNames = new WeakMap<SyntaxColors, ReadonlyMap<string, Color>>();

/** The color for a capture name (data: a grammar's): its own, else its root's, else none. */
export function colorOf(colors: SyntaxColors, name: string): Color | null {
  const byName = byNames.get(colors) ?? new Map<string, Color>(Object.entries(colors));

  byNames.set(colors, byName);

  const parts = name.split(".");

  for (let i = parts.length; i > 0; i--) {
    const c = byName.get(parts.slice(0, i).join("."));

    if (c) return c;
  }

  return null;
}

/** A piece of text and its color (null: the text's own). */
export type ColorRun = [string, Color | null];

/** `text` cut into `[piece, color|null]` by highlight spans `[start, end, name]`. */
export function colorRuns(text: string, spans: readonly (readonly [number, number, string])[] | null | undefined, colors: SyntaxColors): ColorRun[] {
  const out: ColorRun[] = [];
  let at = 0;

  for (const [s, e, name] of spans ?? []) {
    if (s > at) out.push([text.slice(at, s), null]);

    if (e > s) out.push([text.slice(s, e), colorOf(colors, name)]);

    at = Math.max(at, e);
  }

  if (at < text.length) out.push([text.slice(at), null]);

  return out;
}

/** A hint: its key and what it does. */
export type Hint = readonly [key: string, what: string];

/** What the hint bar is for: a prompt (find, replace, go to line), vim and its mode, the file. */
export interface HintState {
  readonly mode?: "find" | "replace" | "line" | null;
  readonly vim?: boolean;
  readonly vimMode?: string;
  readonly server?: boolean;
  readonly markdown?: boolean;
  readonly view?: string;
}

/** The hint bar along the editor's foot: { mode (find / replace / line, or
 *  null), vim (on), vimMode, server (a language server answers), markdown,
 *  view (split / preview / text) }. The keys entry ends it: space ? in vim's
 *  normal mode, cmd-k ? otherwise; a find or go-to-line prompt keeps its own. */
export function hintList({ mode = null, vim = false, vimMode = "normal", server = false, markdown = false, view = "split" }: HintState = {}): Hint[] {
  if (mode === "line") return [["enter", "go"], ["esc", "close"]];

  if (mode) return [["enter", "next"], ["shift-enter", "prev"], ...(mode === "replace" ? [["cmd-enter", "replace all"] as const] : []), ["esc", "close"]];

  if (vim && vimMode === "insert") return [["esc", "normal"], ["cmd-s", "save"], ["cmd-p", "files"], ["cmd-k ?", "keys"]];

  const serverKeys = (definition: string, hover: string): Hint[] => (server ? [[definition, "definition"], [hover, "hover"]] : []);

  const list: Hint[] = vim
    ? [[":", "ex"], ["space", "leader"], ["/", "search"], ["]d", "problem"], ...serverKeys("gd", "K"), ["cmd-p", "files"], ["cmd-shift-f", "grep"]]
    : [["cmd-s", "save"], ["cmd-f", "find"], ["cmd-l", "line"], ["cmd-k n", "problem"], ...serverKeys("cmd-k d", "cmd-i"), ["cmd-p", "files"], ["cmd-shift-f", "grep"]];

  if (markdown) list.splice(Math.min(list.length, 3), 0, view === "preview" ? ["e", "text"] : [vim ? "space m p" : "cmd-shift-v", "view"]);

  // The rendered view: the Markdown commands first, the arrows walk the blocks.
  if (markdown && view === "rendered") list.splice(0, 0, [vim ? "space ." : "cmd-.", "markdown"], ["enter", "new block"], ["↑↓", "blocks"]);
  else if (markdown && view !== "preview") list.splice(0, 0, [vim ? "space ." : "cmd-.", "markdown"]);

  return [...list, vim ? ["space ?", "keys"] : ["cmd-k ?", "keys"]];
}

/** What the keys entry lists (vim: the pane's vim is on), its own key last. */
export function editorKeys(vim: boolean): Hint[] {
  const app: Hint[] = [
    ["cmd-s", "save"],
    ["cmd-f", "find"],
    ["cmd-alt-f", "replace"],
    ["cmd-l ctrl-g", "go to line"],
    ["cmd-k n / p", "next / prev problem"],
    ["cmd-k m", "problems"],
    ["cmd-k d", "definition"],
    ["cmd-i", "hover"],
    ["ctrl-= ctrl--", "hover more / less"],
    ["cmd-r", "reload"],
    ["cmd-k v", "vim on / off"],
    ["cmd-k z", "word wrap on / off"],
    ["cmd-shift-v", "Markdown: rendered / split / preview / text"],
    ["cmd-.", "Markdown commands (then b i ` k h H l n t x q c r, 0-6; p an image file, v paste an image)"],
    ["cmd-v", "Markdown: a copied picture (a screenshot, a copied image file) saved beside the file, as an image block"],
    ["enter", "rendered: at a block's end, a new paragraph (shift-enter: a line break)"],
    ["cmd-k ] / [", "next / prev tab"],
    ["cmd-k shift-l / shift-h", "move tab right / left"],
    ["cmd-k o", "pop the tab out into its own pane"],
    ["cmd-k shift-o", "the tab into the editor beside"],
    ["cmd-k t", "the tab's menu (right-click a tab)"],
    ["cmd-k w", "close tab"],
    ["cmd-p", "files"],
    ["cmd-shift-f", "grep"],
  ];

  if (!vim) return [...app, ["cmd-k ?", "keys"]];

  return [
    ["hjkl w b e", "move"],
    ["i a o", "insert"],
    ["v V ctrl-v", "visual"],
    ["d c y p", "delete change yank put"],
    ["u ctrl-r", "undo / redo"],
    ["/ ? n N", "search"],
    [":w :q :wq", "save / close"],
    ["L H gt gT :bn :bp", "next / prev tab"],
    ["]B [B :tabm", "move tab right / left"],
    ["space b o :popout", "pop the tab out into its own pane"],
    ["space b i :popin", "the tab into the editor beside"],
    ["space b m", "the tab's menu"],
    [":bd :ls", "close / list tabs"],
    ["gd gr K", "definition, references, hover"],
    ["]d [d", "next / prev problem"],
    ["space f f", "files"],
    ["space f g", "grep"],
    ["space e", "files pane"],
    ["space b", "tabs"],
    ["space d", "problems"],
    ["space m p", "Markdown view"],
    ["space m r", "Markdown rendered"],
    ["space .", "Markdown commands"],
    ["space u w", "word wrap"],
    ...app.filter(([k]) => k.startsWith("cmd-s") || k.startsWith("cmd-k v") || k.startsWith("cmd-p")),
    ["space ?", "keys"],
  ];
}

/** How a project's environment stands, for a server that isn't there (envrc.ts's kinds). */
export type EnvKind = "blocked" | "no-direnv" | "failed" | "ready";

/** What the project's .envrc said, beside a server's state (none without an .envrc). */
export interface EnvNote {
  readonly envrc?: string;
  readonly envKind?: EnvKind;
  readonly envNote?: string | null;
  readonly denied?: boolean;
}

/** What a server answers it can do (lspStart's capabilities): how it takes changes. */
export const isServerCaps = object({}, { textDocumentSync: oneOf(isNumber, object({}, { change: isNumber })) });

export type ServerCaps = Guarded<typeof isServerCaps>;

/** A tab's language server (main.ts startServer): none (and why), its environment
 *  loading, starting, ready (its herdr session `id`), or stopped. */
export type ServerState =
  | { readonly status: "none"; readonly why: "remote" | "off" | "unknown" }
  | (EnvNote & { readonly status: "none"; readonly why: "missing"; readonly names: readonly string[] })
  | { readonly status: "env"; readonly envrc: string; readonly names: readonly string[] }
  | (EnvNote & { readonly status: "starting"; readonly argv: readonly string[]; readonly root: string; readonly name: string })
  | (EnvNote & { readonly status: "ready"; readonly argv: readonly string[]; readonly root: string; readonly name: string; readonly id: number; readonly caps: ServerCaps })
  | (EnvNote & { readonly status: "exited"; readonly name: string; readonly note: string });

/** What serverNote says: the bar's word, the card's sentence and what to do. */
export interface ServerNote {
  readonly short: string;
  readonly text: string;
  readonly fix: string | null;
}

/** What else serverNote takes: `empty` (a ready server had nothing), paths as ~. */
export interface ServerNoteOptions {
  readonly empty?: boolean;
  readonly tilde?: (path: string) => string;
}

/**
 * What a hover asked for (cmd-i) says when no server answers, and the bar's
 * word for it: what is the case and, where there is one, what to do.
 * `server`: the editor's (main.ts startServer). `lang`: the file's language
 * id. `{ short, text, fix }` (fix may be null), or null while a server runs
 * (nothing to explain; `empty` asks for "it has nothing here").
 */
export function serverNote(server: ServerState | null | undefined, lang: string, { empty = false, tilde: t = (p) => p }: ServerNoteOptions = {}): ServerNote | null {
  const s: ServerState = server ?? { status: "none", why: "unknown" };

  if (s.status === "ready") return empty ? { short: s.name, text: `${s.name} has nothing for this place.`, fix: null } : null;

  if (s.status === "starting") return { short: `${s.name}…`, text: `${s.name} is starting.`, fix: "Ask again in a moment." };

  if (s.status === "env") return { short: "loading .envrc…", text: `Loading this project's environment (${t(s.envrc)}/.envrc); its language server starts when it's there.`, fix: "A flake's first load can take minutes; the editor works meanwhile." };

  if (s.status === "exited") return { short: `${s.name} stopped`, text: `${s.name} stopped${s.note ? `: ${s.note}` : "."}`, fix: "cmd-r reloads the file and starts it again." };

  if (s.why === "remote") return { short: "", text: "Files on another machine open without a language server.", fix: null };

  if (s.why === "off") return { short: "no server", text: `The language server is off for ${lang} files (settings.json).`, fix: `Remove "server": false from editor.languages.${lang} to turn it on.` };

  const names = s.why === "missing" ? s.names.join(" or ") : "";

  if (s.why !== "missing" || !names) {
    return lang && lang !== "text"
      ? { short: "", text: `No language server is set up for ${lang} files.`, fix: `settings.json: editor.languages.${lang}.server, its argv, adds one.` }
      : { short: "", text: "Plain text: no language server.", fix: null };
  }

  // why "missing": not on PATH, and the project's environment (if any) as it is.
  const where = s.envrc === undefined ? null : t(s.envrc);

  if (s.envKind === "blocked") {
    return { short: "direnv allow", text: `${where}/.envrc isn't allowed${s.denied ? " (denied)" : ""}, so its environment isn't loaded, and ${names} isn't on PATH.`, fix: `Run \`direnv allow\` in ${where}.` };
  }

  if (s.envKind === "no-direnv") {
    return { short: "no direnv", text: `${where} has an .envrc, but direnv isn't installed, so its environment isn't loaded; ${names} isn't on PATH.`, fix: "Install direnv, or put the server on PATH." };
  }

  if (s.envKind === "failed") {
    return { short: ".envrc failed", text: `${where}/.envrc didn't load${s.envNote ? `: ${s.envNote}` : "."} ${names} isn't on PATH.`, fix: `Run \`direnv reload\` in ${where} to see why.` };
  }

  if (s.envKind === "ready") {
    return { short: "no server", text: `${names} isn't in this project's environment (${where}/.envrc) or on PATH.`, fix: `Add it to the project's shell (its flake or .envrc), or settings.json editor.languages.${lang}.server.` };
  }

  return { short: "no server", text: `${names} isn't on PATH.`, fix: `Install it, or add it to the project's shell through an .envrc (direnv), or settings.json editor.languages.${lang}.server.` };
}

/** A box on screen: the word a card is about (unzoomed px). */
export interface Anchor {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** What else cardPlace takes: the bars it stays clear of, its margin and its gap to the word. */
export interface CardPlaceOptions {
  readonly top?: number;
  readonly bottom?: number;
  readonly margin?: number;
  readonly gap?: number;
}

/** Where the card goes: hanging from `top` (under the word) or standing on `bottom` (above). */
export type CardPlace =
  | { readonly left: number; readonly width: number; readonly top: number; readonly bottom: null; readonly maxH: number; readonly above: false }
  | { readonly left: number; readonly width: number; readonly top: null; readonly bottom: number; readonly maxH: number; readonly above: true };

/**
 * Where the hover card goes (pane coordinates, unzoomed px): under the word
 * when a card of full size (half the pane) fits there, else above it if
 * there's more room above; left-aligned with the word, slid in to stay inside
 * the pane; never over the word. The side never waits on the card's height:
 * under, it hangs from the line's bottom; above, it stands on the line's top
 * by its bottom edge. So its first frame is its place, and a card that fills
 * in or grows only grows away from its word (scrolling past its limit).
 * `anchor` { x, y, w, h }: the word. `pane` { width, height }. `card`
 * { width }. `top` / `bottom`: the bars it stays clear of.
 * Returns { left, width, top | bottom (the other null), maxH, above }.
 */
export function cardPlace(anchor: Anchor, pane: { readonly width: number; readonly height: number }, card: { readonly width: number }, { top = 0, bottom = 0, margin = 8, gap = 2 }: CardPlaceOptions = {}): CardPlace {
  const width = Math.max(120, Math.min(card.width, pane.width - 2 * margin));
  const left = Math.max(margin, Math.min(anchor.x, pane.width - width - margin));
  const under = anchor.y + anchor.h + gap;
  const over = anchor.y - gap;
  const roomBelow = pane.height - bottom - margin - under;
  const roomAbove = over - top - margin;
  // At most about half the pane (as Zed's popovers): a long answer scrolls
  // rather than covering the text it's about.
  const cap = Math.max(72, Math.round(pane.height / 2));
  const above = roomBelow < cap && roomAbove > roomBelow;

  return above
    ? { left, width, top: null, bottom: pane.height - over, maxH: Math.max(48, Math.min(cap, roomAbove)), above }
    : { left, width, top: under, bottom: null, maxH: Math.max(48, Math.min(cap, roomBelow)), above };
}

/** A place in a server's text (LSP's). */
export interface LspPosition {
  readonly line: number;
  readonly character: number;
}

/** One ranged change for textDocument/didChange. */
export interface RangedChange {
  readonly range: { readonly start: LspPosition; readonly end: LspPosition };
  readonly text: string;
}

/** One LSP change from the text the server has (`from`) to the editor's
 *  (`to`): the span between their common start and end, in LSP positions
 *  (UTF-16, as JavaScript strings count). Null when they're the same. */
export function changeBetween(from: string, to: string): RangedChange | null {
  if (from === to) return null;

  let s = 0;

  while (s < from.length && s < to.length && from[s] === to[s]) s++;

  let e = 0;

  while (e < from.length - s && e < to.length - s && from[from.length - 1 - e] === to[to.length - 1 - e]) e++;

  const pos = (text: string, o: number): LspPosition => {
    const before = text.slice(0, o);
    const nl = before.lastIndexOf("\n");
    let line = 0;

    for (let i = before.indexOf("\n"); i >= 0; i = before.indexOf("\n", i + 1)) line++;

    return { line, character: o - (nl + 1) };
  };

  return { range: { start: pos(from, s), end: pos(from, from.length - e) }, text: to.slice(s, to.length - e) };
}

/** Whether a server takes ranged changes (LSP's incremental sync, 2). */
export function incremental(caps: ServerCaps | null | undefined): boolean {
  const sync = caps?.textDocumentSync;

  return (isNumber(sync) ? sync : sync?.change) === 2;
}

/** A hover's Markdown for the card: headings (rust-analyzer's "# Examples",
 *  "# Errors") as bold lines, so docs read as one card, not a page. */
export function cardMarkdown(text: string | null | undefined): string {
  return (text ?? "").replace(/^#{1,6}[ \t]+(.+?)[ \t#]*$/gm, "**$1**");
}

/** keys.json's other names for a modifier. */
const MODIFIER_ALIAS: ReadonlyMap<string, string> = new Map([
  ["command", "cmd"],
  ["super", "cmd"],
  ["secondary", "cmd"],
  ["platform", "cmd"],
  ["control", "ctrl"],
  ["option", "alt"],
  ["function", "fn"],
]);

const MODIFIER_ORDER = ["cmd", "ctrl", "alt", "shift", "fn"];

/** A chord's one spelling: its modifiers sorted (cmd, ctrl, alt, shift, fn;
 *  keys.json's aliases too), then its key. "alt-cmd-up" and "cmd-alt-up" are
 *  the same chord. */
export function chordOf(spec: string | null | undefined): string {
  const s = (spec ?? "").trim().toLowerCase();
  const minus = s.endsWith("--") || s === "-";
  const parts = minus ? [...s.slice(0, s.length - 2).split("-").filter(Boolean), "-"] : s.split("-");
  const key = parts.pop() ?? "";
  const mods = [...new Set(parts.map((m) => MODIFIER_ALIAS.get(m) ?? m))].sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));

  return [...mods, key].join("-");
}

/** A key binding as herdr's keys() lists it. */
export type KeyBinding = ReturnType<typeof keys>[number];

/** A command a key runs, and its arguments (an object binding's). */
export interface Bound {
  readonly command: string;
  readonly args?: JsonObject;
}

/** An object binding's action text: `{"command", "args"}`. */
const isObjectBinding = object({ command: isString }, { args: isJsonObject });

/**
 * The app's single-chord keys that apply where an editor sits, by chord:
 * keys.json's `global` section under the layout's (`layout:<layout>`), less
 * every chord the mod's own section uses (its keys stay its: cmd-s saves),
 * the first chord of its two-chord keys included (cmd-k of cmd-k d). Values
 * `{ command, args? }`: "pane.go:up" runs as such; an object binding
 * (`{"command", "args"}`, a JSON string in keys()) with its arguments.
 */
export function appBindings(list: readonly KeyBinding[] | null | undefined, mod: string, layout: string): Map<string, Bound> {
  const own = new Set<string>();

  for (const b of list ?? []) if (b.section === `mod:${mod}`) own.add(chordOf(b.keys.split(" ")[0]));

  const out = new Map<string, Bound>();

  for (const section of ["global", `layout:${layout}`]) {
    for (const b of list ?? []) {
      if (b.section !== section || b.keys.trim().includes(" ")) continue;

      const chord = chordOf(b.keys);

      if (own.has(chord) || !b.action) continue;

      if (!b.action.startsWith("{")) {
        out.set(chord, { command: b.action });
        continue;
      }

      const o = parseJson(b.action, isObjectBinding);

      if (o?.command) out.set(chord, o.args === undefined ? { command: o.command } : { command: o.command, args: o.args });
    }
  }

  return out;
}
