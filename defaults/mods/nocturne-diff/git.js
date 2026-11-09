// Reading a repo's changes with plain git, parsed into files and rows.

import { exec } from "herdr";

// Reads write nothing under .git (no index refresh, lock or fsmonitor cookie),
// so the folder watch doesn't see our own reads and loop (as the shipped
// `changes` mod does).
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
// Fixed a/ b/ prefixes: a diff.mnemonicPrefix or noprefix setting would change them.
const DIFF = ["--no-ext-diff", "--no-textconv", "--no-color", "-M", "--src-prefix=a/", "--dst-prefix=b/"];
// Untracked files are diffed one by one; past this many, they're listed only.
const UNTRACKED_MAX = 40;

const run = (root, on, args) => exec("git", [...READ, ...args], { cwd: root, on });

export async function repo(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  if (top.code !== 0) return null;
  const root = top.stdout.trim();
  const [branch, head, upstream] = await Promise.all([
    run(root, on, ["branch", "--show-current"]),
    run(root, on, ["rev-parse", "--verify", "-q", "HEAD"]),
    run(root, on, ["rev-parse", "--abbrev-ref", "origin/HEAD"]),
  ]);
  let base = upstream.code === 0 ? upstream.stdout.trim() : null;
  if (!base) {
    for (const b of ["main", "master"]) {
      if ((await run(root, on, ["rev-parse", "--verify", "-q", b])).code === 0) { base = b; break; }
    }
  }
  return { root, on, name: root.split("/").pop(), branch: branch.stdout.trim() || "detached", hasHead: head.code === 0, base };
}

/** Changes in scope: "work" = uncommitted (staged, unstaged, untracked);
 *  "branch" = everything since this branch left its base, uncommitted included. */
export async function changes(r, scope) {
  let from = r.hasHead ? "HEAD" : null;
  let since = null;
  if (scope === "branch" && r.base) {
    const mb = await run(r.root, r.on, ["merge-base", "HEAD", r.base]);
    if (mb.code === 0) { from = mb.stdout.trim(); since = r.base; }
  }
  const diff = await run(r.root, r.on, ["diff", ...DIFF, ...(from ? [from] : ["--cached"])]);
  const files = parse(diff.stdout);
  const untracked = (await run(r.root, r.on, ["ls-files", "--others", "--exclude-standard", "-z"])).stdout.split("\0").filter(Boolean);
  for (const [i, path] of untracked.entries()) {
    if (i < UNTRACKED_MAX) {
      const u = await run(r.root, r.on, ["diff", ...DIFF, "--no-index", "--", "/dev/null", path]);
      const [f] = parse(u.stdout);
      if (f) { f.status = "untracked"; f.path = path; files.push(f); continue; }
    }
    files.push({ path, old: null, status: "untracked", add: 0, del: 0, binary: false, rows: [], key: `u:${path}` });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, since };
}

/** A pull request's changes, from `gh pr diff` (no checkout: works for any PR). */
export async function prChanges(r, pr) {
  const d = await exec("gh", ["pr", "diff", String(pr), "--color=never"], { cwd: r.root, on: r.on, timeout: 60000 });
  if (d.code !== 0) throw new Error(d.stderr.trim().split("\n").pop() || `gh pr diff ${pr} failed`);
  const files = parse(d.stdout);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, since: `#${pr}` };
}

function unquote(p) {
  return p.startsWith('"') ? JSON.parse(p) : p;
}

/** A unified diff, split per file: status, counts, numbered rows. */
export function parse(text) {
  const files = [];
  let f = null, oldN = 0, newN = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git (?:"?a\/)(.+?)"? (?:"?b\/)(.+?)"?$/.exec(line);
      f = { path: m ? unquote(m[2]) : line.slice(11), old: m ? unquote(m[1]) : null, status: "modified", add: 0, del: 0, binary: false, rows: [], text: "" };
      files.push(f);
      continue;
    }
    if (!f) continue;
    f.text += line + "\n";
    if (line.startsWith("new file mode")) f.status = "added";
    else if (line.startsWith("deleted file mode")) f.status = "deleted";
    else if (line.startsWith("rename from ")) { f.status = "renamed"; f.old = line.slice(12); }
    else if (line.startsWith("rename to ")) f.path = line.slice(10);
    else if (line.startsWith("Binary files ")) f.binary = true;
    else if (line.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(line);
      oldN = m ? +m[1] : 0; newN = m ? +m[2] : 0;
      f.rows.push({ kind: "@", text: m ? m[3] : line, range: m ? line.slice(0, line.indexOf("@@", 2) + 2) : "" });
    } else if (f.rows.length) {
      const k = line[0], body = line.slice(1).replace(/\t/g, "    ");
      if (k === "+") { f.add++; f.rows.push({ kind: "+", n: newN++, text: body }); }
      else if (k === "-") { f.del++; f.rows.push({ kind: "-", o: oldN++, text: body }); }
      else if (k === " ") f.rows.push({ kind: " ", o: oldN++, n: newN++, text: body });
      else if (k === "\\") f.rows.push({ kind: "\\", text: line.slice(2) });
    }
  }
  for (const x of files) {
    if (x.old === x.path && x.status !== "renamed") x.old = null;
    x.key = `${x.path}:${hash(x.text)}`; // a mark holds only while the file's diff is unchanged
    delete x.text;
  }
  return files;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
