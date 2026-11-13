// What a language server answers, proven where it comes in (its replies
// arrive as `unknown`: the guards here prove them where main.ts reads them)
// and what the editor makes of them: diagnostics as line notes and the
// problems list, a hover's parts, a definition's place, the work under way
// (`$/progress`) as the bar's word. Plain functions: scripts/editor.test.ts
// checks them.

import type { Color } from "gpui-kit";
import type { Guarded } from "./guard.ts";
import { arrayOf, isBoolean, isNull, isNumber, isString, literal, nullable, object, oneOf } from "./guard.ts";
import { isList } from "./guards.ts";
import { pathOf } from "./logic.ts";

/** A place in a server's text: zero-based line, UTF-16 character. */
export const isLspPosition = object({ line: isNumber, character: isNumber });

/** A range; servers send both ends, the start is what's read first. */
const isLspRange = object({ start: isLspPosition }, { end: isLspPosition });

const isRelated = object({ location: object({ uri: isString, range: isLspRange }), message: isString });

/** One of a server's diagnostics (textDocument/publishDiagnostics). */
export const isLspDiagnostic = object(
  { range: isLspRange, message: isString },
  {
    severity: isNumber,
    // A string or number; some servers send { value }.
    code: oneOf(isString, isNumber, object({}, { value: oneOf(isString, isNumber) })),
    source: isString,
    relatedInformation: arrayOf(isRelated),
  },
);

export type LspDiagnostic = Guarded<typeof isLspDiagnostic>;

/** publishDiagnostics' params: the file and its whole list (read entry by entry). */
export const isPublishedDiagnostics = object({ uri: isString, diagnostics: isList });

export type Severity = "error" | "warning" | "info" | "hint";

const SEVERITY: ReadonlyMap<number, Severity> = new Map<number, Severity>([
  [1, "error"],
  [2, "warning"],
  [3, "info"],
  [4, "hint"],
]);

const RANK = { error: 0, warning: 1, info: 2, hint: 3 } as const;

/** A color for each severity. */
export interface SeverityColors {
  readonly error: Color;
  readonly warning: Color;
  readonly info: Color;
  readonly hint: Color;
}

/** How many problems of each severity. */
export interface Counts {
  error: number;
  warning: number;
  info: number;
  hint: number;
}

/** A problem as the editor keeps it (zero-based places). */
export interface Problem {
  readonly line: number;
  readonly col: number;
  readonly end_line: number;
  readonly end_col: number;
  readonly severity: Severity;
  readonly message: string;
  readonly code: string | null;
  readonly source: string | null;
  readonly related: readonly { readonly path: string | null; readonly line: number; readonly message: string }[];
}

const codeText = (code: LspDiagnostic["code"]): string | null => {
  if (code === undefined) return null;

  if (isString(code) || isNumber(code)) return String(code);

  return String(code.value ?? "");
};

/** A server's diagnostics for the editor: `{ line, col, end_line, end_col,
 *  severity, message, code, source }`, most severe and earliest first. */
export function diagnostics(list: readonly LspDiagnostic[] | null | undefined): Problem[] {
  return (list ?? [])
    .map(
      (d): Problem => ({
        line: d.range.start.line,
        col: d.range.start.character,
        end_line: d.range.end?.line ?? d.range.start.line,
        end_col: d.range.end?.character ?? d.range.start.character + 1,
        severity: (d.severity === undefined ? undefined : SEVERITY.get(d.severity)) ?? "error",
        message: d.message,
        code: codeText(d.code),
        source: d.source ?? null,
        related: (d.relatedInformation ?? []).map((r) => ({ path: pathOf(r.location.uri), line: r.location.range.start.line, message: r.message })),
      }),
    )
    .sort((a, b) => a.line - b.line || a.col - b.col || RANK[a.severity] - RANK[b.severity]);
}

/** A line's note: drawn after the line's end and in its gutter. */
export interface LineNote {
  readonly line: number;
  readonly text: string;
  readonly color: Color;
  readonly mark: Color;
}

/** The worst severity on each line, with the first line of its first message:
 *  what the editor draws after the line and in its gutter. */
export function lineNotes(list: readonly Problem[], colors: SeverityColors): LineNote[] {
  const byLine = new Map<number, Problem>();

  for (const d of list) {
    const was = byLine.get(d.line);

    if (!was || RANK[d.severity] < RANK[was.severity]) byLine.set(d.line, d);
  }

  return [...byLine.values()].map((d) => ({
    line: d.line,
    text: firstLine(d.message, 120),
    color: colors[d.severity],
    mark: colors[d.severity],
  }));
}

/** A message's first line, shortened to `max` characters. */
export function firstLine(message: string, max = 120): string {
  const line = message.split("\n").find((l) => l.trim()) ?? "";

  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

/** How many of each severity. */
export function counts(list: readonly Problem[]): Counts {
  const out = { error: 0, warning: 0, info: 0, hint: 0 };

  for (const d of list) out[d.severity] += 1;

  return out;
}

/** The diagnostics covering a place (zero-based line and column). */
export function diagnosticsAt(list: readonly Problem[], line: number, col: number): Problem[] {
  return list.filter((d) => {
    if (line < d.line || line > d.end_line) return false;

    if (line === d.line && col < d.col) return false;

    return !(line === d.end_line && col > Math.max(d.end_col, d.col + 1));
  });
}

/** What nextProblem steps by: a place and how bad it is. */
type Placed = Pick<Problem, "line" | "col" | "severity">;

/** The next (dir 1) or previous (-1) problem from a place, wrapping around.
 *  Hints (rustc's "expected due to this" beside its error) are stepped over
 *  while there are real problems. */
export function nextProblem<P extends Placed>(all: readonly P[], line: number, col: number, dir = 1): P | null {
  const list = all.some((d) => d.severity !== "hint") ? all.filter((d) => d.severity !== "hint") : all;

  if (list.length === 0) return null;

  const key = (d: P): number => d.line * 1e6 + d.col;
  const at = line * 1e6 + col;
  const sorted = [...list].sort((a, b) => key(a) - key(b));

  if (dir > 0) return sorted.find((d) => key(d) > at) ?? sorted[0] ?? null;

  return [...sorted].reverse().find((d) => key(d) < at) ?? sorted[sorted.length - 1] ?? null;
}

/** A hover's marked text: MarkupContent ({ kind, value }) or a MarkedString's
 *  code ({ language, value }); a bare { value } reads as Markdown. */
const isMarked = object({ value: isString }, { kind: isString, language: isString });

const isHoverItem = oneOf(isString, isMarked);

/** A hover's contents: one item or a list of them. */
export const isHoverContents = oneOf(isString, isMarked, arrayOf(isHoverItem));

export type HoverContents = Guarded<typeof isHoverContents>;

/** textDocument/hover's answer (null: nothing there). */
export const isHover = nullable(object({ contents: isHoverContents }, { canIncreaseVerbosityLevel: isBoolean }));

/** A hover card's part: a fenced code block, or a paragraph of Markdown. */
export type HoverPart = { readonly code: string; readonly lang: string | null } | { readonly text: string };

/** The text of a part, code or paragraph. */
export const partText = (p: HoverPart): string => ("code" in p ? p.code : p.text);

/** A hover's contents as parts: `{ code, lang }` blocks and `{ text }`
 *  paragraphs (markdown), in order. */
export function hoverParts(contents: HoverContents | null | undefined): HoverPart[] {
  const pieces: HoverPart[] = [];

  const add = (c: Guarded<typeof isHoverItem>): void => {
    if (isString(c)) pieces.push(...splitMarkdown(c));
    else if (c.kind === "markdown") pieces.push(...splitMarkdown(c.value));
    else if (c.kind === "plaintext") pieces.push({ text: c.value });
    else if (c.language !== undefined) pieces.push({ code: c.value, lang: c.language });
    else pieces.push(...splitMarkdown(c.value));
  };

  if (contents === null || contents === undefined) return [];

  if (!isList(contents)) add(contents);
  else for (const c of contents) add(c);

  return pieces.filter((p) => partText(p).trim());
}

/** Markdown split into fenced code blocks and the text between them. */
export function splitMarkdown(md: string): HoverPart[] {
  const out: HoverPart[] = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let at = 0;

  for (let m = re.exec(md); m; m = re.exec(md)) {
    const before = md.slice(at, m.index).trim();

    if (before) out.push({ text: before });

    out.push({ code: (m[2] ?? "").replace(/\n$/, ""), lang: (m[1] ?? "").trim() || null });
    at = re.lastIndex;
  }

  const rest = md.slice(at).trim();

  if (rest) out.push({ text: rest.replace(/^---+$/gm, "").trim() });

  return out.filter((p) => partText(p).trim());
}

/** "42", "42:7", ":42", "42,7": one-based line and column; null otherwise. */
export function parseGoto(s: string | null | undefined): { line: number; col: number } | null {
  const m = (s ?? "").trim().match(/^:?(\d+)(?:[:,.](\d+))?$/);

  if (!m) return null;

  return { line: Math.max(1, Number(m[1])), col: Math.max(1, Number(m[2] ?? 1)) };
}

/** A Location ({ uri, range }) or a LocationLink ({ targetUri, targetRange,
 *  targetSelectionRange }): only where it starts is read. */
const isLocationLike = object({}, { uri: isString, targetUri: isString, range: isLspRange, targetRange: isLspRange, targetSelectionRange: isLspRange });

export type LocationLike = Guarded<typeof isLocationLike>;

/** A definition or references answer: one location, a list, or none. */
export const isLocations = oneOf(isNull, isLocationLike, arrayOf(isLocationLike));

/** Where a definition is, zero-based. */
export interface Place {
  readonly path: string;
  readonly line: number;
  readonly col: number;
}

/** A location from a definition answer (Location, LocationLink, or a list):
 *  `{ path, line, col }`, zero-based. */
export function firstLocation(result: Guarded<typeof isLocations> | undefined): Place | null {
  const l = isList(result) ? result[0] : result;

  if (!l || isList(l)) return null;

  const u = l.targetUri ?? l.uri;
  const r = l.targetSelectionRange ?? l.targetRange ?? l.range;
  const path = u === undefined ? null : pathOf(u);

  return path ? { path, line: r?.start.line ?? 0, col: r?.start.character ?? 0 } : null;
}

// Work a server reports that its answers wait on (rust-analyzer: the
// workspace's loading and indexing); a `cargo check` running doesn't hold
// hovers back.
const BACKGROUND_WORK = /\b(cargo check|check|clippy|flycheck)\b/i;

// The most telling of several at once, first.
const WORK_ORDER = [/index/i, /proc-?macro/i, /build/i, /load/i, /fetch/i, /roots/i];

/** A server's work under way (`$/progress` begun and not ended). */
export interface Work {
  title?: string;
  message?: string;
  percentage?: number;
}

/** `$/progress` params: a token and its begin, report or end. */
export const isProgressParams = object(
  { token: oneOf(isString, isNumber), value: object({ kind: literal("begin", "report", "end") }, { title: isString, message: isString, percentage: isNumber }) },
);

export type ProgressParams = Guarded<typeof isProgressParams>;

/** Open `$/progress` work ({ title, message, percentage } by token) that
 *  answers wait on: true while the server isn't ready to say much. */
export function busy(progress: ReadonlyMap<string, Work> | null | undefined): boolean {
  return [...(progress?.values() ?? [])].some((p) => !BACKGROUND_WORK.test(p.title ?? ""));
}

/** The bar's words for a server's work under way: "indexing 120/340",
 *  "building compile-time-deps 40%"; null with nothing under way. The work
 *  answers wait on first, then the rest (cargo check). */
export function progressWord(progress: ReadonlyMap<string, Work> | null | undefined): string | null {
  const rank = (p: Work): number => {
    if (BACKGROUND_WORK.test(p.title ?? "")) return WORK_ORDER.length + 1;

    const i = WORK_ORDER.findIndex((re) => re.test(p.title ?? ""));

    return i < 0 ? WORK_ORDER.length : i;
  };

  const p = [...(progress?.values() ?? [])].sort((a, b) => rank(a) - rank(b))[0];

  if (!p) return null;

  const title = (p.title ?? "working").toLowerCase().replace(/\s+/g, " ").trim();
  const count = (p.message ?? "").match(/\b(\d+\/\d+)\b/)?.[1];
  const tail = count ?? (p.percentage !== undefined && Number.isFinite(p.percentage) ? `${Math.round(p.percentage)}%` : "");
  const word = tail ? `${title} ${tail}` : `${title}…`;

  return word.length > 34 ? word.slice(0, 33) + "…" : word;
}
