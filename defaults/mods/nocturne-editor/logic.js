// The editor's decisions, as plain functions (no app calls), so
// scripts/nocturne-editor.test.ts can check them: what a language's settings
// come to, which language server to run and where its workspace is, how a
// server's diagnostics become line notes and the problems list, what a hover
// says, and where "go to line" goes.

/** rust-analyzer's settings (its initializationOptions; workspace/configuration). */
export const RUST_ANALYZER = { cargo: { targetDir: true } };

/** Built-in language servers, tried in order: the first found on PATH runs.
 *  `settings` go out as initializationOptions and workspace/configuration. */
export const SERVERS = {
  // Its own target folder (target/rust-analyzer): its build scripts, proc
  // macros and `cargo check` never wait on a `cargo build` for the lock, nor
  // rebuild what the build made with another environment (the dev shell's).
  rust: [{ argv: ["rust-analyzer"], settings: RUST_ANALYZER }],
  typescript: [{ argv: ["typescript-language-server", "--stdio"], settings: { supportsHoverVerbosity: true } }, { argv: ["vtsls", "--stdio"] }],
  tsx: "typescript",
  javascript: "typescript",
  python: [{ argv: ["basedpyright-langserver", "--stdio"] }, { argv: ["pyright-langserver", "--stdio"] }, { argv: ["pylsp"] }],
  go: [{ argv: ["gopls"] }],
  nix: [{ argv: ["nixd"] }, { argv: ["nil"] }],
  lua: [{ argv: ["lua-language-server"] }],
  bash: [{ argv: ["bash-language-server", "start"] }],
  json: [{ argv: ["vscode-json-language-server", "--stdio"], settings: { provideFormatter: true, json: { validate: { enable: true } } } }],
  yaml: [{ argv: ["yaml-language-server", "--stdio"], settings: { yaml: { validate: true, schemaStore: { enable: true } } } }],
  toml: [{ argv: ["taplo", "lsp", "stdio"] }],
  markdown: [{ argv: ["marksman", "server"] }],
  css: [{ argv: ["vscode-css-language-server", "--stdio"], settings: { provideFormatter: true } }],
  html: [{ argv: ["vscode-html-language-server", "--stdio"], settings: { provideFormatter: true } }],
  c: [{ argv: ["clangd"] }],
  zig: [{ argv: ["zls"] }],
};

/** What marks a language's workspace root, nearest first; `outermost`: the
 *  highest such folder inside the repository (a Cargo workspace). */
export const ROOTS = {
  rust: { markers: ["Cargo.toml"], outermost: true },
  typescript: { markers: ["tsconfig.json", "jsconfig.json", "package.json"] },
  tsx: { markers: ["tsconfig.json", "jsconfig.json", "package.json"] },
  javascript: { markers: ["jsconfig.json", "tsconfig.json", "package.json"] },
  python: { markers: ["pyproject.toml", "pyrightconfig.json", "setup.py", "setup.cfg", "requirements.txt"] },
  go: { markers: ["go.work", "go.mod"] },
  nix: { markers: ["flake.nix"] },
  lua: { markers: [".luarc.json", ".luarc.jsonc"] },
  c: { markers: ["compile_commands.json", "CMakeLists.txt", "Makefile"] },
  zig: { markers: ["build.zig"] },
};

/** LSP's languageId for a language id and path. */
export function languageId(lang, path = "") {
  const ext = (path.match(/\.([^./]+)$/)?.[1] ?? "").toLowerCase();
  if (lang === "tsx") return "typescriptreact";
  if (lang === "javascript" && ext === "jsx") return "javascriptreact";
  if (lang === "bash") return "shellscript";
  if (lang === "json" && (ext === "jsonc" || /(^|\/)(tsconfig|jsconfig)[^/]*\.json$/.test(path))) return "jsonc";
  if (lang === "c" && ["cc", "cpp", "cxx", "hpp", "hh"].includes(ext)) return "cpp";
  if (lang === "c" && ["m", "mm"].includes(ext)) return "objective-c";
  return lang || "plaintext";
}

const DEFAULTS = { tab_size: 4, insert_spaces: true, soft_wrap: false, format_on_save: false };
/** Indentation people expect where a language has a convention. */
const LANGUAGE_DEFAULTS = {
  javascript: { tab_size: 2 }, typescript: { tab_size: 2 }, tsx: { tab_size: 2 }, json: { tab_size: 2 }, yaml: { tab_size: 2 },
  nix: { tab_size: 2 }, lua: { tab_size: 2 }, html: { tab_size: 2 }, css: { tab_size: 2 }, markdown: { tab_size: 2, soft_wrap: true },
  go: { insert_spaces: false }, text: { soft_wrap: true },
};

/** A language's settings: settings.json's `editor.languages[lang]`, over its
 *  top level, over the language's convention, over the editor's defaults. */
export function languageSettings(editor, lang) {
  const top = { ...(editor ?? {}) };
  delete top.languages;
  const own = editor?.languages?.[lang] ?? {};
  const out = { ...DEFAULTS, ...(LANGUAGE_DEFAULTS[lang] ?? {}) };
  for (const [k, v] of [...Object.entries(top), ...Object.entries(own)]) if (v !== undefined && v !== null) out[k] = v;
  out.tab_size = Math.min(16, Math.max(1, Number(out.tab_size) || DEFAULTS.tab_size));
  return out;
}

/** The servers to try for a language: settings.json's `server` (an argv, or
 *  false for none), else the built-in list. */
export function serverCandidates(lang, settings) {
  if (settings?.server === false) return [];
  const extra = settings?.server_settings ?? null;
  let list = SERVERS[lang];
  if (typeof list === "string") list = SERVERS[list];
  list = list ?? [];
  if (Array.isArray(settings?.server) && settings.server.length) {
    // Another build of a built-in server (a path, a wrapper) keeps its settings.
    const name = (a) => String(a ?? "").split("/").pop();
    const same = list.find((s) => name(s.argv[0]) === name(settings.server[0]));
    return [{ argv: settings.server, settings: merge(same?.settings ?? null, extra) }];
  }
  return list.map((s) => ({ argv: s.argv, settings: merge(s.settings ?? null, extra) }));
}

function merge(a, b) {
  if (b == null) return a;
  if (a == null || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) || Array.isArray(b)) return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = merge(a[k], v);
  return out;
}

/** A shell script that prints, one per line, every folder from `dir` up to /
 *  holding one of `markers`, then `git <root>` for the repository's top. */
export function rootScript(markers) {
  const tests = markers.map((m) => `[ -e "$d/${m.replace(/"/g, "")}" ]`).join(" || ");
  return `d="$1"; while :; do if ${tests || "false"}; then echo "$d"; fi; [ "$d" = / ] && break; d=$(dirname "$d"); done; echo "git $(git -C "$1" rev-parse --show-toplevel 2>/dev/null)"`;
}

/** The workspace root from rootScript's output: the nearest marked folder
 *  (outermost: the highest inside the repository), else the repository, else
 *  the file's folder. */
export function pickRoot(lang, output, dir) {
  const lines = String(output ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const isGit = (l) => l === "git" || l.startsWith("git ");
  const git = lines.find(isGit)?.slice(3).trim() || null;
  const marked = lines.filter((l) => !isGit(l));
  const inside = git ? marked.filter((d) => d === git || d.startsWith(git + "/")) : marked;
  if (ROOTS[lang]?.outermost && inside.length) return inside[inside.length - 1];
  return marked[0] ?? git ?? dir;
}

/** `file://` URI for a path, as LSP servers expect (percent-encoded). */
export function uri(path) {
  return "file://" + encodeURI(path).replace(/[?#]/g, encodeURIComponent);
}

/** The path a `file://` URI names. */
export function pathOf(u) {
  if (!String(u).startsWith("file://")) return null;
  try { return decodeURIComponent(String(u).slice(7).replace(/^localhost/, "")); } catch { return null; }
}

const SEVERITY = { 1: "error", 2: "warning", 3: "info", 4: "hint" };
const RANK = { error: 0, warning: 1, info: 2, hint: 3 };

/** A server's diagnostics for the editor: `{ line, col, end_line, end_col,
 *  severity, message, code, source }`, most severe and earliest first. */
export function diagnostics(list) {
  return (list ?? []).map((d) => ({
    line: d.range?.start?.line ?? 0,
    col: d.range?.start?.character ?? 0,
    end_line: d.range?.end?.line ?? d.range?.start?.line ?? 0,
    end_col: d.range?.end?.character ?? (d.range?.start?.character ?? 0) + 1,
    severity: SEVERITY[d.severity] ?? "error",
    message: String(d.message ?? ""),
    code: d.code == null ? null : String(typeof d.code === "object" ? d.code.value ?? "" : d.code),
    source: d.source ?? null,
    related: (d.relatedInformation ?? []).map((r) => ({ path: pathOf(r.location?.uri), line: r.location?.range?.start?.line ?? 0, message: r.message })),
  })).sort((a, b) => a.line - b.line || a.col - b.col || RANK[a.severity] - RANK[b.severity]);
}

/** The worst severity on each line, with the first line of its first message:
 *  what the editor draws after the line and in its gutter. */
export function lineNotes(list, colors) {
  const byLine = new Map();
  for (const d of list) {
    const was = byLine.get(d.line);
    if (!was || RANK[d.severity] < RANK[was.severity]) byLine.set(d.line, d);
  }
  return [...byLine.values()].map((d) => ({
    line: d.line,
    text: firstLine(d.message, 120),
    color: colors[d.severity] ?? colors.hint,
    mark: colors[d.severity] ?? colors.hint,
  }));
}

/** A message's first line, shortened to `max` characters. */
export function firstLine(message, max = 120) {
  const line = String(message ?? "").split("\n").find((l) => l.trim()) ?? "";
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

/** How many of each severity. */
export function counts(list) {
  const out = { error: 0, warning: 0, info: 0, hint: 0 };
  for (const d of list) out[d.severity] = (out[d.severity] ?? 0) + 1;
  return out;
}

/** The diagnostics covering a place (zero-based line and column). */
export function diagnosticsAt(list, line, col) {
  return list.filter((d) => {
    if (line < d.line || line > d.end_line) return false;
    if (line === d.line && col < d.col) return false;
    if (line === d.end_line && col > Math.max(d.end_col, d.col + 1)) return false;
    return true;
  });
}

/** The next (dir 1) or previous (-1) problem from a place, wrapping around.
 *  Hints (rustc's "expected due to this" beside its error) are stepped over
 *  while there are real problems. */
export function nextProblem(list, line, col, dir = 1) {
  if (list.some((d) => d.severity !== "hint")) list = list.filter((d) => d.severity !== "hint");
  if (!list.length) return null;
  const key = (d) => d.line * 1e6 + d.col;
  const at = line * 1e6 + col;
  const sorted = [...list].sort((a, b) => key(a) - key(b));
  if (dir > 0) return sorted.find((d) => key(d) > at) ?? sorted[0];
  return [...sorted].reverse().find((d) => key(d) < at) ?? sorted[sorted.length - 1];
}

/** A hover's contents as parts: `{ code, lang }` blocks and `{ text }`
 *  paragraphs (markdown), in order. */
export function hoverParts(contents) {
  const pieces = [];
  const add = (c) => {
    if (c == null) return;
    if (typeof c === "string") pieces.push(...splitMarkdown(c));
    else if (Array.isArray(c)) c.forEach(add);
    else if (c.kind === "markdown") pieces.push(...splitMarkdown(c.value ?? ""));
    else if (c.kind === "plaintext") pieces.push({ text: String(c.value ?? "") });
    else if (c.language != null) pieces.push({ code: String(c.value ?? ""), lang: c.language });
    else if (c.value != null) pieces.push(...splitMarkdown(String(c.value)));
  };
  add(contents);
  return pieces.filter((p) => (p.code ?? p.text ?? "").trim());
}

/** Markdown split into fenced code blocks and the text between them. */
export function splitMarkdown(md) {
  const out = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let at = 0, m;
  while ((m = re.exec(md))) {
    const before = md.slice(at, m.index).trim();
    if (before) out.push({ text: before });
    out.push({ code: m[2].replace(/\n$/, ""), lang: m[1].trim() || null });
    at = re.lastIndex;
  }
  const rest = md.slice(at).trim();
  if (rest) out.push({ text: rest.replace(/^---+$/gm, "").trim() });
  return out.filter((p) => (p.code ?? p.text).trim());
}

/** "42", "42:7", ":42", "42,7": one-based line and column; null otherwise. */
export function parseGoto(s) {
  const m = String(s ?? "").trim().match(/^:?(\d+)(?:[:,.](\d+))?$/);
  if (!m) return null;
  return { line: Math.max(1, Number(m[1])), col: Math.max(1, Number(m[2] ?? 1)) };
}

/** A location from a definition answer (Location, LocationLink, or a list):
 *  `{ path, line, col }`, zero-based. */
export function firstLocation(result) {
  const l = Array.isArray(result) ? result[0] : result;
  if (!l) return null;
  const u = l.targetUri ?? l.uri;
  const r = l.targetSelectionRange ?? l.targetRange ?? l.range;
  const path = pathOf(u);
  return path ? { path, line: r?.start?.line ?? 0, col: r?.start?.character ?? 0 } : null;
}

/** "~/x" for paths under home. */
export function tilde(path, home) {
  return home && (path === home || path.startsWith(home + "/")) ? "~" + path.slice(home.length) : path;
}
export const dirname = (p) => (p.lastIndexOf("/") > 0 ? p.slice(0, p.lastIndexOf("/")) : "/");
export const basename = (p) => p.slice(p.lastIndexOf("/") + 1);

/** The moonfly roles (moonfly.vim's groups) a capture name colors with, from
 *  the theme's palette: `{ keyword: "#cf87e8", ... }` for EditorState's
 *  `syntax` and the hover's code. */
export function syntaxColors(t) {
  return {
    keyword: t.ansi5, "keyword.operator": t.ansi9, conditional: t.ansi5, repeat: t.ansi5, include: t.ansi5,
    function: t.ansi12, "function.builtin": t.ansi4, "function.macro": t.ansi13, constructor: t.ansi10,
    type: t.ansi10, "type.builtin": t.ansi10, tag: t.ansi10, attribute: t.ansi13, namespace: t.ansi6, module: t.ansi6,
    string: t.ansi11, "string.escape": t.ansi9, "string.special": t.ansi3, "string.regex": t.ansi3, character: t.ansi11, escape: t.ansi9,
    number: t.ansi3, float: t.ansi3, boolean: t.ansi3, constant: t.ansi3, "constant.builtin": t.ansi3,
    comment: t.ansi8, "comment.documentation": t.ansi8,
    property: t.ansi6, field: t.ansi6, label: t.ansi3, operator: t.ansi9,
    "variable.builtin": t.ansi4, "variable.parameter": t.foreground, embedded: t.foreground,
    "text.title": t.ansi4, "text.literal": t.ansi11, "text.uri": t.ansi6, "text.reference": t.ansi12, "text.emphasis": t.ansi5, "text.strong": t.ansi5,
    "punctuation.special": t.ansi9,
  };
}

/** The color for a capture name: its own, else its root's, else none. */
export function colorOf(colors, name) {
  if (colors[name]) return colors[name];
  const parts = name.split(".");
  for (let i = parts.length - 1; i > 0; i--) {
    const c = colors[parts.slice(0, i).join(".")];
    if (c) return c;
  }
  return null;
}

/** `text` cut into `[piece, color|null]` by highlight spans `[start, end, name]`. */
export function colorRuns(text, spans, colors) {
  const out = [];
  let at = 0;
  for (const [s, e, name] of spans ?? []) {
    if (s > at) out.push([text.slice(at, s), null]);
    if (e > s) out.push([text.slice(s, e), colorOf(colors, name)]);
    at = Math.max(at, e);
  }
  if (at < text.length) out.push([text.slice(at), null]);
  return out;
}

/** The hint bar along the editor's foot: { mode (find / replace / line, or
 *  null), vim (on), vimMode, server (a language server answers), markdown,
 *  view (split / preview / text) }. The keys entry ends it: space ? in vim's
 *  normal mode, cmd-k ? otherwise; a find or go-to-line prompt keeps its own. */
export function hintList({ mode = null, vim = false, vimMode = "normal", server = false, markdown = false, view = "split" } = {}) {
  if (mode === "line") return [["enter", "go"], ["esc", "close"]];
  if (mode) return [["enter", "next"], ["shift-enter", "prev"], ...(mode === "replace" ? [["cmd-enter", "replace all"]] : []), ["esc", "close"]];
  if (vim && vimMode === "insert") return [["esc", "normal"], ["cmd-s", "save"], ["cmd-p", "files"], ["cmd-k ?", "keys"]];
  const list = vim
    ? [[":", "ex"], ["space", "leader"], ["/", "search"], ["]d", "problem"], ...(server ? [["gd", "definition"], ["K", "hover"]] : []), ["cmd-p", "files"], ["cmd-shift-f", "grep"]]
    : [["cmd-s", "save"], ["cmd-f", "find"], ["cmd-l", "line"], ["cmd-k n", "problem"], ...(server ? [["cmd-k d", "definition"], ["cmd-i", "hover"]] : []), ["cmd-p", "files"], ["cmd-shift-f", "grep"]];
  if (markdown) list.splice(Math.min(list.length, 3), 0, view === "preview" ? ["e", "text"] : [vim ? "space m p" : "cmd-shift-v", "view"]);
  // The rendered view: the Markdown commands first, the arrows walk the blocks.
  if (markdown && view === "rendered") list.splice(0, 0, [vim ? "space ." : "cmd-.", "markdown"], ["enter", "new block"], ["↑↓", "blocks"]);
  else if (markdown && view !== "preview") list.splice(0, 0, [vim ? "space ." : "cmd-.", "markdown"]);
  return [...list, vim ? ["space ?", "keys"] : ["cmd-k ?", "keys"]];
}

/** What the keys entry lists (vim: the pane's vim is on), its own key last. */
export function editorKeys(vim) {
  const app = [["cmd-s", "save"], ["cmd-f", "find"], ["cmd-alt-f", "replace"], ["cmd-l ctrl-g", "go to line"], ["cmd-k n / p", "next / prev problem"],
    ["cmd-k m", "problems"], ["cmd-k d", "definition"], ["cmd-i", "hover"], ["ctrl-= ctrl--", "hover more / less"], ["cmd-r", "reload"],
    ["cmd-k v", "vim on / off"], ["cmd-k z", "word wrap on / off"], ["cmd-shift-v", "Markdown: rendered / split / preview / text"], ["cmd-.", "Markdown commands (then b i ` k h H l n t x q c r, 0-6)"], ["enter", "rendered: at a block's end, a new paragraph (shift-enter: a line break)"], ["cmd-k ] / [", "next / prev tab"], ["cmd-k w", "close tab"],
    ["cmd-p", "files"], ["cmd-shift-f", "grep"]];
  if (!vim) return [...app, ["cmd-k ?", "keys"]];
  return [["hjkl w b e", "move"], ["i a o", "insert"], ["v V ctrl-v", "visual"], ["d c y p", "delete change yank put"], ["u ctrl-r", "undo / redo"],
    ["/ ? n N", "search"], [":w :q :wq", "save / close"], ["gt gT :bn :bp", "next / prev tab"], [":bd :ls", "close / list tabs"], ["gd gr K", "definition, references, hover"], ["]d [d", "next / prev problem"],
    ["space f f", "files"], ["space f g", "grep"], ["space e", "files pane"], ["space b", "tabs"], ["space d", "problems"], ["space m p", "Markdown view"], ["space m r", "Markdown rendered"], ["space .", "Markdown commands"], ["space u w", "word wrap"],
    ...app.filter(([k]) => k.startsWith("cmd-s") || k.startsWith("cmd-k v") || k.startsWith("cmd-p")), ["space ?", "keys"]];
}

/**
 * What a hover asked for (cmd-i) says when no server answers, and the bar's
 * word for it: what is the case and, where there is one, what to do.
 * `server`: the editor's (main.js startServer). `lang`: the file's language
 * id. `{ short, text, fix }` (fix may be null), or null while a server runs
 * (nothing to explain; `empty` asks for "it has nothing here").
 */
export function serverNote(server, lang, { empty = false, tilde: t = (p) => p } = {}) {
  const s = server ?? { status: "none", why: "unknown" };
  const names = (s.names ?? []).join(" or ");
  const where = s.envrc ? t(s.envrc) : null;
  if (s.status === "ready") {
    return empty ? { short: s.name, text: `${s.name} has nothing for this place.`, fix: null } : null;
  }
  if (s.status === "starting") return { short: `${s.name}…`, text: `${s.name} is starting.`, fix: "Ask again in a moment." };
  if (s.status === "env") return { short: "loading .envrc…", text: `Loading this project's environment (${t(s.envrc)}/.envrc); its language server starts when it's there.`, fix: "A flake's first load can take minutes; the editor works meanwhile." };
  if (s.status === "exited") return { short: `${s.name ?? "server"} stopped`, text: `${s.name ?? "The language server"} stopped${s.note ? `: ${s.note}` : "."}`, fix: "cmd-r reloads the file and starts it again." };
  if (s.why === "remote") return { short: "", text: "Files on another machine open without a language server.", fix: null };
  if (s.why === "off") return { short: "no server", text: `The language server is off for ${lang} files (settings.json).`, fix: `Remove "server": false from editor.languages.${lang} to turn it on.` };
  if (s.why === "unknown" || !names) {
    return lang && lang !== "text"
      ? { short: "", text: `No language server is set up for ${lang} files.`, fix: `settings.json: editor.languages.${lang}.server, its argv, adds one.` }
      : { short: "", text: "Plain text: no language server.", fix: null };
  }
  // why "missing": not on PATH, and the project's environment (if any) as it is.
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
export function cardPlace(anchor, pane, card, { top = 0, bottom = 0, margin = 8, gap = 2 } = {}) {
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

// Work a server reports that its answers wait on (rust-analyzer: the
// workspace's loading and indexing); a `cargo check` running doesn't hold
// hovers back.
const BACKGROUND_WORK = /\b(cargo check|check|clippy|flycheck)\b/i;
// The most telling of several at once, first.
const WORK_ORDER = [/index/i, /proc-?macro/i, /build/i, /load/i, /fetch/i, /roots/i];

/** Open `$/progress` work ({ title, message, percentage } by token) that
 *  answers wait on: true while the server isn't ready to say much. */
export function busy(progress) {
  return [...(progress?.values?.() ?? [])].some((p) => !BACKGROUND_WORK.test(p.title ?? ""));
}

/** The bar's words for a server's work under way: "indexing 120/340",
 *  "building compile-time-deps 40%"; null with nothing under way. The work
 *  answers wait on first, then the rest (cargo check). */
export function progressWord(progress) {
  const all = [...(progress?.values?.() ?? [])];
  if (!all.length) return null;
  const rank = (p) => {
    if (BACKGROUND_WORK.test(p.title ?? "")) return WORK_ORDER.length + 1;
    const i = WORK_ORDER.findIndex((re) => re.test(p.title ?? ""));
    return i < 0 ? WORK_ORDER.length : i;
  };
  const p = all.sort((a, b) => rank(a) - rank(b))[0];
  const title = String(p.title ?? "working").toLowerCase().replace(/\s+/g, " ").trim();
  const count = String(p.message ?? "").match(/\b(\d+\/\d+)\b/)?.[1];
  const tail = count ?? (Number.isFinite(p.percentage) ? `${Math.round(p.percentage)}%` : "");
  const word = tail ? `${title} ${tail}` : `${title}…`;
  return word.length > 34 ? word.slice(0, 33) + "…" : word;
}

/** One LSP change from the text the server has (`from`) to the editor's
 *  (`to`): the span between their common start and end, in LSP positions
 *  (UTF-16, as JavaScript strings count). Null when they're the same. */
export function changeBetween(from, to) {
  if (from === to) return null;
  let s = 0;
  while (s < from.length && s < to.length && from[s] === to[s]) s++;
  let e = 0;
  while (e < from.length - s && e < to.length - s && from[from.length - 1 - e] === to[to.length - 1 - e]) e++;
  const pos = (text, o) => {
    const before = text.slice(0, o);
    const nl = before.lastIndexOf("\n");
    let line = 0;
    for (let i = before.indexOf("\n"); i >= 0; i = before.indexOf("\n", i + 1)) line++;
    return { line, character: o - (nl + 1) };
  };
  return { range: { start: pos(from, s), end: pos(from, from.length - e) }, text: to.slice(s, to.length - e) };
}

/** Whether a server takes ranged changes (LSP's incremental sync, 2). */
export function incremental(caps) {
  const sync = caps?.textDocumentSync;
  return (typeof sync === "number" ? sync : sync?.change) === 2;
}

/** A hover's Markdown for the card: headings (rust-analyzer's "# Examples",
 *  "# Errors") as bold lines, so docs read as one card, not a page. */
export function cardMarkdown(text) {
  return String(text ?? "").replace(/^#{1,6}[ \t]+(.+?)[ \t#]*$/gm, "**$1**");
}

/** A chord's one spelling: its modifiers sorted (cmd, ctrl, alt, shift, fn;
 *  keys.json's aliases too), then its key. "alt-cmd-up" and "cmd-alt-up" are
 *  the same chord. */
export function chordOf(spec) {
  const s = String(spec ?? "").trim().toLowerCase();
  const minus = s.endsWith("--") || s === "-";
  const parts = minus ? [...s.slice(0, s.length - 2).split("-").filter(Boolean), "-"] : s.split("-");
  const key = parts.pop() ?? "";
  const alias = { command: "cmd", super: "cmd", secondary: "cmd", platform: "cmd", control: "ctrl", option: "alt", function: "fn" };
  const order = ["cmd", "ctrl", "alt", "shift", "fn"];
  const mods = [...new Set(parts.map((m) => alias[m] ?? m))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...mods, key].join("-");
}

/**
 * The app's single-chord keys that apply where an editor sits, by chord:
 * keys.json's `global` section under the layout's (`layout:<layout>`), less
 * every chord the mod's own section uses (its keys stay its: cmd-s saves),
 * the first chord of its two-chord keys included (cmd-k of cmd-k d). Values
 * `{ command, args? }`: "pane.go:up" runs as such; an object binding
 * (`{"command", "args"}`, a JSON string in keys()) with its arguments.
 */
export function appBindings(list, mod, layout) {
  const own = new Set();
  for (const b of list ?? []) if (b.section === `mod:${mod}`) own.add(chordOf(String(b.keys).split(" ")[0]));
  const out = new Map();
  for (const section of ["global", `layout:${layout}`]) {
    for (const b of list ?? []) {
      if (b.section !== section || String(b.keys).trim().includes(" ")) continue;
      const chord = chordOf(b.keys);
      if (own.has(chord) || !b.action) continue;
      let bound = { command: b.action };
      if (b.action.startsWith("{")) {
        try { const o = JSON.parse(b.action); bound = o.args === undefined ? { command: o.command } : { command: o.command, args: o.args }; } catch { continue; }
      }
      if (bound.command) out.set(chord, bound);
    }
  }
  return out;
}
