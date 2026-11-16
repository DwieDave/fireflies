// The preview's patches (.diff, .patch), as plain functions (no app calls), so
// scripts/preview-diff.test.ts can check them: a unified diff (git's,
// `diff -u`'s, a `git format-patch` mail) cut into rows to draw, numbered as
// diff numbers them.

import { Array as Arr, Option, String as Str } from "effect";

/** A file's start in a patch: its path, the path it was renamed from, its
 *  lines added and removed, whether it's binary, whether it's new or gone. */
export interface PatchFile {
  readonly kind: "file";
  readonly path: string;
  readonly old: string | null;
  readonly add: number;
  readonly del: number;
  readonly binary: boolean;
  readonly status?: "added" | "deleted";
}

/** A row to draw. */
export type PatchRow =
  | PatchFile
  /** A hunk's head: its range ("@@ -1,4 +1,5 @@"), the function after it. */
  | { readonly kind: "@"; readonly range: string; readonly text: string }
  /** A line added (its new number), removed (its old one), or kept (both). */
  | { readonly kind: "+"; readonly n: number; readonly text: string }
  | { readonly kind: "-"; readonly o: number; readonly text: string }
  | { readonly kind: " "; readonly o: number; readonly n: number; readonly text: string }
  /** "No newline at end of file". */
  | { readonly kind: "\\"; readonly text: string }
  /** Anything else (a mail's headers and message, git's index lines). */
  | { readonly kind: "note"; readonly text: string };

/** A patch cut into rows, its files, and its lines added and removed in all. */
export interface Patch {
  readonly rows: readonly PatchRow[];
  readonly files: readonly PatchFile[];
  readonly add: number;
  readonly del: number;
}

type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** A header path without its `--- ` / `+++ `, a tab's date and quotes. */
const headerPath = (s: string): string => Str.replace(/^"|"$/g, "")(Str.replace(/\t.*$/, "")(Str.slice(4)(s)));

/** A diff being read: its rows and files so far, the open file, and where
 *  its hunk is (the old and new line numbers, the lines it has left). */
class PatchReader {
  readonly rows: PatchRow[] = [];
  readonly files: Writable<PatchFile>[] = [];
  // The files whose ---/+++ header was read (git's comes after its "diff --git" line).
  readonly headed = new WeakSet<PatchFile>();
  f: Writable<PatchFile> | null = null;
  oldN = 0;
  newN = 0;
  inHunk = false;
  left = { o: 0, n: 0 };

  /** A new file's row. */
  start(path: string, old: string | null = null): Writable<PatchFile> {
    const file: Writable<PatchFile> = { kind: "file", path, old, add: 0, del: 0, binary: false };

    this.files.push(file);
    this.rows.push(file);
    this.inHunk = false;

    return file;
  }

  /** A line inside a hunk, while its counts say it goes on (a "-- " line is a
   *  deletion there, not a mail's signature). True when it was one; any other
   *  line ends the hunk. */
  hunkLine(line: string): boolean {
    const f = this.f;

    if (f === null || !this.inHunk || !(this.left.o > 0 || this.left.n > 0)) return false;

    const k = line[0] ?? " ";
    const body = Str.slice(1)(line);

    if (k === "+") {
      f.add++;
      this.left.n--;
      this.rows.push({ kind: "+", n: this.newN++, text: body });
    } else if (k === "-") {
      f.del++;
      this.left.o--;
      this.rows.push({ kind: "-", o: this.oldN++, text: body });
    } else if (k === " " || line === "") {
      this.left.o--;
      this.left.n--;
      this.rows.push({ kind: " ", o: this.oldN++, n: this.newN++, text: body });
    } else if (k === "\\") this.rows.push({ kind: "\\", text: Str.slice(2)(line) });
    else {
      this.inHunk = false;

      return false;
    }

    return true;
  }

  /** A file's head line: git's (a/ b/, or its mnemonic prefixes, diff.mnemonicPrefix:
   *  c/ w/ i/ o/), or another diff's `diff …`. True when it was one. */
  diffLine(line: string): boolean {
    const git = /^diff --git "?[a-z]\/(.+?)"? "?[a-z]\/(.+?)"?$/.exec(line);

    if (git !== null) {
      const a = git[1] ?? "";
      const b = git[2] ?? "";

      this.f = this.start(b, a !== b ? a : null);

      return true;
    }

    if (!Str.startsWith("diff ")(line)) return false;

    this.f = this.start(Arr.lastNonEmpty(Str.split(Str.replace(/^diff\s+(-\S+\s+)*/, "")(line), /\s+/)));

    return true;
  }

  /** A `--- a` / `+++ b` header pair: the file it names (git's headers come
   *  after its "diff --git" line: the file is already open), added or deleted. */
  header(line: string, next: string): void {
    let a = headerPath(line);
    let b = headerPath(next);
    // git's one-letter prefixes go when both sides have one (a plain diff's x/ stays).
    const pre = /^[a-z]\//;

    if ((pre.test(a) || a === "/dev/null") && (pre.test(b) || b === "/dev/null")) {
      a = Str.replace(pre, "")(a);
      b = Str.replace(pre, "")(b);
    }

    const path = b === "/dev/null" ? a : b;
    const last = this.rows.at(-1)?.kind;
    const f = this.f;
    const file: Writable<PatchFile> = f === null || this.headed.has(f) || this.inHunk || last === "+" || last === " " || last === "-" ? this.start(path) : f;

    this.f = file;
    this.headed.add(file);

    if (Str.isNonEmpty(path)) file.path = path;

    if (a === "/dev/null") file.status = "added";

    if (b === "/dev/null") file.status = "deleted";
  }

  /** A hunk's `@@ -o,n +o,n @@` line: where its lines start, how many it has. */
  hunk(h: RegExpExecArray, line: string): void {
    this.f ??= this.start("");
    this.oldN = Number(h[1]);
    this.newN = Number(h[3]);
    this.left = { o: h[2] === undefined ? 1 : Number(h[2]), n: h[4] === undefined ? 1 : Number(h[4]) };
    this.inHunk = true;
    // The range ends at the second "@@" (none: the line's first character, as indexOf's -1 + 2 cut it).
    const end = Option.match(Str.indexOf("@@")(Str.slice(2)(line)), { onNone: () => 1, onSome: (at) => at + 4 });

    this.rows.push({ kind: "@", range: Str.slice(0, end)(line), text: h[5] ?? "" });
  }

  /** Any other line, a note: a binary file's, a rename's old name. */
  note(line: string): void {
    const f = this.f;

    if (f !== null) {
      const renamed = /^rename from (.+)$/.exec(line);

      if (/^Binary files .* differ$|^GIT binary patch$/.test(line)) f.binary = true;
      else if (renamed !== null) f.old = renamed[1] ?? null;
    }

    this.rows.push({ kind: "note", text: line });
  }
}

/** Cuts a unified diff into rows (see PatchRow). */
export function parse(text: string | null | undefined): Patch {
  const lines = Str.split(Str.replace(/\r\n/g, "\n")(text ?? ""), "\n");

  if (lines.at(-1) === "") lines.pop();

  const r = new PatchReader();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (r.hunkLine(line)) continue;

    if (r.inHunk && Str.startsWith("\\")(line)) r.rows.push({ kind: "\\", text: Str.slice(2)(line) });
    else if (r.diffLine(line)) continue;
    else if (Str.startsWith("--- ")(line) && Str.startsWith("+++ ")(lines[i + 1] ?? "")) {
      r.header(line, lines[i + 1] ?? "");
      i++;
    } else {
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);

      if (hunk !== null) r.hunk(hunk, line);
      else r.note(line);
    }
  }

  let add = 0;
  let del = 0;

  for (const x of r.files) {
    add += x.add;
    del += x.del;
  }

  return { rows: r.rows, files: r.files, add, del };
}

/** Where each file starts in `rows`, for ] / [ (next / previous file). */
export const fileStarts = (rows: readonly PatchRow[]): number[] => Arr.flatMap(rows, (r, i) => (r.kind === "file" ? [i] : []));

/** The next (`dir` 1) or previous (-1) file start from row `at`. */
export function nextFile(starts: readonly number[], at: number, dir: number): number | null {
  if (starts.length === 0) return null;

  if (dir > 0) return Option.getOrElse(Arr.findFirst(starts, (s) => s > at), () => starts.at(-1) ?? null);

  return Option.getOrElse(Arr.findLast(starts, (s) => s < at), () => starts[0] ?? null);
}
