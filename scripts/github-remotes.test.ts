import { test, expect } from "bun:test";
import { candidates, parseRemoteUrl, parseConfig, githubHost, slug } from "../defaults/mods/github/remotes.js";
import { slimRepo, VERSION, parse } from "../defaults/mods/github/cache.js";

// `git config --get-regexp '^(remote|branch)\.'` as git prints it (variables lowercased).
const conf = (...lines: string[]) => lines.join("\n") + "\n";
const fork = [
  "remote.origin.url git@github.com:DwieDave/fireflies.git",
  "remote.origin.fetch +refs/heads/*:refs/remotes/origin/*",
  "branch.main.remote origin",
  "branch.main.merge refs/heads/main",
  "remote.upstream.url https://github.com/herdrdev/herdr-app.git",
  "remote.upstream.fetch +refs/heads/*:refs/remotes/upstream/*",
];
const first = (text: string, branch: string | null = "main") => candidates(text, branch)[0]?.full ?? null;

test("a fork with an upstream remote is the fork, not its parent", () => {
  expect(candidates(conf(...fork), "main").map((c) => c.full)).toEqual(["DwieDave/fireflies", "herdrdev/herdr-app"]);
  // A branch that tracks nothing still goes to origin first.
  expect(first(conf(...fork), "feature")).toBe("DwieDave/fireflies");
  expect(first(conf(...fork), null)).toBe("DwieDave/fireflies");
});

test("gh's own default wins: gh-resolved = base, or an owner/name", () => {
  expect(first(conf(...fork, "remote.upstream.gh-resolved base"))).toBe("herdrdev/herdr-app");
  expect(candidates(conf(...fork, "remote.upstream.gh-resolved base"), "main")[0].why).toBe("gh default");
  expect(first(conf(...fork, "remote.origin.gh-resolved someone/else"))).toBe("someone/else");
});

test("then where the branch pushes: pushRemote, remote.pushDefault, branch remote", () => {
  const three = [...fork, "remote.mine.url https://github.com/me/mine"];
  expect(first(conf(...three, "branch.main.pushremote mine", "remote.pushdefault upstream"))).toBe("me/mine");
  expect(first(conf(...three, "remote.pushdefault mine"))).toBe("me/mine");
  expect(first(conf(...three.filter((l) => !l.startsWith("branch.")), "branch.main.remote upstream"))).toBe("herdrdev/herdr-app");
  // A branch tracking a local branch (remote "."): skipped.
  expect(first(conf(...fork.filter((l) => !l.startsWith("branch.")), "branch.main.remote ."))).toBe("DwieDave/fireflies");
  // Branch names keep their case (git lowercases only section and variable).
  expect(first(conf(...three, "branch.Feature/X.pushremote mine"), "Feature/X")).toBe("me/mine");
});

test("then origin, then the other remotes in order; non-GitHub remotes don't count", () => {
  expect(candidates(conf(
    "remote.gitlab.url git@gitlab.com:me/thing.git",
    "remote.b.url https://github.com/o/b",
    "remote.a.url https://github.com/o/a",
  ), null).map((c) => c.full)).toEqual(["o/b", "o/a"]);
  expect(candidates(conf("remote.origin.url git@gitlab.com:me/thing.git"), "main")).toEqual([]);
  expect(candidates("", "main")).toEqual([]);
  // Two remotes on one repo: listed once.
  expect(candidates(conf("remote.origin.url git@github.com:o/r.git", "remote.web.url https://github.com/o/r"), null)).toHaveLength(1);
});

test("remote URLs in every form git takes", () => {
  const r = { host: "github.com", owner: "o", name: "r" };
  for (const u of [
    "git@github.com:o/r.git", "git@github.com:o/r", "github.com:o/r.git",
    "https://github.com/o/r.git", "https://github.com/o/r/", "https://user:pass@github.com/o/r.git",
    "ssh://git@github.com/o/r.git", "ssh://git@ssh.github.com:443/o/r.git", "git://github.com/o/r.git",
    "git@github-work:o/r.git", "git@github.com-work:o/r.git",
  ]) expect(parseRemoteUrl(u)).toEqual(r);
  expect(parseRemoteUrl("git@ghe.corp.example:o/r")).toBeNull();
  expect(parseRemoteUrl("https://github.example.com/o/r")).toEqual({ host: "github.example.com", owner: "o", name: "r" });
  expect(parseRemoteUrl("https://acme.ghe.com/o/r")).toEqual({ host: "acme.ghe.com", owner: "o", name: "r" });
  expect(parseRemoteUrl("/srv/git/r.git")).toBeNull();
  expect(parseRemoteUrl("https://github.com/o")).toBeNull();
  expect(githubHost("gitlab.com")).toBeNull();
  expect(parseConfig("a.b c d\n\nx.y\n")).toEqual([["a.b", "c d"], ["x.y", ""]]);
});

test("-R names the host off github.com", () => {
  expect(slug({ full: "o/r", host: "github.com" })).toBe("o/r");
  expect(slug({ full: "o/r", host: "acme.ghe.com" })).toBe("acme.ghe.com/o/r");
});

test("the cache keeps a repo's fork links, and drops v1 (which could hold a fork's parent)", () => {
  const r = slimRepo({ owner: "herdrdev", name: "herdr-app", full: "herdrdev/herdr-app", root: "/x", url: "https://github.com/herdrdev/herdr-app", child: "DwieDave/fireflies" });
  expect(r).toMatchObject({ host: "github.com", parent: null, child: "DwieDave/fireflies" });
  expect(VERSION).toBe(2);
  expect(parse(JSON.stringify({ v: 1, folders: { "|/f": "|herdrdev/herdr-app" }, repos: { "|herdrdev/herdr-app": { at: 1 } } })).folders).toEqual({});
});
