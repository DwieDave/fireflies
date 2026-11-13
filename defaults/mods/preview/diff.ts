// The preview's patches (.diff, .patch), as plain functions (no app calls), so
// scripts/preview-diff.test.ts can check them: a unified diff (git's,
// `diff -u`'s, a `git format-patch` mail) cut into rows to draw, numbered as
// diff numbers them.

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
const headerPath = (s: string): string => s.slice(4).replace(/\t.*$/, "").replace(/^"|"$/g, "");

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

    if (!f || !this.inHunk || !(this.left.o > 0 || this.left.n > 0)) return false;

    const k = line[0] ?? " ";
    const body = line.slice(1);

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
    } else if (k === "\\") this.rows.push({ kind: "\\", text: line.slice(2) });
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

    if (git) {
      const a = git[1] ?? "";
      const b = git[2] ?? "";

      this.f = this.start(b, a !== b ? a : null);

      return true;
    }

    if (!line.startsWith("diff ")) return false;

    this.f = this.start(line.replace(/^diff\s+(-\S+\s+)*/, "").split(/\s+/).pop() ?? line);

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
      a = a.replace(pre, "");
      b = b.replace(pre, "");
    }

    const path = b === "/dev/null" ? a : b;
    const last = this.rows.at(-1)?.kind;
    const f = this.f;
    const file: Writable<PatchFile> = !f || this.headed.has(f) || this.inHunk || last === "+" || last === " " || last === "-" ? this.start(path) : f;

    this.f = file;
    this.headed.add(file);

    if (path) file.path = path;

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
    this.rows.push({ kind: "@", range: line.slice(0, line.indexOf("@@", 2) + 2), text: h[5] ?? "" });
  }

  /** Any other line, a note: a binary file's, a rename's old name. */
  note(line: string): void {
    const f = this.f;

    if (f && /^Binary files .* differ$|^GIT binary patch$/.test(line)) f.binary = true;
    else {
      const renamed = f ? /^rename from (.+)$/.exec(line) : null;

      if (f && renamed) f.old = renamed[1] ?? null;
    }

    this.rows.push({ kind: "note", text: line });
  }
}

/** Cuts a unified diff into rows (see PatchRow). */
export function parse(text: string | null | undefined): Patch {
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");

  if (lines.at(-1) === "") lines.pop();

  const r = new PatchReader();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (r.hunkLine(line)) continue;

    if (r.inHunk && line.startsWith("\\")) r.rows.push({ kind: "\\", text: line.slice(2) });
    else if (r.diffLine(line)) continue;
    else if (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
      r.header(line, lines[i + 1] ?? "");
      i++;
    } else {
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);

      if (hunk) r.hunk(hunk, line);
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
export const fileStarts = (rows: readonly PatchRow[]): number[] => rows.flatMap((r, i) => (r.kind === "file" ? [i] : []));

/** The next (`dir` 1) or previous (-1) file start from row `at`. */
export function nextFile(starts: readonly number[], at: number, dir: number): number | null {
  if (!starts.length) return null;

  if (dir > 0) return starts.find((s) => s > at) ?? starts.at(-1) ?? null;

  return [...starts].reverse().find((s) => s < at) ?? starts[0] ?? null;
}
