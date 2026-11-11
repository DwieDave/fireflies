import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  parseStatus, letters, parseBranches, parseRemoteBranches, parseRemotes, parseTags, parseLog, parseRefs,
  parseReflog, parseStash, parseWorktrees, repoState, age, initials, fileTree, trackOf, parseLogFull, relativeDate,
} from "../defaults/mods/nocturne-git/parse.js";
import { layoutGraph, segments, usedWidth, widthOf } from "../defaults/mods/nocturne-git/graph.js";
import { parseDiff, rows, partialPatch, hunkKeys } from "../defaults/mods/nocturne-git/patch.js";
import { lookup, barKeys, menuKeys, keyName, BINDINGS, REVIEW_CLASHES } from "../defaults/mods/nocturne-git/keys.js";
import { rewrite, nextUndo, nextRedo, reflogAction, UNDO, REDO } from "../defaults/mods/nocturne-git/history.js";

const US = "\x1f";

// ---- parse

test("status: branch, ahead/behind and lazygit's two letters", () => {
  const text = [
    "# branch.oid abc123", "# branch.head feat/x", "# branch.upstream origin/feat/x", "# branch.ab +2 -1",
    "1 M. N... 100644 100644 100644 aaa bbb src/a.js",
    "1 .M N... 100644 100644 100644 aaa bbb src/b.js",
    "1 MM N... 100644 100644 100644 aaa bbb with space.txt",
    "2 R. N... 100644 100644 100644 aaa bbb R100 new.js", "old.js",
    "u UU N... 100644 100644 100644 100644 a b c conflict.js",
    "? notes.md", "",
  ].join("\0");
  const s = parseStatus(text);
  expect(s.head).toBe("feat/x");
  expect(s.upstream).toBe("origin/feat/x");
  expect([s.ahead, s.behind]).toEqual([2, 1]);
  const by = Object.fromEntries(s.files.map((f) => [f.path, f]));
  expect(letters(by["src/a.js"])).toBe("M ");
  expect(by["src/a.js"].staged && !by["src/a.js"].unstaged).toBe(true);
  expect(letters(by["src/b.js"])).toBe(" M");
  expect(letters(by["with space.txt"])).toBe("MM");
  expect(by["new.js"].from).toBe("old.js");
  expect(by["conflict.js"].conflict).toBe(true);
  expect(letters(by["notes.md"])).toBe("??");
  expect(by["notes.md"].untracked).toBe(true);
});

test("status: detached head and a repo without commits", () => {
  expect(parseStatus("# branch.oid abc\0# branch.head (detached)\0").head).toBe(null);
  expect(parseStatus("# branch.oid (initial)\0# branch.head main\0").oid).toBe(null);
});

test("branches: head first, then by recency; upstream tracking", () => {
  const text = [
    [" ", "old", "", "", "100", "o1", "old one"].join(US),
    ["*", "feat", "origin/feat", "[ahead 2, behind 1]", "200", "f1", "feat work"].join(US),
    [" ", "gone", "origin/gone", "[gone]", "300", "g1", "x"].join(US),
  ].join("\n");
  const b = parseBranches(text);
  expect(b.map((x) => x.name)).toEqual(["feat", "gone", "old"]);
  expect(b[0]).toMatchObject({ head: true, ahead: 2, behind: 1, upstream: "origin/feat" });
  expect(b[1].gone).toBe(true);
  expect(b[2].upstream).toBe(null);
  expect(trackOf("")).toEqual({ gone: false, ahead: 0, behind: 0 });
});

test("remote branches skip origin/HEAD; remotes once each", () => {
  const rb = parseRemoteBranches([
    ["origin/HEAD", "1", "x", "s", "refs/remotes/origin/main"].join(US),
    ["origin/main", "5", "m", "main subject", ""].join(US),
    ["origin/feat/a", "9", "a", "a subject", ""].join(US),
  ].join("\n"));
  expect(rb.map((r) => r.name)).toEqual(["origin/feat/a", "origin/main"]);
  expect(rb[0]).toMatchObject({ remote: "origin", branch: "feat/a" });
  const r = parseRemotes("origin\tgit@x:a.git (fetch)\norigin\tgit@x:a.git (push)\nfork\thttps://f (fetch)\nfork\thttps://f (push)\n");
  expect(r.map((x) => x.name)).toEqual(["origin", "fork"]);
});

test("tags: annotated ones point at their commit", () => {
  const t = parseTags([["v2", "20", "tagobj", "commit2", "release two"].join(US), ["v1", "10", "commit1", "", "c1"].join(US)].join("\n"));
  expect(t[0]).toMatchObject({ name: "v2", oid: "commit2", annotated: true });
  expect(t[1]).toMatchObject({ name: "v1", oid: "commit1", annotated: false });
});

test("log: parents, refs and subjects", () => {
  const l = parseLog([["a".repeat(40), "b".repeat(40) + " " + "c".repeat(40), "Ann Lee", "a@x", "100", "HEAD -> main, origin/main, tag: v1, origin/HEAD", "Merge it"].join(US)].join("\n"));
  expect(l[0].parents.length).toBe(2);
  expect(l[0].short).toBe("aaaaaaa");
  expect(l[0].refs).toEqual([{ kind: "head", name: "main" }, { kind: "ref", name: "origin/main" }, { kind: "tag", name: "v1" }]);
  expect(parseRefs("HEAD")).toEqual([{ kind: "detached", name: "HEAD" }]);
  expect(parseRefs("feat")).toEqual([{ kind: "branch", name: "feat" }]);
  // --decorate=full: a local branch with a slash stays local
  expect(parseRefs("HEAD -> refs/heads/feat/x, refs/heads/fix/up, refs/remotes/origin/fix/up, tag: refs/tags/v1, refs/remotes/origin/HEAD")).toEqual([
    { kind: "head", name: "feat/x" }, { kind: "branch", name: "fix/up" }, { kind: "ref", name: "origin/fix/up" }, { kind: "tag", name: "v1" },
  ]);
});

test("full log: whole messages across lines, records split on RS", () => {
  const rec = (h: string, msg: string, refs = "") => ["h".repeat(39) + h, "", "Ann", "a@x", "100", refs, msg].join(US) + "\x1e";
  const l = parseLogFull(rec("1", "subject one\n\nbody line\nmore\n", "HEAD -> main") + "\n" + rec("2", "two\n"));
  expect(l.length).toBe(2);
  expect(l[0]).toMatchObject({ subject: "subject one", message: "subject one\n\nbody line\nmore", refs: [{ kind: "head", name: "main" }] });
  expect(l[1].message).toBe("two");
  expect(relativeDate(1000 - 8 * 60, 1000)).toBe("8 minutes ago");
  expect(relativeDate(0, 86400 * 3)).toBe("3 days ago");
  expect(relativeDate(0, 1)).toBe("1 second ago");
});

test("reflog, stash, worktrees, state", () => {
  expect(parseReflog(["h1", "HEAD@{0}", "commit: x", "5"].join(US))[0]).toMatchObject({ selector: "HEAD@{0}", subject: "commit: x" });
  expect(parseStash(["stash@{1}", "5", "On main: wip", "h"].join(US))[0]).toMatchObject({ index: 1, subject: "On main: wip" });
  const w = parseWorktrees("worktree /a\nHEAD abc\nbranch refs/heads/main\n\nworktree /b\nHEAD def\ndetached\n");
  expect(w).toMatchObject([{ path: "/a", branch: "main" }, { path: "/b", detached: true }]);
  expect(repoState({ "rebase-merge": true })).toBe("rebasing");
  expect(repoState({ MERGE_HEAD: true })).toBe("merging");
  expect(repoState({})).toBe(null);
});

test("age and initials", () => {
  expect(age(1000 - 30, 1000)).toBe("30s");
  expect(age(1000 - 3 * 3600, 1000)).toBe("3h");
  expect(age(0, 86400 * 3)).toBe("3d");
  expect(initials("Developer Smith-Jones")).toBe("DS");
  expect(initials("can")).toBe("CA");
});

test("file tree: dirs first, single-child dirs joined, collapsible", () => {
  const files = ["src/keys/shipped/a.json", "src/main.js", "README.md", "src/keys/shipped/b.json"].map((path) => ({ path }));
  const t = fileTree(files);
  expect(t.map((r) => `${r.depth}${r.kind[0]}:${r.name}`)).toEqual(["0d:src", "1d:keys/shipped", "2f:a.json", "2f:b.json", "1f:main.js", "0f:README.md"]);
  const folded = fileTree(files, new Set(["src/keys/shipped"]));
  expect(folded.map((r) => r.name)).toEqual(["src", "keys/shipped", "main.js", "README.md"]);
  expect(folded[1].files.length).toBe(2);
});

// ---- graph

const C = (hash: string, ...parents: string[]) => ({ hash, parents });

test("graph: a straight line stays in lane 0", () => {
  const g = layoutGraph([C("c", "b"), C("b", "a"), C("a")]);
  expect(g.width).toBe(1);
  expect(g.rows.map((r) => r.col)).toEqual([0, 0, 0]);
  expect(g.rows[2].after).toEqual([]);
});

test("graph: a merge forks a lane that joins back where the branch began", () => {
  // m merges x into the line; x and y on the side branch, b is the fork point.
  const g = layoutGraph([C("m", "y", "x2"), C("y", "b"), C("x2", "x1"), C("x1", "b"), C("b", "a"), C("a")]);
  const [m, y, x2, x1, b] = g.rows;
  expect(m.merge).toBe(true);
  expect(m.forks).toEqual([{ to: 1, color: x2.color, fresh: true }]);
  expect([y.col, x2.col, x1.col, b.col]).toEqual([0, 1, 1, 0]);
  expect(b.joins.map((j) => j.from)).toEqual([1]);
  expect(g.width).toBe(2);
  expect(m.color).not.toBe(x2.color);
});

test("graph width: only the lanes the rows in view draw in", () => {
  // A side branch merged near the top, then a straight line below it.
  const g = layoutGraph([C("m", "y", "x"), C("y", "b"), C("x", "b"), C("b", "a"), C("a", "z"), C("z")]);
  expect(g.width).toBe(2);
  expect(g.rows.map(usedWidth)).toEqual([2, 2, 2, 2, 1, 1]);
  expect(widthOf(g.rows, 0, 3)).toBe(2);
  expect(widthOf(g.rows, 4, 6)).toBe(1);
  expect(widthOf(g.rows, 4, 99)).toBe(1);
});

test("graph: two branch tips get their own lanes and meet at their base", () => {
  const g = layoutGraph([C("t1", "base"), C("t2", "base"), C("base")]);
  expect(g.rows.map((r) => r.col)).toEqual([0, 1, 0]);
  expect(g.rows[2].joins.map((j) => j.from)).toEqual([1]);
});

test("graph segments: lines through, a join and a fork", () => {
  const g = layoutGraph([C("m", "a", "b"), C("b", "a"), C("a")]);
  const s0 = segments(g.rows[0]);
  expect(s0.node).toMatchObject({ lane: 0, merge: true });
  expect(s0.h).toEqual([{ from: 0, to: 1, color: g.rows[0].forks[0].color }]);
  expect(s0.v.some((v) => v.lane === 1 && v.from === 0.5 && v.to === 1)).toBe(true);
  const s1 = segments(g.rows[1]);
  // lane 0 runs straight through the row of b (in lane 1)
  expect(s1.v.some((v) => v.lane === 0 && v.from === 0 && v.to === 1)).toBe(true);
  const s2 = segments(g.rows[2]);
  expect(s2.h).toEqual([{ from: 0, to: 1, color: g.rows[1].color }]);
});

test("graph: history cut at a limit keeps open lanes to the bottom", () => {
  const g = layoutGraph([C("c", "b"), C("b", "a")]);
  expect(g.rows[1].after).toEqual([g.rows[1].color]);
});

// ---- patches, against real git in a scratch repo

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}
function applyPatch(cwd: string, patch: string, ...flags: string[]) {
  const r = spawnSync("git", ["apply", ...flags, "-"], { cwd, input: patch, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git apply ${flags.join(" ")}: ${r.stderr}\n${patch}`);
}
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "nocturne-git-"));
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, "f.txt"), ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"].join("\n") + "\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

test("partial patch: stage one added line of a hunk", () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, "f.txt"), ["one", "TWO", "two", "three", "3b", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"].join("\n") + "\n");
    const [f] = parseDiff(git(dir, "diff", "--no-color", "--no-ext-diff"));
    const r = rows(f);
    const two = r.find((x) => x.kind === "+" && x.text === "TWO")!;
    applyPatch(dir, partialPatch(f, new Set([`${two.hunk}:${two.line}`]))!, "--cached");
    expect(git(dir, "diff", "--cached", "--no-color").includes("+TWO")).toBe(true);
    expect(git(dir, "diff", "--cached", "--no-color").includes("+3b")).toBe(false);
    expect(git(dir, "diff", "--no-color").includes("+3b")).toBe(true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("partial patch: stage a deletion alone, unstage it, discard a line", () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, "f.txt"), ["one", "three", "four", "FIVE", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"].join("\n") + "\n");
    let [f] = parseDiff(git(dir, "diff", "--no-color"));
    const del = rows(f).find((x) => x.kind === "-" && x.text === "two")!;
    applyPatch(dir, partialPatch(f, new Set([`${del.hunk}:${del.line}`]))!, "--cached");
    expect(git(dir, "show", ":f.txt").split("\n").slice(0, 3)).toEqual(["one", "three", "four"]);
    // unstage it again from the staged diff
    const [s] = parseDiff(git(dir, "diff", "--cached", "--no-color"));
    applyPatch(dir, partialPatch(s, new Set(hunkKeys(s, 0)), { reverse: true })!, "--cached", "-R");
    expect(git(dir, "diff", "--cached", "--no-color")).toBe("");
    // discard only "FIVE" in the work tree (the -five and +FIVE pair)
    [f] = parseDiff(git(dir, "diff", "--no-color"));
    const pick = rows(f).filter((x) => x.text === "five" || x.text === "FIVE").map((x) => `${x.hunk}:${x.line}`);
    applyPatch(dir, partialPatch(f, new Set(pick), { reverse: true })!, "-R");
    const now = readFileSync(join(dir, "f.txt"), "utf8").split("\n");
    expect(now.slice(0, 5)).toEqual(["one", "three", "four", "five", "six"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("partial patch: part of a new file after git add -N", () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, "new.txt"), "a\nb\nc\n");
    git(dir, "add", "-N", "new.txt");
    const [f] = parseDiff(git(dir, "diff", "--no-color", "--", "new.txt"));
    expect(f.status).toBe("added");
    const b = rows(f).find((x) => x.text === "b")!;
    applyPatch(dir, partialPatch(f, new Set([`${b.hunk}:${b.line}`]))!, "--cached");
    expect(git(dir, "show", ":new.txt")).toBe("b\n");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("partial patch: nothing picked is no patch", () => {
  const [f] = parseDiff("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n");
  expect(partialPatch(f, new Set())).toBe(null);
  expect(hunkKeys(f, 0)).toEqual(["0:0", "0:1"]);
});

// ---- history

const H = (hash: string, parents: string[], subject = hash) => ({ hash, parents, subject });
const line = [H("d", ["c"]), H("c", ["b"]), H("b", ["a"]), H("a", [])];

test("rewrite: drop, squash, fixup and edit write the todo oldest first", () => {
  expect(rewrite(line, 1, "drop")).toEqual({ base: "b", todo: "drop c c\npick d d\n", oldest: 1 });
  expect(rewrite(line, 0, "squash")).toEqual({ base: "b", todo: "pick c c\nsquash d d\n", oldest: 1 });
  expect(rewrite(line, 1, "fixup").todo).toBe("pick b b\nfixup c c\npick d d\n");
  expect(rewrite(line, 2, "edit").todo).toBe("edit b b\npick c c\npick d d\n");
  expect(rewrite(line, 2, "fixup")).toMatchObject({ base: null, oldest: 3 });
  expect(rewrite(line, 3, "squash").error).toBeTruthy();
});

test("rewrite: move down / up swap neighbours; reword adds an exec", () => {
  expect(rewrite(line, 0, "move-down").todo).toBe("pick d d\npick c c\n");
  expect(rewrite(line, 1, "move-up").todo).toBe("pick d d\npick c c\n");
  expect(rewrite(line, 0, "move-up").error).toBeTruthy();
  expect(rewrite(line, 1, "reword").todo).toMatch(/^pick c c\nexec .*NOCTURNE_GIT_MSG.*\npick d d\n$/);
});

test("rewrite: refuses across a merge", () => {
  const merged = [H("d", ["c"]), H("c", ["b", "x"]), H("b", ["a"])];
  expect(rewrite(merged, 0, "drop").error).toBe(undefined);
  expect(rewrite(merged, 1, "drop").error).toMatch(/merge/);
  expect(rewrite(merged, 0, "squash").error).toMatch(/merge/);
});

test("rewrite runs: a real rebase with the todo and the reword exec", () => {
  const dir = scratch();
  try {
    for (const n of ["b", "c", "d"]) { writeFileSync(join(dir, `${n}.txt`), n); git(dir, "add", "."); git(dir, "commit", "-q", "-m", n); }
    const log = parseLog(git(dir, "log", `--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s`));
    const plan = rewrite(log, 1, "reword");
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
      NOCTURNE_GIT_TODO: plan.todo, NOCTURNE_GIT_MSG: "c, reworded", GIT_EDITOR: "true",
      GIT_SEQUENCE_EDITOR: `sh -c 'printf "%s" "$NOCTURNE_GIT_TODO" > "$1"' -` };
    const r = spawnSync("git", ["rebase", "-i", plan.base!], { cwd: dir, env, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(git(dir, "log", "--format=%s").trim().split("\n")).toEqual(["d", "c, reworded", "b", "init"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const R = (hash: string, subject: string) => ({ hash, subject });

test("undo: a commit resets to before it; a checkout goes back", () => {
  expect(nextUndo([R("h2", "commit: two"), R("h1", "commit: one")])).toMatchObject({ args: ["reset", "--hard", "h1"], hard: true });
  expect(nextUndo([R("h1", "checkout: moving from main to feat"), R("h1", "commit: one")])).toMatchObject({ args: ["checkout", "main"], hard: false });
});

test("undo twice and redo walk the reflog past what was undone", () => {
  const log = [
    R("h1", `${UNDO}: moving to h1`), // undid "commit: two"
    R("h2", "commit: two"),
    R("h1", "commit: one"),
    R("h0", "commit: zero"),
  ];
  expect(nextUndo(log)).toMatchObject({ args: ["reset", "--hard", "h0"] });
  expect(nextRedo(log)).toMatchObject({ args: ["reset", "--hard", "h2"] });
  expect(nextRedo([R("h3", "commit: three"), ...log])).toBe(null);
  const redone = [R("h2", `${REDO}: moving to h2`), ...log];
  expect(nextUndo(redone)).toMatchObject({ args: ["reset", "--hard", "h1"] });
});

test("undo: a whole rebase goes back to before it started", () => {
  const log = [
    R("n2", "rebase (finish): returning to refs/heads/main"),
    R("n2", "rebase (pick): two"),
    R("n1", "rebase (start): checkout base"),
    R("old", "commit: two"),
  ];
  expect(reflogAction(log, 1)).toBe(null);
  expect(nextUndo(log)).toMatchObject({ args: ["reset", "--hard", "old"] });
});

// ---- keys

test("keys: context first, then lists, then global", () => {
  expect(lookup("files", "space")?.action).toBe("stage");
  expect(lookup("review", "space")?.action).toBe("review-mark");
  expect(lookup("commits", "j")?.action).toBe("down");
  expect(lookup("commits", "P")?.action).toBe("push");
  expect(lookup("staging", "j")?.action).toBe("line-down");
  expect(lookup("menu", "P")).toBe(null);
  expect(lookup("commits", "ctrl-j")?.action).toBe("move-down");
  expect(lookup("branches", "4")?.action).toBe("panel:commits");
});

test("keys: every review clash means something else on the Files tab", () => {
  for (const [k] of REVIEW_CLASHES) expect(lookup("review", k)?.action).not.toBe(lookup("files", k)?.action);
});

test("keys: no context binds one key twice", () => {
  const seen = new Set<string>();
  for (const [ctx, keys] of BINDINGS) for (const k of keys as string[]) {
    const id = `${ctx} ${k}`;
    expect(seen.has(id)).toBe(false);
    seen.add(id);
  }
});

test("keys: bar and menus come from the table", () => {
  expect(barKeys("files").map((b) => b.key)).toContain("space");
  expect(barKeys("files").map((b) => b.key)).toContain("P");
  expect(menuKeys("commits").find((b) => b.action === "drop")?.flags.has("danger")).toBe(true);
});

test("keyName: lazygit's names for gpui's key events", () => {
  expect(keyName({ key: "j", key_char: "j", modifiers: {} })).toBe("j");
  expect(keyName({ key: "g", key_char: "G", modifiers: { shift: true } })).toBe("G");
  expect(keyName({ key: "space", key_char: " ", modifiers: {} })).toBe("space");
  expect(keyName({ key: "j", key_char: "j", modifiers: { control: true } })).toBe("ctrl-j");
  expect(keyName({ key: "down", modifiers: { alt: true } })).toBe("alt-down");
  expect(keyName({ key: "g", key_char: "g", modifiers: { platform: true } })).toBe(null);
  expect(keyName({ key: "escape", modifiers: {} })).toBe("escape");
  expect(keyName({ key: "tab", modifiers: { shift: true } })).toBe("shift-tab");
});
