// Unified diffs with their headers kept, so a selection of lines can go back
// to git as a patch: staging (git apply --cached), unstaging (--cached -R) or
// discarding (-R) single lines and hunks, lazygit's staging view. Pure: tested
// in scripts/git.test.ts. The row drawing is diff's
// (copied in draw.ts), so a highlighted renderer can replace it later.

import { isString, parseJson } from "./guard.ts";

/** A diff line's kind: added, removed, context, or "\ No newline at end of file". */
export type LineKind = "+" | "-" | " " | "\\";

export interface DiffLine {
  readonly kind: LineKind;
  readonly text: string;
}

/** A hunk: its head line ("@@ -1,3 +1,4 @@ fn"), where it starts, the text after its range, its lines. */
export interface Hunk {
  readonly head: string;
  readonly oldStart: number;
  readonly newStart: number;
  readonly text: string;
  readonly lines: readonly DiffLine[];
}

/** What happened to a file; "untracked" for a new file git doesn't know (review). */
export type FileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

/** One file's diff, its header lines kept (partialPatch sends them back). */
export interface DiffFile {
  readonly header: readonly string[];
  readonly path: string;
  /** Its old path, when it was renamed. */
  readonly old: string | null;
  readonly status: FileStatus;
  readonly binary: boolean;
  readonly hunks: readonly Hunk[];
  readonly add: number;
  readonly del: number;
}

const isLineKind = (k: string | undefined): k is LineKind => k === "+" || k === "-" || k === " " || k === "\\";

/** Every file's diff in `git diff` / `git show` output. */
export function parseDiff(text: string): DiffFile[] {
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

  const files: Building[] = [];
  let f: Building | null = null, h: Building["hunks"][number] | null = null;

  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(line);
      const [, a, b] = m ?? [];

      f = { header: [line], path: b === undefined ? line.slice(11) : unq(b), old: a === undefined ? null : unq(a), status: "modified", binary: false, hunks: [], add: 0, del: 0 };
      files.push(f);
      h = null;
      continue;
    }

    if (!f) continue;

    if (line.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);

      h = { head: line, oldStart: m ? Number(m[1]) : 0, newStart: m ? Number(m[3]) : 0, text: m?.[5] ?? "", lines: [] };
      f.hunks.push(h);
      continue;
    }

    if (!h) {
      f.header.push(line);

      if (line.startsWith("new file mode")) f.status = "added";
      else if (line.startsWith("deleted file mode")) f.status = "deleted";
      else if (line.startsWith("rename from ")) {
        f.status = "renamed";
        f.old = line.slice(12);
      } else if (line.startsWith("rename to ")) f.path = line.slice(10);
      else if (line.startsWith("Binary files ") || line === "GIT binary patch") f.binary = true;

      continue;
    }

    const k = line[0];

    // An empty line is the whole diff's trailing newline: an empty context line has its space.
    if (isLineKind(k)) {
      h.lines.push({ kind: k, text: line.slice(1) });

      if (k === "+") f.add++;
      else if (k === "-") f.del++;
    }
  }

  return files.map((x) => (x.old === x.path && x.status !== "renamed" ? { ...x, old: null } : x));
}

/** A path as git prints it: in double quotes, escaped as JSON, when it has odd characters. */
const unq = (p: string): string => (p.startsWith('"') ? parseJson(p, isString) ?? p : p);

/** A row of a file's diff in the main view: a hunk's head, or one of its lines. */
export type DiffRow =
  | { readonly kind: "@"; readonly hunk: number; readonly line: null; readonly text: string; readonly range: string }
  | { readonly kind: LineKind; readonly hunk: number; readonly line: number; readonly text: string; readonly o?: number; readonly n?: number };

/** A file's rows for the main view: hunk heads and lines, each with its
 *  hunk index and line index (null for a head), old/new line numbers. */
export function rows(f: DiffFile): DiffRow[] {
  const out: DiffRow[] = [];

  f.hunks.forEach((h, hi) => {
    out.push({ kind: "@", hunk: hi, line: null, text: h.text, range: h.head.slice(0, h.head.indexOf("@@", 2) + 2) });

    let o = h.oldStart, n = h.newStart;

    h.lines.forEach((l, li) => {
      const row = { kind: l.kind, hunk: hi, line: li, text: l.text };

      if (l.kind === "+") out.push({ ...row, n: n++ });
      else if (l.kind === "-") out.push({ ...row, o: o++ });
      else if (l.kind === " ") out.push({ ...row, o: o++, n: n++ });
      else out.push(row);
    });
  });

  return out;
}

/** Is a row a change (something staging can pick)? */
export const isChange = (row: { readonly kind: string } | undefined) => row !== undefined && (row.kind === "+" || row.kind === "-");

/** How partialPatch's patch will be applied. */
export interface PatchOptions {
  /** With -R (unstaging from the staged diff, discarding from the unstaged one). */
  readonly reverse?: boolean;
}

/** A patch holding only the `picked` rows (a Set of "hunk:line" keys) of file
 *  `f`. reverse: the patch will be applied with -R (unstaging from the
 *  staged diff, discarding from the unstaged one), so lines left out are
 *  turned the other way round. null when nothing is picked. */
export function partialPatch(f: DiffFile, picked: ReadonlySet<string>, options: PatchOptions = {}) {
  const { reverse = false } = options;
  const hunks: string[] = [];

  f.hunks.forEach((h, hi) => {
    const lines: string[] = [];
    let any = false, oldN = 0, newN = 0, kept = false;

    h.lines.forEach((l, li) => {
      const on = picked.has(`${hi}:${li}`);
      let kind = l.kind;

      if (kind === "+" || kind === "-") {
        if (on) any = true;
        else if ((kind === "+") !== reverse) {
          // A line that stays out of this change.
          kept = false;

          return;
        } else kind = " ";
      } else if (kind === "\\") {
        if (!kept) return;

        lines.push(`\\${l.text}`);

        return;
      }

      if (kind === " ") {
        oldN++;
        newN++;
      } else if (kind === "-") oldN++;
      else newN++;

      lines.push(`${kind}${l.text}`);
      kept = true;
    });

    if (!any) return;

    hunks.push(`@@ -${h.oldStart}${oldN === 1 ? "" : `,${oldN}`} +${h.newStart}${newN === 1 ? "" : `,${newN}`} @@${h.text ? ` ${h.text}` : ""}`, ...lines);
  });

  if (!hunks.length) return null;

  // Part of a new file: the index already holds it (git add -N first), so the
  // patch changes an empty file rather than creating one.
  const header = f.status === "added" && !reverse
    ? f.header.filter((l) => !l.startsWith("new file mode") && !l.startsWith("index "))
      .map((l) => (l === "--- /dev/null" ? `--- a/${f.path}` : l))
    : f.header;

  return [...header, ...hunks].join("\n") + "\n";
}

/** Every change row's key in hunk `hi` (hunk mode picks them all). */
export function hunkKeys(f: DiffFile, hi: number) {
  const h = f.hunks[hi];

  return h ? h.lines.flatMap((l, li) => (l.kind === "+" || l.kind === "-" ? [`${hi}:${li}`] : [])) : [];
}
