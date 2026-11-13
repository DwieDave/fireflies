import { test, expect } from "bun:test";
import {
  blank, parse, lookup, merge, prune, fit, scrub, scrubUrl, newest, entryFor, repoKey, folderKey,
  slimRun, slimJob, slimPr, slimPrRow, slimReviewComment, MAX_BYTES, LIMITS, VERSION,
} from "../defaults/mods/github/cache.ts";
import { prListQuery, prRows, rowTone, readAgo } from "../defaults/mods/github/model.ts";

const repo = (full: string, on: string | null = null) => ({ owner: full.split("/")[0], name: full.split("/")[1], full, root: `/src/${full}`, on, url: `https://github.com/${full}`, base: "main", branch: "dev" });
const entry = (full: string, extra: Record<string, unknown> = {}) => ({ ...entryFor(repo(full)), ...extra });

test("a missing, broken or older cache reads as blank", () => {
  expect(parse("")).toEqual(blank());
  expect(parse("{nope")).toEqual(blank());
  expect(parse(JSON.stringify({ v: VERSION - 1, folders: {}, repos: {} }))).toEqual(blank());
  expect(parse(null)).toEqual(blank());
  const ok = { v: VERSION, folders: { a: "b" }, repos: { b: { at: 1 } } };
  expect(parse(JSON.stringify(ok))).toEqual(ok);
});

test("a folder finds the repo it last showed, per machine", () => {
  const text = merge("", "/src/o/r/sub", entry("o/r"), 100);
  const doc = parse(text);
  expect(lookup(doc, "/src/o/r/sub", null)?.repo.full).toBe("o/r");
  expect(lookup(doc, "/src/o/r/sub", "vps")).toBeNull();
  expect(lookup(doc, "/elsewhere", null)).toBeNull();
  expect(repoKey(repo("o/r", "vps"))).toBe("vps|o/r");
  expect(folderKey("/x", null)).toBe("|/x");
});

test("merging keeps other windows' repos and stamps this one", () => {
  const a = merge("", "/a", entry("o/a"), 100);
  const b = merge(a, "/b", entry("o/b"), 200);
  const doc = parse(b);
  expect(Object.keys(doc.repos).sort()).toEqual(["|o/a", "|o/b"]);
  expect(doc.repos["|o/b"].at).toBe(200);
  expect(doc.repos["|o/a"].at).toBe(100);
  // The same repo again replaces its entry.
  const c = parse(merge(b, "/a", entry("o/a", { prs: { lists: { all: { list: [{ number: 1 }], at: 300 } }, details: {} } }), 300));
  expect(c.repos["|o/a"].prs.lists.all.list).toEqual([{ number: 1 }]);
});

test("only the last repos opened are kept, and their folders with them", () => {
  let text = "";
  for (let i = 0; i < LIMITS.repos + 3; i++) text = merge(text, `/f${i}`, entry(`o/r${i}`), 1000 + i);
  const doc = parse(text);
  expect(Object.keys(doc.repos).length).toBe(LIMITS.repos);
  expect(doc.repos["|o/r0"]).toBeUndefined();
  expect(doc.repos[`|o/r${LIMITS.repos + 2}`]).toBeDefined();
  expect(doc.folders["|/f0"]).toBeUndefined();
  expect(doc.folders[`|/f${LIMITS.repos + 2}`]).toBe(`|o/r${LIMITS.repos + 2}`);
});

test("details, jobs and needs keep their newest few", () => {
  const details: Record<string, unknown> = {}, jobs: Record<string, unknown> = {};
  for (let i = 0; i < 40; i++) { details[i] = { pr: { number: i }, at: i }; jobs[i] = { jobs: [], at: i }; }
  const doc = prune({ v: VERSION, folders: {}, repos: { k: { ...entry("o/r"), at: 1, prs: { lists: {}, details }, actions: { runs: {}, jobs, needs: {} } } } });
  const e = doc.repos.k;
  expect(Object.keys(e.prs.details).length).toBe(LIMITS.details);
  expect(Object.keys(e.prs.details)).toContain("39");
  expect(Object.keys(e.prs.details)).not.toContain("0");
  expect(Object.keys(e.actions.jobs).length).toBe(LIMITS.jobs);
  expect(Object.keys(newest({ a: { at: 1 }, b: { at: 3 }, c: { at: 2 } }, 2))).toEqual(["b", "c"]);
});

test("the file stays under its byte budget, dropping the oldest first and this repo last", () => {
  const big = "x".repeat(20_000);
  let text = "";
  for (let i = 0; i < LIMITS.repos; i++) {
    const details: Record<string, unknown> = {};
    for (let n = 0; n < LIMITS.details; n++) details[n] = { pr: { number: n, body: big }, at: 1000 * i + n };
    text = merge(text, `/f${i}`, entry(`o/r${i}`, { prs: { lists: {}, details } }), 1000 * i + 999);
  }
  expect(text.length).toBeLessThanOrEqual(MAX_BYTES);
  const doc = parse(text);
  const last = `|o/r${LIMITS.repos - 1}`;
  expect(doc.repos[last]).toBeDefined();
  expect(Object.keys(doc.repos[last].prs.details).length).toBe(LIMITS.details);
  expect(doc.repos["|o/r0"]).toBeUndefined();
  // Even one huge entry fits: its oldest pieces go.
  const huge: Record<string, unknown> = {};
  for (let n = 0; n < LIMITS.details; n++) huge[n] = { pr: { body: "y".repeat(200_000) }, at: n };
  const one = fit({ v: VERSION, folders: {}, repos: { k: { ...entry("o/k"), at: 5, prs: { lists: {}, details: huge } } } }, 500_000, "k");
  expect(one.length).toBeLessThanOrEqual(500_000);
  expect(Object.keys(parse(one).repos.k.prs.details)).toContain(String(LIMITS.details - 1));
});

test("multi-byte text counts in bytes", () => {
  const body = "🌙".repeat(50_000); // 4 bytes each: 200 KB, 100k UTF-16 units
  const t = fit({ v: VERSION, folders: {}, repos: { k: { ...entry("o/k"), at: 1, prs: { lists: {}, details: { 1: { pr: { body }, at: 1 }, 2: { pr: { body }, at: 2 } } } } } }, 300_000, "k");
  expect(new TextEncoder().encode(t).length).toBeLessThanOrEqual(300_000);
  expect(Object.keys(parse(t).repos.k.prs.details)).toEqual(["2"]);
});

test("nothing that looks like a credential is written", () => {
  expect(scrubUrl("https://x-access-token:ghs_abcdefghijklmnopqrstuvwxyz0123@github.com/o/r.git")).toBe("https://github.com/o/r.git");
  expect(scrubUrl("https://github.com/o/r")).toBe("https://github.com/o/r");
  const dirty = {
    token: "t", access_token: "a", Authorization: "Bearer x", password: "p", client_secret: "c",
    nested: [{ privateKey: "k", note: "use ghp_0123456789abcdefghijABCDEFGHIJ0123 here", author: { login: "me" } }],
    url: "https://u:p@example.com/x", github_pat: "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz",
  };
  const clean = scrub(dirty);
  const text = JSON.stringify(clean);
  for (const bad of ["Bearer", "ghp_", "github_pat_11", "u:p@", "\"t\"", "\"p\""]) expect(text).not.toContain(bad);
  expect(clean.nested[0].author.login).toBe("me");
  expect(clean.nested[0].note).toBe("use [redacted] here");
  expect(clean.url).toBe("https://example.com/x");
  // And merge scrubs what it writes.
  const written = merge("", "/a", { ...entry("o/a"), repo: { ...repo("o/a"), url: "https://me:ghp_0123456789abcdefghijABCDEFGHIJ0123@github.com/o/a" }, token: "nope" } as any, 1);
  expect(written).not.toContain("ghp_");
  expect(written).not.toContain("nope");
});

test("slim keeps only what the window draws", () => {
  const run = { id: 1, name: "ci", display_title: "t", status: "completed", conclusion: "success", run_number: 7, head_branch: "b", head_sha: "s", event: "push", path: ".github/workflows/ci.yml", run_started_at: "a", updated_at: "b", html_url: "u", repository: { big: true }, head_commit: { message: "m" }, actor: {} };
  expect(slimRun(run)).toEqual({ id: 1, name: "ci", display_title: "t", status: "completed", conclusion: "success", run_number: 7, head_branch: "b", head_sha: "s", event: "push", path: ".github/workflows/ci.yml", run_started_at: "a", updated_at: "b", html_url: "u" });
  const job = { id: 2, name: "test", status: "completed", conclusion: "failure", started_at: "a", completed_at: "b", html_url: "u", runner_name: "r", labels: ["x"], steps: [{ number: 1, name: "Set up", status: "completed", conclusion: "success", started_at: "a", completed_at: "b", extra: 1 }] };
  expect(slimJob(job)).toEqual({ id: 2, name: "test", status: "completed", conclusion: "failure", started_at: "a", completed_at: "b", html_url: "u", steps: [{ number: 1, name: "Set up", status: "completed", conclusion: "success", started_at: "a", completed_at: "b" }] });
  const pr = slimPr({ number: 3, title: "T", body: "B", author: { login: "a", id: 9, avatarUrl: "x" }, mergeable: "MERGEABLE", statusCheckRollup: [{ __typename: "CheckRun", name: "c", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "d", workflowName: "w", startedAt: "s", completedAt: "e", junk: 1 }], comments: [{ author: { login: "b" }, body: "hi", createdAt: "c", url: "u", reactionGroups: [] }], reviews: [{ author: { login: "c" }, state: "APPROVED", body: "", submittedAt: "s", commit: {} }] });
  expect(pr.mergeable).toBeUndefined();
  expect(pr.author).toEqual({ login: "a" });
  expect(pr.statusCheckRollup[0]).toEqual({ __typename: "CheckRun", name: "c", workflowName: "w", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "d", startedAt: "s", completedAt: "e" });
  expect(pr.comments[0]).toEqual({ body: "hi", createdAt: "c", url: "u", author: { login: "b" } });
  expect(slimPrRow({ number: 1, title: "x", author: { login: "a", name: "A" }, labels: [{ name: "bug", color: "f00", id: 1 }], tone: "done", body: "big" })).toEqual({ number: 1, title: "x", tone: "done", author: { login: "a" }, labels: [{ name: "bug", color: "f00" }] });
  expect(slimReviewComment({ user: { login: "u", id: 1 }, body: "b", created_at: "c", path: "p", line: 3, diff_hunk: "@@", html_url: "h" })).toEqual({ body: "b", created_at: "c", path: "p", line: 3, html_url: "h", user: { login: "u" } });
});

test("the PR list asks GitHub only for the rows' fields, by filter", () => {
  const all = prListQuery("all", "o/r");
  expect(all.vars).toEqual([["owner", "o"], ["name", "r"], ["n", 60]]);
  expect(all.query).toContain("pullRequests(states: OPEN");
  expect(all.query).toContain("statusCheckRollup { state }");
  expect(all.query).not.toContain("contexts");
  expect(all.query).not.toContain("body");
  expect(new Map(prListQuery("mine", "o/r").vars).get("q")).toBe("repo:o/r is:pr is:open author:@me sort:created-desc");
  expect(new Map(prListQuery("review", "o/r").vars).get("q")).toContain("review-requested:@me");
  const rows = prRows({ repository: { pullRequests: { nodes: [
    { number: 5, title: "a", isDraft: false, headRefName: "h", additions: 1, deletions: 2, reviewDecision: "APPROVED", updatedAt: "u", author: { login: "x" }, labels: { nodes: [{ name: "l", color: "c" }] }, commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] } },
    { number: 6, title: "b", author: null, labels: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } },
  ] } } });
  expect(rows[0]).toEqual({ number: 5, title: "a", isDraft: false, headRefName: "h", additions: 1, deletions: 2, reviewDecision: "APPROVED", updatedAt: "u", author: { login: "x" }, labels: [{ name: "l", color: "c" }], rollup: "FAILURE" });
  expect(rows[1].rollup).toBeNull();
  expect(prRows({ search: { nodes: [{}, { number: 9, title: "s" }] } }).map((r) => r.number)).toEqual([9]);
});

test("a row's tone: its checks once read, else the rollup", () => {
  expect(rowTone({ rollup: "SUCCESS" })).toBe("done");
  expect(rowTone({ rollup: "FAILURE" })).toBe("failed");
  expect(rowTone({ rollup: "ERROR" })).toBe("failed");
  expect(rowTone({ rollup: "PENDING" })).toBe("working");
  expect(rowTone({ rollup: null })).toBeNull();
  expect(rowTone({ rollup: "SUCCESS", tone: "working" })).toBe("working");
  expect(rowTone({ statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }] })).toBe("failed");
});

test("the bar says how old the shown data is", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  expect(readAgo(0, now)).toBe("");
  expect(readAgo(now - 10_000, now)).toBe("just now");
  expect(readAgo(now - 120_000, now)).toBe("2m ago");
  expect(readAgo(now - 3 * 3600_000, now)).toBe("3h ago");
});
