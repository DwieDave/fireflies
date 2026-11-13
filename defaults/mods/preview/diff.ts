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

/** Cuts a unified diff into rows (see PatchRow). */
export function parse(text: string | null | undefined): Patch {
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");

  if (lines.at(-1) === "") lines.pop();

  const rows: PatchRow[] = [];
  const files: Writable<PatchFile>[] = [];
  // The files whose ---/+++ header was read (git's comes after its "diff --git" line).
  const headed = new WeakSet<PatchFile>();
  let f: Writable<PatchFile> | null = null;
  let oldN = 0;
  let newN = 0;
  let inHunk = false;
  let left = { o: 0, n: 0 };

  const start = (path: string, old: string | null = null): Writable<PatchFile> => {
    const file: Writable<PatchFile> = { kind: "file", path, old, add: 0, del: 0, binary: false };

    files.push(file);
    rows.push(file);
    inHunk = false;

    return file;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // Inside a hunk its counts say where it ends (a "-- " line is a deletion there, not a mail's signature).
    if (f && inHunk && (left.o > 0 || left.n > 0)) {
      const k = line[0] ?? " ";
      const body = line.slice(1);

      if (k === "+") {
        f.add++;
        left.n--;
        rows.push({ kind: "+", n: newN++, text: body });

        continue;
      }

      if (k === "-") {
        f.del++;
        left.o--;
        rows.push({ kind: "-", o: oldN++, text: body });

        continue;
      }

      if (k === " " || line === "") {
        left.o--;
        left.n--;
        rows.push({ kind: " ", o: oldN++, n: newN++, text: body });

        continue;
      }

      if (k === "\\") {
        rows.push({ kind: "\\", text: line.slice(2) });

        continue;
      }

      inHunk = false;
    }

    if (inHunk && line.startsWith("\\")) {
      rows.push({ kind: "\\", text: line.slice(2) });

      continue;
    }

    // git's a/ b/, or its mnemonic prefixes (diff.mnemonicPrefix: c/ w/ i/ o/).
    const git = /^diff --git "?[a-z]\/(.+?)"? "?[a-z]\/(.+?)"?$/.exec(line);

    if (git) {
      const a = git[1] ?? "";
      const b = git[2] ?? "";

      f = start(b, a !== b ? a : null);

      continue;
    }

    if (line.startsWith("diff ")) {
      f = start(line.replace(/^diff\s+(-\S+\s+)*/, "").split(/\s+/).pop() ?? line);

      continue;
    }

    const next = lines[i + 1];

    if (line.startsWith("--- ") && next?.startsWith("+++ ")) {
      let a = headerPath(line);
      let b = headerPath(next);
      // git's one-letter prefixes go when both sides have one (a plain diff's x/ stays).
      const pre = /^[a-z]\//;

      if ((pre.test(a) || a === "/dev/null") && (pre.test(b) || b === "/dev/null")) {
        a = a.replace(pre, "");
        b = b.replace(pre, "");
      }

      const path = b === "/dev/null" ? a : b;
      const last = rows.at(-1)?.kind;
      // git's headers come after its "diff --git" line: the file is already open.
      const file: Writable<PatchFile> = !f || headed.has(f) || inHunk || last === "+" || last === " " || last === "-" ? start(path) : f;

      f = file;
      headed.add(file);

      if (path) file.path = path;

      if (a === "/dev/null") file.status = "added";

      if (b === "/dev/null") file.status = "deleted";

      i++;

      continue;
    }

    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);

    if (hunk) {
      f ??= start("");

      oldN = Number(hunk[1]);
      newN = Number(hunk[3]);
      left = { o: hunk[2] === undefined ? 1 : Number(hunk[2]), n: hunk[4] === undefined ? 1 : Number(hunk[4]) };
      inHunk = true;
      rows.push({ kind: "@", range: line.slice(0, line.indexOf("@@", 2) + 2), text: hunk[5] ?? "" });

      continue;
    }

    if (f && /^Binary files .* differ$|^GIT binary patch$/.test(line)) {
      f.binary = true;
      rows.push({ kind: "note", text: line });

      continue;
    }

    const renamed = f ? /^rename from (.+)$/.exec(line) : null;

    if (f && renamed) f.old = renamed[1] ?? null;

    rows.push({ kind: "note", text: line });
  }

  let add = 0;
  let del = 0;

  for (const x of files) {
    add += x.add;
    del += x.del;
  }

  return { rows, files, add, del };
}

/** Where each file starts in `rows`, for ] / [ (next / previous file). */
export const fileStarts = (rows: readonly PatchRow[]): number[] => rows.flatMap((r, i) => (r.kind === "file" ? [i] : []));

/** The next (`dir` 1) or previous (-1) file start from row `at`. */
export function nextFile(starts: readonly number[], at: number, dir: number): number | null {
  if (!starts.length) return null;

  if (dir > 0) return starts.find((s) => s > at) ?? starts.at(-1) ?? null;

  return [...starts].reverse().find((s) => s < at) ?? starts[0] ?? null;
}
