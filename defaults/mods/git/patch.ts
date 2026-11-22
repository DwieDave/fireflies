// Unified diffs with their headers kept, so a selection of lines can go back
// to git as a patch: staging (git apply --cached), unstaging (--cached -R) or
// discarding (-R) single lines and hunks, lazygit's staging view. Pure: tested
// in scripts/git.test.ts. The row drawing is diff's
// (copied in draw.ts), so a highlighted renderer can replace it later.

import { Array as Arr, Option, Schema, String as Str } from "effect";
import { decodeJsonOption } from "@fireflies/kit";

/** A diff line's kind: added, removed, context, or "\ No newline at end of file". */
export const LineKindSchema = Schema.Literals(["+", "-", " ", "\\"]);

export type LineKind = typeof LineKindSchema.Type;

const isLineKind = Schema.is(LineKindSchema);

export const DiffLineSchema = Schema.Struct({ kind: LineKindSchema, text: Schema.String });

export type DiffLine = typeof DiffLineSchema.Type;

/** A hunk: its head line ("@@ -1,3 +1,4 @@ fn"), where it starts, the text after its range, its lines. */
export const HunkSchema = Schema.Struct({
  head: Schema.String,
  oldStart: Schema.Finite,
  newStart: Schema.Finite,
  text: Schema.String,
  lines: Schema.Array(DiffLineSchema),
});

export type Hunk = typeof HunkSchema.Type;

/** What happened to a file; "untracked" for a new file git doesn't know (review). */
export const FileStatusSchema = Schema.Literals(["modified", "added", "deleted", "renamed", "untracked"]);

export type FileStatus = typeof FileStatusSchema.Type;

/** One file's diff, its header lines kept (partialPatch sends them back); `old` its old path when it was renamed. */
export const DiffFileFields = {
  header: Schema.Array(Schema.String),
  path: Schema.String,
  old: Schema.NullOr(Schema.String),
  status: FileStatusSchema,
  binary: Schema.Boolean,
  hunks: Schema.Array(HunkSchema),
  add: Schema.Finite,
  del: Schema.Finite,
};

export const DiffFileSchema = Schema.Struct(DiffFileFields);

export type DiffFile = typeof DiffFileSchema.Type;

/** A file's diff being read. */
interface Building {
  header: string[];
  path: string;
  old: string | null;
  status: FileStatus;
  binary: boolean;
  hunks: { head: string; oldStart: number; newStart: number; text: string; lines: DiffLine[] }[];
  add: number;
  del: number;
}

/** A path as git prints it: in double quotes, escaped as JSON, when it has odd characters. */
const quoted = decodeJsonOption(Schema.String);

const unq = (p: string): string => (Str.startsWith('"')(p) ? Option.getOrElse(quoted(p), () => p) : p);

/** A number of a hunk head, 0 when it isn't there. */
const startOf = (s: string | undefined): number => (s === undefined ? 0 : Number(s));

/** A `diff --git` line: the file it starts. */
function fileHead(line: string): Building {
  const m = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(line);
  const a = m?.[1], b = m?.[2];

  return { header: [line], path: b === undefined ? Str.slice(11)(line) : unq(b), old: a === undefined ? null : unq(a), status: "modified", binary: false, hunks: [], add: 0, del: 0 };
}

/** A header line (before the first hunk) into the file it belongs to. */
function headerLine(f: Building, line: string): void {
  f.header.push(line);

  if (Str.startsWith("new file mode")(line)) f.status = "added";
  else if (Str.startsWith("deleted file mode")(line)) f.status = "deleted";
  else if (Str.startsWith("rename from ")(line)) {
    f.status = "renamed";
    f.old = Str.slice(12)(line);
  } else if (Str.startsWith("rename to ")(line)) f.path = Str.slice(10)(line);
  else if (Str.startsWith("Binary files ")(line) || line === "GIT binary patch") f.binary = true;
}

/** Every file's diff in `git diff` / `git show` output. */
export function parseDiff(text: string): DiffFile[] {
  const files: Building[] = [];
  let f: Building | null = null, h: Building["hunks"][number] | null = null;

  for (const line of Str.split(text, "\n")) {
    if (Str.startsWith("diff --git ")(line)) {
      f = fileHead(line);
      files.push(f);
      h = null;
      continue;
    }

    if (f === null) continue;

    if (Str.startsWith("@@")(line)) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);

      h = { head: line, oldStart: startOf(m?.[1]), newStart: startOf(m?.[3]), text: m?.[5] ?? "", lines: [] };
      f.hunks.push(h);
      continue;
    }

    if (h === null) {
      headerLine(f, line);
      continue;
    }

    const k = Str.slice(0, 1)(line);

    // An empty line is the whole diff's trailing newline: an empty context line has its space.
    if (isLineKind(k)) {
      h.lines.push({ kind: k, text: Str.slice(1)(line) });

      if (k === "+") f.add++;
      else if (k === "-") f.del++;
    }
  }

  return Arr.map(files, (x): DiffFile => (x.old === x.path && x.status !== "renamed" ? { ...x, old: null } : x));
}

/** A row of a file's diff in the main view: a hunk's head, or one of its lines. */
export type DiffRow =
  | { readonly kind: "@"; readonly hunk: number; readonly line: null; readonly text: string; readonly range: string }
  | { readonly kind: LineKind; readonly hunk: number; readonly line: number; readonly text: string; readonly o?: number; readonly n?: number };

/** A hunk head's range: "@@ -1,3 +1,4 @@". */
const rangeOf = (head: string): string => Option.match(Str.indexOf("@@")(Str.slice(2)(head)), { onNone: () => Str.slice(0, 1)(head), onSome: (i) => Str.slice(0, i + 4)(head) });

/** A file's rows for the main view: hunk heads and lines, each with its
 *  hunk index and line index (null for a head), old/new line numbers. */
export function rows(f: DiffFile): DiffRow[] {
  return Arr.flatMap(f.hunks, (h, hi): DiffRow[] => {
    let o = h.oldStart, n = h.newStart;

    const lines = Arr.map(h.lines, (l, li): DiffRow => {
      const row = { kind: l.kind, hunk: hi, line: li, text: l.text };

      if (l.kind === "+") return { ...row, n: n++ };

      if (l.kind === "-") return { ...row, o: o++ };

      if (l.kind === " ") return { ...row, o: o++, n: n++ };

      return row;
    });

    return [{ kind: "@", hunk: hi, line: null, text: h.text, range: rangeOf(h.head) }, ...lines];
  });
}

/** Is a row a change (something staging can pick)? */
export const isChange = (row: { readonly kind: string } | undefined): boolean => row !== undefined && (row.kind === "+" || row.kind === "-");

/** How partialPatch's patch will be applied. */
export interface PatchOptions {
  /** With -R (unstaging from the staged diff, discarding from the unstaged one). */
  readonly reverse?: boolean;
}

/** One hunk of a partial patch: its head and lines, or none when nothing in it is picked. */
function partialHunk(h: Hunk, hi: number, picked: ReadonlySet<string>, reverse: boolean): string[] {
  const lines: string[] = [];
  let any = false, oldN = 0, newN = 0, kept = false;

  for (const [li, l] of h.lines.entries()) {
    const on = picked.has(`${hi}:${li}`);
    let kind = l.kind;

    if (kind === "+" || kind === "-") {
      if (on) any = true;
      else if ((kind === "+") !== reverse) {
        // A line that stays out of this change.
        kept = false;
        continue;
      } else kind = " ";
    } else if (kind === "\\") {
      if (kept) lines.push(`\\${l.text}`);

      continue;
    }

    if (kind === " ") {
      oldN++;
      newN++;
    } else if (kind === "-") oldN++;
    else newN++;

    lines.push(`${kind}${l.text}`);
    kept = true;
  }

  if (!any) return [];

  return [`@@ -${h.oldStart}${oldN === 1 ? "" : `,${oldN}`} +${h.newStart}${newN === 1 ? "" : `,${newN}`} @@${Str.isEmpty(h.text) ? "" : ` ${h.text}`}`, ...lines];
}

/** A patch holding only the `picked` rows (a Set of "hunk:line" keys) of file
 *  `f`. reverse: the patch will be applied with -R (unstaging from the
 *  staged diff, discarding from the unstaged one), so lines left out are
 *  turned the other way round. null when nothing is picked. */
export function partialPatch(f: DiffFile, picked: ReadonlySet<string>, options: PatchOptions = {}): string | null {
  const { reverse = false } = options;
  const hunks = Arr.flatMap(f.hunks, (h, hi) => partialHunk(h, hi, picked, reverse));

  if (hunks.length === 0) return null;

  // Part of a new file: the index already holds it (git add -N first), so the
  // patch changes an empty file rather than creating one.
  const header = f.status === "added" && !reverse
    ? Arr.map(Arr.filter(f.header, (l) => !Str.startsWith("new file mode")(l) && !Str.startsWith("index ")(l)), (l) => (l === "--- /dev/null" ? `--- a/${f.path}` : l))
    : f.header;

  return Arr.join([...header, ...hunks], "\n") + "\n";
}

/** Every change row's key in hunk `hi` (hunk mode picks them all). */
export function hunkKeys(f: DiffFile, hi: number): string[] {
  return Option.match(Arr.get(f.hunks, hi), {
    onNone: () => [],
    onSome: (h) => Arr.flatMap(h.lines, (l, li) => (l.kind === "+" || l.kind === "-" ? [`${hi}:${li}`] : [])),
  });
}
