// The worktree dialog moved into the git window (git's Worktrees
// tab, tested in git-view.test.ts). What's left of the worktree mod
// is a stub: whoever still opens it (a saved layout, a key, another mod)
// gets the git window on Worktrees with the same request.
import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";

const opened: any[] = [];
const closed: string[] = [];
let spaceList: any[] = [];
let paneList: any[] = [];
let propsNow: any = null;
const el: any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : () => el), apply: () => el });
// The stub's source with its imports as stand-ins (mock.module would leak
// into the other test files of the same run).
const source = (await readFile(new URL("../defaults/mods/worktree/main.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "").replace(/^export default class /m, "class ").replace(/^export function /m, "function ");
const herdr = {
  props: () => propsNow, spaces: () => spaceList, panes: () => paneList, home: () => "/home/u",
  theme: () => new Proxy({}, { get: () => "#808080" }),
  openOverlay: (spec: any) => { opened.push(spec); return "o2"; },
  closeOverlay: (id: string) => { closed.push(id); },
};
const { WorktreeMoved, gitProps } = new Function("View", "div", ...Object.keys(herdr), `${source}\nreturn { WorktreeMoved, gitProps };`)(class {}, () => el, ...Object.values(herdr));

test("the dialog's props become the git window's: the space's folder and machine, the request", () => {
  spaceList = [{ id: "s1", machine: "box", attached: true, folder: "/srv/repo", tabs: [] }];
  expect(gitProps({ space: "s1", action: "remove" })).toEqual({ folder: "/srv/repo", on: "box", worktrees: { action: "remove", space: "s1" } });
  // Not attached: the space's first terminal's folder.
  spaceList = [{ id: "s2", machine: null, attached: false, folder: "/home/u", tabs: [{ id: "t1" }] }];
  paneList = [{ tab: "t1", cwd: "/home/u/code/app" }];
  expect(gitProps({ space: "s2", action: "new", branch: "feat/x", tab: "claude", argv: ["claude"] })).toEqual({
    folder: "/home/u/code/app", on: null, worktrees: { action: "new", space: "s2", branch: "feat/x", tab: "claude", argv: ["claude"] },
  });
  // A repo without a space: { folder, machine }.
  expect(gitProps({ folder: "/x/repo", machine: "m1", action: "open" })).toEqual({ folder: "/x/repo", on: "m1", worktrees: { action: "open" } });
});

test("opened as a dialog, it opens the git window on Worktrees and closes itself", () => {
  spaceList = [{ id: "s1", machine: null, attached: true, folder: "/r", tabs: [] }];
  propsNow = { space: "s1", action: "new", overlay: "o1" };
  const v = new WorktreeMoved();
  let later: Function | null = null;
  v.init(propsNow, { timer: { after: (_ms: number, f: Function) => { later = f; } } });
  later!();
  expect(opened.at(-1)).toMatchObject({ mod: "git", kind: "window", props: { folder: "/r", worktrees: { action: "new", space: "s1" } } });
  expect(closed).toEqual(["o1"]);
  v.render();
});
