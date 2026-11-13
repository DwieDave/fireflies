// The preview's patches (.diff, .patch), as plain functions (no app calls), so
// scripts/preview-diff.test.ts can check them: a unified diff (git's,
// `diff -u`'s, a `git format-patch` mail) cut into rows to draw, numbered as
// diff numbers them.

/** Rows: { kind, ... }
 *    "file"  a file's start: path, old (renamed from), add, del, binary
 *    "@"     a hunk's head: range ("@@ -1,4 +1,5 @@"), text (the function after it)
 *    "+" "-" " "  a line, with o (old number) / n (new number) and text
 *    "\\"    "No newline at end of file"
 *    "note"  anything else (a mail's headers and message, git's index lines)
 *  -> { rows, files, add, del } */
export function parse(text) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const rows = [], files = [];
  let f = null, oldN = 0, newN = 0, inHunk = false, left = { o: 0, n: 0 };
  const start = (path, old = null) => {
    f = { kind: "file", path, old, add: 0, del: 0, binary: false };
    files.push(f); rows.push(f); inHunk = false;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Inside a hunk its counts say where it ends (a "-- " line is a deletion there, not a mail's signature).
    if (inHunk && (left.o > 0 || left.n > 0)) {
      const k = line[0] ?? " ", body = line.slice(1);
      if (k === "+") { f.add++; left.n--; rows.push({ kind: "+", n: newN++, text: body }); continue; }
      if (k === "-") { f.del++; left.o--; rows.push({ kind: "-", o: oldN++, text: body }); continue; }
      if (k === " " || line === "") { left.o--; left.n--; rows.push({ kind: " ", o: oldN++, n: newN++, text: body }); continue; }
      if (k === "\\") { rows.push({ kind: "\\", text: line.slice(2) }); continue; }
      inHunk = false;
    }
    if (inHunk && line.startsWith("\\")) { rows.push({ kind: "\\", text: line.slice(2) }); continue; }
    let m;
    // git's a/ b/, or its mnemonic prefixes (diff.mnemonicPrefix: c/ w/ i/ o/).
    if ((m = /^diff --git "?[a-z]\/(.+?)"? "?[a-z]\/(.+?)"?$/.exec(line))) { start(m[2], m[1] !== m[2] ? m[1] : null); continue; }
    if (/^diff /.test(line)) { start(line.replace(/^diff\s+(-\S+\s+)*/, "").split(/\s+/).pop() ?? line); continue; }
    if (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
      const strip = (s) => s.slice(4).replace(/\t.*$/, "").replace(/^"|"$/g, "");
      let a = strip(line), b = strip(lines[i + 1]);
      // git's one-letter prefixes go when both sides have one (a plain diff's x/ stays).
      const pre = /^[a-z]\//;
      if ((pre.test(a) || a === "/dev/null") && (pre.test(b) || b === "/dev/null")) { a = a.replace(pre, ""); b = b.replace(pre, ""); }
      const path = b === "/dev/null" ? a : b;
      // git's headers come after its "diff --git" line: the file is already open.
      if (!f || f.sawHeader || inHunk || rows.at(-1)?.kind === "+" || rows.at(-1)?.kind === " " || rows.at(-1)?.kind === "-") start(path);
      f.sawHeader = true;
      if (path) f.path = path;
      if (a === "/dev/null") f.status = "added";
      if (b === "/dev/null") f.status = "deleted";
      i++;
      continue;
    }
    if ((m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line))) {
      if (!f) start("");
      oldN = Number(m[1]); newN = Number(m[3]);
      left = { o: m[2] == null ? 1 : Number(m[2]), n: m[4] == null ? 1 : Number(m[4]) };
      inHunk = true;
      rows.push({ kind: "@", range: line.slice(0, line.indexOf("@@", 2) + 2), text: m[5] });
      continue;
    }
    if (f && /^Binary files .* differ$|^GIT binary patch$/.test(line)) { f.binary = true; rows.push({ kind: "note", text: line }); continue; }
    if (f && (m = /^rename from (.+)$/.exec(line))) { f.old = m[1]; }
    rows.push({ kind: "note", text: line });
  }
  for (const x of files) delete x.sawHeader;
  return { rows, files, add: files.reduce((s, x) => s + x.add, 0), del: files.reduce((s, x) => s + x.del, 0) };
}

/** Where each file starts in `rows`, for ] / [ (next / previous file). */
export const fileStarts = (rows) => rows.flatMap((r, i) => (r.kind === "file" ? [i] : []));

/** The next (`dir` 1) or previous (-1) file start from row `at`. */
export function nextFile(starts, at, dir) {
  if (!starts.length) return null;
  if (dir > 0) return starts.find((s) => s > at) ?? starts.at(-1);
  return [...starts].reverse().find((s) => s < at) ?? starts[0];
}
