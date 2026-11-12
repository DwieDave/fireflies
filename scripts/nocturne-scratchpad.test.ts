// The scratchpad's note (nocturne-editor/scratch.js, shipped again as
// nocturne/scratch.js): one per repository under the app's folder, found by
// git's common dir so every worktree opens the same one; a folder outside
// git gets its own; the index of notes; saving as it's typed (a wait after
// the last change, at once on close, never two writes at a time).
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { owner, notePath, fileName, isNote, noteName, repoName, absolute, locate, indexed, Autosave, AUTOSAVE } from "../defaults/mods/nocturne-editor/scratch.js";

const HOME = "/Users/dev/.config/herdr-app";
/** A fake `exec` for `git rev-parse --git-common-dir` by folder: what git prints (relative in a main worktree). */
const git = (answers: Record<string, string | null>) => async (cmd: string, args: string[], o: any) => {
  expect(cmd).toBe("git");
  expect(args).toEqual(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const a = answers[o.cwd];
  return a == null ? { code: 128, stdout: "", stderr: "fatal: not a git repository" } : { code: 0, stdout: a + "\n", stderr: "" };
};

describe("which note", () => {
  const exec = git({
    "/code/app": ".git",                         // the main worktree: relative
    "/code/app/src": "/code/app/.git",            // a folder inside it
    "/wt/app-feature": "/code/app/.git",          // a linked worktree: absolute
    "/code/other/app": ".git",                    // another repository with the same name
    "/srv/bare.git": ".",                         // a bare repository
  });
  test("every worktree of a repository, and folders inside it, get the same note", async () => {
    const a = notePath(HOME, await owner(exec, "/code/app"));
    expect(notePath(HOME, await owner(exec, "/code/app/src"))).toBe(a);
    expect(notePath(HOME, await owner(exec, "/wt/app-feature"))).toBe(a);
    expect(a).toMatch(new RegExp(`^${HOME}/scratchpad/app-[0-9a-f]{8}\\.md$`));
  });
  test("two repositories with one name keep two notes", async () => {
    expect(notePath(HOME, await owner(exec, "/code/other/app"))).not.toBe(notePath(HOME, await owner(exec, "/code/app")));
  });
  test("a folder outside git gets its own, named after the folder", async () => {
    const w = await owner(exec, "/tmp/notes/");
    expect(w).toEqual({ name: "notes", dir: "/tmp/notes", repo: false });
    expect(fileName(w)).toMatch(/^notes-[0-9a-f]{8}\.md$/);
  });
  test("a bare repository is named without .git; a submodule by its module", () => {
    expect(repoName("/srv/bare.git")).toBe("bare");
    expect(repoName("/code/app/.git")).toBe("app");
    expect(repoName("/code/app/.git/modules/vendor/ghostty")).toBe("ghostty");
  });
  test("git missing or failing: the folder's own note", async () => {
    const broken = async () => { throw new Error("no git"); };
    expect(await owner(broken as any, "/code/app")).toEqual({ name: "app", dir: "/code/app", repo: false });
  });
  test("a space on another machine: a note of its own for the same path", async () => {
    const w = await owner(exec, "/code/app");
    expect(fileName(w, "nas")).not.toBe(fileName(w));
  });
  test("names that aren't safe in a file name are made so", () => {
    expect(fileName({ name: "my repo/ü", dir: "/x" })).toMatch(/^my-repo-ü-[0-9a-f]{8}\.md$/);
  });
  test("relative common dirs are made absolute", () => {
    expect(absolute(".git", "/code/app")).toBe("/code/app/.git");
    expect(absolute("../../.git", "/code/app/a/b")).toBe("/code/app/.git");
  });
});

test("isNote and noteName: what the editor knows from a path", () => {
  const p = `${HOME}/scratchpad/app-0a1b2c3d.md`;
  expect(isNote(p, HOME)).toBe(true);
  expect(isNote(`${HOME}/scratchpad/sub/x.md`, HOME)).toBe(false);
  expect(isNote(`/code/app/scratchpad/app-0a1b2c3d.md`, HOME)).toBe(false);
  expect(isNote(`${HOME}/scratchpad/index.json`, HOME)).toBe(false);
  expect(noteName(p)).toBe("app");
  expect(noteName(`${HOME}/scratchpad/my-repo-0a1b2c3d.md`)).toBe("my-repo");
});

test("git older than 2.31 (no --path-format): asked again without it", async () => {
  const asked: string[][] = [];
  const old = async (_c: string, args: string[]) => { asked.push(args); return args.includes("--path-format=absolute") ? { code: 129, stdout: "", stderr: "error: unknown option `path-format=absolute'" } : { code: 0, stdout: ".git\n", stderr: "" }; };
  expect(await owner(old as any, "/code/app")).toEqual({ name: "app", dir: "/code/app/.git", repo: true });
  expect(asked.length).toBe(2);
});

describe("locate: the note and the index", () => {
  test("records the note in index.json once, keeping the others", async () => {
    const files: Record<string, string> = { [`${HOME}/scratchpad/index.json`]: JSON.stringify({ "x-00000000.md": { name: "x", dir: "/x", repo: true } }) };
    const writes: string[] = [];
    const io = {
      exec: git({ "/code/app": ".git" }), appHome: HOME,
      readTextFile: async (p: string) => files[p] ?? null,
      writeTextFile: async (p: string, t: string, was: string | null) => { expect(was).toBe(files[p] ?? null); files[p] = t; writes.push(p); return null; },
    };
    const n = await locate(io, "/code/app");
    expect(n).toMatchObject({ name: "app", dir: "/code/app/.git", repo: true });
    const index = JSON.parse(files[`${HOME}/scratchpad/index.json`]);
    expect(Object.keys(index).sort()).toEqual([n.path.split("/").pop(), "x-00000000.md"].sort());
    expect(index[n.path.split("/").pop()!]).toEqual({ name: "app", dir: "/code/app/.git", repo: true });
    await locate(io, "/code/app");
    expect(writes.length).toBe(1);
  });
  test("an index that can't be read or written doesn't stop the note", async () => {
    const io = { exec: git({}), appHome: HOME, readTextFile: async () => "{not json", writeTextFile: async () => { throw new Error("read-only"); } };
    expect((await locate(io, "/tmp/n")).path).toMatch(/\/scratchpad\/n-[0-9a-f]{8}\.md$/);
  });
  test("indexed keeps the same object when nothing changes", () => {
    const i = indexed({}, "/h/scratchpad/a-1.md", { name: "a", dir: "/a/.git", repo: true });
    expect(indexed(i, "/h/scratchpad/a-1.md", { name: "a", dir: "/a/.git", repo: true })).toBe(i);
  });
});

describe("autosave", () => {
  /** A clock the test moves by hand. */
  function clock() {
    let now = 0;
    const due: { at: number; fn: () => void; off: boolean }[] = [];
    return {
      timer: (ms: number, fn: () => void) => { const t = { at: now + ms, fn, off: false }; due.push(t); return () => { t.off = true; }; },
      async tick(ms: number) {
        now += ms;
        for (const t of due.filter((t) => !t.off && t.at <= now)) { t.off = true; t.fn(); }
        await new Promise((r) => setTimeout(r, 0));
      },
    };
  }
  test(`writes ${AUTOSAVE} ms after the last change, once for a burst of typing`, async () => {
    const c = clock();
    let writes = 0;
    const states: string[] = [];
    const a = new Autosave({ write: async () => { writes++; }, timer: c.timer, onState: (s: string) => states.push(s) });
    a.touch(); await c.tick(300);
    a.touch(); await c.tick(300);
    a.touch(); await c.tick(AUTOSAVE - 1);
    expect(writes).toBe(0);
    expect(a.state).toBe("pending");
    await c.tick(1);
    expect(writes).toBe(1);
    expect(states).toEqual(["pending", "saving", "saved"]);
  });
  test("closing writes at once what waits, and nothing when nothing waits", async () => {
    const c = clock();
    let writes = 0;
    const a = new Autosave({ write: async () => { writes++; }, timer: c.timer });
    await a.flush();
    expect(writes).toBe(0);
    a.touch();
    await a.flush();
    expect(writes).toBe(1);
    await c.tick(AUTOSAVE * 2);
    expect(writes).toBe(1);
    expect(a.state).toBe("saved");
  });
  test("a change while writing writes again after, never two at a time", async () => {
    const c = clock();
    let open = 0, most = 0, writes = 0;
    let release: () => void = () => {};
    const a = new Autosave({ write: () => new Promise<void>((r) => { open++; most = Math.max(most, open); writes++; release = () => { open--; r(); }; }), timer: c.timer });
    a.touch(); await c.tick(AUTOSAVE);
    expect(a.state).toBe("saving");
    a.touch(); await c.tick(AUTOSAVE);
    const done = a.flush();
    release(); await new Promise((r) => setTimeout(r, 0));
    release(); await done;
    expect(most).toBe(1);
    expect(writes).toBe(2);
    expect(a.state).toBe("saved");
  });
  test("a failed write says so; the next change tries again", async () => {
    const c = clock();
    let fail = true;
    const a = new Autosave({ write: async () => { if (fail) throw new Error("disk full"); }, timer: c.timer });
    a.touch(); await c.tick(AUTOSAVE);
    expect(a.state).toBe("error");
    fail = false;
    a.touch(); await c.tick(AUTOSAVE);
    expect(a.state).toBe("saved");
  });
});

test("nocturne ships the same scratch.js byte for byte", () => {
  const a = readFileSync("defaults/mods/nocturne-editor/scratch.js", "utf8");
  expect(readFileSync("defaults/mods/nocturne/scratch.js", "utf8")).toBe(a);
});
