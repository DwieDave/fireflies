// Unified diffs with their headers kept, so a selection of lines can go back
// to git as a patch: staging (git apply --cached), unstaging (--cached -R) or
// discarding (-R) single lines and hunks, lazygit's staging view. Pure: tested
// in scripts/nocturne-git.test.ts. The row drawing is nocturne-diff's
// (copied in draw.js), so a highlighted renderer can replace it later.

/** One file's diff: { header: [lines], path, old, status, binary, hunks: [{
 *  head, oldStart, newStart, text, lines: [{ kind, text }] }] }. */
export function parseDiff(text) {
  const files = [];
  let f = null, h = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(line);
      f = { header: [line], path: m ? unq(m[2]) : line.slice(11), old: m ? unq(m[1]) : null, status: "modified", binary: false, hunks: [], add: 0, del: 0 };
      files.push(f); h = null;
      continue;
    }
    if (!f) continue;
    if (line.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);
      h = { head: line, oldStart: m ? +m[1] : 0, newStart: m ? +m[3] : 0, text: m ? m[5] : "", lines: [] };
      f.hunks.push(h);
      continue;
    }
    if (!h) {
      f.header.push(line);
      if (line.startsWith("new file mode")) f.status = "added";
      else if (line.startsWith("deleted file mode")) f.status = "deleted";
      else if (line.startsWith("rename from ")) { f.status = "renamed"; f.old = line.slice(12); }
      else if (line.startsWith("rename to ")) f.path = line.slice(10);
      else if (line.startsWith("Binary files ") || line === "GIT binary patch") f.binary = true;
      continue;
    }
    const k = line[0];
    if (k === "+" || k === "-" || k === " " || k === "\\") {
      h.lines.push({ kind: k, text: line.slice(1) });
      if (k === "+") f.add++; else if (k === "-") f.del++;
    } else if (line === "") {
      // A trailing newline of the whole diff; an empty context line has its space.
    }
  }
  for (const x of files) if (x.old === x.path && x.status !== "renamed") x.old = null;
  return files;
}

const unq = (p) => (p.startsWith('"') ? JSON.parse(p) : p);

/** A file's rows for the main view: hunk heads and lines, each with its
 *  hunk index and line index (null for a head), old/new line numbers. */
export function rows(f) {
  const out = [];
  f.hunks.forEach((h, hi) => {
    out.push({ kind: "@", hunk: hi, line: null, text: h.text, range: h.head.slice(0, h.head.indexOf("@@", 2) + 2) });
    let o = h.oldStart, n = h.newStart;
    h.lines.forEach((l, li) => {
      const row = { kind: l.kind, hunk: hi, line: li, text: l.text };
      if (l.kind === "+") row.n = n++;
      else if (l.kind === "-") row.o = o++;
      else if (l.kind === " ") { row.o = o++; row.n = n++; }
      out.push(row);
    });
  });
  return out;
}

/** Is a row a change (something staging can pick)? */
export const isChange = (row) => row && (row.kind === "+" || row.kind === "-");

/** A patch holding only the `picked` rows (a Set of "hunk:line" keys) of file
 *  `f`. reverse: the patch will be applied with -R (unstaging from the
 *  staged diff, discarding from the unstaged one), so lines left out are
 *  turned the other way round. null when nothing is picked. */
export function partialPatch(f, picked, { reverse = false } = {}) {
  const hunks = [];
  f.hunks.forEach((h, hi) => {
    const lines = [];
    let any = false, oldN = 0, newN = 0, kept = false;
    h.lines.forEach((l, li) => {
      const on = picked.has(`${hi}:${li}`);
      let kind = l.kind;
      if (kind === "+" || kind === "-") {
        if (on) any = true;
        else if ((kind === "+") !== reverse) { kept = false; return; } // a line that stays out of this change
        else kind = " ";
      } else if (kind === "\\") {
        if (!kept) return;
        lines.push(`\\${l.text}`);
        return;
      }
      if (kind === " ") { oldN++; newN++; }
      else if (kind === "-") oldN++;
      else newN++;
      lines.push(`${kind}${l.text}`);
      kept = true;
    });
    if (!any) return;
    hunks.push(`@@ -${h.oldStart}${oldN === 1 ? "" : `,${oldN}`} +${h.newStart}${newN === 1 ? "" : `,${newN}`} @@${h.text ? ` ${h.text}` : ""}`, ...lines);
  });
  if (!hunks.length) return null;
  let header = f.header.slice();
  // Part of a new file: the index already holds it (git add -N first), so the
  // patch changes an empty file rather than creating one.
  if (f.status === "added" && !reverse) {
    header = header.filter((l) => !l.startsWith("new file mode") && !l.startsWith("index "))
      .map((l) => (l === "--- /dev/null" ? `--- a/${f.path}` : l));
  }
  return [...header, ...hunks].join("\n") + "\n";
}

/** Every change row's key in hunk `hi` (hunk mode picks them all). */
export function hunkKeys(f, hi) {
  const h = f.hunks[hi];
  return h ? h.lines.flatMap((l, li) => (l.kind === "+" || l.kind === "-" ? [`${hi}:${li}`] : [])) : [];
}
