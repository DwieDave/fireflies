// A query tab's text as statements: split at the semicolons that end them
// (not those inside a string, a quoted name, a comment, a Postgres $tag$ body
// or a SQLite trigger's BEGIN … END), each with where it starts in the text,
// so "run the statement under the caret" knows which one and an error's line
// lands in the editor. Also the text with comments and literals blanked, which
// safety.ts reads.

import type { Kind } from "./kinds.ts";

/** A statement: its text (trimmed, without its closing semicolon), where it starts and ends in
 *  the whole text (offsets), and its first line (1-based). */
export interface Statement {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
}

/** What the scanner is inside at a character. */
type Inside = "code" | "single" | "double" | "back" | "line" | "block" | "dollar";

/** The scanner: the text, the kind, where it is, what it's inside, a dollar tag. */
interface Scan {
  readonly s: string;
  readonly kind: Kind;
  i: number;
  inside: Inside;
  tag: string;
}

/** Steps the scanner over one character (or a pair: an escape, a comment's ends, a tag) and says
 *  whether that character was code (outside every string and comment). */
function step(sc: Scan): boolean {
  const { s } = sc;
  const c = s[sc.i] ?? "";
  const next = s[sc.i + 1] ?? "";

  switch (sc.inside) {
    case "code": return codeStep(sc, c, next);
    case "single":
    case "double":
    case "back": {
      const close = sc.inside === "single" ? "'" : sc.inside === "double" ? '"' : "`";

      // MySQL strings take backslash escapes; every kind doubles the quote.
      if (c === "\\" && sc.kind === "mysql" && sc.inside !== "back") sc.i += 2;
      else if (c === close && next === close) sc.i += 2;
      else {
        if (c === close) sc.inside = "code";

        sc.i += 1;
      }

      return false;
    }

    case "line":
      if (c === "\n") sc.inside = "code";

      sc.i += 1;

      return false;
    case "block":
      if (c === "*" && next === "/") {
        sc.inside = "code";
        sc.i += 2;
      } else sc.i += 1;

      return false;
    case "dollar":
      if (s.startsWith(sc.tag, sc.i)) {
        sc.i += sc.tag.length;
        sc.inside = "code";
      } else sc.i += 1;

      return false;
  }
}

const DOLLAR = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

function codeStep(sc: Scan, c: string, next: string): boolean {
  const opens = (inside: Inside, width: number): false => {
    sc.inside = inside;
    sc.i += width;

    return false;
  };

  if (c === "'") return opens("single", 1);

  if (c === '"') return opens("double", 1);

  if (c === "`" && sc.kind === "mysql") return opens("back", 1);

  if (c === "-" && next === "-") return opens("line", 2);

  if (c === "#" && sc.kind === "mysql") return opens("line", 1);

  if (c === "/" && next === "*") return opens("block", 2);

  if (c === "$" && sc.kind === "postgres") {
    const m = DOLLAR.exec(sc.s.slice(sc.i, sc.i + 64));

    if (m) {
      sc.tag = m[0];

      return opens("dollar", m[0].length);
    }
  }

  sc.i += 1;

  return true;
}

/** `text` with comments, strings and quoted names blanked to spaces (lengths kept), for reading
 *  its words safely. Quoted names become `x`s, so "drop table "t"" still names something. */
export function blankLiterals(text: string, kind: Kind): string {
  const sc: Scan = { s: text, kind, i: 0, inside: "code", tag: "" };
  let out = "";

  while (sc.i < text.length) {
    const from = sc.i;
    const was = sc.inside;
    const code = step(sc);
    const piece = text.slice(from, sc.i);
    const name = was === "double" || was === "back" || ((sc.inside === "double" || sc.inside === "back") && was === "code");

    out += code ? piece : piece.replace(/[^\n]/g, name ? "x" : " ");
  }

  return out;
}

const TRIGGER = /^\s*create\s+(temp\s+|temporary\s+)?trigger\b/i;
const TRIGGER_END = /\bend\s*$/i;

/** A piece's statement (trimmed, null when it holds only comments and spaces). */
function statementOf(text: string, kind: Kind, from: number, to: number): Statement | null {
  const piece = text.slice(from, to);
  const lead = piece.length - piece.trimStart().length;
  const body = piece.trim();

  if (!blankLiterals(body, kind).trim()) return null;

  const start = from + lead;
  const line = text.slice(0, start).split("\n").length;

  return { text: body, start, end: start + body.length, line };
}

/** The statements of `text`, in order. */
export function splitStatements(text: string, kind: Kind): Statement[] {
  const out: Statement[] = [];
  const sc: Scan = { s: text, kind, i: 0, inside: "code", tag: "" };
  let from = 0;

  while (sc.i < text.length) {
    const at = sc.i;
    const code = step(sc);

    if (!code || text[at] !== ";") continue;

    // A trigger's body holds statements of its own: it ends at END;.
    const sofar = blankLiterals(text.slice(from, at), kind);

    if (TRIGGER.test(sofar) && !TRIGGER_END.test(sofar)) continue;

    const st = statementOf(text, kind, from, at);

    if (st) out.push(st);

    from = at + 1;
  }

  const last = statementOf(text, kind, from, text.length);

  if (last) out.push(last);

  return out;
}

/** The statement the caret is in: the one that holds it, else the one it follows on the same
 *  line (just after its semicolon), else the next, else the last. */
export function statementAt(list: readonly Statement[], text: string, caret: number): Statement | null {
  const holding = list.find((s) => caret >= s.start && caret <= s.end + 1);

  if (holding) return holding;

  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const before = [...list].reverse().find((s) => s.end <= caret && s.end >= lineStart);

  return before ?? list.find((s) => s.start >= caret) ?? list.at(-1) ?? null;
}

/** A place in a text: its line and column, both 1-based. */
export interface Place {
  readonly line: number;
  readonly col: number;
}

/** A 0-based offset in `text` as a 1-based line and column. */
export function lineCol(text: string, offset: number): Place {
  const before = text.slice(0, Math.max(0, offset));
  const nl = before.lastIndexOf("\n");

  return { line: before.split("\n").length, col: offset - nl };
}
